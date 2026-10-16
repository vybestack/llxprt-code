/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  middleoutSetup,
  middleoutOracle,
  middleoutRow,
  MiddleoutDiskHistory,
} from './middleout-disk-helpers.js';
import { collectRows } from './truncation-stream-helpers.js';

function scenarioRow(size: number, mode: string, index: number): IContent {
  const base = middleoutRow(index, 64);
  const top = Math.ceil(size * 0.2);
  const bottom = Math.floor(size * 0.8);
  const lastPrompt = Math.floor(size * 0.65);
  if (index === top - 1 || index === bottom - 1)
    return {
      ...base,
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: `boundary-${index + 1}`,
          name: 'inspect',
          parameters: { index },
        },
      ],
    };
  if (index === top || index === bottom)
    return {
      ...base,
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: `boundary-${index}`,
          toolName: 'inspect',
          result: { boundary: index },
          isComplete: true,
        },
      ],
    };
  if (mode !== 'pair' && index === lastPrompt)
    return {
      ...base,
      speaker: 'human',
      blocks: [
        {
          type: 'text',
          text:
            `last-user-${mode}:` + 'request'.repeat(mode === 'large' ? 600 : 2),
        },
        {
          type: 'media',
          encoding: 'base64',
          mimeType: 'image/png',
          data: 'aGVsbG8=',
          caption: 'user attachment',
        },
      ],
    };
  return {
    ...base,
    speaker: mode === 'pair' || index < lastPrompt ? 'human' : 'ai',
    blocks: [
      {
        type: 'text',
        text:
          index === Math.floor(size / 2)
            ? '<state_snapshot>prior details</state_snapshot>'
            : `source-${index}`,
      },
    ],
  };
}
function stable(row: IContent): IContent {
  return row.metadata?.synthetic === true
    ? {
        ...row,
        metadata: { ...row.metadata, chronology: undefined, model: undefined },
      }
    : row;
}
async function compare(size: number, mode: string): Promise<number> {
  const makeRow = (index: number): IContent => scenarioRow(size, mode, index);
  return withSuffixFixture(
    size,
    async (history) => {
      if (mode === 'pair') history.setCacheAnchorSeq(Math.floor(size * 0.3));
      const expected = await middleoutOracle(history, size, 64, makeRow);
      const { handler, transport } = middleoutSetup(history);
      await handler.performCompression('split');
      const rows = await collectRows(history);
      expect(rows.map(stable)).toStrictEqual(expected.rows.map(stable));
      expect(transport.requests).toStrictEqual(expected.requests);
      expect(transport.requests[0]).toContain(
        'integrating still-relevant information',
      );
      return rows.length;
    },
    64,
    makeRow,
    undefined,
    (options) => new MiddleoutDiskHistory(options),
  );
}
const cases: Array<[number, string]> = [];
for (const size of [512, 8192])
  for (const mode of ['pair', 'small', 'large']) cases.push([size, mode]);
describe('disk middle-out split and last-user semantics', () => {
  it.each(cases)(
    'matches independent %i-row %s split, anchor floor and summary injections',
    async (size, mode) => {
      expect(await compare(size, mode)).toBeGreaterThan(0);
    },
    180_000,
  );
});
