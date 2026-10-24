/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { nativeResponsesAccounting } from './native-responses-estimate.js';
import { prepareNativeResponsesPrompt } from './native-responses-body.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { ResponsesRequest } from './responses-request.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import { requireAssembledSystemInstruction } from '../utils/systemPromptPlacement.js';
import { finishMediaRequest } from '../utils/request-media-resolution.js';
import { findDanglingCalls } from './responses-dangling-calls.js';
import { resolveInvocationEphemerals } from './responses-request-fields.js';
import { readRequestReasoningIdTime } from '../transportAttemptBudget.js';
import {
  resolveResponsesRequestShape,
  resolveResponsesStatefulPlan,
} from './openAIResponsesRequestState.js';
import {
  parentHitOf,
  selectStatefulParent,
  type StatefulConversation,
  type StatefulParentHit,
} from './openAIResponsesStateful.js';
import {
  buildResponsesRequestShell,
  type RebuildMode,
  type PreparedResponsesRequestContext,
  type ResponsesExecutorDeps,
} from './openAIResponsesExecutor.js';

/** Every row is read and counted; rows before `skipRows` are not yielded. */
async function* countedRows(
  rows: ProviderRequestRows,
  signal?: AbortSignal,
  skipRows = 0,
): AsyncGenerator<IContent, void> {
  let count = 0;
  for await (const row of rows.openReader(signal)) {
    signal?.throwIfAborted();
    if (count++ >= skipRows) yield row;
  }
  if (count !== rows.count) throw new Error('Disk source row count changed');
}

async function* statefulRows(
  rows: ProviderRequestRows,
  signal?: AbortSignal,
): AsyncGenerator<IContent> {
  if (rows.native === undefined) {
    yield* countedRows(rows, signal);
    return;
  }
  for (let index = 0; index < rows.count; index++)
    yield (await rows.native.indexed.planAt(index, signal)).header;
}

/**
 * Selects the newest usable stored parent while streaming the rows once; only
 * that row's id and observed usage are retained, never the history.
 */
async function selectRowsStateful(
  request: ResponsesRequest,
  deps: ResponsesExecutorDeps,
  ephemerals: Record<string, unknown>,
  rows: ProviderRequestRows,
  mode: RebuildMode,
): Promise<{
  stateful: StatefulConversation;
  skipRows: number;
}> {
  const plan = resolveResponsesStatefulPlan(
    request,
    ephemerals,
    deps,
    mode.forceStateless,
    mode.forceParentless,
  );
  if (plan.kind === 'settled')
    return {
      stateful: { enabled: plan.enabled, parentId: undefined },
      skipRows: 0,
    };
  let hit: StatefulParentHit | undefined;
  let index = 0;
  for await (const row of statefulRows(rows, getRequestSignal(request))) {
    hit = parentHitOf(row, index++, plan) ?? hit;
  }
  // The array route patches synthetic outputs before choosing the parent, so
  // dangling calls on the parent row itself leave content after it.
  // Native journal-response-slots.responseAdjacent already adds orphan outputs after their calls.
  const calls =
    hit === undefined || rows.native !== undefined
      ? undefined
      : await findDanglingCalls(
          () => countedRows(rows, getRequestSignal(request)),
          getRequestSignal(request),
        );
  const syntheticRows =
    hit !== undefined && calls?.lastCallRow === hit.index
      ? calls.missing.size
      : 0;
  const selection = selectStatefulParent(
    hit,
    rows.count + syntheticRows,
    deps.logger,
  );
  return {
    skipRows: selection.skipRows,
    stateful: {
      enabled: true,
      parentId: selection.parentId,
      ...(selection.parentRetainedTokens === undefined
        ? {}
        : { parentRetainedTokens: selection.parentRetainedTokens }),
    },
  };
}

export function assertDiskTextShape(
  request: ResponsesRequest,
  deps: ResponsesExecutorDeps,
): Readonly<Record<string, unknown>> {
  return resolveResponsesRequestShape(request, deps).requestOverrides;
}

/** A source token's stateful decision must still hold when it is sent. */
export function assertPreparedStatefulUnchanged(
  request: ResponsesRequest,
  deps: ResponsesExecutorDeps,
  prepared: PreparedResponsesRequestContext,
): void {
  const plan = resolveResponsesStatefulPlan(
    request,
    resolveInvocationEphemerals(request),
    deps,
    false,
    false,
  );
  if ((plan.kind === 'scan' || plan.enabled) !== prepared.statefulEnabled)
    throw new Error(
      'Explicit Responses disk text stateful options changed after the source token was prepared',
    );
}

function requireDiskTextRows(
  request: ResponsesRequest,
): NonNullable<ResponsesRequest['requestRows']> {
  const rows = request.requestRows;
  if (rows === undefined || request.contentCount !== rows.count)
    throw new Error(
      'Explicit Responses disk text selection identity/count is required',
    );
  if (rows.native === undefined && rows.callerOwned !== true)
    throw new Error(
      'Responses requires a native or caller-owned request selection',
    );
  return rows;
}

function rebuildResponses(
  request: ResponsesRequest,
  deps: ResponsesExecutorDeps,
  reasoningIdTime: number,
): PreparedResponsesRequestContext['rebuildFromRows'] {
  return (mode) =>
    buildDiskTextResponsesContext(request, deps, { ...mode, reasoningIdTime });
}

export async function buildDiskTextResponsesContext(
  request: ResponsesRequest,
  deps: ResponsesExecutorDeps,
  mode: RebuildMode = { forceStateless: false, forceParentless: false },
): Promise<PreparedResponsesRequestContext> {
  requireAssembledSystemInstruction(request.systemInstruction);
  const overrides = assertDiskTextShape(request, deps);
  const rows = requireDiskTextRows(request);
  const ephemerals = resolveInvocationEphemerals(request);
  const reasoningIdTime =
    mode.reasoningIdTime ?? readRequestReasoningIdTime(request) ?? Date.now();
  const { stateful, skipRows } = await selectRowsStateful(
    request,
    deps,
    ephemerals,
    rows,
    mode,
  );
  const prepared = await buildResponsesRequestShell(request, deps, stateful);
  try {
    const prompt = await prepareNativeResponsesPrompt(
      request,
      deps,
      prepared,
      reasoningIdTime,
      {
        stateful,
        skipRows,
        ...('input' in overrides
          ? { inputOverride: { value: overrides['input'] } }
          : {}),
      },
    );
    prepared.mediaRequest.registerCleanup(() => prompt.dispose());
    return {
      ...prepared,
      sourcePrompt: prompt,
      statefulEnabled: stateful.enabled,
      rebuildFromRows: rebuildResponses(request, deps, reasoningIdTime),
    };
  } catch (error) {
    return finishMediaRequest(prepared.mediaRequest, {
      status: 'failed',
      error,
    });
  }
}

const pinnedSourceEstimatorOnly = (): Promise<number> =>
  Promise.reject(
    new Error('Disk text projection requires the pinned source estimator'),
  );

export function diskTextProjection(
  prepared: PreparedResponsesRequestContext,
  token: object,
  releaseIfUnsent: () => Promise<void>,
): PromptEnvelopeProjection {
  const prompt = prepared.sourcePrompt;
  return {
    model: prompt.model,
    protocol: prompt.protocol,
    method: prompt.method,
    projectionRevision: prompt.projectionRevision,
    unsupportedMedia: prompt.unsupportedMedia,
    transportToken: token,
    finalizedProjection: prompt.toEstimatorProjection(),
    legacyEstimate: pinnedSourceEstimatorOnly,
    accounting: nativeResponsesAccounting(prompt),
    releaseIfUnsent,
  };
}
