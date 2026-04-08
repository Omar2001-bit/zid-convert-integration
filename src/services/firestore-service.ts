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
// === END OF FIRESTORE SERVICE                                    ===
// ===================================================================