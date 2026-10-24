/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { heapSize } from 'bun:jsc';
import { JournalSession } from '../services/history/journalSession.js';
import type { IContent } from '../services/history/IContent.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { JournalResumeBoot, resumePointOf } from './journalResume.js';

const ROWS = 300;
const ROW_CHARS = 100_000;
const SAMPLE_EVERY = 25;
/** The journal holds ROWS * ROW_CHARS (30 MB) of text; streaming stays far below it. */
const GROWTH_BOUND_BYTES = 8 * 1024 * 1024;
const PROJECT_HASH = 'checkpoint-memory';

let root: string;
let recording: JournalRecordingService;

async function recordLargeSession(): Promise<string> {
  recording = JournalRecordingService.create({
    sessionId: 'checkpoint-memory-session',
    projectHash: PROJECT_HASH,
    chatsDir: path.join(root, 'chats'),
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
  });
  const session = await recording.session();
  for (let index = 0; index < ROWS; index += 1)
    await session.append([
      {
        speaker: 'human',
        blocks: [
          {
            type: 'text',
            text: `${String(index).padStart(6, '0')}${'x'.repeat(ROW_CHARS)}`,
          },
        ],
      },
    ]);
  await recording.flush();
  const file = recording.getFilePath();
  if (file === null) throw new Error('Missing session journal');
  return file;
}

/**
 * Peak settled heap growth while a resolver streams rows. Samples are taken
 * from inside the resolver iteration, so rows a consumer keeps alive count.
 */
async function peakGrowth(run: () => Promise<unknown>): Promise<number> {
  Bun.gc(true);
  const before = heapSize();
  let peak = before;
  let resolved = 0;
  const resolve = JournalSession.prototype.rows;
  const watch = spyOn(JournalSession.prototype, 'rows').mockImplementation(
    async function* (this: JournalSession) {
      for await (const entry of resolve.call(this)) {
        resolved += 1;
        if (resolved % SAMPLE_EVERY === 0) {
          Bun.gc(true);
          peak = Math.max(peak, heapSize());
        }
        yield entry;
      }
    },
  );
  try {
    await run();
    Bun.gc(true);
    peak = Math.max(peak, heapSize());
  } finally {
    watch.mockRestore();
  }
  expect(
    (await recording.session()).store.published?.rows,
  ).toBeGreaterThanOrEqual(ROWS);
  return peak - before;
}

describe('checkpoint creation memory', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-memory-'));
  });
  afterEach(async () => {
    await recording.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('checkpoints a large session without retaining its history', async () => {
    await recordLargeSession();
    let checkpoint: Awaited<ReturnType<typeof recording.createCheckpoint>>;
    const growth = await peakGrowth(async () => {
      checkpoint = await recording.createCheckpoint('large');
    });
    expect(checkpoint!.name).toBe('large');
    expect(checkpoint!.sequence).toBeGreaterThan(ROWS);
    expect(growth).toBeLessThan(GROWTH_BOUND_BYTES);
  });

  it('trap: eager replay of the same session exceeds the bound', async () => {
    await recordLargeSession();
    const growth = await peakGrowth(async () => {
      const session = await recording.session();
      const retained: IContent[] = [];
      for await (const row of session.rows()) retained.push(row.content);
      expect(retained.length).toBe(ROWS);
    });
    expect(growth).toBeGreaterThanOrEqual(GROWTH_BOUND_BYTES);
  });

  it('rejects malformed media when reading the checkpointed native version', async () => {
    await recordLargeSession();
    const malformed: IContent = {
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data: 'valid',
        },
      ],
    };
    Reflect.deleteProperty(malformed.blocks[0], 'data');
    await (await recording.session()).append([malformed]);
    await recording.createCheckpoint('bad-media');
    const boot = new JournalResumeBoot(
      recording,
      await resumePointOf(recording),
    );
    const failure = await (async () => {
      for await (const row of boot.streamRows()) void row;
    })().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) throw failure;
    expect(failure.message).toContain('Media reference validation failed');
    expect(failure.cause).toBeInstanceOf(Error);
    if (!(failure.cause instanceof Error)) throw failure.cause;
    expect(failure.cause.message).toContain('Malformed legacy inline media');
  });
});
