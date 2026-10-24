/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { nativeResponsesAccounting } from './native-responses-estimate.js';
import { readFileSync } from 'node:fs';
import {
  NativeResponsesPrompt,
  prepareNativeResponsesPrompt,
} from './native-responses-body.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type {
  PromptEnvelopeAccountingProjection,
  PromptEnvelopeEstimationProjection,
  PromptEnvelopeProjection,
  UnsupportedMediaEntry,
} from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { ResponsesRequest } from './responses-request.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import { requireAssembledSystemInstruction } from '../utils/systemPromptPlacement.js';
import { finishMediaRequest } from '../utils/request-media-resolution.js';
import {
  serializeResponsesPromptEnvelope,
  type ResponsesSourceOptions,
  type ResponsesSourcePrompt,
} from '../runtime/responses-source-serializer.js';
import {
  findDanglingCalls,
  type HistoryDangling,
} from '../runtime/responses-source-input.js';
import {
  responsesInputContext,
  resolveInvocationEphemerals,
} from './responses-request-fields.js';
import { readRequestReasoningIdTime } from '../transportAttemptBudget.js';
import { resolveRowsMedia } from './responses-row-media.js';
import {
  resolveResponsesRequestShape,
  resolveResponsesStatefulPlan,
  toEstimationContents,
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
  historyDangling?: HistoryDangling;
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
    ...(calls === undefined || selection.parentId === undefined
      ? {}
      : { historyDangling: { calls, skipRows: selection.skipRows } }),
    stateful: {
      enabled: true,
      parentId: selection.parentId,
      ...(selection.parentRetainedTokens === undefined
        ? {}
        : { parentRetainedTokens: selection.parentRetainedTokens }),
    },
  };
}

async function* estimationRows(
  rows: AsyncIterable<IContent>,
): AsyncGenerator<IContent, void> {
  for await (const row of rows) yield* toEstimationContents([row]);
}

/** Incremental and full-history passes the estimator needs for a stored parent. */
function statefulAccounting(
  rows: ProviderRequestRows,
  stateful: StatefulConversation,
  signal: AbortSignal | undefined,
  skipRows: number,
): Pick<ResponsesSourceOptions, 'stateful'> {
  if (stateful.parentId === undefined) return {};
  return {
    stateful: {
      statefulParentUsed: true,
      retainedBaselineTokens: stateful.parentRetainedTokens,
      // Estimation only: the transmitted rows are resolved once, by the write.
      incrementalContents: estimationRows(countedRows(rows, signal, skipRows)),
      ...(stateful.parentRetainedTokens === undefined
        ? {
            fullHistoryContents: estimationRows(countedRows(rows, signal)),
          }
        : {}),
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

function clearDiskPromptKeys(
  prepared: Pick<PreparedResponsesRequestContext, 'request'>,
): void {
  if (prepared.request.instructions !== undefined)
    prepared.request.instructions = '';
  if (prepared.request.tools !== undefined) prepared.request.tools = [];
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
  const signal = getRequestSignal(request);
  const reasoningIdTime =
    mode.reasoningIdTime ?? readRequestReasoningIdTime(request) ?? Date.now();
  const { stateful, skipRows, historyDangling } = await selectRowsStateful(
    request,
    deps,
    ephemerals,
    rows,
    mode,
  );
  const prepared = await buildResponsesRequestShell(request, deps, stateful);
  try {
    const native = rows.native !== undefined || rows.callerOwned === true;
    const prompt = native
      ? await prepareNativeResponsesPrompt(
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
        )
      : await serializeResponsesPromptEnvelope({
          model: prepared.request.model,
          instructions: prepared.request.instructions,
          tools: prepared.request.tools,
          contents: resolveRowsMedia(
            countedRows(rows, signal, skipRows),
            {
              requestId: request.mediaRequestId,
              aggregateBudgetBytes: request.mediaBudgetBytes,
              resolver: request.mediaResolver,
            },
            prepared.mediaRequest,
            signal,
          ),
          ...(historyDangling === undefined ? {} : { historyDangling }),
          ...('input' in overrides
            ? { inputOverride: { value: overrides['input'] } }
            : {}),
          ...statefulAccounting(rows, stateful, signal, skipRows),
          context: responsesInputContext(
            request,
            deps,
            stateful.parentId !== undefined,
            reasoningIdTime,
          ),
          signal,
        });
    prepared.mediaRequest.registerCleanup(() => prompt.dispose());
    if (!native) clearDiskPromptKeys(prepared);
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

function estimationProjectionOf(
  prompt: ResponsesSourcePrompt,
): PromptEnvelopeEstimationProjection {
  return {
    finalizedProjection: prompt.toEstimatorProjection(),
    legacyEstimate: pinnedSourceEstimatorOnly,
  };
}

/** Shares the retained, incremental and full-history prompts' ownership with the base prompt. */
function accountingOf(
  accounting: NonNullable<ResponsesSourcePrompt['accounting']>,
): PromptEnvelopeAccountingProjection {
  return {
    statefulParentUsed: accounting.statefulParentUsed,
    ...(accounting.retainedBaselineTokens === undefined
      ? {}
      : { retainedBaselineTokens: accounting.retainedBaselineTokens }),
    ...(accounting.incremental === undefined
      ? {}
      : { incremental: estimationProjectionOf(accounting.incremental) }),
    ...(accounting.fullHistory === undefined
      ? {}
      : { fullHistory: estimationProjectionOf(accounting.fullHistory) }),
  };
}

/** The ledger holds one small line per placeholder-replaced media block. */
function unsupportedMediaOf(
  prompt: ResponsesSourcePrompt,
): readonly UnsupportedMediaEntry[] {
  const ledger = readFileSync(prompt.unsupportedMediaSource.path, 'utf8');
  return ledger === ''
    ? []
    : ledger
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line) as UnsupportedMediaEntry);
}

export function diskTextProjection(
  prepared: PreparedResponsesRequestContext,
  token: object,
  releaseIfUnsent: () => Promise<void>,
): PromptEnvelopeProjection {
  const prompt = prepared.sourcePrompt;
  if (prompt instanceof NativeResponsesPrompt)
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
  return {
    model: prompt.model,
    protocol: prompt.protocol,
    method: prompt.method,
    projectionRevision: prompt.projectionRevision,
    unsupportedMedia: unsupportedMediaOf(prompt),
    transportToken: token,
    ...estimationProjectionOf(prompt),
    ...(prompt.accounting === undefined
      ? {}
      : { accounting: accountingOf(prompt.accounting) }),
    releaseIfUnsent,
  };
}
