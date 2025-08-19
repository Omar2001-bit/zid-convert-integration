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
// Ensure all necessary interfaces for the new API calls are imported
const convert_service_1 = require("../../services/convert-service");
const currency_service_1 = require("../../services/currency-service");
// Added: Import Firestore service functions
const firestore_service_1 = require("../../services/firestore-service");
// Import the *synchronous* in-memory context getter and store for fallback, as requested
const convertContextController_1 = require("../api/convertContextController");
const admin = __importStar(require("firebase-admin")); // Added: Import admin to handle Firestore Timestamps
const TARGET_REPORTING_CURRENCY = 'SAR';
// ZidProduct interface is now imported from src/types/index.d.ts
// interface ZidProduct {
//     id: string | number;
//     sku?: string;
//     name: string;
//     price: number | string;
//     quantity: number | string;
// }
const zidOrderEventsWebhookController = async (req, res) => {
    var _a, _b, _c, _d, _e;
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
        }
        else {
            zidOrder = req.body;
        }
        const eventType = 'order.create';
        console.log(`[SUCCESS] Webhook request validated for event: ${eventType}`);
        if (!zidOrder || !zidOrder.id) {
            console.error("Webhook payload did not contain a valid order ID. Body:", zidOrder);
            return;
        }
        const convertGoalId = parseInt(process.env.CONVERT_GOAL_ID_FOR_PURCHASE, 10);
        const orderLogPrefix = `[ZidOrder ${zidOrder.id}, Cust ${((_a = zidOrder.customer) === null || _a === void 0 ? void 0 : _a.id) || 'N/A'}]`;
        console.log(`--- ${orderLogPrefix} [WEBHOOK] Processing for Convert (Goal ID: ${convertGoalId}) ---`);
        const zidCustomerId = (_c = (_b = zidOrder.customer) === null || _b === void 0 ? void 0 : _b.id) === null || _c === void 0 ? void 0 : _c.toString();
        const zidOrderIdKey = `orderctx_${zidOrder.id}`; // Key used for purchase signal context
        if (!zidCustomerId) {
            console.warn(`${orderLogPrefix} [WEBHOOK] Zid Customer ID missing. Attempting lookup with order ID context key '${zidOrderIdKey}'.`);
        }
        // FIX: The type for storedContext is now NormalizedBucketingInfo or null/undefined
        let storedContext = undefined;
        let attributionSource = 'No Context';
        let visitorIdForConvert;
        // ==========================================================================================
        // === MODIFIED: Prioritize Firestore lookup, then fallback to in-memory, normalizing data ===
        // ==========================================================================================
        // 1. Try fetching from Firestore by zidCustomerId
        if (zidCustomerId) {
            const firestoreData = await (0, firestore_service_1.getContextByZidCustomerId)(zidCustomerId);
            if (firestoreData) {
                attributionSource = 'Firestore (by zidCustomerId)';
                storedContext = {
                    convertVisitorId: firestoreData.convertVisitorId,
                    // --- FIX 1 of 2: Convert null to undefined to match the expected type ---
                    zidCustomerId: (_d = firestoreData.zidCustomerId) !== null && _d !== void 0 ? _d : undefined,
                    // Map StoredConvertBucketingEntry (numbers) to {experimentId: string, variationId: string}
                    convertBucketing: firestoreData.convertBucketing.map(b => ({
                        experimentId: String(b.experienceId),
                        variationId: String(b.variationId)
                    })),
                    // Convert Firestore Timestamp to number (milliseconds)
                    timestamp: (firestoreData.timestamp instanceof admin.firestore.Timestamp) ? firestoreData.timestamp.toMillis() : firestoreData.timestamp,
                    zidPagePath: firestoreData.zidPagePath
                };
            }
        }
        // 2. If not found by zidCustomerId, try fetching from Firestore by specific order ID key
        if (!storedContext && zidOrderIdKey) {
            const firestoreData = await (0, firestore_service_1.getContextByConvertVisitorId)(zidOrderIdKey);
            if (firestoreData) {
                attributionSource = 'Firestore (by orderId context key)';
                storedContext = {
                    convertVisitorId: firestoreData.convertVisitorId,
                    // --- FIX 2 of 2: Convert null to undefined to match the expected type ---
                    zidCustomerId: (_e = firestoreData.zidCustomerId) !== null && _e !== void 0 ? _e : undefined,
                    // Map StoredConvertBucketingEntry (numbers) to {experimentId: string, variationId: string}
                    convertBucketing: firestoreData.convertBucketing.map(b => ({
                        experimentId: String(b.experienceId),
                        variationId: String(b.variationId)
                    })),
                    // Convert Firestore Timestamp to number (milliseconds)
                    timestamp: (firestoreData.timestamp instanceof admin.firestore.Timestamp) ? firestoreData.timestamp.toMillis() : firestoreData.timestamp,
                    zidPagePath: firestoreData.zidPagePath
                };
            }
        }
        // 3. If still not found in Firestore, fallback to in-memory store (zidCustomerId first, then order ID key)
        if (!storedContext) {
            let inMemoryData = undefined;
            if (zidCustomerId) {
                inMemoryData = (0, convertContextController_1.getStoredClientContext)(zidCustomerId);
                if (inMemoryData) {
                    attributionSource = 'In-Memory (by zidCustomerId)';
                }
            }
            if (!inMemoryData && zidOrderIdKey) {
                inMemoryData = (0, convertContextController_1.getStoredClientContext)(zidOrderIdKey);
                if (inMemoryData) {
                    attributionSource = 'In-Memory (by orderId context key)';
                }
            }
            if (inMemoryData) {
                storedContext = {
                    convertVisitorId: inMemoryData.convertVisitorId,
                    zidCustomerId: undefined,
                    convertBucketing: inMemoryData.convertBucketing.map(b => ({
                        experimentId: b.experimentId,
                        variationId: b.variationId
                    })),
                    timestamp: inMemoryData.timestamp,
                    zidPagePath: inMemoryData.zidPagePath
                };
            }
        }
        // ==========================================================================================
        // Determine the visitorId for Convert API based on found context or fallback to zidCustomerId
        visitorIdForConvert = (storedContext === null || storedContext === void 0 ? void 0 : storedContext.convertVisitorId) || zidCustomerId || `zid-guest-${zidOrder.id}`;
        console.log(`${orderLogPrefix} Using VID for Convert payload: '${visitorIdForConvert}' (Source: ${attributionSource})`);
        const eventsForConvert = [];
        // Add bucketing events if context was found AND it contains bucketing data
        if (storedContext && storedContext.convertBucketing && Array.isArray(storedContext.convertBucketing) && storedContext.convertBucketing.length > 0) {
            console.log(`${orderLogPrefix} Context FOUND (${attributionSource}). Adding bucketing events.`);
            storedContext.convertBucketing.forEach(bucket => {
                // These properties are now guaranteed to be strings from the normalization step into NormalizedBucketingInfo
                eventsForConvert.push({
                    eventType: 'bucketing',
                    data: {
                        experienceId: bucket.experimentId,
                        variationId: bucket.variationId // Now correctly typed as string
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
                }; // Explicit type assertion
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
