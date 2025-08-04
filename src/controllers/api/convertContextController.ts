// src/controllers/api/convertContextController.ts
import { Request, Response } from 'express';
import { ConvertApiService, ConvertTrackPayload } from '../../services/convert-service';

interface ConvertClientContextPayload {
    zidPagePath: string;
    convertVisitorId?: string | null;
    convertBucketing?: Array<{ experienceId?: string; variationId?: string; }>;
    zidCustomerId?: string | null;
}

// ==========================================================================================
// === DEFINITIVE FIX #1: The stored object MUST include the Convert Visitor ID =============
// ==========================================================================================
export interface StoredBucketingInfo {
    convertVisitorId: string; // The ID from Convert's cookie, essential for the webhook
    convertBucketing: Array<{ experimentId: string; variationId: string; }>;
    timestamp: number;
    zidPagePath?: string;
}
// ==========================================================================================
// === END OF FIX #1 ========================================================================
// ==========================================================================================

const clientContextStore: Record<string, StoredBucketingInfo> = {};

export function getStoredClientContext(key: string): StoredBucketingInfo | undefined {
    const context = clientContextStore[key];
    if (context) {
        console.log(`DEBUG: getStoredClientContext - Context FOUND for key "${key}". Bucketing:`, context.convertBucketing ? JSON.stringify(context.convertBucketing) : "Bucketing data missing in context");
    } else {
        console.log(`DEBUG: getStoredClientContext - Context NOT FOUND for key "${key}". Current store keys: [${Object.keys(clientContextStore).join(', ')}]`);
    }
    return context;
}

export const captureConvertContextController = async (req: Request, res: Response) => {
    try {
        let contextData: ConvertClientContextPayload;

        if (typeof req.body === 'string' && req.body.length > 0) {
            console.log('[capture-convert-context] Received text body, attempting to parse as JSON.');
            contextData = JSON.parse(req.body);
        } else {
            console.log('[capture-convert-context] Received pre-parsed JSON body.');
            contextData = req.body as ConvertClientContextPayload;
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

        const bucketingToStore: Array<{ experimentId: string; variationId: string; }> =
            (Array.isArray(convertBucketing))
                ? convertBucketing
                    .filter(
                        (b): b is { experienceId: string, variationId: string } =>
                            !!(b && b.experienceId && b.variationId)
                    )
                    .map(b => ({
                        experimentId: b.experienceId!,
                        variationId: b.variationId!
                    }))
                : [];

        if (bucketingToStore.length === 0) {
            return res.status(200).json({ message: "Context received, but no valid bucketing data to store." });
        }

        // DEFINITIVE FIX #3: Add the convertVisitorId to the object we store.
        const infoToStore: StoredBucketingInfo = {
            convertVisitorId: convertVisitorId, // Storing the essential ID
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

    } catch (error) {
        const err = error as Error;
        console.error("Error processing /api/capture-convert-context:", err.message, err.stack);
        res.status(500).json({ message: "Error processing request on server." });
    }
};

// ==========================================================================================
// === YOUR EXISTING CODE IS PRESERVED BELOW ================================================
// ==========================================================================================
interface PurchaseSignalPayload {
    convertVisitorId: string | null;
    experiments: Array<{ experimentId: string; variationId: string; }>;
    zidOrderId?: string | null;
}

export const handlePurchaseSignalController = async (req: Request, res: Response) => {
    try {
        const payload = req.body as PurchaseSignalPayload;
        console.log("Received /api/signal-purchase payload:", JSON.stringify(payload, null, 2));

        if (!payload.convertVisitorId && !payload.zidOrderId) {
            console.warn("/api/signal-purchase: Convert Visitor ID or Zid Order ID is required in signal. Payload:", payload);
            return res.status(400).json({ message: "Convert Visitor ID or Zid Order ID is required in signal." });
        }

        // Minor fix: Added convertVisitorId to the stored object here as well for consistency
        if (payload.zidOrderId && payload.experiments && Array.isArray(payload.experiments) && payload.experiments.length > 0 && payload.convertVisitorId) {
            const orderContextKey = `orderctx_${payload.zidOrderId}`;
            const validExperimentsForOrder = payload.experiments.filter(
                b => b.experimentId && typeof b.experimentId === 'string' && b.variationId && typeof b.variationId === 'string'
            ) as Array<{ experimentId: string; variationId: string; }>;

            if (validExperimentsForOrder.length > 0) {
                // MODIFIED to include the convertVisitorId
                clientContextStore[orderContextKey] = {
                    convertVisitorId: payload.convertVisitorId,
                    convertBucketing: validExperimentsForOrder,
                    timestamp: Date.now(),
                };
                console.log(`Purchase signal: Stored experiment context for Zid Order ID '${payload.zidOrderId}'.`);
            } else {
                 console.log(`Purchase signal: Received Zid Order ID '${payload.zidOrderId}' but experiments array was empty or invalid after filtering.`);
            }
        } else if (payload.zidOrderId) {
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

            const experienceIds = payload.experiments.map(function(exp) { return exp.experimentId; }).filter(function(id) { return !!id; });
            const variationIds = payload.experiments.map(function(exp) { return exp.variationId; }).filter(function(id) { return !!id; });

            const commonPayloadParts = {
                cid: convertAccountId as string,
                pid: convertProjectId as string,
                vid: payload.convertVisitorId,
            };
            const eventSpecifics: { goals: number[]; exps?: string[]; vars?: string[] } = { goals: [convertGoalId] };
            if (experienceIds.length > 0 && variationIds.length > 0 && experienceIds.length === variationIds.length) {
                eventSpecifics.exps = experienceIds as string[];
                eventSpecifics.vars = variationIds as string[];
            }

            const hitGoalTid = `signal-hitGoal-${payload.convertVisitorId}-${payload.zidOrderId || 'noOrder'}-${Date.now()}`;
            const hitGoalPayload: ConvertTrackPayload = {
                ...commonPayloadParts,
                tid: hitGoalTid,
                ev: [{ evt: 'hitGoal' as 'hitGoal', ...eventSpecifics }]
            };
            console.log("Purchase signal: Preparing 'hitGoal' event to Convert:", JSON.stringify(hitGoalPayload, null, 0));
            await ConvertApiService.sendEventToConvert(hitGoalPayload);
            res.status(200).json({ message: "Purchase signal processed, context stored by order ID (if provided & valid experiments), Convert 'hitGoal' dispatched if visitorId present." });
        } else {
            console.log("Purchase signal: No convertVisitorId in payload, so hitGoal to Convert API was skipped. Context may have been stored by orderId if provided.");
            res.status(200).json({ message: "Purchase signal received, context stored by order ID (if provided and experiments present). No hitGoal sent due to missing convertVisitorId." });
        }
    } catch (error) {
        const err = error as Error;
        console.error("Error processing /api/signal-purchase request:", err.message, err.stack);
        res.status(500).json({ message: "Error processing purchase signal request on server." });
    }
};

export const ADDITIVE_DIAGNOSTIC_NAMED_EXPORT = "Hello from ADDITIVE_DIAGNOSTIC_NAMED_EXPORT";
const additiveDiagnosticDefaultObject = {
    ADDITIVE_DEFAULT_DIAGNOSTIC_PROPERTY: "Hello from additive default export in convertContextController"
};
export default additiveDiagnosticDefaultObject;