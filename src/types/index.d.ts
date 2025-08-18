// src/types/index.d.ts

import * as admin from 'firebase-admin'; // For Firestore types like FieldValue, Timestamp

// --- Core Application Types for Persistent Context Storage ---

// Represents a single experiment-variation pair as stored persistently in Firestore.
// IDs are stored as numbers for internal consistency within our backend.
export interface StoredConvertBucketingEntry {
  experienceId: number;
  variationId: number;
}

// Represents the client-side context (visitor data, experiment buckets) stored persistently.
export interface StoredBucketingInfo {
  convertVisitorId: string; // This will be the document ID in Firestore
  zidCustomerId?: string; // Optional Zid customer ID, stored for lookup
  convertBucketing: StoredConvertBucketingEntry[]; // Array of experiments and variations with numeric IDs
  // Timestamp can be a Firestore FieldValue (for writes), a Timestamp object (for reads), or a number (for in-memory compatibility)
  timestamp: admin.firestore.FieldValue | admin.firestore.Timestamp | number; 
  zidPagePath?: string; // Optional page path where context was captured
}

// NEW: A normalized interface for bucketing information after retrieval,
// ensuring consistent type structure for downstream processing.
export interface NormalizedBucketingInfo {
  convertVisitorId: string;
  zidCustomerId?: string;
  // Here, we standardize to strings for experiment/variation IDs, as often needed for Convert API directly.
  // This is the format that the controllers will process after fetching from either source.
  convertBucketing: Array<{ experimentId: string; variationId: string; }>;
  timestamp: number; // Normalized to a simple number (milliseconds) for processing
  zidPagePath?: string;
}

// --- Zid API Related Types ---
// Interface for Zid product data as received from Zid webhooks/APIs
export interface ZidProduct {
    id: string | number;
    sku?: string;
    name: string;
    price: number | string;
    quantity: number | string;
}

// --- Convert.com Modern Metrics API Types ---
// These interfaces define the structure of data sent TO Convert.com's API.
// They match the expected payload structure for the v1/track endpoint.

export interface Visitor {
    visitorId: string;
    events: Event[];
}

export interface Event {
    eventType: 'bucketing' | 'conversion' | 'page_view' | 'custom_event'; // Common event types recognized by Convert API
    data: ConvertApiBucketingData | ConversionEventData; // Data structure changes based on eventType
}

// Data structure for a 'bucketing' event sent to Convert.com.
// Convert.com's API expects experienceId and variationId as STRINGS for bucketing events.
export interface ConvertApiBucketingData {
    experienceId: string; 
    variationId: string;  
}

// Data structure for a 'conversion' event sent to Convert.com.
export interface ConversionEventData {
    goalId: number;
    transactionId?: string;
    revenue?: number;
    products?: ConvertApiProduct[]; // Array of products involved in the conversion
    metadata?: { [key: string]: any }; // Optional metadata field
}

// Product interface specific to Convert.com API payload.
export interface ConvertApiProduct { 
    productId: string;
    productName: string;
    unitPrice: number; // Price per unit
    quantity: number;  // Number of units purchased
}