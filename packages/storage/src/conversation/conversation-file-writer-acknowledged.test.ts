/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { ConversationFileWriter } from './ConversationFileWriter.js';
import type { StorageLogger } from '../types/logger.js';

interface Fixture {
  readonly directory: string;
  readonly faultDirectory: string;
  readonly logFile: string;
  readonly writer: ConversationFileWriter;
}

async function withFixture(
  action: (fixture: Fixture) => Promise<void>,
  logger?: StorageLogger,
): Promise<void> {
  const directory = await fs.mkdtemp(join(tmpdir(), 'conversation-ack-'));
  const faultDirectory = join(directory, 'append-target-directory');
  await fs.mkdir(faultDirectory);
  const logFile = join(
    directory,
    `conversation-${new Date().toISOString().split('T')[0]}.jsonl`,
  );
  try {
    await action({
      directory,
      faultDirectory,
      logFile,
      writer: new ConversationFileWriter(directory, logger),
    });
  } finally {
    await fs.rm(directory, { recursive: true });
  }
}

function targetFile(writer: ConversationFileWriter, file: string): void {
  if (!Reflect.set(writer, 'currentLogFile', file)) {
    throw new Error('Cannot set owned append target');
  }
}

async function readEntries(file: string): Promise<unknown[]> {
  const text = await fs.readFile(file, 'utf8');
  return text
    .trim()
    .split('\n')
    .map((line): unknown => JSON.parse(line));
}

function latch(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function* rows(): AsyncGenerator<unknown> {
  yield { role: 'user', content: 'streamed request' };
  yield { role: 'assistant', content: 'streamed response' };
}

function recordingLogger(errors: unknown[], throws = false): StorageLogger {
  return {
    debug: () => {},
    warn: () => {},
    error: (_message, error) => {
      errors.push(error);
      if (throws) throw new Error('logger exploded');
    },
  };
}

describe('acknowledged append filesystem failures', () => {
  it('rejects with the logged EISDIR object and recovers on a distinct normal file', async () => {
    const errors: unknown[] = [];
    await withFixture(async ({ writer, faultDirectory, logFile }) => {
      targetFile(writer, faultDirectory);
      const result = await Promise.allSettled([
        writer.writeEntryAcknowledged({ type: 'failed-strict' }),
      ]);
      expect(result[0].status).toBe('rejected');
      if (result[0].status !== 'rejected')
        throw new Error('Append must reject');
      expect(result[0].reason).toMatchObject({
        code: 'EISDIR',
        path: faultDirectory,
      });
      expect(result[0].reason).toBe(errors[0]);
      expect(await fs.readdir(faultDirectory)).toStrictEqual([]);
      targetFile(writer, logFile);
      await writer.writeEntryAcknowledged({ type: 'recovered-strict' });
      expect(await readEntries(logFile)).toStrictEqual([
        { timestamp: expect.any(String), type: 'recovered-strict' },
      ]);
    }, recordingLogger(errors));
  });
});

describe('acknowledged append with a throwing logger', () => {
  it('preserves the original EISDIR rejection even when error logging throws', async () => {
    const errors: unknown[] = [];
    await withFixture(
      async ({ writer, faultDirectory, logFile }) => {
        targetFile(writer, faultDirectory);
        const result = await Promise.allSettled([
          writer.writeEntryAcknowledged({ type: 'failed-strict' }),
        ]);
        expect(result[0].status).toBe('rejected');
        if (result[0].status !== 'rejected')
          throw new Error('Append must reject');
        expect(result[0].reason).toMatchObject({
          code: 'EISDIR',
          path: faultDirectory,
        });
        expect(result[0].reason).toBe(errors[0]);
        targetFile(writer, logFile);
        await writer.writeEntryAcknowledged({ type: 'recovered-strict' });
        expect(await readEntries(logFile)).toStrictEqual([
          { timestamp: expect.any(String), type: 'recovered-strict' },
        ]);
      },
      recordingLogger(errors, true),
    );
  });
});

describe('eager append with a throwing logger', () => {
  it('resolves after EISDIR and logger failure then appends a later eager entry', async () => {
    const errors: unknown[] = [];
    await withFixture(
      async ({ writer, faultDirectory, logFile }) => {
        targetFile(writer, faultDirectory);
        await expect(
          writer.writeEntry({ type: 'failed-eager' }),
        ).resolves.toBeUndefined();
        expect(errors[0]).toMatchObject({
          code: 'EISDIR',
          path: faultDirectory,
        });
        targetFile(writer, logFile);
        await writer.writeEntry({ type: 'recovered-eager' });
        expect(await readEntries(logFile)).toStrictEqual([
          { timestamp: expect.any(String), type: 'recovered-eager' },
        ]);
      },
      recordingLogger(errors, true),
    );
  });
});

describe('concurrent strict and eager append failures', () => {
  it('returns independent EISDIR outcomes without poisoning subsequent concurrent appends', async () => {
    const errors: unknown[] = [];
    await withFixture(async ({ writer, faultDirectory, logFile }) => {
      targetFile(writer, faultDirectory);
      const result = await Promise.allSettled([
        writer.writeEntryAcknowledged({ type: 'strict-first' }),
        writer.writeEntry({ type: 'eager' }),
        writer.writeEntryAcknowledged({ type: 'strict-last' }),
      ]);
      expect(result).toStrictEqual([
        {
          status: 'rejected',
          reason: expect.objectContaining({ code: 'EISDIR' }),
        },
        { status: 'fulfilled', value: undefined },
        {
          status: 'rejected',
          reason: expect.objectContaining({ code: 'EISDIR' }),
        },
      ]);
      if (result[0].status !== 'rejected' || result[2].status !== 'rejected') {
        throw new Error('Both strict appends must reject');
      }
      expect(result[0].reason).toBe(errors[0]);
      expect(result[2].reason).toBe(errors[2]);
      expect(result[0].reason).not.toBe(result[2].reason);
      targetFile(writer, logFile);
      await Promise.all([
        writer.writeEntryAcknowledged({ type: 'strict-first' }),
        writer.writeEntry({ type: 'eager' }),
        writer.writeEntryAcknowledged({ type: 'strict-last' }),
      ]);
      expect(await readEntries(logFile)).toStrictEqual([
        { timestamp: expect.any(String), type: 'strict-first' },
        { timestamp: expect.any(String), type: 'eager' },
        { timestamp: expect.any(String), type: 'strict-last' },
      ]);
    }, recordingLogger(errors));
  });
});

describe('concurrent mixed append outcomes', () => {
  it('does not attribute serialization failures to adjacent successful strict or eager entries', async () => {
    await withFixture(async ({ writer, logFile }) => {
      const result = await Promise.allSettled([
        writer.writeEntryAcknowledged({ type: 'strict-first' }),
        writer.writeEntryAcknowledged({ type: 'bad-strict', value: 1n }),
        writer.writeEntry({ type: 'eager-middle' }),
        writer.writeEntry({ type: 'bad-eager', value: 2n }),
        writer.writeEntryAcknowledged({ type: 'strict-last' }),
      ]);
      expect(result).toStrictEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'rejected', reason: expect.any(TypeError) },
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      expect(await readEntries(logFile)).toStrictEqual([
        { timestamp: expect.any(String), type: 'strict-first' },
        { timestamp: expect.any(String), type: 'eager-middle' },
        { timestamp: expect.any(String), type: 'strict-last' },
      ]);
    });
  });
});

describe('request-stream and scalar append ordering', () => {
  it('keeps queued scalars behind a blocked stream and retains each individual outcome', async () => {
    await withFixture(async ({ writer, logFile }) => {
      const started = latch();
      const release = latch();
      async function* blockedRows(): AsyncGenerator<unknown> {
        started.resolve();
        await release.promise;
        yield* rows();
      }
      const before = writer.writeEntryAcknowledged({ type: 'before' });
      const stream = writer.writeRequestStream('test-provider', blockedRows(), {
        sessionId: 'ordered',
      });
      const result = Promise.allSettled([
        writer.writeEntryAcknowledged({ type: 'bad-strict', value: 1n }),
        writer.writeEntry({ type: 'after-eager' }),
        writer.writeEntryAcknowledged({ type: 'after-strict' }),
      ]);
      try {
        await started.promise;
        await before;
        expect(await readEntries(logFile)).toStrictEqual([
          { timestamp: expect.any(String), type: 'before' },
        ]);
      } finally {
        release.resolve();
        await Promise.all([stream, result]);
      }
      expect(await result).toStrictEqual([
        { status: 'rejected', reason: expect.any(TypeError) },
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
      const artifact = await stream;
      expect(artifact.row_count).toBe(2);
      const artifactEntries = await readEntries(artifact.artifact_path);
      expect(await readEntries(logFile)).toStrictEqual([
        { timestamp: expect.any(String), type: 'before' },
        ...artifactEntries,
        { timestamp: expect.any(String), type: 'after-eager' },
        { timestamp: expect.any(String), type: 'after-strict' },
      ]);
      expect(artifactEntries).toStrictEqual([
        {
          timestamp: expect.any(String),
          type: 'request',
          provider: 'test-provider',
          messages: [
            { role: 'user', content: 'streamed request' },
            { role: 'assistant', content: 'streamed response' },
          ],
          context: { sessionId: 'ordered' },
        },
      ]);
    });
  });
});

describe('request-stream append failure recovery', () => {
  it('rejects EISDIR and allows strict, eager and stream writes on a subsequent normal path', async () => {
    await withFixture(async ({ writer, faultDirectory, logFile }) => {
      targetFile(writer, faultDirectory);
      await expect(
        writer.writeRequestStream('failed-provider', rows()),
      ).rejects.toMatchObject({ code: 'EISDIR', path: faultDirectory });
      targetFile(writer, logFile);
      const strict = writer.writeEntryAcknowledged({
        type: 'recovered-strict',
      });
      const stream = writer.writeRequestStream('recovered-provider', rows());
      const eager = writer.writeEntry({ type: 'recovered-eager' });
      await Promise.all([strict, stream, eager]);
      const artifact = await stream;
      expect(await readEntries(logFile)).toStrictEqual([
        { timestamp: expect.any(String), type: 'recovered-strict' },
        ...(await readEntries(artifact.artifact_path)),
        { timestamp: expect.any(String), type: 'recovered-eager' },
      ]);
      expect(artifact.row_count).toBe(2);
    });
  });
});

describe('request-stream staging failure recovery', () => {
  it('keeps an iterator rejection independent from queued strict and eager writes', async () => {
    await withFixture(
      async ({ writer, logFile, directory, faultDirectory }) => {
        const failure = new Error('iterator failed');
        async function* failingRows(): AsyncGenerator<unknown> {
          yield { role: 'user', content: 'partial' };
          throw failure;
        }
        const stream = writer.writeRequestStream(
          'failed-provider',
          failingRows(),
        );
        const result = Promise.allSettled([
          stream,
          writer.writeEntryAcknowledged({ type: 'recovered-strict' }),
          writer.writeEntry({ type: 'recovered-eager' }),
        ]);
        expect(await result).toStrictEqual([
          { status: 'rejected', reason: failure },
          { status: 'fulfilled', value: undefined },
          { status: 'fulfilled', value: undefined },
        ]);
        expect(await readEntries(logFile)).toStrictEqual([
          { timestamp: expect.any(String), type: 'recovered-strict' },
          { timestamp: expect.any(String), type: 'recovered-eager' },
        ]);
        expect((await fs.readdir(directory)).sort()).toStrictEqual(
          [basename(faultDirectory), basename(logFile)].sort(),
        );
      },
    );
  });
});
