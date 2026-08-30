/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3031 — async `task` timeout observability.
 *
 * Behavioural tests driving the REAL TaskTool (async mode) through its public
 * `build(...).execute(...)` path. They assert that:
 *  - the async launch result carries the timeout metadata + clamp notice
 *    (Finding 1: previously the async path returned before the metadata wrap);
 *  - when the run is cut short by a timeout, the recorded failure (stored via
 *    failTask and surfaced through check_async_tasks) names the effective bound
 *    and the raisable settings, rather than "Aborted" or a bare
 *    "Async task timed out";
 *  - the launch itself is bounded by the timeout (the launch abort signal
 *    fires when the timer elapses, not only after launch resolves).
 */

import { describe, it, expect } from 'bun:test';
import { TaskTool } from '../src/tools/task.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { SubagentOrchestrator } from '../src/core/subagentOrchestrator.js';
import { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';

function makeConfig(settings: Record<string, number>): Config {
  return {
    getSessionId: () => 'session-async-3031',
    getEphemeralSettings: () => ({ ...settings }),
    isInteractive: () => false,
    getSettingsService: () =>
      ({
        getAllGlobalSettings: () => ({ subagents: { asyncEnabled: true } }),
      }) as unknown,
  } as unknown as Config;
}

describe('Issue #3031 — async task timeout observability', () => {
  it('the async launch result carries clamp metadata + notice for -1 under a finite max', async () => {
    const launchMock = mockLaunchCompleting();
    const mockAsyncTaskManager = makeMockAsyncTaskManager();
    const tool = new TaskTool(
      makeConfig({
        'task-default-timeout-seconds': 60,
        'task-max-timeout-seconds': 120,
      }),
      {
        messageBus: new MessageBus(),
        orchestratorFactory: () =>
          ({ launch: launchMock }) as unknown as SubagentOrchestrator,
        getAsyncTaskManager: () =>
          mockAsyncTaskManager.manager as unknown as AsyncTaskManager,
        isInteractiveEnvironment: () => false,
      },
    );

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'do async work',
      async: true,
      timeout_seconds: -1,
    });

    const result = await invocation.execute(new AbortController().signal);
    // Allow the background run to settle.
    await new Promise((resolve) => setTimeout(resolve, 10));

    // The launch result must carry the clamp metadata (Finding 1).
    expect(result.metadata?.timeoutClamped).toBe(true);
    expect(result.metadata?.requestedTimeoutSeconds).toBe(-1);
    expect(result.metadata?.effectiveTimeoutSeconds).toBe(120);
    const content = String(result.llmContent);
    expect(content).toContain('reduced to the configured ceiling of 120s');
    expect(content).toContain('task-max-timeout-seconds');
  });

  it('records a legible timeout failure naming the bound and settings (not "Aborted")', async () => {
    const manager = new AsyncTaskManager();
    const failTaskSpy = spyFailTask(manager);
    const launchMock = mockLaunchHangingUntilAbort();

    const tool = new TaskTool(
      makeConfig({
        'task-default-timeout-seconds': 60,
        'task-max-timeout-seconds': 0.05, // 50ms
      }),
      {
        messageBus: new MessageBus(),
        orchestratorFactory: () =>
          ({ launch: launchMock }) as unknown as SubagentOrchestrator,
        getAsyncTaskManager: () => manager,
        isInteractiveEnvironment: () => false,
      },
    );

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'slow async work',
      async: true,
      timeout_seconds: -1,
    });

    await invocation.execute(new AbortController().signal);
    // Wait for the 50ms timeout to fire and the background run to settle.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(failTaskSpy.calls.length).toBe(1);
    const [agentId, reason] = failTaskSpy.calls[0];
    expect(agentId).toBe('agent-async-3031');
    expect(reason).toContain('TIMEOUT');
    expect(reason).toContain('0.05s');
    expect(reason).toContain('task-max-timeout-seconds');
    expect(reason).not.toBe('Async task timed out');
    expect(reason).not.toBe('Aborted');
  });

  it('bounds the launch itself by the timeout (launch signal aborts on timeout)', async () => {
    const manager = new AsyncTaskManager();
    let capturedLaunchSignal: AbortSignal | undefined;
    const launchMock = async (_req: unknown, signal: AbortSignal) => {
      capturedLaunchSignal = signal;
      // Simulate a slow launch (e.g. config/profile loading) that does not
      // return until the timeout aborts it.
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      // Once aborted, throw so the launch path records the timeout.
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    };

    const tool = new TaskTool(
      makeConfig({
        'task-default-timeout-seconds': 60,
        'task-max-timeout-seconds': 0.05, // 50ms
      }),
      {
        messageBus: new MessageBus(),
        orchestratorFactory: () =>
          ({ launch: launchMock }) as unknown as SubagentOrchestrator,
        getAsyncTaskManager: () => manager,
        isInteractiveEnvironment: () => false,
      },
    );

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'slow launch',
      async: true,
      timeout_seconds: -1,
    });

    await invocation.execute(new AbortController().signal);
    // Wait for the timeout to fire during the pending launch.
    await new Promise((resolve) => setTimeout(resolve, 200));

    // The launch signal must have been aborted by the timeout — proving the
    // launch itself is bounded, not just the post-launch scope run.
    expect(capturedLaunchSignal).toBeDefined();
    expect(capturedLaunchSignal!.aborted).toBe(true);
  });
});

// --- helpers -------------------------------------------------------------

function mockLaunchCompleting() {
  return async () => ({
    agentId: 'agent-async-3031',
    scope: {
      output: {
        terminate_reason: SubagentTerminateMode.GOAL,
        emitted_vars: {},
      },
      runNonInteractive: async () => {},
      runInteractive: async () => {},
      onMessage: undefined,
    },
    dispose: async () => {},
  });
}

function mockLaunchHangingUntilAbort() {
  return async (_req: unknown, signal: AbortSignal) => {
    const scope = {
      output: {
        terminate_reason: SubagentTerminateMode.GOAL,
        emitted_vars: {},
      },
      runNonInteractive: () =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        }),
      runInteractive: undefined,
      onMessage: undefined,
    };
    return {
      agentId: 'agent-async-3031',
      scope,
      dispose: async () => {},
    };
  };
}

interface MockAsyncTaskManager {
  manager: {
    canLaunchAsync: () => { allowed: boolean };
    tryReserveAsyncSlot: () => string;
    registerTask: () => void;
    completeTask: () => void;
    failTask: () => void;
    getTask: () => { status: string } | undefined;
  };
}

function makeMockAsyncTaskManager(): MockAsyncTaskManager {
  return {
    manager: {
      canLaunchAsync: () => ({ allowed: true }),
      tryReserveAsyncSlot: () => 'booking-1',
      registerTask: () => {},
      completeTask: () => {},
      failTask: () => {},
      getTask: () => ({ status: 'running' }),
    },
  };
}

function spyFailTask(manager: AsyncTaskManager): {
  calls: [string, string][];
} {
  const calls: [string, string][] = [];
  const original = manager.failTask.bind(manager);
  manager.failTask = (agentId: string, reason: string) => {
    calls.push([agentId, reason]);
    return original(agentId, reason);
  };
  return { calls };
}
