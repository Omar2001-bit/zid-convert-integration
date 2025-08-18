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

// MODIFIED: Initialize Firebase Admin SDK - Back to JSON env variable approach for stability, added logging
try {
    const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountKey) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not set. Firebase Admin SDK cannot be initialized.');
    }
    // REVERSED: Attempt to parse as JSON - Most reliable Firebase setup
    let parsedServiceAccount;
    try {
        parsedServiceAccount = JSON.parse(serviceAccountKey);
        console.log('DEBUG: Parsed FIREBASE_SERVICE_ACCOUNT_KEY:', Object.keys(parsedServiceAccount)); // Print the keys
    } catch (parseError: any) {
        console.error('ERROR: Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY as JSON:', parseError.message);
        throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_KEY JSON format.');
    }
  // Now using the parsed service account to log it!
    if(parsedServiceAccount && parsedServiceAccount.private_key){
        const newlifiedPrivateKey = parsedServiceAccount.private_key.replace(/\\n/g, '\n');
        admin.initializeApp({
            credential: admin.credential.cert({...parsedServiceAccount,  private_key: newlifiedPrivateKey}),
          });
        
    console.log('Firebase Admin SDK initialized successfully using environment json for', admin.apps.length);
    } else {
      throw new Error('Service account should include also a private_key string at least for this credential process.  \nService account has only, if defined: private_key field presence '+(parsedServiceAccount && parsedServiceAccount.private_key))
    }
} catch (error: any) {
    console.error('ERROR: Failed to initialize Firebase Admin SDK using FIREBASE_SERVICE_ACCOUNT_KEY:', error.message);

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