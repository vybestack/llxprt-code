/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import {
  DiagnosticsCursorHistory,
  captureMixedDiagnostics,
  captureEagerDiagnostics,
  diagnosticsRow,
  expectedMixedSummary,
  providerDigest,
  useDiagnosticSink,
} from './provider-diagnostics-test-helpers.js';

describe('observable provider curation diagnostics', () => {
  const take = useDiagnosticSink();
  it.each([512, 8192])(
    'matches eager event names, counts, order and safe details for %i rows',
    async (size) => {
      const { actual, expected, oldEvents, newEvents } =
        await captureMixedDiagnostics(size, take);
      expect(actual).toBe(expected);
      expect(newEvents).toStrictEqual(oldEvents);
      expect(
        newEvents.filter((e) => e.message === 'Analyzing AI message:'),
      ).toHaveLength((size / 8) * 3);
      expect(
        newEvents.filter(
          (e) => e.message === 'EXCLUDED AI message - no valid content',
        ),
      ).toHaveLength(size / 8);
      const summaryIndex = newEvents.findIndex(
        (e) => e.message === '=== CURATED HISTORY SUMMARY ===',
      );
      expect(summaryIndex).toBe(size / 2);
      expect(newEvents[summaryIndex]?.args).toStrictEqual([
        expectedMixedSummary(size),
      ]);
      expect(
        newEvents.slice(summaryIndex + 1, -2).map((e) => e.message),
      ).toStrictEqual(
        Array.from(
          { length: size / 8 },
          () => 'Synthesizing missing tool_call for responses',
        ),
      );
      expect(newEvents[newEvents.length - 2]).toStrictEqual({
        level: 'warn',
        message: 'Tool response missing matching tool call',
        args: [{ callId: 'dangling', toolName: 'lost' }],
      });
      expect(newEvents[newEvents.length - 1]?.message).toBe(
        'Provider history normalization removed a cache anchor',
      );
      expect(newEvents[newEvents.length - 1]?.args).toStrictEqual([
        {
          inputAnchorIndexes: Array.from({ length: 32 }, (_, i) => i * 7 + 5),
          inputAnchorCount: size / 8,
          inputAnchorIndexesTruncated: true,
          inputContentCount: (size / 8) * 7 + 1,
          outputContentCount: size,
        },
      ]);
      expect(JSON.stringify(newEvents)).not.toContain('PRIVATE_RESULT');
      expect(JSON.stringify(newEvents)).not.toContain('aGVsbG8=');
    },
    120_000,
  );
});

describe('request override curation diagnostics', () => {
  const take = useDiagnosticSink();
  it.each([false, true])(
    'preserves override curation and compression diagnostics with compression %s',
    async (compressing) => {
      const eager = new HistoryService();
      const streamed = new DiagnosticsCursorHistory();
      const input = Array.from({ length: 16 }, (_, i) => diagnosticsRow(i));
      try {
        if (compressing) {
          eager.startCompression();
          streamed.startCompression();
        }
        take();
        const reference = captureEagerDiagnostics(input, take, compressing);
        const expected = await providerDigest(reference.rows);
        expect(
          await providerDigest(
            streamed.getCuratedForProviderStream([], undefined, input),
          ),
        ).toBe(expected);
        expect(take()).toStrictEqual(reference.events);
        expect(reference.events[0]?.message).toBe(
          compressing
            ? 'getCurated called during compression - returning snapshot'
            : 'Analyzing AI message:',
        );
      } finally {
        eager.dispose();
        streamed.dispose();
      }
    },
  );
});

describe('pre-output diagnostics', () => {
  const take = useDiagnosticSink();
  it('emits the complete eager event sequence before the first row and never repeats it on return', async () => {
    const eager = new HistoryService();
    const history = new DiagnosticsCursorHistory();
    const input = Array.from({ length: 16 }, (_, i) => diagnosticsRow(i));
    const cursor = history.getCuratedForProviderStream([], undefined, input);
    try {
      const reference = captureEagerDiagnostics(input, take);
      const first = await cursor.next();
      expect(first.done).toBe(false);
      expect(first.value).toStrictEqual(reference.rows[0]);
      expect(take()).toStrictEqual(reference.events);
      expect(reference.events[reference.events.length - 1]?.message).toBe(
        'Provider history normalization removed a cache anchor',
      );
      await cursor.return();
      expect(take()).toStrictEqual([]);
    } finally {
      await cursor.return();
      eager.dispose();
      history.dispose();
    }
  });
});
