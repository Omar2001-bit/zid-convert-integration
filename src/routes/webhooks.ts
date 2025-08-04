// src/routes/webhooks.ts
import { Router } from 'express';
import { zidOrderEventsWebhookController } from '../controllers/webhooks/zidOrderEventsController';

const router = Router();

// This route will handle POST requests from Zid for new orders
router.post('/zid/order-events', zidOrderEventsWebhookController);

export default router;