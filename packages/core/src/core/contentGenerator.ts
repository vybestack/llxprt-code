/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import type {
  ModelGenerationRequest,
  ModelOutput,
  ModelStreamChunk,
  CountTokensRequest,
  CountTokensResult,
  EmbedContentRequest,
  EmbedContentResult,
} from '../llm-types/index.js';
import { PLACEHOLDER_MODEL } from '../config/models.js';
import type { Config } from '../config/config.js';
/**
 * @plan:PLAN-20260603-ISSUE1584.P05
 * @requirement:REQ-DEP-001
 * @pseudocode component-boundaries.md C-CB-03, lines 30-34
 *
 * RuntimeContentGeneratorFactory allows injection of content generators
 * without core directly constructing ProviderContentGenerator. When a
 * factory is set on ContentGeneratorConfig, it is preferred.
 */
import type { RuntimeContentGeneratorFactory } from '../runtime/contracts/RuntimeContentGeneratorFactory.js';
import type { RuntimeProviderManager } from '../runtime/contracts/RuntimeProviderManager.js';

/**
 * Neutral ContentGenerator interface. All request/response types come from the
 * provider-agnostic llm-types layer. Implementations convert to/from their
 * native shapes at the provider boundary.
 */
export interface ContentGenerator {
  generateContent(
    request: ModelGenerationRequest,
    userPromptId: string,
  ): Promise<ModelOutput>;

  generateContentStream(
    request: ModelGenerationRequest,
    userPromptId: string,
  ): Promise<AsyncGenerator<ModelStreamChunk>>;

  countTokens(request: CountTokensRequest): Promise<CountTokensResult>;

  embedContent(request: EmbedContentRequest): Promise<EmbedContentResult>;
}

export type ContentGeneratorConfig = {
  model: string;
  apiKey?: string;
  vertexai?: boolean;
  providerManager?: RuntimeProviderManager;
  /**
   * @plan:PLAN-20260603-ISSUE1584.P05
   * @requirement:REQ-DEP-001
   * @pseudocode component-boundaries.md C-CB-03, lines 30-34
   *
   * When provided, the contentGeneratorFactory is used to create
   * a ContentGenerator instead of constructing ProviderContentGenerator
   * directly. This eliminates the core→providers construction dependency
   * on the injection path.
   */
  contentGeneratorFactory?: RuntimeContentGeneratorFactory<ContentGenerator>;
  proxy?: string;
};

function firstNonEmptyEnvironmentValue(
  primary: string | undefined,
  fallback: string | undefined,
): string | undefined {
  if (primary !== undefined && primary !== '') {
    return primary;
  }
  if (fallback !== '') {
    return fallback;
  }
  return undefined;
}

export function createContentGeneratorConfig(
  config: Config,
): ContentGeneratorConfig {
  const geminiApiKey = process.env.GEMINI_API_KEY ?? undefined;
  const googleApiKey = process.env.GOOGLE_API_KEY ?? undefined;
  const googleCloudProject = firstNonEmptyEnvironmentValue(
    process.env['GOOGLE_CLOUD_PROJECT'],
    process.env.GOOGLE_CLOUD_PROJECT_ID,
  );
  const googleCloudLocation = process.env.GOOGLE_CLOUD_LOCATION ?? undefined;

  // No implicit Gemini model fallback: when no model is configured, use the
  // placeholder sentinel so the unconfigured state is observable.
  const effectiveModel = config.getModel() || PLACEHOLDER_MODEL;

  const contentGeneratorConfig: ContentGeneratorConfig = {
    model: effectiveModel,
    proxy: config.getProxy(),
  };

  if (geminiApiKey) {
    contentGeneratorConfig.apiKey = geminiApiKey;
    contentGeneratorConfig.vertexai = false;
    return contentGeneratorConfig;
  }

  if (googleApiKey || (googleCloudProject && googleCloudLocation)) {
    contentGeneratorConfig.apiKey = googleApiKey;
    contentGeneratorConfig.vertexai = true;
    return contentGeneratorConfig;
  }

  return contentGeneratorConfig;
}

export async function createContentGenerator(
  config: ContentGeneratorConfig,
  _gcConfig: Config,
  _sessionId?: string,
): Promise<ContentGenerator> {
  // @plan:PLAN-20260603-ISSUE1584.P05
  // @requirement:REQ-DEP-001
  // Prefer factory injection when available — eliminates core→providers construction
  if (config.providerManager != null) {
    if (config.contentGeneratorFactory != null) {
      return config.contentGeneratorFactory.createContentGenerator(
        config.providerManager,
      );
    }
    throw new Error(
      'Provider content generator factory is required when a provider manager is configured',
    );
  }

  // @plan:PLAN-20260603-ISSUE1584.P11
  // @requirement:REQ-DEP-001
  // Core must not construct provider-owned content generators. The embedding
  // process must compose the providers package instead of falling back to a
  // Gemini implementation in core.
  throw new Error(
    'No provider runtime is composed for this Config. Compose the providers package (see packages/providers/src/composition) before creating a content generator.',
  );
}
