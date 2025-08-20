// src/controllers/webhooks/zidOrderEventsController.ts
import { Request, Response } from 'express';
import { ConvertApiService, Event, Visitor, Product as ConvertProductType } from '../../services/convert-service';
import { CurrencyService } from '../../services/currency-service';
import { getContextByConvertVisitorId, getContextByZidCustomerId, getHeuristicGuestContext } from '../../services/firestore-service';
import { StoredBucketingInfo as FirestoreStoredBucketingInfo, StoredConvertBucketingEntry, ZidProduct, NormalizedBucketingInfo } from '../../types/index';
import { getStoredClientContext as getInMemoryContext, StoredBucketingInfo as InMemoryStoredBucketingInfo } from '../api/convertContextController';
import * as admin from 'firebase-admin';

const TARGET_REPORTING_CURRENCY = 'SAR';

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
        return res.status(403).send("Forbidden: Invalid token.");
    }
    res.status(200).json({ message: "Webhook received and validated. Processing in background." });

    try {
        const webhookClientIp = getClientIpFromWebhook(req);

        // --- PRESERVED: Your temporary logging block ---
        console.log("\n\n================================================================");
        console.log("=        STARTING RAW ZID WEBHOOK PAYLOAD INSPECTION       =");
        console.log("================================================================");
        console.log(`Received at: ${new Date().toISOString()}`);
        console.log("--- HEADERS ---");
        console.log(JSON.stringify(req.headers, null, 2));
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
        
        if (!zidOrder || !zidOrder.id) {
            console.error("Webhook payload did not contain a valid order ID.");
            return;
        }

        const convertGoalId = parseInt(process.env.CONVERT_GOAL_ID_FOR_PURCHASE!, 10);
        const orderLogPrefix = `[ZidOrder ${zidOrder.id}, Cust ${zidOrder.customer?.id || 'GUEST'}]`;
        console.log(`--- ${orderLogPrefix} [WEBHOOK] Processing for Convert (Goal ID: ${convertGoalId}) ---`);

        const zidCustomerId = zidOrder.customer?.id?.toString();
        
        let storedContext: NormalizedBucketingInfo | null | undefined = undefined;
        let attributionSource = 'No Context';

        // ==========================================================================================
        // === FINAL REFINED LOGIC: Use the `is_guest_customer` flag to determine the path        ===
        // ==========================================================================================
        
        // --- PATH 1: GUEST USER ---
        // We now explicitly check the flag Zid provides.
        if (zidOrder.is_guest_customer === 1) {
            console.log(`${orderLogPrefix} [WEBHOOK] Guest user detected via 'is_guest_customer' flag. Attempting heuristic lookup.`);
            if (webhookClientIp) {
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
            } else {
                 console.warn(`${orderLogPrefix} [WEBHOOK] Guest order detected, but no client IP was found in webhook headers. Cannot perform heuristic lookup.`);
            }
        }
        // --- PATH 2: LOGGED-IN USER ---
        // If it's not a guest, we use the reliable customer ID.
        else if (zidCustomerId) {
            console.log(`${orderLogPrefix} [WEBHOOK] Logged-in user detected. Performing direct lookup by zidCustomerId: ${zidCustomerId}`);
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

        // ==========================================================================================

        const visitorIdForConvert = storedContext?.convertVisitorId || zidCustomerId || `zid-guest-${zidOrder.id}`;
        console.log(`${orderLogPrefix} Using VID for Convert payload: '${visitorIdForConvert}' (Source: ${attributionSource})`);

        // ... (The rest of the file remains the same) ...
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