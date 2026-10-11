/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { heapSize } from 'bun:jsc';
import { JournalResolver } from './journalResolver.js';
import { replaySession } from './ReplayEngine.js';
import { SessionRecordingService } from './SessionRecordingService.js';

const ROWS = 300;
const ROW_CHARS = 100_000;
const SAMPLE_EVERY = 25;
/** The journal holds ROWS * ROW_CHARS (30 MB) of text; streaming stays far below it. */
const GROWTH_BOUND_BYTES = 8 * 1024 * 1024;
const PROJECT_HASH = 'checkpoint-memory';

let root: string;
let recording: SessionRecordingService;

async function recordLargeSession(): Promise<string> {
  recording = new SessionRecordingService({
    sessionId: 'checkpoint-memory-session',
    projectHash: PROJECT_HASH,
    chatsDir: path.join(root, 'chats'),
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
  });
  for (let index = 0; index < ROWS; index += 1)
    recording.recordContent({
      speaker: 'human',
      blocks: [
        {
          type: 'text',
          text: `${String(index).padStart(6, '0')}${'x'.repeat(ROW_CHARS)}`,
        },
      ],
    });
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
  const resolve = JournalResolver.prototype.resolve;
  const watch = spyOn(JournalResolver.prototype, 'resolve').mockImplementation(
    async function* (this: JournalResolver) {
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
  } finally {
    watch.mockRestore();
  }
  expect(resolved).toBeGreaterThanOrEqual(ROWS);
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

  it('validates a large session row by row without retaining its history', async () => {
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
    const file = await recordLargeSession();
    const growth = await peakGrowth(async () => {
      const replay = await replaySession(file, PROJECT_HASH);
      if (!replay.ok) throw new Error(replay.error);
      expect(replay.history.length).toBe(ROWS);
    });
    expect(growth).toBeGreaterThanOrEqual(GROWTH_BOUND_BYTES);
  });

  it('still rejects a checkpoint when a row carries malformed media', async () => {
    await recordLargeSession();
    recording.recordContent({
      speaker: 'human',
      blocks: [
        { type: 'media', mimeType: 'image/png', encoding: 'base64' } as never,
      ],
    });
    await recording.flush();
    await expect(recording.createCheckpoint('bad-media')).rejects.toThrow(
      /Cannot create checkpoint: .*Malformed legacy inline media/s,
    );
  });
});
