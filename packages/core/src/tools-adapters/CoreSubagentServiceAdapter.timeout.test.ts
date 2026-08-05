/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3031 — CoreSubagentServiceAdapter timeout ceiling semantics + clamp
 * observability. Behavioural tests (bun:test) driving the real adapter with a
 * stubbed orchestrator. Asserts parity with the agents `task` tool:
 *  - an above-maximum request is clamped and the result carries metadata + the
 *    clamp notice (Finding 2);
 *  - a timeout message names `timeout_seconds` and `task-max-timeout-seconds`
 *    (Finding 2);
 *  - a timeout occurring DURING orchestrator.launch is reported as a TIMEOUT,
 *    not misclassified as a user cancellation (Finding 2).
 */

import { describe, it, expect } from 'bun:test';
import {
  CoreSubagentServiceAdapter,
  type CoreSubagentLauncher,
  type CoreSubagentLaunchResult,
} from './CoreSubagentServiceAdapter.js';
import { SubagentTerminateMode } from '../core/subagentTypes.js';
import type { Config } from '../config/config.js';
import type { SubagentManager } from '../config/subagentManager.js';
import type { ProfileManager } from '@vybestack/llxprt-code-settings';
import { ToolErrorType } from '@vybestack/llxprt-code-tools';
import { withBoundedGuard } from '@vybestack/llxprt-code-test-utils';

function makeLaunchResult(opts?: { runBehavior?: 'complete' | 'hang' }): {
  launchResult: CoreSubagentLaunchResult;
} {
  const runFn =
    opts?.runBehavior === 'hang'
      ? () => new Promise<void>(() => {})
      : async () => {};
  const scope = {
    output: {
      terminate_reason: SubagentTerminateMode.GOAL,
      emitted_vars: {},
    },
    onMessage: undefined,
    runInteractive: runFn,
    runNonInteractive: runFn,
    getAgentId: () => 'agent-core-3031',
  };
  return {
    launchResult: {
      agentId: 'agent-core-3031',
      scope,
      dispose: async () => {},
    } as unknown as CoreSubagentLaunchResult,
  };
}

function makeConfig(settings: Record<string, number>): Config {
  return {
    getEphemeralSettings: () => ({ ...settings }),
    getSessionId: () => 'session-core-3031',
    isInteractive: () => false,
  } as unknown as Config;
}

/**
 * Builds a launch result whose scope rejects with an AbortError when the
 * given signal fires — mirroring how a real subagent runtime observes the
 * abort passed to orchestrator.launch.
 */
function makeAbortingLaunchResult(
  signal: AbortSignal,
): CoreSubagentLaunchResult {
  const abortingRun = (): Promise<void> =>
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
  const scope = {
    output: {
      terminate_reason: SubagentTerminateMode.GOAL,
      emitted_vars: {},
    },
    onMessage: undefined,
    runInteractive: abortingRun,
    runNonInteractive: abortingRun,
    getAgentId: () => 'agent-core-3031',
  };
  return {
    agentId: 'agent-core-3031',
    scope,
    dispose: async () => {},
  } as unknown as CoreSubagentLaunchResult;
}

function buildAdapter(
  config: Config,
  launch: (
    request: unknown,
    signal: AbortSignal,
  ) => Promise<CoreSubagentLaunchResult>,
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
  });
}

describe('Issue #3031 — CoreSubagentServiceAdapter timeout parity', () => {
  it('clamps an above-maximum request and surfaces metadata + clamp notice', async () => {
    const { launchResult } = makeLaunchResult({ runBehavior: 'complete' });
    const adapter = buildAdapter(
      makeConfig({
        'task-default-timeout-seconds': 60,
        'task-max-timeout-seconds': 100,
      }),
      async () => launchResult,
    );

    const result = await adapter.executeSubagent({
      name: 'helper',
      prompt: 'do work',
      timeoutSeconds: 9999,
    });

    expect(result.success).toBe(true);
    expect(result.metadata?.timeoutClamped).toBe(true);
    expect(result.metadata?.requestedTimeoutSeconds).toBe(9999);
    expect(result.metadata?.effectiveTimeoutSeconds).toBe(100);
    expect(String(result.llmContent)).toContain(
      'reduced to the configured ceiling of 100s',
    );
    expect(String(result.llmContent)).toContain('task-max-timeout-seconds');
  });

  it('honours a below-maximum request exactly with no clamp notice', async () => {
    const { launchResult } = makeLaunchResult({ runBehavior: 'complete' });
    const adapter = buildAdapter(
      makeConfig({
        'task-default-timeout-seconds': 60,
        'task-max-timeout-seconds': 100,
      }),
      async () => launchResult,
    );

    const result = await adapter.executeSubagent({
      name: 'helper',
      prompt: 'do work',
      timeoutSeconds: 5,
    });

    expect(result.success).toBe(true);
    expect(result.metadata?.timeoutClamped).toBe(false);
    expect(result.metadata?.effectiveTimeoutSeconds).toBe(5);
    expect(String(result.llmContent)).not.toContain('ceiling');
  });

  it('bounds -1 under a finite maximum and produces a legible timeout message', async () => {
    // The scope must react to the abort signal (captured at launch) just as a
    // real subagent runtime would: when the timeout fires it aborts the
    // controller, the scope rejects with an AbortError, and the adapter
    // classifies it as a TIMEOUT.
    const launchFn = async (_req: unknown, signal: AbortSignal) =>
      makeAbortingLaunchResult(signal);
    const adapter = buildAdapter(
      makeConfig({
        'task-default-timeout-seconds': 60,
        'task-max-timeout-seconds': 0.05,
      }),
      launchFn,
    );

    const result = await withBoundedGuard(
      adapter.executeSubagent({
        name: 'helper',
        prompt: 'do slow work',
        timeoutSeconds: -1,
      }),
    );

    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ToolErrorType.TIMEOUT);
    const content = String(result.llmContent);
    expect(content).toContain('TIMEOUT');
    expect(content).toContain('0.05s');
    expect(content).toContain('task-max-timeout-seconds');
    expect(content).toContain('timeout_seconds');
  });

  it('reports a launch-time timeout as TIMEOUT, not as a user cancellation', async () => {
    // The orchestrator launch hangs until the abort signal fires, then rejects
    // with an AbortError. Previously the outer catch classified ANY
    // AbortError as user cancellation; now a timeout-controller abort during
    // launch must be reported as TIMEOUT (Finding 2).
    const launchFn = async (_req: unknown, signal: AbortSignal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    };
    const adapter = buildAdapter(
      makeConfig({
        'task-default-timeout-seconds': 60,
        'task-max-timeout-seconds': 0.05,
      }),
      launchFn,
    );

    const result = await withBoundedGuard(
      adapter.executeSubagent({
        name: 'helper',
        prompt: 'slow launch',
        timeoutSeconds: -1,
      }),
    );

    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ToolErrorType.TIMEOUT);
    expect(String(result.llmContent)).toContain('TIMEOUT');
    expect(String(result.llmContent)).toContain('0.05s');
  });
});
