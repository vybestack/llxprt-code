import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  Config,
  ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import {
  SettingsService,
  ProfileManager,
} from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../../agents/src/api/mcpRuntimeAssembly.js';
import { toConfigParameters } from '../../agents/src/api/agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
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
import { useOwnedCredentials } from '../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../../agents/src/api/preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../../agents/src/api/adoption-release.js';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../agents/src/core/subagent-cleanup.js';
import { SessionClientOwner } from '../../agents/src/session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { beforeAll, afterAll, describe, expect, it, afterEach } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from '../../agents/src/api/__tests__/helpers/mcp-owner-fixture.js';
import {
  createAgentRuntimeFactoryBindings,
  AgentRuntimeFactoryBindings,
} from '../../agents/src/api/runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../../agents/src/api/confirmationForcing.js';
import { executeProviderActivation } from '../../agents/src/api/providerActivationExecutor.js';
import { assembleProviderSwitch } from '../../agents/src/api/providerSwitchAssembly.js';
import { assembleModelSelection } from '../../agents/src/api/model-selection.js';
import {
  AgentConfig,
  ProviderActivationIntent,
} from '../../agents/src/api/config-types.js';
import { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import { assembleProfileApplication } from '@vybestack/llxprt-code-agents';
import { serveZedConnection } from './runZedIntegration.js';
import * as acp from '@agentclientprotocol/sdk';

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
describe('Zed ACP provider ownership', () => {
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

  const roots: string[] = [];

  const firstCredentials = useOwnedCredentials();

  let firstCallerConfig: Config;

  let firstCallerSettings: SettingsService;

  let firstCallerSettingsOwner: SessionSettingsOwner;

  let firstCallerPolicy: RuntimePolicyOwner;

  let firstCallerMcp: McpRuntimeOwner;

  let firstCallerManager: ReturnType<typeof acquirePreferredProviderManager>;

  let firstCallerOwner: SessionClientOwner;

  let firstCallerClose: () => Promise<void>;

  let firstCallerFactories: AgentRuntimeFactoryBindings;

  let firstCallerRelease: AcquisitionRelease;

  let firstCallerFiles: ProviderFileLifecycle;

  let firstCallerRuntimeId: string;

  let firstCallerOAuth: ReturnType<typeof acquirePreferredOAuth>;

  let firstCallerTokenizer: ReturnType<typeof configureProviderTokenizer>;

  let firstCallerContent: ReturnType<
    typeof createRuntimeContentGeneratorFactory
  >;

  async function openfirstCaller(
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
        '../../agents/src/api/__tests__/fixtures/' + fixture,
        import.meta.url,
      ),
    );
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'firstCaller-adoption-')),
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
    firstCallerConfig = new Config(parameters);
    firstCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...suppliedFactories,
    };
    firstCallerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      firstCallerConfig.getInitialSettings(),
    ))
      firstCallerSettings.set(key, value);
    firstCallerPolicy = new RuntimePolicyOwner(firstCallerConfig);
    injectConfirmationForcingPolicy(firstCallerPolicy.session.confirmation);
    firstCallerMcp = await buildTestMcpRuntime(
      firstCallerConfig,
      firstCallerPolicy.session.messageBus,
      overrides,
      extensionLoader,
      firstCallerPolicy,
      skillOperations,
    );
    acquirefirstCallerProviders();
    const media = new SessionMediaOwner(
      firstCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    firstCallerOwner = await SessionClientOwner.create(
      firstCallerConfig,
      assembleTaskSchemaPolicy(firstCallerSettings),
      firstCallerManager,
      firstCallerFactories.agentClientFactory,
      media.store,
      firstCallerMcp.readInstructions,
      firstCallerMcp.workspacePaths,
      firstCallerSettingsOwner,
      firstCallerContent,
      firstCallerTokenizer,
    );
    firstCallerOwner.bindMcpRuntime(firstCallerMcp);
    firstCallerOwner.bindProviderFiles(firstCallerFiles, (provider) =>
      firstCallerOAuth.composeRetryOperations(provider),
    );
    firstCallerOwner.bindHooks();
    firstCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => firstCallerOwner.dispose(),
        () => firstCallerRelease.close(),
        () => media.dispose(),
        () => firstCallerMcp.dispose(),
        () => firstCallerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        firstCallerConfig,
        firstCallerSettings,
        firstCallerSettingsOwner,
        firstCallerManager,
        firstCallerOAuth,
        firstCallerRuntimeId,
        firstCallerTokenizer,
        undefined,
      );
      await firstCallerMcp.initialize();
      await activatefirstCallerClient(selection.activation);
    } catch (primary) {
      await cleanupAfterFailure(primary, firstCallerClose);
    }
  }

  function acquirefirstCallerProviders(): void {
    firstCallerRuntimeId = 'firstCaller-' + randomUUID();
    firstCallerRelease = new AcquisitionRelease();
    firstCallerSettingsOwner = new SessionSettingsOwner(firstCallerSettings);
    firstCallerRelease.acquire('settings', () =>
      firstCallerSettingsOwner.dispose(),
    );
    firstCallerSettingsOwner.initializeProviderSelection(
      firstCallerConfig.getProvider(),
      firstCallerConfig.getModel(),
    );
    firstCallerSettingsOwner.bindTelemetry(firstCallerConfig);
    firstCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [
      firstCallerRuntimeId,
      firstCallerConfig.getSessionId(),
    ])
      firstCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(firstCallerFiles, scope),
      );
    firstCallerManager = acquirePreferredProviderManager(
      firstCallerConfig,
      firstCallerSettings,
      firstCallerSettingsOwner,
      firstCallerFiles,
      firstCallerRuntimeId,
      firstCredentials().authority,
      firstCallerRelease,
    );
    const factoriesTokenizer = configureProviderTokenizer(firstCallerManager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    firstCallerTokenizer = factoriesTokenizer;
    firstCallerContent = factoriesContent;
    firstCallerOAuth = acquirePreferredOAuth(
      undefined,
      firstCallerPolicy.session.messageBus,
      firstCallerConfig,
      firstCallerSettings,
      firstCallerManager,
      firstCallerRuntimeId,
      firstCallerMcp.profileDefinitions,
      firstCredentials().authority,
      firstCallerRelease,
      undefined,
    );
  }

  async function activatefirstCallerClient(
    intent: ProviderActivationIntent = {
      provider: firstCallerConfig.getProvider(),
      model: firstCallerConfig.getModel(),
    },
  ): Promise<void> {
    const activation = await executeProviderActivation(
      firstCallerConfig,
      intent,
      assembleProviderSwitch(
        firstCallerConfig,
        firstCallerSettings,
        firstCallerManager,
        firstCallerOAuth,
        () => 'agent',
        () => firstCallerOwner.refreshAuth(),
        firstCallerSettingsOwner,
      ),
      firstCallerSettings,
      firstCallerManager,
      (method) => firstCallerOwner.refreshAuth(method),
      assembleModelSelection(firstCallerSettingsOwner),
    );
    requireCallerActivation(activation);
    await firstCallerOwner.initializeTools();
    await firstCallerOwner.getAgentClient().startChat();
  }

  let firstRoot: string;
  let firstClient: acp.ClientSideConnection;
  let firstUpdates: acp.SessionUpdate[];
  let firstClose: () => Promise<void>;

  async function openfirst(label: string): Promise<void> {
    firstRoot = await mkdtemp(join(tmpdir(), 'zed-owner-'));
    roots.push(firstRoot);
    await openfirstCaller('multi-turn-text.jsonl', {
      workingDir: firstRoot,
      sessionId: label,
      settings: { profileDirectory: join(firstRoot, 'profiles') },
    });
    const profiles = new ProfileManager(join(firstRoot, 'profiles'));
    for (const name of ['alpha', 'beta'])
      await profiles.saveProfile(name, {
        version: 1,
        provider: 'fake',
        model: name + '-model',
        modelParams: {},
        ephemeralSettings: {},
      });
    const application = assembleProfileApplication(
      firstCallerSettings,
      firstCallerManager,
      null,
      assembleProviderSwitch(
        firstCallerConfig,
        firstCallerSettings,
        firstCallerManager,
        null,
        () => undefined,
        () => firstCallerOwner.refreshAuth(),
        firstCallerSettingsOwner,
      ),
      firstCallerSettingsOwner,
      profiles,
    );
    const fromClient = new TransformStream<Uint8Array, Uint8Array>();
    const fromAgent = new TransformStream<Uint8Array, Uint8Array>();
    firstUpdates = [];
    firstClient = new acp.ClientSideConnection(
      () => ({
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
        sessionUpdate: async ({ update }) => {
          firstUpdates.push(update);
        },
      }),
      acp.ndJsonStream(fromClient.writable, fromAgent.readable),
    );
    const serving = serveZedConnection(
      {
        config: firstCallerConfig,
        trustPort: firstCallerMcp.trust,
        createSessionSettings: () =>
          firstCallerSettingsOwner.createChildStore(),
        profileApplication: application,
        profileDefinitions: firstCallerMcp.profileDefinitions,
        providerInputs: { credentialAuthority: firstCredentials().authority },
      },
      acp.ndJsonStream(fromAgent.writable, fromClient.readable),
    );
    firstClose = () =>
      runCleanupSteps([
        () => fromClient.writable.close(),
        () => serving,
        firstCallerClose,
      ]);
    await firstClient.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
    });
  }
  useOwnedCredentials();

  const nextCredentials = useOwnedCredentials();

  let nextCallerConfig: Config;

  let nextCallerSettings: SettingsService;

  let nextCallerSettingsOwner: SessionSettingsOwner;

  let nextCallerPolicy: RuntimePolicyOwner;

  let nextCallerMcp: McpRuntimeOwner;

  let nextCallerManager: ReturnType<typeof acquirePreferredProviderManager>;

  let nextCallerOwner: SessionClientOwner;

  let nextCallerClose: () => Promise<void>;

  let nextCallerFactories: AgentRuntimeFactoryBindings;

  let nextCallerRelease: AcquisitionRelease;

  let nextCallerFiles: ProviderFileLifecycle;

  let nextCallerRuntimeId: string;

  let nextCallerOAuth: ReturnType<typeof acquirePreferredOAuth>;

  let nextCallerTokenizer: ReturnType<typeof configureProviderTokenizer>;

  let nextCallerContent: ReturnType<
    typeof createRuntimeContentGeneratorFactory
  >;

  async function opennextCaller(
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
        '../../agents/src/api/__tests__/fixtures/' + fixture,
        import.meta.url,
      ),
    );
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'nextCaller-adoption-')),
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
    nextCallerConfig = new Config(parameters);
    nextCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...suppliedFactories,
    };
    nextCallerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      nextCallerConfig.getInitialSettings(),
    ))
      nextCallerSettings.set(key, value);
    nextCallerPolicy = new RuntimePolicyOwner(nextCallerConfig);
    injectConfirmationForcingPolicy(nextCallerPolicy.session.confirmation);
    nextCallerMcp = await buildTestMcpRuntime(
      nextCallerConfig,
      nextCallerPolicy.session.messageBus,
      overrides,
      extensionLoader,
      nextCallerPolicy,
      skillOperations,
    );
    acquirenextCallerProviders();
    const media = new SessionMediaOwner(
      nextCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    nextCallerOwner = await SessionClientOwner.create(
      nextCallerConfig,
      assembleTaskSchemaPolicy(nextCallerSettings),
      nextCallerManager,
      nextCallerFactories.agentClientFactory,
      media.store,
      nextCallerMcp.readInstructions,
      nextCallerMcp.workspacePaths,
      nextCallerSettingsOwner,
      nextCallerContent,
      nextCallerTokenizer,
    );
    nextCallerOwner.bindMcpRuntime(nextCallerMcp);
    nextCallerOwner.bindProviderFiles(nextCallerFiles, (provider) =>
      nextCallerOAuth.composeRetryOperations(provider),
    );
    nextCallerOwner.bindHooks();
    nextCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => nextCallerOwner.dispose(),
        () => nextCallerRelease.close(),
        () => media.dispose(),
        () => nextCallerMcp.dispose(),
        () => nextCallerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        nextCallerConfig,
        nextCallerSettings,
        nextCallerSettingsOwner,
        nextCallerManager,
        nextCallerOAuth,
        nextCallerRuntimeId,
        nextCallerTokenizer,
        undefined,
      );
      await nextCallerMcp.initialize();
      await activatenextCallerClient(selection.activation);
    } catch (primary) {
      await cleanupAfterFailure(primary, nextCallerClose);
    }
  }

  function acquirenextCallerProviders(): void {
    nextCallerRuntimeId = 'nextCaller-' + randomUUID();
    nextCallerRelease = new AcquisitionRelease();
    nextCallerSettingsOwner = new SessionSettingsOwner(nextCallerSettings);
    nextCallerRelease.acquire('settings', () =>
      nextCallerSettingsOwner.dispose(),
    );
    nextCallerSettingsOwner.initializeProviderSelection(
      nextCallerConfig.getProvider(),
      nextCallerConfig.getModel(),
    );
    nextCallerSettingsOwner.bindTelemetry(nextCallerConfig);
    nextCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [nextCallerRuntimeId, nextCallerConfig.getSessionId()])
      nextCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(nextCallerFiles, scope),
      );
    nextCallerManager = acquirePreferredProviderManager(
      nextCallerConfig,
      nextCallerSettings,
      nextCallerSettingsOwner,
      nextCallerFiles,
      nextCallerRuntimeId,
      nextCredentials().authority,
      nextCallerRelease,
    );
    const factoriesTokenizer = configureProviderTokenizer(nextCallerManager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    nextCallerTokenizer = factoriesTokenizer;
    nextCallerContent = factoriesContent;
    nextCallerOAuth = acquirePreferredOAuth(
      undefined,
      nextCallerPolicy.session.messageBus,
      nextCallerConfig,
      nextCallerSettings,
      nextCallerManager,
      nextCallerRuntimeId,
      nextCallerMcp.profileDefinitions,
      nextCredentials().authority,
      nextCallerRelease,
      undefined,
    );
  }

  async function activatenextCallerClient(
    intent: ProviderActivationIntent = {
      provider: nextCallerConfig.getProvider(),
      model: nextCallerConfig.getModel(),
    },
  ): Promise<void> {
    const activation = await executeProviderActivation(
      nextCallerConfig,
      intent,
      assembleProviderSwitch(
        nextCallerConfig,
        nextCallerSettings,
        nextCallerManager,
        nextCallerOAuth,
        () => 'agent',
        () => nextCallerOwner.refreshAuth(),
        nextCallerSettingsOwner,
      ),
      nextCallerSettings,
      nextCallerManager,
      (method) => nextCallerOwner.refreshAuth(method),
      assembleModelSelection(nextCallerSettingsOwner),
    );
    requireCallerActivation(activation);
    await nextCallerOwner.initializeTools();
    await nextCallerOwner.getAgentClient().startChat();
  }

  let nextRoot: string;
  let nextClient: acp.ClientSideConnection;
  let nextUpdates: acp.SessionUpdate[];
  let nextClose: () => Promise<void>;

  async function opennext(label: string): Promise<void> {
    nextRoot = await mkdtemp(join(tmpdir(), 'zed-owner-'));
    roots.push(nextRoot);
    await opennextCaller('multi-turn-text.jsonl', {
      workingDir: nextRoot,
      sessionId: label,
      settings: { profileDirectory: join(nextRoot, 'profiles') },
    });
    const profiles = new ProfileManager(join(nextRoot, 'profiles'));
    for (const name of ['alpha', 'beta'])
      await profiles.saveProfile(name, {
        version: 1,
        provider: 'fake',
        model: name + '-model',
        modelParams: {},
        ephemeralSettings: {},
      });
    const application = assembleProfileApplication(
      nextCallerSettings,
      nextCallerManager,
      null,
      assembleProviderSwitch(
        nextCallerConfig,
        nextCallerSettings,
        nextCallerManager,
        null,
        () => undefined,
        () => nextCallerOwner.refreshAuth(),
        nextCallerSettingsOwner,
      ),
      nextCallerSettingsOwner,
      profiles,
    );
    const fromClient = new TransformStream<Uint8Array, Uint8Array>();
    const fromAgent = new TransformStream<Uint8Array, Uint8Array>();
    nextUpdates = [];
    nextClient = new acp.ClientSideConnection(
      () => ({
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
        sessionUpdate: async ({ update }) => {
          nextUpdates.push(update);
        },
      }),
      acp.ndJsonStream(fromClient.writable, fromAgent.readable),
    );
    const serving = serveZedConnection(
      {
        config: nextCallerConfig,
        trustPort: nextCallerMcp.trust,
        createSessionSettings: () => nextCallerSettingsOwner.createChildStore(),
        profileApplication: application,
        profileDefinitions: nextCallerMcp.profileDefinitions,
        providerInputs: { credentialAuthority: nextCredentials().authority },
      },
      acp.ndJsonStream(fromAgent.writable, fromClient.readable),
    );
    nextClose = () =>
      runCleanupSteps([
        () => fromClient.writable.close(),
        () => serving,
        nextCallerClose,
      ]);
    await nextClient.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
    });
  }
  useOwnedCredentials();

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it('supports successive connections with the same owner label', async () => {
    await openfirst('repeat-label');
    await firstClient.authenticate({ methodId: 'alpha' });
    await firstClose();
    await opennext('repeat-label');
    try {
      await nextClient.authenticate({ methodId: 'beta' });
      expect(nextCallerSettingsOwner.readSelectedModel()).toBe('beta-model');
    } finally {
      await nextClose();
    }
  });
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
