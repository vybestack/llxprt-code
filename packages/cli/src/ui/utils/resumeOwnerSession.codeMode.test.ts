/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A resumed session redraws each code mode run as the script card it ended
 * with (issue #4084), rebuilt from the recorded `tool_script_event` records:
 * no script runs again and model history keeps one call/response pair per
 * script. Real Agent with code mode and recording over the FakeProvider.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { formatToolScriptCard } from '@vybestack/llxprt-code-agents';
import { PolicyDecision } from '@vybestack/llxprt-code-core';
import {
  buildScriptAgent,
  processesMatching,
  runTurn,
  scratchDir,
  waitFor,
  type ScriptAgent,
} from '../../../../agents/src/code-mode/__tests__/script-agent.js';
import { assertNoLiveWrappers } from '../../../../agents/src/code-mode/__tests__/runtime-test-helpers.js';
import type { HistoryItemToolGroup } from '../types.js';
import { ToolCallStatus } from '../types.js';
import { iContentToHistoryItems } from './iContentToHistoryItems.js';
import { resumeOwnerSession } from './resumeOwnerSession.js';

const owned: ScriptAgent[] = [];

describe('code mode resume in the CLI', () => {
  afterEach(async () => {
    for (const agent of owned.splice(0)) await agent.cleanup();
    assertNoLiveWrappers();
  });

  const ALLOW_SHELL = {
    toolName: 'run_shell_command',
    decision: PolicyDecision.ALLOW,
    priority: 2,
  };

  function scriptGroups(items: ReturnType<typeof iContentToHistoryItems>) {
    return items.filter(
      (item): item is HistoryItemToolGroup & { id: number } =>
        item.type === 'tool_group' &&
        item.tools.some((tool) => tool.name === 'execute_tool_script'),
    );
  }

  describe('resumed code mode runs in the CLI history', () => {
    it('shows the recorded script card and does not run the script again', async () => {
      const workspace = scratchDir('cli-code-mode-resume-');
      const marker = join(workspace, 'ran');
      const source = `await tools["run_shell_command"]({ command: "touch ${marker}" }); return "done";`;
      const first = await buildScriptAgent(
        [
          {
            source,
            tools: ['run_shell_command'],
            purpose: 'mark the run',
          },
        ],
        { workspace, rules: [ALLOW_SHELL] },
      );
      owned.push(first);
      await first.agent.session.setRecording({ enabled: true });
      await runTurn(first.agent);
      const sessionId = first.agent.session.getSessionId();
      await first.agent.session.setRecording({ enabled: false });
      expect(existsSync(marker)).toBe(true);
      rmSync(marker);

      const next = await buildScriptAgent([], {
        workspace,
        rules: [ALLOW_SHELL],
      });
      owned.push(next);
      const session = next.agent.session;
      const replay = await resumeOwnerSession(
        session.resume.bind(session),
        sessionId,
        'allowed',
        session.listBrowserTargetsDetailed.bind(session),
        session.getToolScriptRuns.bind(session),
      );

      expect(existsSync(marker)).toBe(false);
      const [group] = scriptGroups([...replay.uiHistory]);
      const [run] = await session.getToolScriptRuns();
      expect(group.tools[0].resultDisplay).toBe(
        formatToolScriptCard(run, { source, result: '"done"' }),
      );
      expect(group.tools[0].resultDisplay).toContain('Purpose: mark the run');
      expect(group.tools[0].resultDisplay).toContain('Tool calls: 1 (1 ok)');
      expect(group.tools[0].resultDisplay).toContain('✓ run_shell_command');
      const blocks = replay.history.flatMap((content) => content.blocks);
      expect(blocks.filter((block) => block.type === 'tool_call')).toHaveLength(
        1,
      );
      expect(
        blocks.filter((block) => block.type === 'tool_response'),
      ).toHaveLength(1);

      // Without recorded runs the call shows its recorded response, as before.
      const [plain] = scriptGroups(
        iContentToHistoryItems([...replay.history], 'allowed'),
      );
      expect(String(plain.tools[0].resultDisplay)).toContain('callCount');
      expect(String(plain.tools[0].resultDisplay)).not.toContain('Purpose:');
    }, 60_000);

    /** Records one script turn, then resumes it in a fresh agent. */
    async function recordAndResume(
      source: string,
      purpose: string,
      during?: (abort: () => void) => Promise<void>,
    ) {
      const workspace = scratchDir('cli-code-mode-resume-end-');
      const first = await buildScriptAgent(
        [{ source, tools: ['run_shell_command'], purpose }],
        { workspace, rules: [ALLOW_SHELL] },
      );
      owned.push(first);
      await first.agent.session.setRecording({ enabled: true });
      const controller = new AbortController();
      const turn = runTurn(first.agent, controller.signal);
      await during?.(() => controller.abort());
      await turn;
      // As after Escape in the CLI, the user goes on with another prompt;
      // that turn writes the session file.
      if (during !== undefined) await runTurn(first.agent);
      const sessionId = first.agent.session.getSessionId();
      await first.agent.session.setRecording({ enabled: false });

      const next = await buildScriptAgent([], {
        workspace,
        rules: [ALLOW_SHELL],
      });
      owned.push(next);
      const session = next.agent.session;
      const replay = await resumeOwnerSession(
        session.resume.bind(session),
        sessionId,
        'allowed',
        session.listBrowserTargetsDetailed.bind(session),
        session.getToolScriptRuns.bind(session),
      );
      const [group] = scriptGroups([...replay.uiHistory]);
      return {
        tool: group.tools[0],
        history: replay.history,
        runs: await session.getToolScriptRuns(),
      };
    }

    it('shows a cancelled run as cancelled, with its card, with or without a recorded response', async () => {
      const { tool, history, runs } = await recordAndResume(
        'await tools["run_shell_command"]({ command: "sleep 28.4084" }); return "finished";',
        'sleep until cancelled',
        async (abort) => {
          await waitFor(
            () => processesMatching('sleep 28.4084').length > 0,
            'the nested sleep to start',
          );
          abort();
        },
      );

      expect(tool.status).toBe(ToolCallStatus.Canceled);
      expect(String(tool.resultDisplay)).toContain(
        'Purpose: sleep until cancelled',
      );
      expect(String(tool.resultDisplay)).toContain('CANCELLED');

      // The interactive CLI records an Escaped call with no tool response at
      // all; the finished run still decides the status.
      const unanswered = history.map((content) => ({
        ...content,
        blocks: content.blocks.filter(
          (block) =>
            block.type !== 'tool_response' || block.callId !== tool.callId,
        ),
      }));
      const [group] = scriptGroups(
        iContentToHistoryItems(unanswered, 'allowed', runs),
      );
      expect(group.tools[0].status).toBe(ToolCallStatus.Canceled);
      expect(group.tools[0].resultDisplay).toBe(tool.resultDisplay);
    }, 60_000);

    it('shows a failed run as failed, with its card', async () => {
      const { tool } = await recordAndResume(
        'await tools["run_shell_command"]({ command: "echo before" }); throw new Error("stop here");',
        'fail on purpose',
      );

      expect(tool.status).toBe(ToolCallStatus.Error);
      expect(String(tool.resultDisplay)).toContain(
        'Status: failed SCRIPT_ERROR',
      );
      expect(String(tool.resultDisplay)).not.toContain('{"ok"');
    }, 60_000);
  });
});
