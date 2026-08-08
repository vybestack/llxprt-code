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
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { convertToolsToOpenAIResponses } from './schemaConverter.js';
import { getCoreSystemPromptAsync } from '@vybestack/llxprt-code-core/core/prompts.js';
import { shouldIncludeSubagentDelegation } from '@vybestack/llxprt-code-core/prompt-config/subagent-delegation.js';
import { resolveUserMemory } from '../utils/userMemory.js';
import { mergeSystemInstruction } from '../utils/systemInstructionMerge.js';
import { resolveRuntimeAuthToken } from '../utils/authToken.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import { getErrorStatus } from '@vybestack/llxprt-code-core/utils/retry.js';
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
import {
  applyStatefulConversation,
  computeStatefulConversation,
} from './openAIResponsesStateful.js';
import {
  CODEX_WEBSOCKET_BETA_HEADER,
  streamOverWebSocketOrFallback,
  type StreamResponseOptions,
  type WebSocketTransport,
} from './openAIResponsesWebSocketTransport.js';
import {
  streamOverHttp,
  type StreamResponsesParams,
} from './openAIResponsesHttpStream.js';
import {
  shouldDumpSDKContext,
  dumpSDKRequestContext,
} from '../utils/dumpSDKContext.js';
import type { DumpMode } from '../utils/dumpContext.js';

/**
 * Provider-specific capabilities that the executor needs to do its work.
 * Passed explicitly so neither provider reads the other's namespace or
 * ambient runtime state.
 */
export interface ResponsesExecutorDeps {
  readonly providerName: string;
  readonly logger: DebugLogger;
  /**
   * Return the effective base URL for THIS call.
   *
   * The per-call options are passed explicitly because projection runs outside
   * the provider's active-call context; resolving from ambient state there
   * would prepare an envelope for a different endpoint than transport uses
   * (issue #2817).
   */
  readonly getProviderBaseURL: (
    options?: NormalizedGenerateChatOptions,
  ) => string | undefined;
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
  /** Determine whether a streaming error is retryable (status-based). */
  readonly shouldRetryOnError: (error: Error | unknown) => boolean;
  /** Return the provider's default model ID for fallback when resolved model is empty. */
  readonly getDefaultModel: () => string;
  /** Return the provider instance's global config for tool-output-limiter fallback. */
  readonly getGlobalConfig: () => ToolOutputSettingsProvider | undefined;
  /**
   * Returns the package-internal Codex WebSocket transport when the provider
   * should use WebSockets for this request (Codex mode and not sticky-fallen
   * back to HTTP). Returns undefined for non-Codex providers or after a
   * sticky HTTP fallback (issue #2041).
   */
  readonly getWebSocketTransport?: () => WebSocketTransport | undefined;
  /**
   * Called once when a Codex WebSocket attempt fails before any response
   * events are exposed, so the provider marks HTTP as the sticky transport
   * for subsequent requests (issue #2041 A5).
   */
  readonly onWebSocketFallback?: () => void;
  /**
   * Called once when a Codex WebSocket attempt completes successfully, so the
   * provider can reset its consecutive-failure counter. Mirrors the Codex
   * client treating a healthy stream as proof that a single transient blip
   * must not permanently demote the session to HTTP (issue #3034).
   */
  readonly onWebSocketSuccess?: () => void;
  /**
   * Returns true when the session has permanently suppressed Responses
   * statefulness because a previous_response_id was rejected by the API.
   * Once set, computeStatefulConversation stops selecting a parent so
   * every subsequent turn sends full history (#3134 Fix 1).
   */
  readonly isResponsesStatefulFailed?: () => boolean;
  /**
   * Marks the session as having permanently suppressed Responses
   * statefulness. Called exactly once, when a previous-response-not-found
   * error is detected before any content has been yielded (#3134 Fix 1).
   */
  readonly markResponsesStatefulFailed?: () => void;
}

export interface PreparedResponsesRequestContext {
  readonly rawBaseURL: string;
  readonly isCodex: boolean;
  readonly includeThinkingInResponse: boolean;
  readonly responsesStored: boolean;
  readonly request: OpenAIResponsesRequest;
}

interface RequestContext extends PreparedResponsesRequestContext {
  readonly apiKey: string;
  readonly baseURL: string;
}

interface ReasoningOptions {
  enabled: boolean;
  effort?: string;
  summary?: string;
  includeThinkingInResponse: boolean;
}

function resolveInvocationEphemerals(
  options: NormalizedGenerateChatOptions,
): Record<string, unknown> {
  const invocation = options.invocation as {
    ephemerals?: Record<string, unknown>;
  };
  return invocation.ephemerals ?? {};
}

/**
 * Build the finalized Responses request context exactly the way transport
 * does — including the synthetic tool-response patching that precedes it.
 *
 * Shared by transport and by prompt-envelope projection (issue #2817) so the
 * estimate can never drift from what is actually sent.
 */
export async function buildResponsesRequestContextForProjection(
  options: NormalizedGenerateChatOptions,
  deps: ResponsesExecutorDeps,
  invocationEphemerals = resolveInvocationEphemerals(options),
): Promise<PreparedResponsesRequestContext> {
  const patchedContent = SyntheticToolResponseHandler.patchMessageHistory(
    options.contents,
  );
  return buildRequestContext(
    options,
    patchedContent,
    invocationEphemerals,
    deps,
  );
}

/**
 * Detect an API rejection caused by an unresolvable `previous_response_id`.
 *
 * The OpenAI Responses API returns HTTP 400 (or 404) with a body that mentions
 * `previous_response_id` or the phrase `Previous response with id` when the
 * stored parent cannot be found. This is the one sanctioned recovery trigger:
 * a genuinely external, unpredictable API response (#3134 Fix 1).
 */
function isPreviousResponseNotFoundError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status !== 400 && status !== 404) return false;
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();
  return (
    message.includes('previous_response_id') ||
    message.includes('previous response with id')
  );
}

export async function* executeOpenAIResponsesRequest(
  options: NormalizedGenerateChatOptions,
  deps: ResponsesExecutorDeps,
  preparedRequestContext?: PreparedResponsesRequestContext,
): AsyncIterableIterator<IContent> {
  const abortSignal = getRequestSignal(options);
  const invocationEphemerals = resolveInvocationEphemerals(options);
  const prepared =
    preparedRequestContext ??
    (await buildResponsesRequestContextForProjection(
      options,
      deps,
      invocationEphemerals,
    ));
  const requestContext = await resolveResponsesTransportContext(
    options,
    prepared,
    deps,
  );

  await dumpFinalizedRequest(requestContext, invocationEphemerals, deps);

  const streamParams = buildStreamParams(
    requestContext,
    abortSignal,
    invocationEphemerals,
    options,
  );

  // #3134 Fix 1: one-shot recovery when previous_response_id is rejected.
  // The safe replay boundary is "no IContent has been yielded to the consumer"
  // — if even one chunk escaped we cannot retry without duplicating output.
  let contentYielded = false;
  try {
    for await (const content of streamResponses(streamParams, deps)) {
      contentYielded = true;
      yield content;
    }
    return;
  } catch (error) {
    // Guard on the request the transport actually sent, not on `prepared`,
    // so a future divergence between the two cannot skip recovery.
    if (
      contentYielded ||
      requestContext.request.previous_response_id === undefined ||
      !isPreviousResponseNotFoundError(error)
    ) {
      throw error;
    }
    deps.logger.debug(
      () =>
        `responses-stateful: previous_response_id was rejected by the API; retrying once with full history. Error: ${String(error)}`,
    );
  }

  // Mark the session so all future turns suppress statefulness, then rebuild
  // the request context. computeStatefulConversation will now return full
  // history with no parent because deps.isResponsesStatefulFailed() is true.
  //
  // This is deliberately session-wide rather than per-parent. The trigger is a
  // narrow signature (400/404 naming previous_response_id), which means the
  // backend did not resolve a parent we believed was stored — evidence about
  // the endpoint, not just about this one id. Suppressing for the session
  // trades the delta optimization for guaranteed correctness, which is the
  // right side to err on while backend `store: true` support is unconfirmed.
  // `clearState()` resets it.
  deps.markResponsesStatefulFailed?.();
  const recoveryPrepared = await buildResponsesRequestContextForProjection(
    options,
    deps,
    invocationEphemerals,
  );
  const recoveryContext = await resolveResponsesTransportContext(
    options,
    recoveryPrepared,
    deps,
  );
  // The recovery request is the one that actually reaches the model, so it is
  // the one worth seeing under `dumpcontext`.
  await dumpFinalizedRequest(recoveryContext, invocationEphemerals, deps);
  // Note: if both the initial and the recovery attempt fall back from the
  // WebSocket, `onWebSocketFallback` fires twice for a single turn. That is
  // accepted: the counter tracks CONSECUTIVE transport failures, and two real
  // failed WebSocket attempts did occur.
  yield* streamResponses(
    buildStreamParams(
      recoveryContext,
      abortSignal,
      invocationEphemerals,
      options,
    ),
    deps,
  );
}

/**
 * Shared stream-parameter builder so the initial and recovery paths stay
 * identical (#3134 Fix 1). Extracted to keep executeOpenAIResponsesRequest
 * within the project max-lines budget.
 */
function buildStreamParams(
  requestContext: RequestContext,
  abortSignal: AbortSignal | undefined,
  invocationEphemerals: Record<string, unknown>,
  options: NormalizedGenerateChatOptions,
): StreamResponsesParams {
  return {
    ...requestContext,
    abortSignal,
    maxStreamingAttempts:
      (invocationEphemerals['retries'] as number | undefined) ?? 6,
    streamRetryInitialDelayMs:
      (invocationEphemerals['retrywait'] as number | undefined) ?? 4000,
    normalizedOptions: options,
  };
}

export async function buildRequestContext(
  options: NormalizedGenerateChatOptions,
  patchedContent: IContent[],
  invocationEphemerals: Record<string, unknown>,
  deps: ResponsesExecutorDeps,
): Promise<PreparedResponsesRequestContext> {
  const rawBaseURL = resolveResponsesBaseURL(options, deps);
  const isCodex = deps.isCodexBaseURL(rawBaseURL);
  const userMemory = await resolveUserMemory(
    options.userMemory,
    () => options.invocation.userMemory,
  );
  const systemPrompt = await buildSystemPrompt(options, userMemory, deps);
  const requestOverrides = buildRequestOverrides(options, deps);
  const explicitUserStore =
    typeof requestOverrides['store'] === 'boolean'
      ? requestOverrides['store']
      : undefined;
  const stateful = computeStatefulConversation(
    options,
    patchedContent,
    invocationEphemerals,
    explicitUserStore,
    isCodex,
    rawBaseURL,
    deps.isResponsesStatefulFailed?.() ?? false,
    deps.logger,
  );
  const input = buildInput(
    options,
    stateful.content,
    invocationEphemerals,
    deps,
    stateful.parentId !== undefined,
  );
  const request = createRequest(options, input, requestOverrides, deps);
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
  applyStatefulConversation(request, stateful, explicitUserStore, deps.logger);
  return {
    rawBaseURL,
    isCodex,
    request,
    includeThinkingInResponse: reasoning.includeThinkingInResponse,
    responsesStored: request.store === true,
  };
}

async function resolveResponsesTransportContext(
  options: NormalizedGenerateChatOptions,
  prepared: PreparedResponsesRequestContext,
  deps: ResponsesExecutorDeps,
): Promise<RequestContext> {
  const rawBaseURL = resolveResponsesBaseURL(options, deps);
  if (rawBaseURL !== prepared.rawBaseURL) {
    throw new Error(
      `Projection/transport endpoint mismatch: the OpenAI Responses prompt envelope was prepared for "${prepared.rawBaseURL}" but transport resolved "${rawBaseURL}". A prepared envelope must be sent to the same endpoint it was estimated for (issue #2817 invariant: projection == transport).`,
    );
  }
  return {
    ...prepared,
    apiKey: await resolveApiKey(options, prepared.rawBaseURL, deps),
    baseURL: normalizeBaseURL(prepared.rawBaseURL),
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

export function isResponsesPdfEnabled(
  options: NormalizedGenerateChatOptions,
): boolean {
  const invocationEphemerals = resolveInvocationEphemerals(options);
  const setting =
    (invocationEphemerals['media.pdf.enabled'] as boolean | undefined) ??
    options.invocation.getModelBehavior<boolean>('media.pdf.enabled') ??
    readOptionalSetting(options, 'media.pdf.enabled');
  return setting !== false;
}

/**
 * Read a setting through the structurally optional `SettingsService.get`
 * seam. `get` is declared optional on the contract, so a settings object that
 * omits it must fall through to the caller's default rather than throwing.
 */
function readOptionalSetting(
  options: NormalizedGenerateChatOptions,
  key: string,
): unknown {
  const get = (
    options as { settings?: { get?: (settingKey: string) => unknown } }
  ).settings?.get;
  return typeof get === 'function'
    ? get.call(options.settings, key)
    : undefined;
}

function buildInput(
  options: NormalizedGenerateChatOptions,
  patchedContent: IContent[],
  invocationEphemerals: Record<string, unknown>,
  deps: ResponsesExecutorDeps,
  serverSideParentActive: boolean = false,
): ResponsesInputItem[] {
  const includeReasoningInContextSetting =
    (invocationEphemerals['reasoning.includeInContext'] as
      | boolean
      | undefined) ??
    options.invocation.getModelBehavior<boolean>(
      'reasoning.includeInContext',
    ) ??
    readOptionalSetting(options, 'reasoning.includeInContext');
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
    serverSideParentActive,
    mediaPdfEnabled: isResponsesPdfEnabled(options),
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

function resolveResponsesBaseURL(
  options: NormalizedGenerateChatOptions,
  deps: ResponsesExecutorDeps,
): string {
  return (
    options.resolved.baseURL ??
    deps.getProviderBaseURL(options) ??
    'https://api.openai.com/v1'
  );
}

function normalizeBaseURL(baseURLCandidate: string): string {
  let baseURL = baseURLCandidate;
  while (baseURL.endsWith('/')) baseURL = baseURL.slice(0, -1);
  return baseURL;
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

  // store=false is only the Codex DEFAULT. applyStatefulConversation runs
  // after this and raises it to store=true whenever statefulness is active.
  // See the design rationale doc comment on applyStatefulConversation in
  // openAIResponsesStateful.ts for the full trade-off discussion (#3134).
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

/**
 * Dumps the finalized Responses request at the common pre-transport seam when
 * context dumping is enabled, matching OpenAI Chat and Anthropic parity.
 * Best-effort: failures are logged and never block the request.
 */
async function dumpFinalizedRequest(
  requestContext: RequestContext,
  invocationEphemerals: Record<string, unknown>,
  deps: ResponsesExecutorDeps,
): Promise<void> {
  const dumpMode = invocationEphemerals['dumpcontext'] as DumpMode | undefined;
  if (!shouldDumpSDKContext(dumpMode, false)) return;
  try {
    await dumpSDKRequestContext(
      deps.providerName,
      '/responses',
      requestContext.request,
      requestContext.baseURL,
    );
  } catch (error) {
    deps.logger.debug(
      () => `Best-effort Responses request dump failed: ${String(error)}`,
    );
  }
}

async function* streamResponses(
  params: StreamResponsesParams,
  deps: ResponsesExecutorDeps,
): AsyncIterableIterator<IContent> {
  const transport = deps.getWebSocketTransport?.();
  if (params.isCodex && transport !== undefined) {
    const headers = await buildWebSocketHandshakeHeaders(params, deps);
    const streamOptions: StreamResponseOptions = {
      responsesURL: `${params.baseURL}/responses`,
      headers,
      abortSignal: params.abortSignal,
      includeThinkingInResponse: params.includeThinkingInResponse,
      responsesStored: params.responsesStored,
      onStreamLiveness: params.normalizedOptions.onStreamLiveness,
    };
    yield* streamOverWebSocketOrFallback(
      transport,
      params.request,
      streamOptions,
      () => streamOverHttp(params, deps),
      deps.onWebSocketFallback,
      deps.logger,
      deps.onWebSocketSuccess,
    );
    return;
  }

  yield* streamOverHttp(params, deps);
}

async function buildWebSocketHandshakeHeaders(
  params: StreamResponsesParams,
  deps: ResponsesExecutorDeps,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.apiKey}`,
    ...(deps.getCustomHeaders(params.normalizedOptions) ?? {}),
  };
  headers['ChatGPT-Account-ID'] = await deps.getCodexAccountId();
  headers['originator'] = 'codex_cli_rs';
  const invocationSessionId = params.normalizedOptions.invocation.runtimeId;
  const sessionId =
    typeof invocationSessionId === 'string' && invocationSessionId.trim() !== ''
      ? invocationSessionId
      : params.normalizedOptions.runtime?.runtimeId;
  if (typeof sessionId === 'string' && sessionId.trim() !== '') {
    headers['session_id'] = sessionId;
  }
  headers['OpenAI-Beta'] = CODEX_WEBSOCKET_BETA_HEADER;
  return headers;
}
