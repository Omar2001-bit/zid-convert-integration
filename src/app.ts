// src/app.ts
import express, { Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import mainRoutes from './routes';
import * as admin from 'firebase-admin';
import * as fs from 'fs'; // <-- This import is correct and still needed

dotenv.config();

const app = express();

// --- EDITED: Final Firebase Initialization using direct file path as per Render Support ---
try {
    // 1. Render Support confirmed that the Secret File is always available at this fixed path.
    // We no longer look for an environment variable.
    const serviceAccountPath = '/etc/secrets/firebase_credentials.json';

    // 2. Check if the file exists at the provided path.
    if (!fs.existsSync(serviceAccountPath)) {
        throw new Error(`CRITICAL: Firebase credentials file not found at path: ${serviceAccountPath}. Ensure the Secret File is correctly named 'firebase_credentials.json' in Render.`);
    }

    // 3. Read the file's content.
    const serviceAccountString = fs.readFileSync(serviceAccountPath, 'utf8');

    // 4. Parse the file content into a JSON object.
    const serviceAccount = JSON.parse(serviceAccountString);
    
    // 5. Initialize the SDK with the entire service account object.
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });

    console.log(`Firebase Admin SDK initialized successfully from Secret File for project: ${serviceAccount.project_id}.`);

} catch (error: any) {
    console.error('CRITICAL ERROR: Failed to initialize Firebase Admin SDK from Secret File.', error);
    process.exit(1); // Exit because the application cannot function without Firebase.
}
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