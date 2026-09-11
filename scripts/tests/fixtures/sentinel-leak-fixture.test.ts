/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Deliberate real-home leak fixture for the sentinel-guard demo (issue
 * #3622). Unarmed (the default in every normal suite run) it is a green
 * no-op. The demo test in sentinel-guard-demo.test.ts spawns the shared
 * runner over this file with LLXPRT_SENTINEL_DEMO=1 and a target inside a
 * fake real home; the fixture then writes through the absolute target path,
 * and the runner's guard must fail the run naming this file.
 */

import { describe, expect, it } from 'bun:test';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const armed = process.env.LLXPRT_SENTINEL_DEMO === '1';

describe('sentinel leak fixture (issue #3622)', () => {
  it.skipIf(!process.env.LLXPRT_SENTINEL_SIGNAL_READY)(
    'waits for runner cancellation with a descendant process',
    async () => {
      const ready = process.env.LLXPRT_SENTINEL_SIGNAL_READY;
      if (!ready) throw new Error('Missing signal readiness path');
      const descendant = spawn(process.execPath, [
        '-e',
        'setInterval(() => {}, 1000)',
      ]);
      try {
        writeFileSync(ready, String(descendant.pid));
        await new Promise<void>(() => {});
      } finally {
        descendant.kill('SIGKILL');
      }
    },
    30_000,
  );
  it.skipIf(!armed)(
    'writes into the real-home target only when armed by the demo',
    () => {
      const target = process.env.LLXPRT_SENTINEL_DEMO_TARGET;
      if (target === undefined) {
        throw new Error(
          'LLXPRT_SENTINEL_DEMO_TARGET is required when the demo is armed',
        );
      }
      const leakPath = join(target, 'leaked-by-fixture.txt');
      appendFileSync(leakPath, 'leak\n');
      expect(readFileSync(leakPath, 'utf8')).toContain('leak');
    },
  );
});
