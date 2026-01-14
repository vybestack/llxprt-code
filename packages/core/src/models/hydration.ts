/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Model Hydration Utilities
 *
 * Enriches base IModel data with extended information from models.dev registry.
 * Provides a unified path for all model-fetching flows.
 */

import type { IModel } from '../providers/IModel.js';
import type {
  LlxprtModel,
  LlxprtModelCapabilities,
  LlxprtModelPricing,
  LlxprtModelLimits,
  LlxprtModelMetadata,
} from './schema.js';
import { getModelRegistry } from './registry.js';

/**
 * Extended model data from models.dev hydration.
 * All fields optional since hydration may fail or model may not exist in registry.
 */
export interface ModelHydrationData {
  // Capabilities
  capabilities?: LlxprtModelCapabilities;

  // Pricing (USD per million tokens)
  pricing?: LlxprtModelPricing;

  // Limits
  limits?: LlxprtModelLimits;

  // Metadata
  metadata?: LlxprtModelMetadata;

  // Provider info from registry
  providerId?: string;
  modelId?: string;
  family?: string;

  // Hydration status
  hydrated: boolean;
}

/**
 * Model with optional hydration data from models.dev
 */
export type HydratedModel = IModel & Partial<ModelHydrationData>;

// Re-export for backward compatibility
export { getModelsDevProviderIds } from './provider-integration.js';

/**
 * Hydrate a list of IModel with data from models.dev registry.
 *
 * @param models - Base models from provider.getModels()
 * @param modelsDevProviderIds - The models.dev provider IDs to lookup (e.g., ["openrouter", "chutes"])
 * @returns Models with hydration data where available
 */
export async function hydrateModelsWithRegistry(
  models: IModel[],
  modelsDevProviderIds: string[],
): Promise<HydratedModel[]> {
  const registry = getModelRegistry();

  // If registry not initialized or no provider IDs, return unhydrated
  if (!registry.isInitialized() || modelsDevProviderIds.length === 0) {
    return models.map((m) => ({ ...m, hydrated: false }));
  }

  // Collect all models from mapped provider IDs
  const registryModels: LlxprtModel[] = [];
  for (const providerId of modelsDevProviderIds) {
    const providerModels = registry.getByProvider(providerId);
    registryModels.push(...providerModels);
  }

  // Build lookup map: modelId -> LlxprtModel
  // Index by multiple keys for flexible matching
  //
  // NOTE: Name-based indexing can cause collisions if multiple models share
  // the same display name. This is acceptable because:
  // 1. modelsDevProviderIds typically maps to a single provider
  // 2. Multi-provider IDs (e.g., ['google', 'google-vertex']) are same-vendor
  // 3. Primary lookup is by model.id; name is a fallback only
  const registryMap = new Map<string, LlxprtModel>();
  for (const rm of registryModels) {
    registryMap.set(rm.modelId, rm); // Short ID (e.g., "gpt-4o")
    registryMap.set(rm.id, rm); // Full ID (e.g., "openai/gpt-4o")
    registryMap.set(rm.name, rm); // Display name (fallback, may collide)
  }

  // Hydrate each model
  return models.map((model) => {
    // Try multiple matching strategies
    const registryModel =
      registryMap.get(model.id) ||
      registryMap.get(model.name) ||
      // Try partial match for models with prefixes/suffixes
      findPartialMatch(model.id, registryMap);

    if (!registryModel) {
      // Model not found in registry - return unhydrated
      return { ...model, hydrated: false };
    }

    // Merge registry data
    return {
      ...model,
      // Override context/output if registry has them
      contextWindow: registryModel.contextWindow ?? model.contextWindow,
      maxOutputTokens: registryModel.maxOutputTokens ?? model.maxOutputTokens,
      // Add hydration data
      capabilities: registryModel.capabilities,
      pricing: registryModel.pricing,
      limits: registryModel.limits,
      metadata: registryModel.metadata,
      providerId: registryModel.providerId,
      modelId: registryModel.modelId,
      family: registryModel.family,
      hydrated: true,
    };
  });
}

/**
 * Separators used for tokenizing model IDs
 */
const MODEL_ID_SEPARATORS = /[-_./]/;

/**
 * Minimum score threshold for a partial match to be considered valid.
 * This prevents false positives from overly loose matching.
 */
const MATCH_SCORE_THRESHOLD = 50;

/**
 * Calculate match score between a model ID and a registry key.
 * Higher scores indicate better matches.
 *
 * Scoring:
 * - Exact match: 100
 * - Exact prefix/suffix with separator: 80
 * - Token overlap: proportional to matching tokens (max 60)
 */
function calculateMatchScore(
  normalizedId: string,
  normalizedKey: string,
): number {
  // Exact match is best
  if (normalizedId === normalizedKey) {
    return 100;
  }

  // Check for exact prefix/suffix with separator
  // e.g., "gpt-4o-2024" matches "gpt-4o" as a prefix
  if (normalizedId.startsWith(normalizedKey)) {
    const remainder = normalizedId.slice(normalizedKey.length);
    if (remainder.length === 0 || MODEL_ID_SEPARATORS.test(remainder[0])) {
      return 80;
    }
  }
  if (normalizedKey.startsWith(normalizedId)) {
    const remainder = normalizedKey.slice(normalizedId.length);
    if (remainder.length === 0 || MODEL_ID_SEPARATORS.test(remainder[0])) {
      return 80;
    }
  }

  // Token-based matching
  const idTokens = new Set(
    normalizedId.split(MODEL_ID_SEPARATORS).filter(Boolean),
  );
  const keyTokens = new Set(
    normalizedKey.split(MODEL_ID_SEPARATORS).filter(Boolean),
  );

  if (idTokens.size === 0 || keyTokens.size === 0) {
    return 0;
  }

  // Count matching tokens
  let matchingTokens = 0;
  for (const token of idTokens) {
    if (keyTokens.has(token)) {
      matchingTokens++;
    }
  }

  // Score based on proportion of matching tokens
  const maxTokens = Math.max(idTokens.size, keyTokens.size);
  const tokenScore = (matchingTokens / maxTokens) * 60;

  return tokenScore;
}

/**
 * Find the best partial match for a model ID in the registry map.
 * Uses scoring to prevent false positives from overly loose matching.
 */
function findPartialMatch(
  modelId: string,
  registryMap: Map<string, LlxprtModel>,
): LlxprtModel | undefined {
  const normalizedId = modelId.toLowerCase();

  let bestMatch: LlxprtModel | undefined;
  let bestScore = 0;

  for (const [key, model] of registryMap) {
    const normalizedKey = key.toLowerCase();
    const score = calculateMatchScore(normalizedId, normalizedKey);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = model;
    }
  }

  // Only return if score meets threshold
  if (bestScore >= MATCH_SCORE_THRESHOLD) {
    return bestMatch;
  }

  return undefined;
}
