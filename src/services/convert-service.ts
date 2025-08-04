// src/services/convert-service.ts
import axios, { AxiosError } from 'axios';

// Your original legacy interfaces are preserved
export interface ConvertTrackPayload {
    cid: string;
    pid: string;
    vid: string;
    tid?: string;
    seg?: {
        browser?: string;
        devices?: string[];
        source?: string;
        campaign?: string;
        new?: number; 
        ctry?: string;
        cust?: string[];
    };
    ev: ConvertEvent[];
}

export interface ConvertEvent {
    evt: 'hitGoal' | 'tr' | 'viewExp';
    goals?: number[];
    r?: number | string;
    prc?: number | string;
    exps?: string[];
    vars?: string[];
    products?: any[];
}

// Your modern interfaces are correct and preserved
export interface Visitor {
    visitorId: string;
    events: Event[];
}

export interface Event {
    eventType: 'bucketing' | 'conversion';
    data: BucketingEventData | ConversionEventData;
}

export interface BucketingEventData {
    experienceId: string;
    variationId: string;
}

export interface ConversionEventData {
    goalId: number;
    transactionId?: string;
    revenue?: number;
    products?: Product[];
}

export interface Product {
    productId: string;
    productName: string;
    unitPrice: number;
    quantity: number;
}

// DEFINITIVE FIX: This interface is updated to remove account/project IDs
interface V1ApiPayload {
    enrichData: boolean;
    visitors: Visitor[];
}


export class ConvertApiService {
    constructor() {
        // Empty constructor
    }

    // Your original function is preserved but will no longer be used by the webhook.
    public static async sendEventToConvert(payload: ConvertTrackPayload): Promise<any | null> {
        const projectIdForSubdomain = process.env.CONVERT_PROJECT_ID;

        if (!projectIdForSubdomain) {
            console.error("CONVERT_PROJECT_ID not found in .env. Cannot construct Convert API URL.");
            return null;
        }

        if (!payload.cid || !payload.pid || !payload.vid || !payload.ev || !payload.ev.length) {
            console.error("Payload validation failed for legacy API:", payload);
            return null;
        }

        const url = `https://${projectIdForSubdomain}.metrics.convertexperiments.com/track`;

        const requestHeaders = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Zid-Convert-Integration-Server/1.0',
        };

        console.log("\n--- Preparing to send final payload to Convert.com ---");
        console.log(JSON.stringify(payload, null, 2));
        console.log("------------------------------------------------------\n");

        try {
            console.log(`Sending event to Convert. URL: ${url}`);
            const response = await axios.post(url, payload, { headers: requestHeaders });
            console.log("Convert event sent successfully. Status:", response.status);
            return response.data;
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response) {
                console.error("Error sending event to Convert - Server responded with error:");
                console.error("Status:", axiosError.response.status);
                console.error("Data:", JSON.stringify(axiosError.response.data, null, 2));
            } else if (axiosError.request) {
                console.error("Error sending event to Convert - No response received. Request was made to:", url);
            } else {
                console.error("Error sending event to Convert - Error in request setup:", (error as Error).message);
            }
            return null;
        }
    }

    // ==========================================================================================
    // === DEFINITIVE FIX: This function is rewritten to use the correct v1/track endpoint ======
    // ==========================================================================================
    public static async sendServingApiEvents(accountId: string, projectId: string, visitor: Visitor): Promise<any | null> {
        // 1. The URL is now correct, with account and project IDs in the path.
        const url = `https://metrics.convertexperiments.com/v1/track/${accountId}/${projectId}`;

        // 2. The payload no longer contains accountId or projectId in the body.
        const payload: V1ApiPayload = {
            enrichData: true,
            visitors: [visitor]
        };

        // 3. The request no longer needs the X-CONVERT-API-SECRET header.
        const requestHeaders = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };

        console.log(`\n--- Preparing to send NEW v1/track API payload to Convert.com ---`);
        console.log(`URL: ${url}`);
        console.log(JSON.stringify(payload, null, 2));
        console.log("-----------------------------------------------------------------\n");

        try {
            console.log(`Sending new event batch to Convert v1/track API.`);
            const response = await axios.post(url, payload, { headers: requestHeaders });
            console.log(`New Convert v1/track API events sent successfully. Status:`, response.status); 
            return response.data;
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response) {
                console.error("Error sending to v1/track API - Server responded with error:");
                console.error("Status:", axiosError.response.status);
                console.error("Data:", JSON.stringify(axiosError.response.data, null, 2));
            } else {
                console.error("Error sending to v1/track API - Error in request setup:", (error as Error).message);
            }
            return null;
        }
    }
}