/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { parseOutputLimits } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { readOwnedSource } from './__tests__/owned-source-read.js';
import {
  nativePrompt,
  nativeRows,
} from './__tests__/native-responses-fixture.js';
import {
  resolveRequestMedia,
  finishMediaRequest,
} from '../utils/request-media-resolution.js';
import { cancellableSerialization } from './responses-serialization-lifecycle.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

const context = {
  includeReasoningInContext: false,
  mediaPdfEnabled: true,
  outputLimits: parseOutputLimits({}),
  debug: (): void => {},
};

function leafFailures(error: unknown): unknown[] {
  return error instanceof AggregateError
    ? error.errors.flatMap(leafFailures)
    : [error];
}

describe('Responses serializer disk-write lifecycle', () => {
  it('retains both a disk-write failure and failed directory cleanup', async () => {
    const before = new Set(fs.readdirSync(getScratchRoot()));
    const writeFailure = new Error('disk write failed');
    const cleanupFailure = new Error('directory removal failed');
    const write = spyOn(fs, 'writeSync').mockImplementation(() => {
      throw writeFailure;
    });
    const remove = spyOn(fs, 'rmSync').mockImplementation(() => {
      throw cleanupFailure;
    });
    try {
      const pending = readOwnedSource({
        async *[Symbol.asyncIterator]() {
          yield { speaker: 'human', blocks: [] };
        },
      });
      const outcome = await pending.then(
        () => 'resolved',
        (error: unknown) => error,
      );
      expect(outcome).toBeInstanceOf(AggregateError);
      if (!(outcome instanceof AggregateError))
        throw new Error('Missing combined failure');
      // Every layer that owns a resource (request spool, segment writers,
      // scratch directory) reports its own write and cleanup failure, so the
      // combined error nests. The original write failure stays the first leaf
      // and the scratch directory cleanup failure the last; nothing else leaks in.
      const failures = leafFailures(outcome);
      expect(failures[0]).toBe(writeFailure);
      expect(failures[failures.length - 1]).toBe(cleanupFailure);
      expect(
        failures.every(
          (failure) => failure === writeFailure || failure === cleanupFailure,
        ),
      ).toBe(true);
      expect(await pending.cleanup).toStrictEqual({
        status: 'rejected',
        reason: outcome,
      });
    } finally {
      write.mockRestore();
      remove.mockRestore();
      for (const name of fs
        .readdirSync(getScratchRoot())
        .filter((name) => !before.has(name)))
        fs.rmSync(join(getScratchRoot(), name), {
          recursive: true,
          force: true,
        });
    }
  });
});

describe('Responses synchronous disk-write cancellation limit', () => {
  it('cannot dispatch queued cancellation inside a blocked synchronous write, then cleans when it resumes', async () => {
    const root = fs.mkdtempSync(join(tmpdir(), 'responses-write-gate-'));
    const fifo = join(root, 'gate');
    const setup = Bun.spawn(['mkfifo', fifo], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await setup.exited).toBe(0);
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, 'responses-source-write.test-helper.ts'),
        fifo,
      ],
      {
        env: process.env,
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    let released = false;
    try {
      while (!fs.existsSync(fifo + '.blocked')) {
        if (child.exitCode !== null)
          throw new Error(
            `Child exited ${child.exitCode}: ${await new Response(child.stderr).text()}`,
          );
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(fs.existsSync(fifo + '.aborted')).toBe(false);
      const fd = fs.openSync(fifo, 'w');
      fs.writeSync(fd, 'x');
      fs.closeSync(fd);
      released = true;
      expect(await child.exited).toBe(0);
      expect(fs.existsSync(fifo + '.aborted')).toBe(true);
      const result: unknown = JSON.parse(
        fs.readFileSync(fifo + '.result', 'utf8'),
      );
      expect(result).toStrictEqual({
        outcome: 'aborted',
        cleanup: { status: 'fulfilled' },
        leaked: [],
      });
      expect(await new Response(child.stderr).text()).toBe('');
    } finally {
      if (!released) {
        child.kill();
        await child.exited;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Responses native source and media cleanup errors', () => {
  it('retains a source failure alongside media-owner disposal failure', async () => {
    const sourceFailure = new Error('incremental source failed');
    const cleanupFailure = new Error('media owner release failed');
    const owner = await resolveRequestMedia(
      { requestId: 'source-cleanup-test' },
      [],
      undefined,
    );
    owner.registerCleanup(() => {
      throw cleanupFailure;
    });
    const rows = {
      ...nativeRows([]),
      count: 1,
      async *openReader(): AsyncGenerator<IContent> {
        yield { speaker: 'human', blocks: [] };
        throw sourceFailure;
      },
    };
    const pending = cancellableSerialization(
      async () => {
        try {
          return await nativePrompt(rows, { model: 'gpt-5.6', context });
        } catch (error) {
          return finishMediaRequest(owner, { status: 'failed', error });
        }
      },
      (prompt) => prompt.dispose(),
    );
    const outcome = await pending.then(
      () => 'resolved',
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(AggregateError);
    if (!(outcome instanceof AggregateError))
      throw new Error('Missing combined failure');
    expect(outcome.errors).toStrictEqual([
      sourceFailure,
      new AggregateError([cleanupFailure], 'Failed to release media request'),
    ]);
    expect(leafFailures(outcome)).toStrictEqual([
      sourceFailure,
      cleanupFailure,
    ]);
    expect(await pending.cleanup).toStrictEqual({
      status: 'rejected',
      reason: outcome,
    });
  });
});

describe('Responses native multi-owner disposal', () => {
  it('reports every failed request cleanup instead of only the first failure', async () => {
    const baseFailure = new Error('base owner release failed');
    const incrementalFailure = new Error('incremental owner release failed');
    const owner = await resolveRequestMedia(
      { requestId: 'multi-cleanup-test' },
      [],
      undefined,
    );
    owner.registerCleanup(() => {
      throw incrementalFailure;
    });
    owner.registerCleanup(() => {
      throw baseFailure;
    });
    const outcome = await owner.release().then(
      () => 'resolved',
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(AggregateError);
    if (!(outcome instanceof AggregateError))
      throw new Error('Missing combined cleanup failures');
    expect(outcome.errors).toStrictEqual([baseFailure, incrementalFailure]);
  });
});
