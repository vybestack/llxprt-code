/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  type Part,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type GoogleGenAI,
} from '@google/genai';
import type { GeminiAuthMode } from './geminiAuth.js';
import { throwIfAborted } from './geminiAbort.js';

export type { GeminiAuthMode } from './geminiAuth.js';

export type HttpOptions = { headers: Record<string, string> };

/**
 * Factory that creates the OAuth content generator used by server tools.
 */
export type OAuthContentGeneratorFactory = (
  httpOptions: Record<string, unknown>,
  config: Config,
  baseURL?: string,
) => Promise<{
  generateContent?: (
    params: GenerateContentParameters,
    sessionId?: string,
  ) => Promise<GenerateContentResponse>;
}>;

/** Context passed to server tool invokers from the provider. */
export interface ServerToolContext {
  resolveAuth: (
    signal?: AbortSignal,
  ) => Promise<{ authMode: GeminiAuthMode; token: string }>;
  createHttpOptions: () => HttpOptions;
  getBaseURL: () => string | undefined;
  createGenAIClient: (
    authToken: string,
    authMode: GeminiAuthMode,
    httpOptions: HttpOptions,
    baseURL?: string,
  ) => Promise<GoogleGenAI>;
  globalConfig: Config | undefined;
  createOAuthContentGenerator: OAuthContentGeneratorFactory;
}

/** Build Gemini content for a simple text query (web_search/web_fetch). */
function buildTextQueryContent(
  text: string,
): Array<{ role: string; parts: Part[] }> {
  return [{ role: 'user', parts: [{ text }] }];
}

/**
 * Resolve OAuth config, creating a minimal one if globalConfig is not set.
 */
async function resolveOAuthConfig(
  globalConfig: Config | undefined,
  logger: DebugLogger,
): Promise<Config> {
  if (!globalConfig) {
    logger.debug(
      () =>
        `invokeServerTool: globalConfig is null, creating minimal config for OAuth`,
    );
    return new Config({
      sessionId: randomUUID(),
      targetDir: process.cwd(),
      debugMode: false,
      cwd: process.cwd(),
      model: 'gemini-2.5-flash',
    });
  }
  return globalConfig;
}

/** Invoke web_search server tool. */
export async function invokeWebSearch(
  params: unknown,
  signal: AbortSignal | undefined,
  logger: DebugLogger,
  context: ServerToolContext,
): Promise<unknown> {
  logger.debug(
    () =>
      `invokeServerTool: web_search called with params: ${JSON.stringify(params)}`,
  );

  throwIfAborted(signal);
  const httpOptions = context.createHttpOptions();
  const { authMode, token: authToken } = await context.resolveAuth(signal);
  throwIfAborted(signal);
  const query = (params as { query: string }).query;

  switch (authMode) {
    case 'gemini-api-key':
      return invokeWebSearchApiKey(context, authToken, httpOptions, query);
    case 'vertex-ai':
      return invokeWebSearchVertex(context, authToken, httpOptions, query);
    case 'oauth':
      return invokeWebSearchOAuth(context, httpOptions, query, logger);
    default:
      throw new Error(`Web search not supported in auth mode: ${authMode}`);
  }
}

async function invokeWebSearchApiKey(
  context: ServerToolContext,
  authToken: string,
  httpOptions: HttpOptions,
  query: string,
): Promise<unknown> {
  if (!authToken || authToken === 'USE_LOGIN_WITH_GOOGLE' || authToken === '') {
    throw new Error('No valid Gemini API key available for web search');
  }
  const genAI = await context.createGenAIClient(
    authToken,
    'gemini-api-key',
    httpOptions,
    context.getBaseURL() ?? undefined,
  );
  const request = {
    model: 'gemini-2.5-flash',
    contents: buildTextQueryContent(query),
    config: { tools: [{ googleSearch: {} }] },
  };
  return genAI.models.generateContent(request);
}

async function invokeWebSearchVertex(
  context: ServerToolContext,
  authToken: string,
  httpOptions: HttpOptions,
  query: string,
): Promise<unknown> {
  const genAI = await context.createGenAIClient(
    authToken,
    'vertex-ai',
    httpOptions,
    context.getBaseURL() ?? undefined,
  );
  const request = {
    model: 'gemini-2.5-flash',
    contents: buildTextQueryContent(query),
    config: { tools: [{ googleSearch: {} }] },
  };
  return genAI.models.generateContent(request);
}

async function invokeWebSearchOAuth(
  context: ServerToolContext,
  httpOptions: HttpOptions,
  query: string,
  logger: DebugLogger,
): Promise<unknown> {
  try {
    logger.debug(
      () => `invokeServerTool: OAuth case - creating content generator`,
    );
    const configForOAuth = await resolveOAuthConfig(
      context.globalConfig,
      logger,
    );
    const oauthContentGenerator = await context.createOAuthContentGenerator(
      httpOptions,
      configForOAuth,
    );
    const oauthRequest: GenerateContentParameters = {
      model: 'gemini-2.5-flash',
      contents: buildTextQueryContent(query),
      config: { tools: [{ googleSearch: {} }] },
    };
    if (oauthContentGenerator.generateContent === undefined) {
      throw new Error(
        'OAuth content generator does not support non-streaming generation',
      );
    }
    return await oauthContentGenerator.generateContent(
      oauthRequest,
      'google-web-search-oauth',
    );
  } catch (error) {
    logger.debug(() => `invokeServerTool: ERROR in OAuth case: ${error}`);
    throw error;
  }
}

/** Invoke web_fetch server tool. */
export async function invokeWebFetch(
  params: unknown,
  signal: AbortSignal | undefined,
  logger: DebugLogger,
  context: ServerToolContext,
): Promise<unknown> {
  throwIfAborted(signal);
  const prompt = (params as { prompt: string }).prompt;
  const httpOptions = context.createHttpOptions();
  const { authMode, token: authToken } = await context.resolveAuth(signal);
  throwIfAborted(signal);

  switch (authMode) {
    case 'gemini-api-key':
      return invokeWebFetchApiKey(context, authToken, httpOptions, prompt);
    case 'vertex-ai':
      return invokeWebFetchVertex(context, authToken, httpOptions, prompt);
    case 'oauth':
      return invokeWebFetchOAuth(context, httpOptions, prompt, logger);
    default:
      throw new Error(`Web fetch not supported in auth mode: ${authMode}`);
  }
}

async function invokeWebFetchApiKey(
  context: ServerToolContext,
  authToken: string,
  httpOptions: HttpOptions,
  prompt: string,
): Promise<unknown> {
  if (!authToken || authToken === 'USE_LOGIN_WITH_GOOGLE' || authToken === '') {
    throw new Error('No valid Gemini API key available for web fetch');
  }
  const genAI = await context.createGenAIClient(
    authToken,
    'gemini-api-key',
    httpOptions,
    context.getBaseURL() ?? undefined,
  );
  const request = {
    model: 'gemini-2.5-flash',
    contents: buildTextQueryContent(prompt),
    config: { tools: [{ urlContext: {} }] },
  };
  return genAI.models.generateContent(request);
}

async function invokeWebFetchVertex(
  context: ServerToolContext,
  authToken: string,
  httpOptions: HttpOptions,
  prompt: string,
): Promise<unknown> {
  const genAI = await context.createGenAIClient(
    authToken,
    'vertex-ai',
    httpOptions,
    context.getBaseURL() ?? undefined,
  );
  const request = {
    model: 'gemini-2.5-flash',
    contents: buildTextQueryContent(prompt),
    config: { tools: [{ urlContext: {} }] },
  };
  return genAI.models.generateContent(request);
}

async function invokeWebFetchOAuth(
  context: ServerToolContext,
  httpOptions: HttpOptions,
  prompt: string,
  logger: DebugLogger,
): Promise<unknown> {
  const configForOAuth = await resolveOAuthConfig(context.globalConfig, logger);
  const oauthContentGenerator = await context.createOAuthContentGenerator(
    httpOptions,
    configForOAuth,
    undefined,
  );
  const oauthRequest: GenerateContentParameters = {
    model: 'gemini-2.5-flash',
    contents: buildTextQueryContent(prompt),
    config: { tools: [{ urlContext: {} }] },
  };
  if (oauthContentGenerator.generateContent === undefined) {
    throw new Error(
      'OAuth content generator does not support non-streaming generation',
    );
  }
  return oauthContentGenerator.generateContent(
    oauthRequest,
    'google-web-fetch-oauth',
  );
}
