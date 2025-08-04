"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/webhooks.ts
const express_1 = require("express");
const zidOrderEventsController_1 = require("../controllers/webhooks/zidOrderEventsController");
const router = (0, express_1.Router)();
// This route will handle POST requests from Zid for new orders
router.post('/zid/order-events', zidOrderEventsController_1.zidOrderEventsWebhookController);
exports.default = router;
