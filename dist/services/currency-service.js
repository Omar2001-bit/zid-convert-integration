"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CurrencyService = void 0;
// src/services/currency-service.ts
const axios_1 = __importDefault(require("axios"));
// --- Configuration ---
const TARGET_CURRENCY = 'SAR'; // The currency we want to convert everything TO
const API_KEY = process.env.EXCHANGERATE_API_KEY;
const API_BASE_URL = 'https://v6.exchangerate-api.com/v6';
// Cache rates for 24 hours to stay well within the free tier limits
const CACHE_VALIDITY_DURATION_MS = 24 * 60 * 60 * 1000;
const exchangeRateCache = {}; // Key will be the original currency code (e.g., "KWD")
class CurrencyService {
    /**
     * Converts an amount from an original currency to SAR using ExchangeRate-API.
     * This version is simpler because the API supports direct pair conversion.
     * @param amount The amount to convert.
     * @param originalCurrency The ISO 4217 code of the original currency (e.g., "KWD", "USD").
     * @returns A Promise that resolves to the converted amount in SAR, rounded to 2 decimal places.
     *          Returns the original amount on failure.
     */
    static async convertToSAR(amount, originalCurrency) {
        // --- Initial Checks ---
        if (!API_KEY) {
            console.error('CRITICAL: EXCHANGERATE_API_KEY is not set in the .env file. Cannot perform currency conversion.');
            return parseFloat(amount.toFixed(2));
        }
        const upperOriginalCurrency = originalCurrency.toUpperCase();
        if (upperOriginalCurrency === TARGET_CURRENCY || amount === 0) {
            return parseFloat(amount.toFixed(2));
        }
        // --- Cache Check ---
        const cachedEntry = exchangeRateCache[upperOriginalCurrency];
        if (cachedEntry && (Date.now() - cachedEntry.timestamp < CACHE_VALIDITY_DURATION_MS)) {
            console.log(`CurrencyService: Using cached rate for ${upperOriginalCurrency} -> ${TARGET_CURRENCY}. Rate: ${cachedEntry.rate}`);
            const convertedAmount = amount * cachedEntry.rate;
            return parseFloat(convertedAmount.toFixed(2));
        }
        // --- API Call ---
        console.log(`CurrencyService: Cache miss or stale for ${upperOriginalCurrency}. Fetching new rate from API.`);
        try {
            const apiUrl = `${API_BASE_URL}/${API_KEY}/pair/${upperOriginalCurrency}/${TARGET_CURRENCY}`;
            const response = await axios_1.default.get(apiUrl);
            if (response.data && response.data.result === 'success') {
                const rate = response.data.conversion_rate;
                console.log(`CurrencyService: Fetched rate: 1 ${upperOriginalCurrency} = ${rate} ${TARGET_CURRENCY}`);
                // Store the new rate in the cache
                exchangeRateCache[upperOriginalCurrency] = { rate, timestamp: Date.now() };
                const convertedAmount = amount * rate;
                return parseFloat(convertedAmount.toFixed(2));
            }
            else {
                // Handle API-level errors (e.g., "unsupported-code")
                console.error(`CurrencyService: API returned an error for ${upperOriginalCurrency}. Error: ${response.data['error-type'] || 'Unknown error'}`);
                return parseFloat(amount.toFixed(2)); // Fallback
            }
        }
        catch (error) {
            const axiosError = error;
            if (axiosError.isAxiosError && axiosError.response) {
                console.error(`CurrencyService: HTTP error fetching rate for ${upperOriginalCurrency}. Status: ${axiosError.response.status}. Data:`, axiosError.response.data);
            }
            else {
                console.error(`CurrencyService: Network or other error fetching rate for ${upperOriginalCurrency}. Error:`, error);
            }
            return parseFloat(amount.toFixed(2)); // Fallback
        }
    }
}
exports.CurrencyService = CurrencyService;
