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


// Parameters for the REST POST tracking endpoint (supports transactions)
export interface ConvertTrackingEvent {
    evt: 'viewExp' | 'hitGoal' | 'tr';
    exps?: string[];
    vars?: string[];
    goals?: number[];
    r?: number;
    prc?: number;
}

export interface ConvertTrackingPayload {
    cid: string;
    pid: string;
    vid: string;
    ev: ConvertTrackingEvent[];
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

    // ==========================================================================================
    // === REST POST tracking endpoint — sends revenue & product count via "tr" event type     ==
    // === Per Convert docs: https://[projectId].metrics.convertexperiments.com/track          ==
    // ==========================================================================================
    public static async sendTrackingWithTransaction(params: {
        visitorId: string;
        experienceIds: string[];
        variationIds: string[];
        goalId: number;
        revenue: number;
        productsCount: number;
    }): Promise<any | null> {
        const accountId = process.env.CONVERT_ACCOUNT_ID;
        const projectId = process.env.CONVERT_PROJECT_ID;

        if (!accountId || !projectId) {
            console.error("CRITICAL: CONVERT_ACCOUNT_ID or CONVERT_PROJECT_ID is missing. Cannot send transaction tracking.");
            return null;
        }

        const url = `https://${projectId}.metrics.convertexperiments.com/track`;

        const events: ConvertTrackingEvent[] = [];

        // viewExp event — bucketing
        if (params.experienceIds.length > 0) {
            events.push({
                evt: 'viewExp',
                exps: params.experienceIds,
                vars: params.variationIds
            });
        }

        // hitGoal event — conversion
        events.push({
            evt: 'hitGoal',
            goals: [params.goalId],
            exps: params.experienceIds,
            vars: params.variationIds
        });

        // tr event — transaction with revenue and product count
        events.push({
            evt: 'tr',
            goals: [params.goalId],
            exps: params.experienceIds,
            vars: params.variationIds,
            r: Math.round(params.revenue * 100) / 100, // 2 decimal places
            prc: params.productsCount
        });

        const payload: ConvertTrackingPayload = {
            cid: accountId,
            pid: projectId,
            vid: params.visitorId,
            ev: events
        };

        const requestHeaders = {
            'Content-Type': 'application/json',
            'User-Agent': 'ZidConvertIntegration/1.0'
        };

        console.log(`\n--- Preparing to send REST POST tracking with transaction to Convert.com ---`);
        console.log(`URL: ${url}`);
        console.log(JSON.stringify(payload, null, 2));
        console.log("--------------------------------------------------------------------------\n");

        try {
            console.log(`Sending tracking with transaction to Convert REST POST endpoint...`);
            const response = await axios.post(url, payload, { headers: requestHeaders });
            console.log(`REST POST tracking sent successfully. Status:`, response.status);
            return response.data;
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response) {
                console.error("Error sending REST POST tracking - Server responded with error:");
                console.error("Status:", axiosError.response.status);
                console.error("Data:", JSON.stringify(axiosError.response.data, null, 2));
            } else {
                console.error("Error sending REST POST tracking - Error in request setup:", (error as Error).message);
            }
            return null;
        }
    }
}