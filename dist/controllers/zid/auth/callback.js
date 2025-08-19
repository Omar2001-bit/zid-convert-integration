"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.zidAuthCallbackController = void 0;
const zid_service_1 = require("../../../services/zid-service");
// Updated import: Removed ConvertTrackPayload as it's no longer used, kept modern interfaces
const convert_service_1 = require("../../../services/convert-service");
// Original import for in-memory store fallback
const convertContextController_1 = require("../../api/convertContextController");
// Added: Import Firestore service functions (these are still needed directly here as they perform the actual DB calls)
const firestore_service_1 = require("../../../services/firestore-service");
const currency_service_1 = require("../../../services/currency-service");
const admin = __importStar(require("firebase-admin")); // Added: Import admin to handle Firestore Timestamps
// Removed: interface BucketingEntry as it's replaced by NormalizedBucketingInfo's structure for bucketing items
const TARGET_REPORTING_CURRENCY = 'SAR';
const zidAuthCallbackController = async (req, res) => {
    var _a, _b, _c, _d, _e;
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
                            // Removed: experienceIdsToUse and variationIdsToUse declarations as they are now handled by normalization
                            let bucketingEventsForConvert = [];
                            let attributionSource = "Initial: No Stored Context";
                            let pagePathForLog = 'Unknown';
                            // ==========================================================================================
                            // === MODIFIED: Prioritize Firestore lookup, then fallback to in-memory, normalizing data ===
                            // ==========================================================================================
                            let storedContextData = undefined;
                            // 1. Try fetching from Firestore by zidCustomerId
                            const firestoreDataByCustomerId = await (0, firestore_service_1.getContextByZidCustomerId)(zidCustomerId);
                            if (firestoreDataByCustomerId) {
                                attributionSource = 'Firestore (by zidCustomerId)';
                                storedContextData = {
                                    convertVisitorId: firestoreDataByCustomerId.convertVisitorId,
                                    // --- FIX 1 of 2: Convert null to undefined to match the expected type ---
                                    zidCustomerId: (_d = firestoreDataByCustomerId.zidCustomerId) !== null && _d !== void 0 ? _d : undefined,
                                    convertBucketing: firestoreDataByCustomerId.convertBucketing.map(b => ({
                                        experimentId: String(b.experienceId),
                                        variationId: String(b.variationId)
                                    })),
                                    timestamp: (firestoreDataByCustomerId.timestamp instanceof admin.firestore.Timestamp) ? firestoreDataByCustomerId.timestamp.toMillis() : firestoreDataByCustomerId.timestamp,
                                    zidPagePath: firestoreDataByCustomerId.zidPagePath
                                };
                            }
                            else {
                                const orderContextKey = `orderctx_${zidOrder.id}`;
                                console.log(`${orderLogPrefix} Context not found in Firestore via zidCustomerId. Attempting lookup by orderId key: ${orderContextKey} in Firestore.`);
                                // 2. If not found, try fetching from Firestore by specific order ID key
                                const firestoreDataByOrderId = await (0, firestore_service_1.getContextByConvertVisitorId)(orderContextKey);
                                if (firestoreDataByOrderId) {
                                    attributionSource = 'Firestore (by orderId context key)';
                                    storedContextData = {
                                        convertVisitorId: firestoreDataByOrderId.convertVisitorId,
                                        // --- FIX 2 of 2: Convert null to undefined to match the expected type ---
                                        zidCustomerId: (_e = firestoreDataByOrderId.zidCustomerId) !== null && _e !== void 0 ? _e : undefined,
                                        convertBucketing: firestoreDataByOrderId.convertBucketing.map(b => ({
                                            experimentId: String(b.experienceId),
                                            variationId: String(b.variationId)
                                        })),
                                        timestamp: (firestoreDataByOrderId.timestamp instanceof admin.firestore.Timestamp) ? firestoreDataByOrderId.timestamp.toMillis() : firestoreDataByOrderId.timestamp,
                                        zidPagePath: firestoreDataByOrderId.zidPagePath
                                    };
                                }
                                else {
                                    console.log(`${orderLogPrefix} Context not found in Firestore via orderId. Falling back to in-memory store.`);
                                    // 3. Fallback to in-memory store by zidCustomerId
                                    const inMemoryDataByCustomerId = (0, convertContextController_1.getStoredClientContext)(zidCustomerId);
                                    if (inMemoryDataByCustomerId) {
                                        attributionSource = "In-Memory (by zidCustomerId)";
                                        storedContextData = {
                                            convertVisitorId: inMemoryDataByCustomerId.convertVisitorId,
                                            zidCustomerId: undefined,
                                            convertBucketing: inMemoryDataByCustomerId.convertBucketing.map(b => ({
                                                experimentId: b.experimentId,
                                                variationId: b.variationId
                                            })),
                                            timestamp: inMemoryDataByCustomerId.timestamp,
                                            zidPagePath: inMemoryDataByCustomerId.zidPagePath
                                        };
                                    }
                                    else {
                                        // 4. Fallback to in-memory store by orderId key
                                        const inMemoryDataByOrderId = (0, convertContextController_1.getStoredClientContext)(orderContextKey);
                                        if (inMemoryDataByOrderId) {
                                            attributionSource = "In-Memory (by orderId from purchase signal)";
                                            storedContextData = {
                                                convertVisitorId: inMemoryDataByOrderId.convertVisitorId,
                                                zidCustomerId: undefined,
                                                convertBucketing: inMemoryDataByOrderId.convertBucketing.map(b => ({
                                                    experimentId: b.experimentId,
                                                    variationId: b.variationId
                                                })),
                                                timestamp: inMemoryDataByOrderId.timestamp,
                                                zidPagePath: inMemoryDataByOrderId.zidPagePath
                                            };
                                        }
                                        else {
                                            storedContextData = undefined;
                                            attributionSource = "No Stored Context (tried all methods)";
                                        }
                                    }
                                }
                            }
                            // ==========================================================================================
                            if (storedContextData && storedContextData.convertBucketing && Array.isArray(storedContextData.convertBucketing) && storedContextData.convertBucketing.length > 0) {
                                console.log(`${orderLogPrefix} DEBUG: Using context from ${attributionSource}. Raw storedContext.convertBucketing:`, JSON.stringify(storedContextData.convertBucketing));
                                // Simplified: Direct usage of storedContextData.convertBucketing now that it's normalized
                                const validBuckets = storedContextData.convertBucketing.filter((b) => {
                                    const hasExpId = typeof b.experimentId === 'string' && b.experimentId.trim().length > 0;
                                    const hasVarId = typeof b.variationId === 'string' && b.variationId.trim().length > 0;
                                    return hasExpId && hasVarId;
                                });
                                console.log(`${orderLogPrefix} DEBUG: validBuckets array length after filter: ${validBuckets.length}`);
                                console.log(`${orderLogPrefix} DEBUG: validBuckets content after filter:`, JSON.stringify(validBuckets));
                                if (validBuckets.length > 0) {
                                    // Removed: experienceIdsToUse and variationIdsToUse mapping as they are no longer needed
                                    // The BucketingEventData expects strings, which are now guaranteed by NormalizedBucketingInfo
                                    bucketingEventsForConvert = validBuckets.map((b) => ({
                                        eventType: 'bucketing',
                                        data: {
                                            experienceId: b.experimentId,
                                            variationId: b.variationId // These are now strings from normalization
                                        }
                                    }));
                                    console.log(`${orderLogPrefix} Using ExpIDs from ${attributionSource} (Page: ${pagePathForLog}): [${validBuckets.map(b => b.experimentId).join(', ')}] and VarIDs: [${validBuckets.map(b => b.variationId).join(', ')}]`);
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
