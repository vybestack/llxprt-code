/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TaskTool liveness heartbeat tests (issue #2540).
 *
 * Verifies that a healthy synchronous Task emits typed `status` liveness
 * events across the public live-output boundary during silent nested-tool
 * waits, that real progress resets liveness timing, that timers are cleared
 * on every terminal path, and that heartbeats never pollute content/history.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from '../testApi.js';
import { TaskTool } from './task.js';
import {
  createLivenessStatus,
  startTaskHeartbeat,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
} from './taskHeartbeat.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubagentOrchestrator } from '../core/subagentOrchestrator.js';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { LiveOutputUpdate } from '@vybestack/llxprt-code-tools';

function createConfig(): Config {
  return {
    getSessionId: () => 'session-123',
    getEphemeralSettings: () => ({
      'task-default-timeout-seconds': 60,
      'task-max-timeout-seconds': 120,
    }),
  } as unknown as Config;
}

interface PendingScope {
  output: {
    emitted_vars: Record<string, string>;
    terminate_reason: SubagentTerminateMode;
  };
  cancel: ReturnType<typeof vi.fn>;
  runInteractive: ReturnType<typeof vi.fn>;
  runNonInteractive: ReturnType<typeof vi.fn>;
  onMessage: ((message: string) => void) | undefined;
}

/**
 * Builds a mock scope whose run method never resolves until the test drives
 * it, simulating a subagent blocked on a long-running nested tool. `mode`
 * selects which run method the scope reports as pending.
 */
function createPendingScope(
  mode: 'interactive' | 'non-interactive' = 'interactive',
): {
  scope: PendingScope;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolveFn: (() => void) | null = null;
  let rejectFn: ((error: Error) => void) | null = null;
  const runPromise = new Promise<void>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  const pending = vi.fn(() => runPromise);
  const noop = vi.fn();
  const scope: PendingScope = {
    output: {
      emitted_vars: {},
      terminate_reason: SubagentTerminateMode.GOAL,
    },
    cancel: vi.fn(),
    runInteractive: mode === 'interactive' ? pending : noop,
    runNonInteractive: mode === 'non-interactive' ? pending : noop,
    onMessage: undefined,
  };
  return {
    scope,
    resolve: () => resolveFn?.(),
    reject: (error: Error) => rejectFn?.(error),
  };
}

function buildTool(scope: PendingScope): TaskTool {
  const launch = vi.fn().mockResolvedValue({
    agentId: 'agent-heartbeat',
    scope,
    dispose: vi.fn().mockResolvedValue(undefined),
    prompt: {},
    profile: {},
    config: {},
    runtime: {},
  });
  const orchestrator = { launch } as unknown as SubagentOrchestrator;
  return new TaskTool(createConfig(), {
    orchestratorFactory: () => orchestrator,
    isInteractiveEnvironment: () => true,
  });
}

describe('TaskHeartbeat unit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits typed status liveness snapshots at the configured interval', () => {
    const updates: LiveOutputUpdate[] = [];
    const hb = startTaskHeartbeat(
      (u) => updates.push(u),
      DEFAULT_HEARTBEAT_INTERVAL_MS,
    );
    vi.advanceTimersByTime(DEFAULT_HEARTBEAT_INTERVAL_MS * 3);
    hb.stop();
    expect(updates).toHaveLength(3);
    for (const u of updates) {
      expect(u.mode).toBe('status');
    }
    expect(updates[0]).toStrictEqual({
      mode: 'status',
      status: { kind: 'liveness', seq: 1 },
    });
    expect(updates[2]).toStrictEqual({
      mode: 'status',
      status: { kind: 'liveness', seq: 3 },
    });
  });

  it('reset() defers the next heartbeat until after a fresh quiet period', () => {
    const updates: LiveOutputUpdate[] = [];
    const hb = startTaskHeartbeat((u) => updates.push(u), 100);
    vi.advanceTimersByTime(90);
    hb.reset();
    vi.advanceTimersByTime(99);
    expect(updates).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(updates).toHaveLength(1);
    hb.stop();
  });

  it('stop() is idempotent and prevents any further emission', () => {
    const updates: LiveOutputUpdate[] = [];
    const hb = startTaskHeartbeat((u) => updates.push(u), 100);
    vi.advanceTimersByTime(100);
    expect(updates).toHaveLength(1);
    hb.stop();
    hb.stop();
    vi.advanceTimersByTime(1000);
    expect(updates).toHaveLength(1);
  });

  it('returns a no-op handle when updateOutput is undefined', () => {
    const hb = startTaskHeartbeat(undefined, 100);
    expect(() => {
      hb.reset();
      hb.stop();
      vi.advanceTimersByTime(1000);
    }).not.toThrow();
  });

  it('returns a no-op handle when interval is non-positive', () => {
    const updates: LiveOutputUpdate[] = [];
    const hb = startTaskHeartbeat((u) => updates.push(u), 0);
    vi.advanceTimersByTime(1000);
    expect(updates).toHaveLength(0);
    hb.stop();
  });

  it('returns a no-op handle for a negative interval without throwing', () => {
    const updates: LiveOutputUpdate[] = [];
    const hb = startTaskHeartbeat((u) => updates.push(u), -50);
    vi.advanceTimersByTime(1000);
    expect(updates).toHaveLength(0);
    hb.stop();
  });

  it('createLivenessStatus produces the typed snapshot shape', () => {
    expect(createLivenessStatus(7)).toStrictEqual({
      mode: 'status',
      status: { kind: 'liveness', seq: 7 },
    });
  });

  it('survives a throwing updateOutput and keeps ticking', () => {
    const updates: LiveOutputUpdate[] = [];
    let callCount = 0;
    const hb = startTaskHeartbeat((u) => {
      callCount += 1;
      updates.push(u);
      if (callCount === 2) {
        throw new Error('downstream stream error');
      }
    }, 100);

    vi.advanceTimersByTime(100);
    expect(updates).toHaveLength(1);
    // Second tick throws; the heartbeat must reschedule anyway.
    vi.advanceTimersByTime(100);
    expect(updates).toHaveLength(2);
    // Third tick proves the timer chain survived the exception.
    vi.advanceTimersByTime(100);
    expect(updates).toHaveLength(3);
    hb.stop();
  });

  it('returns a no-op handle when interval is Infinity', () => {
    const updates: LiveOutputUpdate[] = [];
    const hb = startTaskHeartbeat(
      (u) => updates.push(u),
      Number.POSITIVE_INFINITY,
    );
    vi.advanceTimersByTime(DEFAULT_HEARTBEAT_INTERVAL_MS * 3);
    expect(updates).toHaveLength(0);
    hb.stop();
  });

  it('honors a synchronous stop() invoked during the updateOutput callback', () => {
    const updates: LiveOutputUpdate[] = [];
    const hb = startTaskHeartbeat((u) => {
      updates.push(u);
      if (updates.length === 1) {
        hb.stop();
      }
    }, 100);

    vi.advanceTimersByTime(100);
    expect(updates).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(updates).toHaveLength(1);
  });

  it('honors a synchronous reset() invoked during the updateOutput callback', () => {
    const updates: LiveOutputUpdate[] = [];
    const hb = startTaskHeartbeat((u) => {
      updates.push(u);
      if (updates.length === 1) {
        hb.reset();
      }
    }, 100);

    vi.advanceTimersByTime(100);
    expect(updates).toHaveLength(1);
    vi.advanceTimersByTime(99);
    expect(updates).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(updates).toHaveLength(2);
    hb.stop();
  });
});

describe('TaskTool heartbeat integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits heartbeat status events while the subagent is silently pending', async () => {
    const { scope, resolve } = createPendingScope();
    const tool = buildTool(scope);
    const updates: LiveOutputUpdate[] = [];

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'do work',
    });
    const resultPromise = invocation.execute(
      new AbortController().signal,
      (u) => updates.push(u),
    );

    // Allow launch + opening tag to flush.
    await vi.advanceTimersByTimeAsync(0);
    // Advance well past several heartbeat intervals while still pending.
    await vi.advanceTimersByTimeAsync(DEFAULT_HEARTBEAT_INTERVAL_MS * 4);

    const statusUpdates = updates.filter((u) => u.mode === 'status');
    expect(statusUpdates.length).toBeGreaterThanOrEqual(3);

    resolve();
    await resultPromise;

    const tail = updates.slice(-1)[0];
    expect(tail).toBeDefined();
    expect(tail.mode).not.toBe('status');
  });

  it('does not emit heartbeat status events when no updateOutput is supplied', async () => {
    const { scope, resolve } = createPendingScope();
    const tool = buildTool(scope);

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'do work',
    });
    const resultPromise = invocation.execute(
      new AbortController().signal,
      undefined,
    );

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(DEFAULT_HEARTBEAT_INTERVAL_MS * 3);

    resolve();
    await resultPromise;
    // No throw is the contract; no observer means no heartbeat path.
    expect(scope.runInteractive).toHaveBeenCalled();
  });

  it('resets heartbeat timing when real subagent messages arrive', async () => {
    const { scope, resolve } = createPendingScope();
    const tool = buildTool(scope);
    const updates: LiveOutputUpdate[] = [];

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'do work',
    });
    const resultPromise = invocation.execute(
      new AbortController().signal,
      (u) => updates.push(u),
    );

    await vi.advanceTimersByTimeAsync(0);
    // Nearly at the heartbeat boundary, then push a real message.
    await vi.advanceTimersByTimeAsync(DEFAULT_HEARTBEAT_INTERVAL_MS - 1);
    scope.onMessage?.('real progress text\n');

    const statusBefore = updates.filter((u) => u.mode === 'status').length;
    expect(statusBefore).toBe(0);

    // Advance less than a full interval from the message; no heartbeat yet.
    await vi.advanceTimersByTimeAsync(DEFAULT_HEARTBEAT_INTERVAL_MS - 1);
    const statusMid = updates.filter((u) => u.mode === 'status').length;
    expect(statusMid).toBe(0);

    // Now the quiet window elapses and a heartbeat fires.
    await vi.advanceTimersByTimeAsync(1);
    const statusAfter = updates.filter((u) => u.mode === 'status').length;
    expect(statusAfter).toBe(1);

    resolve();
    await resultPromise;
  });

  it('stops the heartbeat on successful completion with no post-terminal status', async () => {
    const { scope, resolve } = createPendingScope();
    const tool = buildTool(scope);
    const updates: LiveOutputUpdate[] = [];

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'do work',
    });
    const resultPromise = invocation.execute(
      new AbortController().signal,
      (u) => updates.push(u),
    );

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(DEFAULT_HEARTBEAT_INTERVAL_MS * 2);
    resolve();
    const result = await resultPromise;

    const statusCountAtCompletion = updates.filter(
      (u) => u.mode === 'status',
    ).length;

    // Advance further after completion; no additional heartbeats.
    await vi.advanceTimersByTimeAsync(DEFAULT_HEARTBEAT_INTERVAL_MS * 3);
    const statusCountAfter = updates.filter((u) => u.mode === 'status').length;
    expect(statusCountAfter).toBe(statusCountAtCompletion);
    expect(result.error).toBeUndefined();
  });

  it('stops the heartbeat on Task timeout with no post-terminal status', async () => {
    // timeout_seconds is shorter than one heartbeat interval (50ms << 10s),
    // so the timeout fires before any heartbeat. The mock scope's
    // runInteractive returns a plain Promise that does not observe the
    // timeout controller's abort signal on its own, so the test drives the
    // rejection to mirror the real subagent detecting the abort. This matches
    // the established convention in task.timeout.test.ts.
    const { scope, reject } = createPendingScope();
    const tool = buildTool(scope);
    const updates: LiveOutputUpdate[] = [];

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'do work',
      timeout_seconds: 0.05,
    });
    const resultPromise = invocation.execute(
      new AbortController().signal,
      (u) => updates.push(u),
    );

    await vi.advanceTimersByTimeAsync(5);
    expect(scope.runInteractive).toHaveBeenCalled();

    // Advance past the 50ms task timeout; the timeout controller aborts.
    await vi.advanceTimersByTimeAsync(60);
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    reject(abortError);

    const result = await resultPromise;
    expect(result.error?.type).toBe('timeout');

    const statusAtTerminal = updates.filter((u) => u.mode === 'status').length;
    await vi.advanceTimersByTimeAsync(DEFAULT_HEARTBEAT_INTERVAL_MS * 3);
    const statusAfter = updates.filter((u) => u.mode === 'status').length;
    expect(statusAfter).toBe(statusAtTerminal);
  });

  it('stops the heartbeat on user abort with no post-terminal status', async () => {
    const { scope, reject } = createPendingScope();
    const tool = buildTool(scope);
    const updates: LiveOutputUpdate[] = [];

    const abortController = new AbortController();
    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'do work',
      timeout_seconds: 60,
    });
    const resultPromise = invocation.execute(abortController.signal, (u) =>
      updates.push(u),
    );

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(DEFAULT_HEARTBEAT_INTERVAL_MS);
    abortController.abort();
    // The scope's abort handler cancels; the pending runInteractive must
    // reject (mirroring the real subagent detecting the cancel).
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    reject(abortError);

    const result = await resultPromise;
    expect(result.error?.type).toBe('execution_failed');
    expect(scope.cancel).toHaveBeenCalledWith('User aborted task execution.');

    const statusAtTerminal = updates.filter((u) => u.mode === 'status').length;
    await vi.advanceTimersByTimeAsync(DEFAULT_HEARTBEAT_INTERVAL_MS * 3);
    const statusAfter = updates.filter((u) => u.mode === 'status').length;
    expect(statusAfter).toBe(statusAtTerminal);
  });

  it('does not pollute append content: heartbeat status events are never append data', async () => {
    const { scope, resolve } = createPendingScope();
    const tool = buildTool(scope);
    const captured = {
      appends: [] as string[],
      statuses: 0,
    };
    let xmlCloseSeen = false;

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'do work',
    });
    const resultPromise = invocation.execute(
      new AbortController().signal,
      (u) => {
        if (u.mode === 'append') {
          captured.appends.push(u.data);
          if (u.data.includes('</subagent')) {
            xmlCloseSeen = true;
          }
        } else if (u.mode === 'status') {
          captured.statuses += 1;
        }
      },
    );

    await vi.advanceTimersByTimeAsync(0);
    // Inject a real content message and let several heartbeats fire.
    scope.onMessage?.('real content\n');
    await vi.advanceTimersByTimeAsync(DEFAULT_HEARTBEAT_INTERVAL_MS * 3);
    resolve();
    await resultPromise;

    // The concatenated content must contain only opening tag, the real
    // message, and the closing tag — never any heartbeat text.
    const joined = captured.appends.join('');
    expect(joined).toContain('<subagent name="helper"');
    expect(joined).toContain('real content');
    expect(joined).toContain('</subagent name="helper"');
    expect(xmlCloseSeen).toBe(true);
    expect(joined).not.toMatch(/liveness|status/i);
    expect(captured.statuses).toBeGreaterThanOrEqual(2);
  });

  it('non-interactive path also receives heartbeats', async () => {
    const { scope, resolve } = createPendingScope('non-interactive');
    const launch = vi.fn().mockResolvedValue({
      agentId: 'agent-ni',
      scope,
      dispose: vi.fn().mockResolvedValue(undefined),
      prompt: {},
      profile: {},
      config: {},
      runtime: {},
    });
    const orchestrator = { launch } as unknown as SubagentOrchestrator;
    const tool = new TaskTool(createConfig(), {
      orchestratorFactory: () => orchestrator,
      isInteractiveEnvironment: () => false,
    });
    const updates: LiveOutputUpdate[] = [];

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'do work',
    });
    const resultPromise = invocation.execute(
      new AbortController().signal,
      (u) => updates.push(u),
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(scope.runNonInteractive).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DEFAULT_HEARTBEAT_INTERVAL_MS * 2);
    resolve();
    await resultPromise;

    const statusCount = updates.filter((u) => u.mode === 'status').length;
    expect(statusCount).toBeGreaterThanOrEqual(1);
  });
});
