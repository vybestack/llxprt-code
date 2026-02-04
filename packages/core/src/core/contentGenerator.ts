/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CountTokensResponse,
  GenerateContentResponse,
  type GenerateContentParameters,
  type CountTokensParameters,
  EmbedContentResponse,
  type EmbedContentParameters,
} from '@google/genai';
import { createCodeAssistContentGenerator } from '../code_assist/codeAssist.js';
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';
import { Config } from '../config/config.js';
import type { IProviderManager as ProviderManager } from '../providers/IProviderManager.js';
import { ProviderContentGenerator } from '../providers/ProviderContentGenerator.js';
import { UserTierId } from '../code_assist/types.js';
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
  providerManager?: ProviderManager;
  proxy?: string;
};

export function createContentGeneratorConfig(
  config: Config,
): ContentGeneratorConfig {
  const geminiApiKey = process.env.GEMINI_API_KEY || undefined;
  const googleApiKey = process.env.GOOGLE_API_KEY || undefined;
  const googleCloudProject =
    process.env['GOOGLE_CLOUD_PROJECT'] ||
    process.env['GOOGLE_CLOUD_PROJECT_ID'] ||
    undefined;
  const googleCloudLocation = process.env.GOOGLE_CLOUD_LOCATION || undefined;

  // Use runtime model from config if available; otherwise, fall back to parameter or default
  const effectiveModel = config.getModel() || DEFAULT_GEMINI_MODEL;

  const contentGeneratorConfig: ContentGeneratorConfig = {
    model: effectiveModel,
    proxy: config?.getProxy(),
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
  const version = process.env.CLI_VERSION || process.version;
  const httpOptions = {
    headers: {
      'User-Agent': `LLxprt-Code/${version} (${process.platform}; ${process.arch})`,
    },
  };
  // Always use provider path if a provider manager exists
  if (config.providerManager) {
    return new ProviderContentGenerator(config.providerManager, config);
  }

  if (config.vertexai) {
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
  if (gcConfig?.getUsageStatisticsEnabled()) {
    const installationManager = new InstallationManager();
    const installationId = installationManager.getInstallationId();
    requestOptions.headers['x-gemini-api-privileged-user-id'] =
      `${installationId}`;
  }
  return new GoogleGenAIWrapper(config, requestOptions);
}
