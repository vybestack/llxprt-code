import { captureActivationAcquisition as assembleAgentActivationBootstrap } from './helpers/activation-acquisition-capture.js';
import { capturedActivation } from './helpers/activation-acquisition-capture.js';
import {
  createCapturedSessionOwner,
  capturedSessionClient,
} from './helpers/session-client-capture.js';
import { captureAgentAdoption as fromConfig } from './helpers/agent-resource-capture.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';

import { ConfigParameters } from '@vybestack/llxprt-code-core/config/config.js';

import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';

import { readFile } from 'node:fs/promises';

import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';

import {
  ProviderFileLifecycle,
  FakeProvider,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
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
import { cleanupAfterFailure } from '../../core/subagent-cleanup.js';
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

import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { fixturesDir } from './helpers/fixture-data.js';
import { AgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { AgentConfig, ProviderActivationIntent } from '../config-types.js';
import { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';

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
describe('public Agent workspace definition lifetime', () => {
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
    callerCallerOwner = await createCapturedSessionOwner(
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
    await capturedSessionClient(callerCallerOwner).startChat();
  }
  useOwnedCredentials();
  useOwnedCredentials();

  let root: string;

  const directories: string[] = [];

  let previousHome: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'llxprt-public-definitions-'));
    directories.push(root);
    previousHome = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = join(root, 'config');
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousHome;
  });

  afterAll(async () => {
    await Promise.all(
      directories.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it('transfers the owned preflight disk root into adoption and retires only its repository lifetime', async () => {
    const callerFactorylessPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('fixtures/' + 'multi-turn-text.jsonl', import.meta.url),
    );
    const callerFactorylessDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'factoryless-caller-')),
    );

    const callerFactorylessConfig = new Config(
      toConfigParameters({
        ...{
          provider: 'fake',
          model: 'fake-model',
          workingDir: callerFactorylessDirectory,
        },
        ...{
          workingDir: root,
        },
      }),
    );
    const callerFactorylessSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      callerFactorylessConfig.getInitialSettings(),
    ))
      callerFactorylessSettings.set(key, value);
    const callerFactorylessSettingsOwner = new SessionSettingsOwner(
      callerFactorylessSettings,
    );
    callerFactorylessSettingsOwner.bindTelemetry(callerFactorylessConfig);
    callerFactorylessSettingsOwner.initializeProviderSelection(
      callerFactorylessConfig.getProvider(),
      callerFactorylessConfig.getModel(),
    );
    const callerFactorylessPolicy = new RuntimePolicyOwner(
      callerFactorylessConfig,
    );
    createAgentRuntimeFactoryBindings();

    const callerFactorylessClose = settleFactorylessRelease.bind(
      undefined,
      [
        () => callerFactorylessSettingsOwner.dispose(),
        () => callerFactorylessPolicy.dispose(),
        () => callerFactorylessConfig.dispose(),
        () => rm(callerFactorylessDirectory, { recursive: true, force: true }),
      ],
      callerFactorylessPreviousReplay,
    );

    const manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      callerFactorylessSettings,
      callerFactorylessConfig,
      undefined,
      new CredentialAuthority(),
    );
    manager.registerProvider(
      new FakeProvider(join(fixturesDir, 'multi-turn-text.jsonl')),
    );
    const operation = await assembleAgentActivationBootstrap(
      callerFactorylessConfig,
      callerFactorylessSettings,
      manager,
      null,
      () => undefined,
      'borrowed',
      undefined,
      undefined,
      undefined,
      undefined,
      callerFactorylessSettingsOwner,
      'borrowed',
      callerFactorylessPolicy.trust,
    );
    const intent: Parameters<typeof operation.preflight>[0] = {
      provider: 'fake',
      authMode: 'auto',
      cliOverrides: { key: 'preflight-fixture-key' },
    };
    let agent: Awaited<ReturnType<typeof fromConfig>> | undefined;
    try {
      await capturedActivation(
        operation,
      ).workspaceDefinitions.profileWrites.saveProfile('owned-preflight', {
        version: 1,
        provider: 'fake',
        model: 'owned-preflight-model',
        modelParams: {},
        ephemeralSettings: {},
      });
      const result = await operation.preflight(intent);
      if (!result.token) throw new Error('Missing preflight receipt');
      agent = await fromConfig(
        callerFactorylessConfig,
        callerFactorylessSettings,
        { activation: intent },
        callerFactorylessSettingsOwner,
        manager,
        undefined,
        callerFactorylessPolicy.session.messageBus,
        undefined,
        { operation, token: result.token },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        callerFactorylessPolicy,
      );
      await agent.profiles.load('owned-preflight');
      expect(agent.captureProfile().model).toBe('owned-preflight-model');
      await agent.saveProfileSnapshot('owned-adopted');
      await operation.dispose();
      expect(await agent.workspace.profileDefinitions.listProfiles()).toContain(
        'owned-adopted',
      );
      await agent.dispose();
      expect(() =>
        capturedActivation(
          operation,
        ).workspaceDefinitions.profileReads.listProfiles(),
      ).toThrow('closed');
      const persisted: unknown = JSON.parse(
        await readFile(
          join(root, 'config/profiles/owned-adopted.json'),
          'utf8',
        ),
      );
      expect(persisted).toMatchObject({
        version: 1,
        model: 'owned-preflight-model',
      });
      callerFactorylessSettingsOwner.assertSettingsIdentity(
        callerFactorylessSettings,
      );
    } finally {
      await agent?.dispose();
      await operation.dispose();
      manager.dispose();
      await callerFactorylessClose();
    }
  }, 30000);

  it('retains the exact borrowed preflight definition root through adoption and Agent disposal', async () => {
    const callerDefinitions = new WorkspaceDefinitionOwner(
      join(root, 'caller/profiles'),
      join(root, 'caller/subagents'),
    );
    await opencallerCaller('multi-turn-text.jsonl', {
      workingDir: root,
      definitionOwner: callerDefinitions,
      definitionOwnership: 'caller',
    });
    const manager = callerCallerManager;
    const operation = await assembleAgentActivationBootstrap(
      callerCallerConfig,
      callerCallerSettings,
      manager,
      null,
      () => undefined,
      'borrowed',
      capturedSessionClient(callerCallerOwner),
      callerCallerMcp,
      callerCallerMcp.workspaceFilesystem,
      callerCallerMcp.workspaceMemory,
      callerCallerSettingsOwner,
    );
    let agent: Awaited<ReturnType<typeof fromConfig>> | undefined;
    try {
      await capturedActivation(
        operation,
      ).workspaceDefinitions.profileWrites.saveProfile('preflight', {
        version: 1,
        provider: 'fake',
        model: 'preflight-model',
        modelParams: {},
        ephemeralSettings: {},
      });
      const intent: Parameters<typeof operation.preflight>[0] = {
        provider: 'fake',
        authMode: 'auto',
      };
      const receipt = await operation.preflight(intent);
      if (!receipt.token)
        throw receipt.authError ?? new Error('Missing preflight receipt');
      agent = await fromConfig(
        callerCallerConfig,
        callerCallerSettings,
        { activation: intent },
        callerCallerSettingsOwner,
        manager,
        undefined,
        undefined,
        callerCallerMcp,
        { operation, token: receipt.token },
      );
      await agent.profiles.load('preflight');
      expect(agent.getModel()).toBe('preflight-model');
      await agent.saveProfileSnapshot('after-adoption');
      expect(
        await capturedActivation(
          operation,
        ).workspaceDefinitions.profileReads.listProfiles(),
      ).toContain('after-adoption');
      await agent.dispose();
      await capturedActivation(
        operation,
      ).workspaceDefinitions.profileWrites.saveProfile('caller-survives', {
        version: 1,
        provider: 'fake',
        model: 'fake-model',
        modelParams: {},
        ephemeralSettings: {},
      });
      expect(
        await capturedActivation(
          operation,
        ).workspaceDefinitions.profileReads.listProfiles(),
      ).toContain('caller-survives');
    } finally {
      await agent?.dispose();
      await operation.dispose();
      await callerCallerClose();
      await callerDefinitions.dispose();
    }
  }, 30000);
});

async function settleFactorylessRelease(
  steps: ReadonlyArray<() => void | Promise<void>>,
  previous: string | undefined,
): Promise<void> {
  try {
    await runCleanupSteps(steps);
  } finally {
    if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previous;
  }
}

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
