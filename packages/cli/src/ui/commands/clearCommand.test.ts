/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from '../../__tests__/mockCommandContext.js';

import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  Config,
  ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../../../../agents/src/api/mcpRuntimeAssembly.js';
import { toConfigParameters } from '../../../../agents/src/api/agentConfig.adapter.js';
import { mkdtemp, realpath, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { useOwnedCredentials } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../../../../agents/src/api/preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../../../../agents/src/api/adoption-release.js';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../../../agents/src/core/subagent-cleanup.js';
import { SessionClientOwner } from '../../../../agents/src/session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
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
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from '../../../../agents/src/api/__tests__/helpers/mcp-owner-fixture.js';
import {
  createAgentRuntimeFactoryBindings,
  AgentRuntimeFactoryBindings,
} from '../../../../agents/src/api/runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../../../../agents/src/api/confirmationForcing.js';
import { executeProviderActivation } from '../../../../agents/src/api/providerActivationExecutor.js';
import { assembleProviderSwitch } from '../../../../agents/src/api/providerSwitchAssembly.js';
import { assembleModelSelection } from '../../../../agents/src/api/model-selection.js';
import {
  AgentConfig,
  ProviderActivationIntent,
} from '../../../../agents/src/api/config-types.js';
import { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import { z } from 'zod';
import {
  HookEventName,
  HookType,
  escapeShellArg,
  CONTINUE_LATEST,
} from '@vybestack/llxprt-code-core';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
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
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
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

  const builtCredentials = useOwnedCredentials();

  let directory: string;

  let builtCallerConfig: Config;
  let builtCallerSettings: SettingsService;
  let builtCallerSettingsOwner: SessionSettingsOwner;
  let builtCallerPolicy: RuntimePolicyOwner;
  let builtCallerMcp: McpRuntimeOwner;
  let builtCallerManager: ReturnType<typeof acquirePreferredProviderManager>;
  let builtCallerOwner: SessionClientOwner;
  let builtCallerClose: () => Promise<void>;
  let builtCallerFactories: AgentRuntimeFactoryBindings;
  let builtCallerRelease: AcquisitionRelease;
  let builtCallerFiles: ProviderFileLifecycle;
  let builtCallerRuntimeId: string;
  let builtCallerOAuth: ReturnType<typeof acquirePreferredOAuth>;
  let builtCallerTokenizer: ReturnType<
    typeof configureProviderRuntimeFactories
  >['tokenizerFactory'];
  let builtCallerContent: ReturnType<
    typeof configureProviderRuntimeFactories
  >['contentGeneratorFactory'];

  async function openbuiltCaller(
    fixture: string,
    overrides: Readonly<Partial<AgentConfig>> = {},
    suppliedFactories: Readonly<Partial<AgentRuntimeFactoryBindings>> = {},
    skillSettings: Pick<
      ConfigParameters,
      'enableExtensionReloading' | 'storageRoot'
    > = {},
    extensionLoader?: ExtensionLoader,
    skillOperations?: WorkspaceSkillAssemblyOperations,
  ): Promise<void> {
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL(
        '../../../../agents/src/api/__tests__/fixtures/' + fixture,
        import.meta.url,
      ),
    );
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'builtCaller-adoption-')),
    );
    const selection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...overrides,
      workingDir:
        overrides.workingDir === undefined
          ? directory
          : await realpath(overrides.workingDir),
    };
    const parameters = { ...toConfigParameters(selection), ...skillSettings };
    parameters.interactive = true;
    if (overrides.hooks !== undefined) parameters.enableHooks = true;
    if (
      overrides.filesystemOwner === undefined &&
      (overrides.harness?.includeProcessCwd ?? true)
    )
      parameters.includeDirectories = [
        ...(parameters.includeDirectories ?? []),
        process.cwd(),
      ];
    builtCallerConfig = new Config(parameters);
    builtCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...suppliedFactories,
    };
    builtCallerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      builtCallerConfig.getInitialSettings(),
    ))
      builtCallerSettings.set(key, value);
    builtCallerPolicy = new RuntimePolicyOwner(builtCallerConfig);
    injectConfirmationForcingPolicy(builtCallerPolicy.session.confirmation);
    builtCallerMcp = await buildTestMcpRuntime(
      builtCallerConfig,
      builtCallerPolicy.session.messageBus,
      overrides,
      extensionLoader,
      builtCallerPolicy,
      skillOperations,
    );
    acquirebuiltCallerProviders();
    const media = new SessionMediaOwner(
      builtCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    builtCallerOwner = await SessionClientOwner.create(
      builtCallerConfig,
      assembleTaskSchemaPolicy(builtCallerSettings),
      builtCallerManager,
      builtCallerFactories.agentClientFactory,
      media.store,
      builtCallerMcp.readInstructions,
      builtCallerMcp.workspacePaths,
      builtCallerSettingsOwner,
      builtCallerContent,
      builtCallerTokenizer,
    );
    builtCallerOwner.bindMcpRuntime(builtCallerMcp);
    builtCallerOwner.bindProviderFiles(builtCallerFiles, (provider) =>
      builtCallerOAuth.composeRetryOperations(provider),
    );
    builtCallerOwner.bindHooks();
    builtCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => builtCallerOwner.dispose(),
        () => builtCallerRelease.close(),
        () => media.dispose(),
        () => builtCallerMcp.dispose(),
        () => builtCallerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        builtCallerConfig,
        builtCallerSettings,
        builtCallerSettingsOwner,
        builtCallerManager,
        builtCallerOAuth,
        builtCallerRuntimeId,
        builtCallerTokenizer,
      );
      await builtCallerMcp.initialize();
      await activatebuiltCallerClient(selection.activation);
    } catch (primary) {
      await cleanupAfterFailure(primary, builtCallerClose);
    }
  }
  function acquirebuiltCallerProviders(): void {
    builtCallerRuntimeId = 'builtCaller-' + randomUUID();
    builtCallerRelease = new AcquisitionRelease();
    builtCallerSettingsOwner = new SessionSettingsOwner(builtCallerSettings);
    builtCallerRelease.acquire('settings', () =>
      builtCallerSettingsOwner.dispose(),
    );
    builtCallerSettingsOwner.initializeProviderSelection(
      builtCallerConfig.getProvider(),
      builtCallerConfig.getModel(),
    );
    builtCallerSettingsOwner.bindTelemetry(builtCallerConfig);
    builtCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [
      builtCallerRuntimeId,
      builtCallerConfig.getSessionId(),
    ])
      builtCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(builtCallerFiles, scope),
      );
    builtCallerManager = acquirePreferredProviderManager(
      builtCallerConfig,
      builtCallerSettings,
      builtCallerSettingsOwner,
      builtCallerFiles,
      builtCallerRuntimeId,
      builtCredentials().authority,
      builtCallerRelease,
    );
    const factories = configureProviderRuntimeFactories(
      builtCallerConfig,
      builtCallerManager,
    );
    builtCallerTokenizer = factories.tokenizerFactory;
    builtCallerContent = factories.contentGeneratorFactory;
    builtCallerOAuth = acquirePreferredOAuth(
      undefined,
      builtCallerPolicy.session.messageBus,
      builtCallerConfig,
      builtCallerSettings,
      builtCallerManager,
      builtCallerRuntimeId,
      builtCallerMcp.profileDefinitions,
      builtCredentials().authority,
      builtCallerRelease,
    );
  }
  async function activatebuiltCallerClient(
    intent: ProviderActivationIntent = {
      provider: builtCallerConfig.getProvider(),
      model: builtCallerConfig.getModel(),
    },
  ): Promise<void> {
    const activation = await executeProviderActivation(
      builtCallerConfig,
      intent,
      assembleProviderSwitch(
        builtCallerConfig,
        builtCallerSettings,
        builtCallerManager,
        builtCallerOAuth,
        () => 'agent',
        () => builtCallerOwner.refreshAuth(),
        builtCallerSettingsOwner,
      ),
      builtCallerSettings,
      builtCallerManager,
      (method) => builtCallerOwner.refreshAuth(method),
      assembleModelSelection(builtCallerSettingsOwner),
    );
    requireCallerActivation(activation);
    await builtCallerOwner.initializeTools();
    await builtCallerOwner.getAgentClient().startChat();
  }

  const builtReleases: Array<() => Promise<void>> = [];
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
    await openbuiltCaller('multi-turn-text.jsonl', {
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
    builtReleases.push(builtCallerClose);
    builtCallerConfig.adoptSessionId(crypto.randomUUID());
    agent = await fromConfig({
      config: builtCallerConfig,
      agentClient: builtCallerOwner.getAgentClient(),
      providerManager: builtCallerManager,
      messageBus: builtCallerPolicy.session.messageBus,
      mcpRuntime: builtCallerMcp,
      settingsService: builtCallerSettings,
      providerFileLifecycle: builtCallerFiles,
      sessionId: builtCallerConfig.getSessionId(),
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
      services: { config: builtCallerConfig, agent },
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
    await runCleanupSteps(builtReleases.splice(0));
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
    expect(builtCallerConfig.getSessionId()).toBe(hooks[1].session_id);
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
    const config = builtCallerConfig;
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

async function settleEngineRelease(
  steps: ReadonlyArray<() => void | Promise<void>>,
  previousReplay: string | undefined,
): Promise<void> {
  try {
    await runCleanupSteps(steps);
  } finally {
    if (previousReplay === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
  }
}

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
