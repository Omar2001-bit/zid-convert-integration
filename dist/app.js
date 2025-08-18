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
const fs = __importStar(require("fs")); // <-- EDITED: Added Node.js file system module
dotenv_1.default.config();
const app = (0, express_1.default)();
// --- EDITED: Firebase Admin SDK Initialization to use Render Secret File ---
try {
    // 1. Render automatically creates this env var based on your Secret File's name.
    // Filename: firebase_credentials.json -> Env Var: FIREBASE_CREDENTIALS_JSON_PATH
    const serviceAccountPath = process.env.FIREBASE_CREDENTIALS_JSON_PATH;
    if (!serviceAccountPath) {
        throw new Error('CRITICAL: FIREBASE_CREDENTIALS_JSON_PATH environment variable not set. Ensure the Secret File is configured correctly in Render.');
    }
    // 2. Check if the file exists at the provided path.
    if (!fs.existsSync(serviceAccountPath)) {
        throw new Error(`CRITICAL: Firebase credentials file not found at path: ${serviceAccountPath}`);
    }
    // 3. Read the file's content directly. No need to handle '\n' escapes.
    const serviceAccountString = fs.readFileSync(serviceAccountPath, 'utf8');
    // 4. Parse the file content into a JSON object.
    const serviceAccount = JSON.parse(serviceAccountString);
    // 5. Initialize the SDK with the entire service account object.
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log(`Firebase Admin SDK initialized successfully from Secret File for project: ${serviceAccount.project_id}.`);
}
catch (error) {
    console.error('CRITICAL ERROR: Failed to initialize Firebase Admin SDK from Secret File.', error);
    process.exit(1); // Exit because the application cannot function without Firebase.
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
