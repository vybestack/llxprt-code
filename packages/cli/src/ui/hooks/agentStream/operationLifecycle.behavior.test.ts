/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the OperationLifecycleRegistry (P06, EVIDENCE-AC3/AC4).
 *
 * Real registry + real PerfSink/PerfRetention + real temp files + the real
 * reader. No mocks.
 *
 * Covers: seven terminal statuses, duplicate finalise (exactly-once),
 * finalise/supersede race, multiple claims including stale claim, exact D1
 * split rule, no child arrays, session index monotonic, schema failure
 * fail-fast, filesystem sink fail-open.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  PerfSink,
  PerfRetention,
} from '@vybestack/llxprt-code-telemetry/perf/index.js';
import type { PerfSinkFilesystem } from '@vybestack/llxprt-code-telemetry/perf/index.js';
import { readPerfRecords } from '@vybestack/llxprt-code-telemetry/perf/perfRecords.js';
import type { PerfOperationRecord } from '@vybestack/llxprt-code-telemetry/perf/perfRecords.js';
import { promises as fsp } from 'node:fs';
import {
  OperationLifecycleRegistry,
  type OperationIdentityProvider,
  type OperationIdentitySnapshot,
  type OperationStatus,
} from './operationLifecycle.js';

// ---------------------------------------------------------------------------
// Shared setup helper (RULES.md: no copy-pasted boilerplate)
// ---------------------------------------------------------------------------

let dir: string;

function createOperationLifecycleTempDirectory(): void {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'op-lifecycle-'));
}

function removeOperationLifecycleTempDirectory(): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function fixtureIdentity(
  overrides: Partial<OperationIdentitySnapshot> = {},
): OperationIdentitySnapshot {
  return {
    session_id: 'sess-abc',
    runtime_id: 'rt-main',
    parent_runtime_id: null,
    subagent_name: null,
    project_hash: 'sha256:project-hash',
    llxprt_version: '0.11.0',
    git_sha: 'abc1234',
    runtime: 'bun-1.3.14',
    platform: 'darwin-arm64',
    provider: 'openai',
    model: 'gpt-4o',
    terminal_cols: 120,
    terminal_rows: 40,
    render_mode: 'incremental',
    ...overrides,
  };
}

function fixtureProvider(
  overrides: Partial<OperationIdentitySnapshot> = {},
): OperationIdentityProvider {
  const snap = fixtureIdentity(overrides);
  return { snapshot: () => snap };
}

/**
 * Filesystem port that fails appendFile with EACCES to test fail-open (D6).
 * Delegates directory/exclusive-open to the real fs so the claim is created.
 */
class FailingAppendFilesystem implements PerfSinkFilesystem {
  async ensureDir(d: string): Promise<void> {
    try {
      await fsp.access(d);
    } catch {
      await fsp.mkdir(d, { recursive: true, mode: 0o700 });
    }
  }

  async openExclusive(filePath: string, mode: number): Promise<void> {
    const handle = await fsp.open(filePath, 'wx', mode);
    await handle.close();
  }

  async appendFile(): Promise<void> {
    const err = new Error('EACCES') as NodeJS.ErrnoException;
    err.code = 'EACCES';
    throw err;
  }
}

function createRegistry(
  overrides: {
    identity?: OperationIdentityProvider;
    sink?: PerfSink;
    retention?: PerfRetention;
    wallNow?: () => number;
    monotonicNow?: () => number;
  } = {},
): {
  registry: OperationLifecycleRegistry;
  sink: PerfSink;
  retention: PerfRetention;
} {
  const runUuid = crypto.randomUUID();
  const retention =
    overrides.retention ??
    new PerfRetention({
      dir,
      runUuid,
      maintenanceIntervalMs: 60_000,
    });
  const sink =
    overrides.sink ??
    new PerfSink({
      dir,
      runUuid,
      retention,
    });
  const registry = new OperationLifecycleRegistry({
    identityProvider: overrides.identity ?? fixtureProvider(),
    sink,
    retention,
    wallNow: overrides.wallNow,
    monotonicNow: overrides.monotonicNow,
  });
  return { registry, sink, retention };
}

async function startAndCreate(
  overrides: {
    identity?: OperationIdentityProvider;
    runUuid?: string;
    sink?: PerfSink;
    retention?: PerfRetention;
    wallNow?: () => number;
    monotonicNow?: () => number;
  } = {},
): Promise<{
  registry: OperationLifecycleRegistry;
  sink: PerfSink;
  retention: PerfRetention;
}> {
  const runUuid = overrides.runUuid ?? crypto.randomUUID();
  const retention =
    overrides.retention ??
    new PerfRetention({
      dir,
      runUuid,
      maintenanceIntervalMs: 60_000,
    });
  const sink =
    overrides.sink ??
    new PerfSink({
      dir,
      runUuid,
      retention,
    });
  await sink.start();
  const { registry } = createRegistry({
    identity: overrides.identity,
    sink,
    retention,
    wallNow: overrides.wallNow,
    monotonicNow: overrides.monotonicNow,
  });
  return { registry, sink, retention };
}

async function readAllRecords(): Promise<PerfOperationRecord[]> {
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    : [];
  const records: PerfOperationRecord[] = [];
  for (const file of files) {
    const result = await readPerfRecords(path.join(dir, file));
    for (const rec of result.records) {
      if (rec.record_type === 'operation') {
        records.push(rec);
      }
    }
  }
  return records;
}

async function drainSink(sink: PerfSink): Promise<void> {
  await sink.dispose();
}

// ---------------------------------------------------------------------------
// D1: operation_id derivation through the lifecycle
// ---------------------------------------------------------------------------

describe('OperationLifecycleRegistry — D1 operation_id (AC-3 split rule)', () => {
  beforeEach(createOperationLifecycleTempDirectory);
  afterEach(removeOperationLifecycleTempDirectory);

  it('derives operation_id from an initial prompt id (no marker)', async () => {
    const { registry, sink } = await startAndCreate();
    const ac = new AbortController();
    registry.begin(ac.signal, 'sess-1#agentic-loop#uuid-1');
    await registry.finalise(ac.signal, 'completed');
    await drainSink(sink);

    const records = await readAllRecords();
    expect(records).toHaveLength(1);
    expect(records[0].operation_id).toBe('sess-1#agentic-loop#uuid-1');
  });

  it('strips a continuation marker to the prefix', async () => {
    const { registry, sink } = await startAndCreate();
    const ac = new AbortController();
    registry.begin(ac.signal, 'sess-1#agentic-loop#uuid-1#continuation#1');
    await registry.finalise(ac.signal, 'completed');
    await drainSink(sink);

    const records = await readAllRecords();
    expect(records).toHaveLength(1);
    expect(records[0].operation_id).toBe('sess-1#agentic-loop#uuid-1');
  });

  it('strips continuation #2 to the same prefix as #1', async () => {
    const { registry, sink } = await startAndCreate();
    const ac1 = new AbortController();
    registry.begin(ac1.signal, 'sess-1#agentic-loop#uuid-1#continuation#2');
    await registry.finalise(ac1.signal, 'completed');
    await drainSink(sink);

    const records = await readAllRecords();
    expect(records[0].operation_id).toBe('sess-1#agentic-loop#uuid-1');
  });

  it('takes the first segment for a non-terminal marker', async () => {
    const { registry, sink } = await startAndCreate();
    const ac = new AbortController();
    registry.begin(ac.signal, 'sess-1#continuation#1#more');
    await registry.finalise(ac.signal, 'completed');
    await drainSink(sink);

    const records = await readAllRecords();
    expect(records[0].operation_id).toBe('sess-1');
  });

  it('preserves a CLI-fallback id without the marker', async () => {
    const { registry, sink } = await startAndCreate();
    const ac = new AbortController();
    registry.begin(ac.signal, 'test-session########0');
    await registry.finalise(ac.signal, 'completed');
    await drainSink(sink);

    const records = await readAllRecords();
    expect(records[0].operation_id).toBe('test-session########0');
  });
});

// ---------------------------------------------------------------------------
// D1: no child arrays on the record
// ---------------------------------------------------------------------------

describe('OperationLifecycleRegistry — D1 no child arrays', () => {
  beforeEach(createOperationLifecycleTempDirectory);
  afterEach(removeOperationLifecycleTempDirectory);

  it('produces a record with no prompt_ids/turn_ids fields', async () => {
    const { registry, sink } = await startAndCreate();
    const ac = new AbortController();
    registry.begin(ac.signal, 'sess-1#agentic-loop#uuid-1');
    await registry.finalise(ac.signal, 'completed');
    await drainSink(sink);

    const records = await readAllRecords();
    expect(records).toHaveLength(1);
    const raw = JSON.parse(
      fs.readFileSync(
        fs
          .readdirSync(dir)
          .map((f) => path.join(dir, f))
          .find((f) => f.endsWith('.jsonl'))!,
        'utf8',
      ),
    );
    expect('prompt_ids' in raw).toBe(false);
    expect('turn_ids' in raw).toBe(false);
    expect('prompt_ids_total' in raw).toBe(false);
    expect('turn_ids_total' in raw).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Seven terminal statuses (AC-4)
// ---------------------------------------------------------------------------

describe('OperationLifecycleRegistry — seven terminal statuses (AC-4)', () => {
  beforeEach(createOperationLifecycleTempDirectory);
  afterEach(removeOperationLifecycleTempDirectory);

  interface TerminalStatusScenario {
    readonly status: OperationStatus;
    readonly terminate: (
      registry: OperationLifecycleRegistry,
      signal: AbortSignal,
    ) => Promise<void>;
  }

  const scenarios: readonly TerminalStatusScenario[] = [
    {
      status: 'completed',
      terminate: (registry, signal) => registry.finalise(signal, 'completed'),
    },
    {
      status: 'error',
      terminate: (registry, signal) => registry.finalise(signal, 'error'),
    },
    {
      status: 'cancelled_before_send',
      terminate: (registry, signal) =>
        registry.finalise(signal, 'cancelled_before_send'),
    },
    {
      status: 'cancelled_during_api',
      terminate: (registry, signal) =>
        registry.finalise(signal, 'cancelled_during_api'),
    },
    {
      status: 'cancelled_during_tool',
      terminate: (registry, signal) =>
        registry.finalise(signal, 'cancelled_during_tool'),
    },
    {
      status: 'cancelled_during_approval',
      terminate: (registry, signal) =>
        registry.finalise(signal, 'cancelled_during_approval'),
    },
    {
      status: 'superseded',
      terminate: async (registry) => {
        // Superseded is written by the sweep, not explicit finalise.
        const nextOperation = new AbortController();
        registry.begin(nextOperation.signal, 'sess-1#agentic-loop#uuid-2');
        await registry.finalise(nextOperation.signal, 'completed');
      },
    },
  ];

  const observeRecordsForTerminalStatus = async (
    scenario: TerminalStatusScenario,
  ): Promise<readonly PerfOperationRecord[]> => {
    const { registry, sink } = await startAndCreate();
    const operation = new AbortController();
    registry.begin(operation.signal, 'sess-1#agentic-loop#uuid-1');

    await scenario.terminate(registry, operation.signal);
    await drainSink(sink);

    const records = await readAllRecords();
    return records.filter((record) => record.status === scenario.status);
  };
  for (const scenario of scenarios) {
    const { status } = scenario;
    it(`writes exactly one record with status "${status}"`, async () => {
      const matchingRecords = await observeRecordsForTerminalStatus(scenario);

      expect(matchingRecords).toHaveLength(1);
    });
  }
});

// ---------------------------------------------------------------------------
// Exactly-once: duplicate finalise
// ---------------------------------------------------------------------------

describe('OperationLifecycleRegistry — exactly-once duplicate finalise', () => {
  beforeEach(createOperationLifecycleTempDirectory);
  afterEach(removeOperationLifecycleTempDirectory);

  it('writes exactly one record for a duplicate finalise', async () => {
    const { registry, sink } = await startAndCreate();
    const ac = new AbortController();
    registry.begin(ac.signal, 'sess-1#agentic-loop#uuid-1');
    await registry.finalise(ac.signal, 'completed');
    await registry.finalise(ac.signal, 'completed');
    await registry.finalise(ac.signal, 'error');
    await drainSink(sink);

    const records = await readAllRecords();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('completed');
  });

  it('finalise on an unknown signal is a no-op', async () => {
    const { registry, sink } = await startAndCreate();
    const unknown = new AbortController();
    await registry.finalise(unknown.signal, 'completed');
    await drainSink(sink);

    const records = await readAllRecords();
    expect(records).toHaveLength(0);
  });

  it('late finalise after supersede sweep is a no-op', async () => {
    const { registry, sink } = await startAndCreate();
    const ac1 = new AbortController();
    registry.begin(ac1.signal, 'sess-1#agentic-loop#uuid-1');
    // New begin sweeps ac1 as superseded.
    const ac2 = new AbortController();
    registry.begin(ac2.signal, 'sess-1#agentic-loop#uuid-2');
    // Late explicit finalise of the swept signal — must not double-write.
    await registry.finalise(ac1.signal, 'completed');
    await registry.finalise(ac2.signal, 'completed');
    await drainSink(sink);

    const records = await readAllRecords();
    expect(records).toHaveLength(2);
    const statuses = records.map((r) => r.status).sort();
    expect(statuses).toStrictEqual(['completed', 'superseded']);
  });
});

// ---------------------------------------------------------------------------
// Superseded sweep (AC-4)
// ---------------------------------------------------------------------------

describe('OperationLifecycleRegistry — superseded sweep', () => {
  beforeEach(createOperationLifecycleTempDirectory);
  afterEach(removeOperationLifecycleTempDirectory);

  it('finalises a displaced op as superseded when a new begin occurs', async () => {
    const { registry, sink } = await startAndCreate();
    const ac1 = new AbortController();
    const handle1 = registry.begin(ac1.signal, 'sess-1#agentic-loop#uuid-1');
    expect(handle1.operationId).toBe('sess-1#agentic-loop#uuid-1');

    const ac2 = new AbortController();
    const handle2 = registry.begin(ac2.signal, 'sess-1#agentic-loop#uuid-2');
    expect(handle2.operationId).toBe('sess-1#agentic-loop#uuid-2');

    await registry.finalise(ac2.signal, 'completed');
    await drainSink(sink);

    const records = await readAllRecords();
    expect(records).toHaveLength(2);
    const superseded = records.filter((r) => r.status === 'superseded');
    const completed = records.filter((r) => r.status === 'completed');
    expect(superseded).toHaveLength(1);
    expect(completed).toHaveLength(1);
    expect(superseded[0].operation_id).toBe('sess-1#agentic-loop#uuid-1');
    expect(completed[0].operation_id).toBe('sess-1#agentic-loop#uuid-2');
  });

  it('finalises multiple displaced ops as superseded', async () => {
    const { registry, sink } = await startAndCreate();
    const ac1 = new AbortController();
    registry.begin(ac1.signal, 'sess-1#agentic-loop#uuid-1');
    const ac2 = new AbortController();
    registry.begin(ac2.signal, 'sess-1#agentic-loop#uuid-2');
    const ac3 = new AbortController();
    registry.begin(ac3.signal, 'sess-1#agentic-loop#uuid-3');
    await registry.finalise(ac3.signal, 'completed');
    await drainSink(sink);

    const records = await readAllRecords();
    expect(records).toHaveLength(3);
    const superseded = records.filter((r) => r.status === 'superseded');
    expect(superseded).toHaveLength(2);
  });

  it('avoids writing two records when explicit finalise races with supersede', async () => {
    const { registry, sink } = await startAndCreate();
    const ac1 = new AbortController();
    registry.begin(ac1.signal, 'sess-1#agentic-loop#uuid-1');

    // Simulate the race: explicit finalise AND supersede sweep.
    // The sweep claims synchronously in begin, so the explicit finalise
    // finds the signal already finalised and no-ops.
    const ac2 = new AbortController();
    registry.begin(ac2.signal, 'sess-1#agentic-loop#uuid-2');
    // This late finalise must no-op (exactly-once).
    await registry.finalise(ac1.signal, 'completed');
    await registry.finalise(ac2.signal, 'completed');
    await drainSink(sink);

    const records = await readAllRecords();
    // Exactly 2: one superseded (sweep), one completed (ac2).
    expect(records).toHaveLength(2);
    const op1Records = records.filter(
      (r) => r.operation_id === 'sess-1#agentic-loop#uuid-1',
    );
    expect(op1Records).toHaveLength(1);
    expect(op1Records[0].status).toBe('superseded');
  });
});

// ---------------------------------------------------------------------------
// concurrent_instances from claims (D3)
// ---------------------------------------------------------------------------

describe('OperationLifecycleRegistry — concurrent_instances (D3)', () => {
  beforeEach(createOperationLifecycleTempDirectory);
  afterEach(removeOperationLifecycleTempDirectory);

  it('includes the own claim in concurrent_instances (minimum 1)', async () => {
    const { registry, sink } = await startAndCreate();
    const ac = new AbortController();
    registry.begin(ac.signal, 'sess-1#agentic-loop#uuid-1');
    await registry.finalise(ac.signal, 'completed');
    await drainSink(sink);

    const records = await readAllRecords();
    expect(records[0].concurrent_instances).toBeGreaterThanOrEqual(1);
  });

  it('counts a stale claim from a prior run as non-stale within the lease', async () => {
    // Create a prior run's claim file (non-stale).
    const priorClaim = path.join(dir, 'prior-run-uuid.claim');
    fs.writeFileSync(priorClaim, '', { mode: 0o600 });

    const { registry, sink } = await startAndCreate();
    const ac = new AbortController();
    registry.begin(ac.signal, 'sess-1#agentic-loop#uuid-1');
    await registry.finalise(ac.signal, 'completed');
    await drainSink(sink);

    const records = await readAllRecords();
    // At least 2: own claim + prior claim (both fresh/non-stale).
    expect(records[0].concurrent_instances).toBeGreaterThanOrEqual(2);
  });

  it('does not count a stale claim beyond the lease window', async () => {
    // Create a stale claim (mtime far in the past).
    const staleClaim = path.join(dir, 'stale-run-uuid.claim');
    fs.writeFileSync(staleClaim, '', { mode: 0o600 });
    const staleTime = new Date(Date.now() - 600_000); // 10 min ago > 180s lease
    fs.utimesSync(staleClaim, staleTime, staleTime);

    const { registry, sink } = await startAndCreate();
    const ac = new AbortController();
    registry.begin(ac.signal, 'sess-1#agentic-loop#uuid-1');
    await registry.finalise(ac.signal, 'completed');
    await drainSink(sink);

    const records = await readAllRecords();
    // Only own claim counts (stale one excluded).
    expect(records[0].concurrent_instances).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Session index monotonic
// ---------------------------------------------------------------------------

describe('OperationLifecycleRegistry — session index monotonic', () => {
  beforeEach(createOperationLifecycleTempDirectory);
  afterEach(removeOperationLifecycleTempDirectory);

  it('assigns sequential indices starting at 0', async () => {
    const { registry, sink } = await startAndCreate();
    const ac1 = new AbortController();
    const h1 = registry.begin(ac1.signal, 'sess-1#agentic-loop#uuid-1');
    await registry.finalise(ac1.signal, 'completed');

    const ac2 = new AbortController();
    const h2 = registry.begin(ac2.signal, 'sess-1#agentic-loop#uuid-2');
    await registry.finalise(ac2.signal, 'completed');

    const ac3 = new AbortController();
    const h3 = registry.begin(ac3.signal, 'sess-1#agentic-loop#uuid-3');
    await registry.finalise(ac3.signal, 'completed');

    await drainSink(sink);

    expect(h1.sessionOperationIndex).toBe(0);
    expect(h2.sessionOperationIndex).toBe(1);
    expect(h3.sessionOperationIndex).toBe(2);

    const records = await readAllRecords();
    const indices = records
      .map((r) => r.session_operation_index)
      .sort((a, b) => a - b);
    expect(indices).toStrictEqual([0, 1, 2]);
  });
});

// ---------------------------------------------------------------------------
// Measurement handle (P07 seam)
// ---------------------------------------------------------------------------

describe('OperationLifecycleRegistry — measurement handle', () => {
  beforeEach(createOperationLifecycleTempDirectory);
  afterEach(removeOperationLifecycleTempDirectory);

  it('exposes a mutable measurement starting at zero', async () => {
    const { registry, sink } = await startAndCreate();
    const ac = new AbortController();
    const handle = registry.begin(ac.signal, 'sess-1#agentic-loop#uuid-1');
    expect(handle.measurement.client_prepare_ms).toBe(0);
    expect(handle.measurement.context_tokens).toBe(0);

    // P07 would accumulate here.
    handle.measurement.client_prepare_ms = 5;
    handle.measurement.context_tokens = 1000;
    handle.measurement.output_tokens = 500;

    await registry.finalise(ac.signal, 'completed');
    await drainSink(sink);

    const records = await readAllRecords();
    expect(records[0].client_prepare_ms).toBe(5);
    expect(records[0].context_tokens).toBe(1000);
    expect(records[0].output_tokens).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Schema-valid record + honest residual
// ---------------------------------------------------------------------------

describe('OperationLifecycleRegistry — record assembly', () => {
  beforeEach(createOperationLifecycleTempDirectory);
  afterEach(removeOperationLifecycleTempDirectory);

  it('produces a schema-valid record with correct identity fields', async () => {
    const provider = fixtureProvider({
      session_id: 'my-session',
      runtime_id: 'rt-1',
      provider: 'anthropic',
      model: 'claude-3',
    });
    const { registry, sink } = await startAndCreate({ identity: provider });
    const ac = new AbortController();
    registry.begin(ac.signal, 'my-session#agentic-loop#abc');
    await registry.finalise(ac.signal, 'completed');
    await drainSink(sink);

    const records = await readAllRecords();
    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r.schema_version).toBe(1);
    expect(r.record_type).toBe('operation');
    expect(r.session_id).toBe('my-session');
    expect(r.runtime_id).toBe('rt-1');
    expect(r.provider).toBe('anthropic');
    expect(r.model).toBe('claude-3');
    expect(r.status).toBe('completed');
  });

  it('reports an honest residual equal to elapsed with zero measurements', async () => {
    let mono = 1000;
    const { registry, sink } = await startAndCreate({
      monotonicNow: () => mono,
    });
    const ac = new AbortController();
    registry.begin(ac.signal, 'sess-1#agentic-loop#uuid-1');
    mono += 500; // 500ms elapsed
    await registry.finalise(ac.signal, 'completed');
    await drainSink(sink);

    const records = await readAllRecords();
    expect(records[0].operation_elapsed_ms).toBe(500);
    expect(records[0].unclassified_elapsed_ms).toBe(500);
  });

  it('subtracts directly-measured phases from the residual', async () => {
    let mono = 1000;
    const { registry, sink } = await startAndCreate({
      monotonicNow: () => mono,
    });
    const ac = new AbortController();
    const handle = registry.begin(ac.signal, 'sess-1#agentic-loop#uuid-1');
    handle.measurement.client_prepare_ms = 100;
    handle.measurement.stream_handler_ms = 50;
    mono += 500;
    await registry.finalise(ac.signal, 'completed');
    await drainSink(sink);

    const records = await readAllRecords();
    expect(records[0].operation_elapsed_ms).toBe(500);
    expect(records[0].unclassified_elapsed_ms).toBe(350);
  });

  it('uses wall-clock ISO for ts and monotonic for uptime', async () => {
    const fixedWall = new Date('2026-08-09T12:00:00.000Z').getTime();
    const mono = 30_000;
    const { registry, sink } = await startAndCreate({
      wallNow: () => fixedWall,
      monotonicNow: () => mono,
    });
    const ac = new AbortController();
    registry.begin(ac.signal, 'sess-1#agentic-loop#uuid-1');
    await registry.finalise(ac.signal, 'completed');
    await drainSink(sink);

    const records = await readAllRecords();
    expect(records[0].ts).toBe('2026-08-09T12:00:00.000Z');
    expect(records[0].uptime_ms).toBe(30_000);
  });

  it('omits memory columns in P06', async () => {
    const { registry, sink } = await startAndCreate();
    const ac = new AbortController();
    registry.begin(ac.signal, 'sess-1#agentic-loop#uuid-1');
    await registry.finalise(ac.signal, 'completed');
    await drainSink(sink);

    const records = await readAllRecords();
    expect('rss_bytes' in records[0]).toBe(false);
    expect('heap_used_bytes' in records[0]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Error policy: schema failure fail-fast, filesystem fail-open
// ---------------------------------------------------------------------------

describe('OperationLifecycleRegistry — error policy', () => {
  beforeEach(createOperationLifecycleTempDirectory);
  afterEach(removeOperationLifecycleTempDirectory);

  it('rejects when an internal error occurs (identity provider throws)', async () => {
    const throwingProvider: OperationIdentityProvider = {
      snapshot: (): OperationIdentitySnapshot => {
        throw new Error('identity unavailable');
      },
    };
    const { registry, sink } = await startAndCreate({
      identity: throwingProvider,
    });
    const ac = new AbortController();
    expect(() =>
      registry.begin(ac.signal, 'sess-1#agentic-loop#uuid-1'),
    ).toThrow('identity unavailable');
    await drainSink(sink);
  });

  it('fail-opens on filesystem sink errors (no throw to the operation path)', async () => {
    const failingFs = new FailingAppendFilesystem();
    const runUuid = crypto.randomUUID();
    const retention = new PerfRetention({
      dir,
      runUuid,
      maintenanceIntervalMs: 60_000,
    });
    const sink = new PerfSink({
      dir,
      runUuid,
      retention,
      fs: failingFs,
    });
    await sink.start();

    const { registry } = createRegistry({ sink, retention });
    const ac = new AbortController();
    registry.begin(ac.signal, 'sess-1#agentic-loop#uuid-1');
    // Must NOT throw — filesystem errors fail-open.
    await registry.finalise(ac.signal, 'completed');
    await drainSink(sink);

    // No record on disk (append failed), but no throw escaped.
    const records = await readAllRecords();
    expect(records).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Queued/requeued submission semantics: each consumed turn has its own operation
// ---------------------------------------------------------------------------

describe('OperationLifecycleRegistry — each turn has its own operation', () => {
  beforeEach(createOperationLifecycleTempDirectory);
  afterEach(removeOperationLifecycleTempDirectory);

  it('assigns distinct operation_ids and sequential indices to successive turns', async () => {
    const { registry, sink } = await startAndCreate();

    const ac1 = new AbortController();
    const h1 = registry.begin(ac1.signal, 'sess-1#agentic-loop#turn-1');
    await registry.finalise(ac1.signal, 'completed');

    const ac2 = new AbortController();
    const h2 = registry.begin(ac2.signal, 'sess-1#agentic-loop#turn-2');
    await registry.finalise(ac2.signal, 'completed');

    await drainSink(sink);

    expect(h1.operationId).not.toBe(h2.operationId);
    const records = await readAllRecords();
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.operation_id).sort()).toStrictEqual([
      'sess-1#agentic-loop#turn-1',
      'sess-1#agentic-loop#turn-2',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Drain / queueWrite: internal errors fail-fast, not silently green (P06-D8)
// ---------------------------------------------------------------------------

/**
 * Filesystem port whose appendFile throws a non-errno (internal/programming)
 * error. Extends FailingAppendFilesystem to inherit the real ensureDir/
 * openExclusive so start() creates the claim file successfully.
 */
class InternalErrorFilesystem extends FailingAppendFilesystem {
  override async appendFile(): Promise<void> {
    throw new Error('internal append corruption');
  }
}

describe('OperationLifecycleRegistry — drain/queueWrite internal error (P06-D8)', () => {
  beforeEach(createOperationLifecycleTempDirectory);
  afterEach(removeOperationLifecycleTempDirectory);

  it('drain rejects when a queued write fails with an internal error', async () => {
    const failingFs = new InternalErrorFilesystem();
    const runUuid = crypto.randomUUID();
    const retention = new PerfRetention({
      dir,
      runUuid,
      maintenanceIntervalMs: 60_000,
    });
    const sink = new PerfSink({
      dir,
      runUuid,
      retention,
      fs: failingFs,
    });
    await sink.start();

    const { registry } = createRegistry({ sink, retention });
    const ac = new AbortController();
    registry.begin(ac.signal, 'sess-1#agentic-loop#uuid-1');
    // The write fails with an internal error — finalise rejects (fail-fast).
    await registry.finalise(ac.signal, 'completed').catch(() => {});

    // Drain must reject — the internal error is not silently swallowed.
    await expect(registry.drain()).rejects.toThrow(
      'internal append corruption',
    );

    // Best-effort cleanup.
    await sink.dispose().catch(() => {});
  });

  it('later records are not silently reported green after an internal failure', async () => {
    const failingFs = new InternalErrorFilesystem();
    const runUuid = crypto.randomUUID();
    const retention = new PerfRetention({
      dir,
      runUuid,
      maintenanceIntervalMs: 60_000,
    });
    const sink = new PerfSink({
      dir,
      runUuid,
      retention,
      fs: failingFs,
    });
    await sink.start();

    const { registry } = createRegistry({ sink, retention });
    const ac1 = new AbortController();
    registry.begin(ac1.signal, 'sess-1#agentic-loop#uuid-1');
    // First write fails — finalise rejects (fail-fast).
    await registry.finalise(ac1.signal, 'completed').catch(() => {});

    // Second op — its write chains after the first. With fail-fast semantics,
    // the rejected chain means the second finalise also rejects.
    const ac2 = new AbortController();
    registry.begin(ac2.signal, 'sess-1#agentic-loop#uuid-2');
    await expect(registry.finalise(ac2.signal, 'completed')).rejects.toThrow(
      'internal append corruption',
    );

    // Drain surfaces the failure — not silently green.
    await expect(registry.drain()).rejects.toThrow(
      'internal append corruption',
    );

    await sink.dispose().catch(() => {});
  });

  it('superseded sweep write failure is surfaced via drain (not hidden)', async () => {
    const failingFs = new InternalErrorFilesystem();
    const runUuid = crypto.randomUUID();
    const retention = new PerfRetention({
      dir,
      runUuid,
      maintenanceIntervalMs: 60_000,
    });
    const sink = new PerfSink({
      dir,
      runUuid,
      retention,
      fs: failingFs,
    });
    await sink.start();

    const { registry } = createRegistry({ sink, retention });
    // begin #1 — op1 active
    const ac1 = new AbortController();
    registry.begin(ac1.signal, 'sess-1#agentic-loop#uuid-1');
    // begin #2 — sweeps op1 as superseded (queued write, not individually awaited)
    const ac2 = new AbortController();
    registry.begin(ac2.signal, 'sess-1#agentic-loop#uuid-2');
    // Finalise op2 — its write chains after the superseded sweep
    await expect(registry.finalise(ac2.signal, 'completed')).rejects.toThrow(
      'internal append corruption',
    );

    // Drain must reject — the superseded sweep's internal error is NOT hidden.
    await expect(registry.drain()).rejects.toThrow(
      'internal append corruption',
    );

    await sink.dispose().catch(() => {});
  });
});

describe('OperationLifecycleRegistry — read-only active-operation snapshot (P12)', () => {
  beforeEach(createOperationLifecycleTempDirectory);
  afterEach(removeOperationLifecycleTempDirectory);

  it('returns null when no operation is active', () => {
    const { registry } = createRegistry();
    expect(registry.getActiveOperationSnapshot()).toBe(null);
  });

  it('returns provider, model, and monotonic elapsed for an active operation', () => {
    let mono = 1000;
    const provider = fixtureProvider({
      provider: 'openai',
      model: 'gpt-4o',
    });
    const { registry } = createRegistry({
      identity: provider,
      monotonicNow: () => mono,
    });
    const ac = new AbortController();
    registry.begin(ac.signal, 'sess#agentic-loop#uuid-1');

    mono = 2500;
    const snap = registry.getActiveOperationSnapshot();
    expect(snap).not.toBe(null);
    expect(snap!.provider).toBe('openai');
    expect(snap!.model).toBe('gpt-4o');
    // Elapsed = 2500 - 1000 = 1500 ms (monotonic).
    expect(snap!.elapsedMs).toBe(1500);
  });

  it('returns null after the operation is finalised', async () => {
    const mono = 1000;
    const { registry, retention } = createRegistry({
      monotonicNow: () => mono,
    });
    await retention.start();
    const ac = new AbortController();
    registry.begin(ac.signal, 'sess#agentic-loop#uuid-1');
    expect(registry.getActiveOperationSnapshot()).not.toBe(null);

    await registry.finalise(ac.signal, 'completed');
    expect(registry.getActiveOperationSnapshot()).toBe(null);
  });

  it('snapshot does not expose mutable operation state', () => {
    const { registry } = createRegistry();
    const ac = new AbortController();
    registry.begin(ac.signal, 'sess#agentic-loop#uuid-1');
    const snap = registry.getActiveOperationSnapshot();
    expect(snap).not.toBe(null);
    // Only provider, model, elapsedMs (and optional memory) — no measurement,
    // no status, no operationId, no signal.
    const keys = Object.keys(snap!);
    expect(keys).toContain('provider');
    expect(keys).toContain('model');
    expect(keys).toContain('elapsedMs');
    for (const key of keys) {
      expect(key).not.toMatch(/measurement|status|operationId|signal/i);
    }
  });
});
