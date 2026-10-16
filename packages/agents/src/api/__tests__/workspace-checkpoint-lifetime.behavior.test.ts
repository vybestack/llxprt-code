import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  Config,
  ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService, Storage } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import {
  mkdtemp,
  realpath,
  rm,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../core/subagent-cleanup.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
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
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import {
  createAgentRuntimeFactoryBindings,
  AgentRuntimeFactoryBindings,
} from '../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { AgentConfig, ProviderActivationIntent } from '../config-types.js';
import { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import { execFileSync } from 'node:child_process';
import {
  processRestorableToolCalls,
  getToolCallDataSchema,
} from '@vybestack/llxprt-code-core';
import { fromConfig } from '../index.js';
import { buildAgent } from './helpers/agentHarness.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('public Agent workspace checkpoint lifetime', () => {
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

  const callerCredentials = useOwnedCredentials();
  let callerCallerConfig: Config;
  let callerCallerSettings: SettingsService;
  let callerCallerSettingsOwner: SessionSettingsOwner;
  let callerCallerPolicy: RuntimePolicyOwner;
  let callerCallerMcp: McpRuntimeOwner;
  let callerCallerManager: ReturnType<typeof acquirePreferredProviderManager>;
  let callerCallerOwner: SessionClientOwner;
  let callerCallerClose: () => Promise<void>;
  let callerCallerFactories: AgentRuntimeFactoryBindings;
  let callerCallerRelease: AcquisitionRelease;
  let callerCallerFiles: ProviderFileLifecycle;
  let callerCallerRuntimeId: string;
  let callerCallerOAuth: ReturnType<typeof acquirePreferredOAuth>;
  let callerCallerTokenizer: ReturnType<typeof configureProviderTokenizer>;
  let callerCallerContent: ReturnType<
    typeof createRuntimeContentGeneratorFactory
  >;

  async function opencallerCaller(
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
      new URL('./fixtures/' + fixture, import.meta.url),
    );
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'callerCaller-adoption-')),
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
    callerCallerConfig = new Config(parameters);
    callerCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...suppliedFactories,
    };
    callerCallerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      callerCallerConfig.getInitialSettings(),
    ))
      callerCallerSettings.set(key, value);
    callerCallerPolicy = new RuntimePolicyOwner(callerCallerConfig);
    injectConfirmationForcingPolicy(callerCallerPolicy.session.confirmation);
    callerCallerMcp = await buildTestMcpRuntime(
      callerCallerConfig,
      callerCallerPolicy.session.messageBus,
      overrides,
      extensionLoader,
      callerCallerPolicy,
      skillOperations,
    );
    acquirecallerCallerProviders();
    const media = new SessionMediaOwner(
      callerCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    callerCallerOwner = await SessionClientOwner.create(
      callerCallerConfig,
      assembleTaskSchemaPolicy(callerCallerSettings),
      callerCallerManager,
      callerCallerFactories.agentClientFactory,
      media.store,
      callerCallerMcp.readInstructions,
      callerCallerMcp.workspacePaths,
      callerCallerSettingsOwner,
      callerCallerContent,
      callerCallerTokenizer,
    );
    callerCallerOwner.bindMcpRuntime(callerCallerMcp);
    callerCallerOwner.bindProviderFiles(callerCallerFiles, (provider) =>
      callerCallerOAuth.composeRetryOperations(provider),
    );
    callerCallerOwner.bindHooks();
    callerCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => callerCallerOwner.dispose(),
        () => callerCallerRelease.close(),
        () => media.dispose(),
        () => callerCallerMcp.dispose(),
        () => callerCallerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        callerCallerConfig,
        callerCallerSettings,
        callerCallerSettingsOwner,
        callerCallerManager,
        callerCallerOAuth,
        callerCallerRuntimeId,
        callerCallerTokenizer,
        undefined,
      );
      await callerCallerMcp.initialize();
      await activatecallerCallerClient(selection.activation);
    } catch (primary) {
      await cleanupAfterFailure(primary, callerCallerClose);
    }
  }
  function acquirecallerCallerProviders(): void {
    callerCallerRuntimeId = 'callerCaller-' + randomUUID();
    callerCallerRelease = new AcquisitionRelease();
    callerCallerSettingsOwner = new SessionSettingsOwner(callerCallerSettings);
    callerCallerRelease.acquire('settings', () =>
      callerCallerSettingsOwner.dispose(),
    );
    callerCallerSettingsOwner.initializeProviderSelection(
      callerCallerConfig.getProvider(),
      callerCallerConfig.getModel(),
    );
    callerCallerSettingsOwner.bindTelemetry(callerCallerConfig);
    callerCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [
      callerCallerRuntimeId,
      callerCallerConfig.getSessionId(),
    ])
      callerCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(callerCallerFiles, scope),
      );
    callerCallerManager = acquirePreferredProviderManager(
      callerCallerConfig,
      callerCallerSettings,
      callerCallerSettingsOwner,
      callerCallerFiles,
      callerCallerRuntimeId,
      callerCredentials().authority,
      callerCallerRelease,
    );
    const factoriesTokenizer = configureProviderTokenizer(callerCallerManager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    callerCallerTokenizer = factoriesTokenizer;
    callerCallerContent = factoriesContent;
    callerCallerOAuth = acquirePreferredOAuth(
      undefined,
      callerCallerPolicy.session.messageBus,
      callerCallerConfig,
      callerCallerSettings,
      callerCallerManager,
      callerCallerRuntimeId,
      callerCallerMcp.profileDefinitions,
      callerCredentials().authority,
      callerCallerRelease,
      undefined,
    );
  }
  async function activatecallerCallerClient(
    intent: ProviderActivationIntent = {
      provider: callerCallerConfig.getProvider(),
      model: callerCallerConfig.getModel(),
    },
  ): Promise<void> {
    const activation = await executeProviderActivation(
      callerCallerConfig,
      intent,
      assembleProviderSwitch(
        callerCallerConfig,
        callerCallerSettings,
        callerCallerManager,
        callerCallerOAuth,
        () => 'agent',
        () => callerCallerOwner.refreshAuth(),
        callerCallerSettingsOwner,
      ),
      callerCallerSettings,
      callerCallerManager,
      (method) => callerCallerOwner.refreshAuth(method),
      assembleModelSelection(callerCallerSettingsOwner),
    );
    requireCallerActivation(activation);
    await callerCallerOwner.initializeTools();
    await callerCallerOwner.getAgentClient().startChat();
  }

  function useProject(): () => string {
    let root = '';
    let project = '';
    let dataHome: string | undefined;
    let sandbox: string | undefined;
    beforeEach(async () => {
      root = await mkdtemp(join(process.cwd(), 'tmp/agent-checkpoints-'));
      project = join(root, 'project');
      await mkdir(project);
      execFileSync('git', ['init', '--initial-branch=main', project]);
      dataHome = process.env.LLXPRT_DATA_HOME;
      sandbox = process.env.SANDBOX;
      process.env.LLXPRT_DATA_HOME = join(root, 'data');
      delete process.env.SANDBOX;
      await writeFile(join(project, 'source.txt'), 'before edit\n');
    });
    afterEach(async () => {
      if (dataHome === undefined) delete process.env.LLXPRT_DATA_HOME;
      else process.env.LLXPRT_DATA_HOME = dataHome;
      if (sandbox === undefined) delete process.env.SANDBOX;
      else process.env.SANDBOX = sandbox;
      await rm(root, { recursive: true, force: true });
    });
    return () => project;
  }

  const project = useProject();

  it('snapshots and restores physical workspace files through the public Agent', async () => {
    const built = await buildAgent('plain-text.jsonl', {
      workingDir: project(),
      checkpointing: true,
      harness: { includeProcessCwd: false, forceConfirmations: false },
    });
    try {
      const hash =
        await built.agent.workspace.checkpoints.createFileSnapshot(
          'public snapshot',
        );
      await writeFile(join(project(), 'source.txt'), 'after edit');
      await built.agent.workspace.checkpoints.restoreProjectFromSnapshot(hash);
      expect(await readFile(join(project(), 'source.txt'), 'utf8')).toBe(
        'before edit\n',
      );
      await writeFile(
        join(project(), 'accepted.txt'),
        'accepted before close\n',
      );
      const accepted = built.agent.workspace.checkpoints.createFileSnapshot(
        'accepted before disposal',
      );
      const closing = built.agent.dispose();
      expect(() =>
        built.agent.workspace.checkpoints.getCurrentCommitHash(),
      ).toThrow('closed');
      expect(await accepted).toMatch(/^[0-9a-f]+$/);
      await closing;
      expect(
        await readFile(
          join(new Storage(project()).getHistoryDir(), '.git/HEAD'),
          'utf8',
        ),
      ).toMatch(/^ref: refs\/heads\/main/);
    } finally {
      await built.cleanup();
    }
  }, 30000);

  it('serializes restorable tool checkpoints using only admitted workspace operations', async () => {
    const built = await buildAgent('plain-text.jsonl', {
      workingDir: project(),
      checkpointing: true,
      harness: { includeProcessCwd: false, forceConfirmations: false },
    });
    try {
      const result = await processRestorableToolCalls(
        [
          {
            callId: 'physical-call',
            name: 'write_file',
            args: {
              file_path: join(project(), 'source.txt'),
              content: 'replacement',
            },
            isClientInitiated: false,
            prompt_id: 'physical-prompt',
          },
        ],
        built.agent.workspace.checkpoints,
        { getHistory: () => built.agent.getHistory() },
      );
      expect(result.errors).toStrictEqual([]);
      expect(result.checkpointsToWrite.size).toBe(1);
      for (const serialized of result.checkpointsToWrite.values()) {
        const checkpoint = getToolCallDataSchema().parse(
          JSON.parse(serialized),
        );
        const hash = checkpoint.commitHash;
        if (hash === undefined)
          throw new Error('Physical checkpoint hash missing');
        await writeFile(join(project(), 'source.txt'), 'replacement');
        await built.agent.workspace.checkpoints.restoreProjectFromSnapshot(
          hash,
        );
        expect(await readFile(join(project(), 'source.txt'), 'utf8')).toBe(
          'before edit\n',
        );
        expect(checkpoint.messageId).toBe('physical-prompt');
      }
    } finally {
      await built.cleanup();
    }
  }, 30000);
  it.each([0, 1])(
    'retains the explicit caller root when borrowed facade %s closes first',
    async (closingIndex) => {
      await opencallerCaller('multi-turn-text.jsonl', {
        workingDir: project(),
        checkpointing: true,
        harness: { includeProcessCwd: false, forceConfirmations: false },
      });
      const options = {
        config: callerCallerConfig,
        settingsService: callerCallerSettings,
        settingsOwner: callerCallerSettingsOwner,
        providerManager: callerCallerManager,
        messageBus: callerCallerPolicy.session.messageBus,
        mcpRuntime: callerCallerMcp,
      };
      const first = await fromConfig(options);
      const second = await fromConfig(options);
      const closing = closingIndex === 0 ? first : second;
      const peer = closingIndex === 0 ? second : first;
      try {
        const hash =
          await peer.workspace.checkpoints.createFileSnapshot(
            'caller checkpoint',
          );
        const disposal = closing.dispose();
        expect(() =>
          closing.workspace.checkpoints.createFileSnapshot('closed facade'),
        ).toThrow('closed');
        await disposal;
        await writeFile(join(project(), 'source.txt'), 'peer edit');
        await peer.workspace.checkpoints.restoreProjectFromSnapshot(hash);
        expect(await readFile(join(project(), 'source.txt'), 'utf8')).toBe(
          'before edit\n',
        );
        await peer.dispose();
        const operations = callerCallerMcp.workspaceCheckpoints.operations;
        expect(await operations.getCurrentCommitHash()).toBe(hash);
        callerCallerSettingsOwner.assertSettingsIdentity(callerCallerSettings);
        expect(callerCallerOwner.getAgentClient().isInitialized()).toBe(true);
      } finally {
        await first.dispose();
        await second.dispose();
        await callerCallerClose();
      }
    },
    30000,
  );
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
