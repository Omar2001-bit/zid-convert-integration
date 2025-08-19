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
exports.ADDITIVE_DIAGNOSTIC_NAMED_EXPORT = exports.handlePurchaseSignalController = exports.captureConvertContextController = exports.getStoredClientContext = void 0;
// Updated import: Removed ConvertTrackPayload as it's no longer used, kept modern interfaces
const convert_service_1 = require("../../services/convert-service");
// Added: Import Firestore service functions
const firestore_service_1 = require("../../services/firestore-service");
const admin = __importStar(require("firebase-admin")); // Added: Import admin to use admin.firestore.FieldValue
const clientContextStore = {};
// PRESERVED: The function remains synchronous and only reads from the local in-memory object.
function getStoredClientContext(key) {
    console.log(`DEBUG: getStoredClientContext called with key: "${key}" (type: ${typeof key})`);
    if (!key) {
        console.log("DEBUG: getStoredClientContext - key is null/undefined, returning undefined.");
        return undefined;
    }
    const context = clientContextStore[key];
    if (context) {
        console.log(`DEBUG: getStoredClientContext - Context FOUND for key "${key}". Bucketing:`, context.convertBucketing ? JSON.stringify(context.convertBucketing) : "Bucketing data missing in context");
    }
    else {
        console.log(`DEBUG: getStoredClientContext - Context NOT FOUND for key "${key}". Current store keys: [${Object.keys(clientContextStore).join(', ')}]`);
    }
    return context;
}
exports.getStoredClientContext = getStoredClientContext;
const captureConvertContextController = async (req, res) => {
    try {
        let contextData;
        if (typeof req.body === 'string' && req.body.length > 0) {
            console.log('[capture-convert-context] Received text body, attempting to parse as JSON.');
            contextData = JSON.parse(req.body);
        }
        else {
            console.log('[capture-convert-context] Received pre-parsed JSON body.');
            contextData = req.body;
        }
        const { zidCustomerId, convertVisitorId, convertBucketing, zidPagePath } = contextData;
        if (!convertVisitorId) {
            console.warn("/api/capture-convert-context: No convertVisitorId provided. Cannot store context.");
            console.log("--> Failing payload dump:", JSON.stringify(contextData));
            return res.status(200).json({ message: "Context ignored, missing convertVisitorId." });
        }
        const bucketingToStore = (Array.isArray(convertBucketing))
            ? convertBucketing
                // CORRECTED: Ensure we filter based on existence of properties from the input payload (experienceId)
                .filter((b) => !!(b && b.experienceId && b.variationId))
                .map(b => ({
                // CORRECTED: Map 'experienceId' from the input to 'experimentId' for storage
                experimentId: b.experienceId,
                variationId: b.variationId
            }))
            : [];
        if (bucketingToStore.length === 0) {
            console.log("Context received, but no valid bucketing data to store. Proceeding to save visitor ID only (if valid).");
        }
        // --- PRESERVED: Original in-memory store logic ---
        const infoToStoreInMemory = {
            convertVisitorId: convertVisitorId,
            convertBucketing: bucketingToStore,
            timestamp: Date.now(),
            zidPagePath: zidPagePath
        };
        if (zidCustomerId) {
            clientContextStore[zidCustomerId] = infoToStoreInMemory;
            console.log(`Stored/Updated IN-MEMORY context for zidCustomerId: '${zidCustomerId}'.`);
        }
        clientContextStore[convertVisitorId] = infoToStoreInMemory;
        console.log(`Stored/Updated IN-MEMORY context for convertVisitorId: '${convertVisitorId}'.`);
        console.log(`Current IN-MEMORY store keys after update: [${Object.keys(clientContextStore).join(', ')}]`);
        // --- END PRESERVED ---
        // --- ADDED: Firestore persistence logic ---
        // Prepare data for Firestore, aligning with src/types/index.d.ts FirestoreStoredBucketingInfo
        const infoToStoreForFirestore = {
            convertVisitorId: convertVisitorId,
            // --- THIS IS THE FIX ---
            // If zidCustomerId is null or undefined from the request, explicitly store null in Firestore.
            zidCustomerId: zidCustomerId !== null && zidCustomerId !== void 0 ? zidCustomerId : null,
            // --- END OF FIX ---
            convertBucketing: bucketingToStore.map((b) => ({
                experienceId: parseInt(b.experimentId),
                variationId: parseInt(b.variationId)
            })),
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            zidPagePath: zidPagePath
        };
        await (0, firestore_service_1.saveContext)(infoToStoreForFirestore);
        console.log(`Context saved to FIRESTORE for convertVisitorId: '${convertVisitorId}' and zidCustomerId: '${zidCustomerId || 'N/A'}'.`);
        // --- END ADDED ---
        res.status(200).json({ message: "Convert context received and stored successfully." });
    }
    catch (error) {
        const err = error;
        console.error("Error processing /api/capture-convert-context:", err.message, err.stack);
        res.status(500).json({ message: "Error processing request on server." });
    }
};
exports.captureConvertContextController = captureConvertContextController;
const handlePurchaseSignalController = async (req, res) => {
    try {
        const payload = req.body;
        console.log("Received /api/signal-purchase payload:", JSON.stringify(payload, null, 2));
        if (!payload.convertVisitorId && !payload.zidOrderId) {
            console.warn("/api/signal-purchase: Convert Visitor ID or Zid Order ID is required in signal. Payload:", payload);
            return res.status(400).json({ message: "Convert Visitor ID or Zid Order ID is required in signal." });
        }
        if (payload.zidOrderId && payload.experiments && Array.isArray(payload.experiments) && payload.experiments.length > 0 && payload.convertVisitorId) {
            const orderContextKey = `orderctx_${payload.zidOrderId}`;
            const validExperimentsForOrder = payload.experiments.filter((b) => !!(b && b.experimentId && b.variationId));
            if (validExperimentsForOrder.length > 0) {
                // --- PRESERVED: Original in-memory store logic ---
                clientContextStore[orderContextKey] = {
                    convertVisitorId: payload.convertVisitorId,
                    convertBucketing: validExperimentsForOrder,
                    timestamp: Date.now(),
                };
                console.log(`Purchase signal: Stored IN-MEMORY experiment context for Zid Order ID '${payload.zidOrderId}'.`);
                // --- END PRESERVED ---
                // --- ADDED: Firestore persistence logic ---
                const infoToStoreForFirestore = {
                    convertVisitorId: payload.convertVisitorId,
                    // zidCustomerId might not be available from this signal, so it can be undefined
                    convertBucketing: validExperimentsForOrder.map((b) => ({
                        experienceId: parseInt(b.experimentId),
                        variationId: parseInt(b.variationId)
                    })),
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    zidPagePath: undefined // Page path is not typically part of this signal
                };
                await (0, firestore_service_1.saveContext)(infoToStoreForFirestore);
                console.log(`Purchase signal: Stored FIRESTORE experiment context for convertVisitorId '${payload.convertVisitorId}' for Zid Order ID '${payload.zidOrderId}'.`);
                // --- END ADDED ---
            }
            else {
                console.log(`Purchase signal: Received Zid Order ID '${payload.zidOrderId}' but experiments array was empty or invalid after filtering.`);
            }
        }
        else if (payload.zidOrderId) {
            console.log(`Purchase signal: Received Zid Order ID '${payload.zidOrderId}' but no experiments data in payload to store for it.`);
        }
        if (payload.convertVisitorId) {
            const convertGoalIdString = process.env.CONVERT_GOAL_ID_FOR_PURCHASE;
            if (!convertGoalIdString) {
                console.error("/api/signal-purchase: Essential Convert Goal ID configuration missing.");
                return res.status(500).json({ message: "Server configuration error for Convert tracking." });
            }
            const convertGoalId = parseInt(convertGoalIdString, 10);
            if (isNaN(convertGoalId)) {
                console.error("/api/signal-purchase: Invalid Convert Goal ID.");
                return res.status(500).json({ message: "Server configuration error: Invalid Convert Goal ID." });
            }
            // --- NEW MODERN METRICS V1 API CALL ---
            const newModernHitGoalTid = `signal-metrics-v1-${payload.convertVisitorId}-${payload.zidOrderId || 'noOrder'}-${Date.now()}`;
            // Prepare bucketing events from the signal payload
            const bucketingEvents = payload.experiments
                // Use 'exp.experimentId' as defined in PurchaseSignalPayload
                .filter(exp => exp.experimentId && exp.variationId)
                .map(exp => ({
                eventType: 'bucketing',
                data: {
                    // Map 'experimentId' from payload to 'experienceId' for BucketingEventData
                    experienceId: exp.experimentId,
                    variationId: exp.variationId
                }
            }));
            // Prepare conversion event
            const conversionEvent = {
                eventType: 'conversion',
                data: {
                    goalId: convertGoalId,
                    transactionId: newModernHitGoalTid,
                    // Note: Revenue and products are typically sent with actual order webhooks, not just signals.
                    // Add them here if this signal is expected to contain them.
                }
            };
            // Combine events for the visitor payload
            const visitorPayload = {
                visitorId: payload.convertVisitorId,
                events: [...bucketingEvents, conversionEvent] // Include both bucketing and conversion
            };
            console.log("Purchase signal: Preparing NEW v1/track METRICS API payload to Convert:", JSON.stringify(visitorPayload, null, 2));
            // Calling the new, correct ConvertApiService.sendMetricsV1ApiEvents
            await convert_service_1.ConvertApiService.sendMetricsV1ApiEvents(visitorPayload);
            // --- END NEW MODERN METRICS V1 API CALL ---
            res.status(200).json({ message: "Purchase signal processed, context stored by order ID (if provided & valid experiments), Convert API events dispatched." });
        }
        else {
            console.log("Purchase signal: No convertVisitorId in payload, so Convert API dispatch was skipped. Context may have been stored by orderId if provided.");
            res.status(200).json({ message: "Purchase signal received, context stored by order ID (if provided and experiments present). No Convert events sent due to missing convertVisitorId." });
        }
    }
    catch (error) {
        const err = error;
        console.error("Error processing /api/signal-purchase request:", err.message, err.stack);
        res.status(500).json({ message: "Error processing purchase signal request on server." });
    }
};
exports.handlePurchaseSignalController = handlePurchaseSignalController;
exports.ADDITIVE_DIAGNOSTIC_NAMED_EXPORT = "Hello from ADDITIVE_DIAGNOSTIC_NAMED_EXPORT";
const additiveDiagnosticDefaultObject = {
    ADDITIVE_DEFAULT_DIAGNOSTIC_PROPERTY: "Hello from additive default export in convertContextController"
};
exports.default = additiveDiagnosticDefaultObject;
