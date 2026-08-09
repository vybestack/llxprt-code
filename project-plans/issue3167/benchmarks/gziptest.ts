#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import zlib from 'node:zlib';
import { performance } from 'node:perf_hooks';

function rec(i: number, day: number): string {
  return (
    JSON.stringify({
      ts: new Date(
        Date.UTC(2026, 7, day, i % 24, i % 60, i % 60),
      ).toISOString(),
      v: 1,
      session_id: '01J8ZQ4YV9K2M7X3B5N6P8R1T' + String(i % 9),
      turn: i % 400,
      llxprt_version: '0.11.0',
      git_sha: '34997158b',
      runtime: 'bun-1.3.14',
      platform: 'darwin-arm64',
      provider: ['anthropic', 'openai', 'codex'][i % 3],
      model: 'claude-opus-5',
      context_tokens: 40000 + ((i * 37) % 180000),
      output_tokens: 200 + ((i * 13) % 3000),
      turn_busy_ms: 3000 + ((i * 97) % 40000),
      provider_ms: 2500 + ((i * 89) % 36000),
      ttft_ms: 400 + ((i * 7) % 4000),
      stream_gap_ms: 1000 + ((i * 71) % 30000),
      tool_ms: (i * 31) % 4000,
      agent_active_ms: 2600 + ((i * 91) % 37000),
      llxprt_ms: 120 + ((i * 17) % 1400),
      ui_ms: 40 + ((i * 11) % 500),
      core_ms: 60 + ((i * 13) % 900),
      human_idle_ms: (i * 503) % 400000,
      waiting_confirmation_ms: i % 17 === 0 ? (i * 97) % 60000 : 0,
      frames: 50 + ((i * 7) % 900),
      stdout_bytes: 100000 + ((i * 977) % 3000000),
      deltas: 200 + ((i * 13) % 3000),
      rss: 400000000 + ((i * 7919) % 200000000),
      heap_used: 150000000 + ((i * 6421) % 80000000),
      external: 20000000 + ((i * 331) % 20000000),
      array_buffers: 4000000 + ((i * 97) % 8000000),
      loop_drift_p50_ms: 1.5 + (i % 20) / 10,
      loop_drift_max_ms: 20 + (i % 90),
      contended: i % 7 === 0,
      concurrent_instances: 1 + (i % 14),
      pid: 4000 + (i % 400),
      project_hash:
        'a6aa00d431b6461e04feb9f3cf06ed29e2b49097cf9bc09d29cf3339e82ea6f6',
    }) + '\n'
  );
}

// one process-day at heavy 24/7 usage: 3000 turns
const DAY_RECORDS = 3000;
let day = '';
for (let i = 0; i < DAY_RECORDS; i++) day += rec(i, 8);
const raw = Buffer.from(day);

const levels: ReadonlyArray<readonly [string, number]> = [
  ['gzip -1 (fast)', 1],
  ['gzip -6 (default)', 6],
  ['gzip -9 (max)', 9],
];
for (const [label, level] of levels) {
  const t0 = performance.now();
  const out = zlib.gzipSync(raw, { level });
  const t1 = performance.now();
  const ratio = out.length / raw.length;
  console.log(
    `${label.padEnd(20)} ${(raw.length / 1024 / 1024).toFixed(2)} MiB -> ${(out.length / 1024 / 1024).toFixed(3)} MiB  ` +
      `(${(ratio * 100).toFixed(1)}%, ${(1 / ratio).toFixed(1)}x)  in ${(t1 - t0).toFixed(0)} ms`,
  );
}
// decompress cost (analysis-time)
const gz = zlib.gzipSync(raw, { level: 6 });
let t0 = performance.now();
zlib.gunzipSync(gz);
let t1 = performance.now();
console.log(`\ngunzip a day file: ${(t1 - t0).toFixed(0)} ms`);

// concatenated gzip members readable? (relevant if we ever append compressed)
const twoMembers = Buffer.concat([
  zlib.gzipSync(Buffer.from('a\n')),
  zlib.gzipSync(Buffer.from('b\n')),
]);
try {
  console.log(
    'concatenated gzip members decode to:',
    JSON.stringify(zlib.gunzipSync(twoMembers).toString()),
  );
} catch (e) {
  console.log('concatenated members FAILED:', String(e).slice(0, 80));
}

console.log(`\nper-record size: ${(raw.length / DAY_RECORDS).toFixed(0)} B`);
console.log(
  `heavy day (3000 turns) uncompressed: ${(raw.length / 1024 / 1024).toFixed(2)} MiB`,
);
console.log(
  `  30 days uncompressed: ${(raw.length * 30 / 1024 / 1024).toFixed(0)} MiB`,
);
console.log(
  `  30 days gzip -6    : ${(zlib.gzipSync(raw, { level: 6 }).length * 30 / 1024 / 1024).toFixed(0)} MiB`,
);
