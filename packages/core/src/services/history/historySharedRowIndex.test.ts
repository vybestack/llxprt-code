/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { SessionEventType } from '../../recording/types.js';
import type { IContent } from './IContent.js';
import type { ScannedJournalRecord } from './historyJournalRecordScan.js';
import { SharedRowIndex, mirrorHolds } from './historySharedRowIndex.js';

function row(seq: number, text = `row-${seq}`): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { chronology: { seq, userTurn: 0, step: 0, recordedAt: 0 } },
  };
}

/** Builds journal lines the way the recorder writes them, one after another. */
class Journal {
  private offset = 0;
  private seq = 0;

  record(type: SessionEventType, payload: unknown): ScannedJournalRecord {
    const raw = Buffer.from(
      `${JSON.stringify({ v: 2, seq: ++this.seq, type, payload })}\n`,
    );
    const record = {
      start: this.offset,
      end: this.offset + raw.length,
      raw,
      seq: this.seq,
      type,
      payload,
    };
    this.offset = record.end;
    return record;
  }
}

describe('shared row index', () => {
  let index: SharedRowIndex;
  let journal: Journal;

  beforeEach(() => {
    index = new SharedRowIndex();
    journal = new Journal();
  });
  afterEach(() => index.close());

  function add(
    seq: number,
    owner?: string,
    extra: Record<string, unknown> = {},
  ): void {
    index.fold(
      journal.record('content', {
        content: row(seq),
        ...(owner === undefined ? {} : { origin: owner }),
        ...extra,
      }),
      owner,
    );
  }

  function fold(
    type: SessionEventType,
    payload: unknown,
    owner?: string,
  ): void {
    index.fold(journal.record(type, payload), owner);
  }

  /** Every shared row as `seq:owner`, oldest first; `-` marks an unowned row. */
  function layout(): string[] {
    return Array.from(
      index.rows(),
      (entry) =>
        `${entry.chronologySeq}:${index.originOf(entry.origin) ?? '-'}`,
    );
  }

  it('records the owner of every row and counts what a mirror holds', () => {
    add(1);
    add(2, 'A');
    add(3, 'B');
    add(4, 'A');
    expect(layout()).toStrictEqual(['1:-', '2:A', '3:B', '4:A']);
    const counts = index.counts();
    expect(counts.heldBy(index.idOf('A'))).toBe(3);
    expect(counts.heldBy(index.idOf('B'))).toBe(2);
    expect(counts.heldBy(index.idOf('C'))).toBe(1);
  });

  it('keeps the owners of the rows a rewind leaves', () => {
    add(1, 'A');
    add(2, 'B');
    add(3, 'A');
    add(4, 'B');
    fold('rewind', { itemsRemoved: 2, cutSeq: 3 });
    expect(layout()).toStrictEqual(['1:A', '2:B']);
    expect(index.counts().heldBy(index.idOf('A'))).toBe(1);
  });

  it('gives an inserted repair row the owner of the row it follows when none is named', () => {
    add(1, 'A');
    add(2, 'B');
    fold('synthetic_insert', {
      content: row(9),
      chronologySeq: 9,
      afterSeq: 2,
    });
    fold(
      'synthetic_insert',
      { content: row(10), chronologySeq: 10, afterSeq: 1, origin: 'C' },
      'C',
    );
    expect(layout()).toStrictEqual(['1:A', '10:C', '2:B', '9:B']);
  });

  it('keeps the owner of a row a density pass rewrites in place', () => {
    add(1, 'A');
    add(2, 'B');
    add(3);
    fold('density_mutation', {
      removedSeqs: [],
      replacements: [{ replacedSeq: 2, replacement: row(2, 'shorter') }],
    });
    fold(
      'density_mutation',
      {
        removedSeqs: [3],
        replacements: [{ replacedSeq: 1, replacement: row(1, 'tiny') }],
        origin: 'C',
      },
      'C',
    );
    expect(layout()).toStrictEqual(['1:C', '2:B']);
  });

  it('keeps the owner of a rebound row', () => {
    add(1, 'A');
    add(2, 'B');
    fold('chronology_bind', {
      rowIndex: 1,
      content: row(2, 'bound'),
      chronology: { seq: 7, userTurn: 1, step: 1, recordedAt: 5 },
    });
    expect(layout()).toStrictEqual(['1:A', '7:B']);
  });

  it('gives rows of a compression or purge the owner of the record', () => {
    add(1, 'A');
    add(2, 'B');
    fold(
      'compressed',
      {
        summary: row(20, 'summary'),
        itemsCompressed: 2,
        origin: 'B',
      },
      'B',
    );
    expect(layout()).toStrictEqual(['20:B']);
    fold(
      'semantic_media_purge',
      {
        history: [row(30), row(31)],
        frontier: { contentIndex: 0, blockIndex: 0 },
        origin: 'A',
      },
      'A',
    );
    expect(layout()).toStrictEqual(['30:A', '31:A']);
  });

  it('lets rows of a replace transaction that names no owner keep the owners they replace', () => {
    add(1, 'A');
    add(2, 'B');
    add(3);
    fold('replace_begin', { txId: 'tx' });
    for (const seq of [1, 2, 3, 4])
      fold('content', { content: row(seq, `again-${seq}`), tx: 'tx' });
    fold('replace_commit', { txId: 'tx', rowCount: 4 });
    expect(layout()).toStrictEqual(['1:A', '2:B', '3:-', '4:-']);
  });

  it('gives every row of a replace transaction its writer when one is named', () => {
    add(1, 'A');
    add(2, 'B');
    fold('replace_begin', { txId: 'tx' }, 'C');
    for (const seq of [1, 2])
      fold('content', { content: row(seq), tx: 'tx', origin: 'C' }, 'C');
    fold('replace_commit', { txId: 'tx', rowCount: 2 }, 'C');
    expect(layout()).toStrictEqual(['1:C', '2:C']);
  });

  it('stays level with the journal after a transaction is abandoned', () => {
    add(1, 'A');
    fold('replace_begin', { txId: 'tx' });
    fold('content', { content: row(2), tx: 'tx' });
    add(3, 'B');
    expect(layout()).toStrictEqual(['1:A', '3:B']);
  });

  it('refuses every later record after a malformed one', () => {
    add(1, 'A');
    expect(() => fold('replace_commit', { txId: 'nope', rowCount: 0 })).toThrow(
      'without its begin',
    );
    expect(() => add(2, 'A')).toThrow('failed to fold an earlier record');
  });

  it('reports which mirrors hold a row', () => {
    expect(mirrorHolds(1, undefined)).toBe(true);
    expect(mirrorHolds(1, 1)).toBe(true);
    expect(mirrorHolds(1, 2)).toBe(false);
  });

  it('rejects an origin id it never issued', () => {
    expect(() => index.originOf(5)).toThrow('has no origin 5');
  });
});
