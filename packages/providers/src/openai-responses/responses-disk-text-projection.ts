/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import { requireAssembledSystemInstruction } from '../utils/systemPromptPlacement.js';
import { finishMediaRequest } from '../utils/request-media-resolution.js';
import { serializeResponsesPromptEnvelope } from '../runtime/responses-source-serializer.js';
import {
  findDanglingCalls,
  type HistoryDangling,
} from '../runtime/responses-source-input.js';
import {
  responsesInputContext,
  resolveInvocationEphemerals,
} from './responses-request-fields.js';
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
  buildRequestContext,
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

/**
 * Selects the newest usable stored parent while streaming the rows once; only
 * that row's id and observed usage are retained, never the history.
 */
async function selectRowsStateful(
  options: NormalizedGenerateChatOptions,
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
    options,
    ephemerals,
    deps,
    mode.forceStateless,
    mode.forceParentless,
  );
  if (plan.kind === 'settled')
    return {
      stateful: { enabled: plan.enabled, parentId: undefined, content: [] },
      skipRows: 0,
    };
  let hit: StatefulParentHit | undefined;
  let index = 0;
  for await (const row of countedRows(rows, getRequestSignal(options))) {
    hit = parentHitOf(row, index++, plan) ?? hit;
  }
  // The array route patches synthetic outputs before choosing the parent, so
  // dangling calls on the parent row itself leave content after it.
  const calls =
    hit === undefined
      ? undefined
      : await findDanglingCalls(
          () => countedRows(rows, getRequestSignal(options)),
          getRequestSignal(options),
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
      content: [],
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

export function assertDiskTextShape(
  options: NormalizedGenerateChatOptions,
  deps: ResponsesExecutorDeps,
): Readonly<Record<string, unknown>> {
  return resolveResponsesRequestShape(
    options,
    [],
    resolveInvocationEphemerals(options),
    deps,
    false,
  ).requestOverrides;
}

/** A source token's stateful decision must still hold when it is sent. */
export function assertPreparedStatefulUnchanged(
  options: NormalizedGenerateChatOptions,
  deps: ResponsesExecutorDeps,
  prepared: PreparedResponsesRequestContext,
): void {
  const plan = resolveResponsesStatefulPlan(
    options,
    resolveInvocationEphemerals(options),
    deps,
    false,
    false,
  );
  if ((plan.kind === 'scan' || plan.enabled) !== prepared.statefulEnabled)
    throw new Error(
      'Explicit Responses disk text stateful options changed after the source token was prepared',
    );
}

export async function buildDiskTextResponsesContext(
  options: NormalizedGenerateChatOptions,
  deps: ResponsesExecutorDeps,
  mode: RebuildMode = { forceStateless: false, forceParentless: false },
): Promise<PreparedResponsesRequestContext> {
  requireAssembledSystemInstruction(options.systemInstruction);
  const overrides = assertDiskTextShape(options, deps);
  const rows = options.requestRows;
  if (rows === undefined || options.contentCount !== rows.count)
    throw new Error(
      'Explicit Responses disk text selection identity/count is required',
    );
  const ephemerals = resolveInvocationEphemerals(options);
  const signal = getRequestSignal(options);
  const { stateful, skipRows, historyDangling } = await selectRowsStateful(
    options,
    deps,
    ephemerals,
    rows,
    mode,
  );
  const prepared = await buildRequestContext(
    options,
    [],
    ephemerals,
    deps,
    mode.forceStateless,
    mode.forceParentless,
    stateful,
  );
  try {
    const prompt = await serializeResponsesPromptEnvelope({
      model: prepared.request.model,
      instructions: prepared.request.instructions,
      tools: prepared.request.tools,
      contents: countedRows(rows, signal, skipRows),
      ...(historyDangling === undefined ? {} : { historyDangling }),
      ...('input' in overrides
        ? { inputOverride: { value: overrides['input'] } }
        : {}),
      ...(stateful.parentId === undefined
        ? {}
        : {
            stateful: {
              statefulParentUsed: true,
              retainedBaselineTokens: stateful.parentRetainedTokens,
              incrementalContents: countedRows(rows, signal, skipRows),
              ...(stateful.parentRetainedTokens === undefined
                ? {
                    fullHistoryContents: estimationRows(
                      countedRows(rows, signal),
                    ),
                  }
                : {}),
            },
          }),
      context: responsesInputContext(options, ephemerals, deps),
      signal,
    });
    prepared.mediaRequest.registerCleanup(() => prompt.dispose());
    if (prepared.request.instructions !== undefined)
      prepared.request.instructions = '';
    if (prepared.request.tools !== undefined) prepared.request.tools = [];
    return {
      ...prepared,
      sourcePrompt: prompt,
      statefulEnabled: stateful.enabled,
      rebuildFromRows: (rebuild) =>
        buildDiskTextResponsesContext(options, deps, rebuild),
    };
  } catch (error) {
    return finishMediaRequest(prepared.mediaRequest, {
      status: 'failed',
      error,
    });
  }
}

export function diskTextProjection(
  prepared: PreparedResponsesRequestContext,
  token: object,
  releaseIfUnsent: () => Promise<void>,
): PromptEnvelopeProjection {
  const prompt = prepared.sourcePrompt;
  if (prompt === undefined) throw new Error('Missing disk text prompt');
  return {
    model: prompt.model,
    protocol: prompt.protocol,
    method: prompt.method,
    projectionRevision: prompt.projectionRevision,
    unsupportedMedia: [],
    transportToken: token,
    finalizedProjection: prompt.toEstimatorProjection(),
    legacyEstimate: () =>
      Promise.reject(
        new Error('Disk text projection requires the pinned source estimator'),
      ),
    releaseIfUnsent,
  };
}
