/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Policy parity between direct and scripted calls, effective-argument
 * authorization of hook rewrites for nested calls, and the script tool-list
 * preflight (issue #4084). Real agent, real policy engine, real hooks.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { physicalHookCommand } from '../api/__tests__/helpers/physicalHookCommand.js';
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

const ALLOW_SHELL = {
  toolName: 'run_shell_command',
  decision: PolicyDecision.ALLOW,
  priority: 2,
};

/** Destructive by the policy backstop, and harmless even if it ever ran. */
const DESTRUCTIVE = 'false && rm -rf /usr';

const owned: ScriptAgent[] = [];

describe('code mode policy', () => {
  afterEach(async () => {
    for (const agent of owned.splice(0)) await agent.cleanup();
    assertNoLiveWrappers();
  });

  function track(agent: ScriptAgent): ScriptAgent {
    owned.push(agent);
    return agent;
  }

  async function directShellResponse(
    command: string,
    rules: ReadonlyArray<typeof ALLOW_SHELL>,
    onApproval?: () => ToolConfirmationOutcome,
  ) {
    const agent = track(
      await buildDirectAgent(
        [
          {
            id: 'direct-1',
            name: 'run_shell_command',
            parameters: { command },
          },
        ],
        {
          workspace: scratchDir('code-mode-direct-'),
          rules,
          config: onApproval === undefined ? {} : { onApproval },
        },
      ),
    );
    await runTurn(agent.agent);
    const [response] = toolResponses(await agent.agent.getHistory());
    return response;
  }

  describe('code mode policy parity', () => {
    it('denies a destructive shell command directly and from a script, even under an allow rule', async () => {
      const direct = await directShellResponse(DESTRUCTIVE, [ALLOW_SHELL]);
      expect(direct.error).toContain('Policy denied');

      const workspace = scratchDir('code-mode-deny-');
      writeFileSync(join(workspace, 'a.txt'), 'first');
      const scripted = track(
        await buildScriptAgent(
          [
            {
              source: `
              await tools["read_file"]({ absolute_path: ${JSON.stringify(join(workspace, 'a.txt'))} });
              try {
                await tools["run_shell_command"]({ command: ${JSON.stringify(DESTRUCTIVE)} });
              } catch (error) {
                return "caught";
              }
              return "continued";`,
              tools: ['read_file', 'run_shell_command'],
            },
          ],
          { workspace, rules: [ALLOW_SHELL] },
        ),
      );
      await runTurn(scripted.agent);
      const response = await scriptResponse(scripted.agent);

      expect(response.ok).toBe(false);
      expect(response.error?.code).toBe('POLICY_DENIED');
      expect(response.completedCalls).toStrictEqual([
        { tool: 'read_file', status: 'ok' },
        { tool: 'run_shell_command', status: 'denied' },
      ]);
    }, 60_000);

    it('asks for the same shell command directly and from a script, and allows reads without asking in both', async () => {
      const directAsks: string[] = [];
      const direct = await directShellResponse('echo asked', [], () => {
        directAsks.push('run_shell_command');
        return ToolConfirmationOutcome.ProceedOnce;
      });
      expect(directAsks).toStrictEqual(['run_shell_command']);
      expect(direct.error).toBeUndefined();

      const workspace = scratchDir('code-mode-ask-');
      writeFileSync(join(workspace, 'a.txt'), 'read me');
      const scriptAsks: string[] = [];
      const scripted = track(
        await buildScriptAgent(
          [
            {
              source: `
              const read = await tools["read_file"]({ absolute_path: ${JSON.stringify(join(workspace, 'a.txt'))} });
              const shell = await tools["run_shell_command"]({ command: "echo asked" });
              return [read.ok, shell.value.stdout.trim()];`,
              tools: ['read_file', 'run_shell_command'],
            },
          ],
          {
            workspace,
            config: {
              onApproval: (request) => {
                scriptAsks.push(request.name);
                return ToolConfirmationOutcome.ProceedOnce;
              },
            },
          },
        ),
      );
      await runTurn(scripted.agent);

      expect(scriptAsks).toStrictEqual(['run_shell_command']);
      expect((await scriptResponse(scripted.agent)).value).toStrictEqual([
        true,
        'asked',
      ]);
    }, 60_000);
  });

  function rewriteHook(directory: string, command: string) {
    const script = join(directory, 'rewrite-hook.ts');
    writeFileSync(
      script,
      `process.stdout.write(${JSON.stringify(
        JSON.stringify({ hookSpecificOutput: { tool_input: { command } } }),
      )});\n`,
    );
    return {
      [HookEventName.BeforeTool]: [
        {
          matcher: 'run_shell_command',
          hooks: [
            { type: HookType.Command, command: physicalHookCommand(script) },
          ],
        },
      ],
    };
  }

  async function runRewrittenScript(
    rewriteTo: (workspace: string) => string,
    rules: readonly object[],
  ) {
    const workspace = scratchDir('code-mode-hook-');
    const hookDir = scratchDir('code-mode-hook-script-');
    const scripted = track(
      await buildScriptAgent(
        [
          {
            source:
              'const r = await tools["run_shell_command"]({ command: "echo original" }); return r.value.stdout.trim();',
            tools: ['run_shell_command'],
          },
        ],
        {
          workspace,
          rules: rules as never,
          config: {
            hooks: rewriteHook(hookDir, rewriteTo(workspace)),
            settings: { enableHooks: true },
          },
        },
      ),
    );
    await runTurn(scripted.agent);
    return { workspace, response: await scriptResponse(scripted.agent) };
  }

  describe('nested effective-argument authorization', () => {
    it('denies a nested call whose BeforeTool rewrite policy denies, and never runs it', async () => {
      const { workspace, response } = await runRewrittenScript(
        (dir) => `touch ${join(dir, 'forbidden-marker')}`,
        [
          ALLOW_SHELL,
          {
            toolName: 'run_shell_command',
            decision: PolicyDecision.DENY,
            argsPattern: /forbidden-marker/,
            priority: 3,
          },
        ],
      );

      expect(response.error?.code).toBe('POLICY_DENIED');
      expect(existsSync(join(workspace, 'forbidden-marker'))).toBe(false);
    }, 60_000);

    it('executes exactly the rewritten arguments policy allowed', async () => {
      const { response } = await runRewrittenScript(
        () => 'echo rewritten',
        [ALLOW_SHELL],
      );

      expect(response.ok).toBe(true);
      expect(response.value).toBe('rewritten');
    }, 60_000);
  });

  describe('nested hook output', () => {
    it('replaces the typed shell value with text when an AfterTool hook adds to the output', async () => {
      const workspace = scratchDir('code-mode-after-hook-');
      const hookDir = scratchDir('code-mode-after-hook-script-');
      const script = join(hookDir, 'after-hook.ts');
      writeFileSync(
        script,
        `process.stdout.write(${JSON.stringify(JSON.stringify({ systemMessage: 'hook-note' }))});\n`,
      );
      const scripted = track(
        await buildScriptAgent(
          [
            {
              source:
                'const r = await tools["run_shell_command"]({ command: "echo body" }); return r.value;',
              tools: ['run_shell_command'],
            },
          ],
          {
            workspace,
            rules: [ALLOW_SHELL],
            config: {
              hooks: {
                [HookEventName.AfterTool]: [
                  {
                    matcher: 'run_shell_command',
                    hooks: [
                      {
                        type: HookType.Command,
                        command: physicalHookCommand(script),
                      },
                    ],
                  },
                ],
              },
              settings: { enableHooks: true },
            },
          },
        ),
      );
      await runTurn(scripted.agent);
      const value = (await scriptResponse(scripted.agent)).value as {
        readonly text?: string;
        readonly stdout?: string;
      };

      expect(value.stdout).toBeUndefined();
      expect(value.text).toContain('body');
      expect(value.text).toContain('hook-note');
    }, 60_000);
  });

  describe('script tool-list preflight', () => {
    const requested: ReadonlyArray<
      readonly [string, readonly string[], string]
    > = [
      ['p-write', ['write_file'], 'TOOL_NOT_SCRIPTABLE'],
      ['p-script', ['execute_tool_script'], 'TOOL_NOT_SCRIPTABLE'],
      ['p-discover', ['discover_tool_api'], 'TOOL_NOT_SCRIPTABLE'],
      ['p-task', ['task'], 'TOOL_NOT_SCRIPTABLE'],
      ['p-todo', ['todo_write'], 'TOOL_NOT_SCRIPTABLE'],
      ['p-memory', ['save_memory'], 'TOOL_NOT_SCRIPTABLE'],
      ['p-web', ['exa_web_search'], 'TOOL_NOT_SCRIPTABLE'],
      ['p-excluded', ['glob'], 'TOOL_NOT_ADMITTED'],
      ['p-duplicate', ['read_file', 'read_file'], 'INVALID_TOOLS'],
    ];

    it('rejects names outside the v1 set, recursive and mutating tools, and tools the caller excluded', async () => {
      const workspace = scratchDir('code-mode-preflight-');
      const agent = track(
        await buildScriptAgent(
          requested.map(([id, tools]) => ({ id, tools, source: 'return 1;' })),
          { workspace, config: { excludeTools: ['glob'] } },
        ),
      );
      await runTurn(agent.agent);

      for (const [id, , code] of requested) {
        const response = await scriptResponse(agent.agent, id);
        expect({
          id,
          ok: response.ok,
          code: response.error?.code,
        }).toStrictEqual({ id, ok: false, code });
        expect(response.callCount).toBe(0);
      }
    }, 60_000);

    it('rejects a script tool outside the caller allowlist', async () => {
      const workspace = scratchDir('code-mode-allowlist-');
      const agent = track(
        await buildScriptAgent([{ tools: ['glob'], source: 'return 1;' }], {
          workspace,
          config: { tools: ['read_file', 'execute_tool_script'] },
        }),
      );
      await runTurn(agent.agent);

      expect((await scriptResponse(agent.agent)).error?.code).toBe(
        'TOOL_NOT_ADMITTED',
      );
    }, 60_000);
  });
});
