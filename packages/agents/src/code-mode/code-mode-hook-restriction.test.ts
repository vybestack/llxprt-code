/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4084: a BeforeToolSelection hook that narrows the model's tools
 * narrows what a script may call too. A real command hook restricts the turn
 * to `execute_tool_script`, `discover_tool_api` and `read_file`; a script
 * asking for `glob` is refused before it runs and discovery leaves `glob`
 * out.
 */

import { afterEach, describe, expect, it, setDefaultTimeout } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { physicalHookCommand } from '../api/__tests__/helpers/physicalHookCommand.js';
import { assertNoLiveWrappers } from './__tests__/runtime-test-helpers.js';
import {
  buildDirectAgent,
  runTurn,
  scratchDir,
  modelFacingText,
  toolResponses,
  type ScriptAgent,
  type ToolCallSpec,
} from './__tests__/script-agent.js';

setDefaultTimeout(60_000);

const ALLOWED = ['execute_tool_script', 'discover_tool_api', 'read_file'];

let built: ScriptAgent | undefined;

async function cleanUp(): Promise<void> {
  await built?.cleanup();
  built = undefined;
  assertNoLiveWrappers();
}

function selectionHook(directory: string) {
  const script = join(directory, 'tool-selection-hook.ts');
  writeFileSync(
    script,
    `process.stdout.write(${JSON.stringify(
      JSON.stringify({
        hookSpecificOutput: {
          toolChoice: { mode: 'auto', allowedToolNames: ALLOWED },
        },
      }),
    )});\n`,
  );
  return {
    [HookEventName.BeforeToolSelection]: [
      {
        hooks: [
          { type: HookType.Command, command: physicalHookCommand(script) },
        ],
      },
    ],
  };
}

async function responseText(agent: ScriptAgent['agent'], callId: string) {
  const [response] = toolResponses(await agent.getHistory()).filter(
    (block) => block.callId === callId,
  );
  return modelFacingText(response.result);
}

describe('code mode under a tool-selection hook restriction (issue #4084)', () => {
  afterEach(cleanUp);

  it('refuses a script tool the hook restricted, allows one it kept, and leaves it out of discovery', async () => {
    const workspace = scratchDir('code-mode-hook-restriction-');
    writeFileSync(join(workspace, 'kept.txt'), 'kept-content\n');
    const script = (
      id: string,
      tools: readonly string[],
      source: string,
    ): ToolCallSpec => ({
      id,
      name: 'execute_tool_script',
      parameters: { source, tools, purpose: 'hook restriction' },
    });
    const hookDir = scratchDir('code-mode-hook-script-');
    built = await buildDirectAgent(
      [
        script(
          'restricted',
          ['glob'],
          'return await tools["glob"]({ pattern: "*" });',
        ),
        script(
          'kept',
          ['read_file'],
          `const r = await tools["read_file"]({ absolute_path: ${JSON.stringify(join(workspace, 'kept.txt'))} }); return r.ok ? r.value.text.trim() : r.error.code;`,
        ),
        {
          id: 'discover',
          name: 'discover_tool_api',
          parameters: { operation: 'list' },
        },
      ],
      {
        workspace,
        config: {
          hooks: selectionHook(hookDir),
          settings: { enableHooks: true },
        },
      },
    );
    await runTurn(built.agent);

    const restricted = await responseText(built.agent, 'restricted');
    expect(restricted).toContain('"code":"TOOL_NOT_ADMITTED"');
    expect(restricted).toContain('"callCount":0');
    expect(await responseText(built.agent, 'kept')).toContain('kept-content');
    const listed = JSON.parse(
      (await responseText(built.agent, 'discover')).replace(/^[^{]*/, ''),
    ) as { tools: Array<{ name: string }> };
    expect(listed.tools.map((tool) => tool.name)).toStrictEqual(['read_file']);
  });
});
