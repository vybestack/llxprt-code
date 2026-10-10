/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import {
  hookSessionRuntime,
  readHookDefinitions,
} from '@vybestack/llxprt-code-core/hooks/hook-configuration.js';
import {
  AfterAgentHookOutput,
  HookEventName,
  HookType,
  type HookOutput,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { escapeShellArg } from '@vybestack/llxprt-code-core/utils/shell-utils.js';
import { AgentHookManager } from './AgentHookManager.js';

const inputSchema = z.object({
  hook_event_name: z.string(),
  prompt: z.string(),
  prompt_response: z.string().optional(),
  stop_hook_active: z.boolean().optional(),
});

describe('AgentHookManager', () => {
  let directory: string;
  let manager: AgentHookManager;
  let root: SessionHookOwner;
  let settingsOwner: SessionSettingsOwner;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'agent-hook-manager-'));
    const script = join(directory, 'hook.ts');
    await writeFile(
      script,
      `import { appendFileSync, readFileSync } from 'node:fs';
const input = JSON.parse(await Bun.stdin.text());
appendFileSync(${JSON.stringify(join(directory, 'inputs'))}, JSON.stringify(input) + '\\n');
console.log(readFileSync(${JSON.stringify(join(directory, 'output'))}, 'utf8'));
`,
    );
    await writeFile(join(directory, 'output'), '{}');
    const command = `exec ${escapeShellArg(process.execPath, 'bash')} ${escapeShellArg(script, 'bash')}`;
    const config = new Config({
      sessionId: 'hook-manager',
      targetDir: directory,
      cwd: directory,
      model: 'hook-manager',
      debugMode: false,
      trustedFolder: true,
      enableHooks: true,
      hooks: {
        [HookEventName.BeforeAgent]: [
          { hooks: [{ type: HookType.Command, command }] },
        ],
        [HookEventName.AfterAgent]: [
          { hooks: [{ type: HookType.Command, command }] },
        ],
      },
    });
    settingsOwner = new SessionSettingsOwner(new SettingsService());
    settingsOwner.bindTelemetry(config);
    root = new SessionHookOwner(
      readHookDefinitions(config),
      hookSessionRuntime(
        config,
        new WorkspaceTrustLifecycle({
          localTrust: config.initialWorkspaceTrust,
        }),
        settingsOwner.telemetry,
      ),
      true,
      new MessageBus(),
    );
    manager = new AgentHookManager();
  });
  afterEach(async () => {
    await root.dispose();
    await settingsOwner.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  function owner(): ReturnType<SessionHookOwner['execution']> {
    return root.execution({
      sessionId: () => 'manager-session',
      transcriptPath: () => undefined,
    });
  }
  async function inputs(
    event: HookEventName,
  ): Promise<Array<z.infer<typeof inputSchema>>> {
    const path = join(directory, 'inputs');
    if (!existsSync(path)) return [];
    return (await readFile(path, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => inputSchema.parse(JSON.parse(line)))
      .filter((input) => input.hook_event_name === event);
  }
  async function output(value: HookOutput): Promise<void> {
    await writeFile(join(directory, 'output'), JSON.stringify(value));
  }
  async function before(id = 'p1', prompt = 'prompt'): Promise<unknown> {
    return manager.fireBeforeAgentHookSafe(id, prompt, owner());
  }
  async function after(
    id = 'p1',
    text = 'response',
    pending = false,
  ): Promise<AfterAgentHookOutput | undefined> {
    return manager.fireAfterAgentHookSafe(id, 'prompt', text, pending, owner());
  }

  it('fires hook on first call for a prompt_id', async () => {
    await before('p1', 'hello');
    expect(
      (await inputs(HookEventName.BeforeAgent)).map((input) => input.prompt),
    ).toStrictEqual(['hello']);
    expect(await inputs(HookEventName.AfterAgent)).toStrictEqual([]);
  });
  it('balances cancelled nested calls without dispatching their lifecycle hooks', async () => {
    await before();
    const controller = new AbortController();
    controller.abort(new Error('nested call cancelled'));
    const cancelled = root.execution({
      sessionId: () => 'cancelled-nested',
      transcriptPath: () => undefined,
      signal: controller.signal,
    });
    expect(
      await manager.fireBeforeAgentHookSafe('p1', 'prompt', cancelled),
    ).toBeUndefined();
    expect(
      await manager.fireAfterAgentHookSafe(
        'p1',
        'prompt',
        'partial',
        false,
        cancelled,
      ),
    ).toBeUndefined();
    expect(await inputs(HookEventName.BeforeAgent)).toHaveLength(1);
    expect(await inputs(HookEventName.AfterAgent)).toStrictEqual([]);
    await after('p1', ' completed');
    expect(
      (await inputs(HookEventName.AfterAgent)).map(
        (input) => input.prompt_response,
      ),
    ).toStrictEqual(['partial completed']);
  });

  it('does not fire hook again for same prompt_id', async () => {
    await before();
    expect(await before()).toBeUndefined();
    expect(await inputs(HookEventName.BeforeAgent)).toHaveLength(1);
  });
  it('fires hook for new prompt_id', async () => {
    await before('p1', 'first');
    await before('p2', 'second');
    expect(
      (await inputs(HookEventName.BeforeAgent)).map((input) => input.prompt),
    ).toStrictEqual(['first', 'second']);
    expect(await inputs(HookEventName.AfterAgent)).toStrictEqual([]);
  });
  it('returns undefined when hook trigger returns undefined', async () => {
    expect(
      await manager.fireBeforeAgentHookSafe('unbound', 'prompt'),
    ).toBeUndefined();
    expect(await inputs(HookEventName.BeforeAgent)).toStrictEqual([]);
  });
  it('returns hook output when hook trigger returns a value', async () => {
    await output({ decision: 'block', reason: 'physical rejection' });
    const result = await manager.fireBeforeAgentHookSafe(
      'p1',
      'prompt',
      owner(),
    );
    expect(result?.isBlockingDecision()).toBe(true);
    expect(result?.getEffectiveReason()).toContain('physical rejection');
  });
  it('increments activeCalls on each call', async () => {
    await before();
    await before();
    await before();
    await after('p1', 'one');
    await after('p1', 'two');
    expect(await inputs(HookEventName.AfterAgent)).toStrictEqual([]);
    await after('p1', 'three');
    expect(
      (await inputs(HookEventName.AfterAgent)).map(
        (input) => input.prompt_response,
      ),
    ).toStrictEqual(['onetwothree']);
  });
  it('fires hook and accumulates response text', async () => {
    await before();
    await after('p1', 'chunk1');
    expect(
      (await inputs(HookEventName.AfterAgent)).map((input) => ({
        prompt: input.prompt,
        response: input.prompt_response,
        stop: input.stop_hook_active,
      })),
    ).toStrictEqual([{ prompt: 'prompt', response: 'chunk1', stop: false }]);
    expect(await inputs(HookEventName.BeforeAgent)).toHaveLength(1);
  });
  it('returns undefined when no hook state exists for prompt_id', async () => {
    expect(await after('missing')).toBeUndefined();
    expect(await inputs(HookEventName.AfterAgent)).toStrictEqual([]);
  });
  it('deduplicates: does not fire when activeCalls > 0 after decrement', async () => {
    await before();
    await before();
    expect(await after()).toBeUndefined();
    expect(await inputs(HookEventName.AfterAgent)).toStrictEqual([]);
  });
  it('fires only when activeCalls drops to zero', async () => {
    await before();
    await before();
    await after('p1', 'part1');
    expect(await inputs(HookEventName.AfterAgent)).toStrictEqual([]);
    const result = await after('p1', 'part2');
    expect(result).toBeInstanceOf(AfterAgentHookOutput);
    expect(
      (await inputs(HookEventName.AfterAgent)).map(
        (input) => input.prompt_response,
      ),
    ).toStrictEqual(['part1part2']);
  });
  it('does not fire when hasPendingToolCalls=true even at activeCalls=0', async () => {
    await before();
    expect(await after('p1', 'response', true)).toBeUndefined();
    expect(await inputs(HookEventName.AfterAgent)).toStrictEqual([]);
  });
  it('accumulates response text across multiple calls', async () => {
    await before();
    await before();
    await after('p1', 'part1 ');
    await after('p1', 'part2');
    expect(
      (await inputs(HookEventName.AfterAgent)).map(
        (input) => input.prompt_response,
      ),
    ).toStrictEqual(['part1 part2']);
    expect(await inputs(HookEventName.BeforeAgent)).toHaveLength(1);
  });
  it('removes hook state for old prompt_id', async () => {
    await before('old');
    manager.cleanupOldHookState('new', 'old');
    expect(await after('old')).toBeUndefined();
    expect(await inputs(HookEventName.AfterAgent)).toStrictEqual([]);
  });
  it('does not remove state for current prompt_id', async () => {
    await before('current');
    manager.cleanupOldHookState('current', 'current');
    await after('current');
    expect(await inputs(HookEventName.AfterAgent)).toHaveLength(1);
    expect(await inputs(HookEventName.BeforeAgent)).toHaveLength(1);
  });
  it('cleans up hook state for old prompt_id when new prompt arrives', async () => {
    await before('old');
    manager.cleanupOldHookState('new', 'old');
    await before('new');
    expect(await after('old')).toBeUndefined();
    await after('new');
    expect(await inputs(HookEventName.AfterAgent)).toHaveLength(1);
  });
  it('preserves hook state for current active prompt_id', async () => {
    await before('active');
    manager.cleanupOldHookState('active', 'active');
    expect(await after('active')).toBeInstanceOf(AfterAgentHookOutput);
    expect(await inputs(HookEventName.AfterAgent)).toHaveLength(1);
  });
  it('returns AfterAgentHookOutput with shouldClearContext()=true when hook sets clearContext', async () => {
    await output({ hookSpecificOutput: { clearContext: true } });
    await before();
    const result = await after();
    expect(result).toBeInstanceOf(AfterAgentHookOutput);
    expect(result?.shouldClearContext()).toBe(true);
  });
  it('returns AfterAgentHookOutput with shouldClearContext()=false when hook does not set clearContext', async () => {
    await output({ hookSpecificOutput: { additionalContext: 'some context' } });
    await before();
    expect((await after())?.shouldClearContext()).toBe(false);
    expect(await inputs(HookEventName.AfterAgent)).toHaveLength(1);
  });
  it('returns undefined when no hook output is produced', async () => {
    await manager.fireBeforeAgentHookSafe('unbound', 'prompt');
    expect(
      await manager.fireAfterAgentHookSafe(
        'unbound',
        'prompt',
        'response',
        false,
      ),
    ).toBeUndefined();
    expect(await inputs(HookEventName.AfterAgent)).toStrictEqual([]);
  });
  it('clearContext is preserved alongside blocking decision', async () => {
    await output({
      decision: 'block',
      reason: 'Context cleared',
      hookSpecificOutput: { clearContext: true },
    });
    await before();
    const result = await after();
    expect(result?.isBlockingDecision()).toBe(true);
    expect(result?.shouldClearContext()).toBe(true);
  });
});
