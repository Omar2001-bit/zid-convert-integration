"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const redirect_1 = require("../../../controllers/zid/auth/redirect");
const callback_1 = require("../../../controllers/zid/auth/callback");
const router = (0, express_1.Router)();
// Path: / (relative to its mount point, e.g., /auth/zid/)
// This will initiate the redirect to Zid.
router.get('/', redirect_1.zidAuthRedirectController);
// Path: /callback (relative to its mount point, e.g., /auth/zid/callback)
// This is where Zid will redirect the user back.
router.get('/callback', callback_1.zidAuthCallbackController);
exports.default = router;
