#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Size a realistic per-turn perf record to ground the disk-budget math.
const rec = {
  ts: '2026-08-08T15:27:40.123Z',
  v: 1,
  session_id: '01J8ZQ4YV9K2M7X3B5N6P8R1T4',
  turn: 42,
  llxprt_version: '0.9.14',
  git_sha: '34997158b',
  runtime: 'bun-1.3.14',
  platform: 'darwin-arm64',
  provider: 'anthropic',
  model: 'claude-opus-5',
  context_tokens: 148230,
  output_tokens: 1204,
  turn_busy_ms: 18432,
  provider_ms: 16901,
  ttft_ms: 2103,
  stream_gap_ms: 14798,
  tool_ms: 940,
  agent_active_ms: 17841,
  llxprt_ms: 591,
  ui_ms: 214,
  core_ms: 377,
  human_idle_ms: 45120,
  waiting_confirmation_ms: 0,
  frames: 388,
  stdout_bytes: 1048576,
  deltas: 1204,
  rss: 512483328,
  heap_used: 201326592,
  external: 33554432,
  array_buffers: 8388608,
  loop_drift_p50_ms: 1.9,
  loop_drift_max_ms: 84.2,
  contended: false,
};
const line = JSON.stringify(rec) + '\n';
const bytes = Buffer.byteLength(line);
console.log('fields:', Object.keys(rec).length);
console.log('bytes/record:', bytes);
const perTurn = bytes;
const tiers: ReadonlyArray<readonly [string, number]> = [
  ['100 turns (busy day)', 100],
  ['1k turns', 1000],
  ['10k turns', 10000],
  ['100k turns', 100000],
  ['1M turns', 1000000],
];
for (const [label, turns] of tiers) {
  console.log(`${label}: ${((perTurn * turns) / 1024 / 1024).toFixed(2)} MiB`);
}
console.log(
  '\nturns to fill a 32 MiB cap:',
  Math.floor((32 * 1024 * 1024) / perTurn),
);
console.log(
  'turns to fill an 8 MiB cap:',
  Math.floor((8 * 1024 * 1024) / perTurn),
);
