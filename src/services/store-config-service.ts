// src/services/store-config-service.ts
import * as admin from 'firebase-admin';
import { StoreConfig } from '../types/index';

const STORE_CONFIG_COLLECTION = 'storeConfig';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CachedConfig {
  config: StoreConfig;
  fetchedAt: number;
}

const configCache: Map<string, CachedConfig> = new Map();

/**
 * Get store config by storeId. Uses in-memory cache with 5-minute TTL.
 */
export const getStoreConfig = async (storeId: string): Promise<StoreConfig | null> => {
  if (!storeId) {
    console.log('DEBUG: No storeId provided for config lookup.');
    return null;
  }

  // Check cache
  const cached = configCache.get(storeId);
  if (cached && (Date.now() - cached.fetchedAt < CACHE_TTL_MS)) {
    console.log(`DEBUG: Store config cache HIT for storeId: ${storeId}`);
    return cached.config;
  }

  try {
    const db = admin.firestore();
    const doc = await db.collection(STORE_CONFIG_COLLECTION).doc(storeId).get();

    if (doc.exists) {
      const config = doc.data() as StoreConfig;
      if (!config.active) {
        console.log(`DEBUG: Store config found but INACTIVE for storeId: ${storeId}`);
        return null;
      }
      configCache.set(storeId, { config, fetchedAt: Date.now() });
      console.log(`DEBUG: Store config loaded from Firestore for storeId: ${storeId} (${config.storeName})`);
      return config;
    } else {
      console.log(`DEBUG: Store config NOT FOUND for storeId: ${storeId}`);
      return null;
    }
  } catch (error) {
    console.error(`ERROR: Failed to load store config for storeId ${storeId}:`, error instanceof Error ? error.message : error);
    return null;
  }
};

/**
 * Get all active store configs. Used for CORS origin list.
 */
export const getAllActiveStoreConfigs = async (): Promise<StoreConfig[]> => {
  try {
    const db = admin.firestore();
    const snapshot = await db.collection(STORE_CONFIG_COLLECTION)
                              .where('active', '==', true)
                              .get();

    const configs: StoreConfig[] = [];
    snapshot.forEach(doc => {
      configs.push(doc.data() as StoreConfig);
    });
    console.log(`DEBUG: Loaded ${configs.length} active store config(s) from Firestore.`);
    return configs;
  } catch (error) {
    console.error('ERROR: Failed to load active store configs:', error instanceof Error ? error.message : error);
    return [];
  }
};

/**
 * Save or update a store config document.
 */
export const saveStoreConfig = async (config: StoreConfig): Promise<void> => {
  if (!config.storeId) {
    throw new Error('storeId is required to save store config.');
  }
  try {
    const db = admin.firestore();
    const docData = {
      ...config,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    // Set createdAt only on new documents
    const existing = await db.collection(STORE_CONFIG_COLLECTION).doc(config.storeId).get();
    if (!existing.exists) {
      (docData as any).createdAt = admin.firestore.FieldValue.serverTimestamp();
    }

    await db.collection(STORE_CONFIG_COLLECTION)
            .doc(config.storeId)
            .set(docData, { merge: true });

    // Invalidate cache
    configCache.delete(config.storeId);
    console.log(`DEBUG: Store config saved for storeId: ${config.storeId} (${config.storeName})`);
  } catch (error) {
    console.error(`ERROR: Failed to save store config for storeId ${config.storeId}:`, error instanceof Error ? error.message : error);
    throw error;
  }
};

/**
 * Clear the config cache (useful after admin updates).
 */
export const clearConfigCache = (): void => {
  configCache.clear();
  console.log('DEBUG: Store config cache cleared.');
};
