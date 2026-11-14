import { createTurnStore } from '../stores/turn/turnStore.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from '../../__tests__/mockCommandContext.js';

import {
  Config,
  WorkspaceFilesystemOwner,
  WorkspaceTrustLifecycle,
  assembleWorkspaceMemory,
  HookEventName,
  HookType,
  CONTINUE_LATEST,
} from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { toConfigParameters } from '../../../../agents/src/api/agentConfig.adapter.js';
import { mkdtemp, realpath, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../../../agents/src/core/subagent-cleanup.js';
import {
  AgentProfilePreflight,
  prepareAgentPreflight,
} from '../../../../agents/src/api/profile-preflight.js';
import { useOwnedCredentials } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { useFakeResponsesReplay } from '../../../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import {
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  afterEach,
  beforeEach,
} from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { z } from 'zod';
import { type Agent } from '@vybestack/llxprt-code-agents';
import { drain } from '../../../../agents/src/api/__tests__/helpers/agentHarness.js';
import { physicalHookCommand } from '../../../../agents/src/api/__tests__/helpers/physicalHookCommand.js';
import { setupOwnerSessionRecording } from '../../cliSessionBootstrap.js';
import { launchHeldNotificationTask } from '../../__tests__/task-notification-agent-fixture.js';
import { waitFor } from '../../__tests__/render.js';
import { setImmediate } from 'node:timers/promises';
import { createClearCommand } from './clearCommand.js';
import { bindClearSession } from './simpleCommandHost.js';
import { createContinueCommandForTest } from './__tests__/continue-command-test-owner.js';
import type { AgentHooks } from '../../../../agents/src/api/config-types.js';

import { NativeJournalCursor } from '../stores/turn/native-journal-cursor.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { assertDefined } from '../../__tests__/assertions.js';

async function clearAction(context: CommandOwnerFixture, args: string) {
  const agent = context.services.agent;
  const session =
    agent === null
      ? null
      : bindClearSession(
          (reason) => agent.hooks.triggerSessionEnd(reason),
          () => agent.session.startNewSession(),
          (reason) => agent.hooks.triggerSessionStart(reason),
        );
  const action = createClearCommand(
    session,
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

/**
 * The foreground route the CLI takes (`prepareAgentPreflight`, then
 * `preparePostConfiguration`, `preflight` and `createForegroundAgent`) over a
 * `Config` with command hooks enabled; `AgentConfig` carries no `enableHooks`,
 * so the test builds the `Config` itself.
 */
async function openClearRoute(
  authority: CredentialAuthority,
  workingDir: string,
  hooks: AgentHooks,
): Promise<{
  readonly agent: Agent;
  readonly config: Config;
  readonly close: () => Promise<void>;
}> {
  const config = new Config({
    ...toConfigParameters({
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      workingDir,
      hooks,
    }),
    interactive: true,
    enableHooks: true,
  });
  const trust = new WorkspaceTrustLifecycle({
    localTrust: config.initialWorkspaceTrust,
  });
  const filesystem = new WorkspaceFilesystemOwner({
    targetDir: config.getTargetDir(),
    isTrusted: () => trust.isTrustedFolder(),
  });
  const memory = assembleWorkspaceMemory(config, filesystem, trust);
  let preflight: AgentProfilePreflight | undefined;
  const close = (): Promise<void> =>
    runCleanupSteps([
      () => preflight?.dispose(),
      () => memory.dispose(),
      () => filesystem.dispose(),
      () => trust.dispose(),
      () => config.dispose(),
    ]);
  try {
    preflight = await prepareAgentPreflight(
      { runtimeId: `clear-command-${randomUUID()}` },
      authority,
      new SettingsService(),
      undefined,
      undefined,
    );
    await preflight.preparePostConfiguration(
      config,
      filesystem,
      memory,
      trust,
      () => trust.dispose(),
      undefined,
    );
    const intent = { provider: 'fake', model: 'fake-model' };
    const result = await preflight.preflight(intent);
    if (result.token === undefined)
      throw new Error('Preflight did not accept the activation');
    const agent = await AgentProfilePreflight.createForegroundAgent(
      preflight,
      result.token,
      intent,
      {},
    );
    return { agent, config, close };
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
}

describe('clearCommand new session', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  useFakeResponsesReplay('multi-turn-text.jsonl');
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  const credentials = useOwnedCredentials();

  let directory: string;
  let previousConfigHome: string | undefined;
  let closeRoute: () => Promise<void>;
  let config: Config;
  let agent: Agent;
  let context: CommandOwnerFixture;
  let uiEvents: string[];
  let oldId: string;
  let oldPath: string;

  beforeEach(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), 'clear-hook-')));
    previousConfigHome = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = directory;
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
    const command = physicalHookCommand(script);
    const route = await openClearRoute(credentials().authority, directory, {
      [HookEventName.SessionEnd]: [
        { hooks: [{ type: HookType.Command, command }] },
      ],
      [HookEventName.SessionStart]: [
        { hooks: [{ type: HookType.Command, command }] },
      ],
    });
    agent = route.agent;
    config = route.config;
    closeRoute = route.close;
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
    const turn = createTurnStore();
    turn.commands.bindJournal(() => ({
      appendDisplay: agent.session.appendDisplay.bind(agent.session),
      length: () => agent.session.getJournalLength(),
    }));
    context = createMockCommandContext({
      recordingOwner: 'agent',
      services: { config, agent },
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
        addItem: turn.commands.addItem,
      },
    });
  });

  afterEach(async () => {
    try {
      await runCleanupSteps([
        () => agent.dispose(),
        () => closeRoute(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    } finally {
      if (previousConfigHome === undefined)
        delete process.env.LLXPRT_CONFIG_HOME;
      else process.env.LLXPRT_CONFIG_HOME = previousConfigHome;
    }
  });
  async function expectJournaledStartNotice(): Promise<void> {
    await agent.session.flushRecording();
    const path = agent.session.getRecording().path;
    if (!path) throw new Error('Missing new session journal');
    const cursor = await NativeJournalCursor.open(path, {}, 10);
    try {
      expect(
        (await cursor.pageBack(10)).entries.flatMap((entry) =>
          entry.kind === 'projected' ? [entry.item.text] : [],
        ),
      ).toStrictEqual(['SessionStart feedback']);
    } finally {
      await cursor.close();
    }
    expect(uiEvents).not.toContain('SessionStart feedback');
  }

  async function inputs(): Promise<Array<z.infer<typeof hookInput>>> {
    return (await readFile(join(directory, 'hooks.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => hookInput.parse(JSON.parse(line)));
  }

  it('reports pending background work without clearing the conversation or terminal', async () => {
    const child = await launchHeldNotificationTask(agent);
    try {
      await setImmediate();
      const running = await clearAction(context, '');
      expect(running).toMatchObject({ type: 'message', messageType: 'error' });
      if (running?.type !== 'message')
        throw new Error('Expected error message');
      expect(running.content).toContain('background tasks');
      expect(running.content).toContain('finish or cancel');
      child.release(true);
      await waitFor(async () => {
        await expect(agent.session.startNewSession()).rejects.toThrow(
          'completion notices',
        );
      });
      const pending = await clearAction(context, '');
      expect(pending).toMatchObject({ type: 'message', messageType: 'error' });
      if (pending?.type !== 'message')
        throw new Error('Expected notice blocker');
      expect(pending.content).toContain('completion notices');
      expect(pending.content).not.toContain('cancel');
      expect(agent.session.getSessionId()).toBe(oldId);
      expect(
        (await Array.fromAsync(agent.streamHistory())).flatMap(
          (item) => item.blocks,
        ),
      ).toContainEqual({ type: 'text', text: 'old question' });
      expect(uiEvents).not.toContain('clear');
      expect(uiEvents).not.toContain('tokens:0');
      const messages: string[] = [];
      const unsubscribe = agent.tasks.subscribeNotifications(
        () => false,
        async (text) => {
          messages.push(text);
        },
      );
      try {
        await setImmediate();
        await unsubscribe.drain();
        expect(messages).toHaveLength(1);
        await clearAction(context, '');
        expect(agent.session.getSessionId()).not.toBe(oldId);
        expect(await Array.fromAsync(agent.streamHistory())).toStrictEqual([]);
        expect(uiEvents.slice(-2)).toStrictEqual(['tokens:0', 'clear']);
      } finally {
        unsubscribe();
        await unsubscribe.drain();
      }
    } finally {
      await child.close();
    }
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
    expect(config.getSessionId()).toBe(hooks[1].session_id);
    expect(await Array.fromAsync(agent.streamHistory())).toStrictEqual([]);
    await expectJournaledStartNotice();
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
    if (result.sessionRef === undefined)
      throw new Error('Expected saved session reference');
    const history = await agent.session.resumeSession(result.sessionRef);
    expect(history.id).toBe(oldId);
    expect(
      (await Array.fromAsync(agent.streamHistory())).flatMap(
        (item) => item.blocks,
      ),
    ).toStrictEqual([
      { type: 'text', text: 'old question' },
      { type: 'text', text: 'old answer' },
    ]);
  });

  it('resumes the pre-clear session through startup --continue after an immediate exit', async () => {
    await clearAction(context, '');
    await expectJournaledStartNotice();
    const displayOnlySessionId = agent.session.getSessionId();
    await agent.session.setRecording({ enabled: false });
    const request = new Proxy(config, {
      get(target, property, receiver) {
        if (property === 'getContinueSessionRef') return () => CONTINUE_LATEST;
        return Reflect.get(target, property, receiver);
      },
    });
    const resumed = await setupOwnerSessionRecording(
      request,
      agent.session,
      () => agent.session.listBrowserTargetsDetailed(),
      { listSessions: false, deleteSession: undefined },
      null,
    ).then(({ resumedBoot }) => resumedBoot);
    if (resumed === null) throw new Error('Expected resumed rows');
    const resumedRows = await Array.fromAsync(resumed.streamRows());
    expect(resumedRows.flatMap((item) => item.blocks)).toStrictEqual([
      { type: 'text', text: 'old question' },
      { type: 'text', text: 'old answer' },
    ]);
    expect(
      (await agent.session.listSessions()).map((session) => session.id).sort(),
    ).toStrictEqual([oldId, displayOnlySessionId].sort());
  });

  it.each(['SessionEnd', 'SessionStart'])(
    'starts a fresh session when the %s command hook fails',
    async (event) => {
      await writeFile(join(directory, 'failure'), event);
      await clearAction(context, '');
      expect(agent.session.getSessionId()).not.toBe(oldId);
      expect(await Array.fromAsync(agent.streamHistory())).toStrictEqual([]);
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
      recordingOwner: 'agent',
      services: { config: null, agent },
      ui: context.ui,
    });
    await clearAction(explicit, '');
    expect(agent.session.getSessionId()).not.toBe(oldId);
    expect(await Array.fromAsync(agent.streamHistory())).toStrictEqual([]);
    await expectJournaledStartNotice();
  });
});
