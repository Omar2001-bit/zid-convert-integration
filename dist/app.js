"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/app.ts
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const body_parser_1 = __importDefault(require("body-parser"));
const dotenv_1 = __importDefault(require("dotenv"));
const routes_1 = __importDefault(require("./routes"));
const admin = __importStar(require("firebase-admin"));
const fs = __importStar(require("fs"));
dotenv_1.default.config();
const app = (0, express_1.default)();
// --- FINAL EDITED CODE: Fix Private Key Formatting ---
try {
    // 1. Read the secret file from the fixed path.
    const serviceAccountPath = '/etc/secrets/firebase_credentials.json';
    if (!fs.existsSync(serviceAccountPath)) {
        throw new Error(`CRITICAL: Firebase credentials file not found at path: ${serviceAccountPath}.`);
    }
    const serviceAccountString = fs.readFileSync(serviceAccountPath, 'utf8');
    const serviceAccount = JSON.parse(serviceAccountString);
    // 2. THIS IS THE FIX: Manually replace the literal '\n' in the private key
    // with actual newline characters. This corrects any copy-paste formatting errors.
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    // 3. Initialize the SDK with the corrected service account object.
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log(`Firebase Admin SDK initialized successfully! Project: ${serviceAccount.project_id}.`);
}
catch (error) {
    console.error('CRITICAL ERROR: Failed to initialize Firebase Admin SDK.', error);
    process.exit(1);
}
// --- End of Firebase Initialization ---
// --- CORS Configuration ---
const allowedOrigins = [
    'https://regal-honey.com',
];
if (process.env.MY_BACKEND_URL) {
    allowedOrigins.push(process.env.MY_BACKEND_URL);
    console.log(`[CORS] Added development origin to allowed list: ${process.env.MY_BACKEND_URL}`);
}
const corsOptions = {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
    optionsSuccessStatus: 200
};
app.use((0, cors_1.default)(corsOptions));
app.options('*', (0, cors_1.default)(corsOptions));
app.use((0, helmet_1.default)());
app.use((0, compression_1.default)());
app.use(body_parser_1.default.text({ type: '*/*' }));
app.use(body_parser_1.default.urlencoded({ extended: true }));
app.use('/', routes_1.default);
// --- Basic Error Handling ---
app.use((req, res, next) => {
    const err = new Error('Not Found');
    err.status = 404;
    next(err);
});
app.use((err, req, res, next) => {
    res.status(err.status || 500);
    res.json({
        error: {
            message: err.message
        }
    });
});
exports.default = app;
