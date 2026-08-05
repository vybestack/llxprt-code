/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CodeRabbit round (PR #3050 / issue #3031) — the post-run timeout result must
 * carry the real subagent id (Finding 3).
 *
 * `createTimeoutResult` was called without `agentId` on the post-run timeout
 * path in `handleExecutionResult`, so the metadata fell back to
 * `DEFAULT_AGENT_ID` ('main') instead of the real subagent id. This test
 * drives the REAL TaskTool through `build(...).execute(...)` with a scope that
 * COMPLETES exactly as the timeout fires, exercising that specific path, and
 * asserts the result metadata carries the real agentId. It fails against the
 * pre-fix code (which would report 'main').
 */

import { describe, it, expect } from 'bun:test';
import { TaskTool } from '../src/tools/task.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubagentOrchestrator } from '../src/core/subagentOrchestrator.js';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { ToolErrorType } from '@vybestack/llxprt-code-tools/types/tool-error.js';
import { withBoundedGuard } from '@vybestack/llxprt-code-test-utils';

const REAL_AGENT_ID = 'agent-postrun-cr3031';

function makeConfig(settings: Record<string, number>): Config {
  return {
    getSessionId: () => 'session-postrun-cr3031',
    getEphemeralSettings: () => ({ ...settings }),
    isInteractive: () => false,
  } as unknown as Config;
}

/**
 * A stub orchestrator whose scope run RESOLVES (completes) precisely when the
 * launch abort signal fires — i.e. the run finishes at the same instant the
 * timeout aborts the controller. This exercises the post-run timeout branch in
 * `handleExecutionResult` (run resolved, but the timeout controller aborted
 * while the foreground signal did not), which is the path that previously
 * dropped the agentId.
 */
function makeResolvingOnAbortOrchestrator(): {
  orchestrator: SubagentOrchestrator;
  resolved: Promise<boolean>;
} {
  let markResolved: (value: boolean) => void = () => {};
  const resolved = new Promise<boolean>((resolve) => {
    markResolved = resolve;
  });

  const runFn = (signal: AbortSignal): Promise<void> =>
    new Promise<void>((resolve) => {
      const finish = () => {
        markResolved(true);
        resolve();
      };
      if (signal.aborted) {
        finish();
        return;
      }
      signal.addEventListener('abort', finish, { once: true });
    });

  const orchestrator = {
    launch: async (_request: unknown, signal: AbortSignal) => ({
      agentId: REAL_AGENT_ID,
      scope: {
        output: {
          emitted_vars: {},
          terminate_reason: SubagentTerminateMode.GOAL,
        },
        runNonInteractive: () => runFn(signal),
        runInteractive: () => runFn(signal),
        onMessage: undefined,
      },
      dispose: async () => {},
      prompt: {},
      profile: {},
      config: {},
      runtime: {},
    }),
  } as unknown as SubagentOrchestrator;

  return { orchestrator, resolved };
}

describe('CodeRabbit #3031 — post-run timeout result carries the real agentId', () => {
  it('attributes a cut-short run to the real subagent id, not DEFAULT_AGENT_ID', async () => {
    const { orchestrator, resolved } = makeResolvingOnAbortOrchestrator();
    const tool = new TaskTool(
      makeConfig({
        'task-default-timeout-seconds': 60,
        'task-max-timeout-seconds': 0.05, // 50ms
      }),
      { orchestratorFactory: () => orchestrator },
    );

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'do work',
      timeout_seconds: 5,
    });

    const result = await withBoundedGuard(
      invocation.execute(new AbortController().signal),
    );

    // The run resolved exactly as the timeout fired.
    expect(await resolved).toBe(true);
    // It is a genuine timeout result.
    expect(result.error?.type).toBe(ToolErrorType.TIMEOUT);
    expect(result.metadata?.timedOut).toBe(true);
    // The whole point of this PR: a caller can attribute a cut-short run.
    // Pre-fix this was 'main' (DEFAULT_AGENT_ID); post-fix it is the real id.
    expect(result.metadata?.agentId).toBe(REAL_AGENT_ID);
    expect(result.metadata?.agentId).not.toBe('main');
  });
});
