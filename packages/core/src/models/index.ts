/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Models Registry - models.dev integration for llxprt
 *
 * Provides automatic model discovery, pricing, and capabilities
 * from the models.dev API with caching and fallback support.
 *
 * @example
 * ```typescript
 * import { initializeModelRegistry, getModelRegistry } from '@vybestack/llxprt-code-core/models';
 *
 * // Initialize on startup
 * await initializeModelRegistry();
 *
 * // Get registry instance
 * const registry = getModelRegistry();
 *
 * // Query models
 * const allModels = registry.getAll();
 * const claudeModels = registry.getByProvider('anthropic');
 * const reasoningModels = registry.search({ reasoning: true });
 * ```
 */

// Core registry
export {
  ModelRegistry,
  getModelRegistry,
  initializeModelRegistry,
  type ModelSearchQuery,
  type ModelRegistryEvent,
} from './registry.js';

// Schemas and types
export {
  // models.dev API schemas
  ModelsDevModelSchema,
  ModelsDevProviderSchema,
  ModelsDevApiResponseSchema,
  type ModelsDevModel,
  type ModelsDevProvider,
  type ModelsDevApiResponse,

  // llxprt internal schemas
  LlxprtModelSchema,
  LlxprtProviderSchema,
  LlxprtModelCapabilitiesSchema,
  LlxprtModelPricingSchema,
  LlxprtModelLimitsSchema,
  LlxprtModelMetadataSchema,
  LlxprtDefaultProfileSchema,
  type LlxprtModel,
  type LlxprtProvider,
  type LlxprtModelCapabilities,
  type LlxprtModelPricing,
  type LlxprtModelLimits,
  type LlxprtModelMetadata,
  type LlxprtDefaultProfile,

  // Cache metadata
  ModelCacheMetadataSchema,
  type ModelCacheMetadata,
} from './schema.js';

// Transformers
export {
  transformModel,
  transformProvider,
  transformApiResponse,
} from './transformer.js';

// Profile utilities
export {
  generateDefaultProfile,
  getRecommendedThinkingBudget,
  mergeProfileWithDefaults,
} from './profiles.js';

// Provider integration utilities
export {
  llxprtModelToIModel,
  hasModelInRegistry,
  getExtendedModelInfo,
  getRecommendedModel,
} from './provider-integration.js';

// Hydration utilities
export {
  hydrateModelsWithRegistry,
  getModelsDevProviderIds,
  type HydratedModel,
  type ModelHydrationData,
} from './hydration.js';
