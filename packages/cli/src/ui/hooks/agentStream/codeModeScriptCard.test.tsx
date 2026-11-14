/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A code mode script that fails or is cancelled still shows its script card
 * in the interactive CLI (issue #4084): a failed run's completed call
 * displays the card rather than the model-facing error JSON, and a run
 * cancelled while the CLI shows it leaves a cancelled card in history.
 * Real Agent with code mode over the FakeProvider, real scheduler hooks and
 * a real QuickJS subprocess.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { PolicyDecision } from '@vybestack/llxprt-code-core';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core';
import {
  buildScriptAgent,
  processesMatching,
  runTurn,
  scratchDir,
  scriptResponse,
  waitFor as waitUntil,
  type ScriptAgent,
} from '../../../../../agents/src/code-mode/__tests__/script-agent.js';
import { assertNoLiveWrappers } from '../../../../../agents/src/code-mode/__tests__/runtime-test-helpers.js';
import { cleanup, renderHook, waitFor } from '../../../__tests__/render.js';
import type { HistoryItem, HistoryItemToolGroup } from '../../types.js';
import { ToolCallStatus } from '../../types.js';
import { mapToDisplay } from '../toolMapping.js';
import { useToolSchedulerSetup } from './useAgentStreamLifecycle.js';

const noop = (): void => {};

function isToolGroup(
  item: Omit<HistoryItem, 'id'>,
): item is HistoryItemToolGroup {
  return item.type === 'tool_group';
}
const owned: ScriptAgent[] = [];

const ALLOW_SHELL = {
  toolName: 'run_shell_command',
  decision: PolicyDecision.ALLOW,
  priority: 2,
};

describe('code mode script cards for runs that do not succeed', () => {
  afterEach(async () => {
    cleanup();
    for (const agent of owned.splice(0)) await agent.cleanup();
    assertNoLiveWrappers();
  });

  async function scriptAgent(source: string, purpose: string) {
    const agent = await buildScriptAgent(
      [{ source, tools: ['run_shell_command'], purpose }],
      { workspace: scratchDir('cli-code-mode-card-'), rules: [ALLOW_SHELL] },
    );
    owned.push(agent);
    return agent.agent;
  }

  it('shows the script card, not the error JSON, for a failed run', async () => {
    const agent = await scriptAgent(
      'await tools["run_shell_command"]({ command: "echo before" }); throw new Error("stop here");',
      'fail on purpose',
    );
    const completed: CompletedToolCall[] = [];
    agent.tools.setDisplayCallbacks({
      onAllToolCallsComplete: (calls) => {
        completed.push(...calls);
      },
    });

    await runTurn(agent);

    const [tool] = mapToDisplay(completed).tools;
    expect(tool.status).toBe(ToolCallStatus.Error);
    const display = String(tool.resultDisplay);
    expect(display).toContain('Purpose: fail on purpose');
    expect(display).toContain('Status: failed SCRIPT_ERROR');
    expect(display).toContain('Tool calls: 1 (1 ok)');
    expect(display).not.toContain('{"ok"');
    expect((await scriptResponse(agent)).error?.code).toBe('SCRIPT_ERROR');
  }, 60_000);

  function mountToolDisplay(agent: Agent) {
    const added: Array<Omit<HistoryItem, 'id'>> = [];
    const hook = renderHook(() =>
      useToolSchedulerSetup(
        noop,
        () => undefined,
        noop,
        noop,
        (item: Omit<HistoryItem, 'id'>) => {
          added.push(item);
          return added.length;
        },
        () => agent.tools.openClientChannel(),
        (callbacks, options) =>
          agent.tools.subscribeChildTools(callbacks, options),
      ),
    );
    // The agent's own tool calls feed the same display state, as the
    // interactive stream wires them.
    agent.tools.setDisplayCallbacks({
      onToolCallsUpdate: (calls) =>
        hook.result.current.toolSchedulerResult[6](calls),
    });
    return { hook, added };
  }

  it('leaves a cancelled script card in history when the turn is cancelled', async () => {
    const agent = await scriptAgent(
      'await tools["run_shell_command"]({ command: "sleep 29.4084" }); return "finished";',
      'sleep until cancelled',
    );
    const { hook, added } = mountToolDisplay(agent);
    await waitFor(
      () => expect(hook.result.current.toolSchedulerResult[5]).toBe(true),
      { timeout: 10_000 },
    );

    const controller = new AbortController();
    const turn = runTurn(agent, controller.signal);
    await waitUntil(
      () => processesMatching('sleep 29.4084').length > 0,
      'the nested sleep to start',
    );
    controller.abort();
    await turn;

    const scriptGroups = (): HistoryItemToolGroup[] =>
      added
        .filter(isToolGroup)
        .filter((group) =>
          group.tools.some((tool) => tool.callId === 'script-call-1'),
        );
    await waitFor(() => expect(scriptGroups()).not.toHaveLength(0), {
      timeout: 20_000,
    });
    const groups = scriptGroups();
    expect(groups).toHaveLength(1);
    const [tool] = groups[0].tools;
    expect(tool.status).toBe(ToolCallStatus.Canceled);
    const display = String(tool.resultDisplay);
    expect(display).toContain('Purpose: sleep until cancelled');
    expect(display).toContain('CANCELLED');
    expect(display).toContain('sleep 29.4084');
    expect(processesMatching('sleep 29.4084')).toStrictEqual([]);
  }, 60_000);
});
