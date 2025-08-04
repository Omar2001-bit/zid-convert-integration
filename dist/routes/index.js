"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zid_1 = __importDefault(require("./zid")); // Also making this explicit for consistency
const api_1 = __importDefault(require("./api"));
const webhooks_1 = __importDefault(require("./webhooks")); // ADDED: Import the new webhook routes
const router = (0, express_1.Router)();
// Mount Zid specific application routes under /auth/zid
router.use('/auth/zid', zid_1.default);
// Mount our new API routes (e.g., for /api/capture-convert-context)
router.use('/api', api_1.default);
// ADDED: Mount our new webhook routes
router.use('/webhooks', webhooks_1.default);
router.get('/', (req, res) => {
    res.send('<h1>Welcome to Zid TypeScript OAuth App!</h1><p><a href="/auth/zid">Login with Zid</a></p>');
});
// Example dashboard route
router.get('/dashboard', (req, res) => {
    res.send('<h1>Application Dashboard</h1><p>Successfully authenticated with Zid (presumably)!</p>');
});
exports.default = router;
