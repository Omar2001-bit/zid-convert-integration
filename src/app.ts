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

// Added: Initialize Firebase Admin SDK
try {
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not set. Firebase Admin SDK cannot be initialized.');
  }
  // Attempt to parse the service account key JSON string
  const parsedServiceAccount = JSON.parse(serviceAccountKey);
  
  admin.initializeApp({
    credential: admin.credential.cert(parsedServiceAccount)
  });
  console.log('Firebase Admin SDK initialized successfully.');
} catch (error) {
  console.error('ERROR: Failed to initialize Firebase Admin SDK:', error instanceof Error ? error.message : error);
  // Depending on the criticality for the application to function,
  // you might choose to exit the process here: process.exit(1);
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
app.use(bodyParser.urlencoded({ extended: false }));

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