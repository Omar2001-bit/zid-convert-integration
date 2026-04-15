// src/controllers/webhooks/zidOrderEventsController.ts
import { Request, Response } from 'express';
import { ConvertApiService, Event, Visitor, Product as ConvertProductType } from '../../services/convert-service';
import { CurrencyService } from '../../services/currency-service';
import { getContextByZidCustomerId, getContextByGuestContact, getNewestGuestContext, markContextConsumed } from '../../services/firestore-service';
import { StoredBucketingInfo as FirestoreStoredBucketingInfo, NormalizedBucketingInfo, ZidProduct } from '../../types/index';
import * as admin from 'firebase-admin';

const TARGET_REPORTING_CURRENCY = 'SAR';

function getClientIpFromWebhook(req: Request): string | undefined {
    const ipHeaders = ['x-forwarded-for', 'x-real-ip', 'true-client-ip', 'cf-connecting-ip', 'x-client-ip'];
    for (const header of ipHeaders) {
        const ip = req.headers[header];
        if (typeof ip === 'string') {
            const firstIp = ip.split(',')[0].trim();
            if (firstIp && (firstIp.includes('.') || firstIp.includes(':'))) {
                return firstIp;
            }
        }
    }
    return req.ip || req.socket.remoteAddress;
}

function normalizeContext(firestoreData: FirestoreStoredBucketingInfo): NormalizedBucketingInfo {
    return {
        convertVisitorId: firestoreData.convertVisitorId,
        zidCustomerId: firestoreData.zidCustomerId ?? undefined,
        convertBucketing: firestoreData.convertBucketing.map(b => ({
            experimentId: String(b.experienceId),
            variationId: String(b.variationId)
        })),
        timestamp: (firestoreData.timestamp instanceof admin.firestore.Timestamp)
            ? firestoreData.timestamp.toMillis()
            : (firestoreData.timestamp as number),
        zidPagePath: firestoreData.zidPagePath
    };
}

export const zidOrderEventsWebhookController = async (req: Request, res: Response) => {
    const secretToken = process.env.ZID_WEBHOOK_SECRET_TOKEN;
    const providedToken = req.query.token;

    if (!secretToken || providedToken !== secretToken) {
        return res.status(403).send("Forbidden: Invalid token.");
    }
    res.status(200).json({ message: "Webhook received and validated. Processing in background." });

    try {
        console.log("\n================================================================");
        console.log("=        ZID WEBHOOK RECEIVED - PROCESSING ORDER              =");
        console.log("================================================================");
        console.log(`Received at: ${new Date().toISOString()}`);
        console.log("--- HEADERS ---");
        console.log(JSON.stringify(req.headers, null, 2));
        console.log("--- PARSED BODY (as JSON) ---");
        console.log(JSON.stringify(typeof req.body === 'string' ? JSON.parse(req.body) : req.body, null, 2));
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

        const zidCustomerId = zidOrder.customer?.id?.toString() || null;
        const isGuestUser = zidOrder.is_guest_customer === 1;
        const orderLogPrefix = `[ZidOrder ${zidOrder.id}, ${isGuestUser ? 'GUEST' : 'Cust ' + zidCustomerId}]`;
        const convertGoalId = parseInt(process.env.CONVERT_GOAL_ID_FOR_PURCHASE!, 10);

        console.log(`--- ${orderLogPrefix} [WEBHOOK] Processing for Convert (Goal ID: ${convertGoalId}) ---`);

        // ========================================================================
        // CONTEXT LOOKUP: Two-path attribution
        // Use is_guest_customer flag (NOT customer.id presence — guests also have an ID)
        // ========================================================================
        let storedContext: NormalizedBucketingInfo | null = null;
        let visitorIdForConvert: string;
        let attributionSource: string;

        if (!isGuestUser && zidCustomerId) {
            // === LOGGED-IN USER PATH ===
            console.log(`${orderLogPrefix} [WEBHOOK] Logged-in user detected. Looking up context by zidCustomerId.`);
            const firestoreData = await getContextByZidCustomerId(zidCustomerId);

            if (firestoreData) {
                storedContext = normalizeContext(firestoreData);
                attributionSource = 'Firestore (by zidCustomerId)';
                console.log(`${orderLogPrefix} [WEBHOOK] Context FOUND for logged-in user. ConvertVisitorId: ${storedContext.convertVisitorId}`);
            } else {
                attributionSource = 'Customer ID (no context found)';
                console.log(`${orderLogPrefix} [WEBHOOK] No context found for logged-in user. Conversion will be unattributed to A/B test.`);
            }
            visitorIdForConvert = zidCustomerId;

        } else {
            // === GUEST USER PATH ===
            console.log(`${orderLogPrefix} [WEBHOOK] Guest user detected. Attempting email/phone lookup.`);

            // Primary: Match by guest email/phone from webhook
            const guestEmail = zidOrder.customer?.email || zidOrder.customer_email || null;
            const guestPhone = zidOrder.customer?.mobile || zidOrder.customer?.phone || zidOrder.customer_phone || null;

            console.log(`${orderLogPrefix} [WEBHOOK] Guest contact info - Email: ${guestEmail || 'N/A'}, Phone: ${guestPhone || 'N/A'}`);

            let firestoreData: FirestoreStoredBucketingInfo | null = null;

            if (guestEmail || guestPhone) {
                firestoreData = await getContextByGuestContact(guestEmail, guestPhone);
            }

            if (firestoreData) {
                storedContext = normalizeContext(firestoreData);
                attributionSource = `Firestore (by guest ${guestEmail ? 'email' : 'phone'})`;
                visitorIdForConvert = storedContext.convertVisitorId;
                console.log(`${orderLogPrefix} [WEBHOOK] Context FOUND by guest contact. ConvertVisitorId: ${visitorIdForConvert}`);
                // Mark consumed to prevent double-attribution
                await markContextConsumed(storedContext.convertVisitorId);
            } else {
                // Fallback: newest unconsumed guest context within 30 minutes
                console.log(`${orderLogPrefix} [WEBHOOK] No context found by email/phone. Trying newest guest context fallback.`);
                firestoreData = await getNewestGuestContext(30);

                if (firestoreData) {
                    storedContext = normalizeContext(firestoreData);
                    attributionSource = 'Firestore (newest guest context fallback)';
                    visitorIdForConvert = storedContext.convertVisitorId;
                    console.log(`${orderLogPrefix} [WEBHOOK] Fallback context FOUND. ConvertVisitorId: ${visitorIdForConvert}`);
                    await markContextConsumed(storedContext.convertVisitorId);
                } else {
                    // No context found at all — send unattributed conversion
                    attributionSource = 'Fallback (no guest context found)';
                    visitorIdForConvert = `zid-guest-${zidOrder.id}`;
                    console.log(`${orderLogPrefix} [WEBHOOK] No guest context found at all. Using fallback ID: ${visitorIdForConvert}`);
                }
            }
        }

        console.log(`${orderLogPrefix} Using VID for Convert: '${visitorIdForConvert}' (Source: ${attributionSource})`);

        // ========================================================================
        // BUILD EVENTS
        // ========================================================================
        const eventsForConvert: Event[] = [];

        // Bucketing events (from stored context)
        if (storedContext?.convertBucketing?.length) {
            console.log(`${orderLogPrefix} Context found (${attributionSource}). Adding ${storedContext.convertBucketing.length} bucketing event(s).`);
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
            console.log(`${orderLogPrefix} No bucketing data. Conversion will be unattributed to A/B test.`);
        }

        // Conversion event
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

        // ========================================================================
        // SEND TO CONVERT — two calls:
        // 1. v1/track for bucketing + goal hit
        // 2. REST POST tracking for revenue + product count (tr event)
        // ========================================================================
        const visitorPayload: Visitor = {
            visitorId: visitorIdForConvert,
            events: eventsForConvert
        };

        // Collect experience/variation IDs for the transaction call
        const experienceIds = storedContext?.convertBucketing?.map(b => b.experimentId) || [];
        const variationIds = storedContext?.convertBucketing?.map(b => b.variationId) || [];

        // Calculate total product count
        let totalProductsCount = 0;
        if (zidOrder.products && Array.isArray(zidOrder.products)) {
            totalProductsCount = zidOrder.products.reduce((sum: number, p: ZidProduct) => {
                return sum + (parseInt(String(p.quantity), 10) || 0);
            }, 0);
        }

        console.log(`--- ${orderLogPrefix} [WEBHOOK] Sending to Convert v1/track API ---`);
        await ConvertApiService.sendMetricsV1ApiEvents(visitorPayload);
        console.log(`--- ${orderLogPrefix} [WEBHOOK] v1/track API call complete ---`);

        // Send transaction data via REST POST tracking endpoint
        console.log(`--- ${orderLogPrefix} [WEBHOOK] Sending transaction data via REST POST tracking ---`);
        console.log(`${orderLogPrefix} Revenue: ${revenueForConvertAPI} SAR, Products count: ${totalProductsCount}`);
        await ConvertApiService.sendTrackingWithTransaction({
            visitorId: visitorIdForConvert,
            experienceIds,
            variationIds,
            goalId: convertGoalId,
            revenue: revenueForConvertAPI,
            productsCount: totalProductsCount
        });
        console.log(`--- ${orderLogPrefix} [WEBHOOK] REST POST tracking call complete ---`);
        console.log(`--- ${orderLogPrefix} [WEBHOOK] Processing complete ---`);

    } catch (error) {
        const err = error as Error;
        console.error("[ERROR] Webhook processing failed after acknowledgement:", err.message, err.stack);
    }
};
