/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A hook that asks to stop (`continue: false`) ends the whole script run,
 * while a hook that blocks one call leaves an ordinary tool error the script
 * can handle (issue #4084). Real agent, real command hooks, real policy and
 * real QuickJS subprocess; side effects are checked on the filesystem.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { physicalHookCommand } from '../api/__tests__/helpers/physicalHookCommand.js';
import { assertNoLiveWrappers } from './__tests__/runtime-test-helpers.js';
import {
  buildScriptAgent,
  runTurn,
  scratchDir,
  scriptResponse,
  type ScriptAgent,
} from './__tests__/script-agent.js';

const ALLOW_SHELL = {
  toolName: 'run_shell_command',
  decision: PolicyDecision.ALLOW,
  priority: 2,
};

type HookPhase = HookEventName.BeforeTool | HookEventName.AfterTool;

const owned: ScriptAgent[] = [];

function hookOn(phase: HookPhase, output: object) {
  const script = join(scratchDir('code-mode-stop-hook-'), 'hook.ts');
  writeFileSync(
    script,
    `process.stdout.write(${JSON.stringify(JSON.stringify(output))});\n`,
  );
  return {
    [phase]: [
      {
        matcher: 'read_file',
        hooks: [
          { type: HookType.Command, command: physicalHookCommand(script) },
        ],
      },
    ],
  };
}

/**
 * Reads a file under the hook, catching anything, then touches a marker
 * through the shell. The marker shows whether the script got past the hook.
 */
async function runPastHook(
  phase: HookPhase,
  output: object,
  order: 'sequential' | 'queued' = 'sequential',
) {
  const workspace = scratchDir('code-mode-stop-');
  const target = join(workspace, 'a.txt');
  writeFileSync(target, 'contents');
  const marker = join(workspace, 'after-hook');
  const read = `tools["read_file"]({ absolute_path: ${JSON.stringify(target)} })`;
  const touch = `tools["run_shell_command"]({ command: ${JSON.stringify(`touch ${marker}`)} })`;
  const source =
    order === 'queued'
      ? `try { return await Promise.all([${read}, ${touch}]); } catch (error) { return "caught"; }`
      : `
          let first;
          try {
            first = await ${read};
          } catch (error) {
            first = "caught";
          }
          await ${touch};
          return first;`;
  const agent = await buildScriptAgent(
    [{ tools: ['read_file', 'run_shell_command'], source }],
    {
      workspace,
      rules: [ALLOW_SHELL],
      config: {
        hooks: hookOn(phase, output),
        settings: { enableHooks: true },
      },
    },
  );
  owned.push(agent);
  await runTurn(agent.agent);
  return {
    response: await scriptResponse(agent.agent),
    markerWritten: existsSync(marker),
  };
}

describe('code mode hook stop', () => {
  afterEach(async () => {
    for (const agent of owned.splice(0)) await agent.cleanup();
    assertNoLiveWrappers();
  });

  it('ends the run when a BeforeTool hook asks to stop, so a later call never runs', async () => {
    const { response, markerWritten } = await runPastHook(
      HookEventName.BeforeTool,
      { continue: false, stopReason: 'stop the script' },
    );

    expect(markerWritten).toBe(false);
    expect(response.ok).toBe(false);
    expect(response.error).toStrictEqual({
      code: 'HOOK_STOPPED',
      message: 'stop the script',
    });
    expect(response.completedCalls).toStrictEqual([
      { tool: 'read_file', status: 'failed' },
    ]);
  }, 60_000);

  it('cancels a call queued behind the stopped one without running it', async () => {
    const { response, markerWritten } = await runPastHook(
      HookEventName.BeforeTool,
      { continue: false, stopReason: 'stop the queue' },
      'queued',
    );

    expect(markerWritten).toBe(false);
    expect(response.error?.code).toBe('HOOK_STOPPED');
    expect(response.completedCalls).toStrictEqual([
      { tool: 'read_file', status: 'failed' },
    ]);
  }, 60_000);

  it('ends the run when an AfterTool hook asks to stop, after the call ran', async () => {
    const { response, markerWritten } = await runPastHook(
      HookEventName.AfterTool,
      { continue: false, stopReason: 'stop after reading' },
    );

    expect(markerWritten).toBe(false);
    expect(response.error).toStrictEqual({
      code: 'HOOK_STOPPED',
      message: 'stop after reading',
    });
    expect(response.completedCalls).toStrictEqual([
      { tool: 'read_file', status: 'failed' },
    ]);
  }, 60_000);

  it('lets the script handle a call a BeforeTool hook only blocked, and go on', async () => {
    const { response, markerWritten } = await runPastHook(
      HookEventName.BeforeTool,
      { decision: 'block', reason: 'not this file' },
    );

    expect(markerWritten).toBe(true);
    expect(response.ok).toBe(true);
    expect(response.value).toStrictEqual({
      ok: false,
      error: { code: 'UNHANDLED_EXCEPTION', message: 'not this file' },
    });
    expect(response.completedCalls).toStrictEqual([
      { tool: 'read_file', status: 'failed' },
      { tool: 'run_shell_command', status: 'ok' },
    ]);
  }, 60_000);
});
