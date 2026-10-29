/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ResponseArrival } from '@vybestack/llxprt-code-core/services/history/history-response-arrival.js';
import type { StreamProcessorRuntime } from './chatSessionPorts.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { openResponseArrival } from './responseArrival.js';

const sources = new WeakMap<AsyncIterable<IContent>, ResponseArrival>();
export function sourceResponseArrival(
  source: AsyncIterable<IContent>,
): ResponseArrival | undefined {
  return sources.get(source);
}
export function responseTransportAttempts(
  arrival: ResponseArrival,
): (boundary?: 'wrapper') => Promise<void> {
  let first = true;
  // Shared wrappers admit the first send; a concrete transport consumes that
  // admission and owns subsequent internal retries.
  let physicalPending = false;
  return async (boundary) => {
    if (boundary === undefined && physicalPending) {
      physicalPending = false;
      return;
    }
    physicalPending = boundary === 'wrapper';
    const id = first ? arrival.identity.attemptId : randomUUID();
    await arrival.selectAttempt(id, 'transport');
    first = false;
  };
}
export async function responseTransportSource(
  input: {
    readonly runtime: Pick<StreamProcessorRuntime, 'state' | 'provider'>;
    readonly history: HistoryService;
    readonly promptId: string;
    readonly userContent: IContent | IContent[];
    readonly recordingExecution?: { readonly historyOrigin?: object };
    readonly send?: unknown;
  },
  send: (
    onTransportAttempt: ((boundary?: 'wrapper') => Promise<void>) | undefined,
  ) => Promise<AsyncIterableIterator<IContent>>,
): Promise<AsyncIterableIterator<IContent>> {
  if (input.send !== undefined) return send(undefined);
  const contents = Array.isArray(input.userContent)
    ? input.userContent
    : [input.userContent];
  const turnId =
    contents.find((content) => content.metadata?.turnId !== undefined)?.metadata
      ?.turnId ?? input.promptId;
  const arrival = await openResponseArrival(
    input.history,
    input.runtime,
    input.promptId,
    turnId,
    input.recordingExecution?.historyOrigin,
  );
  try {
    const stream = await send(responseTransportAttempts(arrival));
    sources.set(stream, arrival);
    return stream;
  } catch (error) {
    await arrival.interrupt('error');
    throw error;
  }
}
