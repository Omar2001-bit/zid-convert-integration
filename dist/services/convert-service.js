"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConvertApiService = void 0;
// src/services/convert-service.ts
const axios_1 = __importDefault(require("axios"));
class ConvertApiService {
    constructor() {
        // Empty constructor
    }
    // Your original function is preserved but will no longer be used by the webhook.
    static async sendEventToConvert(payload) {
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
            const response = await axios_1.default.post(url, payload, { headers: requestHeaders });
            console.log("Convert event sent successfully. Status:", response.status);
            return response.data;
        }
        catch (error) {
            const axiosError = error;
            if (axiosError.response) {
                console.error("Error sending event to Convert - Server responded with error:");
                console.error("Status:", axiosError.response.status);
                console.error("Data:", JSON.stringify(axiosError.response.data, null, 2));
            }
            else if (axiosError.request) {
                console.error("Error sending event to Convert - No response received. Request was made to:", url);
            }
            else {
                console.error("Error sending event to Convert - Error in request setup:", error.message);
            }
            return null;
        }
    }
    // ==========================================================================================
    // === DEFINITIVE FIX: This function is rewritten to use the correct v1/track endpoint ======
    // ==========================================================================================
    static async sendServingApiEvents(accountId, projectId, visitor) {
        // 1. The URL is now correct, with account and project IDs in the path.
        const url = `https://metrics.convertexperiments.com/v1/track/${accountId}/${projectId}`;
        // 2. The payload no longer contains accountId or projectId in the body.
        const payload = {
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
            const response = await axios_1.default.post(url, payload, { headers: requestHeaders });
            console.log(`New Convert v1/track API events sent successfully. Status:`, response.status);
            return response.data;
        }
        catch (error) {
            const axiosError = error;
            if (axiosError.response) {
                console.error("Error sending to v1/track API - Server responded with error:");
                console.error("Status:", axiosError.response.status);
                console.error("Data:", JSON.stringify(axiosError.response.data, null, 2));
            }
            else {
                console.error("Error sending to v1/track API - Error in request setup:", error.message);
            }
            return null;
        }
    }
}
exports.ConvertApiService = ConvertApiService;
