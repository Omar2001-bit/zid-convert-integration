// src/routes/api/index.ts
import { Router } from 'express';
// Ensure both are listed as named imports here
import {
    captureConvertContextController,
    handlePurchaseSignalController // This must exactly match the exported name
} from '../../controllers/api/convertContextController';

const router = Router();

// Endpoint for client-side JS to send Convert bucketing/context data
router.post('/capture-convert-context', captureConvertContextController);

// Endpoint for client-side JS to signal a purchase
router.post('/signal-purchase', handlePurchaseSignalController);

export default router;