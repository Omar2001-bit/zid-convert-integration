// src/routes/api/index.ts
import { Router } from 'express';
import {
    captureConvertContextController,
    handlePurchaseSignalController
} from '../../controllers/api/convertContextController';

const router = Router();

// Endpoint for client-side JS to send Convert bucketing/context data
router.post('/capture-convert-context', captureConvertContextController);

// Endpoint for client-side JS to signal a purchase
router.post('/signal-purchase', handlePurchaseSignalController);

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

// --- DEPRECATED: IP debugging endpoint is no longer needed with cart-note injection strategy ---
// router.get('/get-ip', getClientIpController);

export default router;