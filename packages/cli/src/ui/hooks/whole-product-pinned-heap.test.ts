/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';

function spawnHeapWorker(
  warmed: () => void,
): Bun.Subprocess<'ignore', 'inherit', 'inherit'> {
  return Bun.spawn(
    [
      process.execPath,
      'test',
      resolve(
        import.meta.dir,
        '../../__tests__/heap-workers/whole-product-pinned-heap.fixture.ts',
      ),
    ],
    {
      cwd: resolve(import.meta.dir, '../../..'),
      env: {
        ...process.env,
        W24_MEASUREMENT_MODE: 'pinned-code-v1',
        W24_PHASE_IPC: '1',
        BUN_JSC_forceCodeBlockLiveness: 'true',
        BUN_JSC_dumpOptions: '1',
      },
      stdout: 'inherit',
      stderr: 'inherit',
      ipc: (message) => {
        if (message === 'w24-warmed') warmed();
      },
    },
  );
}

describe('pinned-code-v1 whole-product retained heap', () => {
  let child: ReturnType<typeof spawnHeapWorker>;

  afterAll(async () => {
    if (child.exitCode === null) {
      child.kill();
      await child.exited;
    }
  });

  beforeAll(async () => {
    let warmed: () => void;
    const ready = new Promise<void>((resolve) => {
      warmed = resolve;
    });
    child = spawnHeapWorker(() => warmed());
    await Promise.race([
      ready,
      child.exited.then((code) => {
        throw new Error(`Heap worker exited before warm-up completed: ${code}`);
      }),
    ]);
  }, 290000);

  it('runs the unchanged raw-heap contract in an isolated pinned-code runtime', async () => {
    expect(await child.exited).toBe(0);
  }, 290000);
});
