"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zidAuthCallbackController = void 0;
const zid_service_1 = require("../../../services/zid-service");
// Updated import: Removed ConvertTrackPayload as it's no longer used, kept modern interfaces
const convert_service_1 = require("../../../services/convert-service");
const convertContextController_1 = require("../../api/convertContextController");
const currency_service_1 = require("../../../services/currency-service");
const TARGET_REPORTING_CURRENCY = 'SAR';
const zidAuthCallbackController = async (req, res) => {
    var _a, _b, _c;
    const code = req.query.code;
    if (!code) {
        console.error("ZidAuthCallback: Authorization code not provided.");
        return res.status(400).send("Authorization code is required.");
    }
    try {
        console.log(`ZidAuthCallback: Received authorization code.`);
        const tokens = await zid_service_1.ZidApiService.getTokensByCode(code);
        if (!tokens || !tokens.access_token || !tokens.authorization) {
            console.error("ZidAuthCallback: Failed to obtain necessary tokens from Zid.", tokens);
            return res.status(500).send("Failed to exchange code for complete tokens with Zid.");
        }
        const xManagerToken = tokens.access_token;
        const authorizationJwt = tokens.authorization;
        console.log("ZidAuthCallback: Tokens obtained successfully.");
        try {
            if (!process.env.MY_BACKEND_URL) {
                console.error("ZidAuthCallback: MY_BACKEND_URL not set in .env. Cannot create Zid webhook.");
            }
            else {
                const secretToken = process.env.ZID_WEBHOOK_SECRET_TOKEN;
                if (!secretToken) {
                    console.error("ZidAuthCallback: ZID_WEBHOOK_SECRET_TOKEN is not set in .env. Cannot create secure webhook. Please configure it.");
                }
                else {
                    const webhookTargetUrl = `${process.env.MY_BACKEND_URL}/webhooks/zid/order-events?token=${secretToken}`;
                    const webhookPayload = {
                        event: "order.create",
                        target_url: webhookTargetUrl,
                        original_id: "zid_convert_order_create_integration_v1",
                        subscriber: "Zid-Convert Integration App"
                    };
                    console.log(`ZidAuthCallback: Preparing to create/update SECURE Zid webhook for order.create to target: ${webhookTargetUrl}`);
                    await zid_service_1.ZidApiService.createWebhookSubscription(xManagerToken, authorizationJwt, webhookPayload);
                }
            }
        }
        catch (webhookError) {
            const err = webhookError;
            console.error("ZidAuthCallback: Error during Zid webhook subscription:", err.message);
        }
        try {
            console.log("ZidAuthCallback: Attempting to fetch Zid orders...");
            const ordersResponse = await zid_service_1.ZidApiService.getOrders(xManagerToken, authorizationJwt, 1, 20);
            if (ordersResponse && ordersResponse.orders && Array.isArray(ordersResponse.orders) && ordersResponse.orders.length > 0) {
                const fetchedZidOrders = ordersResponse.orders;
                console.log(`ZidAuthCallback: Fetched ${fetchedZidOrders.length} Zid Orders. Processing for Convert...`);
                const convertGoalIdString = process.env.CONVERT_GOAL_ID_FOR_PURCHASE;
                if (!convertGoalIdString) {
                    console.error("ZidAuthCallback: Essential Convert configuration missing from .env.");
                }
                else {
                    const convertGoalId = parseInt(convertGoalIdString, 10);
                    if (isNaN(convertGoalId)) {
                        console.error(`ZidAuthCallback: CONVERT_GOAL_ID_FOR_PURCHASE (${convertGoalIdString}) is not valid.`);
                    }
                    else {
                        for (const zidOrder of fetchedZidOrders) {
                            const orderLogPrefix = `[ZidOrder ${zidOrder.id}, Cust ${((_a = zidOrder.customer) === null || _a === void 0 ? void 0 : _a.id) || 'N/A'}]`;
                            console.log(`--- ${orderLogPrefix} Processing for Convert (Goal ID: ${convertGoalId}) ---`);
                            const zidCustomerId = (_c = (_b = zidOrder.customer) === null || _b === void 0 ? void 0 : _b.id) === null || _c === void 0 ? void 0 : _c.toString();
                            if (!zidCustomerId) {
                                console.warn(`${orderLogPrefix} Zid Customer ID missing. Skipping Convert events.`);
                                continue;
                            }
                            // Re-added declarations for experienceIdsToUse and variationIdsToUse
                            let experienceIdsToUse = [];
                            let variationIdsToUse = [];
                            let bucketingEventsForConvert = [];
                            let attributionSource = "Initial: No Stored Context";
                            let pagePathForLog = 'Unknown';
                            // ==========================================================================================
                            // === DEFINITIVE FIX: Revert to synchronous calls for in-memory store ====================
                            // ==========================================================================================
                            let storedContextData = undefined;
                            storedContextData = (0, convertContextController_1.getStoredClientContext)(zidCustomerId);
                            if (storedContextData && storedContextData.convertBucketing && storedContextData.convertBucketing.length > 0) {
                                attributionSource = "Found in Store (by zidCustomerId)";
                                if (storedContextData.zidPagePath)
                                    pagePathForLog = storedContextData.zidPagePath;
                            }
                            else {
                                const orderContextKey = `orderctx_${zidOrder.id}`;
                                console.log(`${orderLogPrefix} Context not found/empty via zidCustomerId. Attempting lookup by orderId key: ${orderContextKey}`);
                                storedContextData = (0, convertContextController_1.getStoredClientContext)(orderContextKey);
                                if (storedContextData && storedContextData.convertBucketing && storedContextData.convertBucketing.length > 0) {
                                    attributionSource = "Found in Store (by orderId from purchase signal)";
                                    pagePathForLog = storedContextData.zidPagePath || 'N/A (from order context)';
                                }
                                else {
                                    storedContextData = undefined;
                                    attributionSource = "No Stored Context (tried zidCustomerId & orderId)";
                                }
                            }
                            // ==========================================================================================
                            if (storedContextData && storedContextData.convertBucketing && Array.isArray(storedContextData.convertBucketing) && storedContextData.convertBucketing.length > 0) {
                                console.log(`${orderLogPrefix} DEBUG: Using context from ${attributionSource}. Raw storedContext.convertBucketing:`, JSON.stringify(storedContextData.convertBucketing));
                                const validBuckets = storedContextData.convertBucketing.filter(
                                // Simplified filtering logic to prevent TS errors due to function expression scope
                                (b) => {
                                    const hasExpId = typeof b.experimentId === 'string' && b.experimentId.trim().length > 0;
                                    const hasVarId = typeof b.variationId === 'string' && b.variationId.trim().length > 0;
                                    return hasExpId && hasVarId;
                                });
                                console.log(`${orderLogPrefix} DEBUG: validBuckets array length after filter: ${validBuckets.length}`);
                                console.log(`${orderLogPrefix} DEBUG: validBuckets content after filter:`, JSON.stringify(validBuckets));
                                if (validBuckets.length > 0) {
                                    console.log(`${orderLogPrefix} DEBUG: Entering .map() for experienceIdsToUse. validBuckets about to be mapped:`, JSON.stringify(validBuckets));
                                    experienceIdsToUse = validBuckets.map(
                                    // Simplified mapping logic
                                    (vb) => vb.experimentId ? String(vb.experimentId) : null).filter(function (id) { return id !== null && id !== undefined; });
                                    console.log(`${orderLogPrefix} DEBUG: Entering .map() for variationIdsToUse. validBuckets about to be mapped:`, JSON.stringify(validBuckets));
                                    variationIdsToUse = validBuckets.map(
                                    // Simplified mapping logic
                                    (vb) => vb.variationId ? String(vb.variationId) : null).filter(function (id) { return id !== null && id !== undefined; });
                                    console.log(`${orderLogPrefix} Using ExpIDs from ${attributionSource} (Page: ${pagePathForLog}): [${experienceIdsToUse.join(', ')}] and VarIDs: [${variationIdsToUse.join(', ')}]`);
                                    // Populate bucketingEventsForConvert for the new API call
                                    bucketingEventsForConvert = validBuckets.map(b => ({
                                        eventType: 'bucketing',
                                        data: {
                                            experienceId: b.experimentId,
                                            variationId: b.variationId
                                        }
                                    }));
                                }
                                else {
                                    attributionSource = attributionSource.includes("Filtered") ? attributionSource : "Stored Context but Filtered to No Valid Buckets";
                                    console.log(`${orderLogPrefix} ${attributionSource} for Zid Customer ID ${zidCustomerId}.`);
                                }
                            }
                            else {
                                console.log(`${orderLogPrefix} ${attributionSource} for Zid Customer ID ${zidCustomerId}. No usable experiment data.`);
                            }
                            const uniqueTransactionIdForOrder = `zid-order-${zidOrder.id}-${Date.now()}`;
                            // Removed eventSpecifics as it was only for the removed legacy API calls
                            // Removed hitGoalPayload creation and call to ConvertApiService.sendEventToConvert
                            const originalOrderTotal = parseFloat(zidOrder.order_total || "0");
                            const originalCurrencyCode = zidOrder.currency_code || TARGET_REPORTING_CURRENCY;
                            let revenueForConvertAPI = 0;
                            if (originalOrderTotal > 0) {
                                try {
                                    revenueForConvertAPI = await currency_service_1.CurrencyService.convertToSAR(originalOrderTotal, originalCurrencyCode);
                                    console.log(`${orderLogPrefix} Converted ${originalOrderTotal} ${originalCurrencyCode} to ${revenueForConvertAPI} ${TARGET_REPORTING_CURRENCY}.`);
                                }
                                catch (conversionError) {
                                    console.error(`${orderLogPrefix} Currency conversion error. Using original amount. Error:`, conversionError);
                                    revenueForConvertAPI = parseFloat(originalOrderTotal.toFixed(2));
                                }
                            }
                            // Removed productCount calculation if only used for legacy 'tr' event
                            // Removed transactionPayload creation and call to ConvertApiService.sendEventToConvert
                            if (revenueForConvertAPI > 0) { // Condition simplified to check revenue for sending conversion
                                // --- NEW MODERN METRICS V1 API CALL (Conversion event) ---
                                // Products array for the new API payload
                                let productsForNewPayload = [];
                                if (zidOrder.products && Array.isArray(zidOrder.products)) {
                                    productsForNewPayload = await Promise.all(zidOrder.products.map(async (product) => {
                                        const itemPrice = parseFloat(String(product.price)) || 0;
                                        const convertedItemPrice = await currency_service_1.CurrencyService.convertToSAR(itemPrice, originalCurrencyCode);
                                        return {
                                            productId: product.sku || String(product.id),
                                            productName: product.name,
                                            unitPrice: convertedItemPrice,
                                            quantity: parseInt(String(product.quantity), 10) || 0
                                        };
                                    }));
                                }
                                const newModernConversionEvent = {
                                    eventType: 'conversion',
                                    data: {
                                        goalId: convertGoalId,
                                        transactionId: uniqueTransactionIdForOrder,
                                        revenue: revenueForConvertAPI,
                                        products: productsForNewPayload
                                    }
                                };
                                // Combine bucketing events (if any) and the new conversion event for the visitor payload
                                const newModernVisitorPayload = {
                                    visitorId: zidCustomerId,
                                    events: [...bucketingEventsForConvert, newModernConversionEvent]
                                };
                                console.log(`${orderLogPrefix} Preparing NEW v1/track METRICS API payload (Conversion):`, JSON.stringify(newModernVisitorPayload, null, 2));
                                await convert_service_1.ConvertApiService.sendMetricsV1ApiEvents(newModernVisitorPayload);
                                // --- END NEW MODERN METRICS V1 API CALL (conversion event) ---
                            }
                            else {
                                console.log(`${orderLogPrefix} Skipping new 'conversion' event as revenue is zero.`);
                            }
                            console.log(`--- ${orderLogPrefix} Finished Convert API calls for this order ---`); // Simplified log
                        }
                    }
                }
            }
        }
        catch (apiError) {
            const err = apiError;
            console.error("ZidAuthCallback: Error during Zid order/Convert event processing:", err.message, err.stack);
        }
        const dashboardUrl = process.env.YOUR_APP_DASHBOARD_URL || '/';
        console.log(`ZidAuthCallback: Redirecting to dashboard: ${dashboardUrl}`);
        res.redirect(dashboardUrl);
    }
    catch (error) {
        const err = error;
        console.error("ZidAuthCallback: Outer error processing Zid OAuth callback:", err.message, err.stack);
        res.status(500).send("An error occurred during Zid authentication callback.");
    }
};
exports.zidAuthCallbackController = zidAuthCallbackController;
