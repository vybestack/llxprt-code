/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { type Part, type GoogleGenAI } from '@google/genai';
import type { GeminiAuthMode } from './geminiAuth.js';
import { throwIfAborted } from './geminiAbort.js';

export type { GeminiAuthMode } from './geminiAuth.js';

export type HttpOptions = { headers: Record<string, string> };

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
}

/** Build Gemini content for a simple text query (web_search/web_fetch). */
function buildTextQueryContent(
  text: string,
): Array<{ role: string; parts: Part[] }> {
  return [{ role: 'user', parts: [{ text }] }];
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
  if (!authToken) {
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
  if (!authToken) {
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
