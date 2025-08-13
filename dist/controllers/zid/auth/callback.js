"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zidAuthCallbackController = void 0;
const zid_service_1 = require("../../../services/zid-service");
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
                const convertAccountId = process.env.CONVERT_ACCOUNT_ID;
                const convertProjectId = process.env.CONVERT_PROJECT_ID;
                const convertGoalIdString = process.env.CONVERT_GOAL_ID_FOR_PURCHASE;
                if (!convertAccountId || !convertProjectId || !convertGoalIdString) {
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
                            let experienceIdsToUse = [];
                            let variationIdsToUse = [];
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
                                const validBuckets = storedContextData.convertBucketing.filter(function (b, index) {
                                    console.log(`${orderLogPrefix} DEBUG: ------ Filtering bucket #${index} ------`);
                                    console.log(`${orderLogPrefix} DEBUG: Bucket #${index} RAW object (via JSON.stringify):`, JSON.stringify(b));
                                    var expIdValue = undefined;
                                    if (b && Object.prototype.hasOwnProperty.call(b, 'experimentId')) {
                                        expIdValue = b.experimentId;
                                    }
                                    var varIdValue = undefined;
                                    if (b && Object.prototype.hasOwnProperty.call(b, 'variationId')) {
                                        varIdValue = b.variationId;
                                    }
                                    console.log(`${orderLogPrefix} DEBUG: Bucket #${index} - After direct access - expIdValue: "${expIdValue}" (type: ${typeof expIdValue}), varIdValue: "${varIdValue}" (type: ${typeof varIdValue})`);
                                    var hasExpId = typeof expIdValue === 'string' && expIdValue.trim().length > 0;
                                    var hasVarId = typeof varIdValue === 'string' && varIdValue.trim().length > 0;
                                    console.log(`${orderLogPrefix} DEBUG: Bucket #${index} - Final checks - hasExpId: ${hasExpId}, hasVarId: ${hasVarId}`);
                                    console.log(`${orderLogPrefix} DEBUG: ------ End Filtering bucket #${index} ------`);
                                    return hasExpId && hasVarId;
                                });
                                console.log(`${orderLogPrefix} DEBUG: validBuckets array length after filter: ${validBuckets.length}`);
                                console.log(`${orderLogPrefix} DEBUG: validBuckets content after filter:`, JSON.stringify(validBuckets));
                                if (validBuckets.length > 0) {
                                    console.log(`${orderLogPrefix} DEBUG: Entering .map() for experienceIdsToUse. validBuckets about to be mapped:`, JSON.stringify(validBuckets));
                                    experienceIdsToUse = validBuckets.map(function (vb, mapIndex) {
                                        console.log(`${orderLogPrefix} DEBUG: Mapping experienceId for bucket #${mapIndex}:`, JSON.stringify(vb));
                                        var expId = null;
                                        if (vb && Object.prototype.hasOwnProperty.call(vb, 'experimentId')) {
                                            expId = vb.experimentId;
                                            console.log(`${orderLogPrefix} DEBUG: Bucket #${mapIndex} - vb.experimentId is "${expId}" (type: ${typeof expId})`);
                                        }
                                        else {
                                            console.log(`${orderLogPrefix} DEBUG: Bucket #${mapIndex} - vb OR vb.experimentId is missing/falsy in map for exp.`);
                                        }
                                        return expId ? String(expId) : null;
                                    }).filter(function (id) { return id !== null && id !== undefined; });
                                    console.log(`${orderLogPrefix} DEBUG: Entering .map() for variationIdsToUse. validBuckets about to be mapped:`, JSON.stringify(validBuckets));
                                    variationIdsToUse = validBuckets.map(function (vb, mapIndex) {
                                        console.log(`${orderLogPrefix} DEBUG: Mapping variationId for bucket #${mapIndex}:`, JSON.stringify(vb));
                                        var varId = null;
                                        if (vb && Object.prototype.hasOwnProperty.call(vb, 'variationId')) {
                                            varId = vb.variationId;
                                            console.log(`${orderLogPrefix} DEBUG: Bucket #${mapIndex} - vb.variationId is "${varId}" (type: ${typeof varId})`);
                                        }
                                        else {
                                            console.log(`${orderLogPrefix} DEBUG: Bucket #${mapIndex} - vb OR vb.variationId is missing/falsy in map for var.`);
                                        }
                                        return varId ? String(varId) : null;
                                    }).filter(function (id) { return id !== null && id !== undefined; });
                                    console.log(`${orderLogPrefix} Using ExpIDs from ${attributionSource} (Page: ${pagePathForLog}): [${experienceIdsToUse.join(', ')}] and VarIDs: [${variationIdsToUse.join(', ')}]`);
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
                            const eventSpecifics = { goals: [convertGoalId] };
                            if (experienceIdsToUse.length > 0 && variationIdsToUse.length > 0 && experienceIdsToUse.length === variationIdsToUse.length) {
                                eventSpecifics.exps = experienceIdsToUse;
                                eventSpecifics.vars = variationIdsToUse;
                                console.log(`${orderLogPrefix} Attributing to experiments from: ${attributionSource}`);
                            }
                            else {
                                console.log(`${orderLogPrefix} No valid experiment data from source: "${attributionSource}". Sending goal without specific exp/var attribution.`);
                            }
                            const hitGoalPayload = {
                                cid: convertAccountId,
                                pid: convertProjectId,
                                vid: zidCustomerId,
                                tid: uniqueTransactionIdForOrder,
                                ev: [Object.assign({ evt: 'hitGoal' }, eventSpecifics)]
                            };
                            console.log(`${orderLogPrefix} Preparing 'hitGoal' event:`, JSON.stringify(hitGoalPayload, null, 0));
                            await convert_service_1.ConvertApiService.sendEventToConvert(hitGoalPayload);
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
                            const productCount = (zidOrder.products && Array.isArray(zidOrder.products) && zidOrder.products.length > 0)
                                ? zidOrder.products.length
                                : (revenueForConvertAPI > 0 ? 1 : 0);
                            if (revenueForConvertAPI > 0 || productCount > 0) {
                                const transactionPayload = {
                                    cid: convertAccountId,
                                    pid: convertProjectId,
                                    vid: zidCustomerId,
                                    tid: uniqueTransactionIdForOrder,
                                    ev: [Object.assign(Object.assign({ evt: 'tr' }, eventSpecifics), { r: revenueForConvertAPI, prc: productCount })]
                                };
                                console.log(`${orderLogPrefix} Preparing 'tr' event (Revenue in ${TARGET_REPORTING_CURRENCY}):`, JSON.stringify(transactionPayload, null, 0));
                                await convert_service_1.ConvertApiService.sendEventToConvert(transactionPayload);
                            }
                            else {
                                console.log(`${orderLogPrefix} Skipping 'tr' event as revenue/product count is zero.`);
                            }
                            console.log(`--- ${orderLogPrefix} Finished API calls to Convert ---`);
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
