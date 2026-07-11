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

/**
 * Package-internal stateless executor for the OpenAI Responses API.
 *
 * This is the single implementation of Responses request-building and
 * streaming. Both `OpenAIResponsesProvider` (the standalone provider) and
 * `OpenAIProvider` (Chat-Completions provider that routes GPT-5.6+ to
 * Responses) call this function so neither duplicates the other's logic
 * (issue #2483).
 *
 * The executor consumes the already-normalized `NormalizedGenerateChatOptions`
 * — it does NOT re-normalize — and an explicit `ResponsesExecutorDeps`
 * interface that carries provider-specific capabilities (auth resolution,
 * custom headers, Codex account ID) as pure functions.
 */

import { SyntheticToolResponseHandler } from '../openai/syntheticToolResponses.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ToolOutputSettingsProvider } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import {
  parseResponsesStream,
  parseErrorResponse,
  type ParseResponsesStreamOptions,
} from '../openai/parseResponsesStream.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { convertToolsToOpenAIResponses } from './schemaConverter.js';
import { getCoreSystemPromptAsync } from '@vybestack/llxprt-code-core/core/prompts.js';
import { shouldIncludeSubagentDelegation } from '@vybestack/llxprt-code-core/prompt-config/subagent-delegation.js';
import { resolveUserMemory } from '../utils/userMemory.js';
import { mergeSystemInstruction } from '../utils/systemInstructionMerge.js';
import { resolveRuntimeAuthToken } from '../utils/authToken.js';
import { isNetworkTransientError } from '@vybestack/llxprt-code-core/utils/retry.js';
import { delay } from '@vybestack/llxprt-code-core/utils/delay.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  toOpenAIResponsesWireEffort,
  OPENAI_TRANSPORT_SELECTOR_KEYS,
} from '../openai/openaiModelPolicy.js';
import { buildOpenAIResponsesInput } from './OpenAIResponsesInputBuilder.js';
import { sanitizePromptCacheKey } from './sanitizePromptCacheKey.js';
import type {
  OpenAIResponsesRequest,
  ResponsesInputItem,
} from './OpenAIResponsesTypes.js';

/**
 * Provider-specific capabilities that the executor needs to do its work.
 * Passed explicitly so neither provider reads the other's namespace or
 * ambient runtime state.
 */
export interface ResponsesExecutorDeps {
  readonly providerName: string;
  readonly logger: DebugLogger;
  /** Return the configured base URL for the provider instance. */
  readonly getProviderBaseURL: () => string | undefined;
  /** Return provider-config custom headers. */
  readonly getCustomHeaders: (
    options?: NormalizedGenerateChatOptions,
  ) => Record<string, string> | undefined;
  /** True when the base URL points at the Codex (ChatGPT) backend. */
  readonly isCodexBaseURL: (baseURL: string | undefined) => boolean;
  /** Resolve the Codex account ID for OAuth headers (Codex mode only). */
  readonly getCodexAccountId: () => Promise<string>;
  /**
   * Resolve the auth token used for the API call (may trigger OAuth for
   * Codex). This is the single auth contract for the executor.
   */
  readonly resolveAuthTokenForPrompt: () => Promise<string>;
  /** Provide a fresh synthetic call ID generator for tool-call injection. */
  readonly generateSyntheticCallId: () => string;
  /** Determine whether a streaming error is retryable (status-based). */
  readonly shouldRetryOnError: (error: Error | unknown) => boolean;
  /** Return the provider's default model ID for fallback when resolved model is empty. */
  readonly getDefaultModel: () => string;
  /** Return the provider instance's global config for tool-output-limiter fallback. */
  readonly getGlobalConfig: () => ToolOutputSettingsProvider | undefined;
}

interface RequestContext {
  apiKey: string;
  baseURL: string;
  isCodex: boolean;
  includeThinkingInResponse: boolean;
  request: OpenAIResponsesRequest;
}

interface ReasoningOptions {
  enabled: boolean;
  effort?: string;
  summary?: string;
  includeThinkingInResponse: boolean;
}

export async function* executeOpenAIResponsesRequest(
  options: NormalizedGenerateChatOptions,
  deps: ResponsesExecutorDeps,
): AsyncIterableIterator<IContent> {
  const metadata = (options as { metadata?: Record<string, unknown> }).metadata;
  const abortSignal = metadata?.['abortSignal'] as AbortSignal | undefined;
  const patchedContent = SyntheticToolResponseHandler.patchMessageHistory(
    options.contents,
  );
  const invocation = options.invocation as {
    ephemerals?: Record<string, unknown>;
  };
  const invocationEphemerals = invocation.ephemerals ?? {};
  const requestContext = await buildRequestContext(
    options,
    patchedContent,
    invocationEphemerals,
    deps,
  );

  yield* streamResponses(
    {
      ...requestContext,
      abortSignal,
      maxStreamingAttempts:
        (invocationEphemerals['retries'] as number | undefined) ?? 6,
      streamRetryInitialDelayMs:
        (invocationEphemerals['retrywait'] as number | undefined) ?? 4000,
      normalizedOptions: options,
    },
    deps,
  );
}

async function buildRequestContext(
  options: NormalizedGenerateChatOptions,
  patchedContent: IContent[],
  invocationEphemerals: Record<string, unknown>,
  deps: ResponsesExecutorDeps,
): Promise<RequestContext> {
  const rawBaseURL =
    options.resolved.baseURL ??
    deps.getProviderBaseURL() ??
    'https://api.openai.com/v1';
  const apiKey = await resolveApiKey(options, rawBaseURL, deps);
  const baseURL = normalizeBaseURL(rawBaseURL);
  const isCodex = deps.isCodexBaseURL(rawBaseURL);
  const userMemory = await resolveUserMemory(
    options.userMemory,
    () => options.invocation.userMemory,
  );
  const systemPrompt = await buildSystemPrompt(options, userMemory, deps);
  const input = buildInput(options, patchedContent, invocationEphemerals, deps);
  const requestOverrides = buildRequestOverrides(options, deps);
  const requestInput = buildRequestInput(
    input,
    isCodex,
    options,
    userMemory,
    deps,
  );
  const request = createRequest(options, requestInput, requestOverrides, deps);
  applyInstructionsAndTools(request, systemPrompt, options);
  const reasoning = applyReasoningSettings(
    request,
    options,
    invocationEphemerals,
    deps,
  );
  applyTextVerbosity(request, options, invocationEphemerals, deps);
  applyCodexRequestSettings(request, isCodex, deps);
  applyPromptCaching(request, options, invocationEphemerals, isCodex, deps);
  return {
    apiKey,
    baseURL,
    isCodex,
    request,
    includeThinkingInResponse: reasoning.includeThinkingInResponse,
  };
}

async function resolveApiKey(
  options: NormalizedGenerateChatOptions,
  effectiveBaseURL: string,
  deps: ResponsesExecutorDeps,
): Promise<string> {
  const promptAuthToken = await deps.resolveAuthTokenForPrompt();
  // Strict guard on the value that becomes the Authorization header:
  // only forward a genuine non-empty string. Provider implementations
  // can resolve to '' from deeper auth paths, and a defensive runtime
  // typeof check ensures a non-string (undefined/null from a loosely
  // typed implementation) is never injected into the header.
  if (typeof promptAuthToken === 'string' && promptAuthToken !== '') {
    return promptAuthToken;
  }
  const runtimeToken = await resolveRuntimeAuthToken(
    options.resolved.authToken,
  );
  if (typeof runtimeToken === 'string' && runtimeToken !== '') {
    return runtimeToken;
  }

  const isCodex = deps.isCodexBaseURL(effectiveBaseURL);
  throw new Error(
    isCodex
      ? 'Codex authentication required. Run /auth codex enable to authenticate.'
      : 'OpenAI API key is required',
  );
}

async function buildSystemPrompt(
  options: NormalizedGenerateChatOptions,
  userMemory: string | undefined,
  deps: ResponsesExecutorDeps,
): Promise<string> {
  const toolNames = getToolNamesForPrompt(options);
  const configWithManagers = options.config as
    | {
        getMcpClientManager?: () =>
          | { getMcpInstructions?: () => string | undefined }
          | undefined;
        getSubagentManager?: () => ReturnType<
          NonNullable<typeof options.config>['getSubagentManager']
        >;
      }
    | undefined;
  const mcpClientManager = configWithManagers?.getMcpClientManager?.();
  const mcpInstructions = mcpClientManager?.getMcpInstructions?.();
  const includeSubagentDelegation = await shouldIncludeSubagentDelegation(
    toolNames ?? [],
    () => configWithManagers?.getSubagentManager?.(),
  );
  const corePrompt = await getCoreSystemPromptAsync({
    userMemory,
    mcpInstructions,
    model:
      options.resolved.model !== ''
        ? options.resolved.model
        : deps.getDefaultModel(),
    tools: toolNames,
    includeSubagentDelegation,
    interactionMode:
      options.config?.isInteractive() === true
        ? 'interactive'
        : 'non-interactive',
  });
  return mergeSystemInstruction(corePrompt, options.systemInstruction);
}

function getToolNamesForPrompt(
  options: NormalizedGenerateChatOptions,
): string[] | undefined {
  if (options.tools === undefined) return undefined;

  return Array.from(
    new Set(
      options.tools.flatMap((group) =>
        group.functionDeclarations
          .map((declaration) => declaration.name)
          .filter((name): name is string => Boolean(name)),
      ),
    ),
  );
}

function buildInput(
  options: NormalizedGenerateChatOptions,
  patchedContent: IContent[],
  invocationEphemerals: Record<string, unknown>,
  deps: ResponsesExecutorDeps,
): ResponsesInputItem[] {
  const includeReasoningInContextSetting =
    (invocationEphemerals['reasoning.includeInContext'] as
      | boolean
      | undefined) ??
    options.invocation.getModelBehavior<boolean>(
      'reasoning.includeInContext',
    ) ??
    (options as { settings?: { get: (key: string) => unknown } }).settings?.get(
      'reasoning.includeInContext',
    );
  const outputLimiterConfig =
    options.config ??
    options.runtime?.config ??
    deps.getGlobalConfig() ??
    ({
      getEphemeralSettings: () => ({}),
    } satisfies ToolOutputSettingsProvider);
  return buildOpenAIResponsesInput(patchedContent, {
    includeReasoningInContext: includeReasoningInContextSetting !== false,
    outputLimiterConfig,
    debug: (messageFactory) => deps.logger.debug(messageFactory),
  });
}

function buildRequestOverrides(
  options: NormalizedGenerateChatOptions,
  deps: ResponsesExecutorDeps,
): Record<string, unknown> {
  const mergedParams: Record<string, unknown> = {
    ...options.invocation.modelParams,
  };
  const genericMaxOutput = getGenericMaxOutput(options);
  if (
    genericMaxOutput !== undefined &&
    mergedParams['max_tokens'] === undefined &&
    mergedParams['max_completion_tokens'] === undefined &&
    mergedParams['max_output_tokens'] === undefined
  ) {
    mergedParams['max_output_tokens'] = genericMaxOutput;
  }

  const requestOverrides = translateRequestOverrides(mergedParams, deps);
  deps.logger.debug(
    () => `Request overrides: ${JSON.stringify(Object.keys(requestOverrides))}`,
  );
  return requestOverrides;
}

function getGenericMaxOutput(
  options: NormalizedGenerateChatOptions,
): number | undefined {
  const rawMaxOutput = (
    options as { settings?: { get: (key: string) => unknown } }
  ).settings?.get('maxOutputTokens');
  return typeof rawMaxOutput === 'number' &&
    Number.isFinite(rawMaxOutput) &&
    rawMaxOutput > 0
    ? rawMaxOutput
    : undefined;
}

function translateRequestOverrides(
  mergedParams: Record<string, unknown>,
  deps: ResponsesExecutorDeps,
): Record<string, unknown> {
  const requestOverrides: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(mergedParams)) {
    if (OPENAI_TRANSPORT_SELECTOR_KEYS.has(key)) {
      deps.logger.debug(
        () => `Dropping transport-selector key "${key}" from request body`,
      );
      continue;
    }
    if (key === 'max_tokens' || key === 'max_completion_tokens') {
      requestOverrides['max_output_tokens'] = value;
      deps.logger.debug(
        () =>
          `Translated ${key}=${value} to max_output_tokens for Responses API`,
      );
    } else if (key === 'reasoning') {
      deps.logger.debug(
        () =>
          `Skipping reasoning object in modelParams - handled via model-behavior settings`,
      );
    } else if (key === 'prompt_cache_key') {
      const sanitized =
        typeof value === 'string' ? sanitizePromptCacheKey(value) : '';
      if (sanitized !== '') {
        requestOverrides[key] = sanitized;
      } else {
        deps.logger.debug(
          () =>
            `Dropping invalid prompt_cache_key from modelParams (type=${typeof value})`,
        );
      }
    } else {
      requestOverrides[key] = value;
    }
  }
  return requestOverrides;
}

function normalizeBaseURL(baseURLCandidate: string): string {
  let baseURL = baseURLCandidate;
  while (baseURL.endsWith('/')) baseURL = baseURL.slice(0, -1);
  return baseURL;
}

function buildRequestInput(
  input: ResponsesInputItem[],
  isCodex: boolean,
  options: NormalizedGenerateChatOptions,
  userMemory: string | undefined,
  deps: ResponsesExecutorDeps,
): ResponsesInputItem[] {
  if (!isCodex) return input;

  const requestInput = input.filter(
    (message) => !('role' in message) || (message.role as string) !== 'system',
  );
  const itemsForInjection = requestInput.filter(
    (item) => !('type' in item && item.type === 'reasoning'),
  );
  injectSyntheticConfigFileRead(itemsForInjection, options, userMemory, deps);
  const injectedItems = itemsForInjection.filter(
    (item) => !requestInput.includes(item),
  );
  const reasoningItems = requestInput.filter(
    (item) => 'type' in item && item.type === 'reasoning',
  );
  const nonReasoningItems = requestInput.filter(
    (item) => !('type' in item && item.type === 'reasoning'),
  );
  return [...injectedItems, ...reasoningItems, ...nonReasoningItems];
}

function createRequest(
  options: NormalizedGenerateChatOptions,
  input: ResponsesInputItem[],
  requestOverrides: Record<string, unknown>,
  deps: ResponsesExecutorDeps,
): OpenAIResponsesRequest {
  return {
    model: options.resolved.model || deps.getDefaultModel(),
    input,
    stream: true,
    ...requestOverrides,
  };
}

function applyInstructionsAndTools(
  request: OpenAIResponsesRequest,
  systemPrompt: string,
  options: NormalizedGenerateChatOptions,
): void {
  if (systemPrompt) request.instructions = systemPrompt;

  const responsesTools = convertToolsToOpenAIResponses(options.tools);
  if (responsesTools === undefined || responsesTools.length === 0) return;

  request.tools = responsesTools;
  if (
    request.tool_choice === undefined ||
    request.tool_choice === null ||
    request.tool_choice === ''
  ) {
    request.tool_choice = 'auto';
  }
  request.parallel_tool_calls = true;
}

function applyReasoningSettings(
  request: OpenAIResponsesRequest,
  options: NormalizedGenerateChatOptions,
  invocationEphemerals: Record<string, unknown>,
  deps: ResponsesExecutorDeps,
): ReasoningOptions {
  const reasoning = getReasoningOptions(options, invocationEphemerals);
  const shouldRequestReasoning =
    reasoning.enabled || reasoning.effort !== undefined;
  deps.logger.debug(
    () =>
      `Reasoning check: enabled=${reasoning.enabled}, effort=${String(reasoning.effort)}, summary=${String(reasoning.summary)}, shouldRequest=${shouldRequestReasoning}, includeInResponse=${reasoning.includeThinkingInResponse}`,
  );
  if (shouldRequestReasoning) {
    request.include = ['reasoning.encrypted_content'];
    deps.logger.debug(
      () => `Added include parameter: ${JSON.stringify(request.include)}`,
    );
    applyReasoningEffort(request, reasoning.effort, deps);
  }
  applyReasoningSummary(request, reasoning.summary, deps);
  deps.logger.debug(
    () => `Full request reasoning config: ${JSON.stringify(request.reasoning)}`,
  );
  return reasoning;
}

function getReasoningOptions(
  options: NormalizedGenerateChatOptions,
  ephemerals: Record<string, unknown>,
): ReasoningOptions {
  const settings = (options as { settings?: { get: (key: string) => unknown } })
    .settings;
  const enabled =
    ((ephemerals['reasoning.enabled'] as boolean | undefined) ??
      options.invocation.getModelBehavior<boolean>('reasoning.enabled') ??
      settings?.get('reasoning.enabled')) === true;
  const effort =
    (ephemerals['reasoning.effort'] as string | undefined) ??
    options.invocation.getModelBehavior<string>('reasoning.effort') ??
    (settings?.get('reasoning.effort') as string | undefined);
  const summary =
    (ephemerals['reasoning.summary'] as string | undefined) ??
    options.invocation.getModelBehavior<string>('reasoning.summary') ??
    (settings?.get('reasoning.summary') as string | undefined);
  const includeSetting =
    (ephemerals['reasoning.includeInResponse'] as boolean | undefined) ??
    options.invocation.getModelBehavior<boolean>(
      'reasoning.includeInResponse',
    ) ??
    settings?.get('reasoning.includeInResponse');
  return {
    enabled,
    effort,
    summary,
    includeThinkingInResponse: includeSetting !== false,
  };
}

function applyReasoningEffort(
  request: OpenAIResponsesRequest,
  reasoningEffort: string | undefined,
  deps: ResponsesExecutorDeps,
): void {
  if (typeof reasoningEffort !== 'string' || reasoningEffort === '') return;
  const wireEffort = toOpenAIResponsesWireEffort(
    reasoningEffort,
    request.model,
  );
  request.reasoning ??= {};
  request.reasoning.effort = wireEffort;
  deps.logger.debug(
    () =>
      `Added reasoning.effort to request: ${reasoningEffort}` +
      (wireEffort !== reasoningEffort
        ? ` (mapped to ${wireEffort} for model ${request.model})`
        : ''),
  );
}

function applyReasoningSummary(
  request: OpenAIResponsesRequest,
  reasoningSummary: string | undefined,
  deps: ResponsesExecutorDeps,
): void {
  if (
    typeof reasoningSummary !== 'string' ||
    reasoningSummary === '' ||
    reasoningSummary === 'none'
  ) {
    return;
  }
  request.reasoning ??= {};
  request.reasoning.summary = reasoningSummary;
  deps.logger.debug(
    () => `Added reasoning.summary to request: ${reasoningSummary}`,
  );
}

function applyTextVerbosity(
  request: OpenAIResponsesRequest,
  options: NormalizedGenerateChatOptions,
  ephemerals: Record<string, unknown>,
  deps: ResponsesExecutorDeps,
): void {
  const textVerbosity =
    (ephemerals['text.verbosity'] as string | undefined) ??
    (options as { settings?: { get: (key: string) => unknown } }).settings?.get(
      'text.verbosity',
    );
  if (
    typeof textVerbosity !== 'string' ||
    textVerbosity === '' ||
    !['low', 'medium', 'high'].includes(textVerbosity.toLowerCase())
  ) {
    return;
  }
  request.text = { verbosity: textVerbosity.toLowerCase() };
  deps.logger.debug(() => `Added text.verbosity to request: ${textVerbosity}`);
}

function applyCodexRequestSettings(
  request: OpenAIResponsesRequest,
  isCodex: boolean,
  deps: ResponsesExecutorDeps,
): void {
  if (!isCodex) return;

  request.store = false;
  if ('max_output_tokens' in request) {
    delete request.max_output_tokens;
    deps.logger.debug(
      () => 'Codex mode: removed unsupported max_output_tokens from request',
    );
  }
}

function applyPromptCaching(
  request: OpenAIResponsesRequest,
  options: NormalizedGenerateChatOptions,
  ephemerals: Record<string, unknown>,
  isCodex: boolean,
  deps: ResponsesExecutorDeps,
): void {
  const promptCachingSetting =
    (ephemerals['prompt-caching'] as string | undefined) ??
    ((
      options as {
        settings?: {
          getProviderSettings: (name: string) => Record<string, unknown>;
        };
      }
    ).settings?.getProviderSettings(deps.providerName)['prompt-caching'] as
      | string
      | undefined) ??
    '1h';
  if (promptCachingSetting === 'off') return;

  if (
    typeof request.prompt_cache_key === 'string' &&
    request.prompt_cache_key.trim() !== ''
  ) {
    if (!isCodex) request.prompt_cache_retention = '24h';
    return;
  }

  const cacheKey =
    (options.invocation as { runtimeId?: string } | undefined)?.runtimeId ??
    options.runtime?.runtimeId;
  if (typeof cacheKey !== 'string' || cacheKey.trim() === '') return;

  request.prompt_cache_key = sanitizePromptCacheKey(cacheKey);
  if (!isCodex) request.prompt_cache_retention = '24h';
}

async function buildHeaders(
  apiKey: string,
  contentType: string,
  isCodex: boolean,
  options: NormalizedGenerateChatOptions,
  deps: ResponsesExecutorDeps,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': contentType,
    ...(deps.getCustomHeaders(options) ?? {}),
  };
  if (isCodex) await addCodexHeaders(headers, options, deps);
  return headers;
}

async function addCodexHeaders(
  headers: Record<string, string>,
  options: NormalizedGenerateChatOptions,
  deps: ResponsesExecutorDeps,
): Promise<void> {
  const accountId = await deps.getCodexAccountId();
  headers['ChatGPT-Account-ID'] = accountId;
  headers['originator'] = 'codex_cli_rs';

  const sessionId =
    (options.invocation as { runtimeId?: string } | undefined)?.runtimeId ??
    options.runtime?.runtimeId;
  if (typeof sessionId === 'string' && sessionId.trim()) {
    headers['session_id'] = sessionId;
  }

  const sessionIdForLog = sessionId?.substring(0, 8) ?? 'none';
  deps.logger.debug(
    () =>
      `Codex mode: adding headers for account ${accountId.substring(0, 8)}..., session_id=${sessionIdForLog}...`,
  );
}

interface StreamResponsesParams {
  apiKey: string;
  baseURL: string;
  isCodex: boolean;
  request: OpenAIResponsesRequest;
  includeThinkingInResponse: boolean;
  abortSignal?: AbortSignal;
  maxStreamingAttempts: number;
  streamRetryInitialDelayMs: number;
  normalizedOptions: NormalizedGenerateChatOptions;
}

async function* streamResponses(
  params: StreamResponsesParams,
  deps: ResponsesExecutorDeps,
): AsyncIterableIterator<IContent> {
  const contentType = params.isCodex
    ? 'application/json'
    : 'application/json; charset=utf-8';
  const bodyBlob = new Blob([JSON.stringify(params.request)], {
    type: contentType,
  });
  const headers = await buildHeaders(
    params.apiKey,
    contentType,
    params.isCodex,
    params.normalizedOptions,
    deps,
  );
  deps.logger.debug(
    () => `Request body keys: ${JSON.stringify(Object.keys(params.request))}`,
  );
  yield* fetchStreamWithRetries(
    {
      ...params,
      responsesURL: `${params.baseURL}/responses`,
      headers,
      bodyBlob,
    },
    deps,
  );
}

interface FetchStreamParams {
  responsesURL: string;
  headers: Record<string, string>;
  bodyBlob: Blob;
  abortSignal?: AbortSignal;
  includeThinkingInResponse: boolean;
  maxStreamingAttempts: number;
  streamRetryInitialDelayMs: number;
}

async function* fetchStreamWithRetries(
  params: FetchStreamParams,
  deps: ResponsesExecutorDeps,
): AsyncIterableIterator<IContent> {
  let streamingAttempt = 0;
  let currentDelay = params.streamRetryInitialDelayMs;

  while (streamingAttempt < params.maxStreamingAttempts) {
    streamingAttempt += 1;
    try {
      const response = await fetchResponse(params);
      yield* parseSuccessfulResponse(response, params, deps);
      return;
    } catch (error) {
      currentDelay = await handleStreamRetry(
        error,
        {
          streamingAttempt,
          maxStreamingAttempts: params.maxStreamingAttempts,
          currentDelay,
        },
        deps,
      );
    }
  }
}

async function fetchResponse(params: {
  responsesURL: string;
  headers: Record<string, string>;
  bodyBlob: Blob;
  abortSignal?: AbortSignal;
}): Promise<Response> {
  return fetch(params.responsesURL, {
    method: 'POST',
    headers: params.headers,
    body: params.bodyBlob,
    signal: params.abortSignal,
  });
}

async function* parseSuccessfulResponse(
  response: Response,
  params: {
    responsesURL: string;
    headers: Record<string, string>;
    bodyBlob: Blob;
    abortSignal?: AbortSignal;
    includeThinkingInResponse: boolean;
  },
  deps: ResponsesExecutorDeps,
): AsyncIterableIterator<IContent> {
  if (!response.ok) await throwApiError(response, deps);
  if (!response.body) {
    deps.logger.debug(() => 'Response body missing, returning early');
    return;
  }

  const streamOptions: ParseResponsesStreamOptions = {
    includeThinkingInResponse: params.includeThinkingInResponse,
  };
  for await (const message of parseResponsesStream(
    response.body,
    streamOptions,
  )) {
    yield message;
  }
}

async function throwApiError(
  response: Response,
  deps: ResponsesExecutorDeps,
): Promise<never> {
  const errorBody = await response.text();
  deps.logger.debug(
    () => `API error ${response.status}: ${errorBody.substring(0, 500)}`,
  );
  throw parseErrorResponse(response.status, errorBody, deps.providerName);
}

async function handleStreamRetry(
  error: unknown,
  state: {
    streamingAttempt: number;
    maxStreamingAttempts: number;
    currentDelay: number;
  },
  deps: ResponsesExecutorDeps,
): Promise<number> {
  if (error instanceof Error && error.name === 'AbortError') {
    throw error;
  }
  const canRetryStream =
    deps.shouldRetryOnError(error) || isNetworkTransientError(error);
  if (!canRetryStream || state.streamingAttempt >= state.maxStreamingAttempts) {
    deps.logger.debug(
      () =>
        `Stream attempt ${state.streamingAttempt}/${state.maxStreamingAttempts} failed (retryable=${canRetryStream}), throwing: ${String(error)}`,
    );
    throw error;
  }

  deps.logger.debug(
    () =>
      `Stream retry attempt ${state.streamingAttempt}/${state.maxStreamingAttempts}: Transient error detected, delay ${state.currentDelay}ms before retry. Error: ${String(error)}`,
  );
  const jitter = state.currentDelay * 0.3 * (Math.random() * 2 - 1);
  await delay(Math.max(0, state.currentDelay + jitter));
  return Math.min(30000, state.currentDelay * 2);
}

function injectSyntheticConfigFileRead(
  requestInput: ResponsesInputItem[],
  options: NormalizedGenerateChatOptions,
  userMemory: string | undefined,
  deps: ResponsesExecutorDeps,
): void {
  const syntheticCallId = deps.generateSyntheticCallId();

  let output: string;
  const targetFile = 'AGENTS.md';

  if (userMemory && userMemory.trim().length > 0) {
    output = JSON.stringify({
      content: userMemory,
    });
  } else {
    output = JSON.stringify({
      error: 'File not found: AGENTS.md',
    });
  }

  requestInput.unshift(
    {
      type: 'function_call',
      call_id: syntheticCallId,
      name: 'read_file',
      arguments: JSON.stringify({ absolute_path: targetFile }),
    },
    {
      type: 'function_call_output',
      call_id: syntheticCallId,
      output,
    },
  );
}
