// src/routes/api/index.ts
import { Router } from 'express';
import {
    captureConvertContextController,
    handlePurchaseSignalController
} from '../../controllers/api/convertContextController';
import { getStoreConfig, saveStoreConfig, clearConfigCache } from '../../services/store-config-service';
import { StoreConfig } from '../../types/index';
import * as admin from 'firebase-admin';

const router = Router();

// Endpoint for client-side JS to send Convert bucketing/context data
router.post('/capture-convert-context', captureConvertContextController);

// Endpoint for client-side JS to signal a purchase
router.post('/signal-purchase', handlePurchaseSignalController);

// ========================================================================
// STORE CONFIG ENDPOINTS (Multi-tenant)
// ========================================================================

// GET /api/store-config/:storeId — Returns checkout config for frontend script
// Does NOT expose secrets (no API keys, no webhook tokens)
router.get('/store-config/:storeId', async (req, res) => {
    try {
        const { storeId } = req.params;
        const config = await getStoreConfig(storeId);

        if (!config) {
            return res.status(404).json({ error: `Store config not found for storeId: ${storeId}` });
        }

        // Only return frontend-safe config (no secrets)
        res.json({
            storeId: config.storeId,
            storeName: config.storeName,
            checkoutConfig: config.checkoutConfig
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/store-config — Create or update a store config
// Protected by X-Admin-Secret header
router.post('/admin/store-config', async (req, res) => {
    try {
        const adminSecret = process.env.ADMIN_SECRET;
        const providedSecret = req.headers['x-admin-secret'];

        if (!adminSecret || providedSecret !== adminSecret) {
            return res.status(403).json({ error: 'Forbidden: Invalid admin secret.' });
        }

        let body: any;
        if (typeof req.body === 'string' && req.body.length > 0) {
            body = JSON.parse(req.body);
        } else {
            body = req.body;
        }

        if (!body.storeId || !body.storeName || !body.storeDomain) {
            return res.status(400).json({ error: 'storeId, storeName, and storeDomain are required.' });
        }

        if (!body.convertAccountId || !body.convertProjectId || !body.convertApiKeySecret || !body.convertGoalIdForPurchase) {
            return res.status(400).json({ error: 'All Convert credentials are required: convertAccountId, convertProjectId, convertApiKeySecret, convertGoalIdForPurchase.' });
        }

        const config: StoreConfig = {
            storeId: String(body.storeId),
            storeName: body.storeName,
            storeDomain: body.storeDomain,
            convertAccountId: body.convertAccountId,
            convertProjectId: body.convertProjectId,
            convertApiKeySecret: body.convertApiKeySecret,
            convertGoalIdForPurchase: parseInt(body.convertGoalIdForPurchase, 10),
            zidWebhookSecretToken: body.zidWebhookSecretToken || `token_${Math.random().toString(36).substring(2, 15)}`,
            checkoutConfig: body.checkoutConfig || {
                emailSelectors: ['#inputEmail', 'input[name="email"]', 'input[type="email"]'],
                phoneSelectors: ['#mobile', 'input[name="mobile"]', 'input[type="tel"]'],
                checkoutUrlKeywords: ['checkout', 'payment', '/cart'],
                guestLoginPattern: { path: '/auth/login', search: 'checkout' }
            },
            active: body.active !== false
        };

        await saveStoreConfig(config);

        res.status(200).json({
            message: `Store config saved for ${config.storeName} (${config.storeId}).`,
            storeId: config.storeId,
            zidWebhookSecretToken: config.zidWebhookSecretToken,
            webhookUrl: `${process.env.MY_BACKEND_URL}/webhooks/zid/order-events?token=${config.zidWebhookSecretToken}`
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/store-config/:storeId — Get full store config (admin only)
router.get('/admin/store-config/:storeId', async (req, res) => {
    try {
        const adminSecret = process.env.ADMIN_SECRET;
        const providedSecret = req.headers['x-admin-secret'];

        if (!adminSecret || providedSecret !== adminSecret) {
            return res.status(403).json({ error: 'Forbidden: Invalid admin secret.' });
        }

        const config = await getStoreConfig(req.params.storeId);
        if (!config) {
            return res.status(404).json({ error: `Store config not found for storeId: ${req.params.storeId}` });
        }

        res.json(config);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// TEST ENDPOINT: Verify context was stored (call this from browser console)
router.get('/test/verify-context', async (req, res) => {
    try {
        const { convertVisitorId } = req.query;
        if (!convertVisitorId) {
            return res.status(400).json({ error: 'convertVisitorId parameter required' });
        }

        const { getContextByConvertVisitorId } = require('../../services/firestore-service');
        const context = await getContextByConvertVisitorId(convertVisitorId as string);

        if (context) {
            res.json({
                success: true,
                message: `Context found for convertVisitorId: ${convertVisitorId}`,
                data: context
            });
        } else {
            res.json({
                success: false,
                message: `Context NOT found for convertVisitorId: ${convertVisitorId}`
            });
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;