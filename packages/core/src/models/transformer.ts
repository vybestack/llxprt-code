/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ModelsDevModel,
  ModelsDevProvider,
  LlxprtModel,
  LlxprtProvider,
  LlxprtModelCapabilities,
} from './schema.js';
import { generateDefaultProfile } from './profiles.js';

/**
 * Known provider type mappings for tool format support
 */
const PROVIDER_TOOL_FORMATS: Record<string, string[]> = {
  anthropic: ['anthropic'],
  openai: ['openai'],
  google: ['google', 'gemini'],
  'google-vertex': ['google', 'gemini'],
  deepseek: ['openai'],
  groq: ['openai'],
  mistral: ['openai'],
  cohere: ['openai'],
  xai: ['openai'],
  togetherai: ['openai'],
  perplexity: ['openai'],
  deepinfra: ['openai'],
  fireworks: ['openai'],
  ollama: ['openai'],
};

/**
 * Transform a models.dev model to llxprt format
 */
export function transformModel(
  providerId: string,
  provider: ModelsDevProvider,
  modelId: string,
  model: ModelsDevModel,
): LlxprtModel {
  const fullId = `${providerId}/${modelId}`;

  // Extract capabilities from modalities
  const inputModalities = model.modalities?.input ?? ['text'];

  const capabilities: LlxprtModelCapabilities = {
    vision: inputModalities.includes('image'),
    audio: inputModalities.includes('audio'),
    pdf: inputModalities.includes('pdf'),
    toolCalling: model.tool_call ?? false,
    reasoning: model.reasoning ?? false,
    temperature: model.temperature ?? false,
    structuredOutput: model.structured_output ?? false,
    attachment: model.attachment ?? false,
  };

  // Determine tool formats based on provider
  const supportedToolFormats = PROVIDER_TOOL_FORMATS[providerId] ?? ['openai'];

  // Map status
  const status = mapStatus(model.status);

  return {
    // Core identity (IModel compatible)
    id: fullId,
    name: model.name,
    provider: provider.name,

    // Provider info
    providerId,
    providerName: provider.name,
    modelId,
    family: model.family,

    // IModel compatibility
    supportedToolFormats,
    contextWindow: model.limit.context,
    maxOutputTokens: model.limit.output,

    // Extended data
    capabilities,

    pricing: model.cost
      ? {
          input: model.cost.input,
          output: model.cost.output,
          reasoning: model.cost.reasoning,
          cacheRead: model.cost.cache_read,
          cacheWrite: model.cost.cache_write,
        }
      : undefined,

    limits: {
      contextWindow: model.limit.context,
      maxOutput: model.limit.output,
    },

    metadata: {
      knowledgeCutoff: model.knowledge,
      releaseDate: model.release_date,
      lastUpdated: model.last_updated,
      openWeights: model.open_weights,
      status,
    },

    defaultProfile: generateDefaultProfile(model),

    // Provider config
    envVars: provider.env,
    apiEndpoint: provider.api,
    npmPackage: provider.npm,
    docUrl: provider.doc,
  };
}

/**
 * Transform a models.dev provider to llxprt format
 */
export function transformProvider(
  providerId: string,
  provider: ModelsDevProvider,
): LlxprtProvider {
  return {
    id: providerId,
    name: provider.name,
    envVars: provider.env,
    apiEndpoint: provider.api,
    npmPackage: provider.npm,
    docUrl: provider.doc,
    modelCount: Object.keys(provider.models).length,
  };
}

/**
 * Map models.dev status to llxprt status
 */
function mapStatus(
  status?: 'alpha' | 'beta' | 'deprecated',
): 'stable' | 'beta' | 'alpha' | 'deprecated' {
  if (!status) return 'stable';
  return status;
}

/**
 * Transform entire models.dev API response to llxprt format
 */
export function transformApiResponse(data: Record<string, ModelsDevProvider>): {
  models: Map<string, LlxprtModel>;
  providers: Map<string, LlxprtProvider>;
} {
  const models = new Map<string, LlxprtModel>();
  const providers = new Map<string, LlxprtProvider>();

  for (const [providerId, provider] of Object.entries(data)) {
    // Transform provider
    providers.set(providerId, transformProvider(providerId, provider));

    // Transform models
    for (const [modelId, model] of Object.entries(provider.models)) {
      const transformed = transformModel(providerId, provider, modelId, model);
      models.set(transformed.id, transformed);
    }
  }

  return { models, providers };
}
