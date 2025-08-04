"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZidApiService = void 0;
const axios_1 = __importDefault(require("axios"));
class ZidApiService {
    // CONSTRUCTOR FIX - This is the missing piece that was causing the module resolution error
    constructor() {
        // Empty constructor - fixes TypeScript module resolution issue
    }
    // ... (keep existing getTokensByCode, getMerchantProfile, getOrders methods as they are) ...
    static async getTokensByCode(code) {
        const url = `${process.env.ZID_AUTH_URL}/oauth/token`;
        const requestBody = {
            grant_type: 'authorization_code',
            client_id: process.env.ZID_CLIENT_ID,
            client_secret: process.env.ZID_CLIENT_SECRET,
            redirect_uri: `${process.env.MY_BACKEND_URL}/auth/zid/callback`,
            code: code,
        };
        if (!process.env.ZID_CLIENT_ID || !process.env.ZID_CLIENT_SECRET || !process.env.MY_BACKEND_URL || !process.env.ZID_AUTH_URL) {
            console.error("Zid service configuration missing in .env for token exchange.");
            throw new Error("Zid service configuration for token exchange is incomplete.");
        }
        try {
            console.log("Requesting tokens from Zid. Body:", Object.assign(Object.assign({}, requestBody), { client_secret: '[REDACTED]' }));
            const response = await axios_1.default.post(url, requestBody, {
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            });
            console.log("Tokens received from Zid successfully.");
            return response.data;
        }
        catch (error) {
            const axiosError = error;
            if (axiosError.response) {
                console.error("Error fetching tokens - Server responded with error:");
                console.error("Status:", axiosError.response.status);
                console.error("Data:", JSON.stringify(axiosError.response.data, null, 2));
            }
            else if (axiosError.request) {
                console.error("Error fetching tokens - No response received:", axiosError.request);
            }
            else {
                console.error("Error fetching tokens - Error in request setup:", axiosError.message);
            }
            throw new Error(`Zid token exchange failed.`);
        }
    }
    static async getMerchantProfile(xManagerTokenValue, authorizationJwt) {
        const url = `${process.env.ZID_BASE_API_URL}/managers/account/profile`;
        if (!process.env.ZID_BASE_API_URL) {
            console.error("ZID_BASE_API_URL not configured for getMerchantProfile.");
            throw new Error("ZID_BASE_API_URL for getMerchantProfile is not configured.");
        }
        const requestHeaders = {
            'Authorization': `Bearer ${authorizationJwt}`,
            'X-Manager-Token': xManagerTokenValue,
            'Accept': 'application/json',
        };
        try {
            console.log("Requesting merchant profile from Zid with headers:", requestHeaders);
            const response = await axios_1.default.get(url, { headers: requestHeaders });
            console.log("Merchant profile fetched successfully.");
            return response.data;
        }
        catch (error) {
            const axiosError = error;
            if (axiosError.response) {
                console.error("Error fetching merchant profile - Server responded with error:");
                console.error("Status:", axiosError.response.status);
                console.error("Data:", JSON.stringify(axiosError.response.data, null, 2));
            }
            else if (axiosError.request) {
                console.error("Error fetching merchant profile - No response received. Request details:", axiosError.config);
            }
            else {
                console.error("Error fetching merchant profile - Error in request setup:", axiosError.message);
            }
            return null;
        }
    }
    static async getOrders(xManagerTokenValue, authorizationJwt, page = 1, perPage = 10) {
        const baseUrl = `${process.env.ZID_BASE_API_URL}/managers/store/orders`;
        if (!process.env.ZID_BASE_API_URL) {
            console.error("ZID_BASE_API_URL not configured for getOrders.");
            throw new Error("ZID_BASE_API_URL for getOrders is not configured.");
        }
        const queryParams = new URLSearchParams({
            page: page.toString(),
            per_page: perPage.toString(),
        });
        const url = `${baseUrl}?${queryParams.toString()}`;
        const requestHeaders = {
            'Authorization': `Bearer ${authorizationJwt}`,
            'X-Manager-Token': xManagerTokenValue,
            'Accept': 'application/json',
        };
        try {
            console.log(`Requesting orders from Zid (simplified): ${url} with headers:`, requestHeaders);
            const response = await axios_1.default.get(url, { headers: requestHeaders });
            console.log("Orders fetched successfully from Zid API (simplified request).");
            return response.data;
        }
        catch (error) {
            const axiosError = error;
            if (axiosError.response) {
                console.error("Error fetching Zid orders (simplified) - Server responded with error:");
                console.error("Status:", axiosError.response.status);
                console.error("Headers:", JSON.stringify(axiosError.response.headers, null, 2));
                console.error("Data:", JSON.stringify(axiosError.response.data, null, 2));
            }
            else if (axiosError.request) {
                console.error("Error fetching Zid orders (simplified) - No response received. Request details:", axiosError.config);
            }
            else {
                console.error("Error fetching Zid orders (simplified) - Error in request setup:", axiosError.message);
            }
            return null;
        }
    }
    // New method to create a webhook subscription
    static async createWebhookSubscription(xManagerTokenValue, authorizationJwt, webhookPayload) {
        const url = `${process.env.ZID_BASE_API_URL}/managers/webhooks`;
        if (!process.env.ZID_BASE_API_URL) {
            console.error("ZID_BASE_API_URL not configured for createWebhookSubscription.");
            throw new Error("ZID_BASE_API_URL for createWebhookSubscription is not configured.");
        }
        const requestHeaders = {
            'Authorization': `Bearer ${authorizationJwt}`,
            'X-Manager-Token': xManagerTokenValue,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };
        try {
            console.log(`Attempting to create webhook subscription. URL: ${url}, Payload:`, JSON.stringify(webhookPayload, null, 2));
            const response = await axios_1.default.post(url, webhookPayload, { headers: requestHeaders });
            console.log("Zid webhook subscription created/updated successfully. Response:", JSON.stringify(response.data, null, 2));
            return response.data;
        }
        catch (error) {
            const axiosError = error;
            if (axiosError.response) {
                console.error("Error creating Zid webhook subscription - Server responded with error:");
                console.error("Status:", axiosError.response.status);
                console.error("Data:", JSON.stringify(axiosError.response.data, null, 2));
            }
            else if (axiosError.request) {
                console.error("Error creating Zid webhook subscription - No response received. Request details:", axiosError.config);
            }
            else {
                console.error("Error creating Zid webhook subscription - Error in request setup:", axiosError.message);
            }
            return null;
        }
    }
}
exports.ZidApiService = ZidApiService;
