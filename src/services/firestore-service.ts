// src/services/firestore-service.ts

import * as admin from 'firebase-admin';
// Fix: Corrected import name from 'ConvertBucketingEntry' to 'StoredConvertBucketingEntry'
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
    // Add a server timestamp. This is useful for TTL/cleanup rules later on Firestore.
    // Ensure the timestamp property on StoredBucketingInfo is defined as admin.firestore.FieldValue for type compatibility.
    const contextToSave = {
      ...context,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection(CONVERSION_CONTEXT_COLLECTION)
            .doc(context.convertVisitorId) // Use convertVisitorId as the document ID
            .set(contextToSave, { merge: true }); // Use merge to update existing fields without overwriting the whole doc
    console.log(`DEBUG: Context saved/updated in Firestore for visitor: ${context.convertVisitorId}`);
  } catch (error) {
    console.error(`ERROR: Failed to save context for visitor ${context.convertVisitorId} to Firestore:`, error instanceof Error ? error.message : error);
    throw error; // Re-throw to be handled by the caller if necessary
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
      // Cast the data to StoredBucketingInfo, ensuring proper type conversion if needed (e.g., timestamp)
      const data = doc.data() as StoredBucketingInfo;
      // Convert Firestore Timestamp to number if your StoredBucketingInfo expects a number
      // For now, let's assume it can handle Firebase's Timestamp type if used directly or a number (Date.now()) if not.
      // If it absolutely needs a number, add: data.timestamp = (data.timestamp as any)?.toMillis() || Date.now();
      console.log(`DEBUG: Context found in Firestore by convertVisitorId: ${convertVisitorId}`);
      return data;
    } else {
      console.log(`DEBUG: Context NOT FOUND in Firestore by convertVisitorId: ${convertVisitorId}`);
      return null;
    }
  } catch (error) {
    console.error(`ERROR: Failed to retrieve context by convertVisitorId ${convertVisitorId} from Firestore:`, error instanceof Error ? error.message : error);
    return null; // Return null on error so caller can handle gracefully
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
    // Query for documents where zidCustomerId matches, ordered by timestamp (most recent first)
    const snapshot = await db.collection(CONVERSION_CONTEXT_COLLECTION)
                              .where('zidCustomerId', '==', zidCustomerId)
                              .orderBy('timestamp', 'desc') // Important for getting the most recent context
                              .limit(1) // We only need one matching document
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
    return null; // Return null on error so caller can handle gracefully
  }
};