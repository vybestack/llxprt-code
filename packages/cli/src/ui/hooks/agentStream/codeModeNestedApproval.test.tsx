/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A code mode nested call that needs approval reaches the interactive CLI's
 * tool display (issue #4084): it appears as a waiting confirmation labelled
 * with its script, the answer given through the confirmation's own handler
 * (what the confirmation keys call) drives the run, and finished nested
 * calls stay inside the script card instead of becoming history items.
 * Real Agent with code mode over the FakeProvider, real scheduler hooks.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-core';
import {
  buildScriptAgent,
  runTurn,
  scratchDir,
  scriptResponse,
  type ScriptAgent,
} from '../../../../../agents/src/code-mode/__tests__/script-agent.js';
import { assertNoLiveWrappers } from '../../../../../agents/src/code-mode/__tests__/runtime-test-helpers.js';
import { cleanup, renderHook, waitFor } from '../../../__tests__/render.js';
import type { HistoryItem } from '../../types.js';
import { ToolCallStatus } from '../../types.js';
import { mapToDisplay } from '../toolMapping.js';
import { useToolSchedulerSetup } from './useAgentStreamLifecycle.js';

const noop = (): void => {};
const owned: ScriptAgent[] = [];

describe('code mode in the interactive CLI', () => {
  afterEach(async () => {
    cleanup();
    for (const agent of owned.splice(0)) await agent.cleanup();
    assertNoLiveWrappers();
  });

  async function scriptAgent(
    workspace: string,
    marker: string,
  ): Promise<ScriptAgent> {
    const agent = await buildScriptAgent(
      [
        {
          source: `const r = await tools["run_shell_command"]({ command: "touch ${marker}" }); return r.value.exitCode;`,
          tools: ['run_shell_command'],
          purpose: 'create the marker',
        },
      ],
      { workspace },
    );
    owned.push(agent);
    return agent;
  }

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
    return { hook, added };
  }

  async function waitingNestedConfirmation(
    hook: ReturnType<typeof mountToolDisplay>['hook'],
  ) {
    await waitFor(
      () =>
        expect(
          hook.result.current.toolSchedulerResult[0].some(
            (call) => call.status === 'awaiting_approval',
          ),
        ).toBe(true),
      { timeout: 20_000 },
    );
    const group = mapToDisplay(hook.result.current.toolSchedulerResult[0]);
    const waiting = group.tools.find(
      (tool) => tool.status === ToolCallStatus.Confirming,
    );
    if (waiting?.confirmationDetails === undefined)
      throw new Error('No confirmable nested call is displayed');
    return waiting;
  }

  describe('code mode nested approvals in the CLI tool display', () => {
    it('shows the nested call as a labelled confirmation and runs it when approved', async () => {
      const workspace = scratchDir('cli-code-mode-approve-');
      const marker = join(workspace, 'approved');
      const { agent } = await scriptAgent(workspace, marker);
      const { hook, added } = mountToolDisplay(agent);
      await waitFor(
        () => expect(hook.result.current.toolSchedulerResult[5]).toBe(true),
        { timeout: 10_000 },
      );

      const turn = runTurn(agent);
      const waiting = await waitingNestedConfirmation(hook);

      expect(waiting.name).toBe('Shell');
      expect(waiting.scriptOrigin).toStrictEqual({
        parentCallId: 'script-call-1',
        purpose: 'create the marker',
      });
      expect(existsSync(marker)).toBe(false);
      await waiting.confirmationDetails?.onConfirm(
        ToolConfirmationOutcome.ProceedOnce,
      );
      await turn;

      expect(existsSync(marker)).toBe(true);
      expect((await scriptResponse(agent)).value).toBe(0);
      // The finished nested call is summarized by the script card, not added
      // to history as its own tool group.
      expect(
        added.filter((item) => JSON.stringify(item).includes('#script-')),
      ).toStrictEqual([]);
    }, 60_000);

    it('ends the run with APPROVAL_DENIED when the confirmation is refused', async () => {
      const workspace = scratchDir('cli-code-mode-deny-');
      const marker = join(workspace, 'refused');
      const { agent } = await scriptAgent(workspace, marker);
      const { hook } = mountToolDisplay(agent);
      await waitFor(
        () => expect(hook.result.current.toolSchedulerResult[5]).toBe(true),
        { timeout: 10_000 },
      );

      const turn = runTurn(agent);
      const waiting = await waitingNestedConfirmation(hook);
      await waiting.confirmationDetails?.onConfirm(
        ToolConfirmationOutcome.Cancel,
      );
      await turn;

      expect(existsSync(marker)).toBe(false);
      const response = await scriptResponse(agent);
      expect(response.error?.code).toBe('APPROVAL_DENIED');
      expect(response.completedCalls).toStrictEqual([
        { tool: 'run_shell_command', status: 'denied' },
      ]);
    }, 60_000);
  });
});
