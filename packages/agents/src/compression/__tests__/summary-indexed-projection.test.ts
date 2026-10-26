/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  NormalizedFamily,
  OccurrenceKind,
} from '@vybestack/llxprt-code-core/journal/idKeys.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { diskSummaryRequestSelection } from '../middleOutDiskPlan.js';
import { referenceSummaryRequest } from './summary-request-reference.js';
import { observeCompressionIndexRows } from './support/compression-index-observer.js';
import { journalSendFixture } from '../../../../providers/src/__tests__/support/journal-send-fixture.js';
import {
  rowsSelection,
  sendThroughRoute,
  WIRE_ROUTES,
} from '../../../../providers/src/__tests__/support/wireBodyCapture.js';

function row(at: number): IContent {
  return at % 2 === 0
    ? {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: `call_${at}`,
            name: 'read',
            parameters: { at },
          },
        ],
      }
    : {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: `call_${at - 1}`,
            toolName: 'read',
            result: `result ${at}`,
          },
        ],
      };
}

describe('indexed compression tool-text projection', () => {
  for (const route of WIRE_ROUTES) {
    it.each([256, 2048])(
      `${route.id} answers occurrence queries without decoding history at %i rows and preserves wire bytes`,
      async (size) => {
        const original = Array.from({ length: size }, (_, at) => row(at));
        const fixture = await journalSendFixture(original);
        let reads = 0;
        const ownership = new RowOwnership();
        const selection = diskSummaryRequestSelection(
          {
            length: fixture.selection.count,
            readRow: async (at) => {
              reads++;
              return fixture.selection.readAt(at);
            },
            [Symbol.asyncIterator]: () => fixture.selection.openReader(),
          },
          { top: 2, bottom: size - 2, injection: [] },
          'Summarize',
          [],
          ownership,
        );
        try {
          expect(fixture.selection.index).toBe(
            fixture.selection.native?.indexed,
          );
          expect(selection.callerOwned).toBeUndefined();
          expect(selection.index).toBeDefined();
          const queries: ReadonlyArray<
            readonly [NormalizedFamily, OccurrenceKind]
          > = [
            [1, 0],
            [1, 1],
            [2, 0],
            [2, 1],
          ];
          for (const [family, kind] of queries) {
            expect(
              await selection.index?.normalizedCount(family, kind, 'call_2'),
            ).toBe(0);
            expect(
              await selection.index?.normalizedPosition(
                family,
                kind,
                'call_2',
                1,
              ),
            ).toBeUndefined();
          }
          expect(reads).toBe(0);
          const history = {
            id: 'indexed-summary',
            description: 'tool text projection',
            rows: [],
          };
          const observed = observeCompressionIndexRows();
          try {
            const expected = await sendThroughRoute(
              route,
              history,
              'rows',
              undefined,
              rowsSelection(
                referenceSummaryRequest(original, 2, size - 2, 'Summarize', []),
              ),
            );
            const legacyRows = observed.state.rows;
            const minimumLegacyRows =
              route.id === 'openai-chat-plain' ? 0 : size - 1;
            expect(legacyRows).toBeGreaterThanOrEqual(minimumLegacyRows);
            observed.state.rows = 0;
            const actual = await sendThroughRoute(
              route,
              history,
              'rows',
              undefined,
              selection,
            );
            expect(actual.bytes).toStrictEqual(expected.bytes);
            expect(observed.state.rows).toBe(0);
            expect(ownership.snapshot().peakRows).toBe(1);
            expect(ownership.snapshot().liveRows).toBe(0);
          } finally {
            observed.restore();
          }
        } finally {
          await selection.close();
          await fixture.close();
        }
      },
      180000,
    );
  }
});
