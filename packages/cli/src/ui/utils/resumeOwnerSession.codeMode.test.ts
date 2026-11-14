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
  runTurn,
  scratchDir,
  type ScriptAgent,
} from '../../../../agents/src/code-mode/__tests__/script-agent.js';
import { assertNoLiveWrappers } from '../../../../agents/src/code-mode/__tests__/runtime-test-helpers.js';
import type { HistoryItemToolGroup } from '../types.js';
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
  });
});
