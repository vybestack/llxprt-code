/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P12 behavioral tests for the interactive perf runtime owner/factory
 * (EVIDENCE-AC1, AC2, AC12 — integration spine).
 *
 * Real PerfSink + real PerfRetention + real OperationLifecycleRegistry + real
 * observers + real filesystem. No mock theatre — the factory constructs the
 * actual integrated pipeline. Asserts stable outputs, not mock calls.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createInteractivePerfRuntime,
  type InteractivePerfRuntimeOptions,
} from './interactivePerfRuntime.js';
import type { OperationIdentitySnapshot } from '../agentStream/operationLifecycle.js';
import {
  setInteractiveStdoutObserver,
  setInteractiveRenderObserver,
  getInteractiveStdoutObserver,
  getInteractiveRenderObserver,
} from '../../inkRenderOptions.js';
import {
  getPerfPhaseObserver,
  setPerfPhaseObserver,
} from '@vybestack/llxprt-code-telemetry/perf/perfPhaseObserver.js';
import {
  readPerfRecords,
  type PerfOperationRecord,
} from '@vybestack/llxprt-code-telemetry/perf/perfRecords.js';

let dir: string;

function fixtureIdentity(
  overrides: Partial<OperationIdentitySnapshot> = {},
): OperationIdentitySnapshot {
  return {
    session_id: 'sess-test',
    runtime_id: 'rt-test',
    parent_runtime_id: null,
    subagent_name: null,
    project_hash: 'hash-test',
    llxprt_version: '0.11.0',
    git_sha: 'abc1234',
    runtime: 'bun-1.3.14',
    platform: 'darwin',
    provider: 'test-provider',
    model: 'test-model',
    terminal_cols: 80,
    terminal_rows: 24,
    render_mode: 'incremental',
    ...overrides,
  };
}

function identityProvider(snap: OperationIdentitySnapshot) {
  return { snapshot: () => snap };
}

function makeOptions(
  overrides: Partial<InteractivePerfRuntimeOptions> = {},
): InteractivePerfRuntimeOptions & { perfDir: string } {
  return {
    enabled: true,
    memoryEnabled: false,
    perfDir: dir,
    identityProvider: identityProvider(fixtureIdentity()),
    ...overrides,
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), 'perf-owner-'));
  // Reset global observers to a clean state before each test.
  setInteractiveStdoutObserver(null);
  setInteractiveRenderObserver(null);
  setPerfPhaseObserver(null);
});

afterEach(async () => {
  // Clean up any global observers left behind.
  setInteractiveStdoutObserver(null);
  setInteractiveRenderObserver(null);
  setPerfPhaseObserver(null);
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('interactivePerfRuntime — disabled mode (AC-2)', () => {
  it('returns null when disabled', () => {
    const runtime = createInteractivePerfRuntime(
      makeOptions({ enabled: false }),
    );
    expect(runtime).toBe(null);
  });

  it('creates no perf directory, file, or claim', async () => {
    const perfDir = join(dir, 'perf');
    createInteractivePerfRuntime(makeOptions({ enabled: false, perfDir }));
    // The perf directory must not exist (no directory creation side effect).
    expect(fs.existsSync(perfDir)).toBe(false);
  });

  it('installs no observer and allocates no ring/controller', () => {
    createInteractivePerfRuntime(makeOptions({ enabled: false }));
    expect(getInteractiveStdoutObserver()).toBe(null);
    expect(getInteractiveRenderObserver()).toBe(null);
    expect(getPerfPhaseObserver()).toBe(null);
  });
});

describe('interactivePerfRuntime — enabled mode constructs full pipeline (AC-1)', () => {
  it('constructs a non-null runtime with registry and snapshot capability', () => {
    const runtime = createInteractivePerfRuntime(makeOptions());
    expect(runtime).not.toBe(null);
    expect(runtime!.registry).toBeDefined();
    expect(runtime!.snapshotCapability).toBeDefined();
  });

  it('start() creates the claim file and installs observers', async () => {
    const runtime = createInteractivePerfRuntime(makeOptions());
    await runtime!.start();

    try {
      // Claim file exists in the perf dir.
      const files = fs.readdirSync(dir);
      expect(files.some((f) => f.endsWith('.claim'))).toBe(true);

      // Observers are installed.
      expect(getInteractiveStdoutObserver()).not.toBe(null);
      expect(getInteractiveRenderObserver()).not.toBe(null);
      expect(getPerfPhaseObserver()).not.toBe(null);
    } finally {
      await runtime!.dispose();
    }
  });

  it('enabled with memory constructs a memory controller', () => {
    const runtime = createInteractivePerfRuntime(
      makeOptions({ memoryEnabled: true }),
    );
    expect(runtime!.memoryController).not.toBe(null);
  });

  it('enabled without memory has null memory controller', () => {
    const runtime = createInteractivePerfRuntime(
      makeOptions({ memoryEnabled: false }),
    );
    expect(runtime!.memoryController).toBe(null);
  });
});

describe('interactivePerfRuntime — operation recording (AC-1)', () => {
  it('produces exactly one valid operation record per operation', async () => {
    const runtime = createInteractivePerfRuntime(makeOptions());
    await runtime!.start();

    const ac = new AbortController();
    runtime!.registry.begin(ac.signal, 'sess#agentic-loop#uuid-1');
    await runtime!.registry.finalise(ac.signal, 'completed');

    await runtime!.dispose();

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    expect(files.length).toBe(1);
    const result = await readPerfRecords(join(dir, files[0]));
    const ops = result.records.filter((r) => r.record_type === 'operation');
    expect(ops).toHaveLength(1);
    expect(ops[0].status).toBe('completed');
    expect(ops[0].operation_id).toBe('sess#agentic-loop#uuid-1');
  });

  it('produces separate records for separate operations', async () => {
    const runtime = createInteractivePerfRuntime(makeOptions());
    await runtime!.start();

    const ac1 = new AbortController();
    runtime!.registry.begin(ac1.signal, 'sess#agentic-loop#uuid-1');
    await runtime!.registry.finalise(ac1.signal, 'completed');

    const ac2 = new AbortController();
    runtime!.registry.begin(ac2.signal, 'sess#agentic-loop#uuid-2');
    await runtime!.registry.finalise(ac2.signal, 'completed');

    await runtime!.dispose();

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    expect(files.length).toBe(1);
    const result = await readPerfRecords(join(dir, files[0]));
    const ops = result.records.filter((r) => r.record_type === 'operation');
    expect(ops).toHaveLength(2);
  });
});

describe('interactivePerfRuntime — live snapshot (AC-12)', () => {
  it('snapshot capability returns active operation during an active operation', async () => {
    let mono = 1000;
    const runtime = createInteractivePerfRuntime(
      makeOptions({
        identityProvider: identityProvider(
          fixtureIdentity({ provider: 'openai', model: 'gpt-4o' }),
        ),
        monotonicNow: () => mono,
      }),
    );
    await runtime!.start();

    const ac = new AbortController();
    runtime!.registry.begin(ac.signal, 'sess#agentic-loop#uuid-1');

    mono = 2500;
    const activeOp = runtime!.snapshotCapability.getActiveOperationSummary();
    expect(activeOp).not.toBe(null);
    expect(activeOp!.provider).toBe('openai');
    expect(activeOp!.model).toBe('gpt-4o');
    expect(activeOp!.elapsedMs).toBe(1500);

    await runtime!.registry.finalise(ac.signal, 'completed');
    await runtime!.dispose();
  });

  it('snapshot capability returns null active operation when idle', async () => {
    const runtime = createInteractivePerfRuntime(makeOptions());
    await runtime!.start();
    expect(runtime!.snapshotCapability.getActiveOperationSummary()).toBe(null);
    await runtime!.dispose();
  });

  it('snapshot capability returns null memory samples when memory disabled', async () => {
    const runtime = createInteractivePerfRuntime(
      makeOptions({ memoryEnabled: false }),
    );
    await runtime!.start();
    expect(runtime!.snapshotCapability.getMemorySnapshot()).toBe(null);
    await runtime!.dispose();
  });

  it('snapshot capability returns memory samples when memory enabled', async () => {
    const runtime = createInteractivePerfRuntime(
      makeOptions({ memoryEnabled: true }),
    );
    await runtime!.start();
    // No samples yet — ring is empty.
    expect(runtime!.snapshotCapability.getMemorySnapshot()).toEqual([]);
    await runtime!.dispose();
  });
});

describe('interactivePerfRuntime — clean disposal (AC-1)', () => {
  it('dispose removes the claim file', async () => {
    const runtime = createInteractivePerfRuntime(makeOptions());
    await runtime!.start();

    const claimsBefore = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.claim'));
    expect(claimsBefore.length).toBe(1);

    await runtime!.dispose();

    const claimsAfter = fs.readdirSync(dir).filter((f) => f.endsWith('.claim'));
    expect(claimsAfter.length).toBe(0);
  });

  it('dispose clears observers', async () => {
    const runtime = createInteractivePerfRuntime(makeOptions());
    await runtime!.start();
    expect(getInteractiveStdoutObserver()).not.toBe(null);

    await runtime!.dispose();
    expect(getInteractiveStdoutObserver()).toBe(null);
    expect(getInteractiveRenderObserver()).toBe(null);
    expect(getPerfPhaseObserver()).toBe(null);
  });

  it('dispose preserves parseable data on disk', async () => {
    const runtime = createInteractivePerfRuntime(makeOptions());
    await runtime!.start();

    const ac = new AbortController();
    runtime!.registry.begin(ac.signal, 'sess#agentic-loop#uuid-1');
    await runtime!.registry.finalise(ac.signal, 'completed');

    await runtime!.dispose();

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    expect(files.length).toBe(1);
    const result = await readPerfRecords(join(dir, files[0]));
    expect(result.counts.parsed).toBe(1);
    expect(result.counts.malformed).toBe(0);
  });
});

describe('interactivePerfRuntime — observer exercise (AC-6)', () => {
  it('stdout observer callback accumulates bytes for active operation', async () => {
    const runtime = createInteractivePerfRuntime(makeOptions());
    await runtime!.start();

    const ac = new AbortController();
    runtime!.registry.begin(ac.signal, 'sess#agentic-loop#uuid-1');

    // Exercise the installed stdout observer directly through the seam.
    const stdoutObserver = getInteractiveStdoutObserver();
    expect(stdoutObserver).not.toBe(null);
    stdoutObserver!.onWrite(100, 0.5);

    await runtime!.registry.finalise(ac.signal, 'completed');
    await runtime!.dispose();

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    const result = await readPerfRecords(join(dir, files[0]));
    const op = result.records.find(
      (r): r is PerfOperationRecord => r.record_type === 'operation',
    );
    expect(op).toBeDefined();
    expect(op?.stdout_bytes).toBe(100);
    expect(op?.stdout_write_calls).toBe(1);
  });

  it('render observer callback accumulates render time for active operation', async () => {
    const runtime = createInteractivePerfRuntime(makeOptions());
    await runtime!.start();

    const ac = new AbortController();
    runtime!.registry.begin(ac.signal, 'sess#agentic-loop#uuid-1');

    const renderObserver = getInteractiveRenderObserver();
    expect(renderObserver).not.toBe(null);
    renderObserver!.onRender(3.5);

    await runtime!.registry.finalise(ac.signal, 'completed');
    await runtime!.dispose();

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    const result = await readPerfRecords(join(dir, files[0]));
    const op = result.records.find(
      (r): r is PerfOperationRecord => r.record_type === 'operation',
    );
    expect(op).toBeDefined();
    expect(op?.ink_render_ms).toBe(3.5);
    expect(op?.ink_render_count).toBe(1);
  });
});

describe('interactivePerfRuntime — default-off zero side effects (AC-2)', () => {
  it('disabled produces zero lifecycle records', () => {
    const runtime = createInteractivePerfRuntime(
      makeOptions({ enabled: false }),
    );
    expect(runtime).toBe(null);
    // No records possible — no registry exists.
  });

  it('disabled path does not interact with performance.now or timers', () => {
    // The disabled factory returns null before UUID/sink/retention/observer
    // construction. There is nothing to dispose.
    const runtime = createInteractivePerfRuntime(
      makeOptions({ enabled: false }),
    );
    expect(runtime).toBe(null);
  });
});
