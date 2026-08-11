/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P12 dynamic identity persistence behavior test (Item 6).
 *
 * Mutates provider/model and terminal geometry between two operations through
 * getter-based identity. Asserts records contain the corresponding snapshots
 * for each operation. Also asserts platform contains
 * `${process.platform}-${process.arch}`.
 *
 * The identity provider uses getters so each registry.begin() snapshots
 * CURRENT values rather than freezing startup values.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  PerfSink,
  PerfRetention,
} from '@vybestack/llxprt-code-telemetry/perf/index.js';
import { readPerfRecords } from '@vybestack/llxprt-code-telemetry/perf/perfRecords.js';
import type { PerfOperationRecord } from '@vybestack/llxprt-code-telemetry/perf/perfRecords.js';
import { OperationLifecycleRegistry } from '../agentStream/operationLifecycle.js';
import {
  createIdentityProviderFromGetters,
  resolvePlatformArch,
} from './interactivePerfRuntime.js';

let dir: string;
let sink: PerfSink;
let retention: PerfRetention;

beforeEach(async () => {
  dir = await fsp.mkdtemp(join(tmpdir(), 'perf-dyn-id-'));
  const runUuid = crypto.randomUUID();
  retention = new PerfRetention({ dir, runUuid });
  sink = new PerfSink({ dir, runUuid, retention });
  await sink.start();
});

afterEach(async () => {
  try {
    await sink.dispose();
  } catch {
    // ignore
  }
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function drainAndRead(): Promise<PerfOperationRecord[]> {
  const names = await fsp.readdir(dir);
  const records: PerfOperationRecord[] = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const result = await readPerfRecords(join(dir, name));
    for (const r of result.records) {
      if (r.record_type === 'operation') {
        records.push(r);
      }
    }
  }
  return records;
}

describe('dynamic identity persistence — mutable getters snapshot per operation (Item 6)', () => {
  it('mutating provider/model/geometry between operations yields correct snapshots', async () => {
    // Mutable state read by getters at each begin().
    let currentProvider = 'openai';
    let currentModel = 'gpt-4o';
    let currentCols = 80;
    let currentRows = 24;
    let currentRenderMode = 'incremental';

    const identityProvider = createIdentityProviderFromGetters(
      {
        sessionId: 'sess-dyn',
        runtimeId: 'rt-dyn',
        projectHash: 'hash-dyn',
        cliVersion: '0.11.0',
        gitSha: 'abc1234',
        runtime: 'bun-1.3.14',
        platform: resolvePlatformArch(),
      },
      {
        provider: () => currentProvider,
        model: () => currentModel,
        terminalCols: () => currentCols,
        terminalRows: () => currentRows,
        renderMode: () => currentRenderMode,
      },
    );

    const registry = new OperationLifecycleRegistry({
      identityProvider,
      sink,
      retention,
    });

    // Operation 1: openai / gpt-4o / 80x24 / incremental.
    const ac1 = new AbortController();
    registry.begin(ac1.signal, 'sess#agentic-loop#op-1');
    await registry.finalise(ac1.signal, 'completed');

    // Mutate between operations.
    currentProvider = 'anthropic';
    currentModel = 'claude-sonnet-4-20250514';
    currentCols = 120;
    currentRows = 40;
    currentRenderMode = 'plain';

    // Operation 2: anthropic / claude / 120x40 / plain.
    const ac2 = new AbortController();
    registry.begin(ac2.signal, 'sess#agentic-loop#op-2');
    await registry.finalise(ac2.signal, 'completed');

    await registry.drain();
    const records = await drainAndRead();
    expect(records).toHaveLength(2);

    // Operation 1 snapshot.
    expect(records[0]?.provider).toBe('openai');
    expect(records[0]?.model).toBe('gpt-4o');
    expect(records[0]?.terminal_cols).toBe(80);
    expect(records[0]?.terminal_rows).toBe(24);
    expect(records[0]?.render_mode).toBe('incremental');

    // Operation 2 snapshot — reflects mutated values.
    expect(records[1]?.provider).toBe('anthropic');
    expect(records[1]?.model).toBe('claude-sonnet-4-20250514');
    expect(records[1]?.terminal_cols).toBe(120);
    expect(records[1]?.terminal_rows).toBe(40);
    expect(records[1]?.render_mode).toBe('plain');
  });

  it('platform field in records contains process.platform-process.arch', async () => {
    const identityProvider = createIdentityProviderFromGetters(
      {
        sessionId: 'sess-plt',
        runtimeId: 'rt-plt',
        projectHash: 'hash-plt',
        cliVersion: '0.11.0',
        gitSha: 'abc1234',
        runtime: 'bun-1.3.14',
        platform: resolvePlatformArch(),
      },
      {
        provider: () => 'test',
        model: () => 'test',
        terminalCols: () => 80,
        terminalRows: () => 24,
        renderMode: () => 'ink',
      },
    );

    const registry = new OperationLifecycleRegistry({
      identityProvider,
      sink,
      retention,
    });

    const ac = new AbortController();
    registry.begin(ac.signal, 'sess#agentic-loop#op-plt');
    await registry.finalise(ac.signal, 'completed');

    await registry.drain();
    const records = await drainAndRead();
    expect(records).toHaveLength(1);
    expect(records[0]?.platform).toBe(`${process.platform}-${process.arch}`);
  });

  it('immutable fields are identical across operations even when mutable fields change', async () => {
    let currentProvider = 'a';
    const identityProvider = createIdentityProviderFromGetters(
      {
        sessionId: 'sess-imm',
        runtimeId: 'rt-imm',
        projectHash: 'hash-imm',
        cliVersion: '0.11.0',
        gitSha: 'deadbeef',
        runtime: 'bun',
        platform: resolvePlatformArch(),
      },
      {
        provider: () => currentProvider,
        model: () => 'fixed-model',
        terminalCols: () => 80,
        terminalRows: () => 24,
        renderMode: () => 'ink',
      },
    );

    const registry = new OperationLifecycleRegistry({
      identityProvider,
      sink,
      retention,
    });

    const ac1 = new AbortController();
    registry.begin(ac1.signal, 'sess#agentic-loop#imm-1');
    await registry.finalise(ac1.signal, 'completed');

    currentProvider = 'b';

    const ac2 = new AbortController();
    registry.begin(ac2.signal, 'sess#agentic-loop#imm-2');
    await registry.finalise(ac2.signal, 'completed');

    await registry.drain();
    const records = await drainAndRead();
    expect(records).toHaveLength(2);

    // Immutable fields are the same across both operations.
    expect(records[0]?.session_id).toBe(records[1]?.session_id);
    expect(records[0]?.runtime_id).toBe(records[1]?.runtime_id);
    expect(records[0]?.project_hash).toBe(records[1]?.project_hash);
    expect(records[0]?.llxprt_version).toBe(records[1]?.llxprt_version);
    expect(records[0]?.git_sha).toBe(records[1]?.git_sha);
    expect(records[0]?.runtime).toBe(records[1]?.runtime);
    expect(records[0]?.platform).toBe(records[1]?.platform);

    // Mutable provider changed.
    expect(records[0]?.provider).toBe('a');
    expect(records[1]?.provider).toBe('b');
  });
});
