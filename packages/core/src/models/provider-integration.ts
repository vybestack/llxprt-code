/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provider Integration Layer for ModelsRegistry
 *
 * Provides utilities for IProvider implementations to fetch model data
 * from the ModelsRegistry with graceful fallback to hardcoded lists.
 */

import type { IModel } from '../providers/IModel.js';
import type { LlxprtModel } from './schema.js';
import { getModelsRegistry } from './registry.js';

/**
 * Maps llxprt provider names to models.dev provider IDs
 * models.dev uses different naming in some cases
 */
const PROVIDER_ID_MAP: Record<string, string[]> = {
  // llxprt provider name -> models.dev provider ID(s)
  gemini: ['google', 'google-vertex'],
  openai: ['openai'],
  anthropic: ['anthropic'],
  'openai-responses': ['openai'],
  'openai-vercel': ['openai'],
  deepseek: ['deepseek'],
  groq: ['groq'],
  mistral: ['mistral'],
  cohere: ['cohere'],
  xai: ['xai'],
  ollama: ['ollama'],
  togetherai: ['togetherai'],
  perplexity: ['perplexity'],
  fireworks: ['fireworks-ai'],

  // Alias provider display names -> models.dev provider IDs
  'Chutes.ai': ['chutes'],
  'xAI': ['xai'],
  'Synthetic': ['synthetic'],
  'Fireworks': ['fireworks-ai'],
  'OpenRouter': ['openrouter'],
  'Cerebras Code': ['cerebras'],
  'LM Studio': ['lmstudio'],
  'llama.cpp': ['llama'],
  qwen: ['alibaba'],
  qwenvercel: ['alibaba'],
  codex: ['openai'],
  kimi: ['kimi-for-coding'],
};

/**
 * Options for getting models from registry
 */
export interface GetModelsFromRegistryOptions {
  /** The llxprt provider name (e.g., 'gemini', 'openai') */
  providerName: string;
  /** Fallback models to use if registry is empty or unavailable */
  fallbackModels?: IModel[];
  /** Whether to include deprecated models (default: false) */
  includeDeprecated?: boolean;
  /** Filter to specific model IDs */
  modelIds?: string[];
}

/**
 * Converts an LlxprtModel to the IModel interface
 * LlxprtModel already has all IModel fields, but this ensures type safety
 */
export function llxprtModelToIModel(model: LlxprtModel): IModel {
  return {
    id: model.modelId, // Use the short model ID, not the full "provider/model" ID
    name: model.name,
    provider: model.provider,
    supportedToolFormats: model.supportedToolFormats,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
  };
}

/**
 * Get models for a provider from the ModelsRegistry
 *
 * This function is designed to be called from IProvider.getModels() implementations.
 * It provides:
 * - Automatic lookup of models from the registry
 * - Mapping of provider names to models.dev provider IDs
 * - Fallback to hardcoded models if registry is unavailable
 * - Filtering of deprecated models (optional)
 *
 * @example
 * ```typescript
 * // In a provider's getModels() method:
 * async getModels(): Promise<IModel[]> {
 *   return getModelsFromRegistry({
 *     providerName: 'gemini',
 *     fallbackModels: this.getHardcodedModels(),
 *   });
 * }
 * ```
 */
export async function getModelsFromRegistry(
  options: GetModelsFromRegistryOptions,
): Promise<IModel[]> {
  const {
    providerName,
    fallbackModels = [],
    includeDeprecated = false,
    modelIds,
  } = options;

  try {
    const registry = getModelsRegistry();

    // If registry hasn't been initialized, use fallback
    if (!registry.isInitialized()) {
      return fallbackModels;
    }

    // Map llxprt provider name to models.dev provider ID(s)
    const modelsDevProviderIds = PROVIDER_ID_MAP[providerName] ?? [
      providerName,
    ];

    // Collect models from all mapped provider IDs
    const llxprtModels: LlxprtModel[] = [];
    for (const providerId of modelsDevProviderIds) {
      const models = registry.getByProvider(providerId);
      llxprtModels.push(...models);
    }

    // If no models found in registry, use fallback
    if (llxprtModels.length === 0) {
      return fallbackModels;
    }

    // Filter models
    let filteredModels = llxprtModels;

    // Filter out deprecated unless explicitly included
    if (!includeDeprecated) {
      filteredModels = filteredModels.filter(
        (m) => m.metadata?.status !== 'deprecated',
      );
    }

    // Filter to specific model IDs if provided
    if (modelIds && modelIds.length > 0) {
      const modelIdSet = new Set(modelIds);
      filteredModels = filteredModels.filter(
        (m) => modelIdSet.has(m.modelId) || modelIdSet.has(m.id),
      );
    }

    // Convert to IModel interface
    return filteredModels.map(llxprtModelToIModel);
  } catch {
    // On any error, return fallback models
    return fallbackModels;
  }
}

/**
 * Check if a specific model ID exists in the registry for a provider
 */
export function hasModelInRegistry(
  providerName: string,
  modelId: string,
): boolean {
  try {
    const registry = getModelsRegistry();
    if (!registry.isInitialized()) {
      return false;
    }

    const modelsDevProviderIds = PROVIDER_ID_MAP[providerName] ?? [
      providerName,
    ];

    for (const providerId of modelsDevProviderIds) {
      // Try both full ID format (provider/model) and short ID
      const fullId = `${providerId}/${modelId}`;
      if (registry.getById(fullId)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Get extended model info from registry (pricing, capabilities, etc.)
 * Returns undefined if model not found or registry unavailable
 */
export function getExtendedModelInfo(
  providerName: string,
  modelId: string,
): LlxprtModel | undefined {
  try {
    const registry = getModelsRegistry();
    if (!registry.isInitialized()) {
      return undefined;
    }

    const modelsDevProviderIds = PROVIDER_ID_MAP[providerName] ?? [
      providerName,
    ];

    for (const providerId of modelsDevProviderIds) {
      const fullId = `${providerId}/${modelId}`;
      const model = registry.getById(fullId);
      if (model) {
        return model;
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Get recommended model for a provider based on capabilities
 * Useful for selecting default models
 */
export function getRecommendedModel(
  providerName: string,
  options?: {
    requireToolCalling?: boolean;
    requireReasoning?: boolean;
    preferCheaper?: boolean;
  },
): LlxprtModel | undefined {
  try {
    const registry = getModelsRegistry();
    if (!registry.isInitialized()) {
      return undefined;
    }

    const modelsDevProviderIds = PROVIDER_ID_MAP[providerName] ?? [
      providerName,
    ];

    // Collect all models from mapped providers
    let candidates: LlxprtModel[] = [];
    for (const providerId of modelsDevProviderIds) {
      candidates.push(...registry.getByProvider(providerId));
    }

    // Filter out deprecated
    candidates = candidates.filter((m) => m.metadata?.status !== 'deprecated');

    // Apply capability filters
    if (options?.requireToolCalling) {
      candidates = candidates.filter((m) => m.capabilities.toolCalling);
    }

    if (options?.requireReasoning) {
      candidates = candidates.filter((m) => m.capabilities.reasoning);
    }

    if (candidates.length === 0) {
      return undefined;
    }

    // Sort by preference
    if (options?.preferCheaper) {
      candidates.sort((a, b) => {
        const priceA = a.pricing?.input ?? Infinity;
        const priceB = b.pricing?.input ?? Infinity;
        return priceA - priceB;
      });
    } else {
      // Default: prefer larger context window (usually better models)
      candidates.sort((a, b) => {
        const ctxA = a.limits.contextWindow ?? 0;
        const ctxB = b.limits.contextWindow ?? 0;
        return ctxB - ctxA;
      });
    }

    return candidates[0];
  } catch {
    return undefined;
  }
}
