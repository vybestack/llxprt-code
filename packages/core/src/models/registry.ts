/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Storage } from '../config/storage.js';
import {
  ModelsDevApiResponseSchema,
  type ModelsDevApiResponse,
  type LlxprtModel,
  type LlxprtProvider,
  type ModelCacheMetadata,
} from './schema.js';
import { transformApiResponse } from './transformer.js';

const MODELS_DEV_API_URL = 'https://models.dev/api.json';
const CACHE_FILENAME = 'models.json';
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 10000; // 10 seconds

/**
 * Search query options for filtering models
 */
export interface ModelSearchQuery {
  provider?: string;
  capability?: keyof LlxprtModel['capabilities'];
  maxPrice?: number; // Max input price per million tokens
  minContext?: number; // Minimum context window
  reasoning?: boolean;
  toolCalling?: boolean;
}

/**
 * Event types emitted by the registry
 */
export type ModelRegistryEvent = 'models:updated' | 'models:error';

type EventCallback = () => void;

/**
 * ModelRegistry - Central registry for AI model metadata from models.dev
 *
 * Provides:
 * - Automatic loading from cache or bundled fallback
 * - Background periodic refresh (24h)
 * - Search and filtering by capabilities, price, context
 * - Event emission for UI updates
 */
export class ModelRegistry {
  private models = new Map<string, LlxprtModel>();
  private providers = new Map<string, LlxprtProvider>();
  private lastRefresh: Date | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Map<string, EventCallback[]>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Get the cache file path
   */
  private static getCachePath(): string {
    const cacheDir = path.join(Storage.getGlobalLlxprtDir(), 'cache');
    return path.join(cacheDir, CACHE_FILENAME);
  }

  /**
   * Initialize the registry - loads models and starts background refresh
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      await this.loadModels();
      this.initialized = true;
      this.startBackgroundRefresh();
    })();
    await this.initPromise;
  }

  /**
   * Load models from cache or trigger fresh fetch
   */
  private async loadModels(): Promise<void> {
    // Try cache first
    const cached = await this.loadFromCache();
    if (cached) {
      this.populateModels(cached);
      return;
    }

    // No cache - trigger refresh
    this.refresh().catch(() => {
      // Silent failure - models will be empty until next refresh
    });
  }

  /**
   * Load from cache file if fresh
   */
  private async loadFromCache(): Promise<ModelsDevApiResponse | null> {
    try {
      const cachePath = ModelRegistry.getCachePath();

      if (!fs.existsSync(cachePath)) {
        return null;
      }

      const stats = fs.statSync(cachePath);
      const age = Date.now() - stats.mtimeMs;

      // Check if cache is stale
      if (age > CACHE_MAX_AGE_MS) {
        return null;
      }

      const content = fs.readFileSync(cachePath, 'utf-8');
      const data = JSON.parse(content);

      // Validate schema
      const validated = ModelsDevApiResponseSchema.safeParse(data);
      if (!validated.success) {
        return null;
      }

      return validated.data;
    } catch {
      return null;
    }
  }

  /**
   * Refresh models from models.dev API (non-blocking)
   */
  async refresh(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(MODELS_DEV_API_URL, {
        headers: {
          'User-Agent': 'llxprt/1.0',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();

      // Validate schema
      const validated = ModelsDevApiResponseSchema.safeParse(data);
      if (!validated.success) {
        return false;
      }

      // Save to cache
      await this.saveToCache(validated.data);

      // Update in-memory registry
      this.populateModels(validated.data);
      this.lastRefresh = new Date();

      this.emit('models:updated');
      return true;
    } catch {
      this.emit('models:error');
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Save data to cache file
   */
  private async saveToCache(data: ModelsDevApiResponse): Promise<void> {
    try {
      const cachePath = ModelRegistry.getCachePath();
      const cacheDir = path.dirname(cachePath);

      // Ensure cache directory exists
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));
    } catch {
      // Silent failure - cache is optional
    }
  }

  /**
   * Populate internal maps from API response
   */
  private populateModels(data: ModelsDevApiResponse): void {
    const { models, providers } = transformApiResponse(data);
    this.models = models;
    this.providers = providers;
  }

  /**
   * Start background refresh timer
   */
  private startBackgroundRefresh(): void {
    if (this.refreshTimer) return;

    this.refreshTimer = setInterval(() => {
      this.refresh().catch(() => {
        // Silent failure
      });
    }, REFRESH_INTERVAL_MS);

    // Don't prevent process exit
    this.refreshTimer.unref?.();
  }

  /**
   * Stop background refresh and cleanup
   */
  dispose(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.listeners.clear();
  }

  // ============== Public Query API ==============

  /**
   * Get all models
   */
  getAll(): LlxprtModel[] {
    return Array.from(this.models.values());
  }

  /**
   * Get model by full ID (provider/model-id)
   */
  getById(id: string): LlxprtModel | undefined {
    return this.models.get(id);
  }

  /**
   * Get all models for a specific provider
   */
  getByProvider(providerId: string): LlxprtModel[] {
    return this.getAll().filter((m) => m.providerId === providerId);
  }

  /**
   * Search models by various criteria
   */
  search(query: ModelSearchQuery): LlxprtModel[] {
    let results = this.getAll();

    if (query.provider) {
      results = results.filter((m) => m.providerId === query.provider);
    }

    if (query.capability) {
      results = results.filter((m) => m.capabilities[query.capability!]);
    }

    if (query.reasoning !== undefined) {
      results = results.filter(
        (m) => m.capabilities.reasoning === query.reasoning,
      );
    }

    if (query.toolCalling !== undefined) {
      results = results.filter(
        (m) => m.capabilities.toolCalling === query.toolCalling,
      );
    }

    if (query.maxPrice !== undefined) {
      results = results.filter(
        (m) => m.pricing && m.pricing.input <= query.maxPrice!,
      );
    }

    if (query.minContext !== undefined) {
      results = results.filter(
        (m) => m.limits.contextWindow >= query.minContext!,
      );
    }

    return results;
  }

  /**
   * Get all providers
   */
  getProviders(): LlxprtProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get provider by ID
   */
  getProvider(providerId: string): LlxprtProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * Get cache metadata
   */
  getCacheMetadata(): ModelCacheMetadata | null {
    if (!this.lastRefresh) return null;

    return {
      fetchedAt: this.lastRefresh.toISOString(),
      version: '1.0',
      providerCount: this.providers.size,
      modelCount: this.models.size,
    };
  }

  /**
   * Check if registry has been initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get model count
   */
  getModelCount(): number {
    return this.models.size;
  }

  /**
   * Get provider count
   */
  getProviderCount(): number {
    return this.providers.size;
  }

  // ============== Event System ==============

  /**
   * Subscribe to registry events
   */
  on(event: ModelRegistryEvent, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  /**
   * Unsubscribe from registry events
   */
  off(event: ModelRegistryEvent, callback: EventCallback): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index !== -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Emit an event
   */
  private emit(event: ModelRegistryEvent): void {
    const callbacks = this.listeners.get(event) || [];
    callbacks.forEach((cb) => cb());
  }
}

// Singleton instance
let registryInstance: ModelRegistry | null = null;

/**
 * Get the global ModelRegistry instance
 */
export function getModelRegistry(): ModelRegistry {
  if (!registryInstance) {
    registryInstance = new ModelRegistry();
  }
  return registryInstance;
}

/**
 * Initialize the global ModelRegistry
 */
export async function initializeModelRegistry(): Promise<ModelRegistry> {
  const registry = getModelRegistry();
  await registry.initialize();
  return registry;
}
