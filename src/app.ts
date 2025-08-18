// src/app.ts
import express, { Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import mainRoutes from './routes';
import * as admin from 'firebase-admin'; // Added: Import firebase-admin

dotenv.config();

const app = express();

// MODIFIED: Initialize Firebase Admin SDK using individual environment variables
try {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'); // Crucial: Replace escaped newline characters with actual newlines

    if (!projectId || !privateKey) {
        throw new Error('Missing essential Firebase environment variables (projectId or privateKey). Cannot initialize Firebase Admin SDK.');
    }

    // REVISED initialization config to use only projectId and privateKey
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: projectId,
            privateKey: privateKey
        })
    });
    console.log('Firebase Admin SDK initialized successfully (using only projectId and privateKey environment variables).');
} catch (error: any) {
    console.error('ERROR: Failed to initialize Firebase Admin SDK (using projectId and privateKey):', error.message);
    // Depending on severity, you might want to exit the process or log more robustly
    // process.exit(1);
}

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

// This is the correct, robust body parser configuration.
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