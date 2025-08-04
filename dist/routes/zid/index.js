"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = __importDefault(require("./auth")); // Points to src/routes/zid/auth/index.ts
const router = (0, express_1.Router)();
// Mounts auth related routes (redirect, callback) directly under the parent mount point
// So, if parent is /auth/zid, then routes here will be /auth/zid/ and /auth/zid/callback
router.use('/', auth_1.default);
exports.default = router;
