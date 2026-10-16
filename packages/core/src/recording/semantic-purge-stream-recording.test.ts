/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IContent } from '../services/history/IContent.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { replaySession } from './ReplayEngine.js';

function row(index: number, bytes = 2048): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `${index}:雪:${'x'.repeat(bytes)}` }],
  };
}
async function* rows(size: number, bytes = 2048): AsyncGenerator<IContent> {
  for (let index = 0; index < size; index++) yield row(index, bytes);
}
async function withRecording(
  action: (recording: SessionRecordingService) => Promise<void>,
  beforeAppend?: () => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'purge-stream-recording-'));
  let peakChunk = 0;
  const recording = new SessionRecordingService({
    sessionId: 'stream-recording',
    projectHash: 'stream-recording',
    chatsDir: directory,
    workspaceDirs: [],
    provider: 'test',
    model: 'test',
    io: {
      appendFile: async (file, text, encoding) => {
        peakChunk = Math.max(peakChunk, Buffer.byteLength(text));
        await beforeAppend?.();
        await appendFile(file, text, encoding);
      },
    },
  });
  try {
    await action(recording);
    expect(peakChunk).toBeLessThanOrEqual(256 * 1024);
  } finally {
    await recording.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}
const frontier = { contentIndex: 0, blockIndex: 0 };

describe('production streaming purge recording wire contract: persisted membership', () => {
  for (const size of [512, 8192]) {
    it(`writes one ${size}-row event with unchanged bytes and replay semantics`, async () => {
      await withRecording(async (recording) => {
        await recording.recordSemanticMediaPurgeRows(rows(size), frontier);
        const file = recording.getFilePath();
        if (!file) throw new Error('Missing journal');
        const lines = (await readFile(file, 'utf8')).trim().split('\n');
        expect(lines).toHaveLength(2);
        const parsed: unknown = JSON.parse(lines[1]);
        if (typeof parsed !== 'object' || parsed === null || !('ts' in parsed))
          throw new Error('Missing event envelope');
        const expected = JSON.stringify({
          v: 2,
          seq: 2,
          ts: parsed.ts,
          type: 'semantic_media_purge',
          payload: {
            history: Array.from({ length: size }, (_, index) => row(index)),
            frontier,
          },
        });
        expect(Buffer.from(lines[1]).equals(Buffer.from(expected))).toBe(true);
        const replay = await replaySession(file, 'stream-recording');
        if (!replay.ok) throw new Error(replay.error);
        expect(replay.history).toStrictEqual(
          Array.from({ length: size }, (_, index) => row(index)),
        );
        expect(replay.semanticMediaPurgeFrontier).toStrictEqual(frontier);
      });
    }, 120_000);
  }
});

describe('production streaming purge recording wire contract: does not admit a partially read source and preserves its failure object', () => {
  it('does not admit a partially read source and preserves its failure object', async () => {
    await withRecording(async (recording) => {
      const failure = new Error('source failed');
      async function* failing(): AsyncGenerator<IContent> {
        yield row(0);
        throw failure;
      }
      await expect(
        recording.recordSemanticMediaPurgeRows(failing(), frontier),
      ).rejects.toBe(failure);
      expect(recording.getFilePath()).toBeNull();
      await recording.recordSemanticMediaPurgeRows(rows(1), frontier);
      expect(recording.getPendingRecordCount()).toBe(0);
      const file = recording.getFilePath();
      if (!file) throw new Error('Missing journal');
      const replay = await replaySession(file, 'stream-recording');
      if (!replay.ok) throw new Error(replay.error);
      expect(replay.history).toStrictEqual([row(0)]);
    });
  });
});

describe('production streaming purge recording wire contract: poisons recording and preserves the physical writer failure without acknowledging a partial event', () => {
  it('poisons recording and preserves the physical writer failure without acknowledging a partial event', async () => {
    const failure = new Error('physical append failed');
    let appends = 0;
    await withRecording(
      async (recording) => {
        await expect(
          recording.recordSemanticMediaPurgeRows(rows(512), frontier),
        ).rejects.toBe(failure);
        expect(recording.isActive()).toBe(false);
        expect(recording.getPendingRecordCount()).toBe(0);
        await expect(
          recording.commit('content', { content: row(3) }),
        ).rejects.toBe(failure);
      },
      async () => {
        if (++appends === 3) throw failure;
      },
    );
  });
});

describe('production streaming purge recording wire contract: rejects disposal during staging without publishing a replacement', () => {
  it('rejects disposal during staging without publishing a replacement', async () => {
    await withRecording(async (recording) => {
      let release: () => void = () => undefined;
      let started: () => void = () => undefined;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      async function* source(): AsyncGenerator<IContent> {
        yield row(0);
        started();
        await gate;
        yield row(1);
      }
      const writing = recording.recordSemanticMediaPurgeRows(
        source(),
        frontier,
      );
      await ready;
      await recording.dispose();
      release();
      await expect(writing).rejects.toThrow('disposed');
      expect(recording.getFilePath()).toBeNull();
      expect(recording.getPendingRecordCount()).toBe(0);
    });
  });
});

describe('production streaming purge recording wire contract: rejects disposed recording before traversing the source', () => {
  it('rejects disposed recording before traversing the source', async () => {
    await withRecording(async (recording) => {
      await recording.dispose();
      let reads = 0;
      async function* source(): AsyncGenerator<IContent> {
        reads++;
        yield row(0);
      }
      await expect(
        recording.recordSemanticMediaPurgeRows(source(), frontier),
      ).rejects.toThrow('disposed');
      expect(reads).toBe(0);
    });
  });
});

describe('production streaming purge recording wire contract: accepts a row larger than 8 MiB without limiting its input and still appends bounded chunks', () => {
  it('accepts a row larger than 8 MiB without limiting its input and still appends bounded chunks', async () => {
    await withRecording(async (recording) => {
      const bytes = 8 * 1024 * 1024 + 1;
      await recording.recordSemanticMediaPurgeRows(rows(1, bytes), frontier);
      const file = recording.getFilePath();
      if (!file) throw new Error('Missing journal');
      const replay = await replaySession(file, 'stream-recording');
      if (!replay.ok) throw new Error(replay.error);
      expect(replay.history).toStrictEqual([row(0, bytes)]);
    });
  }, 120_000);
});
