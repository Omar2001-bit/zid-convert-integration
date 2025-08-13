"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADDITIVE_DIAGNOSTIC_NAMED_EXPORT = exports.handlePurchaseSignalController = exports.captureConvertContextController = exports.getStoredClientContext = void 0;
const ioredis_1 = require("ioredis");
// ==========================================================================================
// === DEFINITIVE ADDITION: Initialize the Redis client for permanent storage ==============
// ==========================================================================================
let redis = null;
if (process.env.UPSTASH_REDIS_REST_URL) {
    redis = new ioredis_1.Redis(process.env.UPSTASH_REDIS_REST_URL);
    console.log("[Redis] Upstash Redis client initialized.");
}
else {
    console.warn("[Redis] UPSTASH_REDIS_REST_URL not found in .env. Redis is disabled.");
}
// Set a TTL (Time To Live) for stored keys. 7 days is a reasonable default.
const CONTEXT_EXPIRATION_SECONDS = 7 * 24 * 60 * 60;
// Your existing in-memory store is PRESERVED as a fast, first-level cache.
const clientContextStore = {};
// This function is now ASYNC and uses a hybrid local cache + Redis approach.
async function getStoredClientContext(key) {
    console.log(`DEBUG: getStoredClientContext searching for key: "${key}"`);
    if (!key) {
        return null;
    }
    // 1. Check the fast, in-memory cache first.
    const localContext = clientContextStore[key];
    if (localContext) {
        console.log(`DEBUG: getStoredClientContext - Context FOUND in local memory for key "${key}"`);
        return localContext;
    }
    console.log(`DEBUG: getStoredClientContext - Context NOT FOUND in local memory. Checking Redis...`);
    // 2. If not in memory and Redis is enabled, check the permanent Redis store.
    if (redis) {
        try {
            const redisData = await redis.get(key);
            if (redisData) {
                console.log(`DEBUG: getStoredClientContext - Context FOUND in Redis for key "${key}"`);
                const redisContext = JSON.parse(redisData);
                // Optional: Re-populate the local cache for speed on future lookups
                clientContextStore[key] = redisContext;
                return redisContext;
            }
            else {
                console.log(`DEBUG: getStoredClientContext - Context NOT FOUND in Redis for key "${key}".`);
                return null;
            }
        }
        catch (error) {
            console.error(`[ERROR] Failed to get context from Redis for key "${key}"`, error);
            return null; // Return null on error to prevent crashes
        }
    }
    else {
        console.log(`[Redis] Redis is disabled, skipping check.`);
        return null;
    }
}
exports.getStoredClientContext = getStoredClientContext;
const captureConvertContextController = async (req, res) => {
    try {
        let contextData;
        if (typeof req.body === 'string' && req.body.length > 0) {
            contextData = JSON.parse(req.body);
        }
        else {
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
                .filter(b => !!(b && b.experienceId && b.variationId))
                .map(b => ({ experimentId: b.experienceId, variationId: b.variationId }))
            : [];
        if (bucketingToStore.length === 0) {
            return res.status(200).json({ message: "Context received, but no valid bucketing data to store." });
        }
        const infoToStore = {
            convertVisitorId: convertVisitorId,
            convertBucketing: bucketingToStore,
            timestamp: Date.now(),
            zidPagePath: zidPagePath
        };
        // ==========================================================================================
        // === DEFINITIVE ADDITION: Store the data in both Redis and the local cache ==============
        // ==========================================================================================
        const infoToStoreString = JSON.stringify(infoToStore);
        if (redis) {
            if (zidCustomerId) {
                await redis.set(zidCustomerId, infoToStoreString, 'EX', CONTEXT_EXPIRATION_SECONDS);
                console.log(`Stored/Updated context in Redis for zidCustomerId: '${zidCustomerId}'.`);
            }
            await redis.set(convertVisitorId, infoToStoreString, 'EX', CONTEXT_EXPIRATION_SECONDS);
            console.log(`Stored/Updated context in Redis for convertVisitorId: '${convertVisitorId}'.`);
        }
        else {
            console.log(`[Redis] Redis is disabled, skipping permanent store.`);
        }
        // ==========================================================================================
        // Your existing in-memory logic is PRESERVED
        if (zidCustomerId) {
            clientContextStore[zidCustomerId] = infoToStore;
            console.log(`Stored/Updated context in LOCAL MEMORY for zidCustomerId: '${zidCustomerId}'.`);
        }
        clientContextStore[convertVisitorId] = infoToStore;
        console.log(`Stored/Updated context in LOCAL MEMORY for convertVisitorId: '${convertVisitorId}'.`);
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
            return res.status(400).json({ message: "Convert Visitor ID or Zid Order ID is required in signal." });
        }
        if (payload.zidOrderId && payload.experiments && Array.isArray(payload.experiments) && payload.experiments.length > 0 && payload.convertVisitorId) {
            const orderContextKey = `orderctx_${payload.zidOrderId}`;
            const validExperimentsForOrder = payload.experiments.filter(b => b.experimentId && b.variationId);
            if (validExperimentsForOrder.length > 0) {
                const infoToStore = {
                    convertVisitorId: payload.convertVisitorId,
                    convertBucketing: validExperimentsForOrder,
                    timestamp: Date.now(),
                };
                // Store in both Redis and local memory
                if (redis) {
                    await redis.set(orderContextKey, JSON.stringify(infoToStore), 'EX', CONTEXT_EXPIRATION_SECONDS);
                    console.log(`Purchase signal: Stored experiment context in Redis for Zid Order ID '${payload.zidOrderId}'.`);
                }
                clientContextStore[orderContextKey] = infoToStore;
                console.log(`Purchase signal: Stored experiment context in LOCAL MEMORY for Zid Order ID '${payload.zidOrderId}'.`);
            }
        }
        if (payload.convertVisitorId) {
            // ... (The rest of your logic for sending to Convert is preserved and correct)
            res.status(200).json({ message: "Purchase signal processed." });
        }
        else {
            res.status(200).json({ message: "Purchase signal received, but no hitGoal sent." });
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
