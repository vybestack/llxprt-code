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
 * The executor consumes the already-normalized `ResponsesRequest`
 * — it does NOT re-normalize — and an explicit `ResponsesExecutorDeps`
 * interface that carries provider-specific capabilities (auth resolution,
 * custom headers, Codex account ID) as pure functions.
 */

import {
  resolveInvocationEphemerals,
  normalizeBaseURL,
  resolveApiKey,
  createRequest,
  applyInstructionsAndTools,
  applyReasoningSettings,
  applyTextVerbosity,
  applyCodexRequestSettings,
  applyPromptCaching,
} from './responses-request-fields.js';
import { dumpFinalizedRequest } from './openAIResponsesRequestDump.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ResponsesRequest } from './responses-request.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import { isPreviousResponseNotFoundError } from './openAIResponsesStatefulRecovery.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { OpenAIResponsesRequest } from './OpenAIResponsesTypes.js';
import {
  applyStatefulConversation,
  type StatefulConversation,
} from './openAIResponsesStateful.js';
import {
  resolveResponsesBaseURL,
  resolveResponsesRequestShape,
} from './openAIResponsesRequestState.js';
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { type WebSocketTransport } from './openAIResponsesWebSocketTransport.js';
import {
  finishMediaRequest,
  type MediaRequestOutcome,
  resolveRequestMedia,
} from '../utils/request-media-resolution.js';
import type { StreamResponsesParams } from './openAIResponsesHttpStream.js';
import { streamResponses } from './openAIResponsesStreaming.js';
import type { resolveMediaCapabilities } from './openAIResponsesRequestState.js';
import type { NativeResponsesPrompt } from './native-responses-body.js';

/**
 * Provider-specific capabilities that the executor needs to do its work.
 * Passed explicitly so neither provider reads the other's namespace or
 * ambient runtime state.
 */
export interface ResponsesExecutorDeps {
  readonly providerName: string;
  readonly logger: DebugLogger;
  /** Whether the selected provider uses the Codex protocol. */
  readonly isCodexMode: () => boolean;
  /** Resolve the Codex account ID for OAuth headers (Codex mode only). */
  readonly getCodexAccountId: () => Promise<string>;
  /**
   * Resolve the auth token used for the API call (may trigger OAuth for
   * Codex). This is the single auth contract for the executor.
   */
  readonly resolveAuthTokenForPrompt: () => Promise<string>;
  /** Determine whether a streaming error is retryable (status-based). */
  readonly shouldRetryOnError: (error: Error | unknown) => boolean;
  readonly getMediaTransportCapabilities?: (
    isCodex: boolean,
  ) => ReturnType<typeof resolveMediaCapabilities>;
  /** Return model parameters disallowed by the provider's captured alias rules. */
  readonly getUnallowedModelParameters: (model: string) => Set<string>;
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
  readonly mediaRequest: ResolvedMediaRequest;
  /** The native prompt body and its pinned request selection. */
  readonly sourcePrompt: NativeResponsesPrompt;
  /** Whether the stateful plan was enabled when prepared. */
  readonly statefulEnabled: boolean;
  /**
   * The request rebuilds itself for the stateful retries (rejected parent,
   * WebSocket->HTTP fallback), since its history is not in memory.
   */
  readonly rebuildFromRows: (
    mode: RebuildMode,
  ) => Promise<PreparedResponsesRequestContext>;
  /**
   * The provider staged the rows from the call's `contents`, so a send that
   * carries `contents` instead of `requestRows` may use this context.
   */
  readonly rowsStagedFromContents?: boolean;
}

export interface RebuildMode {
  readonly forceStateless: boolean;
  readonly forceParentless: boolean;
  /** The request's synthesized reasoning-id time, carried across rebuilds. */
  readonly reasoningIdTime?: number;
}

export interface RequestContext extends PreparedResponsesRequestContext {
  readonly apiKey: string;
  readonly baseURL: string;
}

interface ResponsesExecutionSetup {
  readonly abortSignal: AbortSignal | undefined;
  readonly invocationEphemerals: Record<string, unknown>;
  readonly requestContext: RequestContext;
  readonly dumpResult: Awaited<ReturnType<typeof dumpFinalizedRequest>>;
}

async function prepareResponsesExecution(
  options: ResponsesRequest,
  deps: ResponsesExecutorDeps,
  prepared: PreparedResponsesRequestContext,
): Promise<ResponsesExecutionSetup> {
  const abortSignal = getRequestSignal(options);
  const invocationEphemerals = resolveInvocationEphemerals(options);
  const requestContext = await resolveResponsesTransportContext(
    options,
    prepared,
    deps,
  );
  try {
    const dumpResult = await dumpFinalizedRequest(
      requestContext,
      invocationEphemerals,
      deps,
      options,
    );
    return { abortSignal, invocationEphemerals, requestContext, dumpResult };
  } catch (error) {
    return finishMediaRequest(requestContext.mediaRequest, {
      status: 'failed',
      error,
    });
  }
}

export async function* executeOpenAIResponsesRequest(
  options: ResponsesRequest,
  deps: ResponsesExecutorDeps,
  preparedRequestContext: PreparedResponsesRequestContext,
): AsyncIterableIterator<IContent> {
  const { abortSignal, invocationEphemerals, requestContext, dumpResult } =
    await prepareResponsesExecution(options, deps, preparedRequestContext);
  const streamParams: StreamResponsesParams = {
    ...buildStreamParams(
      requestContext,
      abortSignal,
      invocationEphemerals,
      options,
      dumpResult,
    ),
    rebuildStateless: async () => {
      await requestContext.mediaRequest.release();
      return buildStatelessTurn(
        options,
        deps,
        invocationEphemerals,
        requestContext.rebuildFromRows,
      );
    },
  };

  // #3134 Fix 1: one-shot recovery when previous_response_id is rejected.
  // The safe replay boundary is "no IContent has been yielded to the consumer"
  // — if even one chunk escaped we cannot retry without duplicating output.
  let contentYielded = false;
  let rejectedParentId: string | undefined;
  let outcome: MediaRequestOutcome = { status: 'succeeded' };
  try {
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
  } catch (error) {
    outcome = { status: 'failed', error };
  } finally {
    await finishMediaRequest(requestContext.mediaRequest, outcome);
  }

  if (rejectedParentId === undefined) {
    throw new Error(
      'Responses stateful retry was entered without a rejected parent',
    );
  }
  // The same gate the streaming layer uses to choose the WebSocket branch:
  // only when the recovery will actually run over the WebSocket do the
  // connection-scoped parents need the parentless rebuild (#3446).
  const recoverParentless =
    requestContext.isCodex && deps.getWebSocketTransport?.() !== undefined;
  yield* retryWithoutStatefulness(
    options,
    deps,
    invocationEphemerals,
    abortSignal,
    rejectedParentId,
    recoverParentless,
    requestContext.rebuildFromRows,
  );
}

/**
 * Second and final attempt for a turn whose `previous_response_id` the backend
 * refused (#3134 Fix 1). Only reachable before any IContent has been yielded,
 * so replaying the turn cannot duplicate output.
 *
 * Extracted from executeOpenAIResponsesRequest to keep it within the project
 * max-lines-per-function budget.
 *
 * `recoverParentless` (#3446): over the WebSocket transport every stored
 * parent is connection-scoped, so after one parent dies the scan falling
 * through to an OLDER stored parent just spends a second rejection. The
 * recovery rebuilds parentless (full history) while staying STATEFUL —
 * `forceStateless` is deliberately NOT used, because disabling statefulness
 * would stop the recovery response from being stamped stored and the chain
 * could not re-establish on the next turn. Over HTTP parents are durable, so
 * the per-id fallthrough is preserved there (`recoverParentless` stays
 * false).
 */
async function* retryWithoutStatefulness(
  options: ResponsesRequest,
  deps: ResponsesExecutorDeps,
  invocationEphemerals: Record<string, unknown>,
  abortSignal: AbortSignal | undefined,
  rejectedParentId: string,
  recoverParentless: boolean,
  rebuildFromRows: PreparedResponsesRequestContext['rebuildFromRows'],
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
  const recoveryPrepared = await rebuildFromRows({
    forceStateless: false,
    forceParentless: recoverParentless,
  });
  const recoveryContext = await resolveResponsesTransportContext(
    options,
    recoveryPrepared,
    deps,
  );
  // The recovery request is the one that actually reaches the model, so it is
  // the one worth seeing under `dumpcontext`.
  let recoveryDump: Awaited<ReturnType<typeof dumpFinalizedRequest>>;
  try {
    recoveryDump = await dumpFinalizedRequest(
      recoveryContext,
      invocationEphemerals,
      deps,
      options,
    );
  } catch (error) {
    await finishMediaRequest(recoveryContext.mediaRequest, {
      status: 'failed',
      error,
    });
    throw error;
  }
  // Note: if both the initial and the recovery attempt fall back from the
  // WebSocket, `onWebSocketFallback` fires twice for a single turn. That is
  // accepted: the counter tracks CONSECUTIVE transport failures, and two real
  // failed WebSocket attempts did occur.
  let outcome: MediaRequestOutcome = { status: 'succeeded' };
  try {
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
  } catch (error) {
    outcome = { status: 'failed', error };
  } finally {
    await finishMediaRequest(recoveryContext.mediaRequest, outcome);
  }
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
  options: ResponsesRequest,
  deps: ResponsesExecutorDeps,
  invocationEphemerals: Record<string, unknown>,
  rebuildFromRows: PreparedResponsesRequestContext['rebuildFromRows'],
): Promise<StreamResponsesParams> {
  const prepared = await rebuildFromRows({
    forceStateless: true,
    forceParentless: false,
  });
  const context = await resolveResponsesTransportContext(
    options,
    prepared,
    deps,
  );
  let dumpResult: Awaited<ReturnType<typeof dumpFinalizedRequest>>;
  try {
    dumpResult = await dumpFinalizedRequest(
      context,
      invocationEphemerals,
      deps,
      options,
      // The rebuilt turn is always carried over HTTP (#3159).
      true,
    );
  } catch (error) {
    return finishMediaRequest(context.mediaRequest, {
      status: 'failed',
      error,
    });
  }
  return buildStreamParams(
    context,
    getRequestSignal(options),
    invocationEphemerals,
    options,
    dumpResult,
  );
}

/**
 * `retries` counts retries, so `0` still makes the one initial attempt (the
 * same reading RetryOrchestrator applies). A budget of zero attempts would end
 * the stream without ever sending the request.
 */
function streamingAttemptBudget(retries: unknown): number {
  if (retries === undefined) return 6;
  if (typeof retries !== 'number' || !Number.isInteger(retries) || retries < 0)
    throw new Error(
      `The retries setting must be a non-negative integer, received ${String(retries)}`,
    );
  return Math.max(1, retries);
}

function buildStreamParams(
  requestContext: RequestContext,
  abortSignal: AbortSignal | undefined,
  invocationEphemerals: Record<string, unknown>,
  options: ResponsesRequest,
  dumpResult: Awaited<ReturnType<typeof dumpFinalizedRequest>>,
): StreamResponsesParams {
  return {
    ...requestContext,
    ...responseBodyStreams(requestContext),
    abortSignal,
    maxStreamingAttempts: streamingAttemptBudget(
      invocationEphemerals['retries'],
    ),
    streamRetryInitialDelayMs:
      typeof invocationEphemerals['retrywait'] === 'number'
        ? invocationEphemerals['retrywait']
        : 4000,
    normalizedOptions: options,
    dumpBaseId: dumpResult.baseId,
    dumpMode: dumpResult.dumpMode,
  };
}

function responseBodyStreams(
  requestContext: RequestContext,
): Pick<
  StreamResponsesParams,
  | 'streamRequestBody'
  | 'streamRequestBodyLength'
  | 'streamWebSocketFrame'
  | 'streamDumpBody'
> {
  const prompt = requestContext.sourcePrompt;
  return {
    streamRequestBody: () => prompt.body(requestContext.request),
    streamRequestBodyLength: () => Promise.resolve(prompt.byteLength),
    streamWebSocketFrame: () => prompt.frame(requestContext.request),
    streamDumpBody: () => prompt.body(requestContext.request, 'dump'),
  };
}

/**
 * The request skeleton of a disk text send: everything but the prompt keys
 * (`input`, `instructions`, `tools`), which the caller streams from scratch
 * files. The stateful decision is made by the caller while it reads the rows.
 */
export type ResponsesRequestShell = Omit<
  PreparedResponsesRequestContext,
  'sourcePrompt' | 'statefulEnabled' | 'rebuildFromRows'
>;

export async function buildResponsesRequestShell(
  options: ResponsesRequest,
  deps: ResponsesExecutorDeps,
  stateful: StatefulConversation,
): Promise<ResponsesRequestShell> {
  const shape = resolveResponsesRequestShape(options, deps);
  const { rawBaseURL, isCodex, systemPrompt, requestOverrides } = shape;
  const { explicitUserStore } = shape;
  const mediaRequest = await resolveRequestMedia(
    {
      requestId: options.mediaRequestId,
      aggregateBudgetBytes: options.mediaBudgetBytes,
      resolver: options.mediaResolver,
    },
    [],
    getRequestSignal(options),
  );
  try {
    const request = createRequest(options, [], requestOverrides);
    applyInstructionsAndTools(request, systemPrompt, options);
    const reasoning = applyReasoningSettings(request, options, deps);
    applyTextVerbosity(request, options, deps);
    applyCodexRequestSettings(request, isCodex, deps);
    applyPromptCaching(request, options, isCodex);
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
      includeThinkingInResponse: reasoning.includeThinkingInResponse,
      // Codex cannot use `store` (the backend rejects store=true), so its
      // continuation is tracked by the connection instead. A stateful Codex turn
      // is therefore "stored" for chaining purposes even though store=false.
      responsesStored: request.store === true || (isCodex && stateful.enabled),
      mediaRequest,
    };
  } catch (error) {
    return finishMediaRequest(mediaRequest, { status: 'failed', error });
  }
}

async function resolveResponsesTransportContext(
  options: ResponsesRequest,
  prepared: PreparedResponsesRequestContext,
  deps: ResponsesExecutorDeps,
): Promise<RequestContext> {
  try {
    const rawBaseURL = resolveResponsesBaseURL(options);
    if (rawBaseURL !== prepared.rawBaseURL) {
      throw new Error(
        `Projection/transport endpoint mismatch: the OpenAI Responses prompt envelope was prepared for "${prepared.rawBaseURL}" but transport resolved "${rawBaseURL}". A prepared envelope must be sent to the same endpoint it was estimated for (issue #2817 invariant: projection == transport).`,
      );
    }
    return {
      ...prepared,
      apiKey: await resolveApiKey(options, deps),
      baseURL: normalizeBaseURL(prepared.rawBaseURL),
    };
  } catch (error) {
    return finishMediaRequest(prepared.mediaRequest, {
      status: 'failed',
      error,
    });
  }
}

export { isResponsesPdfEnabled } from './responses-request-fields.js';
