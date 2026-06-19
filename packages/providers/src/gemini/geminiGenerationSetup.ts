/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Part, type GenerateContentResponse } from '@google/genai';
import { type Config } from '@vybestack/llxprt-code-core/config/config.js';
import { type IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { type NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { type ResponseToChunksMapper } from './geminiResponseMapper.js';
import {
  type ReasoningConfig,
  extractReasoningConfig,
  extractDumpConfig,
} from './geminiReasoningConfig.js';
import {
  buildGeminiTools,
  buildRequestConfig,
  convertToGeminiContents,
  prepareContentsWithSignatures,
} from './geminiRequestBuilding.js';
import { createGeminiResponseMapper } from './geminiResponseMapper.js';
import type { GeminiAuthMode } from './geminiServerTools.js';

export type HttpOptions = { headers: Record<string, string> };

/** Resolved setup for a generation call. */
export interface GeminiGenerationSetup {
  authMode: GeminiAuthMode;
  authToken: string;
  currentModel: string;
  contentsWithSignatures: Array<{ role: string; parts: Part[] }>;
  requestConfig: Record<string, unknown>;
  baseURL: string | undefined;
  httpOptions: HttpOptions;
  mapResponseToChunks: ResponseToChunksMapper;
  reasoningConfig: ReasoningConfig;
  toolNamesForPrompt: string[] | undefined;
  shouldDumpSuccess: boolean;
  shouldDumpError: boolean;
}

/**
 * Build the full generation setup (auth, tools, request config, contents)
 * for a generation request. Extracted from GeminiProvider to keep the
 * provider class thin.
 */
export async function buildGenerationSetup(
  options: NormalizedGenerateChatOptions,
  globalConfig: Config | undefined,
  resolveAuth: () => Promise<{
    authMode: GeminiAuthMode;
    token: string;
  }>,
  createHttpOptions: () => HttpOptions,
  getBaseURL: () => string | undefined,
): Promise<GeminiGenerationSetup> {
  const { contents: content, tools } = options;
  const { authMode, token: authToken } = await resolveAuth();
  const currentModel = options.resolved.model;
  const configForMessages =
    options.config ?? options.runtime?.config ?? globalConfig;
  const contents = convertToGeminiContents(
    content,
    currentModel,
    configForMessages,
  );
  const reasoningConfig = extractReasoningConfig(options);
  const { shouldDumpSuccess, shouldDumpError } = extractDumpConfig(options);
  const contentsWithSignatures = prepareContentsWithSignatures(
    contents,
    reasoningConfig.stripFromContext,
  );
  const { geminiTools, toolNamesForPrompt } = buildGeminiTools(tools);
  const mapResponseToChunks: (
    response: GenerateContentResponse,
    includeThoughts?: boolean,
  ) => IContent[] = createGeminiResponseMapper();
  return {
    authMode,
    authToken,
    currentModel,
    contentsWithSignatures,
    requestConfig: buildRequestConfig(
      options,
      geminiTools,
      reasoningConfig,
      currentModel,
    ),
    baseURL: options.resolved.baseURL ?? getBaseURL(),
    httpOptions: createHttpOptions(),
    mapResponseToChunks,
    reasoningConfig,
    toolNamesForPrompt,
    shouldDumpSuccess,
    shouldDumpError,
  };
}
