// src/controllers/webhooks/zidOrderEventsController.ts
import { Request, Response } from 'express';
import { ConvertApiService, Event, Visitor, Product as ConvertProductType } from '../../services/convert-service';
import { CurrencyService } from '../../services/currency-service';
// --- MODIFIED ---: Import the new heuristic lookup function.
import { getContextByConvertVisitorId, getContextByZidCustomerId, getHeuristicGuestContext } from '../../services/firestore-service';
import { StoredBucketingInfo as FirestoreStoredBucketingInfo, StoredConvertBucketingEntry, ZidProduct, NormalizedBucketingInfo } from '../../types/index';
import { getStoredClientContext as getInMemoryContext, StoredBucketingInfo as InMemoryStoredBucketingInfo } from '../api/convertContextController';
import * as admin from 'firebase-admin';

const TARGET_REPORTING_CURRENCY = 'SAR';

// --- NEW ---: Helper function to get the real client IP from Zid's webhook headers.
function getClientIpFromWebhook(req: Request): string | undefined {
    const ipHeaders = ['x-forwarded-for', 'x-real-ip', 'true-client-ip'];
    for (const header of ipHeaders) {
        const ip = req.headers[header];
        if (typeof ip === 'string') {
            return ip.split(',')[0].trim();
        }
    }
    return req.ip || req.socket.remoteAddress;
}


export const zidOrderEventsWebhookController = async (req: Request, res: Response) => {
    const secretToken = process.env.ZID_WEBHOOK_SECRET_TOKEN;
    const providedToken = req.query.token;

    if (!secretToken || providedToken !== secretToken) {
        console.warn('[SECURITY] Webhook request rejected. Invalid or missing token.');
        return res.status(403).send("Forbidden: Invalid token.");
    }
    res.status(200).json({ message: "Webhook received and validated. Processing in background." });

    try {
        // --- MODIFIED ---: Capture the client IP from the webhook request itself.
        const webhookClientIp = getClientIpFromWebhook(req);

        // --- PRESERVED ---: Your temporary logging block is untouched.
        console.log("\n\n================================================================");
        console.log("=        STARTING RAW ZID WEBHOOK PAYLOAD INSPECTION       =");
        console.log("================================================================");
        console.log(`Received at: ${new Date().toISOString()}`);
        console.log("--- HEADERS ---");
        console.log(JSON.stringify(req.headers, null, 2));
        console.log("--- RAW BODY ---");
        console.log(req.body);
        console.log("--- PARSED BODY (as JSON) ---");
        console.log(JSON.stringify(typeof req.body === 'string' ? JSON.parse(req.body) : req.body, null, 2));
        console.log("================================================================");
        console.log("=         ENDING RAW ZID WEBHOOK PAYLOAD INSPECTION        =");
        console.log("================================================================");
        
        let zidOrder;
        if (typeof req.body === 'string') {
            zidOrder = JSON.parse(req.body);
        } else {
            zidOrder = req.body;
        }
        
        const eventType = 'order.create';
        console.log(`[SUCCESS] Webhook request validated for event: ${eventType}`);
        if (!zidOrder || !zidOrder.id) {
            console.error("Webhook payload did not contain a valid order ID. Body:", zidOrder);
            return;
        }

        const convertGoalId = parseInt(process.env.CONVERT_GOAL_ID_FOR_PURCHASE!, 10);
        const orderLogPrefix = `[ZidOrder ${zidOrder.id}, Cust ${zidOrder.customer?.id || 'GUEST'}]`;
        console.log(`--- ${orderLogPrefix} [WEBHOOK] Processing for Convert (Goal ID: ${convertGoalId}) ---`);

        const zidCustomerId = zidOrder.customer?.id?.toString();
        const zidOrderIdKey = `orderctx_${zidOrder.id}`;

        if (!zidCustomerId) {
            console.warn(`${orderLogPrefix} [WEBHOOK] Zid Customer ID missing. This is a GUEST order.`);
        }

        let storedContext: NormalizedBucketingInfo | null | undefined = undefined;
        let attributionSource = 'No Context';

        // ==========================================================================================
        // === LOOKUP LOGIC: PRESERVED ORIGINAL FLOW, WITH HEURISTIC ADDED AS FINAL FALLBACK      ===
        // ==========================================================================================

        // 1. Try fetching from Firestore by zidCustomerId (for logged-in users)
        if (zidCustomerId) {
            const firestoreData = await getContextByZidCustomerId(zidCustomerId);
            if (firestoreData) {
                attributionSource = 'Firestore (by zidCustomerId)';
                storedContext = { /* ... normalization logic ... */ 
                    convertVisitorId: firestoreData.convertVisitorId,
                    zidCustomerId: firestoreData.zidCustomerId ?? undefined,
                    convertBucketing: firestoreData.convertBucketing.map(b => ({ experimentId: String(b.experienceId), variationId: String(b.variationId) })),
                    timestamp: (firestoreData.timestamp instanceof admin.firestore.Timestamp) ? firestoreData.timestamp.toMillis() : (firestoreData.timestamp as number),
                    zidPagePath: firestoreData.zidPagePath
                };
            }
        }

        // 2. If not found, try fetching from Firestore by specific order ID key (from older "signal" logic)
        if (!storedContext && zidOrderIdKey) {
            const firestoreData = await getContextByConvertVisitorId(zidOrderIdKey);
            if (firestoreData) {
                attributionSource = 'Firestore (by orderId context key)';
                storedContext = { /* ... normalization logic ... */ 
                    convertVisitorId: firestoreData.convertVisitorId,
                    zidCustomerId: firestoreData.zidCustomerId ?? undefined,
                    convertBucketing: firestoreData.convertBucketing.map(b => ({ experimentId: String(b.experienceId), variationId: String(b.variationId) })),
                    timestamp: (firestoreData.timestamp instanceof admin.firestore.Timestamp) ? firestoreData.timestamp.toMillis() : (firestoreData.timestamp as number),
                    zidPagePath: firestoreData.zidPagePath
                };
            }
        }

        // 3. If still not found, fallback to in-memory store
        if (!storedContext) {
            let inMemoryData: InMemoryStoredBucketingInfo | undefined = undefined;
            if (zidCustomerId) {
                inMemoryData = getInMemoryContext(zidCustomerId);
                if (inMemoryData) { attributionSource = 'In-Memory (by zidCustomerId)'; }
            }
            if (!inMemoryData && zidOrderIdKey) {
                inMemoryData = getInMemoryContext(zidOrderIdKey);
                if (inMemoryData) { attributionSource = 'In-Memory (by orderId context key)'; }
            }
            if (inMemoryData) {
                storedContext = { /* ... normalization logic ... */ 
                    convertVisitorId: inMemoryData.convertVisitorId,
                    zidCustomerId: undefined,
                    convertBucketing: inMemoryData.convertBucketing.map(b => ({ experimentId: b.experimentId, variationId: b.variationId })),
                    timestamp: inMemoryData.timestamp,
                    zidPagePath: inMemoryData.zidPagePath
                };
            }
        }
        
        // --- NEW STEP 4: HEURISTIC LOOKUP FOR GUESTS ---
        // If NO context has been found by any other method AND this is a guest order, try the heuristic lookup.
        if (!storedContext && !zidCustomerId && webhookClientIp) {
            console.log(`${orderLogPrefix} [WEBHOOK] No context found via direct keys. Attempting heuristic lookup for guest.`);
            const purchaseTimestamp = zidOrder.created_at ? new Date(zidOrder.created_at) : new Date();
            const firestoreData = await getHeuristicGuestContext(webhookClientIp, purchaseTimestamp);

            if (firestoreData) {
                attributionSource = 'Firestore (Heuristic: IP + Timestamp)';
                storedContext = { /* ... normalization logic ... */ 
                    convertVisitorId: firestoreData.convertVisitorId,
                    zidCustomerId: firestoreData.zidCustomerId ?? undefined,
                    convertBucketing: firestoreData.convertBucketing.map(b => ({ experimentId: String(b.experienceId), variationId: String(b.variationId) })),
                    timestamp: (firestoreData.timestamp instanceof admin.firestore.Timestamp) ? firestoreData.timestamp.toMillis() : (firestoreData.timestamp as number),
                    zidPagePath: firestoreData.zidPagePath
                };
            }
        }
        // ==========================================================================================

        const visitorIdForConvert = storedContext?.convertVisitorId || zidCustomerId || `zid-guest-${zidOrder.id}`;
        console.log(`${orderLogPrefix} Using VID for Convert payload: '${visitorIdForConvert}' (Source: ${attributionSource})`);

        // ... (The rest of your file from this point on remains exactly the same and is preserved) ...
        const eventsForConvert: Event[] = [];

        if (storedContext && storedContext.convertBucketing && Array.isArray(storedContext.convertBucketing) && storedContext.convertBucketing.length > 0) {
            console.log(`${orderLogPrefix} Context FOUND (${attributionSource}). Adding bucketing events.`);
            storedContext.convertBucketing.forEach(bucket => {
                eventsForConvert.push({
                    eventType: 'bucketing',
                    data: {
                        experienceId: bucket.experimentId,
                        variationId: bucket.variationId
                    }
                });
            });
        } else {
            console.log(`${orderLogPrefix} Context NOT found or empty bucketing data. Conversion will be unattributed regarding A/B test.`);
        }
        
        const finalOrderTotal = parseFloat(zidOrder.order_total || "0");
        const originalCurrencyCode = zidOrder.currency_code || TARGET_REPORTING_CURRENCY;
        const revenueForConvertAPI = await CurrencyService.convertToSAR(finalOrderTotal, originalCurrencyCode);

        let productsForPayload: ConvertProductType[] = []; 
        if (zidOrder.products && Array.isArray(zidOrder.products)) {
            productsForPayload = await Promise.all(
                zidOrder.products.map(async (product: ZidProduct) => {
                    const itemPrice = parseFloat(String(product.price)) || 0;
                    const convertedItemPrice = await CurrencyService.convertToSAR(itemPrice, originalCurrencyCode);
                    return {
                        productId: product.sku || String(product.id),
                        productName: product.name,
                        unitPrice: convertedItemPrice,
                        quantity: parseInt(String(product.quantity), 10) || 0
                    } as ConvertProductType;
                })
            );
        }

        eventsForConvert.push({
            eventType: 'conversion',
            data: {
                goalId: convertGoalId,
                transactionId: `zid-order-${zidOrder.id}`,
                revenue: revenueForConvertAPI,
                products: productsForPayload
            }
        });

        const visitorPayload: Visitor = {
            visitorId: visitorIdForConvert,
            events: eventsForConvert
        };

        console.log(`--- ${orderLogPrefix} [WEBHOOK] Sending to NEW v1/track METRICS API ---`);
        await ConvertApiService.sendMetricsV1ApiEvents(visitorPayload);
        console.log(`--- ${orderLogPrefix} [WEBHOOK] Finished NEW v1/track METRICS API call ---`);

        console.log(`--- ${orderLogPrefix} [WEBHOOK] Overall processing complete for Convert ---`);

    } catch (error) {
        const err = error as Error;
        console.error("[ERROR] Webhook processing failed after acknowledgement:", err.message, err.stack);
    }
};