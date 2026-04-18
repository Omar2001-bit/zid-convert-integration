// src/controllers/zid/auth/callback.ts
import { Request, Response } from 'express';
import { ZidApiService } from '../../../services/zid-service';
// Updated import: Removed ConvertTrackPayload as it's no longer used, kept modern interfaces
import { ConvertApiService, Visitor, Event, BucketingEventData, ConversionEventData, Product } from '../../../services/convert-service';
// Original import for in-memory store fallback
import { getStoredClientContext, StoredBucketingInfo as InMemoryStoredBucketingInfo } from '../../api/convertContextController';
// CORRECTED IMPORT: StoredBucketingInfo, StoredConvertBucketingEntry, ZidProduct, AND NormalizedBucketingInfo from types/index
import { StoredBucketingInfo as FirestoreStoredBucketingInfo, StoredConvertBucketingEntry, ZidProduct, NormalizedBucketingInfo, ConvertCredentials } from '../../../types/index';
import { getStoreConfig, saveStoreConfig } from '../../../services/store-config-service';
// Added: Import Firestore service functions (these are still needed directly here as they perform the actual DB calls)
import { getContextByConvertVisitorId, getContextByZidCustomerId } from '../../../services/firestore-service';
import { CurrencyService } from '../../../services/currency-service';
import * as admin from 'firebase-admin'; // Added: Import admin to handle Firestore Timestamps

// Removed: interface BucketingEntry as it's replaced by NormalizedBucketingInfo's structure for bucketing items

const DEFAULT_REPORTING_CURRENCY = 'SAR';

export const zidAuthCallbackController = async (req: Request, res: Response) => {
    const code = req.query.code as string;

    if (!code) {
        console.error("ZidAuthCallback: Authorization code not provided.");
        return res.status(400).send("Authorization code is required.");
    }

    try {
        console.log(`ZidAuthCallback: Received authorization code.`);
        const tokens = await ZidApiService.getTokensByCode(code);

        if (!tokens || !tokens.access_token || !tokens.authorization) {
            console.error("ZidAuthCallback: Failed to obtain necessary tokens from Zid.", tokens);
            return res.status(500).send("Failed to exchange code for complete tokens with Zid.");
        }

        const xManagerToken = tokens.access_token;
        const authorizationJwt = tokens.authorization;
        console.log("ZidAuthCallback: Tokens obtained successfully.");

        // --- Store-aware webhook registration ---
        let detectedStoreId: string | null = null;
        try {
            if (!process.env.MY_BACKEND_URL) {
                console.error("ZidAuthCallback: MY_BACKEND_URL not set in .env. Cannot create Zid webhook.");
            } else {
                // Try to get merchant profile to detect store_id
                try {
                    const profile = await ZidApiService.getMerchantProfile(xManagerToken, authorizationJwt);
                    if (profile?.store?.id) {
                        detectedStoreId = profile.store.id.toString();
                        console.log(`ZidAuthCallback: Detected store ID from profile: ${detectedStoreId}`);
                    }
                } catch (profileErr) {
                    console.warn("ZidAuthCallback: Could not fetch merchant profile for store detection:", (profileErr as Error).message);
                }

                // Look up or create store config for webhook token
                let webhookToken: string;
                if (detectedStoreId) {
                    const existingConfig = await getStoreConfig(detectedStoreId);
                    if (existingConfig) {
                        webhookToken = existingConfig.zidWebhookSecretToken;
                        console.log(`ZidAuthCallback: Using existing webhook token for store ${detectedStoreId}`);
                    } else {
                        // Create skeleton store config — Convert credentials must be added later via admin endpoint
                        webhookToken = `token_${Math.random().toString(36).substring(2, 15)}`;
                        await saveStoreConfig({
                            storeId: detectedStoreId,
                            storeName: 'Pending Setup',
                            storeDomain: '',
                            convertAccountId: '',
                            convertProjectId: '',
                            convertApiKeySecret: '',
                            convertGoalIdForPurchase: 0,
                            zidWebhookSecretToken: webhookToken,
                            checkoutConfig: {
                                emailSelectors: ['#inputEmail', 'input[name="email"]', 'input[type="email"]'],
                                phoneSelectors: ['#mobile', 'input[name="mobile"]', 'input[type="tel"]'],
                                checkoutUrlKeywords: ['checkout', 'payment', '/cart'],
                                guestLoginPattern: { path: '/auth/login', search: 'checkout' }
                            },
                            active: false // Inactive until Convert credentials are added
                        });
                        console.log(`ZidAuthCallback: Created SKELETON store config for store ${detectedStoreId}. Convert credentials must be added via admin endpoint.`);
                    }
                } else {
                    // Fallback to env var if store ID couldn't be detected
                    webhookToken = process.env.ZID_WEBHOOK_SECRET_TOKEN || '';
                    if (!webhookToken) {
                        console.error("ZidAuthCallback: No webhook token available. Cannot create secure webhook.");
                    }
                }

                if (webhookToken) {
                    const webhookTargetUrl = `${process.env.MY_BACKEND_URL}/webhooks/zid/order-events?token=${webhookToken}`;

                    const webhookPayload = {
                        event: "order.create",
                        target_url: webhookTargetUrl,
                        original_id: "zid_convert_order_create_integration_v1",
                        subscriber: "Zid-Convert Integration App"
                    };

                    console.log(`ZidAuthCallback: Creating webhook for store ${detectedStoreId || 'unknown'} to target: ${webhookTargetUrl}`);
                    await ZidApiService.createWebhookSubscription(xManagerToken, authorizationJwt, webhookPayload);
                }
            }
        } catch (webhookError) {
            const err = webhookError as Error;
            console.error("ZidAuthCallback: Error during Zid webhook subscription:", err.message);
        }

        try {
            console.log("ZidAuthCallback: Attempting to fetch Zid orders...");
            const ordersResponse = await ZidApiService.getOrders(xManagerToken, authorizationJwt, 1, 20);

            if (ordersResponse && ordersResponse.orders && Array.isArray(ordersResponse.orders) && ordersResponse.orders.length > 0) {
                const fetchedZidOrders = ordersResponse.orders;
                console.log(`ZidAuthCallback: Fetched ${fetchedZidOrders.length} Zid Orders. Processing for Convert...`);

                // Look up store config for Convert credentials
                const storeConfigForOrders = detectedStoreId ? await getStoreConfig(detectedStoreId) : null;
                const convertGoalId = storeConfigForOrders?.convertGoalIdForPurchase
                    || parseInt(process.env.CONVERT_GOAL_ID_FOR_PURCHASE || '0', 10);
                const convertCreds: ConvertCredentials | undefined = storeConfigForOrders ? {
                    accountId: storeConfigForOrders.convertAccountId,
                    projectId: storeConfigForOrders.convertProjectId,
                    apiKeySecret: storeConfigForOrders.convertApiKeySecret
                } : undefined;

                const reportingCurrency = storeConfigForOrders?.reportingCurrency || DEFAULT_REPORTING_CURRENCY;

                if (!convertGoalId) {
                    console.error("ZidAuthCallback: Convert Goal ID not configured (neither in store config nor .env).");
                } else {
                        for (const zidOrder of fetchedZidOrders) {
                            const orderLogPrefix = `[ZidOrder ${zidOrder.id}, Cust ${zidOrder.customer?.id || 'N/A'}]`;
                            console.log(`--- ${orderLogPrefix} Processing for Convert (Goal ID: ${convertGoalId}) ---`);
                            
                            const zidCustomerId = zidOrder.customer?.id?.toString();
                            if (!zidCustomerId) {
                                console.warn(`${orderLogPrefix} Zid Customer ID missing. Skipping Convert events.`);
                                continue;
                            }
                            
                            // Removed: experienceIdsToUse and variationIdsToUse declarations as they are now handled by normalization
                            let bucketingEventsForConvert: Event[] = []; 
                            let attributionSource = "Initial: No Stored Context"; 
                            let pagePathForLog = 'Unknown';
                            
                            // ==========================================================================================
                            // === MODIFIED: Prioritize Firestore lookup, then fallback to in-memory, normalizing data ===
                            // ==========================================================================================
                            let storedContextData: NormalizedBucketingInfo | null | undefined = undefined;

                            // 1. Try fetching from Firestore by zidCustomerId
                            const firestoreDataByCustomerId = await getContextByZidCustomerId(zidCustomerId);
                            if (firestoreDataByCustomerId) {
                                attributionSource = 'Firestore (by zidCustomerId)';
                                storedContextData = {
                                    convertVisitorId: firestoreDataByCustomerId.convertVisitorId,
                                    // --- FIX 1 of 2: Convert null to undefined to match the expected type ---
                                    zidCustomerId: firestoreDataByCustomerId.zidCustomerId ?? undefined,
                                    convertBucketing: firestoreDataByCustomerId.convertBucketing.map(b => ({
                                        experimentId: String(b.experienceId),
                                        variationId: String(b.variationId)
                                    })),
                                    timestamp: (firestoreDataByCustomerId.timestamp instanceof admin.firestore.Timestamp) ? firestoreDataByCustomerId.timestamp.toMillis() : (firestoreDataByCustomerId.timestamp as number),
                                    zidPagePath: firestoreDataByCustomerId.zidPagePath
                                };
                            } else {
                                const orderContextKey = `orderctx_${zidOrder.id}`;
                                console.log(`${orderLogPrefix} Context not found in Firestore via zidCustomerId. Attempting lookup by orderId key: ${orderContextKey} in Firestore.`);
                                
                                // 2. If not found, try fetching from Firestore by specific order ID key
                                const firestoreDataByOrderId = await getContextByConvertVisitorId(orderContextKey);
                                if (firestoreDataByOrderId) {
                                    attributionSource = 'Firestore (by orderId context key)';
                                    storedContextData = {
                                        convertVisitorId: firestoreDataByOrderId.convertVisitorId,
                                        // --- FIX 2 of 2: Convert null to undefined to match the expected type ---
                                        zidCustomerId: firestoreDataByOrderId.zidCustomerId ?? undefined,
                                        convertBucketing: firestoreDataByOrderId.convertBucketing.map(b => ({
                                            experimentId: String(b.experienceId),
                                            variationId: String(b.variationId)
                                        })),
                                        timestamp: (firestoreDataByOrderId.timestamp instanceof admin.firestore.Timestamp) ? firestoreDataByOrderId.timestamp.toMillis() : (firestoreDataByOrderId.timestamp as number),
                                        zidPagePath: firestoreDataByOrderId.zidPagePath
                                    };
                                } else {
                                    console.log(`${orderLogPrefix} Context not found in Firestore via orderId. Falling back to in-memory store.`);
                                    // 3. Fallback to in-memory store by zidCustomerId
                                    const inMemoryDataByCustomerId = getStoredClientContext(zidCustomerId); 
                                    if (inMemoryDataByCustomerId) {
                                        attributionSource = "In-Memory (by zidCustomerId)";
                                        storedContextData = {
                                            convertVisitorId: inMemoryDataByCustomerId.convertVisitorId,
                                            zidCustomerId: undefined, // In-memory interface doesn't explicitly store this
                                            convertBucketing: inMemoryDataByCustomerId.convertBucketing.map(b => ({
                                                experimentId: b.experimentId,
                                                variationId: b.variationId
                                            })),
                                            timestamp: inMemoryDataByCustomerId.timestamp,
                                            zidPagePath: inMemoryDataByCustomerId.zidPagePath
                                        };
                                    } else {
                                        // 4. Fallback to in-memory store by orderId key
                                        const inMemoryDataByOrderId = getStoredClientContext(orderContextKey);
                                        if (inMemoryDataByOrderId) {
                                            attributionSource = "In-Memory (by orderId from purchase signal)";
                                            storedContextData = {
                                                convertVisitorId: inMemoryDataByOrderId.convertVisitorId,
                                                zidCustomerId: undefined, // In-memory interface doesn't explicitly store this
                                                convertBucketing: inMemoryDataByOrderId.convertBucketing.map(b => ({
                                                    experimentId: b.experimentId,
                                                    variationId: b.variationId
                                                })),
                                                timestamp: inMemoryDataByOrderId.timestamp,
                                                zidPagePath: inMemoryDataByOrderId.zidPagePath
                                            };
                                        } else {
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
                                const validBuckets = storedContextData.convertBucketing.filter(
                                    (b: { experimentId: string; variationId: string; }) => { // Explicitly type 'b' for filtering
                                        const hasExpId = typeof b.experimentId === 'string' && b.experimentId.trim().length > 0;
                                        const hasVarId = typeof b.variationId === 'string' && b.variationId.trim().length > 0;
                                        return hasExpId && hasVarId;
                                    }
                                );
                                console.log(`${orderLogPrefix} DEBUG: validBuckets array length after filter: ${validBuckets.length}`);
                                console.log(`${orderLogPrefix} DEBUG: validBuckets content after filter:`, JSON.stringify(validBuckets));

                                if (validBuckets.length > 0) {
                                    // Removed: experienceIdsToUse and variationIdsToUse mapping as they are no longer needed
                                    // The BucketingEventData expects strings, which are now guaranteed by NormalizedBucketingInfo
                                    bucketingEventsForConvert = validBuckets.map((b: { experimentId: string; variationId: string; }) => ({
                                        eventType: 'bucketing',
                                        data: {
                                            experienceId: b.experimentId, // These are now strings from normalization
                                            variationId: b.variationId     // These are now strings from normalization
                                        } as BucketingEventData
                                    }));
                                    
                                    console.log(`${orderLogPrefix} Using ExpIDs from ${attributionSource} (Page: ${pagePathForLog}): [${validBuckets.map(b => b.experimentId).join(', ')}] and VarIDs: [${validBuckets.map(b => b.variationId).join(', ')}]`);

                                } else {
                                    attributionSource = attributionSource.includes("Filtered") ? attributionSource : "Stored Context but Filtered to No Valid Buckets";
                                    console.log(`${orderLogPrefix} ${attributionSource} for Zid Customer ID ${zidCustomerId}.`);
                                }
                            } else {
                                console.log(`${orderLogPrefix} ${attributionSource} for Zid Customer ID ${zidCustomerId}. No usable experiment data.`);
                            }
                            
                            const uniqueTransactionIdForOrder = `zid-order-${zidOrder.id}-${Date.now()}`;
                            // Removed eventSpecifics as it was only for the removed legacy API calls
                            // Removed hitGoalPayload creation and call to ConvertApiService.sendEventToConvert
                            
                            const originalOrderTotal = parseFloat(zidOrder.order_total || "0");
                            const originalCurrencyCode = zidOrder.currency_code || reportingCurrency;
                            let revenueForConvertAPI = 0;

                            if (originalOrderTotal > 0) {
                                try {
                                    revenueForConvertAPI = await CurrencyService.convertTo(originalOrderTotal, originalCurrencyCode, reportingCurrency);
                                    console.log(`${orderLogPrefix} Converted ${originalOrderTotal} ${originalCurrencyCode} to ${revenueForConvertAPI} ${reportingCurrency}.`);
                                } catch (conversionError) {
                                    console.error(`${orderLogPrefix} Currency conversion error. Using original amount. Error:`, conversionError as Error);
                                    revenueForConvertAPI = parseFloat(originalOrderTotal.toFixed(2));
                                }
                            }
                            
                            // Removed productCount calculation if only used for legacy 'tr' event
                            // Removed transactionPayload creation and call to ConvertApiService.sendEventToConvert

                            if (revenueForConvertAPI > 0) { // Condition simplified to check revenue for sending conversion
                                // --- NEW MODERN METRICS V1 API CALL (Conversion event) ---
                                // Products array for the new API payload
                                let productsForNewPayload: Product[] = [];
                                if (zidOrder.products && Array.isArray(zidOrder.products)) {
                                    productsForNewPayload = await Promise.all(
                                        zidOrder.products.map(async (product: ZidProduct) => { // Explicitly type 'product'
                                            const itemPrice = parseFloat(String(product.price)) || 0;
                                            const convertedItemPrice = await CurrencyService.convertTo(itemPrice, originalCurrencyCode, reportingCurrency);
                                            return {
                                                productId: product.sku || String(product.id),
                                                productName: product.name,
                                                unitPrice: convertedItemPrice,
                                                quantity: parseInt(String(product.quantity), 10) || 0
                                            } as Product;
                                        })
                                    );
                                }

                                const newModernConversionEvent: Event = {
                                    eventType: 'conversion',
                                    data: {
                                        goalId: convertGoalId,
                                        transactionId: uniqueTransactionIdForOrder,
                                        revenue: revenueForConvertAPI,
                                        products: productsForNewPayload
                                    } as ConversionEventData
                                };

                                // Combine bucketing events (if any) and the new conversion event for the visitor payload
                                const newModernVisitorPayload: Visitor = {
                                    visitorId: zidCustomerId, // Use zidCustomerId as visitor ID
                                    events: [...bucketingEventsForConvert, newModernConversionEvent]
                                };

                                console.log(`${orderLogPrefix} Preparing NEW v1/track METRICS API payload (Conversion):`, JSON.stringify(newModernVisitorPayload, null, 2));
                                await ConvertApiService.sendMetricsV1ApiEvents(newModernVisitorPayload, convertCreds);
                                // --- END NEW MODERN METRICS V1 API CALL (conversion event) ---

                            } else {
                                console.log(`${orderLogPrefix} Skipping new 'conversion' event as revenue is zero.`);
                            }
                            console.log(`--- ${orderLogPrefix} Finished Convert API calls for this order ---`); // Simplified log
                        }
                }
            }
        } catch (apiError) {
            const err = apiError as Error;
            console.error("ZidAuthCallback: Error during Zid order/Convert event processing:", err.message, err.stack);
        }

        const dashboardUrl = process.env.YOUR_APP_DASHBOARD_URL || '/';
        console.log(`ZidAuthCallback: Redirecting to dashboard: ${dashboardUrl}`);
        res.redirect(dashboardUrl);

    } catch (error) {
        const err = error as Error;
        console.error("ZidAuthCallback: Outer error processing Zid OAuth callback:", err.message, err.stack);
        res.status(500).send("An error occurred during Zid authentication callback.");
    }
};