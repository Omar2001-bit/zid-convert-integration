// src/controllers/webhooks/zidOrderEventsController.ts
import { Request, Response } from 'express';
// Ensure all necessary interfaces for the new API calls are imported
import { ConvertApiService, Event, Visitor, Product as ConvertProductType } from '../../services/convert-service';
import { CurrencyService } from '../../services/currency-service';
// Added: Import Firestore service functions
import { getContextByConvertVisitorId, getContextByZidCustomerId } from '../../services/firestore-service';
// Corrected: Import FirestoreStoredBucketingInfo, StoredConvertBucketingEntry, ZidProduct, AND NormalizedBucketingInfo from the global types file
import { StoredBucketingInfo as FirestoreStoredBucketingInfo, StoredConvertBucketingEntry, ZidProduct, NormalizedBucketingInfo } from '../../types/index';
// Import the *synchronous* in-memory context getter and store for fallback, as requested
import { getStoredClientContext as getInMemoryContext, StoredBucketingInfo as InMemoryStoredBucketingInfo } from '../api/convertContextController';
import * as admin from 'firebase-admin'; // Added: Import admin to handle Firestore Timestamps

const TARGET_REPORTING_CURRENCY = 'SAR';

// ZidProduct interface is now imported from src/types/index.d.ts
// interface ZidProduct {
//     id: string | number;
//     sku?: string;
//     name: string;
//     price: number | string;
//     quantity: number | string;
// }

export const zidOrderEventsWebhookController = async (req: Request, res: Response) => {
    const secretToken = process.env.ZID_WEBHOOK_SECRET_TOKEN;
    const providedToken = req.query.token;

    if (!secretToken || providedToken !== secretToken) {
        console.warn('[SECURITY] Webhook request rejected. Invalid or missing token.');
        return res.status(403).send("Forbidden: Invalid token.");
    }

    res.status(200).json({ message: "Webhook received and validated. Processing in background." });

    try {
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

        const orderLogPrefix = `[ZidOrder ${zidOrder.id}, Cust ${zidOrder.customer?.id || 'N/A'}]`;
        console.log(`--- ${orderLogPrefix} [WEBHOOK] Processing for Convert (Goal ID: ${convertGoalId}) ---`);

        const zidCustomerId = zidOrder.customer?.id?.toString();
        const zidOrderIdKey = `orderctx_${zidOrder.id}`; // Key used for purchase signal context

        if (!zidCustomerId) {
            console.warn(`${orderLogPrefix} [WEBHOOK] Zid Customer ID missing. Attempting lookup with order ID context key '${zidOrderIdKey}'.`);
        }

        // FIX: The type for storedContext is now NormalizedBucketingInfo or null/undefined
        let storedContext: NormalizedBucketingInfo | null | undefined = undefined;
        let attributionSource = 'No Context';
        let visitorIdForConvert: string;

        // ==========================================================================================
        // === MODIFIED: Prioritize Firestore lookup, then fallback to in-memory, normalizing data ===
        // ==========================================================================================

        // 1. Try fetching from Firestore by zidCustomerId
        if (zidCustomerId) {
            const firestoreData = await getContextByZidCustomerId(zidCustomerId);
            if (firestoreData) {
                attributionSource = 'Firestore (by zidCustomerId)';
                storedContext = {
                    convertVisitorId: firestoreData.convertVisitorId,
                    // --- FIX 1 of 2: Convert null to undefined to match the expected type ---
                    zidCustomerId: firestoreData.zidCustomerId ?? undefined,
                    // Map StoredConvertBucketingEntry (numbers) to {experimentId: string, variationId: string}
                    convertBucketing: firestoreData.convertBucketing.map(b => ({
                        experimentId: String(b.experienceId),
                        variationId: String(b.variationId)
                    })),
                    // Convert Firestore Timestamp to number (milliseconds)
                    timestamp: (firestoreData.timestamp instanceof admin.firestore.Timestamp) ? firestoreData.timestamp.toMillis() : (firestoreData.timestamp as number),
                    zidPagePath: firestoreData.zidPagePath
                };
            }
        }

        // 2. If not found by zidCustomerId, try fetching from Firestore by specific order ID key
        if (!storedContext && zidOrderIdKey) {
            const firestoreData = await getContextByConvertVisitorId(zidOrderIdKey);
            if (firestoreData) {
                attributionSource = 'Firestore (by orderId context key)';
                storedContext = {
                    convertVisitorId: firestoreData.convertVisitorId,
                    // --- FIX 2 of 2: Convert null to undefined to match the expected type ---
                    zidCustomerId: firestoreData.zidCustomerId ?? undefined,
                    // Map StoredConvertBucketingEntry (numbers) to {experimentId: string, variationId: string}
                    convertBucketing: firestoreData.convertBucketing.map(b => ({
                        experimentId: String(b.experienceId),
                        variationId: String(b.variationId)
                    })),
                    // Convert Firestore Timestamp to number (milliseconds)
                    timestamp: (firestoreData.timestamp instanceof admin.firestore.Timestamp) ? firestoreData.timestamp.toMillis() : (firestoreData.timestamp as number),
                    zidPagePath: firestoreData.zidPagePath
                };
            }
        }

        // 3. If still not found in Firestore, fallback to in-memory store (zidCustomerId first, then order ID key)
        if (!storedContext) {
            let inMemoryData: InMemoryStoredBucketingInfo | undefined = undefined;
            if (zidCustomerId) {
                inMemoryData = getInMemoryContext(zidCustomerId);
                if (inMemoryData) {
                    attributionSource = 'In-Memory (by zidCustomerId)';
                }
            }
            if (!inMemoryData && zidOrderIdKey) {
                inMemoryData = getInMemoryContext(zidOrderIdKey);
                if (inMemoryData) {
                    attributionSource = 'In-Memory (by orderId context key)';
                }
            }

            if (inMemoryData) {
                storedContext = {
                    convertVisitorId: inMemoryData.convertVisitorId,
                    zidCustomerId: undefined, // In-memory interface doesn't explicitly store this
                    convertBucketing: inMemoryData.convertBucketing.map(b => ({ // Already strings, but mapping ensures consistency
                        experimentId: b.experimentId,
                        variationId: b.variationId
                    })),
                    timestamp: inMemoryData.timestamp, // Already a number
                    zidPagePath: inMemoryData.zidPagePath
                };
            }
        }
        // ==========================================================================================

        // Determine the visitorId for Convert API based on found context or fallback to zidCustomerId
        visitorIdForConvert = storedContext?.convertVisitorId || zidCustomerId || `zid-guest-${zidOrder.id}`;
        console.log(`${orderLogPrefix} Using VID for Convert payload: '${visitorIdForConvert}' (Source: ${attributionSource})`);

        const eventsForConvert: Event[] = [];

        // Add bucketing events if context was found AND it contains bucketing data
        if (storedContext && storedContext.convertBucketing && Array.isArray(storedContext.convertBucketing) && storedContext.convertBucketing.length > 0) {
            console.log(`${orderLogPrefix} Context FOUND (${attributionSource}). Adding bucketing events.`);
            storedContext.convertBucketing.forEach(bucket => {
                // These properties are now guaranteed to be strings from the normalization step into NormalizedBucketingInfo
                eventsForConvert.push({
                    eventType: 'bucketing',
                    data: {
                        experienceId: bucket.experimentId, // Now correctly typed as string
                        variationId: bucket.variationId    // Now correctly typed as string
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
                zidOrder.products.map(async (product: ZidProduct) => { // Explicitly type product
                    const itemPrice = parseFloat(String(product.price)) || 0;
                    const convertedItemPrice = await CurrencyService.convertToSAR(itemPrice, originalCurrencyCode);
                    return {
                        productId: product.sku || String(product.id),
                        productName: product.name,
                        unitPrice: convertedItemPrice,
                        quantity: parseInt(String(product.quantity), 10) || 0
                    } as ConvertProductType; // Explicit type assertion
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