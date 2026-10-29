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
  type Diagnostic,
} from './__tests__/support/provider-diagnostics-test-helpers.js';

function expectedDiagnostics(
  size: number,
  pending = false,
  compressing = false,
): Diagnostic[] {
  const groups = size / 8;
  const events: Diagnostic[] = compressing
    ? [
        {
          level: 'debug',
          message: 'getCurated called during compression - returning snapshot',
        },
      ]
    : [];
  for (let group = 0; group < groups; group++) {
    for (const [index, type] of ['empty', 'tool_call', 'thinking'].entries()) {
      events.push({
        level: 'debug',
        message: 'Analyzing AI message:',
        args: [
          {
            messageIndex: group * 3 + index + 1,
            hasValidContent: type !== 'empty',
            blockCount: type === 'empty' ? 0 : 1,
            blocks:
              type === 'empty'
                ? []
                : [
                    {
                      type,
                      textLength: null,
                      textPreview: null,
                      isEmpty: false,
                    },
                  ],
            metadata: { hasUsage: false },
          },
        ],
      });
      if (type === 'empty')
        events.push({
          level: 'debug',
          message: 'EXCLUDED AI message - no valid content',
        });
    }
  }
  events.push({
    level: 'debug',
    message: '=== CURATED HISTORY SUMMARY ===',
    args: [{ ...expectedMixedSummary(size), isCompressing: compressing }],
  });
  for (let group = 0; group < groups; group++)
    events.push({
      level: 'warn',
      message: 'Synthesizing missing tool_call for responses',
      args: [{ callIds: [`orphan-${group}`], toolNames: ['lost'] }],
    });
  if (pending)
    events.push({
      level: 'warn',
      message: 'Tool response missing matching tool call',
      args: [{ callId: 'dangling', toolName: 'lost' }],
    });
  events.push({
    level: 'warn',
    message: 'Provider history normalization removed a cache anchor',
    args: [
      {
        inputAnchorIndexes: Array.from(
          { length: Math.min(32, groups) },
          (_, i) => i * 7 + 5,
        ),
        ...(groups > 32
          ? { inputAnchorCount: groups, inputAnchorIndexesTruncated: true }
          : {}),
        inputContentCount: groups * 7 + Number(pending),
        outputContentCount: size,
      },
    ],
  });
  return events;
}

describe('observable provider curation diagnostics', () => {
  const take = useDiagnosticSink();
  it.each([512, 8192])(
    'matches eager event names, counts, order and safe details for %i rows',
    async (size) => {
      const { actual, expected, newEvents } = await captureMixedDiagnostics(
        size,
        take,
      );
      expect(actual).toBe(expected);
      expect(newEvents).toStrictEqual(expectedDiagnostics(size, true));
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
        expect(take()).toStrictEqual(
          expectedDiagnostics(16, false, compressing),
        );
        expect(reference.events[0]?.message).toBe(
          compressing
            ? 'getCurated called during compression - returning snapshot'
            : 'Analyzing AI message:',
        );
      } finally {
        await eager.dispose();
        await streamed.dispose();
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
      expect(take()).toStrictEqual(expectedDiagnostics(16));
      expect(reference.events[reference.events.length - 1]?.message).toBe(
        'Provider history normalization removed a cache anchor',
      );
      await cursor.return();
      expect(take()).toStrictEqual([]);
    } finally {
      await cursor.return();
      await eager.dispose();
      await history.dispose();
    }
  });
});
