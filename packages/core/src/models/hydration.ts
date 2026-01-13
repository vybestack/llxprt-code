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
import { getModelsRegistry } from './registry.js';
import { PROVIDER_ID_MAP } from './provider-integration.js';

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

/**
 * Get the models.dev provider IDs for a given llxprt provider name.
 *
 * @param providerName - The llxprt provider name (e.g., 'gemini', 'openai')
 * @returns Array of models.dev provider IDs, or null if no mapping found
 */
export function getModelsDevProviderIds(
  providerName: string,
): string[] | null {
  const ids = PROVIDER_ID_MAP[providerName];
  if (ids && ids.length > 0) {
    return ids;
  }
  // Fallback: use provider name as-is if no explicit mapping
  return [providerName];
}

/**
 * Hydrate a list of IModel with data from models.dev registry.
 *
 * @param models - Base models from provider.getModels()
 * @param modelsDevProviderIds - The models.dev provider IDs to lookup (e.g., ["openrouter", "chutes"])
 * @returns Models with hydration data where available
 */
export async function hydrateModelsWithRegistry(
  models: IModel[],
  modelsDevProviderIds: string[] | null,
): Promise<HydratedModel[]> {
  const registry = getModelsRegistry();

  // If registry not initialized or no provider IDs, return unhydrated
  if (!registry.isInitialized() || !modelsDevProviderIds) {
    return models.map((m) => ({ ...m, hydrated: false }));
  }

  // Collect all models from mapped provider IDs
  const registryModels: LlxprtModel[] = [];
  for (const providerId of modelsDevProviderIds) {
    const models = registry.getByProvider(providerId);
    registryModels.push(...models);
  }

  // Build lookup map: modelId -> LlxprtModel
  // Index by multiple keys for flexible matching
  const registryMap = new Map<string, LlxprtModel>();
  for (const rm of registryModels) {
    registryMap.set(rm.modelId, rm); // Short ID (e.g., "gpt-4o")
    registryMap.set(rm.id, rm); // Full ID (e.g., "openai/gpt-4o")
    registryMap.set(rm.name, rm); // Display name
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
 * Find a partial match for a model ID in the registry map.
 * Handles cases where provider-specific prefixes/suffixes differ.
 */
function findPartialMatch(
  modelId: string,
  registryMap: Map<string, LlxprtModel>,
): LlxprtModel | undefined {
  const normalizedId = modelId.toLowerCase();

  for (const [key, model] of registryMap) {
    const normalizedKey = key.toLowerCase();
    // Check if the registry key is contained in the model ID or vice versa
    if (normalizedId.includes(normalizedKey) || normalizedKey.includes(normalizedId)) {
      return model;
    }
  }

  return undefined;
}
