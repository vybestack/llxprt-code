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
  CountTokensResponse,
  GenerateContentResponse,
  EmbedContentResponse,
} from '@google/genai';
import {
  type GenerateContentParameters,
  type CountTokensParameters,
  type EmbedContentParameters,
} from '@google/genai';
import { createCodeAssistContentGenerator } from '../code_assist/codeAssist.js';
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';
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
import type { UserTierId } from '../code_assist/types.js';
import { GoogleGenAIWrapper } from './googleGenAIWrapper.js';
import { InstallationManager } from '../utils/installationManager.js';

/**
 * Interface abstracting the core functionalities for generating content and counting tokens.
 */
export interface ContentGenerator {
  generateContent(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<GenerateContentResponse>;

  generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>>;

  countTokens(request: CountTokensParameters): Promise<CountTokensResponse>;

  embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse>;

  userTier?: UserTierId;
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

export function createContentGeneratorConfig(
  config: Config,
): ContentGeneratorConfig {
  const geminiApiKey = process.env.GEMINI_API_KEY ?? undefined;
  const googleApiKey = process.env.GOOGLE_API_KEY ?? undefined;
  const googleCloudProject =
    process.env['GOOGLE_CLOUD_PROJECT'] ??
    process.env['GOOGLE_CLOUD_PROJECT_ID'] ??
    undefined;
  const googleCloudLocation = process.env.GOOGLE_CLOUD_LOCATION ?? undefined;

  // Use runtime model from config if available; otherwise, fall back to parameter or default
  const effectiveModel = config.getModel() || DEFAULT_GEMINI_MODEL;

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
  gcConfig: Config,
  sessionId?: string,
): Promise<ContentGenerator> {
  const version = process.env.CLI_VERSION ?? process.version;
  const httpOptions = {
    headers: {
      'User-Agent': `LLxprt-Code/${version} (${process.platform}; ${process.arch})`,
    },
  };
  // @plan:PLAN-20260603-ISSUE1584.P05
  // @requirement:REQ-DEP-001
  // Prefer factory injection when available — eliminates core→providers construction
  if (
    config.contentGeneratorFactory != null &&
    config.providerManager != null
  ) {
    return config.contentGeneratorFactory.createContentGenerator(
      config.providerManager,
    );
  }

  // @plan:PLAN-20260603-ISSUE1584.P11
  // @requirement:REQ-DEP-001
  // Core must not construct provider-owned content generators. CLI/providers wiring injects the factory.
  if (config.providerManager != null) {
    throw new Error(
      'Provider content generator factory is required when a provider manager is configured',
    );
  }

  if (config.vertexai === true) {
    return createCodeAssistContentGenerator(
      httpOptions,
      gcConfig,
      undefined,
      sessionId,
    );
  }

  if (!config.apiKey) {
    return createCodeAssistContentGenerator(
      httpOptions,
      gcConfig,
      undefined,
      sessionId,
    );
  }

  const requestOptions = { headers: {} as Record<string, string> };
  if (gcConfig.getUsageStatisticsEnabled()) {
    const installationManager = new InstallationManager();
    const installationId = installationManager.getInstallationId();
    requestOptions.headers['x-gemini-api-privileged-user-id'] =
      `${installationId}`;
  }
  return new GoogleGenAIWrapper(config, requestOptions);
}
