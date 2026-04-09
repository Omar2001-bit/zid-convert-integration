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

// --- DEPRECATED: IP debugging endpoint is no longer needed with cart-note injection strategy ---
// router.get('/get-ip', getClientIpController);

export default router;