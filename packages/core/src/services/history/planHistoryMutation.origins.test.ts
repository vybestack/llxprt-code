/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import type { IContent } from './IContent.js';
import type { HistoryJournalOp } from './historyStorePort.js';
import { HistoryRowOrigins } from './historyRowOrigins.js';
import { planHistoryMutation } from './planHistoryMutation.js';

function row(text: string, seq: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { chronology: { seq, userTurn: 1, step: seq, recordedAt: 1 } },
  };
}

/** The origin each content op names, in order; undefined for an unowned row. */
function contentOrigins(ops: readonly HistoryJournalOp[]): unknown[] {
  return ops.flatMap((op) => (op.kind === 'content' ? [op.origin] : []));
}

const open: HistoryRowOrigins[] = [];

function originsOf(
  origins: ReadonlyArray<string | undefined>,
): HistoryRowOrigins {
  const captured = HistoryRowOrigins.capture({
    length: origins.length,
    originAt: (index) => origins[index],
  });
  open.push(captured);
  return captured;
}

describe('planHistoryMutation with the origins of the rows it writes', () => {
  afterEach(() => {
    for (const origins of open.splice(0)) origins.close();
  });

  it('writes a whole-history replacement row by row under each row origin', () => {
    const next = [row('a', 5), row('shared', 6), row('b', 7)];

    const ops = [
      ...planHistoryMutation(
        [row('old-1', 1), row('old-2', 2)],
        next,
        undefined,
        originsOf(['A', undefined, 'B']),
      ),
    ];

    expect(ops.map((op) => op.kind)).toStrictEqual([
      'replaceBegin',
      'content',
      'content',
      'content',
      'replaceCommit',
    ]);
    expect(contentOrigins(ops)).toStrictEqual(['A', undefined, 'B']);
  });

  it('writes an appended tail under the origins of the appended rows', () => {
    const ops = [
      ...planHistoryMutation(
        [row('kept', 1)],
        [row('kept', 1), row('tail-a', 2), row('tail-shared', 3)],
        undefined,
        originsOf([undefined, 'A', undefined]),
      ),
    ];

    expect(contentOrigins(ops)).toStrictEqual(['A', undefined]);
  });

  it('writes rows into an empty history under their origins', () => {
    const ops = [
      ...planHistoryMutation(
        [],
        [row('a', 1), row('shared', 2)],
        undefined,
        originsOf(['A', undefined]),
      ),
    ];

    expect(contentOrigins(ops)).toStrictEqual(['A', undefined]);
  });

  it('leaves rows unowned when no origins are given', () => {
    const ops = [
      ...planHistoryMutation(
        [row('old-1', 1), row('old-2', 2)],
        [row('a', 5), row('b', 6), row('c', 7)],
      ),
    ];

    expect(contentOrigins(ops)).toStrictEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});
