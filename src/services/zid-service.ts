import axios, { AxiosError } from 'axios';

// ... (Keep existing interfaces: ZidTokenResponse, ZidProductInOrder, ZidOrder, ZidPaginatedOrdersResponse) ...
interface ZidTokenResponse {
    access_token: string;
    expires_in: number;
    token_type: string;
    scope?: string;
    refresh_token?: string;
    authorization?: string;
}

interface ZidProductInOrder {
    id: number | string;
    name: string;
    price: string; 
    quantity: number;
    sku?: string;
}

interface ZidOrder {
    id: number;
    code?: string;
    reference_id?: string;
    order_total?: string;
    currency_code?: string;
    products?: ZidProductInOrder[];
    customer?: {
        id?: string | number;
        name?: string;
        email?: string;
        mobile?: string;
    };
    order_total_string?: string;
    payment_status?: string;
    created_at?: string;
}

interface ZidPaginatedOrdersResponse {
    orders: ZidOrder[];
    status?: string;
    grand_total?: number;
    total_order_count?: number;
    total_order_count_per_status?: Record<string, number>;
    tax_settings?: any[];
    storeColors?: any;
    printed_invoice_settings?: any;
    orders_list_view_settings?: any;
    message?: {
        type?: string;
        code?: string | null;
        name?: string | null;
        description?: string | null;
    };
    links?: { first: string | null; last: string | null; prev: string | null; next: string | null; };
    meta?: { current_page: number; from: number | null; last_page: number; path: string; per_page: number; to: number | null; total: number; };
}

interface CreateWebhookPayload {
    event: string; // e.g., "order.create"
    target_url: string;
    original_id: number | string; // Your internal reference
    subscriber: string; // Your app's name
    conditions?: any; // Optional conditions object
}

interface CreateWebhookResponse { // Define based on Zid's actual response structure
    id?: string; // Webhook UUID from Zid
    event?: string;
    target_url?: string;
    store_id?: string;
    // ... other fields Zid might return ...
    message?: any;
    status?: any;
    // Does Zid return the webhook_secret here? We need to check.
    // If not, the secret must be obtained from the dashboard when manually setting one up for testing.
}


export class ZidApiService {
    // CONSTRUCTOR FIX - This is the missing piece that was causing the module resolution error
    constructor() {
        // Empty constructor - fixes TypeScript module resolution issue
    }

    // ... (keep existing getTokensByCode, getMerchantProfile, getOrders methods as they are) ...
    public static async getTokensByCode(code: string): Promise<ZidTokenResponse | null> {
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
            console.log("Requesting tokens from Zid. Body:", { ...requestBody, client_secret: '[REDACTED]' });
            const response = await axios.post<ZidTokenResponse>(url, requestBody, {
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            });
            console.log("Tokens received from Zid successfully.");
            return response.data;
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response) {
                console.error("Error fetching tokens - Server responded with error:");
                console.error("Status:", axiosError.response.status);
                console.error("Data:", JSON.stringify(axiosError.response.data, null, 2));
            } else if (axiosError.request) {
                console.error("Error fetching tokens - No response received:", axiosError.request);
            } else {
                console.error("Error fetching tokens - Error in request setup:", axiosError.message);
            }
            throw new Error(`Zid token exchange failed.`);
        }
    }

    public static async getMerchantProfile(
        xManagerTokenValue: string, 
        authorizationJwt: string    
    ): Promise<any | null> {
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
            const response = await axios.get(url, { headers: requestHeaders });
            console.log("Merchant profile fetched successfully.");
            return response.data;
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response) {
                console.error("Error fetching merchant profile - Server responded with error:");
                console.error("Status:", axiosError.response.status);
                console.error("Data:", JSON.stringify(axiosError.response.data, null, 2));
            } else if (axiosError.request) {
                console.error("Error fetching merchant profile - No response received. Request details:", axiosError.config);
            } else {
                console.error("Error fetching merchant profile - Error in request setup:", axiosError.message);
            }
            return null; 
        }
    }

    public static async getOrders(
        xManagerTokenValue: string, 
        authorizationJwt: string,   
        page: number = 1,
        perPage: number = 10
    ): Promise<ZidPaginatedOrdersResponse | null> { 
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
            const response = await axios.get<ZidPaginatedOrdersResponse>(url, { headers: requestHeaders });
            console.log("Orders fetched successfully from Zid API (simplified request).");
            return response.data; 
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response) {
                console.error("Error fetching Zid orders (simplified) - Server responded with error:");
                console.error("Status:", axiosError.response.status);
                console.error("Headers:", JSON.stringify(axiosError.response.headers, null, 2));
                console.error("Data:", JSON.stringify(axiosError.response.data, null, 2));
            } else if (axiosError.request) {
                console.error("Error fetching Zid orders (simplified) - No response received. Request details:", axiosError.config);
            } else {
                console.error("Error fetching Zid orders (simplified) - Error in request setup:", axiosError.message);
            }
            return null;
        }
    }

    // New method to create a webhook subscription
    public static async createWebhookSubscription(
        xManagerTokenValue: string,
        authorizationJwt: string,
        webhookPayload: CreateWebhookPayload
    ): Promise<CreateWebhookResponse | null> {
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
            const response = await axios.post<CreateWebhookResponse>(url, webhookPayload, { headers: requestHeaders });
            console.log("Zid webhook subscription created/updated successfully. Response:", JSON.stringify(response.data, null, 2));
            return response.data;
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response) {
                console.error("Error creating Zid webhook subscription - Server responded with error:");
                console.error("Status:", axiosError.response.status);
                console.error("Data:", JSON.stringify(axiosError.response.data, null, 2));
            } else if (axiosError.request) {
                console.error("Error creating Zid webhook subscription - No response received. Request details:", axiosError.config);
            } else {
                console.error("Error creating Zid webhook subscription - Error in request setup:", axiosError.message);
            }
            return null;
        }
    }
}