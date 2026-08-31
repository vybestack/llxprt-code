/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as Ai from 'ai';
import type { JSONSchema7, LanguageModel, Tool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { resolveRuntimeAuthToken } from '../utils/authToken.js';
import { isLocalEndpoint } from '../utils/localEndpoint.js';
import { isQwenBaseURL } from '../utils/qwenEndpoint.js';
import { createCredentialResolutionError } from '../utils/credentialResolutionError.js';
import { createDeveloperRoleToSystemFetch } from './vercelDeveloperRoleFetch.js';
import { createReasoningCaptureFetch } from './vercelReasoningCapture.js';
import type { CaptureBuffer } from './vercelReasoningCapture.js';
import type { OpenAIVercelTool } from './schemaConverter.js';

type VercelTools = Record<string, Tool<unknown, never>>;
type RuntimeToolFunction = {
  name?: unknown;
  description?: unknown;
  parameters?: unknown;
};

const extractReasoningMiddleware = Ai.extractReasoningMiddleware;
const wrapLanguageModel = Ai.wrapLanguageModel;

/**
 * Resolves the AI SDK jsonSchema function if available.
 */
export function getAiJsonSchema():
  | ((schema: JSONSchema7) => unknown)
  | undefined {
  try {
    const candidate = (Ai as { jsonSchema?: unknown }).jsonSchema;
    return typeof candidate === 'function'
      ? (candidate as (schema: JSONSchema7) => unknown)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves the AI SDK tool() function if available.
 */
export function getAiTool():
  | ((config: {
      description?: string;
      inputSchema?: unknown;
    }) => Tool<unknown, never>)
  | undefined {
  try {
    const candidate = (Ai as { tool?: unknown }).tool;
    return typeof candidate === 'function'
      ? (candidate as (config: {
          description?: string;
          inputSchema?: unknown;
        }) => Tool<unknown, never>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build an AI SDK ToolSet from already-normalized OpenAI-style tool definitions.
 *
 * Input is the array produced by convertToolsToOpenAIVercel().
 */
export function buildVercelTools(
  formattedTools?: OpenAIVercelTool[] | undefined,
): VercelTools | undefined {
  if (!formattedTools || formattedTools.length === 0) {
    return undefined;
  }

  const jsonSchemaFn =
    getAiJsonSchema() ?? ((schema: JSONSchema7): unknown => schema);
  const toolFn =
    getAiTool() ??
    ((config: { description?: string; inputSchema?: unknown }) =>
      ({
        description: config.description,
        inputSchema: config.inputSchema ?? {},
      }) as Tool<unknown, never>);

  const toolsRecord: VercelTools = {};

  for (const t of formattedTools) {
    const fn = getRuntimeToolFunction(t);
    const toolName = getRuntimeToolName(fn);
    if (toolName === '' || toolName in toolsRecord) continue;

    const inputSchema = buildRuntimeToolSchema(fn, jsonSchemaFn);

    toolsRecord[toolName] = toolFn({
      description: getRuntimeToolDescription(fn),
      inputSchema,
    });
  }

  return Object.keys(toolsRecord).length > 0 ? toolsRecord : undefined;
}
function getRuntimeToolFunction(
  tool: unknown,
): RuntimeToolFunction | undefined {
  if (typeof tool !== 'object' || tool === null || !('function' in tool)) {
    return undefined;
  }
  const candidate = tool.function;
  if (typeof candidate !== 'object' || candidate === null) {
    return undefined;
  }
  return candidate;
}

function getRuntimeToolName(fn: RuntimeToolFunction | undefined): string {
  return typeof fn?.name === 'string' ? fn.name : '';
}

function getRuntimeToolDescription(
  fn: RuntimeToolFunction | undefined,
): string | undefined {
  return typeof fn?.description === 'string' ? fn.description : undefined;
}

function buildRuntimeToolSchema(
  fn: RuntimeToolFunction | undefined,
  jsonSchemaFn: (schema: JSONSchema7) => unknown,
): unknown {
  if (fn?.parameters !== undefined) {
    return jsonSchemaFn(fn.parameters as JSONSchema7);
  }
  return jsonSchemaFn({
    type: 'object',
    properties: {},
    additionalProperties: false,
  } satisfies JSONSchema7);
}

/**
 * Configuration values the OpenAI client builder needs from the provider.
 * These are passed explicitly because the source properties are protected.
 */
export interface ProviderClientConfig {
  baseURL: string | undefined;
  providerName: string;
  requiresAuth: boolean | undefined;
  customHeaders: Record<string, string> | undefined;
}

/**
 * Creates an OpenAI client instance with resolved auth, baseURL, and
 * compatibility fetch wrappers.
 */
export async function createOpenAIClient(
  options: NormalizedGenerateChatOptions,
  clientConfig: ProviderClientConfig,
  customFetch?: typeof fetch,
  logger: Pick<DebugLogger, 'debug'> = new DebugLogger(
    'llxprt:provider:openaivercel',
  ),
): Promise<ReturnType<typeof createOpenAI>> {
  const baseURL = options.resolved.baseURL ?? clientConfig.baseURL;
  const shouldForceSystemRole = isQwenBaseURL(baseURL);
  const authExempt =
    clientConfig.requiresAuth === false || isLocalEndpoint(baseURL);
  let authToken = '';
  try {
    authToken =
      (await resolveRuntimeAuthToken(options.resolved.authToken)) ?? '';
  } catch (cause) {
    const failure = createCredentialResolutionError(
      options,
      clientConfig.providerName,
      { kind: 'credential-source-failed', cause },
    );
    if (!authExempt) {
      throw failure;
    }
    logger.debug(
      () =>
        `Continuing without credentials for auth-exempt endpoint after authentication resolution failed: ${failure.message}`,
    );
  }
  if (!authToken && !authExempt) {
    throw createCredentialResolutionError(options, clientConfig.providerName);
  }

  const headers = clientConfig.customHeaders;
  const fetchWithCompatibility = shouldForceSystemRole
    ? createDeveloperRoleToSystemFetch(customFetch ?? fetch)
    : customFetch;

  // The @ai-sdk/openai factory validates `apiKey` via `loadApiKey`, which throws
  // `LoadAPIKeyError` for `undefined` before any request is made. The guard above
  // already throws when auth is required but no token is available, so at this
  // point either a real token is present or the endpoint is auth-exempt (local /
  // requiresAuth === false). `authToken` is coalesced to a string above, so
  // passing it directly mirrors the classic openai provider's `authToken || ''`
  // behavior and prevents `loadApiKey` from throwing for local servers like
  // Ollama. See issue #2506.
  return createOpenAI({
    apiKey: authToken,
    baseURL: baseURL !== '' ? baseURL : undefined,
    headers: headers && Object.keys(headers).length > 0 ? headers : undefined,
    fetch: fetchWithCompatibility,
  });
}

/**
 * Creates a configured AI SDK LanguageModel with optional reasoning capture
 * fetch and extractReasoningMiddleware for non-streaming.
 */
export async function createConfiguredModel(
  options: NormalizedGenerateChatOptions,
  clientConfig: ProviderClientConfig,
  defaultModel: string,
  rsEnabled: boolean,
  streamingEnabled: boolean,
  captureBuffer: CaptureBuffer,
  logger: DebugLogger,
): Promise<{ model: LanguageModel }> {
  const customFetch =
    streamingEnabled && rsEnabled
      ? createReasoningCaptureFetch(captureBuffer, logger)
      : undefined;
  const openaiProvider = await createOpenAIClient(
    options,
    clientConfig,
    customFetch,
    logger,
  );
  const modelId = options.resolved.model || defaultModel;
  const baseModel: LanguageModel =
    typeof openaiProvider.chat === 'function'
      ? openaiProvider.chat(modelId)
      : openaiProvider(modelId);

  const useMiddlewareForNonStreaming = rsEnabled && !streamingEnabled;
  const model = useMiddlewareForNonStreaming
    ? wrapLanguageModel({
        model: baseModel,
        middleware: extractReasoningMiddleware({
          tagName: 'think',
          separator: '\n',
        }),
      })
    : baseModel;
  return { model };
}
