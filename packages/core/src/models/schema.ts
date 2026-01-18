/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

/**
 * models.dev API schemas (source format)
 * @see https://models.dev/api.json
 */

export const ModelsDevModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  family: z.string().optional(),

  // Capabilities - all optional since API data is inconsistent
  attachment: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  tool_call: z.boolean().optional(),
  temperature: z.boolean().optional(),
  structured_output: z.boolean().optional(),

  // Interleaved thinking (for reasoning models)
  interleaved: z
    .union([
      z.literal(true),
      z.object({
        field: z.enum(['reasoning_content', 'reasoning_details']),
      }),
    ])
    .optional(),

  // Pricing (per million tokens, USD)
  cost: z
    .object({
      input: z.number(),
      output: z.number(),
      reasoning: z.number().optional(),
      cache_read: z.number().optional(),
      cache_write: z.number().optional(),
      context_over_200k: z
        .object({
          input: z.number(),
          output: z.number(),
          cache_read: z.number().optional(),
          cache_write: z.number().optional(),
        })
        .optional(),
    })
    .optional(),

  // Limits (tokens)
  limit: z.object({
    context: z.number(),
    output: z.number(),
  }),

  // Modalities
  modalities: z
    .object({
      input: z.array(z.enum(['text', 'audio', 'image', 'video', 'pdf'])),
      output: z.array(z.enum(['text', 'audio', 'image', 'video', 'pdf'])),
    })
    .optional(),

  // Metadata
  knowledge: z.string().optional(),
  release_date: z.string(),
  last_updated: z.string().optional(),
  open_weights: z.boolean(),
  status: z.enum(['alpha', 'beta', 'deprecated']).optional(),
  experimental: z.boolean().optional(),

  // Provider-specific options
  options: z.record(z.string(), z.unknown()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  provider: z.object({ npm: z.string() }).optional(),
  variants: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
});

export const ModelsDevProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  env: z.array(z.string()),
  api: z.string().optional(),
  npm: z.string().optional(),
  doc: z.string().optional(),
  models: z.record(z.string(), ModelsDevModelSchema),
});

export const ModelsDevApiResponseSchema = z.record(
  z.string(),
  ModelsDevProviderSchema,
);

export type ModelsDevModel = z.infer<typeof ModelsDevModelSchema>;
export type ModelsDevProvider = z.infer<typeof ModelsDevProviderSchema>;
export type ModelsDevApiResponse = z.infer<typeof ModelsDevApiResponseSchema>;

/**
 * llxprt internal model format (enriched format)
 * Extends the base IModel interface with models.dev data
 */

export const LlxprtModelCapabilitiesSchema = z.object({
  vision: z.boolean(),
  audio: z.boolean(),
  pdf: z.boolean(),
  toolCalling: z.boolean(),
  reasoning: z.boolean(),
  temperature: z.boolean(),
  structuredOutput: z.boolean(),
  attachment: z.boolean(),
});

export const LlxprtModelPricingSchema = z.object({
  input: z.number(), // USD per million tokens
  output: z.number(),
  reasoning: z.number().optional(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional(),
});

export const LlxprtModelLimitsSchema = z.object({
  contextWindow: z.number(),
  maxOutput: z.number(),
});

export const LlxprtModelMetadataSchema = z.object({
  knowledgeCutoff: z.string().optional(),
  releaseDate: z.string(),
  lastUpdated: z.string().optional(),
  openWeights: z.boolean(),
  status: z.enum(['stable', 'beta', 'alpha', 'deprecated']).optional(),
});

export const LlxprtDefaultProfileSchema = z.object({
  temperature: z.number().optional(),
  topP: z.number().optional(),
  topK: z.number().optional(),
  thinkingBudget: z.number().optional(),
  thinkingEnabled: z.boolean().optional(),
});

export const LlxprtModelSchema = z.object({
  // Core identity (compatible with IModel)
  id: z.string(), // Format: provider/model-id
  name: z.string(),
  provider: z.string(), // Provider name for IModel compatibility

  // Provider info
  providerId: z.string(),
  providerName: z.string(),
  modelId: z.string(),
  family: z.string().optional(),

  // IModel compatibility
  supportedToolFormats: z.array(z.string()),
  contextWindow: z.number().optional(),
  maxOutputTokens: z.number().optional(),

  // Extended models.dev data
  capabilities: LlxprtModelCapabilitiesSchema,
  pricing: LlxprtModelPricingSchema.optional(),
  limits: LlxprtModelLimitsSchema,
  metadata: LlxprtModelMetadataSchema,
  defaultProfile: LlxprtDefaultProfileSchema.optional(),

  // Provider config
  envVars: z.array(z.string()),
  apiEndpoint: z.string().optional(),
  npmPackage: z.string().optional(),
  docUrl: z.string().optional(),
});

export const LlxprtProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  envVars: z.array(z.string()),
  apiEndpoint: z.string().optional(),
  npmPackage: z.string().optional(),
  docUrl: z.string().optional(),
  modelCount: z.number(),
});

export type LlxprtModelCapabilities = z.infer<
  typeof LlxprtModelCapabilitiesSchema
>;
export type LlxprtModelPricing = z.infer<typeof LlxprtModelPricingSchema>;
export type LlxprtModelLimits = z.infer<typeof LlxprtModelLimitsSchema>;
export type LlxprtModelMetadata = z.infer<typeof LlxprtModelMetadataSchema>;
export type LlxprtDefaultProfile = z.infer<typeof LlxprtDefaultProfileSchema>;
export type LlxprtModel = z.infer<typeof LlxprtModelSchema>;
export type LlxprtProvider = z.infer<typeof LlxprtProviderSchema>;

/**
 * Cache metadata schema
 */
export const ModelCacheMetadataSchema = z.object({
  fetchedAt: z.string(), // ISO date string
  version: z.string(),
  providerCount: z.number(),
  modelCount: z.number(),
});

export type ModelCacheMetadata = z.infer<typeof ModelCacheMetadataSchema>;
