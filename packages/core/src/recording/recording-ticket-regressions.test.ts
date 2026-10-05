/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRecordingService } from './SessionRecordingService.js';
import { batchGate } from '../services/history/addbatch-stream-test-helpers.js';
import {
  rollbackRow,
  durableRowsOf,
} from '../services/history/chronology-rollback-test-helpers.js';

async function withRecorder(
  execute: (
    recorder: SessionRecordingService,
    release: () => void,
    paused: Promise<void>,
  ) => Promise<void>,
): Promise<void> {
  const root = fs.mkdtempSync(join(tmpdir(), 'ticket-regression-'));
  const gate = batchGate();
  const paused = batchGate();
  const recorder = new SessionRecordingService({
    sessionId: 'ticket-regression',
    projectHash: 'ticket-regression',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
    maxQueueBytes: 0,
    io: {
      appendFile: async (path, data, encoding): Promise<void> => {
        paused.resolve();
        await gate.promise;
        await appendFile(path, data, encoding);
      },
    },
  });
  try {
    await execute(recorder, () => gate.resolve(), paused.promise);
  } finally {
    gate.resolve();
    await recorder.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function failWrite(position: number, failure: Error): () => void {
  const original = fs.writeSync;
  const write = spyOn(fs, 'writeSync');
  for (let index = 1; index < position; index++)
    write.mockImplementationOnce(original);
  write.mockImplementationOnce(() => {
    throw failure;
  });
  return () => write.mockRestore();
}

function submitRecord(
  recorder: SessionRecordingService,
  mode: 'enqueue' | 'commit',
):
  | ReturnType<SessionRecordingService['commit']>
  | ReturnType<SessionRecordingService['enqueue']> {
  return mode === 'commit'
    ? recorder.commit('content', { content: rollbackRow(0) })
    : recorder.enqueue('content', { content: rollbackRow(0) });
}

describe('recording ticket admission atomicity', () => {
  for (const mode of ['enqueue', 'commit'] as const) {
    for (const position of [1, 2, 3, 4]) {
      it(`${mode} preserves sequence and retries after staging write ${position} fails`, async () => {
        await withRecorder(async (recorder, release) => {
          const previous = 1;
          const failure = new Error('ticket staging failed');
          const restore = failWrite(position, failure);
          let actual: unknown;
          try {
            await submitRecord(recorder, mode);
          } catch (error) {
            actual = error;
          } finally {
            restore();
          }
          expect(actual).toBe(failure);
          expect(recorder.getLastEnqueuedSequence()).toBe(previous);
          const pending = recorder.commit('content', {
            content: rollbackRow(1),
          });
          release();
          const watermark = await pending;
          expect(watermark.seq).toBe(previous + 1);
          expect(await durableRowsOf(recorder)).toStrictEqual([rollbackRow(1)]);
          expect(recorder.getPendingRecordCount()).toBe(0);
          expect(recorder.getPendingByteCount()).toBe(0);
        });
      });
    }
  }
});

describe('single writer pump across backpressure and flush', () => {
  it('commits each complete row once when a waiting commit wakes before flush resumes', async () => {
    await withRecorder(async (recorder, release, paused) => {
      const first = recorder.commit('content', { content: rollbackRow(0) });
      await paused;
      const second = recorder.commit('content', { content: rollbackRow(1) });
      const flush = recorder.flush();
      release();
      const [a, b] = await Promise.all([first, second]);
      await flush;
      await recorder.flush();
      expect(b.seq).toBe(a.seq + 1);
      expect(b.byteOffset).toBeGreaterThan(a.byteOffset);
      expect(await durableRowsOf(recorder)).toStrictEqual([
        rollbackRow(0),
        rollbackRow(1),
      ]);
      const path = recorder.getFilePath();
      if (path === null) throw new Error('Missing durable file');
      expect(fs.statSync(path).size).toBe(b.byteOffset);
      expect(recorder.getPendingRecordCount()).toBe(0);
    });
  });
});

describe('pre-content ticket staging rollback', () => {
  it.each([1, 2, 3, 4, 5, 6])(
    'keeps buffered metadata once after write %i fails',
    async (position) => {
      await withRecorder(async (recorder, release) => {
        const metadata = recorder.enqueue('provider_switch', {
          provider: 'test2',
          model: 'test2',
        });
        if (metadata === null) throw new Error('Missing metadata');
        const before = 2;
        const failure = new Error('materialization staging failed');
        const restore = failWrite(position, failure);
        let actual: unknown;
        try {
          recorder.enqueue('content', { content: rollbackRow(0) });
        } catch (error) {
          actual = error;
        } finally {
          restore();
        }
        expect(actual).toBe(failure);
        expect(recorder.getPendingRecordCount()).toBe(before);
        expect(recorder.getLastEnqueuedSequence()).toBe(metadata.seq);
        const retry = recorder.commit('content', { content: rollbackRow(1) });
        release();
        const watermark = await retry;
        const path = recorder.getFilePath();
        if (path === null) throw new Error('Missing durable file');
        const lines: unknown[] = fs
          .readFileSync(path, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        expect(lines).toHaveLength(3);
        expect(lines[1]).toStrictEqual(metadata);
        expect(watermark.seq).toBe(metadata.seq + 1);
        expect(await durableRowsOf(recorder)).toStrictEqual([rollbackRow(1)]);
      });
    },
  );
});

describe('buffered metadata ticket atomicity', () => {
  it.each([1, 2])(
    'does not consume a sequence after buffered metadata write %i fails',
    async (position) => {
      await withRecorder(async (recorder, release) => {
        const before = 1;
        const count = 1;
        const failure = new Error('metadata ticket write failed');
        const restore = failWrite(position, failure);
        let actual: unknown;
        try {
          recorder.enqueue('provider_switch', {
            provider: 'test2',
            model: 'test2',
          });
        } catch (error) {
          actual = error;
        } finally {
          restore();
        }
        expect(actual).toBe(failure);
        expect(recorder.getLastEnqueuedSequence()).toBe(before);
        expect(recorder.getPendingRecordCount()).toBe(count);
        const retry = recorder.commit('content', { content: rollbackRow(1) });
        release();
        expect((await retry).seq).toBe(before + 1);
        expect(await durableRowsOf(recorder)).toStrictEqual([rollbackRow(1)]);
      });
    },
  );
});
