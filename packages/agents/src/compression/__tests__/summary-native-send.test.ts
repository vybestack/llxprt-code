/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { diskSummaryRequestSelection } from '../middleOutDiskPlan.js';
import { referenceSummaryRequest } from './summary-request-reference.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import { journalSendFixture } from '../../../../providers/src/__tests__/support/journal-send-fixture.js';
import {
  rowsSelection,
  sendThroughRoute,
  WIRE_ROUTES,
} from '../../../../providers/src/__tests__/support/wireBodyCapture.js';

function row(at: number): IContent {
  if (at % 4 === 1)
    return {
      speaker: 'ai',
      blocks: [
        {
          type: 'thinking',
          thought: 'consider',
          sourceField: 'reasoning_content',
        },
        {
          type: 'tool_call',
          id: `call_${at}`,
          name: 'read',
          parameters: { at },
        },
      ],
    };
  if (at % 4 === 2)
    return {
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
  return {
    speaker: at % 4 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `row 雪 ${at}` }],
  };
}

describe.each([65])('summary native send at %i rows', (count) => {
  for (const route of WIRE_ROUTES) {
    it.each(['none', 'allButLast', 'all'])(
      `${route.id} %s preserves bytes without creating files`,
      async (strip) => {
        const rows = Array.from({ length: count }, (_, at) => row(at));
        const fixture = await journalSendFixture(rows);
        const ownership = new RowOwnership();
        const selection = diskSummaryRequestSelection(
          {
            length: fixture.selection.count,
            readRow: (at) => fixture.selection.readAt(at),
            [Symbol.asyncIterator]: () => fixture.selection.openReader(),
          },
          { top: 0, bottom: fixture.selection.count, injection: [] },
          'Summarize',
          [],
          ownership,
        );
        const pinned: IContent[] = [];
        for await (const value of fixture.selection.openReader())
          pinned.push(value);
        const expectedRows = referenceSummaryRequest(
          pinned,
          0,
          pinned.length,
          'Summarize',
          [],
        );
        try {
          const history = {
            id: 'summary',
            description: 'sanitized summary',
            rows: [],
            ephemerals: {
              'reasoning.includeInContext': true,
              'reasoning.stripFromContext': strip,
            },
          };
          const expected = await sendThroughRoute(
            route,
            history,
            'rows',
            undefined,
            rowsSelection(expectedRows),
          );
          let actual: Uint8Array | undefined;
          const creates = await operationFileCreates(async () => {
            actual = (
              await sendThroughRoute(
                route,
                history,
                'rows',
                undefined,
                selection,
              )
            ).bytes;
          }, true);
          expect(creates).toStrictEqual({ files: [], directories: [] });
          expect(actual).toStrictEqual(expected.bytes);
          expect(ownership.snapshot().peakRows).toBeLessThanOrEqual(1);
          expect(ownership.snapshot().liveRows).toBe(0);
        } finally {
          await selection.close();
          await fixture.close();
        }
      },
      180000,
    );
  }
});
