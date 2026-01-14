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
import { getModelRegistry } from './registry.js';

/**
 * Maps llxprt provider names to models.dev provider IDs
 * models.dev uses different naming in some cases
 */
export const PROVIDER_ID_MAP: Record<string, string[]> = {
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
  xAI: ['xai'],
  Synthetic: ['synthetic'],
  Fireworks: ['fireworks-ai'],
  OpenRouter: ['openrouter'],
  'Cerebras Code': ['cerebras'],
  'LM Studio': ['lmstudio'],
  'llama.cpp': ['llama'],
  qwen: ['alibaba'],
  qwenvercel: ['alibaba'],
  codex: ['openai'],
  kimi: ['kimi-for-coding'],
};

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
 * Get the models.dev provider IDs for a given llxprt provider name.
 * Falls back to using the provider name itself if no mapping exists.
 *
 * @param providerName - The llxprt provider name (e.g., 'gemini', 'openai')
 * @returns Array of models.dev provider IDs
 */
export function getModelsDevProviderIds(providerName: string): string[] {
  return PROVIDER_ID_MAP[providerName] ?? [providerName];
}

/**
 * Check if a specific model ID exists in the registry for a provider
 */
export function hasModelInRegistry(
  providerName: string,
  modelId: string,
): boolean {
  try {
    const registry = getModelRegistry();
    if (!registry.isInitialized()) {
      return false;
    }

    const providerIds = getModelsDevProviderIds(providerName);

    for (const providerId of providerIds) {
      // Try full ID format (provider/model)
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
    const registry = getModelRegistry();
    if (!registry.isInitialized()) {
      return undefined;
    }

    const providerIds = getModelsDevProviderIds(providerName);

    for (const providerId of providerIds) {
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
    const registry = getModelRegistry();
    if (!registry.isInitialized()) {
      return undefined;
    }

    const providerIds = getModelsDevProviderIds(providerName);

    // Collect all models from mapped providers
    let candidates: LlxprtModel[] = [];
    for (const providerId of providerIds) {
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
