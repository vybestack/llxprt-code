/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ResponseArrival } from '@vybestack/llxprt-code-core/services/history/history-response-arrival.js';
import type { StreamProcessorRuntime } from './chatSessionPorts.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { openResponseArrival } from './responseArrival.js';

class ResponseTransportStream implements AsyncIterableIterator<IContent> {
  constructor(
    private readonly source: AsyncIterableIterator<IContent>,
    readonly arrival: ResponseArrival,
  ) {}

  next(...args: [] | [unknown]): Promise<IteratorResult<IContent>> {
    return this.source.next(...args);
  }

  async return(value?: unknown): Promise<IteratorResult<IContent>> {
    return (await this.source.return?.(value)) ?? { done: true, value };
  }

  async throw(error: unknown): Promise<IteratorResult<IContent>> {
    if (this.source.throw !== undefined) return this.source.throw(error);
    throw error;
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<IContent> {
    return this;
  }
}

export function sourceResponseArrival(
  source: AsyncIterable<IContent>,
): ResponseArrival | undefined {
  return source instanceof ResponseTransportStream ? source.arrival : undefined;
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
    return new ResponseTransportStream(stream, arrival);
  } catch (error) {
    await arrival.interrupt('error');
    throw error;
  }
}
