/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IContent } from '../services/history/IContent.js';
import { DurableFoldCheckpoint } from './durableFoldCheckpoint.js';
import {
  foldDurableRows,
  pinReadableFile,
  type DurableRowFold,
  type PinnedFile,
} from './durableRowFold.js';
import type { NumericRow } from './mutableRowDirectory.js';

const TAIL_DIGEST_BYTES = 4096;
/** Restore and save each read one tail window to prove the prefix is intact. */
const DIGEST_ALLOWANCE = 2 * TAIL_DIGEST_BYTES;

let root = '';
let scratch = '';
let journal = '';
function row(chron: number, speaker: IContent['speaker'] = 'human'): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text: `row-${chron}-${'x'.repeat(chron % 37)}` }],
    metadata: {
      chronology: { seq: chron, userTurn: chron, step: 0, recordedAt: chron },
    },
  };
}

/** Deterministic generator; the model tracks live chronology so events apply. */
class JournalWriter {
  private recordSeq = 0;
  private nextChron = 1;
  private live: number[] = [];
  private state: number;
  constructor(seed: number) {
    this.state = (seed >>> 0) + 1;
  }

  private random(limit: number): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state % limit;
  }

  private pick(): number | undefined {
    return this.live.length === 0
      ? undefined
      : this.live[this.random(this.live.length)];
  }

  private line(type: string, payload: unknown): string {
    this.recordSeq += 1;
    return `${JSON.stringify({ v: 2, seq: this.recordSeq, type, payload })}\n`;
  }

  private content(): string {
    const chron = this.nextChron++;
    this.live.push(chron);
    return this.line('content', { content: row(chron) });
  }

  private rewind(): string {
    const cut = this.pick();
    if (cut === undefined || this.random(3) === 0) {
      const removed = Math.min(this.live.length, 1 + this.random(3));
      this.live.length -= removed;
      return this.line('rewind', { itemsRemoved: removed });
    }
    const at = this.live.indexOf(cut);
    const removed = this.live.length - at;
    this.live.length = at;
    return this.line('rewind', { itemsRemoved: removed, cutSeq: cut });
  }

  private compressed(): string {
    const chron = this.nextChron++;
    const compressedCount = this.live.length;
    this.live = [chron];
    return this.line('compressed', {
      summary: row(chron, 'ai'),
      itemsCompressed: compressedCount,
    });
  }

  private density(): string {
    const removed = this.pick();
    const replaced = this.pick();
    const removedSeqs = removed === undefined ? [] : [removed];
    const replacements =
      replaced === undefined || replaced === removed
        ? []
        : [{ replacedSeq: replaced, replacement: row(replaced, 'ai') }];
    if (removed !== undefined) this.live.splice(this.live.indexOf(removed), 1);
    return this.line('density_mutation', { removedSeqs, replacements });
  }

  private synthetic(): string {
    const after = this.pick();
    const chron = this.nextChron++;
    if (after !== undefined)
      this.live.splice(this.live.indexOf(after) + 1, 0, chron);
    return this.line('synthetic_insert', {
      content: row(chron, 'tool'),
      chronologySeq: chron,
      afterSeq: after ?? 0,
    });
  }

  private purge(): string {
    const history = this.live.map((chron) => row(chron));
    return this.line('semantic_media_purge', {
      frontier: { contentIndex: 0, blockIndex: 0 },
      history,
    });
  }

  private bind(): string {
    const index = this.random(Math.max(1, this.live.length));
    const chron = this.nextChron++;
    if (index < this.live.length) this.live[index] = chron;
    return this.line('chronology_bind', {
      rowIndex: index,
      chronology: { seq: chron, userTurn: chron, step: 1, recordedAt: chron },
      invalidateResponses: this.random(2) === 0,
    });
  }

  /** Append `count` records and return the new journal size. */
  append(file: string, count: number): number {
    let text = '';
    for (let n = 0; n < count; n += 1) {
      const kind = this.random(20);
      if (kind < 9) text += this.content();
      else if (kind < 11) text += this.rewind();
      else if (kind < 12) text += this.compressed();
      else if (kind < 14) text += this.density();
      else if (kind < 16) text += this.synthetic();
      else if (kind < 17) text += this.purge();
      else if (kind < 18) text += this.bind();
      else
        text += this.line('compression_detail', {
          fromSeq: 1,
          toSeq: 2,
          itemsCompressed: 2,
        });
    }
    fs.appendFileSync(file, text);
    return fs.statSync(file).size;
  }
}

interface Counted {
  readonly pinned: PinnedFile;
  bytesRead(): number;
}

/** Counting IO seam: every journal byte the fold reads passes through here. */
function countingPin(file: string): Counted {
  const pinned = pinReadableFile(file);
  let bytes = 0;
  return {
    bytesRead: () => bytes,
    pinned: {
      ...pinned,
      handle: {
        ...pinned.handle,
        read: async (buffer, offset, length, position) => {
          const read = await pinned.handle.read(
            buffer,
            offset,
            length,
            position,
          );
          bytes += read;
          return read;
        },
      },
    },
  };
}

async function snapshotRows(
  fold: DurableRowFold,
): Promise<{ rows: NumericRow[]; contents: IContent[] }> {
  const rows: NumericRow[] = [];
  const contents: IContent[] = [];
  for (let index = 0; index < fold.length; index += 1) {
    rows.push(fold.rowAt(index));
    contents.push(await fold.readRow(index));
  }
  return { rows, contents };
}

async function foldAt(
  maxBytes: number,
  checkpoint?: DurableFoldCheckpoint,
): Promise<{
  rows: NumericRow[];
  contents: IContent[];
  bytesRead: number;
}> {
  const counted = countingPin(journal);
  const fold = await foldDurableRows({
    maxBytes,
    pinnedJournal: counted.pinned,
    scratchRoot: scratch,
    checkpoint,
  });
  const bytesRead = counted.bytesRead();
  try {
    return { ...(await snapshotRows(fold)), bytesRead };
  } finally {
    await fold.close();
  }
}

describe('durable fold checkpoint', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'durable-fold-checkpoint-'));
    scratch = path.join(root, 'scratch');
    fs.mkdirSync(scratch);
    journal = path.join(root, 'journal.jsonl');
    fs.writeFileSync(journal, '');
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('equals a full rescan at every watermark of generated journals', async () => {
    for (let seed = 1; seed <= 16; seed += 1) {
      fs.writeFileSync(journal, '');
      const writer = new JournalWriter(seed * 7919);
      const checkpoint = new DurableFoldCheckpoint();
      try {
        let size = 0;
        for (let send = 0; send < 12; send += 1) {
          size = writer.append(journal, 1 + (send % 5) * 6);
          const incremental = await foldAt(size, checkpoint);
          const fresh = await foldAt(size);
          expect(incremental.rows).toStrictEqual(fresh.rows);
          expect(incremental.contents).toStrictEqual(fresh.contents);
        }
      } finally {
        checkpoint.dispose();
      }
    }
    expect(fs.readdirSync(scratch)).toStrictEqual([]);
  }, 60_000);

  it('reads only the appended bytes plus the tail digest windows per send', async () => {
    const writer = new JournalWriter(42);
    const checkpoint = new DurableFoldCheckpoint();
    try {
      let previous = writer.append(journal, 400);
      await foldAt(previous, checkpoint);
      const fullScan = await foldAt(previous);
      expect(fullScan.bytesRead).toBe(previous);
      expect(previous).toBeGreaterThan(20 * TAIL_DIGEST_BYTES);
      for (let send = 0; send < 20; send += 1) {
        const size = writer.append(journal, 3);
        const incremental = await foldAt(size, checkpoint);
        expect(incremental.bytesRead).toBeLessThanOrEqual(
          size - previous + DIGEST_ALLOWANCE,
        );
        expect(incremental.bytesRead).toBeGreaterThanOrEqual(size - previous);
        const repeat = await foldAt(size, checkpoint);
        expect(repeat.bytesRead).toBeLessThanOrEqual(TAIL_DIGEST_BYTES);
        expect(repeat.rows).toStrictEqual(incremental.rows);
        previous = size;
      }
      const finalFresh = await foldAt(previous);
      expect(finalFresh.bytesRead).toBe(previous);
    } finally {
      checkpoint.dispose();
    }
  }, 60_000);

  it('does not apply a checkpoint newer than the requested watermark', async () => {
    const writer = new JournalWriter(5);
    const checkpoint = new DurableFoldCheckpoint();
    try {
      const early = writer.append(journal, 30);
      const late = writer.append(journal, 30);
      await foldAt(late, checkpoint);
      const older = await foldAt(early, checkpoint);
      const fresh = await foldAt(early);
      expect(older.rows).toStrictEqual(fresh.rows);
      expect(older.contents).toStrictEqual(fresh.contents);
      expect(older.bytesRead).toBe(early);
    } finally {
      checkpoint.dispose();
    }
  });

  it('rescans when the journal prefix changed under the same file', async () => {
    const checkpoint = new DurableFoldCheckpoint();
    try {
      const first = new JournalWriter(11).append(journal, 60);
      await foldAt(first, checkpoint);
      fs.truncateSync(journal, 0);
      const replacement = new JournalWriter(12);
      replacement.append(journal, 60);
      const size = replacement.append(journal, 60);
      expect(size).toBeGreaterThan(first);
      const incremental = await foldAt(size, checkpoint);
      const fresh = await foldAt(size);
      expect(incremental.rows).toStrictEqual(fresh.rows);
      expect(incremental.contents).toStrictEqual(fresh.contents);
      expect(incremental.bytesRead).toBeGreaterThanOrEqual(size);
    } finally {
      checkpoint.dispose();
    }
  });

  it('never checkpoints a watermark inside a record', async () => {
    const writer = new JournalWriter(3);
    const checkpoint = new DurableFoldCheckpoint();
    try {
      const size = writer.append(journal, 40);
      const inside = size - 7;
      await foldAt(inside, checkpoint);
      const full = await foldAt(size, checkpoint);
      const fresh = await foldAt(size);
      expect(full.rows).toStrictEqual(fresh.rows);
      // A full rescan (nothing was checkpointed) plus the boundary probe.
      expect(full.bytesRead).toBeGreaterThanOrEqual(size);
      expect(full.bytesRead).toBeLessThanOrEqual(size + TAIL_DIGEST_BYTES);
    } finally {
      checkpoint.dispose();
    }
  });

  it('releases scratch when the checkpoint is disposed', async () => {
    const writer = new JournalWriter(9);
    const checkpoint = new DurableFoldCheckpoint();
    const size = writer.append(journal, 40);
    await foldAt(size, checkpoint);
    expect(fs.readdirSync(scratch).length).toBeGreaterThan(0);
    checkpoint.dispose();
    expect(fs.readdirSync(scratch)).toStrictEqual([]);
    await foldAt(size, checkpoint);
    expect(fs.readdirSync(scratch)).toStrictEqual([]);
  });
});
