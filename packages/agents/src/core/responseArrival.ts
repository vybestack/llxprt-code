/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import type {
  ResponseArrival,
  ResponseJournalIdentity,
} from '@vybestack/llxprt-code-core/services/history/history-response-arrival.js';
import type { ToolCallBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
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
  prepare?: (chunk: ModelStreamChunk) => Promise<{
    readonly historyChunk: ModelStreamChunk;
    readonly release: () => Promise<void>;
  }>,
): Promise<AsyncGenerator<ModelStreamChunk>> {
  const pending: PrefetchedArrival = {};
  try {
    const first = await converted.next();
    if (first.done === true)
      throw new EmptyStreamError(
        'Model stream ended immediately with no content.',
      );
    const prepared = await prepare?.(first.value);
    pending.historyChunk = prepared?.historyChunk ?? first.value;
    pending.release = prepared?.release;
    await appendResponseChunk(arrival, pending.historyChunk, includeThoughts);
    prefetched.set(first.value, pending);
    const stream = prependAsyncGenerator(first.value, converted);
    bindResponseArrival(stream, {
      get identity() {
        return arrival.identity;
      },
      selectAttempt: (id) => arrival.selectAttempt(id),
      appendToolArguments: (delta) => arrival.appendToolArguments(delta),
      replaceAfcHistory: (contents) => arrival.replaceAfcHistory(contents),
      append: (block) => arrival.append(block),
      seal: (...args) => arrival.seal(...args),
      interrupt: async (outcome) => {
        try {
          await arrival.interrupt(outcome);
        } finally {
          await pending.release?.();
          pending.historyChunk = undefined;
          pending.release = undefined;
        }
      },
    });
    return stream;
  } catch (error) {
    try {
      await arrival.interrupt('error');
    } finally {
      await pending.release?.();
    }
    throw error;
  }
}

export function appendResponseChunk(
  arrival: ResponseArrival,
  chunk: ModelStreamChunk,
  includeThoughts: boolean,
): void | Promise<void> {
  const id = chunk.content.responseAttemptId;
  const pending =
    id === undefined
      ? appendResponseChunkBlocks(arrival, chunk, includeThoughts)
      : arrival
          .selectAttempt(id)
          .then(() =>
            appendResponseChunkBlocks(arrival, chunk, includeThoughts),
          );
  if (pending !== undefined)
    return pending.then(() => bindToolIdentities(arrival, chunk));
  bindToolIdentities(arrival, chunk);
}

const toolIdentities = new WeakMap<ToolCallBlock, ResponseJournalIdentity>();

export function responseToolIdentity(
  block: ToolCallBlock,
): ResponseJournalIdentity | undefined {
  return toolIdentities.get(block);
}

function bindToolIdentities(
  arrival: ResponseArrival,
  chunk: ModelStreamChunk,
): void {
  for (const block of chunk.content.blocks)
    if (block.type === 'tool_call') toolIdentities.set(block, arrival.identity);
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
interface PrefetchedArrival {
  historyChunk?: ModelStreamChunk;
  release?: () => Promise<void>;
}
const prefetched = new WeakMap<ModelStreamChunk, PrefetchedArrival>();
export function takePrefetchedArrival(
  chunk: ModelStreamChunk,
): ModelStreamChunk | undefined {
  const pending = prefetched.get(chunk);
  prefetched.delete(chunk);
  const historyChunk = pending?.historyChunk;
  if (pending !== undefined) {
    pending.historyChunk = undefined;
    pending.release = undefined;
  }
  return historyChunk;
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
