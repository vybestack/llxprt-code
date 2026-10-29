/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { writeSync } from 'node:fs';

const enabled = process.env.LLXPRT_TEST_NATIVE_PRELOAD_PHASES === '1';
const startedAt = enabled ? process.hrtime.bigint() : 0n;

export function traceNativePreloadPhase(phase: string): void {
  if (!enabled) return;
  const now = process.hrtime.bigint();
  writeSync(
    2,
    `${JSON.stringify({
      diagnostic: 'native-preload-phase',
      phase,
      pid: process.pid,
      ppid: process.ppid,
      bun: Bun.version,
      monotonicNs: now.toString(),
      elapsedMs: Number(now - startedAt) / 1e6,
      processElapsedMs: performance.now(),
      optionKeys: ['BUN_OPTIONS', 'NODE_OPTIONS'].filter(
        (key) => process.env[key] !== undefined,
      ),
    })}\n`,
  );
}
