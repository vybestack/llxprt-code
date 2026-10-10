/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { serializeResponsesPromptEnvelope } from './responses-source-serializer.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

const context = {
  includeReasoningInContext: false,
  mediaPdfEnabled: true,
  outputLimiterConfig: { getEphemeralSettings: () => ({}) },
  debug: (): void => {},
};

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
      const pending = serializeResponsesPromptEnvelope({
        model: 'gpt-5.6',
        context,
        contents: {
          async *[Symbol.asyncIterator]() {
            yield { speaker: 'human', blocks: [] };
          },
        },
      });
      const outcome = await pending.then(
        () => 'resolved',
        (error: unknown) => error,
      );
      expect(outcome).toBeInstanceOf(AggregateError);
      if (!(outcome instanceof AggregateError))
        throw new Error('Missing combined failure');
      expect(outcome.errors).toStrictEqual([writeFailure, cleanupFailure]);
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

describe('Responses stateful source and cleanup errors', () => {
  it('retains an incremental source failure alongside sealed-base disposal failure', async () => {
    const before = new Set(fs.readdirSync(getScratchRoot()));
    const sourceFailure = new Error('incremental source failed');
    const cleanupFailure = new Error('sealed projection removal failed');
    const remove = spyOn(fsPromises, 'rm').mockRejectedValue(cleanupFailure);
    try {
      const pending = serializeResponsesPromptEnvelope({
        model: 'gpt-5.6',
        context,
        contents: {
          async *[Symbol.asyncIterator]() {
            yield { speaker: 'human', blocks: [] };
          },
        },
        stateful: {
          statefulParentUsed: true,
          retainedBaselineTokens: 100,
          incrementalContents: {
            async *[Symbol.asyncIterator]() {
              yield { speaker: 'human', blocks: [] };
              throw sourceFailure;
            },
          },
        },
      });
      const outcome = await pending.then(
        () => 'resolved',
        (error: unknown) => error,
      );
      expect(outcome).toBeInstanceOf(AggregateError);
      if (!(outcome instanceof AggregateError))
        throw new Error('Missing combined failure');
      expect(outcome.errors).toStrictEqual([sourceFailure, cleanupFailure]);
      expect(await pending.cleanup).toStrictEqual({
        status: 'rejected',
        reason: outcome,
      });
    } finally {
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

describe('Responses stateful multi-owner disposal', () => {
  it('reports every failed projection cleanup instead of only the first failure', async () => {
    const before = new Set(fs.readdirSync(getScratchRoot()));
    const baseFailure = new Error('base directory removal failed');
    const incrementalFailure = new Error(
      'incremental directory removal failed',
    );
    const remove = spyOn(fsPromises, 'rm')
      .mockRejectedValueOnce(baseFailure)
      .mockRejectedValueOnce(incrementalFailure);
    try {
      const contents: AsyncIterable<IContent> = {
        async *[Symbol.asyncIterator]() {
          yield { speaker: 'human', blocks: [] };
        },
      };
      const prompt = await serializeResponsesPromptEnvelope({
        model: 'gpt-5.6',
        context,
        contents,
        stateful: {
          statefulParentUsed: true,
          retainedBaselineTokens: 100,
          incrementalContents: contents,
        },
      });
      const outcome = await prompt.dispose().then(
        () => 'resolved',
        (error: unknown) => error,
      );
      expect(outcome).toBeInstanceOf(AggregateError);
      if (!(outcome instanceof AggregateError))
        throw new Error('Missing combined cleanup failures');
      expect(outcome.errors).toStrictEqual([baseFailure, incrementalFailure]);
    } finally {
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
