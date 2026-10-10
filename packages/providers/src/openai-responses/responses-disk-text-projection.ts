/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import { requireAssembledSystemInstruction } from '../utils/systemPromptPlacement.js';
import { finishMediaRequest } from '../utils/request-media-resolution.js';
import { serializeResponsesPromptEnvelope } from '../runtime/responses-source-serializer.js';
import { isSanctionedOpenAIO200kModel } from '../openai/openaiModelPolicy.js';
import {
  responsesInputContext,
  resolveInvocationEphemerals,
} from './responses-request-fields.js';
import { resolveResponsesRequestShape } from './openAIResponsesRequestState.js';
import {
  buildRequestContext,
  type PreparedResponsesRequestContext,
  type ResponsesExecutorDeps,
} from './openAIResponsesExecutor.js';

async function* textRows(
  rows: ProviderRequestRows,
  signal?: AbortSignal,
): AsyncGenerator<IContent, void> {
  let count = 0;
  for await (const row of rows.openReader(signal)) {
    signal?.throwIfAborted();
    if (
      (row.speaker !== 'human' && row.speaker !== 'ai') ||
      row.blocks.some((block) => block.type !== 'text') ||
      row.metadata?.responsesStored === true
    )
      throw new Error(
        'Explicit Responses disk text route requires stateless human/ai text rows',
      );
    count++;
    yield row;
  }
  if (count !== rows.count) throw new Error('Disk text row count changed');
}

export function assertDiskTextShape(
  options: NormalizedGenerateChatOptions,
  deps: ResponsesExecutorDeps,
): void {
  const ephemerals = resolveInvocationEphemerals(options);
  const shape = resolveResponsesRequestShape(
    options,
    [],
    ephemerals,
    deps,
    false,
  );
  if (shape.isCodex || deps.isWebSocketTransportActive?.() === true)
    throw new Error(
      'Explicit Responses disk text route does not support Codex or WebSocket',
    );
  const stateful =
    ephemerals['responses-stateful'] ??
    options.invocation.getModelBehavior('responses-stateful');
  const requestedStateful = stateful === true || stateful === 'true';
  const hasStoredParent =
    shape.explicitUserStore === true ||
    shape.requestOverrides['previous_response_id'] !== undefined;
  if (shape.stateful.enabled || requestedStateful || hasStoredParent)
    throw new Error(
      'Explicit Responses disk text route does not support stateful options',
    );
  for (const key of ['input', 'instructions', 'tools'])
    if (key in shape.requestOverrides)
      throw new Error(`Explicit disk text route cannot override ${key}`);
  if (
    ephemerals['dumpcontext'] !== undefined &&
    ephemerals['dumpcontext'] !== 'off'
  )
    throw new Error(
      'Explicit Responses disk text route does not support request dumps',
    );
  if (
    !isSanctionedOpenAIO200kModel(
      options.resolved.model || deps.getDefaultModel(),
    )
  )
    throw new Error(
      'Explicit Responses disk text route requires a pinned o200k model',
    );
}

export async function buildDiskTextResponsesContext(
  options: NormalizedGenerateChatOptions,
  deps: ResponsesExecutorDeps,
): Promise<PreparedResponsesRequestContext> {
  requireAssembledSystemInstruction(options.systemInstruction);
  assertDiskTextShape(options, deps);
  const rows = options.requestRows;
  if (rows === undefined || options.contentCount !== rows.count)
    throw new Error(
      'Explicit Responses disk text selection identity/count is required',
    );
  const ephemerals = resolveInvocationEphemerals(options);
  const prepared = await buildRequestContext(options, [], ephemerals, deps);
  try {
    const prompt = await serializeResponsesPromptEnvelope({
      model: prepared.request.model,
      instructions: prepared.request.instructions,
      tools: prepared.request.tools,
      contents: textRows(rows, getRequestSignal(options)),
      context: responsesInputContext(options, ephemerals, deps),
      signal: getRequestSignal(options),
    });
    prepared.mediaRequest.registerCleanup(() => prompt.dispose());
    if (prepared.request.instructions !== undefined)
      prepared.request.instructions = '';
    if (prepared.request.tools !== undefined) prepared.request.tools = [];
    return { ...prepared, sourcePrompt: prompt };
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
