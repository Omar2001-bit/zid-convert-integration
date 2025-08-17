// src/controllers/api/convertContextController.ts
import { Request, Response } from 'express';
// Added new interfaces from convert-service to allow construction of the modern payload
import { ConvertApiService, ConvertTrackPayload, Visitor, Event, BucketingEventData, ConversionEventData, Product } from '../../services/convert-service';

interface ConvertClientContextPayload {
    zidPagePath: string;
    convertVisitorId?: string | null;
    convertBucketing?: Array<{ experienceId?: string; variationId?: string; }>;
    zidCustomerId?: string | null;
}

// This interface is correct for the in-memory solution.
export interface StoredBucketingInfo {
    convertVisitorId: string;
    convertBucketing: Array<{ experimentId: string; variationId: string; }>; // Uses 'experimentId'
    timestamp: number;
    zidPagePath?: string;
}

const clientContextStore: Record<string, StoredBucketingInfo> = {};

// The function is now synchronous again as it only reads from a local object.
export function getStoredClientContext(key: string): StoredBucketingInfo | undefined {
    console.log(`DEBUG: getStoredClientContext called with key: "${key}" (type: ${typeof key})`);
    if (!key) {
        console.log("DEBUG: getStoredClientContext - key is null/undefined, returning undefined.");
        return undefined;
    }
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

        if (!convertVisitorId) {
            console.warn("/api/capture-convert-context: No convertVisitorId provided. Cannot store context.");
            console.log("--> Failing payload dump:", JSON.stringify(contextData));
            return res.status(200).json({ message: "Context ignored, missing convertVisitorId." });
        }

        const bucketingToStore: Array<{ experimentId: string; variationId: string; }> =
            (Array.isArray(convertBucketing))
                ? convertBucketing
                    // CORRECTED: Ensure we filter based on existence of properties from the input payload (experienceId)
                    .filter((b): b is { experienceId: string, variationId: string } =>
                        !!(b && b.experienceId && b.variationId)
                    )
                    .map(b => ({
                        // CORRECTED: Map 'experienceId' from the input to 'experimentId' for storage
                        experimentId: b.experienceId,
                        variationId: b.variationId
                    }))
                : [];

        if (bucketingToStore.length === 0) {
            return res.status(200).json({ message: "Context received, but no valid bucketing data to store." });
        }

        const infoToStore: StoredBucketingInfo = {
            convertVisitorId: convertVisitorId,
            convertBucketing: bucketingToStore,
            timestamp: Date.now(),
            zidPagePath: zidPagePath
        };
        
        // --- Reverted to only storing in the local in-memory object ---
        if (zidCustomerId) {
            clientContextStore[zidCustomerId] = infoToStore;
            console.log(`Stored/Updated context for zidCustomerId: '${zidCustomerId}'.`);
        }
        clientContextStore[convertVisitorId] = infoToStore;
        console.log(`Stored/Updated context for convertVisitorId: '${convertVisitorId}'.`);

        console.log(`Current store keys after update: [${Object.keys(clientContextStore).join(', ')}]`);
        res.status(200).json({ message: "Convert context received and stored successfully." });

    } catch (error) {
        const err = error as Error;
        console.error("Error processing /api/capture-convert-context:", err.message, err.stack);
        res.status(500).json({ message: "Error processing request on server." });
    }
};

// --- handlePurchaseSignalController: Existing code preserved, NEW API call added ---
interface PurchaseSignalPayload {
    convertVisitorId: string | null;
    experiments: Array<{ experimentId: string; variationId: string; }>; // Uses 'experimentId'
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

        if (payload.zidOrderId && payload.experiments && Array.isArray(payload.experiments) && payload.experiments.length > 0 && payload.convertVisitorId) {
            const orderContextKey = `orderctx_${payload.zidOrderId}`;
            const validExperimentsForOrder = payload.experiments.filter(
                (b): b is { experimentId: string; variationId: string; } =>
                    !!(b && b.experimentId && b.variationId)
            );

            if (validExperimentsForOrder.length > 0) {
                // Reverted to only store in the local in-memory object
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

            // --- EXISTING LEGACY API CALL (PRESERVED) ---
            // These variables are used by the preserved legacy API call
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
            console.log("Purchase signal: Preparing 'hitGoal' event to Convert (LEGACY API CALL - PRESERVED):", JSON.stringify(hitGoalPayload, null, 0));
            // This call remains active as per instructions
            await ConvertApiService.sendEventToConvert(hitGoalPayload);
            // --- END EXISTING LEGACY API CALL ---

            // --- NEW MODERN METRICS V1 API CALL (ADDED) ---
            const newModernHitGoalTid = `signal-metrics-v1-${payload.convertVisitorId}-${payload.zidOrderId || 'noOrder'}-${Date.now()}`;

            // Prepare bucketing events from the signal payload
            const bucketingEvents: Event[] = payload.experiments
                // CORRECTED: Use 'exp.experimentId' as defined in PurchaseSignalPayload
                .filter(exp => exp.experimentId && exp.variationId) 
                .map(exp => ({
                    eventType: 'bucketing',
                    data: {
                        // CORRECTED: Map 'experimentId' from payload to 'experienceId' for BucketingEventData
                        experienceId: exp.experimentId!, 
                        variationId: exp.variationId!
                    } as BucketingEventData
                }));

            // Prepare conversion event
            const conversionEvent: Event = {
                eventType: 'conversion',
                data: {
                    goalId: convertGoalId,
                    transactionId: newModernHitGoalTid,
                    // Note: Revenue and products are typically sent with actual order webhooks, not just signals.
                    // Add them here if this signal is expected to contain them.
                } as ConversionEventData
            };
            
            // Combine events for the visitor payload
            const visitorPayload: Visitor = {
                visitorId: payload.convertVisitorId,
                events: [...bucketingEvents, conversionEvent] // Include both bucketing and conversion
            };

            console.log("Purchase signal: Preparing NEW v1/track METRICS API payload to Convert (ADDED):", JSON.stringify(visitorPayload, null, 2));
            
            // Calling the new, correct ConvertApiService.sendMetricsV1ApiEvents
            await ConvertApiService.sendMetricsV1ApiEvents(visitorPayload);
            // --- END NEW MODERN METRICS V1 API CALL ---

            res.status(200).json({ message: "Purchase signal processed, context stored by order ID (if provided & valid experiments), Convert API events dispatched (both legacy and new)." });
        } else {
            console.log("Purchase signal: No convertVisitorId in payload, so Convert API dispatch was skipped. Context may have been stored by orderId if provided.");
            res.status(200).json({ message: "Purchase signal received, context stored by order ID (if provided and experiments present). No Convert events sent due to missing convertVisitorId." });
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