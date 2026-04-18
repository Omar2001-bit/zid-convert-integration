// src/app.ts
import express, { Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import mainRoutes from './routes';
import * as admin from 'firebase-admin';
import * as fs from 'fs';

dotenv.config();

const app = express();

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

} catch (error: any) {
    console.error('CRITICAL ERROR: Failed to initialize Firebase Admin SDK.', error);
    process.exit(1);
}
// --- End of Firebase Initialization ---


// --- CORS Configuration (Dynamic: loads store domains from Firestore) ---
import { getAllActiveStoreConfigs } from './services/store-config-service';

let dynamicAllowedOrigins: string[] = [];

// Load store domains for CORS on startup, refresh every 5 minutes
async function refreshCorsOrigins() {
    try {
        const configs = await getAllActiveStoreConfigs();
        const origins: string[] = [];
        configs.forEach(config => {
            if (config.storeDomain) {
                origins.push(config.storeDomain);
                // Also allow www variant
                if (config.storeDomain.startsWith('https://') && !config.storeDomain.includes('www.')) {
                    origins.push(config.storeDomain.replace('https://', 'https://www.'));
                }
            }
        });
        if (process.env.MY_BACKEND_URL) {
            origins.push(process.env.MY_BACKEND_URL);
        }
        dynamicAllowedOrigins = origins;
        console.log(`[CORS] Loaded ${origins.length} allowed origin(s):`, origins);
    } catch (error) {
        console.error('[CORS] Failed to load store domains:', error);
    }
}

// Initial load
refreshCorsOrigins();
// Refresh every 5 minutes
setInterval(refreshCorsOrigins, 5 * 60 * 1000);

const corsOptions: CorsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (server-to-server, curl, webhooks)
        if (!origin) return callback(null, true);
        if (dynamicAllowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        console.warn(`[CORS] Blocked request from origin: ${origin}`);
        return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Admin-Secret'],
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(helmet());
app.use(compression());

app.use(bodyParser.text({ type: '*/*' }));
app.use(bodyParser.urlencoded({ extended: true }));

app.use('/', mainRoutes);

// --- Basic Error Handling ---
app.use((req: Request, res: Response, next: NextFunction) => {
    const err = new Error('Not Found') as any;
    err.status = 404;
    next(err);
});

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    res.status(err.status || 500);
    res.json({
        error: {
            message: err.message
        }
    });
});

export default app;