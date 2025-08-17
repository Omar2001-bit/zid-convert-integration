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

// DEFINITIVE FIX: This is the correct payload for the /serving endpoint (retained as per instruction)
interface ServingApiPayload {
    accountId: string;
    projectId: string;
    enrichData: boolean;
    visitors: Visitor[];
}

// NEW INTERFACE: Payload for the /v1/track Metrics API endpoint
interface MetricsV1ApiPayload {
    visitors: Visitor[];
}


export class ConvertApiService {
    constructor() {
        // Empty constructor
    }

    // Your original function is preserved but will no longer be used by the webhook.
    // Kept as per instruction: "do not remove anything from the file just add"
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

        console.log("\n--- Preparing to send final payload to Convert.com (LEGACY SUBDOMAIN API) ---");
        console.log(JSON.stringify(payload, null, 2));
        console.log("--------------------------------------------------------------------------------\n");

        try {
            console.log(`Sending event to Convert. URL: ${url}`);
            const response = await axios.post(url, payload, { headers: requestHeaders });
            console.log("Convert event sent successfully. Status:", response.status);
            return response.data;
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response) {
                console.error("Error sending event to Convert (LEGACY SUBDOMAIN API) - Server responded with error:");
                console.error("Status:", axiosError.response.status);
                console.error("Data:", JSON.stringify(axiosError.response.data, null, 2));
            } else if (axiosError.request) {
                console.error("Error sending event to Convert (LEGACY SUBDOMAIN API) - No response received. Request was made to:", url);
            } else {
                console.error("Error sending event to Convert (LEGACY SUBDOMAIN API) - Error in request setup:", (error as Error).message);
            }
            return null;
        }
    }

    // ==========================================================================================
    // === Existing sendServingApiEvents function (targeting /serving endpoint) kept as is ======
    // ==========================================================================================
    // Kept as per instruction: "do not remove anything from the file just add"
    public static async sendServingApiEvents(accountId: string, projectId: string, visitor: Visitor): Promise<any | null> {
        // 1. The URL is now correct for the Serving API.
        const url = `https://api.convert.com/serving`;
        const apiSecret = process.env.CONVERT_API_KEY_SECRET;

        if (!apiSecret) {
            console.error("CRITICAL: CONVERT_API_KEY_SECRET is not set in .env. Cannot authenticate with the new Serving API.");
            return null;
        }

        // 2. The payload now correctly includes accountId and projectId in the body.
        const payload: ServingApiPayload = {
            accountId: accountId,
            projectId: projectId,
            enrichData: true,
            visitors: [visitor]
        };

        // 3. The request now correctly includes the X-CONVERT-API-SECRET header for authentication.
        const requestHeaders = {
            'Content-Type': 'application/json',
            'X-CONVERT-API-SECRET': apiSecret
        };

        console.log(`\n--- Preparing to send EXISTING SERVING API payload to Convert.com ---`);
        console.log(`URL: ${url}`);
        console.log(JSON.stringify(payload, null, 2));
        console.log("---------------------------------------------------------------------\n");

        try {
            console.log(`Sending new event batch to Convert Serving API.`);
            const response = await axios.post(url, payload, { headers: requestHeaders });
            console.log(`New Convert Serving API events sent successfully. Status:`, response.status); 
            return response.data;
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response) {
                console.error("Error sending to Serving API - Server responded with error:");
                console.error("Status:", axiosError.response.status);
                console.error("Data:", JSON.stringify(axiosError.response.data, null, 2));
            } else {
                console.error("Error sending to Serving API - Error in request setup:", (error as Error).message);
            }
            return null;
        }
    }

    // ==========================================================================================
    // === NEW FUNCTION: Implements the confirmed Metrics Tracking API (v1/track) endpoint ======
    // ==========================================================================================
    public static async sendMetricsV1ApiEvents(visitor: Visitor): Promise<any | null> {
        const accountId = process.env.CONVERT_ACCOUNT_ID;
        const projectId = process.env.CONVERT_PROJECT_ID;
        const apiSecret = process.env.CONVERT_API_KEY_SECRET;

        if (!accountId || !projectId) {
            console.error("CRITICAL: CONVERT_ACCOUNT_ID or CONVERT_PROJECT_ID is missing from .env. Cannot construct Convert API URL for v1/track.");
            return null;
        }

        if (!apiSecret) {
            console.error("CRITICAL: CONVERT_API_KEY_SECRET is not set in .env. Cannot authenticate with the Metrics API (v1/track).");
            return null;
        }

        // ✅ Confirmed correct endpoint as per our discussion
        const url = `https://metrics.convertexperiments.com/v1/track/${accountId}/${projectId}`;

        // Payload structure for v1/track endpoint
        const payload: MetricsV1ApiPayload = {
            visitors: [visitor]
        };

        const requestHeaders = {
            'Content-Type': 'application/json',
            'X-CONVERT-API-SECRET': apiSecret
        };

        console.log(`\n--- Preparing to send NEW v1/track METRICS API payload to Convert.com ---`);
        console.log(`URL: ${url}`);
        console.log(JSON.stringify(payload, null, 2));
        console.log("--------------------------------------------------------------------------\n");

        try {
            console.log(`Sending visitor events to Convert Metrics API (v1/track)...`);
            const response = await axios.post(url, payload, { headers: requestHeaders });
            console.log(`Metrics API (v1/track) events sent successfully. Status:`, response.status); 
            return response.data;
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response) {
                console.error("Error sending to Metrics API (v1/track) - Server responded with error:");
                console.error("Status:", axiosError.response.status);
                console.error("Data:", JSON.stringify(axiosError.response.data, null, 2));
            } else {
                console.error("Error sending to Metrics API (v1/track) - Error in request setup:", (error as Error).message);
            }
            return null;
        }
    }
}