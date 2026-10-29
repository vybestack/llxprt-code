/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import {
  durableRowsOf,
  rejectedValue,
  rowsOf,
} from './chronology-rollback-test-helpers.js';
import { detachedRow } from './detached-rollback-test-helpers.js';
import type { IContent } from './IContent.js';

const shapes = [
  'same',
  'prefix',
  'empty',
  'middle',
  'chronology',
  'summary',
  'media',
] satisfies string[];
function replacement(shape: string, rows: readonly IContent[]): IContent[] {
  if (shape === 'same') return [...rows];
  if (shape === 'empty') return [];
  if (shape === 'prefix' || shape === 'media') return rows.slice(0, 2);
  if (shape === 'summary')
    return [
      {
        ...detachedRow(5),
        blocks: [
          { type: 'text', text: '<state_snapshot>kept</state_snapshot>' },
        ],
        metadata: { ...detachedRow(5).metadata, isSummary: true },
      },
    ];
  return rows.map((row, index) => {
    if (index !== 2) return row;
    if (shape === 'chronology')
      return {
        ...row,
        metadata: {
          ...row.metadata,
          chronology: { seq: 99, userTurn: 2, step: 0, recordedAt: 0 },
        },
      };
    return { ...row, blocks: [{ type: 'text', text: 'changed' }] };
  });
}

describe('detached publication value shapes', () => {
  for (const shape of shapes) {
    it(`persists the complete ${shape} replacement`, async () => {
      await withNativeDetachedFixture(async ({ history, recording }) => {
        const rows = Array.from({ length: 4 }, (_, index) =>
          detachedRow(index, 16),
        );
        if (shape === 'media')
          rows[1] = {
            ...rows[1],
            blocks: [
              {
                type: 'media',
                encoding: 'base64',
                mimeType: 'image/png',
                data: 'aGVsbG8=',
                caption: 'kept picture',
              },
            ],
          };
        await history.detachedValues.replace(rows);
        const next = replacement(shape, rows);
        await history.detachedValues.replace(next);
        expect(await rowsOf(history)).toStrictEqual(next);
        await history.waitForCommit();
        expect(await durableRowsOf(recording)).toStrictEqual(next);
      });
    });
  }
  for (const stage of ['records', 'trailer'] satisfies Array<
    'records' | 'trailer'
  >) {
    it(`preserves previous values when ${stage} publication fails`, async () => {
      await withNativeDetachedFixture(async ({ history, recording, io }) => {
        const rows = Array.from({ length: 4 }, (_, index) =>
          detachedRow(index, 16),
        );
        await history.detachedValues.replace(rows);
        const failure = new Error(`${stage} publication failed`);
        io.rejectNextWrite(failure, stage);
        expect(
          await rejectedValue(
            history.detachedValues.replace(replacement('middle', rows)),
          ),
        ).toBe(failure);
        expect(await rowsOf(history)).toStrictEqual(rows);
        await history.waitForCommit();
        expect(await durableRowsOf(recording)).toStrictEqual(rows);
      });
    });
  }
});
