/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TaskTool streaming-lifecycle tests (issue #3288).
 *
 * Task streaming installs a relay on `scope.onMessage` and must put the
 * caller's handler back on every terminal path, so a scope that outlives one
 * task does not keep relaying into a closed stream. These tests drive the real
 * TaskTool execution path (success, subagent error, mid-run cancellation) and
 * assert the observable state of the scope afterwards.
 */

import { describe, it, expect, vi } from 'bun:test';
import { TaskTool } from './task.js';
import { createTaskToolConfig } from './task-test-helpers.js';
import type { SubagentOrchestrator } from '../core/subagentOrchestrator.js';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';

interface RestorationScope {
  output: {
    emitted_vars: Record<string, string>;
    terminate_reason: SubagentTerminateMode;
  };
  runInteractive: ReturnType<typeof vi.fn>;
  runNonInteractive: ReturnType<typeof vi.fn>;
  onMessage?: (message: string) => void;
}

/**
 * Builds a TaskTool whose launched scope already carries `existingHandler` and
 * whose interactive run is driven by `run` (which receives the live scope so a
 * test can exercise the relay that streaming installed).
 */
function createRestorationHarness(
  agentId: string,
  existingHandler: (message: string) => void,
  run: (scope: RestorationScope) => Promise<void>,
): { scope: RestorationScope; tool: TaskTool } {
  const scope: RestorationScope = {
    output: {
      emitted_vars: {},
      terminate_reason: SubagentTerminateMode.GOAL,
    },
    runInteractive: vi.fn().mockImplementation(() => run(scope)),
    runNonInteractive: vi.fn(),
    onMessage: existingHandler,
  };
  const launch = vi.fn().mockResolvedValue({
    agentId,
    scope,
    dispose: vi.fn().mockResolvedValue(undefined),
    prompt: {} as unknown,
    profile: {} as unknown,
    config: {} as unknown,
    runtime: {} as unknown,
  });
  const tool = new TaskTool(createTaskToolConfig(), {
    orchestratorFactory: () => ({ launch }) as unknown as SubagentOrchestrator,
    isInteractiveEnvironment: () => true,
  });
  return { scope, tool };
}

describe('TaskTool scope.onMessage restoration across task lifecycles', () => {
  it('restores the pre-existing handler after a successful run', async () => {
    const received: string[] = [];
    const existingHandler = (message: string): void => {
      received.push(message);
    };
    let relayDuringRun: ((message: string) => void) | undefined;
    const { scope, tool } = createRestorationHarness(
      'agent-restore-ok',
      existingHandler,
      async (liveScope) => {
        relayDuringRun = liveScope.onMessage;
        liveScope.onMessage?.('progress');
      },
    );
    const appended: string[] = [];

    await tool
      .build({ subagent_name: 'helper', goal_prompt: 'Do work' })
      .execute(new AbortController().signal, (update) => {
        if (update.mode === 'append') {
          appended.push(update.data);
        }
      });

    expect(relayDuringRun).not.toBe(existingHandler);
    expect(received).toStrictEqual(['progress']);
    expect(appended).toStrictEqual([
      '<subagent name="helper" id="agent-restore-ok">\n',
      'progress',
      '</subagent name="helper" id="agent-restore-ok">\n',
    ]);
    expect(scope.onMessage).toBe(existingHandler);
  });

  it('restores the pre-existing handler after the subagent throws', async () => {
    const received: string[] = [];
    const existingHandler = (message: string): void => {
      received.push(message);
    };
    const { scope, tool } = createRestorationHarness(
      'agent-restore-error',
      existingHandler,
      async () => {
        throw new Error('crashed');
      },
    );

    const result = await tool
      .build({ subagent_name: 'helper', goal_prompt: 'Do work' })
      .execute(new AbortController().signal, () => {});

    expect(result.error?.message).toBe('crashed');
    expect(scope.onMessage).toBe(existingHandler);
  });

  it('restores the pre-existing handler after the run is aborted', async () => {
    const received: string[] = [];
    const existingHandler = (message: string): void => {
      received.push(message);
    };
    const abortController = new AbortController();
    let signalRunStarted: (() => void) | undefined;
    const runStarted = new Promise<void>((resolve) => {
      signalRunStarted = resolve;
    });
    const { scope, tool } = createRestorationHarness(
      'agent-restore-abort',
      existingHandler,
      (liveScope) =>
        new Promise<void>((_resolve, reject) => {
          // Proves the relay is installed before the abort lands, so this
          // exercises the mid-run cancellation path rather than the
          // aborted-during-launch early return.
          expect(liveScope.onMessage).not.toBe(existingHandler);
          abortController.signal.addEventListener(
            'abort',
            () => {
              const error = new Error('run aborted');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true },
          );
          signalRunStarted?.();
        }),
    );

    const execution = tool
      .build({ subagent_name: 'helper', goal_prompt: 'Do work' })
      .execute(abortController.signal, () => {});
    await runStarted;
    abortController.abort();
    const result = await execution;

    expect(result.metadata?.cancelled).toBe(true);
    expect(scope.onMessage).toBe(existingHandler);
  });
});
