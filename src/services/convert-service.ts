import axios, { AxiosError } from 'axios';

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

// Correct payload for Metrics API (v1/track)
interface MetricsV1ApiPayload {
    visitors: Visitor[];
}


export class ConvertApiService {
    constructor() {
        // Empty constructor
    }

    // ==========================================================================================
    // === This is the ONLY active function, implementing the confirmed Metrics Tracking API (v1/track) ==
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

        // ✅ Confirmed correct endpoint as per our discussion and live logs
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