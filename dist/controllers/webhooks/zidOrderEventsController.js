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
exports.zidOrderEventsWebhookController = void 0;
const convert_service_1 = require("../../services/convert-service");
const currency_service_1 = require("../../services/currency-service");
const firestore_service_1 = require("../../services/firestore-service");
const admin = __importStar(require("firebase-admin"));
const TARGET_REPORTING_CURRENCY = 'SAR';
function getClientIpFromWebhook(req) {
    const ipHeaders = ['x-forwarded-for', 'x-real-ip', 'true-client-ip'];
    for (const header of ipHeaders) {
        const ip = req.headers[header];
        if (typeof ip === 'string') {
            return ip.split(',')[0].trim();
        }
    }
    return req.ip || req.socket.remoteAddress;
}
const zidOrderEventsWebhookController = async (req, res) => {
    var _a, _b, _c, _d, _e;
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
        }
        else {
            zidOrder = req.body;
        }
        if (!zidOrder || !zidOrder.id) {
            console.error("Webhook payload did not contain a valid order ID.");
            return;
        }
        const convertGoalId = parseInt(process.env.CONVERT_GOAL_ID_FOR_PURCHASE, 10);
        const orderLogPrefix = `[ZidOrder ${zidOrder.id}, Cust ${((_a = zidOrder.customer) === null || _a === void 0 ? void 0 : _a.id) || 'GUEST'}]`;
        console.log(`--- ${orderLogPrefix} [WEBHOOK] Processing for Convert (Goal ID: ${convertGoalId}) ---`);
        const zidCustomerId = (_c = (_b = zidOrder.customer) === null || _b === void 0 ? void 0 : _b.id) === null || _c === void 0 ? void 0 : _c.toString();
        let storedContext = undefined;
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
                const firestoreData = await (0, firestore_service_1.getHeuristicGuestContext)(webhookClientIp, purchaseTimestamp);
                if (firestoreData) {
                    attributionSource = 'Firestore (Heuristic: IP + Timestamp)';
                    storedContext = {
                        convertVisitorId: firestoreData.convertVisitorId,
                        zidCustomerId: (_d = firestoreData.zidCustomerId) !== null && _d !== void 0 ? _d : undefined,
                        convertBucketing: firestoreData.convertBucketing.map(b => ({ experimentId: String(b.experienceId), variationId: String(b.variationId) })),
                        timestamp: (firestoreData.timestamp instanceof admin.firestore.Timestamp) ? firestoreData.timestamp.toMillis() : firestoreData.timestamp,
                        zidPagePath: firestoreData.zidPagePath
                    };
                }
            }
            else {
                console.warn(`${orderLogPrefix} [WEBHOOK] Guest order detected, but no client IP was found in webhook headers. Cannot perform heuristic lookup.`);
            }
        }
        // --- PATH 2: LOGGED-IN USER ---
        // If it's not a guest, we use the reliable customer ID.
        else if (zidCustomerId) {
            console.log(`${orderLogPrefix} [WEBHOOK] Logged-in user detected. Performing direct lookup by zidCustomerId: ${zidCustomerId}`);
            const firestoreData = await (0, firestore_service_1.getContextByZidCustomerId)(zidCustomerId);
            if (firestoreData) {
                attributionSource = 'Firestore (by zidCustomerId)';
                storedContext = {
                    convertVisitorId: firestoreData.convertVisitorId,
                    zidCustomerId: (_e = firestoreData.zidCustomerId) !== null && _e !== void 0 ? _e : undefined,
                    convertBucketing: firestoreData.convertBucketing.map(b => ({ experimentId: String(b.experienceId), variationId: String(b.variationId) })),
                    timestamp: (firestoreData.timestamp instanceof admin.firestore.Timestamp) ? firestoreData.timestamp.toMillis() : firestoreData.timestamp,
                    zidPagePath: firestoreData.zidPagePath
                };
            }
        }
        // ==========================================================================================
        const visitorIdForConvert = (storedContext === null || storedContext === void 0 ? void 0 : storedContext.convertVisitorId) || zidCustomerId || `zid-guest-${zidOrder.id}`;
        console.log(`${orderLogPrefix} Using VID for Convert payload: '${visitorIdForConvert}' (Source: ${attributionSource})`);
        // ... (The rest of the file remains the same) ...
        const eventsForConvert = [];
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
        }
        else {
            console.log(`${orderLogPrefix} Context NOT found or empty bucketing data. Conversion will be unattributed regarding A/B test.`);
        }
        const finalOrderTotal = parseFloat(zidOrder.order_total || "0");
        const originalCurrencyCode = zidOrder.currency_code || TARGET_REPORTING_CURRENCY;
        const revenueForConvertAPI = await currency_service_1.CurrencyService.convertToSAR(finalOrderTotal, originalCurrencyCode);
        let productsForPayload = [];
        if (zidOrder.products && Array.isArray(zidOrder.products)) {
            productsForPayload = await Promise.all(zidOrder.products.map(async (product) => {
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
        eventsForConvert.push({
            eventType: 'conversion',
            data: {
                goalId: convertGoalId,
                transactionId: `zid-order-${zidOrder.id}`,
                revenue: revenueForConvertAPI,
                products: productsForPayload
            }
        });
        const visitorPayload = {
            visitorId: visitorIdForConvert,
            events: eventsForConvert
        };
        console.log(`--- ${orderLogPrefix} [WEBHOOK] Sending to NEW v1/track METRICS API ---`);
        await convert_service_1.ConvertApiService.sendMetricsV1ApiEvents(visitorPayload);
        console.log(`--- ${orderLogPrefix} [WEBHOOK] Finished NEW v1/track METRICS API call ---`);
        console.log(`--- ${orderLogPrefix} [WEBHOOK] Overall processing complete for Convert ---`);
    }
    catch (error) {
        const err = error;
        console.error("[ERROR] Webhook processing failed after acknowledgement:", err.message, err.stack);
    }
};
exports.zidOrderEventsWebhookController = zidOrderEventsWebhookController;
