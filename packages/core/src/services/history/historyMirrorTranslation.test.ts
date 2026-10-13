/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { SessionEventType } from '../../recording/types.js';
import type { IContent } from './IContent.js';
import { envelopeToEvent } from './historyJournalFold.js';
import type { ScannedJournalRecord } from './historyJournalRecordScan.js';
import { planMirrors, type MirrorPlan } from './historyMirrorTranslation.js';
import { SharedRowIndex } from './historySharedRowIndex.js';

function row(seq: number, text = `row-${seq}`): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { chronology: { seq, userTurn: 0, step: 0, recordedAt: 0 } },
  };
}

const MIRRORS = ['A', 'B'];

describe('what each mirror needs for a shared record', () => {
  let index: SharedRowIndex;
  let offset: number;
  let seq: number;

  beforeEach(() => {
    index = new SharedRowIndex();
    offset = 0;
    seq = 0;
  });
  afterEach(() => index.close());

  function record(type: SessionEventType, payload: unknown) {
    const raw = Buffer.from(
      `${JSON.stringify({ v: 2, seq: ++seq, type, payload })}\n`,
    );
    const scanned: ScannedJournalRecord = {
      start: offset,
      end: offset + raw.length,
      raw,
      seq,
      type,
      payload,
    };
    offset = scanned.end;
    return scanned;
  }

  function append(rowSeq: number, owner: string): void {
    index.fold(
      record('content', { content: row(rowSeq), origin: owner }),
      owner,
    );
  }

  /** The plans for a record, made before it folds, which it then does. */
  function plans(
    type: SessionEventType,
    payload: unknown,
    owner?: string,
  ): Record<string, MirrorPlan> {
    const scanned = record(type, payload);
    const event = envelopeToEvent(type, payload);
    if (event === null) throw new Error('record has no fold event');
    const planned = planMirrors({
      index,
      mirrors: MIRRORS,
      record: scanned,
      event,
      owner,
    });
    index.fold(scanned, owner);
    return Object.fromEntries(planned);
  }

  it('trims a rewind by the rows each mirror held in the removed tail', () => {
    append(1, 'A');
    append(2, 'B');
    append(3, 'A');
    expect(plans('rewind', { itemsRemoved: 2, cutSeq: 2 })).toStrictEqual({
      A: { kind: 'trim', heldBefore: 2 },
      B: { kind: 'trim', heldBefore: 1 },
    });
  });

  it('keeps a compression for the mirrors that take the summary', () => {
    append(1, 'A');
    append(2, 'B');
    const payload = { summary: row(9), itemsCompressed: 2, origin: 'A' };
    const planned = plans('compressed', payload, 'A');
    expect(planned.A).toMatchObject({ kind: 'write' });
    expect(planned.B).toStrictEqual({ kind: 'trim', heldBefore: 1 });
  });

  it('appends a compression summary to a mirror that held nothing', () => {
    append(1, 'B');
    const planned = plans(
      'compressed',
      { summary: row(9), itemsCompressed: 1, origin: 'A' },
      'A',
    );
    expect(planned.A).toStrictEqual({ kind: 'rebuild', heldBefore: 0 });
    expect(planned.B).toStrictEqual({ kind: 'trim', heldBefore: 1 });
  });

  it('rebuilds the mirrors that take a purge and trims the rest', () => {
    append(1, 'A');
    append(2, 'B');
    const planned = plans(
      'semantic_media_purge',
      {
        history: [row(5), row(6)],
        frontier: { contentIndex: 0, blockIndex: 0 },
        origin: 'B',
      },
      'B',
    );
    expect(planned.A).toStrictEqual({ kind: 'trim', heldBefore: 1 });
    expect(planned.B).toStrictEqual({ kind: 'rebuild', heldBefore: 1 });
  });

  it('sends a density pass only the rows each mirror holds', () => {
    append(1, 'A');
    append(2, 'B');
    const planned = plans('density_mutation', {
      removedSeqs: [2],
      replacements: [{ replacedSeq: 1, replacement: row(1, 'short') }],
    });
    expect(planned.A).toMatchObject({
      kind: 'write',
      write: {
        type: 'density_mutation',
        payload: { removedSeqs: [], replacements: [{ replacedSeq: 1 }] },
      },
    });
    expect(planned.B).toMatchObject({
      kind: 'write',
      write: { payload: { removedSeqs: [2], replacements: [] } },
    });
  });

  it('removes a replaced row from a mirror the replacement does not belong to, and rebuilds the one it does', () => {
    append(1, 'A');
    append(2, 'B');
    const planned = plans(
      'density_mutation',
      {
        removedSeqs: [],
        replacements: [{ replacedSeq: 2, replacement: row(2, 'mine now') }],
        origin: 'A',
      },
      'A',
    );
    expect(planned.A).toStrictEqual({ kind: 'rebuild', heldBefore: 1 });
    expect(planned.B).toMatchObject({
      kind: 'write',
      write: { payload: { removedSeqs: [2], replacements: [] } },
    });
  });

  it('leaves a mirror alone when a density pass touches none of its rows', () => {
    append(1, 'A');
    append(2, 'A');
    expect(
      plans('density_mutation', { removedSeqs: [2], replacements: [] }).B,
    ).toStrictEqual({ kind: 'none' });
  });

  it('places an insert after the last row the mirror holds before its anchor', () => {
    append(1, 'A');
    append(2, 'B');
    append(3, 'A');
    const planned = plans(
      'synthetic_insert',
      { content: row(9), chronologySeq: 9, afterSeq: 2, origin: 'A' },
      'A',
    );
    expect(planned.A).toMatchObject({
      kind: 'write',
      write: { type: 'synthetic_insert', payload: { afterSeq: 1 } },
    });
    expect(planned.B).toStrictEqual({ kind: 'none' });
  });

  it('appends an insert that lands at the tail of the mirror', () => {
    append(1, 'A');
    append(2, 'B');
    const planned = plans(
      'synthetic_insert',
      { content: row(9), chronologySeq: 9, afterSeq: 2 },
      undefined,
    );
    expect(planned.B).toStrictEqual({ kind: 'appendRow', position: 2 });
    expect(planned.A).toStrictEqual({ kind: 'none' });
  });

  it('rebuilds a mirror whose insert has no row before it to anchor to', () => {
    append(1, 'B');
    append(2, 'A');
    const planned = plans(
      'synthetic_insert',
      { content: row(9), chronologySeq: 9, afterSeq: 1, origin: 'A' },
      'A',
    );
    expect(planned.A).toStrictEqual({ kind: 'rebuild', heldBefore: 1 });
  });

  it('does nothing for an insert whose anchor is not in the history', () => {
    append(1, 'A');
    expect(
      plans('synthetic_insert', {
        content: row(9),
        chronologySeq: 9,
        afterSeq: 77,
      }),
    ).toStrictEqual({ A: { kind: 'none' }, B: { kind: 'none' } });
  });

  it('renumbers a rebinding to the position of the row in the mirror', () => {
    append(1, 'A');
    append(2, 'B');
    append(3, 'A');
    const planned = plans('chronology_bind', {
      rowIndex: 2,
      chronology: { seq: 3, userTurn: 1, step: 1, recordedAt: 4 },
    });
    expect(planned.A).toMatchObject({
      kind: 'write',
      write: { type: 'chronology_bind', payload: { rowIndex: 1 } },
    });
    expect(planned.B).toStrictEqual({ kind: 'none' });
  });
});
