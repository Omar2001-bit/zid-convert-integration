// src/controllers/webhooks/zidOrderEventsController.ts
import { Request, Response } from 'express';
import { ConvertApiService, Event, Visitor, Product as ConvertProductType } from '../../services/convert-service';
import { CurrencyService } from '../../services/currency-service';
import { getContextByZidCustomerId, getContextByGuestContact, getNewestGuestContext, markContextConsumed } from '../../services/firestore-service';
import { getStoreConfig } from '../../services/store-config-service';
import { StoredBucketingInfo as FirestoreStoredBucketingInfo, NormalizedBucketingInfo, ZidProduct, ConvertCredentials } from '../../types/index';
import * as admin from 'firebase-admin';

const DEFAULT_REPORTING_CURRENCY = 'SAR';

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
    // Parse body first so we can extract store_id for config lookup
    let zidOrder: any;
    try {
        if (typeof req.body === 'string') {
            zidOrder = JSON.parse(req.body);
        } else {
            zidOrder = req.body;
        }
    } catch (e) {
        return res.status(400).send("Bad Request: Invalid JSON.");
    }

    // Zid webhooks wrap the order inside a "payload" key
    const webhookBody = zidOrder;
    const storeId = webhookBody?.store_id?.toString() || null;
    zidOrder = webhookBody?.payload || webhookBody; // Extract the actual order from payload, or use the body directly

    const providedToken = req.query.token as string;

    // Look up store config — fall back to env vars if no store config found
    const storeConfig = storeId ? await getStoreConfig(storeId) : null;

    // Validate webhook token: per-store token from config, or fallback to env var
    const expectedToken = storeConfig?.zidWebhookSecretToken || process.env.ZID_WEBHOOK_SECRET_TOKEN;
    if (!expectedToken || providedToken !== expectedToken) {
        return res.status(403).send("Forbidden: Invalid token.");
    }

    res.status(200).json({ message: "Webhook received and validated. Processing in background." });

    try {
        console.log("\n================================================================");
        console.log("=        ZID WEBHOOK RECEIVED - PROCESSING ORDER              =");
        console.log("================================================================");
        console.log(`Received at: ${new Date().toISOString()}`);
        console.log(`Store ID: ${storeId || 'N/A'} | Config: ${storeConfig ? storeConfig.storeName : 'ENV FALLBACK'}`);
        console.log(`Event: ${webhookBody?.event || 'N/A'}`);
        console.log("--- HEADERS ---");
        console.log(JSON.stringify(req.headers, null, 2));
        console.log("--- ORDER DATA ---");
        console.log(JSON.stringify(zidOrder, null, 2));
        console.log("================================================================");

        if (!zidOrder || !zidOrder.id) {
            console.error("Webhook payload did not contain a valid order ID.");
            return;
        }

        const zidCustomerId = zidOrder.customer?.id?.toString() || null;
        const isGuestUser = zidOrder.is_guest_customer === 1;
        const orderLogPrefix = `[ZidOrder ${zidOrder.id}, Store ${storeId || 'N/A'}, ${isGuestUser ? 'GUEST' : 'Cust ' + zidCustomerId}]`;

        // Get Convert credentials from store config or env vars
        const convertGoalId = storeConfig?.convertGoalIdForPurchase
            || parseInt(process.env.CONVERT_GOAL_ID_FOR_PURCHASE || '0', 10);

        const convertCredentials: ConvertCredentials | undefined = storeConfig ? {
            accountId: storeConfig.convertAccountId,
            projectId: storeConfig.convertProjectId,
            apiKeySecret: storeConfig.convertApiKeySecret
        } : undefined;

        const reportingCurrency = storeConfig?.reportingCurrency || DEFAULT_REPORTING_CURRENCY;

        console.log(`--- ${orderLogPrefix} [WEBHOOK] Processing for Convert (Goal ID: ${convertGoalId}, Currency: ${reportingCurrency}) ---`);

        // ========================================================================
        // CONTEXT LOOKUP: Two-path attribution
        // Use is_guest_customer flag (NOT customer.id presence — guests also have an ID)
        // All lookups filter by storeId for multi-tenant isolation
        // ========================================================================
        let storedContext: NormalizedBucketingInfo | null = null;
        let visitorIdForConvert: string;
        let attributionSource: string;

        if (!isGuestUser && zidCustomerId) {
            // === LOGGED-IN USER PATH ===
            console.log(`${orderLogPrefix} [WEBHOOK] Logged-in user detected. Looking up context by zidCustomerId.`);
            const firestoreData = await getContextByZidCustomerId(zidCustomerId, storeId || undefined);

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

            const guestEmail = zidOrder.customer?.email || zidOrder.customer_email || null;
            const guestPhone = zidOrder.customer?.mobile || zidOrder.customer?.phone || zidOrder.customer_phone || null;

            console.log(`${orderLogPrefix} [WEBHOOK] Guest contact info - Email: ${guestEmail || 'N/A'}, Phone: ${guestPhone || 'N/A'}`);

            let firestoreData: FirestoreStoredBucketingInfo | null = null;

            if (guestEmail || guestPhone) {
                firestoreData = await getContextByGuestContact(guestEmail, guestPhone, storeId || undefined);
            }

            if (firestoreData) {
                storedContext = normalizeContext(firestoreData);
                attributionSource = `Firestore (by guest ${guestEmail ? 'email' : 'phone'})`;
                visitorIdForConvert = storedContext.convertVisitorId;
                console.log(`${orderLogPrefix} [WEBHOOK] Context FOUND by guest contact. ConvertVisitorId: ${visitorIdForConvert}`);
                await markContextConsumed(storedContext.convertVisitorId);
            } else {
                console.log(`${orderLogPrefix} [WEBHOOK] No context found by email/phone. Trying newest guest context fallback.`);
                firestoreData = await getNewestGuestContext(30, storeId || undefined);

                if (firestoreData) {
                    storedContext = normalizeContext(firestoreData);
                    attributionSource = 'Firestore (newest guest context fallback)';
                    visitorIdForConvert = storedContext.convertVisitorId;
                    console.log(`${orderLogPrefix} [WEBHOOK] Fallback context FOUND. ConvertVisitorId: ${visitorIdForConvert}`);
                    await markContextConsumed(storedContext.convertVisitorId);
                } else {
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

        const finalOrderTotal = parseFloat(zidOrder.order_total || "0");
        const originalCurrencyCode = zidOrder.currency_code || reportingCurrency;
        const revenueForConvertAPI = await CurrencyService.convertTo(finalOrderTotal, originalCurrencyCode, reportingCurrency);

        let productsForPayload: ConvertProductType[] = [];
        if (zidOrder.products && Array.isArray(zidOrder.products)) {
            productsForPayload = await Promise.all(
                zidOrder.products.map(async (product: ZidProduct) => {
                    const itemPrice = parseFloat(String(product.price)) || 0;
                    const convertedItemPrice = await CurrencyService.convertTo(itemPrice, originalCurrencyCode, reportingCurrency);
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
        // SEND TO CONVERT — two calls, using per-store credentials
        // ========================================================================
        const visitorPayload: Visitor = {
            visitorId: visitorIdForConvert,
            events: eventsForConvert
        };

        const experienceIds = storedContext?.convertBucketing?.map(b => b.experimentId) || [];
        const variationIds = storedContext?.convertBucketing?.map(b => b.variationId) || [];

        let totalProductsCount = 0;
        if (zidOrder.products && Array.isArray(zidOrder.products)) {
            totalProductsCount = zidOrder.products.reduce((sum: number, p: ZidProduct) => {
                return sum + (parseInt(String(p.quantity), 10) || 0);
            }, 0);
        }

        console.log(`--- ${orderLogPrefix} [WEBHOOK] Sending to Convert v1/track API ---`);
        await ConvertApiService.sendMetricsV1ApiEvents(visitorPayload, convertCredentials);
        console.log(`--- ${orderLogPrefix} [WEBHOOK] v1/track API call complete ---`);

        console.log(`--- ${orderLogPrefix} [WEBHOOK] Sending transaction data via REST POST tracking ---`);
        console.log(`${orderLogPrefix} Revenue: ${revenueForConvertAPI} SAR, Products count: ${totalProductsCount}`);
        await ConvertApiService.sendTrackingWithTransaction({
            visitorId: visitorIdForConvert,
            experienceIds,
            variationIds,
            goalId: convertGoalId,
            revenue: revenueForConvertAPI,
            productsCount: totalProductsCount
        }, convertCredentials);
        console.log(`--- ${orderLogPrefix} [WEBHOOK] REST POST tracking call complete ---`);
        console.log(`--- ${orderLogPrefix} [WEBHOOK] Processing complete ---`);

    } catch (error) {
        const err = error as Error;
        console.error("[ERROR] Webhook processing failed after acknowledgement:", err.message, err.stack);
    }
};
