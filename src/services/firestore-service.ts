// src/services/firestore-service.ts

import * as admin from 'firebase-admin';
import { StoredBucketingInfo, StoredConvertBucketingEntry } from '../types/index'; 

const CONVERSION_CONTEXT_COLLECTION = 'conversionContext';

/**
 * Saves or updates a client context document in Firestore.
 * The document ID will be the convertVisitorId.
 * @param context The StoredBucketingInfo object to save.
 */
export const saveContext = async (context: StoredBucketingInfo): Promise<void> => {
  if (!context || !context.convertVisitorId) {
    console.warn('WARN: Attempted to save context with missing convertVisitorId or empty context object.');
    return;
  }
  try {
    const db = admin.firestore();
    const contextToSave = {
      ...context,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection(CONVERSION_CONTEXT_COLLECTION)
            .doc(context.convertVisitorId)
            .set(contextToSave, { merge: true });
    // Updated log to be more specific on what is being saved
    console.log(`DEBUG: Context saved/updated in Firestore for visitor: ${context.convertVisitorId}`, contextToSave);
  } catch (error) {
    console.error(`ERROR: Failed to save context for visitor ${context.convertVisitorId} to Firestore:`, error instanceof Error ? error.message : error);
    throw error;
  }
};

/**
 * Retrieves a client context document from Firestore by convertVisitorId.
 * @param convertVisitorId The unique ID of the visitor, typically generated client-side.
 * @returns The StoredBucketingInfo object or null if not found.
 */
export const getContextByConvertVisitorId = async (convertVisitorId: string): Promise<StoredBucketingInfo | null> => {
  if (!convertVisitorId) {
    console.log('DEBUG: No convertVisitorId provided for Firestore lookup, returning null.');
    return null;
  }
  try {
    const db = admin.firestore();
    const docRef = db.collection(CONVERSION_CONTEXT_COLLECTION).doc(convertVisitorId);
    const doc = await docRef.get();

    if (doc.exists) {
      const data = doc.data() as StoredBucketingInfo;
      console.log(`DEBUG: Context found in Firestore by convertVisitorId: ${convertVisitorId}`);
      return data;
    } else {
      console.log(`DEBUG: Context NOT FOUND in Firestore by convertVisitorId: ${convertVisitorId}`);
      return null;
    }
  } catch (error) {
    console.error(`ERROR: Failed to retrieve context by convertVisitorId ${convertVisitorId} from Firestore:`, error instanceof Error ? error.message : error);
    return null;
  }
};

/**
 * Retrieves a client context document from Firestore by zidCustomerId.
 * This will query the collection and should ideally have a Firestore index on 'zidCustomerId' for performance.
 * @param zidCustomerId The Zid customer ID.
 * @returns The most recent StoredBucketingInfo object (if multiple exist for the same customer ID) or null if not found.
 */
export const getContextByZidCustomerId = async (zidCustomerId: string): Promise<StoredBucketingInfo | null> => {
  if (!zidCustomerId) {
    console.log('DEBUG: No zidCustomerId provided for Firestore lookup, returning null.');
    return null;
  }
  try {
    const db = admin.firestore();
    const snapshot = await db.collection(CONVERSION_CONTEXT_COLLECTION)
                              .where('zidCustomerId', '==', zidCustomerId)
                              .orderBy('timestamp', 'desc')
                              .limit(1)
                              .get();

    if (!snapshot.empty) {
      const data = snapshot.docs[0].data() as StoredBucketingInfo;
      console.log(`DEBUG: Context found in Firestore by zidCustomerId: ${zidCustomerId} (associated convertVisitorId: ${data.convertVisitorId})`);
      return data;
    } else {
      console.log(`DEBUG: Context NOT FOUND in Firestore by zidCustomerId: ${zidCustomerId}`);
      return null;
    }
  } catch (error) {
    console.error(`ERROR: Failed to retrieve context by zidCustomerId ${zidCustomerId} from Firestore:`, error instanceof Error ? error.message : error);
    return null;
  }
};


// ===================================================================
// === NEW HEURISTIC LOOKUP FUNCTION FOR GUEST ATTRIBUTION         ===
// ===================================================================
/**
 * Retrieves the most recent guest context from Firestore based on IP address and timestamp.
 * This is a heuristic approach for attributing guest checkouts.
 * @param ipAddress The customer's IP address from the webhook.
 * @param purchaseTimestamp The timestamp of the order creation.
 * @returns The StoredBucketingInfo object or null if not found.
 */
/**
 * Retrieves context from Firestore by guest email or phone.
 * This is used for guest checkout attribution when cart-note injection fails.
 * @param guestEmail The guest customer's email.
 * @param guestPhone The guest customer's phone.
 * @returns The StoredBucketingInfo object or null if not found.
 */
export const getContextByGuestContact = async (guestEmail?: string, guestPhone?: string): Promise<StoredBucketingInfo | null> => {
  if (!guestEmail && !guestPhone) {
    console.log('DEBUG: No guest email or phone provided for lookup, returning null.');
    return null;
  }
  try {
    const db = admin.firestore();

    // Try email first (more reliable)
    if (guestEmail) {
      console.log(`DEBUG: Looking up guest context by email: ${guestEmail}`);
      let snapshot = await db.collection(CONVERSION_CONTEXT_COLLECTION)
                              .where('guestEmail', '==', guestEmail)
                              .orderBy('timestamp', 'desc')
                              .limit(1)
                              .get();

      if (!snapshot.empty) {
        const data = snapshot.docs[0].data() as StoredBucketingInfo;
        console.log(`DEBUG: Guest context FOUND by email ${guestEmail}. Visitor: ${data.convertVisitorId}`);
        return data;
      }
    }

    // Try phone as fallback
    if (guestPhone) {
      console.log(`DEBUG: Looking up guest context by phone: ${guestPhone}`);
      let snapshot = await db.collection(CONVERSION_CONTEXT_COLLECTION)
                              .where('guestPhone', '==', guestPhone)
                              .orderBy('timestamp', 'desc')
                              .limit(1)
                              .get();

      if (!snapshot.empty) {
        const data = snapshot.docs[0].data() as StoredBucketingInfo;
        console.log(`DEBUG: Guest context FOUND by phone ${guestPhone}. Visitor: ${data.convertVisitorId}`);
        return data;
      }
    }

    console.log(`DEBUG: No guest context found by email ${guestEmail || 'N/A'} or phone ${guestPhone || 'N/A'}`);
    return null;
  } catch (error) {
    console.error(`ERROR: Failed to retrieve guest context from Firestore:`, error instanceof Error ? error.message : error);
    return null;
  }
};

/**
 * Retrieves context from Firestore by Zid order ID.
 * This is used when the purchase signal endpoint stored context with the order ID.
 * @param zidOrderId The Zid order ID to look up.
 * @returns The StoredBucketingInfo object or null if not found.
 */
export const getContextByZidOrderId = async (zidOrderId: string): Promise<StoredBucketingInfo | null> => {
  if (!zidOrderId) {
    console.log('DEBUG: No zidOrderId provided for Firestore lookup, returning null.');
    return null;
  }
  try {
    const db = admin.firestore();
    // Look for documents where we stored zidOrderId (from purchase signal endpoint)
    const snapshot = await db.collection(CONVERSION_CONTEXT_COLLECTION)
                              .where('zidOrderId', '==', zidOrderId)
                              .orderBy('timestamp', 'desc')
                              .limit(1)
                              .get();

    if (!snapshot.empty) {
      const data = snapshot.docs[0].data() as StoredBucketingInfo;
      console.log(`DEBUG: Context found in Firestore by zidOrderId: ${zidOrderId}. Visitor: ${data.convertVisitorId}`);
      return data;
    } else {
      console.log(`DEBUG: Context NOT FOUND in Firestore by zidOrderId: ${zidOrderId}`);
      return null;
    }
  } catch (error) {
    console.error(`ERROR: Failed to retrieve context by zidOrderId ${zidOrderId} from Firestore:`, error instanceof Error ? error.message : error);
    return null;
  }
};

export const getHeuristicGuestContext = async (ipAddress: string, purchaseTimestamp: Date): Promise<StoredBucketingInfo | null> => {
  if (!ipAddress) {
    console.log('DEBUG: No IP address provided for heuristic lookup, returning null.');
    return null;
  }
  try {
    const db = admin.firestore();

    // Define an extended time window (30 minutes before the purchase)
    const windowMinutes = 30;
    const startTime = new Date(purchaseTimestamp.getTime() - windowMinutes * 60 * 1000);

    console.log(`DEBUG: Heuristic lookup for IP ${ipAddress} at ${purchaseTimestamp.toISOString()}, window start: ${startTime.toISOString()}`);

    // --- TIER 1: Exact IP match within extended time window ---
    let snapshot = await db.collection(CONVERSION_CONTEXT_COLLECTION)
                            .where('zidCustomerId', '==', null)
                            .where('ipAddress', '==', ipAddress)
                            .where('timestamp', '>=', startTime)
                            .where('timestamp', '<=', purchaseTimestamp)
                            .orderBy('timestamp', 'desc')
                            .limit(1)
                            .get();

    if (!snapshot.empty) {
      const data = snapshot.docs[0].data() as StoredBucketingInfo;
      console.log(`DEBUG: Heuristic context FOUND (Tier 1: IP + time window) for IP ${ipAddress}. Visitor: ${data.convertVisitorId}`);
      return data;
    }

    // --- TIER 2: Exact IP match, any timestamp (most recent guest from this IP) ---
    console.log(`DEBUG: Tier 1 failed, trying Tier 2: Any timestamp for IP ${ipAddress}`);
    snapshot = await db.collection(CONVERSION_CONTEXT_COLLECTION)
                        .where('zidCustomerId', '==', null)
                        .where('ipAddress', '==', ipAddress)
                        .orderBy('timestamp', 'desc')
                        .limit(1)
                        .get();

    if (!snapshot.empty) {
      const data = snapshot.docs[0].data() as StoredBucketingInfo;
      const contextAge = purchaseTimestamp.getTime() - (data.timestamp as any)?.toMillis?.() || Date.now() - (data.timestamp as number);
      const ageMinutes = Math.floor(contextAge / 60000);
      console.log(`DEBUG: Heuristic context FOUND (Tier 2: IP any time) for IP ${ipAddress}. Visitor: ${data.convertVisitorId}. Age: ~${ageMinutes}min`);
      // Only use if within reasonable age (2 hours)
      if (ageMinutes < 120) {
        return data;
      }
      console.log(`DEBUG: Tier 2 context too old (${ageMinutes}min), continuing to Tier 3`);
    }

    // --- TIER 3: Any guest context within time window (IP-agnostic fallback) ---
    // This handles cases where IP might have changed slightly (NAT, proxy, IPv4/IPv6)
    console.log(`DEBUG: Tier 2 failed/no valid, trying Tier 3: Any guest within time window`);
    snapshot = await db.collection(CONVERSION_CONTEXT_COLLECTION)
                        .where('zidCustomerId', '==', null)
                        .where('timestamp', '>=', startTime)
                        .where('timestamp', '<=', purchaseTimestamp)
                        .orderBy('timestamp', 'desc')
                        .limit(1)
                        .get();

    if (!snapshot.empty) {
      const data = snapshot.docs[0].data() as StoredBucketingInfo;
      console.log(`DEBUG: Heuristic context FOUND (Tier 3: time window only, IP-agnostic) for order. Visitor: ${data.convertVisitorId}, IP: ${data.ipAddress}`);
      return data;
    }

    console.log(`DEBUG: All heuristic tiers exhausted for IP ${ipAddress}. No guest context found.`);
    return null;
  } catch (error) {
    console.error(`ERROR: Failed to retrieve heuristic context for IP ${ipAddress} from Firestore:`, error instanceof Error ? error.message : error);
    return null;
  }
};