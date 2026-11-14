/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where nested approvals go (issue #4084, Phase D). A nested call that needs
 * approval reaches a child display that answers approvals (the CLI) with the
 * same confirmation it would have as a direct call, labelled with the script
 * that made it, and the answer drives the run. A host that can answer
 * nothing (zed-acp, a2a, a stream-only API host) gets APPROVAL_REQUIRED at
 * once instead of a run that waits forever. Under the default policy the
 * script tool itself needs no approval. Real agent, real policy engine, real
 * scheduler and QuickJS subprocess.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import type { ToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import type { ChildToolDisplayCallbacks } from '../session/childToolDisplay.js';
import { assertNoLiveWrappers } from './__tests__/runtime-test-helpers.js';
import {
  buildScriptAgent,
  runTurn,
  scratchDir,
  scriptResponse,
  toolResponses,
  type ScriptAgent,
} from './__tests__/script-agent.js';

const owned: ScriptAgent[] = [];

describe('code mode nested approval routing', () => {
  afterEach(async () => {
    for (const agent of owned.splice(0)) await agent.cleanup();
    assertNoLiveWrappers();
  });

  function track(agent: ScriptAgent): ScriptAgent {
    owned.push(agent);
    return agent;
  }

  function touchScript(marker: string) {
    return {
      source: `const r = await tools["run_shell_command"]({ command: "touch ${marker}" }); return r.value.exitCode;`,
      tools: ['run_shell_command'],
      purpose: 'touch the marker file',
    };
  }

  /** A child display that answers every waiting nested call with `outcome`. */
  function answeringDisplay(outcome: ToolConfirmationOutcome): {
    readonly callbacks: ChildToolDisplayCallbacks;
    readonly asked: ToolCall[];
  } {
    const asked: ToolCall[] = [];
    const answered = new Set<string>();
    return {
      asked,
      callbacks: {
        onToolCallsUpdate: (_execution, calls) => {
          for (const call of calls) {
            if (
              call.status !== 'awaiting_approval' ||
              answered.has(call.request.callId) ||
              !('onConfirm' in call.confirmationDetails)
            )
              continue;
            answered.add(call.request.callId);
            asked.push(call);
            void call.confirmationDetails.onConfirm(outcome);
          }
        },
      },
    };
  }

  describe('nested approvals reach a display that answers them', () => {
    it('shows the nested call as a waiting confirmation labelled with its script, and runs it once approved', async () => {
      const workspace = scratchDir('code-mode-display-approve-');
      const marker = join(workspace, 'approved');
      const agent = track(
        await buildScriptAgent([touchScript(marker)], { workspace }),
      );
      const display = answeringDisplay(ToolConfirmationOutcome.ProceedOnce);
      agent.agent.tools.subscribeChildTools(display.callbacks, {
        answersApprovals: true,
      });

      await runTurn(agent.agent);

      expect(display.asked.map((call) => call.request.name)).toStrictEqual([
        'run_shell_command',
      ]);
      expect(display.asked[0].request.script).toStrictEqual({
        parentCallId: 'script-call-1',
        runId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        purpose: 'touch the marker file',
      });
      expect(existsSync(marker)).toBe(true);
      const response = await scriptResponse(agent.agent);
      expect(response.ok).toBe(true);
      expect(response.value).toBe(0);
    }, 60_000);

    it('ends the run with APPROVAL_DENIED when the display refuses the nested call', async () => {
      const workspace = scratchDir('code-mode-display-deny-');
      const marker = join(workspace, 'refused');
      const agent = track(
        await buildScriptAgent([touchScript(marker)], { workspace }),
      );
      const display = answeringDisplay(ToolConfirmationOutcome.Cancel);
      agent.agent.tools.subscribeChildTools(display.callbacks, {
        answersApprovals: true,
      });

      await runTurn(agent.agent);

      expect(display.asked).toHaveLength(1);
      expect(existsSync(marker)).toBe(false);
      const response = await scriptResponse(agent.agent);
      expect(response.error?.code).toBe('APPROVAL_DENIED');
      expect(response.completedCalls).toStrictEqual([
        { tool: 'run_shell_command', status: 'denied' },
      ]);
    }, 60_000);

    it('forwards nested live shell output to the child display', async () => {
      const workspace = scratchDir('code-mode-display-output-');
      const agent = track(
        await buildScriptAgent(
          [
            {
              source: `const r = await tools["run_shell_command"]({ command: "echo nested-live-output-4084" }); return r.value.stdout.trim();`,
              tools: ['run_shell_command'],
            },
          ],
          {
            workspace,
            rules: [
              {
                toolName: 'run_shell_command',
                decision: PolicyDecision.ALLOW,
                priority: 2,
              },
            ],
          },
        ),
      );
      const output: Array<{ callId: string; text: string }> = [];
      agent.agent.tools.subscribeChildTools({
        outputUpdateHandler: (_execution, callId, update) => {
          if (update.mode === 'append')
            output.push({ callId, text: update.data });
        },
      });

      await runTurn(agent.agent);

      expect(
        output
          .filter(({ callId }) => callId.startsWith('script-call-1#script-'))
          .map(({ text }) => text)
          .join(''),
      ).toContain('nested-live-output-4084');
      expect((await scriptResponse(agent.agent)).value).toBe(
        'nested-live-output-4084',
      );
    }, 60_000);
  });

  describe('hosts that cannot answer nested approvals fail fast', () => {
    it('fails an interactive session with no approval handler and no answering display at once', async () => {
      const workspace = scratchDir('code-mode-unanswerable-');
      const marker = join(workspace, 'unanswerable');
      const agent = track(
        await buildScriptAgent([touchScript(marker)], { workspace }),
      );
      // An observer that does not answer approvals, like a log tap.
      const seen: string[] = [];
      agent.agent.tools.subscribeChildTools({
        onToolCallsUpdate: (_execution, calls) => {
          for (const call of calls) seen.push(call.status);
        },
      });

      const started = Date.now();
      await runTurn(agent.agent);

      const response = await scriptResponse(agent.agent);
      expect(response.error?.code).toBe('APPROVAL_REQUIRED');
      expect(response.completedCalls).toStrictEqual([
        { tool: 'run_shell_command', status: 'approval_required' },
      ]);
      expect(seen).not.toContain('awaiting_approval');
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(existsSync(marker)).toBe(false);
    }, 60_000);
  });

  describe('default policy for the script tool', () => {
    it('runs a script of allowed reads in a headless session without any approval', async () => {
      const workspace = scratchDir('code-mode-default-headless-');
      writeFileSync(join(workspace, 'a.txt'), 'alpha');
      writeFileSync(join(workspace, 'b.txt'), 'beta');
      const agent = track(
        await buildScriptAgent(
          [
            {
              source: `
              const a = await tools["read_file"]({ absolute_path: ${JSON.stringify(join(workspace, 'a.txt'))} });
              const b = await tools["read_file"]({ absolute_path: ${JSON.stringify(join(workspace, 'b.txt'))} });
              return [a.value.text.trim(), b.value.text.trim()];`,
              tools: ['read_file'],
            },
          ],
          {
            workspace,
            defaultScriptPolicy: true,
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

      await runTurn(agent.agent);

      const response = await scriptResponse(agent.agent);
      expect(response.ok).toBe(true);
      expect(response.value).toStrictEqual(['alpha', 'beta']);
      expect(toolResponses(await agent.agent.getHistory())).toHaveLength(1);
    }, 60_000);

    it('asks only for the nested shell command, never for the script tool itself', async () => {
      const workspace = scratchDir('code-mode-default-ask-');
      const marker = join(workspace, 'asked');
      const asked: string[] = [];
      const agent = track(
        await buildScriptAgent([touchScript(marker)], {
          workspace,
          defaultScriptPolicy: true,
          config: {
            onApproval: (request) => {
              asked.push(request.name);
              return ToolConfirmationOutcome.ProceedOnce;
            },
          },
        }),
      );

      await runTurn(agent.agent);

      expect(asked).toStrictEqual(['run_shell_command']);
      expect(existsSync(marker)).toBe(true);
      expect((await scriptResponse(agent.agent)).ok).toBe(true);
    }, 60_000);
  });
});
