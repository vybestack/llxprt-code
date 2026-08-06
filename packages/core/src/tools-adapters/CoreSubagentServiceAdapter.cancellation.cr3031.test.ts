/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CodeRabbit round (PR #3050 / issue #3031) — timeout vs cancellation
 * classification and configured-value validation in the core subagent adapter.
 *
 * Behavioural tests (bun:test) that fail against the pre-fix code:
 *  - A parent-signal (user) abort is reported as a CANCELLATION, not a
 *    TIMEOUT, on the foreground launch path, the async launch-failure path,
 *    and the background execution path (Finding 1).
 *  - Under an unbounded resolution (max -1 + timeout -1), cancelling does NOT
 *    throw and does NOT leave the async task in 'running' (Finding 1).
 *  - A configured default/maximum of 0, -2, or Infinity is rejected with an
 *    error naming the setting, for both the task and shell paths (Finding 2).
 */

import { describe, it, expect } from 'bun:test';
import {
  CoreSubagentServiceAdapter,
  type CoreSubagentLauncher,
  type CoreSubagentLaunchResult,
} from './CoreSubagentServiceAdapter.js';
import {
  handleAsyncLaunchFailure,
  type CoreTimeoutSetup,
} from './coreSubagentServiceHelpers.js';
import { CoreShellToolHostAdapter } from './CoreShellToolHostAdapter.js';
import { AsyncTaskManager } from '../services/asyncTaskManager.js';
import { SubagentTerminateMode } from '../core/subagentTypes.js';
import { resolveTimeout } from '@vybestack/llxprt-code-tools/utils/timeoutResolution.js';
import { ToolErrorType } from '@vybestack/llxprt-code-tools';
import { withBoundedGuard } from '@vybestack/llxprt-code-test-utils';
import type { Config } from '../config/config.js';
import type { SubagentManager } from '../config/subagentManager.js';
import type { ProfileManager } from '@vybestack/llxprt-code-settings';

function makeConfig(settings: Record<string, unknown>): Config {
  return {
    getEphemeralSettings: () => ({ ...settings }),
    getSessionId: () => 'session-cr3031',
    isInteractive: () => false,
    getSettingsService: () =>
      ({
        getAllGlobalSettings: () => ({ subagents: { asyncEnabled: true } }),
      }) as unknown,
  } as unknown as Config;
}

function buildAdapter(
  config: Config,
  launch: (
    request: unknown,
    signal: AbortSignal,
  ) => Promise<CoreSubagentLaunchResult>,
  asyncTaskManager?: AsyncTaskManager,
): CoreSubagentServiceAdapter {
  const fakeOrchestrator = {
    launch,
  } as unknown as CoreSubagentLauncher;
  return new CoreSubagentServiceAdapter({
    managerProvider: () => ({}) as unknown as SubagentManager,
    profileManagerProvider: () => ({}) as unknown as ProfileManager,
    config,
    isInteractiveEnvironment: () => false,
    orchestratorFactory: () => fakeOrchestrator,
    ...(asyncTaskManager !== undefined
      ? { getAsyncTaskManager: () => asyncTaskManager }
      : {}),
  });
}

function completingLaunchResult(): CoreSubagentLaunchResult {
  const runFn = async () => {};
  return {
    agentId: 'agent-cr3031',
    scope: {
      output: {
        terminate_reason: SubagentTerminateMode.GOAL,
        emitted_vars: {},
      },
      onMessage: undefined,
      runInteractive: runFn,
      runNonInteractive: runFn,
    },
    dispose: async () => {},
  } as unknown as CoreSubagentLaunchResult;
}

/** Scope that rejects with an AbortError precisely when `signal` aborts. */
function abortingLaunchResult(signal: AbortSignal): CoreSubagentLaunchResult {
  const runFn = (): Promise<void> =>
    new Promise<void>((_resolve, reject) => {
      const trip = () => {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      };
      if (signal.aborted) {
        trip();
        return;
      }
      signal.addEventListener('abort', trip, { once: true });
    });
  return {
    agentId: 'agent-cr3031',
    scope: {
      output: {
        terminate_reason: SubagentTerminateMode.GOAL,
        emitted_vars: {},
      },
      onMessage: undefined,
      runInteractive: runFn,
      runNonInteractive: runFn,
    },
    dispose: async () => {},
  } as unknown as CoreSubagentLaunchResult;
}

describe('CodeRabbit #3031 — cancellation vs timeout classification', () => {
  it('foreground: a parent-signal abort during launch is a CANCELLATION, not a TIMEOUT', async () => {
    // The parent signal is already aborted: createTimeout relays it onto the
    // timeout controller, and launch throws AbortError. Pre-fix the outer
    // catch saw timeoutController.signal.aborted and returned TIMEOUT.
    const parent = new AbortController();
    parent.abort();
    const launch = async (_req: unknown, signal: AbortSignal) => {
      if (signal.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      }
      return completingLaunchResult();
    };
    const adapter = buildAdapter(
      makeConfig({
        'task-default-timeout-seconds': 60,
        'task-max-timeout-seconds': 0.4,
      }),
      launch,
    );

    const result = await adapter.executeSubagent(
      { name: 'helper', prompt: 'work' },
      { signal: parent.signal },
    );

    expect(result.errorType).not.toBe(ToolErrorType.TIMEOUT);
    expect(result.metadata?.cancelled).toBe(true);
    expect(String(result.llmContent)).not.toContain('TIMEOUT');
  });

  it('async launch-failure: a parent-signal abort is a CANCELLATION, not a TIMEOUT', async () => {
    // Pre-fix handleAsyncLaunchFailure treated timeoutController.signal.aborted
    // alone as a timeout, even though the parent signal drove the abort.
    const resolution = resolveTimeout(-1, 900, 1800);
    const parentSignal = AbortSignal.abort();
    const timeoutController = new AbortController();
    timeoutController.abort(); // relayed from the parent
    const timeout: CoreTimeoutSetup = {
      timeoutMs: resolution.effectiveTimeoutSeconds! * 1000,
      resolution,
      timeoutController,
      timeoutId: null,
    };
    const err = new Error('Aborted');
    err.name = 'AbortError';

    const result = await handleAsyncLaunchFailure(
      err,
      timeout,
      undefined,
      'booking-1',
      { cancelReservation: () => undefined },
      parentSignal,
    );

    expect(result.errorType).not.toBe(ToolErrorType.TIMEOUT);
    expect(result.metadata?.cancelled).toBe(true);
    expect(result.metadata?.timedOut).not.toBe(true);
  });

  it('async launch-failure: under an unbounded resolution a parent abort does NOT throw', async () => {
    // Pre-fix this path called describeTaskTimeout -> requireEffectiveTimeoutSeconds,
    // which throws for an unbounded resolution, escaping as an unhandled rejection.
    const resolution = resolveTimeout(-1, 900, -1);
    expect(resolution.effectiveTimeoutSeconds).toBeUndefined();
    const parentSignal = AbortSignal.abort();
    const timeoutController = new AbortController();
    timeoutController.abort();
    const timeout: CoreTimeoutSetup = {
      timeoutMs: undefined,
      resolution,
      timeoutController,
      timeoutId: null,
    };
    const err = new Error('Aborted');
    err.name = 'AbortError';

    const result = await handleAsyncLaunchFailure(
      err,
      timeout,
      undefined,
      'booking-1',
      { cancelReservation: () => undefined },
      parentSignal,
    );

    expect(result.metadata?.cancelled).toBe(true);
    expect(result.metadata?.timedOut).not.toBe(true);
  });

  it('background execution: a parent abort cancels the task (bounded resolution)', async () => {
    const taskManager = new AsyncTaskManager();
    const launch = async (_req: unknown, signal: AbortSignal) =>
      abortingLaunchResult(signal);
    const adapter = buildAdapter(
      makeConfig({
        'task-default-timeout-seconds': 60,
        'task-max-timeout-seconds': 0.4,
      }),
      launch,
      taskManager,
    );

    const parent = new AbortController();
    const result = await adapter.executeSubagent(
      { name: 'helper', prompt: 'work', async: true },
      { signal: parent.signal },
    );
    expect(result.metadata?.async).toBe(true);

    // Cancel via the parent signal (user cancellation).
    setTimeout(() => parent.abort(), 20);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const task = taskManager.getTask('agent-cr3031');
    // Pre-fix the background catch saw timeoutController.signal.aborted and
    // called failTaskIfTimeout -> status 'failed'. Post-fix it cancels.
    expect(task?.status).toBe('cancelled');
  });

  it('background execution: under max -1 + timeout -1, cancelling does NOT throw and does NOT leave the task running', async () => {
    const taskManager = new AsyncTaskManager();
    const launch = async (_req: unknown, signal: AbortSignal) =>
      abortingLaunchResult(signal);
    const adapter = buildAdapter(
      makeConfig({
        'task-default-timeout-seconds': 60,
        'task-max-timeout-seconds': -1,
      }),
      launch,
      taskManager,
    );

    const parent = new AbortController();
    await adapter.executeSubagent(
      {
        name: 'helper',
        prompt: 'work',
        async: true,
        timeoutSeconds: -1,
      },
      { signal: parent.signal },
    );

    // Cancel via the parent signal under an unbounded resolution. Pre-fix the
    // background catch called failTaskIfTimeout -> describeTaskTimeout ->
    // requireEffectiveTimeoutSeconds, which THROWS (unhandled rejection) and
    // leaves the task stuck in 'running'.
    setTimeout(() => parent.abort(), 20);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const task = taskManager.getTask('agent-cr3031');
    expect(task?.status).toBe('cancelled');
  });
});

describe('CodeRabbit #3031 — configured timeout values are validated (Finding 2)', () => {
  it.each([0, -2, Infinity] as const)(
    'rejects an invalid task-max-timeout-seconds (%s) with an error naming the setting',
    async (badMax) => {
      const adapter = buildAdapter(
        makeConfig({
          'task-default-timeout-seconds': 60,
          'task-max-timeout-seconds': badMax,
        }),
        async () => completingLaunchResult(),
      );

      const result = await withBoundedGuard(
        adapter.executeSubagent({ name: 'helper', prompt: 'work' }),
      );

      expect(result.success).toBe(false);
      // Pre-fix the bad value flowed through unvalidated; post-fix the
      // resolution-boundary check rejects it naming the setting.
      expect(String(result.error)).toContain('task-max-timeout-seconds');
      expect(String(result.error)).toMatch(/greater than zero|-1/);
    },
  );

  it.each([0, -2, Infinity] as const)(
    'rejects an invalid task-default-timeout-seconds (%s) with an error naming the setting',
    async (badDefault) => {
      const adapter = buildAdapter(
        makeConfig({
          'task-default-timeout-seconds': badDefault,
          'task-max-timeout-seconds': 100,
        }),
        async () => completingLaunchResult(),
      );

      const result = await withBoundedGuard(
        adapter.executeSubagent({ name: 'helper', prompt: 'work' }),
      );

      expect(result.success).toBe(false);
      expect(String(result.error)).toContain('task-default-timeout-seconds');
    },
  );

  it.each([0, -2, Infinity] as const)(
    'rejects an invalid shell-max-timeout-seconds (%s) at the shell host resolution boundary',
    (badMax) => {
      const host = new CoreShellToolHostAdapter(
        makeConfig({
          'shell-default-timeout-seconds': 60,
          'shell-max-timeout-seconds': badMax,
        }),
      );
      expect(() => host.getTimeoutConfig()).toThrow(
        /shell-max-timeout-seconds/,
      );
    },
  );

  it.each([0, -2, Infinity] as const)(
    'rejects an invalid shell-default-timeout-seconds (%s) at the shell host resolution boundary',
    (badDefault) => {
      const host = new CoreShellToolHostAdapter(
        makeConfig({
          'shell-default-timeout-seconds': badDefault,
          'shell-max-timeout-seconds': 100,
        }),
      );
      expect(() => host.getTimeoutConfig()).toThrow(
        /shell-default-timeout-seconds/,
      );
    },
  );
});
