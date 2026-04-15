// src/controllers/webhooks/zidOrderEventsController.ts
import { Request, Response } from 'express';
import { ConvertApiService, Event, Visitor, Product as ConvertProductType } from '../../services/convert-service';
import { CurrencyService } from '../../services/currency-service';
import { getContextByConvertVisitorId, getContextByZidCustomerId, getHeuristicGuestContext, getContextByZidOrderId } from '../../services/firestore-service';
import { StoredBucketingInfo as FirestoreStoredBucketingInfo, StoredConvertBucketingEntry, ZidProduct, NormalizedBucketingInfo } from '../../types/index';
import { getStoredClientContext as getInMemoryContext, StoredBucketingInfo as InMemoryStoredBucketingInfo } from '../api/convertContextController';
import * as admin from 'firebase-admin';

const TARGET_REPORTING_CURRENCY = 'SAR';

function getClientIpFromWebhook(req: Request): string | undefined {
    const ipHeaders = ['x-forwarded-for', 'x-real-ip', 'true-client-ip', 'cf-connecting-ip', 'x-client-ip'];
    for (const header of ipHeaders) {
        const ip = req.headers[header];
        if (typeof ip === 'string') {
            // x-forwarded-for can contain multiple IPs: "client, proxy1, proxy2"
            // Take the first (leftmost) IP which is the original client
            const firstIp = ip.split(',')[0].trim();
            // Validate it looks like an IP address (basic check)
            if (firstIp && (firstIp.includes('.') || firstIp.includes(':'))) {
                return firstIp;
            }
        }
    }
    // Fallback to Express's req.ip or socket remote address
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

        // Define orderLogPrefix early so it can be used in debug logs
        const orderLogPrefix = `[ZidOrder ${zidOrder.id}, Cust ${zidOrder.customer?.id || 'GUEST'}]`;
        const convertGoalId = parseInt(process.env.CONVERT_GOAL_ID_FOR_PURCHASE!, 10);

        // --- NEW: Extract convertVisitorId from order notes ---
        let convertVisitorIdFromNotes: string | null = null;
        console.log(`${orderLogPrefix} [DEBUG] Raw order notes received: "${zidOrder.notes}"`); // Debug log
        if (zidOrder.notes && typeof zidOrder.notes === 'string') {
            console.log(`${orderLogPrefix} [DEBUG] Notes field exists and is string. Length: ${zidOrder.notes.length}`); // Debug log
            // Look for the pattern "convert_cid:XXXXX" in the notes
            const cidMatch = zidOrder.notes.match(/convert_cid:([^\s]+)/);
            if (cidMatch && cidMatch[1]) {
                convertVisitorIdFromNotes = cidMatch[1];
                console.log(`[WEBHOOK] Found convertVisitorId in order notes: ${convertVisitorIdFromNotes}`);
            } else {
                console.log(`${orderLogPrefix} [DEBUG] No convert_cid pattern found in notes. Full notes: "${zidOrder.notes}"`); // Debug log
            }
        } else {
            console.log(`${orderLogPrefix} [DEBUG] No valid notes field in order object or not a string`); // Debug log
        }

        // --- MODIFIED: Extract convertVisitorId from customer_note field ---
        // This is where the modified script injects the UUID
        let convertVisitorIdFromCustomerNote: string | null = null;
        if (zidOrder.customer_note && typeof zidOrder.customer_note === 'string') {
            console.log(`${orderLogPrefix} [DEBUG] Customer note received: "${zidOrder.customer_note}"`); // Debug log
            const cidMatch = zidOrder.customer_note.match(/convert_cid:([^\s]+)/);
            if (cidMatch && cidMatch[1]) {
                convertVisitorIdFromCustomerNote = cidMatch[1];
                console.log(`[WEBHOOK] Found convertVisitorId in customer_note: ${convertVisitorIdFromCustomerNote}`);
            } else {
                console.log(`${orderLogPrefix} [DEBUG] No convert_cid pattern found in customer_note. Full note: "${zidOrder.customer_note}"`); // Debug log
            }
        } else {
            console.log(`${orderLogPrefix} [DEBUG] No customer_note field in order object`); // Debug log
        }

        // --- Use customer_note UUID if available, otherwise fall back to notes UUID ---
        if (convertVisitorIdFromCustomerNote) {
            convertVisitorIdFromNotes = convertVisitorIdFromCustomerNote;
            console.log(`[WEBHOOK] Using convertVisitorId from customer_note: ${convertVisitorIdFromNotes}`);
        }

        console.log(`--- ${orderLogPrefix} [WEBHOOK] Processing for Convert (Goal ID: ${convertGoalId}) ---`);

        const zidCustomerId = zidOrder.customer?.id?.toString();

        let storedContext: NormalizedBucketingInfo | null | undefined = undefined;
        let attributionSource = 'No Context';

        // ==========================================================================================
        // === NEW PRIORITY: Check for convertVisitorId in order notes first                     ===
        // ==========================================================================================

        // --- PATH 0: CART-NOTE INJECTION STRATEGY (HIGHEST PRIORITY) ---
        if (convertVisitorIdFromNotes) {
            console.log(`${orderLogPrefix} [WEBHOOK] Using cart-note injection strategy. Looking up context by convertVisitorId: ${convertVisitorIdFromNotes}`);
            const firestoreData = await getContextByConvertVisitorId(convertVisitorIdFromNotes);
            if (firestoreData) {
                attributionSource = 'Firestore (by convertVisitorId from cart note)';
                storedContext = {
                    convertVisitorId: firestoreData.convertVisitorId,
                    zidCustomerId: firestoreData.zidCustomerId ?? undefined,
                    convertBucketing: firestoreData.convertBucketing.map(b => ({ experimentId: String(b.experienceId), variationId: String(b.variationId) })),
                    timestamp: (firestoreData.timestamp instanceof admin.firestore.Timestamp) ? firestoreData.timestamp.toMillis() : (firestoreData.timestamp as number),
                    zidPagePath: firestoreData.zidPagePath
                };
            } else {
                console.log(`${orderLogPrefix} [WEBHOOK] No context found for convertVisitorId from cart note. Will attempt other lookup methods.`);
                // If not found, we'll fall back to the other methods below
            }
        }

        // --- PATH 1: GUEST USER (HEURISTIC LOOKUP) ---
        // Only attempt if we haven't already found context via cart-note injection
        if (!storedContext && zidOrder.is_guest_customer === 1) {
            console.log(`${orderLogPrefix} [WEBHOOK] Guest user detected via 'is_guest_customer' flag. Attempting heuristic lookup.`);
            if (webhookClientIp) {
                const purchaseTimestamp = zidOrder.created_at ? new Date(zidOrder.created_at) : new Date();
                const firestoreData = await getHeuristicGuestContext(webhookClientIp, purchaseTimestamp);

                if (firestoreData) {
                    attributionSource = 'Firestore (Heuristic: IP + Timestamp)';
                    storedContext = {
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
        // Only attempt if we haven't already found context via cart-note injection
        else if (!storedContext && zidCustomerId) {
            console.log(`${orderLogPrefix} [WEBHOOK] Logged-in user detected. Performing direct lookup by zidCustomerId: ${zidCustomerId}`);
            const firestoreData = await getContextByZidCustomerId(zidCustomerId);
            if (firestoreData) {
                attributionSource = 'Firestore (by zidCustomerId)';
                storedContext = {
                    convertVisitorId: firestoreData.convertVisitorId,
                    zidCustomerId: firestoreData.zidCustomerId ?? undefined,
                    convertBucketing: firestoreData.convertBucketing.map(b => ({ experimentId: String(b.experienceId), variationId: String(b.variationId) })),
                    timestamp: (firestoreData.timestamp instanceof admin.firestore.Timestamp) ? firestoreData.timestamp.toMillis() : (firestoreData.timestamp as number),
                    zidPagePath: firestoreData.zidPagePath
                };
            }
        }

        // --- PATH 3: ORDER ID LOOKUP (FALLBACK FOR GUESTS) ---
        // Try looking up by order ID if still no context found (from /api/signal-purchase)
        if (!storedContext && zidOrder.id) {
            console.log(`${orderLogPrefix} [WEBHOOK] Attempting order ID lookup as fallback.`);
            const firestoreData = await getContextByZidOrderId(String(zidOrder.id));
            if (firestoreData) {
                attributionSource = 'Firestore (by zidOrderId)';
                storedContext = {
                    convertVisitorId: firestoreData.convertVisitorId,
                    zidCustomerId: firestoreData.zidCustomerId ?? undefined,
                    convertBucketing: firestoreData.convertBucketing.map(b => ({ experimentId: String(b.experienceId), variationId: String(b.variationId) })),
                    timestamp: (firestoreData.timestamp instanceof admin.firestore.Timestamp) ? firestoreData.timestamp.toMillis() : (firestoreData.timestamp as number),
                    zidPagePath: firestoreData.zidPagePath
                };
                console.log(`${orderLogPrefix} [WEBHOOK] Found context by order ID: ${zidOrder.id}. Visitor: ${storedContext.convertVisitorId}`);
            } else {
                console.log(`${orderLogPrefix} [WEBHOOK] No context found by order ID.`);
            }
        }

        // ==========================================================================================

        // Use convertVisitorId from cart note if available, otherwise fall back to stored context or other identifiers
        const visitorIdForConvert = convertVisitorIdFromNotes || storedContext?.convertVisitorId || zidCustomerId || `zid-guest-${zidOrder.id}`;
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