/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Approvals, cancellation and cleanup of code mode runs (issue #4084): a
 * nested approval pauses the script, a refusal or a headless approval
 * requirement ends the run, approvals route only to their own run, and an
 * abort or an unawaited call leaves no subprocess and no running tool.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import {
  assertNoLiveWrappers,
  liveWrapperProcesses,
} from './__tests__/runtime-test-helpers.js';
import {
  buildScriptAgent,
  processesMatching,
  runTurn,
  scratchDir,
  scriptResponse,
  waitFor,
  type ScriptAgent,
} from './__tests__/script-agent.js';

const ALLOW_SHELL = {
  toolName: 'run_shell_command',
  decision: PolicyDecision.ALLOW,
  priority: 2,
};

const owned: ScriptAgent[] = [];

describe('code mode run lifecycle', () => {
  afterEach(async () => {
    for (const agent of owned.splice(0)) await agent.cleanup();
    assertNoLiveWrappers();
  });

  function track(agent: ScriptAgent): ScriptAgent {
    owned.push(agent);
    return agent;
  }

  const pause = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  describe('code mode approvals', () => {
    it('pauses the script at a nested approval and resumes it when approved', async () => {
      const workspace = scratchDir('code-mode-approve-');
      const marker = join(workspace, 'after-approval');
      const observed: Array<{ name: string; markerExisted: boolean }> = [];
      const agent = track(
        await buildScriptAgent(
          [
            {
              source: `
              const r = await tools["run_shell_command"]({ command: "touch ${marker}" });
              return r.value.exitCode;`,
              tools: ['run_shell_command'],
            },
          ],
          {
            workspace,
            config: {
              onApproval: async (request) => {
                await pause(300);
                observed.push({
                  name: request.name,
                  markerExisted: existsSync(marker),
                });
                return ToolConfirmationOutcome.ProceedOnce;
              },
            },
          },
        ),
      );
      await runTurn(agent.agent);

      expect(observed).toStrictEqual([
        { name: 'run_shell_command', markerExisted: false },
      ]);
      expect(existsSync(marker)).toBe(true);
      expect((await scriptResponse(agent.agent)).value).toBe(0);
    }, 60_000);

    it('ends the run when an approval is refused, listing the calls that completed', async () => {
      const workspace = scratchDir('code-mode-refuse-');
      writeFileSync(join(workspace, 'a.txt'), 'first');
      const agent = track(
        await buildScriptAgent(
          [
            {
              source: `
              await tools["read_file"]({ absolute_path: ${JSON.stringify(join(workspace, 'a.txt'))} });
              try {
                await tools["run_shell_command"]({ command: "touch ${join(workspace, 'refused')}" });
              } catch (error) {
                return "caught";
              }
              return "continued";`,
              tools: ['read_file', 'run_shell_command'],
            },
          ],
          {
            workspace,
            config: { onApproval: () => ToolConfirmationOutcome.Cancel },
          },
        ),
      );
      await runTurn(agent.agent);
      const response = await scriptResponse(agent.agent);

      expect(response.ok).toBe(false);
      expect(response.error?.code).toBe('APPROVAL_DENIED');
      expect(response.completedCalls).toStrictEqual([
        { tool: 'read_file', status: 'ok' },
        { tool: 'run_shell_command', status: 'denied' },
      ]);
      expect(existsSync(join(workspace, 'refused'))).toBe(false);
    }, 60_000);

    it('routes each approval only to its own run', async () => {
      const workspace = scratchDir('code-mode-routing-');
      const marker = (run: string) => join(workspace, `${run}-done`);
      const asked: string[] = [];
      let aDoneWhenBFinished: boolean | undefined;
      const script = (run: string) => ({
        id: run,
        source: `await tools["run_shell_command"]({ command: "touch ${marker(run)}" }); return "${run}";`,
        tools: ['run_shell_command'],
      });
      const agent = track(
        await buildScriptAgent([script('run-a'), script('run-b')], {
          workspace,
          config: {
            onApproval: async (request) => {
              asked.push(request.toolCallId);
              if (request.toolCallId.startsWith('run-a#')) {
                await waitFor(() => existsSync(marker('run-b')), 'run-b');
                aDoneWhenBFinished = existsSync(marker('run-a'));
              }
              return ToolConfirmationOutcome.ProceedOnce;
            },
          },
        }),
      );
      await runTurn(agent.agent);

      expect(asked.sort()).toStrictEqual([
        expect.stringMatching(/^run-a#script-[0-9a-f]{8}-1$/),
        expect.stringMatching(/^run-b#script-[0-9a-f]{8}-1$/),
      ]);
      expect(aDoneWhenBFinished).toBe(false);
      expect((await scriptResponse(agent.agent, 'run-a')).value).toBe('run-a');
      expect((await scriptResponse(agent.agent, 'run-b')).value).toBe('run-b');
    }, 60_000);

    it('fails a nested approval requirement fast in headless mode', async () => {
      const workspace = scratchDir('code-mode-headless-');
      const agent = track(
        await buildScriptAgent(
          [
            {
              source: `const r = await tools["run_shell_command"]({ command: "touch ${join(workspace, 'headless')}" }); return 1;`,
              tools: ['run_shell_command'],
            },
          ],
          {
            workspace,
            config: {
              interactive: false,
              harness: {
                forceInteractive: false,
                forceConfirmations: false,
                includeProcessCwd: false,
              },
            },
          },
        ),
      );
      const started = Date.now();
      await runTurn(agent.agent);
      const response = await scriptResponse(agent.agent);

      expect(response.error?.code).toBe('APPROVAL_REQUIRED');
      expect(response.completedCalls).toStrictEqual([
        { tool: 'run_shell_command', status: 'approval_required' },
      ]);
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(existsSync(join(workspace, 'headless'))).toBe(false);
    }, 60_000);
  });

  describe('code mode cancellation', () => {
    it('leaves no subprocess or running tool after an abort during nested execution', async () => {
      const workspace = scratchDir('code-mode-abort-exec-');
      const started = join(workspace, 'started');
      const sleeper = 'sleep 31.4084';
      const agent = track(
        await buildScriptAgent(
          [
            {
              source: `await tools["run_shell_command"]({ command: "touch ${started} && ${sleeper}" }); return 1;`,
              tools: ['run_shell_command'],
            },
          ],
          { workspace, rules: [ALLOW_SHELL] },
        ),
      );
      const controller = new AbortController();
      const turn = runTurn(agent.agent, controller.signal);
      await waitFor(() => existsSync(started), 'the nested command to start');
      expect(liveWrapperProcesses()).toHaveLength(1);
      controller.abort();
      await turn;

      expect(liveWrapperProcesses()).toStrictEqual([]);
      expect(processesMatching(sleeper)).toStrictEqual([]);
    }, 60_000);

    it('discards a late approval after an abort during the approval wait', async () => {
      const workspace = scratchDir('code-mode-abort-approval-');
      const marker = join(workspace, 'late');
      const controller = new AbortController();
      let lateAnswered = false;
      const agent = track(
        await buildScriptAgent(
          [
            {
              source: `await tools["run_shell_command"]({ command: "touch ${marker}" }); return 1;`,
              tools: ['run_shell_command'],
            },
          ],
          {
            workspace,
            config: {
              onApproval: async () => {
                controller.abort();
                await pause(500);
                lateAnswered = true;
                return ToolConfirmationOutcome.ProceedOnce;
              },
            },
          },
        ),
      );
      await runTurn(agent.agent, controller.signal);
      await waitFor(() => lateAnswered, 'the late approval');
      await pause(300);

      expect(liveWrapperProcesses()).toStrictEqual([]);
      expect(existsSync(marker)).toBe(false);
    }, 60_000);

    it('fails with UNAWAITED_TOOL_CALLS after cancelling and joining the pending call', async () => {
      const workspace = scratchDir('code-mode-unawaited-');
      const late = join(workspace, 'late');
      const sleeper = 'sleep 32.4084';
      const agent = track(
        await buildScriptAgent(
          [
            {
              source: `tools["run_shell_command"]({ command: "${sleeper} && touch ${late}" }); return 1;`,
              tools: ['run_shell_command'],
            },
          ],
          { workspace, rules: [ALLOW_SHELL] },
        ),
      );
      await runTurn(agent.agent);
      const response = await scriptResponse(agent.agent);

      expect(response.error?.code).toBe('UNAWAITED_TOOL_CALLS');
      expect(processesMatching(sleeper)).toStrictEqual([]);
      expect(liveWrapperProcesses()).toStrictEqual([]);
      expect(existsSync(late)).toBe(false);
    }, 60_000);
  });
});
