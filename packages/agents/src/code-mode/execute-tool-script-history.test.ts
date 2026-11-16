/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Model history and registration of execute_tool_script (issue #4084): a
 * script's nested calls never enter model history, and the tool exists only
 * when the agent enables code mode.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertNoLiveWrappers } from './__tests__/runtime-test-helpers.js';
import {
  buildDirectAgent,
  buildScriptAgent,
  runTurn,
  scratchDir,
  scriptResponse,
  toolResponses,
  type ScriptAgent,
} from './__tests__/script-agent.js';

const owned: ScriptAgent[] = [];

describe('execute_tool_script history and registration', () => {
  afterEach(async () => {
    for (const agent of owned.splice(0)) await agent.cleanup();
    assertNoLiveWrappers();
  });

  describe('execute_tool_script model history', () => {
    it('records twenty nested calls as exactly one provider-visible tool response', async () => {
      const workspace = scratchDir('code-mode-history-');
      for (let index = 0; index < 20; index++)
        writeFileSync(join(workspace, `f${index}.txt`), `file ${index}`);
      const agent = await buildScriptAgent(
        [
          {
            source: `
            let total = 0;
            for (let i = 0; i < 20; i++) {
              const r = await tools["read_file"]({ absolute_path: ${JSON.stringify(workspace)} + "/f" + i + ".txt" });
              if (r.ok) total += 1;
            }
            return { read: total };`,
            tools: ['read_file'],
          },
        ],
        { workspace },
      );
      owned.push(agent);
      await runTurn(agent.agent);
      const history = await agent.agent.getHistory();
      const toolCalls = history.flatMap((content) =>
        content.blocks.filter((block) => block.type === 'tool_call'),
      );
      const response = await scriptResponse(agent.agent);

      expect(response.value).toStrictEqual({ read: 20 });
      expect(response.callCount).toBe(20);
      expect(response.completedCalls).toHaveLength(20);
      expect(toolCalls.map((block) => block.name)).toStrictEqual([
        'execute_tool_script',
      ]);
      expect(
        toolResponses(history).map((block) => [block.callId, block.toolName]),
      ).toStrictEqual([['script-call-1', 'execute_tool_script']]);
    }, 60_000);
  });

  describe('execute_tool_script registration', () => {
    it('lists the tool only when the agent enables code mode', async () => {
      const enabled = await buildScriptAgent([], {
        workspace: scratchDir('code-mode-on-'),
      });
      owned.push(enabled);
      const disabled = await buildScriptAgent([], {
        workspace: scratchDir('code-mode-off-'),
        config: { codeMode: false },
      });
      owned.push(disabled);

      const names = (agent: ScriptAgent) =>
        agent.agent.tools.list().map((tool) => tool.name);
      expect(names(enabled)).toContain('execute_tool_script');
      expect(names(disabled)).not.toContain('execute_tool_script');
    }, 60_000);

    it('cannot run a script when code mode is off', async () => {
      const agent = await buildDirectAgent(
        [
          {
            id: 'script-call-1',
            name: 'execute_tool_script',
            parameters: {
              source: 'return 1;',
              tools: ['read_file'],
              purpose: 'x',
            },
          },
        ],
        {
          workspace: scratchDir('code-mode-off-call-'),
          config: { codeMode: false },
        },
      );
      owned.push(agent);
      await runTurn(agent.agent);
      const [response] = toolResponses(await agent.agent.getHistory());

      expect(response.error).toContain('could not be loaded');
    }, 60_000);
  });
});
