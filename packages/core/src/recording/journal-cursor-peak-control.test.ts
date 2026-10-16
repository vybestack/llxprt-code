/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { JournalCursor, MAX_RECORD_BYTES } from './journalCursor.js';
import { RowOwnership } from './rowOwnership.js';
import { createRowCounters } from './journalCounters.js';
import type { JournalPage } from './journalCursor.js';
import type { SessionRecordLine } from './types.js';
import type { IContent } from '../services/history/IContent.js';

const BYTE_LIMIT = 8_388_608;
const OBJECT_LIMIT = 440;
const TS = '2026-01-01T00:00:00.000Z';

interface PeakSample {
  readonly phase: 'serialized' | 'append' | 'parsed' | 'page-handoff';
  readonly registeredRows: number;
  readonly registeredBytes: number;
  readonly unregisteredObjects: number;
  readonly unregisteredObjectBytes: number;
  readonly encodedStrings: number;
  readonly encodedStringBytes: number;
  readonly bufferViews: number;
  readonly bufferViewBytes: number;
  readonly bufferCapacityBytes: number;
  readonly combinedLogicalBytes: number;
}

function sample(
  phase: PeakSample['phase'],
  ownership: RowOwnership,
  unregisteredObjectBytes = 0,
  unregisteredObjects = 0,
  encodedStringBytes = 0,
  buffer: Buffer | null = null,
): PeakSample {
  const registered = ownership.snapshot();
  return {
    phase,
    registeredRows: registered.liveRows,
    registeredBytes: registered.liveSerializedBytes,
    unregisteredObjects,
    unregisteredObjectBytes,
    encodedStrings: encodedStringBytes > 0 ? 1 : 0,
    encodedStringBytes,
    bufferViews: buffer === null ? 0 : 1,
    bufferViewBytes: buffer?.byteLength ?? 0,
    bufferCapacityBytes: buffer?.buffer.byteLength ?? 0,
    combinedLogicalBytes:
      registered.liveSerializedBytes +
      unregisteredObjectBytes +
      encodedStringBytes +
      (buffer?.buffer.byteLength ?? 0),
  };
}

function isContent(value: unknown): value is IContent {
  if (typeof value !== 'object' || value === null) return false;
  if (!('speaker' in value) || !('blocks' in value)) return false;
  if (!Array.isArray(value.blocks)) return false;
  return ['human', 'ai', 'tool'].includes(String(value.speaker));
}

function contentOf(envelope: SessionRecordLine | null): IContent {
  if (envelope?.type !== 'content') throw new Error('missing content envelope');
  const payload: unknown = envelope.payload;
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('content' in payload)
  ) {
    throw new Error('missing content payload');
  }
  if (!isContent(payload.content)) throw new Error('missing content row');
  return payload.content;
}

async function writeFixture(
  file: string,
  targetLineBytes: number,
  ownership: RowOwnership,
  samples: PeakSample[],
): Promise<{ lineBytes: number; textLength: number }> {
  const makeEnvelope = (text: string): SessionRecordLine => ({
    v: 1,
    seq: 1,
    ts: TS,
    type: 'content',
    payload: {
      content: { speaker: 'human', blocks: [{ type: 'text', text }] },
    },
  });
  const empty = JSON.stringify(makeEnvelope(''));
  const text = 'x'.repeat(targetLineBytes - Buffer.byteLength(empty) - 1);
  const envelope = makeEnvelope(text);
  const source = contentOf(envelope);
  ownership.retain(source);
  try {
    const line = `${JSON.stringify(envelope)}\n`;
    const lineBytes = Buffer.byteLength(line);
    const wrapperBytes =
      lineBytes - 1 - ownership.snapshot().liveSerializedBytes;
    samples.push(sample('serialized', ownership, wrapperBytes, 2, lineBytes));
    const encoded = Buffer.from(line, 'utf8');
    samples.push(
      sample('append', ownership, wrapperBytes, 2, lineBytes, encoded),
    );
    await fs.writeFile(file, encoded);
    return { lineBytes, textLength: text.length };
  } finally {
    ownership.release(source);
  }
}

async function openMeasuredCursor(
  file: string,
  counters: ReturnType<typeof createRowCounters>,
  ownership: RowOwnership,
  samples: PeakSample[],
  held: { parsed: IContent | null; handedOff: IContent | null },
): Promise<JournalCursor> {
  return JournalCursor.open(file, {
    counters: counters.counters,
    onParsedRecord: (decodedText, decodedEnvelope) => {
      held.parsed = contentOf(decodedEnvelope);
      ownership.retain(held.parsed);
      samples.push(
        sample(
          'parsed',
          ownership,
          Buffer.byteLength(decodedText) -
            1 -
            ownership.snapshot().liveSerializedBytes,
          2,
          Buffer.byteLength(decodedText),
        ),
      );
    },
    onPageHandoff: (page: JournalPage) => {
      const entry = page.entries[0];
      if (entry.kind !== 'content')
        throw new Error('cursor did not return content');
      held.handedOff = entry.content;
      ownership.retain(held.handedOff);
      samples.push(
        sample(
          'page-handoff',
          ownership,
          Buffer.byteLength(JSON.stringify(page)) -
            ownership.snapshot().liveSerializedBytes,
          5,
        ),
      );
      if (held.parsed === null || held.parsed !== held.handedOff) {
        throw new Error('parser and page did not share the row identity');
      }
      ownership.release(held.parsed);
      held.parsed = null;
    },
  });
}

function expectSamplePhases(samples: readonly PeakSample[]): void {
  expect(samples.map((point) => point.phase)).toStrictEqual([
    'serialized',
    'append',
    'parsed',
    'page-handoff',
  ]);
}

async function measure(targetLineBytes: number): Promise<{
  readonly samples: readonly PeakSample[];
  readonly lineBytes: number;
  readonly rowBytes: number;
  readonly peakCombinedLogicalBytes: number;
  readonly peakObservedObjects: number;
  readonly decodedRows: number;
  readonly peakDecodedRows: number;
  readonly accepted: boolean;
  readonly withinRowPredicate: boolean;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-peak-g-'));
  const file = path.join(dir, 'session-peak.jsonl');
  const ownership = new RowOwnership();
  const counters = createRowCounters();
  const samples: PeakSample[] = [];
  let cursor: JournalCursor | null = null;
  const held: { parsed: IContent | null; handedOff: IContent | null } = {
    parsed: null,
    handedOff: null,
  };
  try {
    const { lineBytes, textLength } = await writeFixture(
      file,
      targetLineBytes,
      ownership,
      samples,
    );

    cursor = await openMeasuredCursor(file, counters, ownership, samples, held);
    const page = await cursor.pageBack(1);
    const entry = page.entries[0];
    const accepted = entry.kind === 'content';
    expect(page.envelopes).toHaveLength(1);
    expect(page.envelopes[0].length).toBe(targetLineBytes);
    expect(cursor.metrics().maxAssembledRecordBytes).toBe(targetLineBytes);
    expect(accepted).toBe(true);
    if (entry.kind !== 'content')
      throw new Error('oversized valid row was skipped');
    expect(entry.content.blocks).toStrictEqual([
      { type: 'text', text: 'x'.repeat(textLength) },
    ]);
    expect(entry.length).toBe(targetLineBytes);
    expectSamplePhases(samples);
    expect(samples[2].registeredBytes).toBe(
      Buffer.byteLength(JSON.stringify(entry.content)),
    );
    expect(samples[3].registeredRows).toBe(1);
    expect(ownership.snapshot().liveRows).toBe(1);
    return {
      samples,
      lineBytes,
      rowBytes: Buffer.byteLength(JSON.stringify(entry.content)),
      peakCombinedLogicalBytes: Math.max(
        ...samples.map((point) => point.combinedLogicalBytes),
      ),
      peakObservedObjects: Math.max(
        ...samples.map(
          (point) =>
            point.registeredRows +
            point.unregisteredObjects +
            point.bufferViews,
        ),
      ),
      decodedRows: counters.snapshot().rowsDecoded,
      peakDecodedRows: counters.snapshot().peakDecodedRows,
      accepted,
      withinRowPredicate: ownership.within({
        rows: OBJECT_LIMIT,
        serializedBytes: BYTE_LIMIT,
      }),
    };
  } finally {
    if (held.parsed !== null) ownership.release(held.parsed);
    if (held.handedOff !== null) ownership.release(held.handedOff);
    await cursor?.close();
    expect(ownership.snapshot().liveRows).toBe(0);
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe('JournalCursor complete-record peak negative control', () => {
  it('accepts a complete 8 MiB+ line but rejects its live charge under the unchanged predicate', async () => {
    const control = await measure(4096);
    const oversized = await measure(BYTE_LIMIT + 1024);
    expect(control.lineBytes).toBe(4096);
    expect(oversized.lineBytes).toBe(BYTE_LIMIT + 1024);
    expect(oversized.lineBytes).toBeLessThan(MAX_RECORD_BYTES);
    expect(oversized.rowBytes).toBeGreaterThan(BYTE_LIMIT);
    expect(control.withinRowPredicate).toBe(true);
    expect(oversized.withinRowPredicate).toBe(false);
    expect(oversized.decodedRows).toBe(1);
    expect(oversized.peakDecodedRows).toBe(1);
    expect(oversized.samples[2].encodedStringBytes).toBe(oversized.lineBytes);
    expect(oversized.samples[1].bufferViewBytes).toBe(oversized.lineBytes);
    expect(oversized.samples[3].registeredBytes).toBe(oversized.rowBytes);
    expect(oversized.samples[3].registeredRows).toBe(1);
    expect(oversized.samples[3].unregisteredObjects).toBe(5);
    expect(
      oversized.samples[2].unregisteredObjectBytes + oversized.rowBytes,
    ).toBe(oversized.lineBytes - 1);
    expect(oversized.samples[1].bufferCapacityBytes).toBe(oversized.lineBytes);
    expect(oversized.samples[1].combinedLogicalBytes).toBeGreaterThan(
      BYTE_LIMIT,
    );
    expect(oversized.peakCombinedLogicalBytes).toBeGreaterThan(BYTE_LIMIT);
    expect(oversized.peakObservedObjects).toBeLessThanOrEqual(OBJECT_LIMIT);
    expect(control.peakCombinedLogicalBytes).toBeLessThan(BYTE_LIMIT);
    const evidencePath = process.env['LLXPRT_PEAK_EVIDENCE_PATH'];
    if (evidencePath !== undefined) {
      await fs.writeFile(
        evidencePath,
        JSON.stringify(
          {
            contract: { objects: OBJECT_LIMIT, logicalBytes: BYTE_LIMIT },
            scope: {
              rowPredicate:
                'existing RowOwnership.within; registered row identities only',
              combined:
                'simultaneous sampled logical UTF-8 charges; nested row payload deducted from envelope/page wrappers, independent encoded string and Buffer capacity charged once each',
              gaps: 'fixture writer, core cursor parse and page only; internal read chunks, decoder intermediate strings, parser scratch, filesystem copies, CLI pager, and JS/native allocation are not censused',
              outcome:
                'negative-control detector passes; accepted oversized record fails the intended product 8 MiB predicate',
            },
            control,
            oversized,
          },
          null,
          2,
        ),
      );
    }
  });
});
