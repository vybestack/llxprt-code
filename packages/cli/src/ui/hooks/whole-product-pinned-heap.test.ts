/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';

describe('pinned-code-v1 whole-product retained heap', () => {
  it('runs the unchanged raw-heap contract in an isolated pinned-code runtime', async () => {
    const child = Bun.spawn(
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
          BUN_JSC_forceCodeBlockLiveness: 'true',
          BUN_JSC_dumpOptions: '1',
        },
        stdout: 'inherit',
        stderr: 'inherit',
      },
    );
    try {
      expect(await child.exited).toBe(0);
    } finally {
      if (child.exitCode === null) {
        child.kill();
        await child.exited;
      }
    }
  }, 290000);
});
