// src/routes/api/index.ts
import { Router } from 'express';
// --- MODIFIED: Import the new getClientIpController ---
import {
    captureConvertContextController,
    handlePurchaseSignalController,
    getClientIpController // Add the new controller function
} from '../../controllers/api/convertContextController';

const router = Router();

// Endpoint for client-side JS to send Convert bucketing/context data
router.post('/capture-convert-context', captureConvertContextController);

// Endpoint for client-side JS to signal a purchase
router.post('/signal-purchase', handlePurchaseSignalController);

// --- NEW: Route for the IP debugging endpoint ---
// This will handle GET requests to /api/get-ip
router.get('/get-ip', getClientIpController);

export default router;