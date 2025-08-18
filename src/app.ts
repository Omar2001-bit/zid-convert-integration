// src/app.ts
import express, { Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import mainRoutes from './routes';
import * as admin from 'firebase-admin';
import * as fs from 'fs'; // <-- EDITED: Added Node.js file system module

dotenv.config();

const app = express();

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