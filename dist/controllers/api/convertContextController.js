"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADDITIVE_DIAGNOSTIC_NAMED_EXPORT = exports.handlePurchaseSignalController = exports.captureConvertContextController = exports.getStoredClientContext = void 0;
const convert_service_1 = require("../../services/convert-service");
// ==========================================================================================
// === END OF FIX #1 ========================================================================
// ==========================================================================================
const clientContextStore = {};
function getStoredClientContext(key) {
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
        // ==========================================================================================
        // === DEFINITIVE FIX #2: Change the logic to require convertVisitorId ======================
        // ==========================================================================================
        // CRITICAL: We can only store useful context if we have the Convert Visitor ID.
        if (!convertVisitorId) {
            console.warn("/api/capture-convert-context: No convertVisitorId provided. Cannot store context.");
            console.log("--> Failing payload dump:", JSON.stringify(contextData));
            return res.status(200).json({ message: "Context ignored, missing convertVisitorId." });
        }
        const bucketingToStore = (Array.isArray(convertBucketing))
            ? convertBucketing
                .filter((b) => !!(b && b.experienceId && b.variationId))
                .map(b => ({
                experimentId: b.experienceId,
                variationId: b.variationId
            }))
            : [];
        if (bucketingToStore.length === 0) {
            return res.status(200).json({ message: "Context received, but no valid bucketing data to store." });
        }
        // DEFINITIVE FIX #3: Add the convertVisitorId to the object we store.
        const infoToStore = {
            convertVisitorId: convertVisitorId,
            convertBucketing: bucketingToStore,
            timestamp: Date.now(),
            zidPagePath: zidPagePath
        };
        if (zidCustomerId) {
            clientContextStore[zidCustomerId] = infoToStore;
            console.log(`Stored/Updated context for zidCustomerId: '${zidCustomerId}'.`);
        }
        clientContextStore[convertVisitorId] = infoToStore;
        console.log(`Stored/Updated context for convertVisitorId: '${convertVisitorId}'.`);
        // ==========================================================================================
        // === END OF FIXES =========================================================================
        // ==========================================================================================
        console.log(`Current store keys after update: [${Object.keys(clientContextStore).join(', ')}]`);
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
        // Minor fix: Added convertVisitorId to the stored object here as well for consistency
        if (payload.zidOrderId && payload.experiments && Array.isArray(payload.experiments) && payload.experiments.length > 0 && payload.convertVisitorId) {
            const orderContextKey = `orderctx_${payload.zidOrderId}`;
            const validExperimentsForOrder = payload.experiments.filter(b => b.experimentId && typeof b.experimentId === 'string' && b.variationId && typeof b.variationId === 'string');
            if (validExperimentsForOrder.length > 0) {
                // MODIFIED to include the convertVisitorId
                clientContextStore[orderContextKey] = {
                    convertVisitorId: payload.convertVisitorId,
                    convertBucketing: validExperimentsForOrder,
                    timestamp: Date.now(),
                };
                console.log(`Purchase signal: Stored experiment context for Zid Order ID '${payload.zidOrderId}'.`);
            }
            else {
                console.log(`Purchase signal: Received Zid Order ID '${payload.zidOrderId}' but experiments array was empty or invalid after filtering.`);
            }
        }
        else if (payload.zidOrderId) {
            console.log(`Purchase signal: Received Zid Order ID '${payload.zidOrderId}' but no experiments data in payload to store for it.`);
        }
        if (payload.convertVisitorId) {
            const convertAccountId = process.env.CONVERT_ACCOUNT_ID;
            const convertProjectId = process.env.CONVERT_PROJECT_ID;
            const convertGoalIdString = process.env.CONVERT_GOAL_ID_FOR_PURCHASE;
            if (!convertAccountId || !convertProjectId || !convertGoalIdString) {
                console.error("/api/signal-purchase: Essential Convert configuration missing.");
                return res.status(500).json({ message: "Server configuration error for Convert tracking." });
            }
            const convertGoalId = parseInt(convertGoalIdString, 10);
            if (isNaN(convertGoalId)) {
                console.error("/api/signal-purchase: Invalid Convert Goal ID.");
                return res.status(500).json({ message: "Server configuration error: Invalid Convert Goal ID." });
            }
            const experienceIds = payload.experiments.map(function (exp) { return exp.experimentId; }).filter(function (id) { return !!id; });
            const variationIds = payload.experiments.map(function (exp) { return exp.variationId; }).filter(function (id) { return !!id; });
            const commonPayloadParts = {
                cid: convertAccountId,
                pid: convertProjectId,
                vid: payload.convertVisitorId,
            };
            const eventSpecifics = { goals: [convertGoalId] };
            if (experienceIds.length > 0 && variationIds.length > 0 && experienceIds.length === variationIds.length) {
                eventSpecifics.exps = experienceIds;
                eventSpecifics.vars = variationIds;
            }
            const hitGoalTid = `signal-hitGoal-${payload.convertVisitorId}-${payload.zidOrderId || 'noOrder'}-${Date.now()}`;
            const hitGoalPayload = Object.assign(Object.assign({}, commonPayloadParts), { tid: hitGoalTid, ev: [Object.assign({ evt: 'hitGoal' }, eventSpecifics)] });
            console.log("Purchase signal: Preparing 'hitGoal' event to Convert:", JSON.stringify(hitGoalPayload, null, 0));
            await convert_service_1.ConvertApiService.sendEventToConvert(hitGoalPayload);
            res.status(200).json({ message: "Purchase signal processed, context stored by order ID (if provided & valid experiments), Convert 'hitGoal' dispatched if visitorId present." });
        }
        else {
            console.log("Purchase signal: No convertVisitorId in payload, so hitGoal to Convert API was skipped. Context may have been stored by orderId if provided.");
            res.status(200).json({ message: "Purchase signal received, context stored by order ID (if provided and experiments present). No hitGoal sent due to missing convertVisitorId." });
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
