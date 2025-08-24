// src/controllers/api/convertContextController.ts
import { Request, Response } from 'express';
import { ConvertApiService, Visitor, Event, BucketingEventData, ConversionEventData, Product } from '../../services/convert-service';
import { saveContext } from '../../services/firestore-service';
import * as admin from 'firebase-admin';
import { StoredBucketingInfo as FirestoreStoredBucketingInfo, StoredConvertBucketingEntry } from '../../types/index';

interface ConvertClientContextPayload {
    zidPagePath: string;
    convertVisitorId?: string | null;
    convertBucketing?: Array<{ experienceId?: string; variationId?: string; }>;
    zidCustomerId?: string | null;
}

// This local interface is for the in-memory store.
export interface StoredBucketingInfo {
    convertVisitorId: string;
    convertBucketing: Array<{ experimentId: string; variationId: string; }>;
    timestamp: number;
    zidPagePath?: string;
}

const clientContextStore: Record<string, StoredBucketingInfo> = {};

function getClientIp(req: Request): string | undefined {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string') {
        return forwardedFor.split(',')[0].trim();
    }
    return req.ip || req.socket.remoteAddress;
}


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
        const clientIp = getClientIp(req);

        let contextData: ConvertClientContextPayload;

        if (typeof req.body === 'string' && req.body.length > 0) {
            contextData = JSON.parse(req.body);
        } else {
            contextData = req.body as ConvertClientContextPayload;
        }
        
        const { zidCustomerId, convertVisitorId, convertBucketing, zidPagePath } = contextData;

        if (!convertVisitorId) {
            console.warn("/api/capture-convert-context: No convertVisitorId provided. Cannot store context.");
            return res.status(200).json({ message: "Context ignored, missing convertVisitorId." });
        }

        const bucketingToStore: Array<{ experimentId: string; variationId: string; }> =
            (Array.isArray(convertBucketing))
                ? convertBucketing
                    .filter((b): b is { experienceId: string, variationId: string } =>
                        !!(b && b.experienceId && b.variationId)
                    )
                    .map(b => ({
                        // --- FIX 1: Corrected typo from b.experimentId to b.experienceId ---
                        experimentId: b.experienceId,
                        variationId: b.variationId
                    }))
                : [];

        // This interface is only for the in-memory object, which we are preserving.
        interface InMemoryStoredBucketingInfo {
             convertVisitorId: string;
             convertBucketing: Array<{ experimentId: string; variationId: string; }>;
             timestamp: number;
             zidPagePath?: string;
        }

        const infoToStoreInMemory: InMemoryStoredBucketingInfo = {
            convertVisitorId: convertVisitorId,
            convertBucketing: bucketingToStore,
            timestamp: Date.now(),
            zidPagePath: zidPagePath
        };
        
        if (zidCustomerId) {
            clientContextStore[zidCustomerId] = infoToStoreInMemory as any;
        }
        clientContextStore[convertVisitorId] = infoToStoreInMemory as any;

        const infoToStoreForFirestore: FirestoreStoredBucketingInfo = {
            convertVisitorId: convertVisitorId,
            zidCustomerId: zidCustomerId ?? null, 
            ipAddress: clientIp ?? null,
            convertBucketing: bucketingToStore.map((b): StoredConvertBucketingEntry => ({
                experienceId: parseInt(b.experimentId), 
                variationId: parseInt(b.variationId)    
            })),
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            zidPagePath: zidPagePath
        };
        
        await saveContext(infoToStoreForFirestore);
        console.log(`Context saved to FIRESTORE for convertVisitorId: '${convertVisitorId}' | zidCustomerId: '${zidCustomerId || 'N/A'}' | IP: '${clientIp || 'N/A'}'`);
        
        res.status(200).json({ message: "Convert context received and stored successfully." });

    } catch (error) {
        const err = error as Error;
        console.error("Error processing /api/capture-convert-context:", err.message, err.stack);
        res.status(500).json({ message: "Error processing request on server." });
    }
};

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
            return res.status(400).json({ message: "Convert Visitor ID or Zid Order ID is required in signal." });
        }

        if (payload.zidOrderId && payload.experiments && Array.isArray(payload.experiments) && payload.experiments.length > 0 && payload.convertVisitorId) {
            const orderContextKey = `orderctx_${payload.zidOrderId}`;
            const validExperimentsForOrder = payload.experiments.filter(
                (b): b is { experimentId: string; variationId: string; } =>
                    !!(b && b.experimentId && b.variationId)
            );

            if (validExperimentsForOrder.length > 0) {
                clientContextStore[orderContextKey] = {
                    convertVisitorId: payload.convertVisitorId,
                    convertBucketing: validExperimentsForOrder,
                    timestamp: Date.now(),
                };
                console.log(`Purchase signal: Stored IN-MEMORY experiment context for Zid Order ID '${payload.zidOrderId}'.`);

                const infoToStoreForFirestore: FirestoreStoredBucketingInfo = {
                    convertVisitorId: payload.convertVisitorId,
                    convertBucketing: validExperimentsForOrder.map((b): StoredConvertBucketingEntry => ({
                        experienceId: parseInt(b.experimentId),
                        variationId: parseInt(b.variationId)
                    })),
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    zidPagePath: undefined
                };
                await saveContext(infoToStoreForFirestore);
                console.log(`Purchase signal: Stored FIRESTORE experiment context for convertVisitorId '${payload.convertVisitorId}' for Zid Order ID '${payload.zidOrderId}'.`);

            } else {
                 console.log(`Purchase signal: Received Zid Order ID '${payload.zidOrderId}' but experiments array was empty or invalid after filtering.`);
            }
        } else if (payload.zidOrderId) {
            console.log(`Purchase signal: Received Zid Order ID '${payload.zidOrderId}' but no experiments data in payload to store for it.`);
        }

        if (payload.convertVisitorId) {
            const convertGoalIdString = process.env.CONVERT_GOAL_ID_FOR_PURCHASE;

            if (!convertGoalIdString) { 
                return res.status(500).json({ message: "Server configuration error for Convert tracking." });
            }
            const convertGoalId = parseInt(convertGoalIdString, 10);
            if (isNaN(convertGoalId)) { 
                return res.status(500).json({ message: "Server configuration error: Invalid Convert Goal ID." });
            }

            const newModernHitGoalTid = `signal-metrics-v1-${payload.convertVisitorId}-${payload.zidOrderId || 'noOrder'}-${Date.now()}`;

            const bucketingEvents: Event[] = payload.experiments
                .filter(exp => exp.experimentId && exp.variationId) 
                .map(exp => ({
                    eventType: 'bucketing',
                    data: {
                        experienceId: exp.experimentId!, 
                        variationId: exp.variationId!
                    } as BucketingEventData
                }));

            const conversionEvent: Event = {
                eventType: 'conversion',
                data: {
                    goalId: convertGoalId,
                    transactionId: newModernHitGoalTid,
                } as ConversionEventData
            };
            
            const visitorPayload: Visitor = {
                visitorId: payload.convertVisitorId,
                events: [...bucketingEvents, conversionEvent]
            };

            console.log("Purchase signal: Preparing NEW v1/track METRICS API payload to Convert:", JSON.stringify(visitorPayload, null, 2));
            
            await ConvertApiService.sendMetricsV1ApiEvents(visitorPayload);

            res.status(200).json({ message: "Purchase signal processed, context stored by order ID (if provided & valid experiments), Convert API events dispatched." });
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

// --- FIX 2: Added 'export' keyword to make the function available for import ---
export const getClientIpController = (req: Request, res: Response) => {
    const clientIp = getClientIp(req);
    if (clientIp) {
        res.status(200).json({ ipAddress: clientIp });
    } else {
        res.status(500).json({ error: "Could not determine client IP address." });
    }
};


export const ADDITIVE_DIAGNOSTIC_NAMED_EXPORT = "Hello from ADDITIVE_DIAGNOSTIC_NAMED_EXPORT";
const additiveDiagnosticDefaultObject = {
    ADDITIVE_DEFAULT_DIAGNOSTIC_PROPERTY: "Hello from additive default export in convertContextController"
};
export default additiveDiagnosticDefaultObject;