"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/api/index.ts
const express_1 = require("express");
// Ensure both are listed as named imports here
const convertContextController_1 = require("../../controllers/api/convertContextController");
const router = (0, express_1.Router)();
// Endpoint for client-side JS to send Convert bucketing/context data
router.post('/capture-convert-context', convertContextController_1.captureConvertContextController);
// Endpoint for client-side JS to signal a purchase
router.post('/signal-purchase', convertContextController_1.handlePurchaseSignalController);
exports.default = router;
