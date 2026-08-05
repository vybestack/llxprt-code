/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3031 — `task` tool timeout ceiling semantics.
 *
 * Behavioural tests driving the REAL TaskTool through its public
 * `build(...).execute(...)` path with a stubbed SubagentOrchestrator whose
 * scope rejects on abort. They assert the corrected ceiling semantics:
 *  - `timeout_seconds: -1` under a finite maximum is BOUNDED (the subagent is
 *    really aborted and the result is a TIMEOUT), not unbounded.
 *  - a request above the maximum is clamped and the result surfaces it.
 *  - a request below the maximum is honoured exactly, with no clamp notice.
 *  - a maximum of `-1` with `-1` arms no timer (truly unbounded).
 */

import { describe, it, expect } from 'bun:test';
import { TaskTool } from '../src/tools/task.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubagentOrchestrator } from '../src/core/subagentOrchestrator.js';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { ToolErrorType } from '@vybestack/llxprt-code-tools/types/tool-error.js';
import { withBoundedGuard } from '@vybestack/llxprt-code-test-utils';

interface StubMode {
  /** 'hang' = reject only on abort; 'complete' = resolve immediately. */
  run: 'hang' | 'complete';
}

interface StubHandles {
  orchestrator: SubagentOrchestrator;
  /** Resolves true once the scope's run was actually aborted (bounded). */
  aborted: Promise<boolean>;
}

function makeConfig(settings: Record<string, number>): Config {
  return {
    getSessionId: () => 'session-3031',
    getEphemeralSettings: () => ({ ...settings }),
    isInteractive: () => false,
  } as unknown as Config;
}

/**
 * Builds a stub orchestrator whose scope either completes immediately or
 * rejects with an AbortError precisely when the launch abort signal fires.
 * The `aborted` handle resolves true once that rejection happened, proving the
 * run was bounded rather than left to hang forever.
 */
function makeStubOrchestrator(mode: StubMode): StubHandles {
  let launchSignal: AbortSignal | undefined;
  let markAborted: (value: boolean) => void = () => {};
  const aborted = new Promise<boolean>((resolve) => {
    markAborted = resolve;
  });

  const runPromise = (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      if (mode.run === 'complete') {
        resolve();
        return;
      }
      const trip = () => {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        markAborted(true);
        reject(err);
      };
      if (launchSignal?.aborted === true) {
        trip();
        return;
      }
      launchSignal?.addEventListener('abort', trip, { once: true });
    });

  const scope = {
    output: {
      emitted_vars: {},
      terminate_reason: SubagentTerminateMode.GOAL,
    },
    runNonInteractive: () => runPromise(),
    runInteractive: () => runPromise(),
    onMessage: undefined,
  };

  const orchestrator = {
    launch: async (_request: unknown, signal: AbortSignal) => {
      launchSignal = signal;
      return {
        agentId: 'agent-3031',
        scope,
        dispose: async () => {},
        prompt: {},
        profile: {},
        config: {},
        runtime: {},
      };
    },
  } as unknown as SubagentOrchestrator;

  return { orchestrator, aborted };
}

describe('Issue #3031 — task tool timeout ceiling semantics', () => {
  it('bounds timeout_seconds: -1 under a finite maximum (subagent is aborted)', async () => {
    const { orchestrator, aborted } = makeStubOrchestrator({ run: 'hang' });
    const tool = new TaskTool(
      makeConfig({
        'task-default-timeout-seconds': 60,
        'task-max-timeout-seconds': 0.1,
      }),
      { orchestratorFactory: () => orchestrator },
    );

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'do work',
      timeout_seconds: -1,
    });

    const result = await withBoundedGuard(
      invocation.execute(new AbortController().signal),
    );

    expect(await aborted).toBe(true);
    expect(result.error?.type).toBe(ToolErrorType.TIMEOUT);
    const content = String(result.llmContent);
    expect(content).toContain('0.1s');
    expect(content).toContain('task-max-timeout-seconds');
    expect(content).toContain('timeout_seconds');
    expect(result.metadata?.timeoutClamped).toBe(true);
    expect(result.metadata?.requestedTimeoutSeconds).toBe(-1);
    expect(result.metadata?.effectiveTimeoutSeconds).toBe(0.1);
  });

  it('clamps an above-maximum request and surfaces it in the result', async () => {
    const { orchestrator } = makeStubOrchestrator({ run: 'complete' });
    const tool = new TaskTool(
      makeConfig({
        'task-default-timeout-seconds': 60,
        'task-max-timeout-seconds': 0.1,
      }),
      { orchestratorFactory: () => orchestrator },
    );

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'do work',
      timeout_seconds: 9999,
    });

    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.metadata?.timeoutClamped).toBe(true);
    expect(result.metadata?.requestedTimeoutSeconds).toBe(9999);
    expect(result.metadata?.effectiveTimeoutSeconds).toBe(0.1);
    const content = String(result.llmContent);
    expect(content).toContain('reduced to the configured ceiling of 0.1s');
    expect(content).toContain('task-max-timeout-seconds');
  });

  it('honours a below-maximum request exactly with no clamp notice', async () => {
    const { orchestrator } = makeStubOrchestrator({ run: 'complete' });
    const tool = new TaskTool(
      makeConfig({
        'task-default-timeout-seconds': 60,
        'task-max-timeout-seconds': 100,
      }),
      { orchestratorFactory: () => orchestrator },
    );

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'do work',
      timeout_seconds: 5,
    });

    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.metadata?.timeoutClamped).toBe(false);
    expect(result.metadata?.requestedTimeoutSeconds).toBe(5);
    expect(result.metadata?.effectiveTimeoutSeconds).toBe(5);
    const content = String(result.llmContent);
    expect(content).not.toContain('ceiling');
  });

  it('arms no timer when both the maximum and request are -1 (unbounded)', async () => {
    const { orchestrator } = makeStubOrchestrator({ run: 'complete' });
    const tool = new TaskTool(
      makeConfig({
        'task-default-timeout-seconds': 60,
        'task-max-timeout-seconds': -1,
      }),
      { orchestratorFactory: () => orchestrator },
    );

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'do work',
      timeout_seconds: -1,
    });

    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.metadata?.effectiveTimeoutSeconds).toBeUndefined();
    expect(result.metadata?.timeoutClamped).toBe(false);
  });

  it('rejects timeout_seconds: -2 at validation with a clear message', () => {
    const { orchestrator } = makeStubOrchestrator({ run: 'complete' });
    const tool = new TaskTool(
      makeConfig({
        'task-default-timeout-seconds': 60,
        'task-max-timeout-seconds': 100,
      }),
      { orchestratorFactory: () => orchestrator },
    );
    let error: unknown;
    try {
      tool.build({
        subagent_name: 'helper',
        goal_prompt: 'do work',
        timeout_seconds: -2,
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/timeout_seconds/);
    expect(String(error)).toMatch(/-1/);
  });

  it('rejects timeout_seconds: 0 at validation with a clear message', () => {
    const { orchestrator } = makeStubOrchestrator({ run: 'complete' });
    const tool = new TaskTool(
      makeConfig({
        'task-default-timeout-seconds': 60,
        'task-max-timeout-seconds': 100,
      }),
      { orchestratorFactory: () => orchestrator },
    );
    expect(() =>
      tool.build({
        subagent_name: 'helper',
        goal_prompt: 'do work',
        timeout_seconds: 0,
      }),
    ).toThrow(/timeout_seconds/);
  });

  it('accepts timeout_seconds: -1 at validation (unlimited ask)', () => {
    const { orchestrator } = makeStubOrchestrator({ run: 'complete' });
    const tool = new TaskTool(
      makeConfig({
        'task-default-timeout-seconds': 60,
        'task-max-timeout-seconds': 100,
      }),
      { orchestratorFactory: () => orchestrator },
    );
    expect(() =>
      tool.build({
        subagent_name: 'helper',
        goal_prompt: 'do work',
        timeout_seconds: -1,
      }),
    ).not.toThrow();
  });
});
