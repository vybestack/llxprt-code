/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRowCounters } from '../../recording/journalCounters.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { ResumeCursorBoot } from '../../recording/resumeCursorBoot.js';
import type { RecordingWriterObservation } from '../../recording/types.js';
import type { IContent } from './IContent.js';
import {
  persistResumeChronology,
  writeResumeProjection,
  type ResumeProjection,
} from './historyResumeProjection.js';
import { saveJournalSnapshot } from '../../storage/journal-persistence-snapshot.js';

const ROW_LIMIT = 440;
const BYTE_LIMIT = 8_388_608;
const directories: string[] = [];

function row(index: number): IContent {
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: index === 0 ? 'x'.repeat(4096) : 'small' }],
    metadata: {
      chronology: {
        seq: index + 2,
        userTurn: index + 1,
        step: 1,
        recordedAt: 1,
      },
    },
  };
}

async function sourceJournal(
  directory: string,
  count: number,
): Promise<string> {
  const filePath = path.join(directory, 'source.jsonl');
  const file = await fs.open(filePath, 'wx');
  try {
    await file.writeFile(
      `${JSON.stringify({ v: 1, seq: 1, type: 'session_start', payload: { sessionId: 'fixture', projectHash: 'fixture', startTime: new Date().toISOString(), provider: 'test', model: 'test' } })}\n`,
    );
    for (let index = 0; index < count; index += 1) {
      await file.writeFile(
        `${JSON.stringify({ v: 1, seq: index + 2, type: 'content', payload: { content: row(index) } })}\n`,
      );
    }
  } finally {
    await file.close();
  }
  return filePath;
}

interface Measurement {
  readonly count: number;
  readonly stage: string;
  readonly rows: number;
  readonly bytes: number;
  readonly peakRows: number;
  readonly peakBytes: number;
  readonly encodedBytes: number;
  readonly queuedStringBytes: number;
  readonly joinedBytes: number;
  readonly combinedBytes: number;
  readonly combinedObjects: number;
  readonly pending: number;
  readonly resolvedAndDecoded: boolean;
  readonly projectionOwner: boolean;
  readonly parsedAndOriginal: boolean;
  readonly decodedLive: number;
  readonly peakDecodedRows: number;
}

function deferred(): { promise: Promise<void>; release(): void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

class PauseFixture {
  readonly ownership = new RowOwnership();
  readonly read = createRowCounters();
  readonly samples: Measurement[] = [];
  private pending: RecordingWriterObservation | undefined;
  private encoded = '';
  private observedRow: IContent | undefined;
  private projectionRow: IContent | undefined;
  private originalContent: object | undefined;
  private parsedContent: object | undefined;
  private watchCommit = true;
  private released = 0;
  private stage = 'snapshot-write';
  private readonly counters = {
    ...this.read.counters,
    ownership: this.ownership,
    rowReleased: (): void => {
      this.released += 1;
      this.read.counters.rowReleased();
    },
  };

  constructor(
    readonly directory: string,
    readonly journal: string,
    readonly count: number,
  ) {}

  private sample(): Measurement {
    const rows = this.ownership.snapshot();
    const unique = new Set([
      ...(this.pending?.preContent ?? []),
      ...(this.pending?.queue ?? []),
      ...(this.pending?.batch ?? []),
    ]);
    const encodedBytes = Buffer.byteLength(this.encoded, 'utf8');
    const queuedStringBytes = [...unique].reduce(
      (sum, item) => sum + Buffer.byteLength(item.json, 'utf8'),
      0,
    );
    const joinedBytes =
      this.pending?.lines == null
        ? 0
        : Buffer.byteLength(this.pending.lines, 'utf8');
    const read = this.read.snapshot();
    const sample = {
      count: this.count,
      stage: this.stage,
      rows: rows.liveRows,
      bytes: rows.liveSerializedBytes,
      peakRows: rows.peakRows,
      peakBytes: rows.peakSerializedBytes,
      encodedBytes,
      queuedStringBytes,
      joinedBytes,
      combinedBytes:
        rows.liveSerializedBytes +
        encodedBytes +
        queuedStringBytes +
        joinedBytes,
      combinedObjects:
        rows.liveRows +
        unique.size * 2 +
        (encodedBytes > 0 ? 1 : 0) +
        (joinedBytes > 0 ? 1 : 0),
      pending: unique.size,
      resolvedAndDecoded: this.observedRow !== undefined && rows.liveRows >= 2,
      projectionOwner: this.projectionRow !== undefined && rows.liveRows > 0,
      parsedAndOriginal:
        this.parsedContent !== undefined &&
        this.originalContent !== undefined &&
        this.parsedContent !== this.originalContent,
      decodedLive: read.rowsDecoded - this.released,
      peakDecodedRows: read.peakDecodedRows,
    };
    this.samples.push(sample);
    assert.ok(rows.peakRows <= ROW_LIMIT);
    assert.ok(rows.peakSerializedBytes <= BYTE_LIMIT);
    return sample;
  }

  async save(): Promise<void> {
    const gate = deferred();
    const arrived = deferred();
    const target = path.join(this.directory, 'snapshot.json');
    const saving = saveJournalSnapshot(
      this.journal,
      target,
      {
        version: 1,
        sessionId: 'fixture',
        projectHash: 'fixture',
        createdAt: 'now',
        updatedAt: 'now',
        history: [],
      },
      {
        counters: this.counters,
        observeRow: (content, encoded) => {
          if (
            content.blocks[0]?.type === 'text' &&
            content.blocks[0].text.length === 4096
          ) {
            this.observedRow = content;
            this.encoded = encoded;
            arrived.release();
          }
        },
        writeFile: async (file, data) => {
          if (data === this.encoded) await gate.promise;
          await file.writeFile(data);
        },
      },
    );
    try {
      await arrived.promise;
      this.sample();
    } finally {
      gate.release();
    }
    await saving;
    this.encoded = '';
    this.observedRow = undefined;
    const parsed: unknown = JSON.parse(await fs.readFile(target, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || !('history' in parsed))
      throw new Error('Missing snapshot history');
    assert.ok(Array.isArray(parsed.history));
    assert.equal(parsed.history.length, this.count);
  }

  private async *projectedRows(): AsyncIterable<IContent> {
    for (let index = 0; index < this.count; index += 1) {
      const content =
        index === 0
          ? {
              ...row(index),
              blocks: [{ type: 'text' as const, text: 'y'.repeat(4096) }],
            }
          : row(index);
      this.ownership.retain(content);
      try {
        yield content;
      } finally {
        this.ownership.release(content);
      }
    }
  }

  async project(): Promise<ResumeProjection> {
    this.stage = 'projection-write';
    const gate = deferred();
    const arrived = deferred();
    const projecting = writeResumeProjection(
      this.projectedRows(),
      async () => {},
      {
        observeRow: (content, encoded) => {
          if (
            content.blocks[0]?.type === 'text' &&
            content.blocks[0].text.length === 4096
          ) {
            this.projectionRow = content;
            this.encoded = encoded;
            arrived.release();
          }
        },
        writeFile: async (file, data) => {
          if (data === this.encoded) await gate.promise;
          await file.writeFile(data);
        },
      },
    );
    try {
      await arrived.promise;
      this.sample();
    } finally {
      gate.release();
    }
    const projection = await projecting;
    this.encoded = '';
    this.projectionRow = undefined;
    return projection;
  }

  async persist(projection: ResumeProjection): Promise<void> {
    this.stage = 'commit-append';
    const stat = await fs.stat(this.journal);
    const boot = await ResumeCursorBoot.open(
      this.journal,
      this.count + 1,
      stat.size,
      this.counters,
    );
    const gate = deferred();
    const arrived = deferred();
    const recording = new SessionRecordingService({
      sessionId: crypto.randomUUID(),
      projectHash: 'fixture',
      chatsDir: this.directory,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      io: {
        appendFile: async (filePath, data) => {
          if (data.includes('chronology_bind')) {
            arrived.release();
            await gate.promise;
          }
          await fs.appendFile(filePath, data);
        },
      },
      observeWriter: (state) => {
        this.pending = state;
      },
    });
    const persisting = persistResumeChronology(projection, recording, boot, {
      observeCommit: (original, content) => {
        if (this.watchCommit) {
          this.originalContent = original.content;
          this.parsedContent = content;
        }
      },
    });
    try {
      await arrived.promise;
      assert.ok(this.originalContent !== undefined);
      assert.ok(this.parsedContent !== undefined);
      assert.notStrictEqual(this.parsedContent, this.originalContent);
      this.sample();
      assert.ok(this.pending !== undefined && this.pending.batch.length > 0);
      assert.equal(this.pending.lines?.includes('y'.repeat(4096)), true);
    } finally {
      this.watchCommit = false;
      this.originalContent = undefined;
      this.parsedContent = undefined;
      gate.release();
    }
    await persisting;
    await recording.dispose();
    await boot.close();
    await fs.rm(projection.directory, { recursive: true, force: true });
    this.stage = 'closed';
    const closed = this.sample();
    assert.equal(closed.rows, 0);
    assert.equal(closed.combinedBytes, 0);
    assert.equal(closed.combinedObjects, 0);
    assert.equal(closed.parsedAndOriginal, false);
    assert.equal(closed.decodedLive, 0);
    assert.equal(closed.pending, 0);
  }
}

async function measure(count: number): Promise<Measurement[]> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'peak-s-'));
  directories.push(directory);
  const journal = await sourceJournal(directory, count);
  const fixture = new PauseFixture(directory, journal, count);
  await fixture.save();
  const projection = await fixture.project();
  await fixture.persist(projection);
  return fixture.samples;
}

describe('controlled snapshot/projection pause S', () => {
  afterEach(async () => {
    for (const directory of directories.splice(0)) {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('compares same-size and 512-to-8192 no-compression write and commit pauses', async () => {
    const small = await measure(512);
    const repeat = await measure(512);
    const large = await measure(8192);
    for (const samples of [small, repeat, large]) {
      expect(samples.map((sample) => sample.stage)).toStrictEqual([
        'snapshot-write',
        'projection-write',
        'commit-append',
        'closed',
      ]);
      expect(samples[0].resolvedAndDecoded).toBe(true);
      expect(samples[0].encodedBytes).toBeGreaterThan(4096);
      expect(samples[1].projectionOwner).toBe(true);
      expect(samples[1].encodedBytes).toBeGreaterThan(4096);
      expect(samples[2].parsedAndOriginal).toBe(true);
      expect(samples[2].pending).toBeGreaterThan(0);
      expect(samples[2].joinedBytes).toBeGreaterThan(4096);
      for (const sample of samples) {
        expect(sample.rows).toBeLessThanOrEqual(ROW_LIMIT);
        expect(sample.bytes).toBeLessThanOrEqual(BYTE_LIMIT);
        expect(sample.combinedObjects).toBeLessThanOrEqual(ROW_LIMIT);
        expect(sample.combinedBytes).toBeLessThanOrEqual(BYTE_LIMIT);
      }
    }
    const charges = (samples: Measurement[]): number[] =>
      samples.map((sample) => sample.combinedBytes);
    expect(charges(repeat)).toStrictEqual(charges(small));
    expect(charges(large)).toStrictEqual(charges(small));
    if (process.env.P05D_PEAK_S_REPORT) {
      await fs.writeFile(
        process.env.P05D_PEAK_S_REPORT,
        JSON.stringify({ fixture: 'S', runs: [small, repeat, large] }, null, 2),
      );
    }
  }, 120_000);
});
