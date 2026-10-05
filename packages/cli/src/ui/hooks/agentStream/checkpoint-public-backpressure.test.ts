/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { deferred } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import { createToolCheckpoint, type FsOps } from './checkpointPersistence.js';
import {
  checkpointGit,
  checkpointTool,
  checkpointUiHistory,
  trackingFs,
  withCheckpoint,
} from './checkpoint-disk-test-helpers.js';
import { cleanupBounds } from '../../../utils/cleanup-history-test-helpers.js';

function pausedSink(): {
  ops: FsOps;
  paused: Promise<void>;
  resume: () => void;
} {
  const fs = trackingFs();
  const paused = deferred();
  const resume = deferred();
  return {
    paused: paused.promise,
    resume: () => resume.resolve(),
    ops: {
      ...fs.ops,
      open: async (...args) => {
        const file = await fs.ops.open(...args);
        return {
          ...file,
          writeFile: (source, options) =>
            file.writeFile(
              (async function* () {
                let first = true;
                for await (const chunk of source) {
                  if (first) {
                    first = false;
                    paused.resolve();
                    await resume.promise;
                  }
                  yield chunk;
                }
              })(),
              options,
            ),
        };
      },
    },
  };
}

async function backpressure(size: number, active: boolean): Promise<number> {
  return withCheckpoint(size, active, async (fixture, dir) => {
    const sink = pausedSink();
    const abort = new AbortController();
    const saving = createToolCheckpoint(
      checkpointTool,
      dir,
      checkpointGit,
      fixture.config.getAgentClient(),
      checkpointUiHistory,
      () => {},
      sink.ops,
      abort.signal,
    );
    const outcome = saving.then(
      () => 'finished',
      (error: unknown) => String(error),
    );
    try {
      expect(
        await Promise.race([sink.paused.then(() => 'paused'), outcome]),
      ).toBe('paused');
      const decoded = fixture.decoded();
      expect(decoded).toBeGreaterThan(0);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(fixture.decoded() - decoded).toBe(0);
      expect(fixture.reader.within(cleanupBounds)).toBe(true);
      expect(
        (await readdir(dir)).filter((file) => file.endsWith('.json')),
      ).toStrictEqual([]);
      abort.abort(new Error('paused disk writer cancelled'));
    } finally {
      sink.resume();
    }
    await expect(saving).rejects.toThrow('paused disk writer cancelled');
    expect(await readdir(dir)).toStrictEqual([]);
    expect(fixture.reader.snapshot().liveRows).toBe(0);
    expect(fixture.history.closed).toBe(1);
    return fixture.decoded();
  });
}

describe('exported checkpoint disk sink backpressure', () => {
  for (const size of [512, 8192]) {
    for (const active of [false, true]) {
      it(`does not read ahead of a paused sink and cancels ${size} rows, active=${active}`, async () => {
        expect(await backpressure(size, active)).toBeLessThan(size);
      }, 180000);
    }
  }
});
