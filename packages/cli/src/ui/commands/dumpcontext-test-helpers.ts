/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  HistoryDumpSnapshot,
  ChronologyTraceEntry,
} from '@vybestack/llxprt-code-core';
import type {
  dumpRequestContext,
  dumpRequestContextStream,
} from '@vybestack/llxprt-code-providers';
import { streamPrettyJson } from '@vybestack/llxprt-code-providers';
import { inMemoryRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';

interface FixtureHistory {
  streamRawHistory(): AsyncIterable<IContent>;
  getChronologyTrace(): AsyncIterable<ChronologyTraceEntry>;
}

export async function* fixtureRows(
  rows: readonly IContent[],
): AsyncGenerator<IContent, void, unknown> {
  yield* rows;
}

export async function snapshotFixture(
  this: FixtureHistory,
): Promise<HistoryDumpSnapshot> {
  const rows: IContent[] = [];
  for await (const row of this.streamRawHistory()) rows.push(row);
  const trace = this.getChronologyTrace();
  return {
    callerOwnedRows: { ...inMemoryRequestSelection(rows), callerOwned: true },
    async *rows(): AsyncIterable<IContent> {
      yield* rows;
    },
    async *chronology(): AsyncIterable<ChronologyTraceEntry> {
      yield* trace;
    },
    async close(): Promise<void> {},
  };
}

export function captureStreamingDump(
  capture: typeof dumpRequestContext,
): typeof dumpRequestContextStream {
  return async (request, provider, baseId, chronology, options) => {
    let json = '';
    for await (const chunk of streamPrettyJson(request.body)) json += chunk;
    const body: unknown = JSON.parse(json);
    const trace: ChronologyTraceEntry[] = [];
    if (chronology !== undefined)
      for await (const entry of chronology) trace.push(entry);
    return capture({ ...request, body }, provider, baseId, trace, options);
  };
}
