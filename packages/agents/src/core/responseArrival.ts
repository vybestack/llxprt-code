/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import type { ResponseArrival } from '@vybestack/llxprt-code-core/services/history/history-response-arrival.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { resolveGeneratingModel } from './generatingModelResolver.js';
import { prependAsyncGenerator } from '@vybestack/llxprt-code-core/utils/asyncIterator.js';
import { EmptyStreamError } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import { filterHookRestrictedBlocks } from './hookToolRestrictions.js';

export async function prefetchResponseArrival(
  converted: AsyncGenerator<ModelStreamChunk>,
  arrival: ResponseArrival,
  includeThoughts: boolean,
): Promise<AsyncGenerator<ModelStreamChunk>> {
  try {
    const first = await converted.next();
    if (first.done === true)
      throw new EmptyStreamError(
        'Model stream ended immediately with no content.',
      );
    await appendResponseChunk(arrival, first.value, includeThoughts);
    markPrefetchedArrival(first.value);
    const stream = prependAsyncGenerator(first.value, converted);
    bindResponseArrival(stream, arrival);
    return stream;
  } catch (error) {
    await arrival.interrupt('error');
    throw error;
  }
}

export function appendResponseChunk(
  arrival: ResponseArrival,
  chunk: ModelStreamChunk,
  includeThoughts: boolean,
): void | Promise<void> {
  const id = chunk.content.responseAttemptId;
  if (id === undefined)
    return appendResponseChunkBlocks(arrival, chunk, includeThoughts);
  return arrival
    .selectAttempt(id)
    .then(() => appendResponseChunkBlocks(arrival, chunk, includeThoughts));
}
function appendResponseChunkBlocks(
  arrival: ResponseArrival,
  chunk: ModelStreamChunk,
  includeThoughts: boolean,
): void | Promise<void> {
  const allowed = chunk.hookRestrictions?.allowedToolNames;
  const blocks = filterHookRestrictedBlocks(chunk.content.blocks, allowed);
  const delta = chunk.content.toolArgumentDelta;
  if (
    delta === undefined ||
    (allowed !== undefined && !allowed.includes(delta.name))
  )
    return appendResponseBlocks(arrival, blocks, includeThoughts);
  return arrival.appendToolArguments(delta).then(() =>
    appendResponseBlocks(
      arrival,
      blocks.filter(
        (block) => block.type !== 'tool_call' || block.id !== delta.id,
      ),
      includeThoughts,
    ),
  );
}
export function appendResponseBlocks(
  arrival: ResponseArrival,
  blocks: ModelStreamChunk['content']['blocks'],
  includeThoughts: boolean,
  start = 0,
): void | Promise<void> {
  for (let index = start; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.type === 'thinking' && !includeThoughts) continue;
    const pending = arrival.append(block);
    if (pending !== undefined)
      return pending.then(() =>
        appendResponseBlocks(arrival, blocks, includeThoughts, index + 1),
      );
  }
}
const prefetched = new WeakSet<ModelStreamChunk>();
export function markPrefetchedArrival(chunk: ModelStreamChunk): void {
  prefetched.add(chunk);
}
export function takePrefetchedArrival(chunk: ModelStreamChunk): boolean {
  return prefetched.delete(chunk);
}
const arrivals = new WeakMap<
  AsyncGenerator<ModelStreamChunk>,
  ResponseArrival
>();
export function responseArrivalFor(
  stream: AsyncGenerator<ModelStreamChunk>,
): ResponseArrival | undefined {
  return arrivals.get(stream);
}
export function bindResponseArrival(
  stream: AsyncGenerator<ModelStreamChunk>,
  arrival: ResponseArrival,
): void {
  arrivals.set(stream, arrival);
}
export function openResponseArrival(
  history: HistoryService,
  runtime: AgentRuntimeContext,
  submissionId: string,
  turnId: string,
  origin?: object,
): Promise<ResponseArrival> {
  const id = randomUUID();
  return history.openResponseArrival(
    { id, submissionId },
    {
      id,
      turnId,
      model: resolveGeneratingModel(runtime),
      ...(runtime.state.baseUrl === undefined
        ? {}
        : { providerBaseURL: runtime.state.baseUrl }),
    },
    origin,
  );
}
