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
import { requireAssembledSystemInstruction } from '../utils/systemPromptPlacement.js';
import { resolveRuntimeAuthToken } from '../utils/authToken.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import { isPreviousResponseNotFoundError } from './openAIResponsesStatefulRecovery.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { OPENAI_TRANSPORT_SELECTOR_KEYS } from '../openai/openaiModelPolicy.js';
import { buildOpenAIResponsesInput } from './OpenAIResponsesInputBuilder.js';
import {
  applyOpenAIResponsesReasoning,
  type AppliedOpenAIResponsesReasoning,
} from './openai-responses-reasoning.js';
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
  bestEffortDump,
} from '../utils/dumpSDKContext.js';
import type { DumpMode } from '../utils/dumpContext.js';
import type { OpenAIResponsesProjectionContext } from '../runtime/promptEnvelopeProjections.js';

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
   * Reports whether the backend has already refused this response id as a
   * parent, so the parent scan can skip it (#3134 Fix 1).
   */
  readonly isRejectedStatefulParent?: (responseId: string) => boolean;
  /**
   * Records a response id the backend refused as a parent. Scoped to the one
   * dead id rather than disabling statefulness for the session: Codex parents
   * belong to a single WebSocket connection, so a resumed session starts with
   * parents that are already dead, and a session-wide switch would make such a
   * session replay full history forever instead of starting a new chain
   * (#3134 Fix 1).
   */
  readonly markStatefulParentRejected?: (responseId: string) => void;
  /**
   * Whether this request will go over the Codex Responses WebSocket.
   *
   * Codex statefulness is transport-bound and the backend enforces it: the
   * ChatGPT endpoint rejects `store: true` outright
   * (400 `{"detail":"Store must be set to false"}`), so a parent can only be
   * resolved from the live socket that produced it. Sending
   * `previous_response_id` over HTTP is rejected, costing a wasted round trip
   * and permanently suppressing statefulness for the session, so the request
   * builder must know the transport before it trims history (#3134).
   */
  readonly isWebSocketTransportActive?: () => boolean;
}

export interface PreparedResponsesRequestContext {
  readonly rawBaseURL: string;
  readonly isCodex: boolean;
  readonly includeThinkingInResponse: boolean;
  readonly responsesStored: boolean;
  readonly request: OpenAIResponsesRequest;
  readonly projectionContext: OpenAIResponsesProjectionContext;
}

interface RequestContext extends PreparedResponsesRequestContext {
  readonly apiKey: string;
  readonly baseURL: string;
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
  forceStateless = false,
): Promise<PreparedResponsesRequestContext> {
  const patchedContent = SyntheticToolResponseHandler.patchMessageHistory(
    options.contents,
  );
  return buildRequestContext(
    options,
    patchedContent,
    invocationEphemerals,
    deps,
    forceStateless,
  );
}

export async function* executeOpenAIResponsesRequest(
  options: NormalizedGenerateChatOptions,
  deps: ResponsesExecutorDeps,
  preparedRequestContext?: PreparedResponsesRequestContext,
): AsyncIterableIterator<IContent> {
  // Issue #3136: fail fast before any request preparation. Projection paths
  // call buildResponsesRequestContextForProjection directly and are exempt.
  requireAssembledSystemInstruction(options.systemInstruction);

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

  const dumpResult = await dumpFinalizedRequest(
    requestContext,
    invocationEphemerals,
    deps,
  );

  const streamParams: StreamResponsesParams = {
    ...buildStreamParams(
      requestContext,
      abortSignal,
      invocationEphemerals,
      options,
      dumpResult,
    ),
    rebuildStateless: () =>
      buildStatelessTurn(options, deps, invocationEphemerals, abortSignal),
  };

  // #3134 Fix 1: one-shot recovery when previous_response_id is rejected.
  // The safe replay boundary is "no IContent has been yielded to the consumer"
  // — if even one chunk escaped we cannot retry without duplicating output.
  let contentYielded = false;
  let rejectedParentId: string;
  try {
    for await (const content of streamResponses(streamParams, deps)) {
      contentYielded = true;
      yield content;
    }
    return;
  } catch (error) {
    // Guard on the request the transport actually sent, not on `prepared`,
    // so a future divergence between the two cannot skip recovery.
    const sentParentId = requestContext.request.previous_response_id;
    if (
      contentYielded ||
      sentParentId === undefined ||
      !isPreviousResponseNotFoundError(error)
    ) {
      throw error;
    }
    rejectedParentId = sentParentId;
    deps.logger.debug(
      () =>
        `responses-stateful: parent ${sentParentId} was rejected by the API; retiring it and retrying once with full history. Error: ${String(error)}`,
    );
  }

  yield* retryWithoutStatefulness(
    options,
    deps,
    invocationEphemerals,
    abortSignal,
    rejectedParentId,
  );
}

/**
 * Second and final attempt for a turn whose `previous_response_id` the backend
 * refused (#3134 Fix 1). Only reachable before any IContent has been yielded,
 * so replaying the turn cannot duplicate output.
 *
 * Extracted from executeOpenAIResponsesRequest to keep it within the project
 * max-lines-per-function budget.
 */
async function* retryWithoutStatefulness(
  options: NormalizedGenerateChatOptions,
  deps: ResponsesExecutorDeps,
  invocationEphemerals: Record<string, unknown>,
  abortSignal: AbortSignal | undefined,
  rejectedParentId: string,
): AsyncIterableIterator<IContent> {
  // Retire only the dead id, then rebuild. The retry therefore sends full
  // history with no parent, and — because the parent scan takes the NEWEST
  // eligible turn — the response it produces becomes the parent for the very
  // next turn. The chain re-establishes itself instead of the session
  // degrading to permanent full-history replay.
  //
  // This matters most on `--continue`: resumed history carries parents scoped
  // to a WebSocket connection that no longer exists, so the first turn of a
  // resumed session always spends one rejected request here.
  deps.markStatefulParentRejected?.(rejectedParentId);
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
  const recoveryDump = await dumpFinalizedRequest(
    recoveryContext,
    invocationEphemerals,
    deps,
  );
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
      recoveryDump,
    ),
    deps,
  );
}

/**
 * Shared stream-parameter builder so the initial and recovery paths stay
 * identical (#3134 Fix 1). Extracted to keep executeOpenAIResponsesRequest
 * within the project max-lines budget.
 */
/**
 * Re-derives the current turn with statefulness suppressed (full history, no
 * `previous_response_id`), for the mid-turn WebSocket->HTTP fallback: the HTTP
 * endpoint cannot resolve a socket-scoped parent.
 *
 * Deliberately does NOT mark the session as stateful-failed — a transport blip
 * is not evidence that the parent itself was bad (#3134).
 */
async function buildStatelessTurn(
  options: NormalizedGenerateChatOptions,
  deps: ResponsesExecutorDeps,
  invocationEphemerals: Record<string, unknown>,
  abortSignal: AbortSignal | undefined,
): Promise<StreamResponsesParams> {
  const prepared = await buildResponsesRequestContextForProjection(
    options,
    deps,
    invocationEphemerals,
    /* forceStateless */ true,
  );
  const context = await resolveResponsesTransportContext(
    options,
    prepared,
    deps,
  );
  const dumpResult = await dumpFinalizedRequest(
    context,
    invocationEphemerals,
    deps,
  );
  return buildStreamParams(
    context,
    abortSignal,
    invocationEphemerals,
    options,
    dumpResult,
  );
}

function buildStreamParams(
  requestContext: RequestContext,
  abortSignal: AbortSignal | undefined,
  invocationEphemerals: Record<string, unknown>,
  options: NormalizedGenerateChatOptions,
  dumpResult: Awaited<ReturnType<typeof dumpFinalizedRequest>>,
): StreamResponsesParams {
  return {
    ...requestContext,
    abortSignal,
    maxStreamingAttempts:
      (invocationEphemerals['retries'] as number | undefined) ?? 6,
    streamRetryInitialDelayMs:
      (invocationEphemerals['retrywait'] as number | undefined) ?? 4000,
    normalizedOptions: options,
    dumpBaseId: dumpResult.baseId,
    dumpMode: dumpResult.dumpMode,
  };
}

function buildResponsesProjectionContext(
  request: OpenAIResponsesRequest,
  options: NormalizedGenerateChatOptions,
  patchedContent: IContent[],
  invocationEphemerals: Record<string, unknown>,
  deps: ResponsesExecutorDeps,
  stateful: ReturnType<typeof computeStatefulConversation>,
): OpenAIResponsesProjectionContext {
  const statefulParentUsed = stateful.parentId !== undefined;
  if (!statefulParentUsed) {
    return {
      statefulParentUsed,
      incrementalRequest: request,
    };
  }
  if (stateful.parentRetainedTokens !== undefined) {
    return {
      statefulParentUsed,
      incrementalRequest: request,
      retainedBaselineTokens: stateful.parentRetainedTokens,
    };
  }
  return {
    statefulParentUsed,
    incrementalRequest: request,
    fullHistoryRequest: {
      ...request,
      input: buildInput(
        options,
        patchedContent,
        invocationEphemerals,
        deps,
        false,
      ),
    },
  };
}

function computeRequestStatefulConversation(
  options: NormalizedGenerateChatOptions,
  patchedContent: IContent[],
  invocationEphemerals: Record<string, unknown>,
  explicitUserStore: boolean | undefined,
  isCodex: boolean,
  rawBaseURL: string,
  forceStateless: boolean,
  deps: ResponsesExecutorDeps,
): ReturnType<typeof computeStatefulConversation> {
  // Codex can only be stateful over the WebSocket transport because the parent
  // lives on the socket. Non-Codex storage is transport-independent.
  let statefulTransportSupported: boolean;
  if (forceStateless) {
    statefulTransportSupported = false;
  } else if (!isCodex) {
    statefulTransportSupported = true;
  } else {
    statefulTransportSupported = deps.isWebSocketTransportActive?.() ?? false;
  }
  return computeStatefulConversation(
    options,
    patchedContent,
    invocationEphemerals,
    explicitUserStore,
    isCodex,
    rawBaseURL,
    (responseId) => deps.isRejectedStatefulParent?.(responseId) ?? false,
    statefulTransportSupported,
    deps.logger,
  );
}

export async function buildRequestContext(
  options: NormalizedGenerateChatOptions,
  patchedContent: IContent[],
  invocationEphemerals: Record<string, unknown>,
  deps: ResponsesExecutorDeps,
  forceStateless = false,
): Promise<PreparedResponsesRequestContext> {
  const rawBaseURL = resolveResponsesBaseURL(options, deps);
  const isCodex = deps.isCodexBaseURL(rawBaseURL);
  // Issue #3136: the agent layer owns system-prompt assembly. The provider
  // transports options.systemInstruction verbatim (empty for projection).
  // options.userMemory is deliberately NOT read here: user memory is baked
  // into the assembled instruction upstream.
  const systemPrompt = options.systemInstruction ?? '';
  const requestOverrides = buildRequestOverrides(options, deps);
  const explicitUserStore =
    typeof requestOverrides['store'] === 'boolean'
      ? requestOverrides['store']
      : undefined;
  const stateful = computeRequestStatefulConversation(
    options,
    patchedContent,
    invocationEphemerals,
    explicitUserStore,
    isCodex,
    rawBaseURL,
    forceStateless,
    deps,
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
  applyStatefulConversation(
    request,
    stateful,
    explicitUserStore,
    isCodex,
    deps.logger,
  );
  return {
    rawBaseURL,
    isCodex,
    request,
    projectionContext: buildResponsesProjectionContext(
      request,
      options,
      patchedContent,
      invocationEphemerals,
      deps,
      stateful,
    ),
    includeThinkingInResponse: reasoning.includeThinkingInResponse,
    // Codex cannot use `store` (the backend rejects store=true), so its
    // continuation is tracked by the connection instead. A stateful Codex turn
    // is therefore "stored" for chaining purposes even though store=false.
    responsesStored: request.store === true || (isCodex && stateful.enabled),
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
): AppliedOpenAIResponsesReasoning {
  const reasoning = applyOpenAIResponsesReasoning({
    request,
    modelBehavior: options.invocation.modelBehavior,
    fallbacks: {
      enabled:
        invocationEphemerals['reasoning.enabled'] ??
        readOptionalSetting(options, 'reasoning.enabled'),
      effort:
        invocationEphemerals['reasoning.effort'] ??
        readOptionalSetting(options, 'reasoning.effort'),
      budgetTokens:
        invocationEphemerals['reasoning.budgetTokens'] ??
        readOptionalSetting(options, 'reasoning.budgetTokens'),
      summary:
        invocationEphemerals['reasoning.summary'] ??
        readOptionalSetting(options, 'reasoning.summary'),
      includeInResponse:
        invocationEphemerals['reasoning.includeInResponse'] ??
        readOptionalSetting(options, 'reasoning.includeInResponse'),
    },
    providerName: deps.providerName,
    logger: deps.logger,
  });
  deps.logger.debug(
    () =>
      `Reasoning check: enabled=${String(reasoning.enabled)}, effort=${String(reasoning.effort)}, summary=${String(reasoning.summary)}, shouldRequest=${reasoning.selected}, includeInResponse=${reasoning.includeThinkingInResponse}`,
  );
  if (reasoning.selected) {
    request.include = ['reasoning.encrypted_content'];
    deps.logger.debug(
      () => `Added include parameter: ${JSON.stringify(request.include)}`,
    );
  }
  deps.logger.debug(
    () => `Full request reasoning config: ${JSON.stringify(request.reasoning)}`,
  );
  return reasoning;
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

interface DumpFinalizedResult {
  baseId?: string;
  dumpMode?: DumpMode;
}

/**
 * Dumps the finalized Responses request at the common pre-transport seam when
 * context dumping is enabled, matching OpenAI Chat and Anthropic parity.
 * Best-effort: failures are logged and never block the request.
 * Returns the dump base id and resolved mode so the transport can write a
 * linked error-response dump on failure (issue #3140).
 */
async function dumpFinalizedRequest(
  requestContext: RequestContext,
  invocationEphemerals: Record<string, unknown>,
  deps: ResponsesExecutorDeps,
): Promise<DumpFinalizedResult> {
  const dumpMode = invocationEphemerals['dumpcontext'] as DumpMode | undefined;
  if (!shouldDumpSDKContext(dumpMode, false)) {
    return { dumpMode };
  }
  const result = await bestEffortDump(
    'request',
    deps.providerName,
    () =>
      dumpSDKRequestContext(
        deps.providerName,
        '/responses',
        requestContext.request,
        requestContext.baseURL,
      ),
    deps.logger,
  );
  return { baseId: result?.baseId, dumpMode };
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
      () => streamOverHttpWithoutStatefulness(params, deps),
      deps.onWebSocketFallback,
      deps.logger,
      deps.onWebSocketSuccess,
    );
    return;
  }

  yield* streamOverHttp(params, deps);
}

/**
 * HTTP fallback for a request that was built for the WebSocket.
 *
 * A WebSocket-built Codex request can carry a socket-scoped
 * `previous_response_id` and a trimmed input. The Codex HTTP endpoint cannot
 * resolve that parent (it rejects the request, since nothing is stored
 * server-side), so replaying the WebSocket request here would fail and lose
 * the trimmed-away context. Re-derive a stateless request instead (#3134).
 */
async function* streamOverHttpWithoutStatefulness(
  params: StreamResponsesParams,
  deps: ResponsesExecutorDeps,
): AsyncIterableIterator<IContent> {
  if (
    params.rebuildStateless === undefined ||
    params.request.previous_response_id === undefined
  ) {
    yield* streamOverHttp(params, deps);
    return;
  }
  deps.logger.debug(
    () =>
      'Codex WebSocket fallback: rebuilding the request without previous_response_id for HTTP.',
  );
  yield* streamOverHttp(await params.rebuildStateless(), deps);
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
    headers['session-id'] = sessionId;
    headers['thread-id'] = sessionId;
    headers['x-client-request-id'] = sessionId;
  }
  headers['OpenAI-Beta'] = CODEX_WEBSOCKET_BETA_HEADER;
  return headers;
}
