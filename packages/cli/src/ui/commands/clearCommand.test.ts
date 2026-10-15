/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from '../../__tests__/mockCommandContext.js';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  HookEventName,
  HookType,
  escapeShellArg,
  CONTINUE_LATEST,
} from '@vybestack/llxprt-code-core';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { buildCliStyleConfig } from '../../../../agents/src/api/__tests__/helpers/buildCliStyleConfig.js';
import { drain } from '../../../../agents/src/api/__tests__/helpers/agentHarness.js';
import { setupOwnerSessionRecording } from '../../cliSessionBootstrap.js';
import { TaskLaunchOwner } from '../../../../agents/src/session/task-launch-owner.js';
import { setImmediate } from 'node:timers/promises';
import { createClearCommand } from './clearCommand.js';
import { bindClearSession } from './simpleCommandHost.js';
import { createContinueCommandForTest } from './__tests__/continue-command-test-owner.js';
import type { HistoryItemWithoutId } from '../types.js';

import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { assertDefined } from '../../__tests__/assertions.js';

async function clearAction(context: CommandOwnerFixture, args: string) {
  const action = createClearCommand(
    bindClearSession(context.services.agent),
    context.ui.setDebugMessage,
    context.ui.addItem,
    context.ui.updateHistoryTokenCount,
    context.ui.clear,
  ).action;
  assertDefined(action);
  return action(context, args);
}
async function runContinue(context: CommandOwnerFixture, args: string) {
  const action = createContinueCommandForTest(() => context).action;
  assertDefined(action);
  return action(context, args);
}
const hookInput = z.object({
  hook_event_name: z.string(),
  session_id: z.string(),
  transcript_path: z.string(),
  reason: z.string().optional(),
  source: z.string().optional(),
});

describe('clearCommand new session', () => {
  let directory: string;
  let built: Awaited<ReturnType<typeof buildCliStyleConfig>>;
  let agent: Agent;
  let context: CommandOwnerFixture;
  let uiEvents: string[];
  let oldId: string;
  let oldPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'clear-hook-'));
    const script = join(directory, 'hook.ts');
    await writeFile(
      script,
      `import { appendFileSync, existsSync, readFileSync } from 'node:fs';
const input = JSON.parse(await Bun.stdin.text());
appendFileSync(${JSON.stringify(join(directory, 'hooks.jsonl'))}, JSON.stringify(input) + '\\n');
const failure = ${JSON.stringify(join(directory, 'failure'))};
if (existsSync(failure) && readFileSync(failure, 'utf8') === input.hook_event_name) process.exit(1);
console.log(JSON.stringify({systemMessage: input.hook_event_name + ' feedback'}));
`,
    );
    const command = `exec ${escapeShellArg(process.execPath, 'bash')} ${escapeShellArg(script, 'bash')}`;
    built = await buildCliStyleConfig('multi-turn-text.jsonl', {
      workingDir: directory,
      hooks: {
        [HookEventName.SessionEnd]: [
          { hooks: [{ type: HookType.Command, command }] },
        ],
        [HookEventName.SessionStart]: [
          { hooks: [{ type: HookType.Command, command }] },
        ],
      },
    });
    built.config.adoptSessionId(crypto.randomUUID());
    agent = await fromConfig({
      config: built.config,
      agentClient: built.agentClient,
      providerManager: built.providerManager,
      messageBus: built.messageBus,
      mcpRuntime: built.mcpRuntime,
      settingsService: built.settingsService,
      providerFileLifecycle: built.runtime.providerFileLifecycle,
      sessionId: built.config.getSessionId(),
      sessionIdentityOwnership: 'config',
    });
    await agent.setHistory([
      { speaker: 'human', blocks: [{ type: 'text', text: 'old question' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'old answer' }] },
    ]);
    await agent.session.setRecording({ enabled: true });
    oldId = agent.session.getSessionId();
    const path = agent.session.getRecording().path;
    if (path === undefined) throw new Error('Expected old recording');
    oldPath = path;
    uiEvents = [];
    context = createMockCommandContext({
      recordingOwner: 'agent',
      services: { config: built.config, agent },
      ui: {
        setDebugMessage: (text: string) => {
          uiEvents.push(text);
        },
        updateHistoryTokenCount: (count: number) => {
          uiEvents.push(`tokens:${count}`);
        },
        clear: () => {
          uiEvents.push('clear');
        },
        addItem: (item: HistoryItemWithoutId) => {
          if ('text' in item && item.text !== undefined)
            uiEvents.push(item.text);
        },
      },
    });
  });

  afterEach(async () => {
    await agent.dispose();
    await built.cleanup();
    await rm(directory, { recursive: true, force: true });
  });

  async function inputs(): Promise<Array<z.infer<typeof hookInput>>> {
    return (await readFile(join(directory, 'hooks.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => hookInput.parse(JSON.parse(line)));
  }

  it('reports pending background work without clearing the conversation or terminal', async () => {
    if (
      !('deps' in agent) ||
      typeof agent.deps !== 'object' ||
      agent.deps === null
    )
      throw new Error('Expected agent dependencies');
    if (
      !('taskLaunchOwner' in agent.deps) ||
      !(agent.deps.taskLaunchOwner instanceof TaskLaunchOwner)
    )
      throw new Error('Expected task owner');
    const owner = agent.deps.taskLaunchOwner;
    await owner.start(async (launch, publish) => {
      owner.manager.registerTask({
        id: 'clear-blocker',
        subagentName: 'worker',
        goalPrompt: 'work',
        abortController: launch.controller,
      });
      launch.register('clear-blocker');
      publish({ llmContent: '', returnDisplay: '' });
    });
    await setImmediate();
    const running = await clearAction(context, '');
    expect(running).toMatchObject({ type: 'message', messageType: 'error' });
    if (running?.type !== 'message') throw new Error('Expected error message');
    expect(running.content).toContain('background tasks');
    expect(running.content).toContain('finish or cancel');
    owner.manager.failTask('clear-blocker', 'completion notice');
    const pending = await clearAction(context, '');
    expect(pending).toStrictEqual(running);
    expect(agent.session.getSessionId()).toBe(oldId);
    expect(
      (await agent.getHistory()).flatMap((item) => item.blocks),
    ).toContainEqual({ type: 'text', text: 'old question' });
    expect(uiEvents).not.toContain('clear');
    expect(uiEvents).not.toContain('tokens:0');
  });

  it('ends the old session before starting the new one and updates Config identity', async () => {
    await clearAction(context, '');
    const hooks = await inputs();
    expect(hooks.map((input) => input.hook_event_name)).toStrictEqual([
      'SessionEnd',
      'SessionStart',
    ]);
    expect(hooks[0].session_id).toBe(oldId);
    expect(hooks[0].transcript_path).toBe(oldPath);
    expect(hooks[0].reason).toBe('clear');
    expect(hooks[1].source).toBe('clear');
    expect(hooks[1].session_id).not.toBe(oldId);
    expect(hooks[1].session_id).toBe(agent.session.getSessionId());
    expect(built.config.getSessionId()).toBe(hooks[1].session_id);
    expect(await agent.getHistory()).toStrictEqual([]);
    expect(uiEvents).toContain('SessionStart feedback');
    expect(uiEvents.slice(-2)).toStrictEqual(['tokens:0', 'clear']);
  });

  it('keeps the old conversation available to /continue and the session picker', async () => {
    await clearAction(context, '');
    await drain(agent.stream('new question'));
    await agent.session.flushRecording();
    const targets = await agent.session.listBrowserTargets();
    expect(targets.filter((target) => target.kind === 'session')).toHaveLength(
      2,
    );
    expect(
      targets.some(
        (target) =>
          target.kind === 'session' && target.session.sessionId === oldId,
      ),
    ).toBe(true);
    const result = await runContinue(context, oldId);
    if (result?.type !== 'perform_resume')
      throw new Error('Expected resume action');
    const history = await agent.session.resumeSession(result.sessionRef);
    expect(history.id).toBe(oldId);
    expect(
      (await agent.getHistory()).flatMap((item) => item.blocks),
    ).toStrictEqual([
      { type: 'text', text: 'old question' },
      { type: 'text', text: 'old answer' },
    ]);
  });

  it('resumes the pre-clear session through startup --continue after an immediate exit', async () => {
    await clearAction(context, '');
    await agent.session.setRecording({ enabled: false });
    const config = built.config;
    const request = new Proxy(config, {
      get(target, property, receiver) {
        if (property === 'getContinueSessionRef') return () => CONTINUE_LATEST;
        return Reflect.get(target, property, receiver);
      },
    });
    const resumed = await setupOwnerSessionRecording(request, agent, {}, null);
    expect(resumed?.flatMap((item) => item.blocks)).toStrictEqual([
      { type: 'text', text: 'old question' },
      { type: 'text', text: 'old answer' },
    ]);
    expect(await agent.session.listSessions()).toHaveLength(1);
  });

  it.each(['SessionEnd', 'SessionStart'])(
    'starts a fresh session when the %s command hook fails',
    async (event) => {
      await writeFile(join(directory, 'failure'), event);
      await clearAction(context, '');
      expect(agent.session.getSessionId()).not.toBe(oldId);
      expect(await agent.getHistory()).toStrictEqual([]);
      expect(
        (await inputs()).map((input) => input.hook_event_name),
      ).toStrictEqual(['SessionEnd', 'SessionStart']);
      expect(uiEvents.at(-1)).toBe('clear');
    },
  );

  it('clears only the terminal when no Agent is available', async () => {
    const terminal = createMockCommandContext({
      services: { config: null, agent: null },
      ui: context.ui,
    });
    await clearAction(terminal, '');
    expect(agent.session.getSessionId()).toBe(oldId);
    expect(uiEvents).toStrictEqual(['Clearing terminal.', 'tokens:0', 'clear']);
  });

  it('uses the explicit Agent without needing Config on the command context', async () => {
    const explicit = createMockCommandContext({
      services: { config: null, agent },
      ui: context.ui,
    });
    await clearAction(explicit, '');
    expect(agent.session.getSessionId()).not.toBe(oldId);
    expect(await agent.getHistory()).toStrictEqual([]);
    expect(uiEvents).toContain('SessionStart feedback');
  });
});
