// src/controllers/webhooks/zidOrderEventsController.ts
import { Request, Response } from 'express';
import { ConvertApiService, Event, Visitor } from '../../services/convert-service';
import { CurrencyService } from '../../services/currency-service';
import { getStoredClientContext } from '../api/convertContextController';

const TARGET_REPORTING_CURRENCY = 'SAR';

interface ZidProduct {
    id: string | number;
    sku?: string;
    name: string;
    price: number | string;
    quantity: number | string;
}

interface ConvertProduct {
    id: string;
    name: string;
    price: number;
    qty: number;
}

export const zidOrderEventsWebhookController = async (req: Request, res: Response) => {
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
        } else {
            zidOrder = req.body;
        }
        
        const eventType = 'order.create';

        console.log(`[SUCCESS] Webhook request validated for event: ${eventType}`);

        if (!zidOrder || !zidOrder.id) {
            console.error("Webhook payload did not contain a valid order ID. Body:", zidOrder);
            return;
        }

        const convertAccountId = process.env.CONVERT_ACCOUNT_ID!;
        const convertProjectId = process.env.CONVERT_PROJECT_ID!;
        const convertGoalId = parseInt(process.env.CONVERT_GOAL_ID_FOR_PURCHASE!, 10);

        const orderLogPrefix = `[ZidOrder ${zidOrder.id}, Cust ${zidOrder.customer?.id || 'N/A'}]`;
        console.log(`--- ${orderLogPrefix} [WEBHOOK] Processing for Convert (Goal ID: ${convertGoalId}) ---`);

        const zidCustomerId = zidOrder.customer?.id?.toString();
        if (!zidCustomerId) {
            console.warn(`${orderLogPrefix} [WEBHOOK] Zid Customer ID missing. Skipping Convert events.`);
            return;
        }

        // ==========================================================================================
        // === DEFINITIVE FIX: Removed 'await' as we are reverting to the in-memory store =========
        // ==========================================================================================
        const storedContext = getStoredClientContext(zidCustomerId);
        
        const visitorIdForConvert = storedContext?.convertVisitorId || zidCustomerId;
        console.log(`${orderLogPrefix} Using VID for Convert payload: '${visitorIdForConvert}' (Source: ${storedContext ? 'Stored Context' : 'Fallback to Zid ID'})`);

        const eventsForConvert: Event[] = [];

        if (storedContext && storedContext.convertBucketing.length > 0) {
            console.log(`${orderLogPrefix} Context FOUND. Adding bucketing events.`);
            storedContext.convertBucketing.forEach(bucket => {
                eventsForConvert.push({
                    eventType: 'bucketing',
                    data: {
                        experienceId: bucket.experimentId,
                        variationId: bucket.variationId
                    }
                });
            });
        } else {
            console.log(`${orderLogPrefix} Context NOT found. Conversion will be unattributed.`);
        }
        
        const finalOrderTotal = parseFloat(zidOrder.order_total || "0");
        const originalCurrencyCode = zidOrder.currency_code || TARGET_REPORTING_CURRENCY;
        const revenueForConvertAPI = await CurrencyService.convertToSAR(finalOrderTotal, originalCurrencyCode);

        let productsForPayload: any[] = [];
        if (zidOrder.products && Array.isArray(zidOrder.products)) {
            productsForPayload = await Promise.all(
                zidOrder.products.map(async (product: ZidProduct) => {
                    const itemPrice = parseFloat(String(product.price)) || 0;
                    const convertedItemPrice = await CurrencyService.convertToSAR(itemPrice, originalCurrencyCode);
                    return {
                        productId: product.sku || String(product.id),
                        productName: product.name,
                        unitPrice: convertedItemPrice,
                        quantity: parseInt(String(product.quantity), 10) || 0
                    };
                })
            );
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

        const visitorPayload: Visitor = {
            visitorId: visitorIdForConvert,
            events: eventsForConvert
        };

        await ConvertApiService.sendServingApiEvents(convertAccountId, convertProjectId, visitorPayload);

        console.log(`--- ${orderLogPrefix} [WEBHOOK] Finished API calls to Convert ---`);

    } catch (error) {
        const err = error as Error;
        console.error("[ERROR] Webhook processing failed after acknowledgement:", err.message, err.stack);
    }
};