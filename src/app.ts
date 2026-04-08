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

dotenv.config({ path: 'zid-convert-integration.env' });

// Fallback for local testing to ensure Firebase finds the key we just saved
if (!process.env.FIREBASE_SERVICE_ACCOUNT_PATH && fs.existsSync('./firebase_credentials.json')) {
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH = './firebase_credentials.json';
}

const app = express();

// --- FINAL EDITED CODE: Fix Private Key Formatting ---
// --- Environment-Aware Firebase Initialization ---
try {
    let serviceAccount: any;

    if (process.env.FIREBASE_CREDENTIALS) {
        // Option 1: Load from a stringified JSON (best for CI/CD or Cloud systems like Render)
        serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
        console.log('Firebase: Initializing from FIREBASE_CREDENTIALS environment variable.');
    } else {
        // Option 2: Load from a file path
        const defaultPath = '/etc/secrets/firebase_credentials.json'; // Render path
        const localPath = './firebase_credentials.json'; // Common local dev path
        
        const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 
                     (fs.existsSync(localPath) ? localPath : defaultPath);

        if (!fs.existsSync(path)) {
            // If we're in local development, we might want to warn rather than crash, 
            // but for this integration Firebase is critical.
            console.warn(`\n[WARNING] Firebase credentials not found at ${path}.`);
            console.warn(`If you are running locally, please place 'firebase_credentials.json' in the root folder or set the FIREBASE_CREDENTIALS environment variable.\n`);
            throw new Error(`CRITICAL: Firebase credentials file not found.`);
        }

        const serviceAccountString = fs.readFileSync(path, 'utf8');
        serviceAccount = JSON.parse(serviceAccountString);
        console.log(`Firebase: Initializing from file: ${path}`);
    }

    // Fix literal '\n' characters in the private key if necessary
    if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });

    console.log(`Firebase Admin SDK initialized successfully! Project: ${serviceAccount.project_id}.`);

} catch (error: any) {
    console.error('CRITICAL ERROR: Failed to initialize Firebase Admin SDK.', error.message);
    // In local dev, we might not want to exit(1) if we just want to test other parts, 
    // but the Firestore service depends on this, so crashing is safer.
    process.exit(1);
}
// --- End of Firebase Initialization ---

// --- End of Firebase Initialization ---


// --- CORS Configuration ---
const allowedOrigins: string[] = [
    'https://regal-honey.com',
];

if (process.env.MY_BACKEND_URL) {
    allowedOrigins.push(process.env.MY_BACKEND_URL);
    console.log(`[CORS] Added development origin to allowed list: ${process.env.MY_BACKEND_URL}`);
}

const corsOptions: CorsOptions = {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
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