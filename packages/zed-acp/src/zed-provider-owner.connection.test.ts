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
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
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
import { createAgent } from '../../agents/src/api/createAgent.js';
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

  let firstCallerTokenizer: ReturnType<
    typeof configureProviderRuntimeFactories
  >['tokenizerFactory'];

  let firstCallerContent: ReturnType<
    typeof configureProviderRuntimeFactories
  >['contentGeneratorFactory'];

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
    const factories = configureProviderRuntimeFactories(
      firstCallerConfig,
      firstCallerManager,
    );
    firstCallerTokenizer = factories.tokenizerFactory;
    firstCallerContent = factories.contentGeneratorFactory;
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

  const secondCredentials = useOwnedCredentials();

  let secondCallerConfig: Config;

  let secondCallerSettings: SettingsService;

  let secondCallerSettingsOwner: SessionSettingsOwner;

  let secondCallerPolicy: RuntimePolicyOwner;

  let secondCallerMcp: McpRuntimeOwner;

  let secondCallerManager: ReturnType<typeof acquirePreferredProviderManager>;

  let secondCallerOwner: SessionClientOwner;

  let secondCallerClose: () => Promise<void>;

  let secondCallerFactories: AgentRuntimeFactoryBindings;

  let secondCallerRelease: AcquisitionRelease;

  let secondCallerFiles: ProviderFileLifecycle;

  let secondCallerRuntimeId: string;

  let secondCallerOAuth: ReturnType<typeof acquirePreferredOAuth>;

  let secondCallerTokenizer: ReturnType<
    typeof configureProviderRuntimeFactories
  >['tokenizerFactory'];

  let secondCallerContent: ReturnType<
    typeof configureProviderRuntimeFactories
  >['contentGeneratorFactory'];

  async function opensecondCaller(
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
      await mkdtemp(join(tmpdir(), 'secondCaller-adoption-')),
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
    secondCallerConfig = new Config(parameters);
    secondCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...suppliedFactories,
    };
    secondCallerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      secondCallerConfig.getInitialSettings(),
    ))
      secondCallerSettings.set(key, value);
    secondCallerPolicy = new RuntimePolicyOwner(secondCallerConfig);
    injectConfirmationForcingPolicy(secondCallerPolicy.session.confirmation);
    secondCallerMcp = await buildTestMcpRuntime(
      secondCallerConfig,
      secondCallerPolicy.session.messageBus,
      overrides,
      extensionLoader,
      secondCallerPolicy,
      skillOperations,
    );
    acquiresecondCallerProviders();
    const media = new SessionMediaOwner(
      secondCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    secondCallerOwner = await SessionClientOwner.create(
      secondCallerConfig,
      assembleTaskSchemaPolicy(secondCallerSettings),
      secondCallerManager,
      secondCallerFactories.agentClientFactory,
      media.store,
      secondCallerMcp.readInstructions,
      secondCallerMcp.workspacePaths,
      secondCallerSettingsOwner,
      secondCallerContent,
      secondCallerTokenizer,
    );
    secondCallerOwner.bindMcpRuntime(secondCallerMcp);
    secondCallerOwner.bindProviderFiles(secondCallerFiles, (provider) =>
      secondCallerOAuth.composeRetryOperations(provider),
    );
    secondCallerOwner.bindHooks();
    secondCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => secondCallerOwner.dispose(),
        () => secondCallerRelease.close(),
        () => media.dispose(),
        () => secondCallerMcp.dispose(),
        () => secondCallerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        secondCallerConfig,
        secondCallerSettings,
        secondCallerSettingsOwner,
        secondCallerManager,
        secondCallerOAuth,
        secondCallerRuntimeId,
        secondCallerTokenizer,
        undefined,
      );
      await secondCallerMcp.initialize();
      await activatesecondCallerClient(selection.activation);
    } catch (primary) {
      await cleanupAfterFailure(primary, secondCallerClose);
    }
  }

  function acquiresecondCallerProviders(): void {
    secondCallerRuntimeId = 'secondCaller-' + randomUUID();
    secondCallerRelease = new AcquisitionRelease();
    secondCallerSettingsOwner = new SessionSettingsOwner(secondCallerSettings);
    secondCallerRelease.acquire('settings', () =>
      secondCallerSettingsOwner.dispose(),
    );
    secondCallerSettingsOwner.initializeProviderSelection(
      secondCallerConfig.getProvider(),
      secondCallerConfig.getModel(),
    );
    secondCallerSettingsOwner.bindTelemetry(secondCallerConfig);
    secondCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [
      secondCallerRuntimeId,
      secondCallerConfig.getSessionId(),
    ])
      secondCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(secondCallerFiles, scope),
      );
    secondCallerManager = acquirePreferredProviderManager(
      secondCallerConfig,
      secondCallerSettings,
      secondCallerSettingsOwner,
      secondCallerFiles,
      secondCallerRuntimeId,
      secondCredentials().authority,
      secondCallerRelease,
    );
    const factories = configureProviderRuntimeFactories(
      secondCallerConfig,
      secondCallerManager,
    );
    secondCallerTokenizer = factories.tokenizerFactory;
    secondCallerContent = factories.contentGeneratorFactory;
    secondCallerOAuth = acquirePreferredOAuth(
      undefined,
      secondCallerPolicy.session.messageBus,
      secondCallerConfig,
      secondCallerSettings,
      secondCallerManager,
      secondCallerRuntimeId,
      secondCallerMcp.profileDefinitions,
      secondCredentials().authority,
      secondCallerRelease,
      undefined,
    );
  }

  async function activatesecondCallerClient(
    intent: ProviderActivationIntent = {
      provider: secondCallerConfig.getProvider(),
      model: secondCallerConfig.getModel(),
    },
  ): Promise<void> {
    const activation = await executeProviderActivation(
      secondCallerConfig,
      intent,
      assembleProviderSwitch(
        secondCallerConfig,
        secondCallerSettings,
        secondCallerManager,
        secondCallerOAuth,
        () => 'agent',
        () => secondCallerOwner.refreshAuth(),
        secondCallerSettingsOwner,
      ),
      secondCallerSettings,
      secondCallerManager,
      (method) => secondCallerOwner.refreshAuth(method),
      assembleModelSelection(secondCallerSettingsOwner),
    );
    requireCallerActivation(activation);
    await secondCallerOwner.initializeTools();
    await secondCallerOwner.getAgentClient().startChat();
  }

  let secondRoot: string;
  let secondClient: acp.ClientSideConnection;
  let secondUpdates: acp.SessionUpdate[];
  let secondClose: () => Promise<void>;

  async function opensecond(label: string): Promise<void> {
    secondRoot = await mkdtemp(join(tmpdir(), 'zed-owner-'));
    roots.push(secondRoot);
    await opensecondCaller('multi-turn-text.jsonl', {
      workingDir: secondRoot,
      sessionId: label,
      settings: { profileDirectory: join(secondRoot, 'profiles') },
    });
    const profiles = new ProfileManager(join(secondRoot, 'profiles'));
    for (const name of ['alpha', 'beta'])
      await profiles.saveProfile(name, {
        version: 1,
        provider: 'fake',
        model: name + '-model',
        modelParams: {},
        ephemeralSettings: {},
      });
    const application = assembleProfileApplication(
      secondCallerSettings,
      secondCallerManager,
      null,
      assembleProviderSwitch(
        secondCallerConfig,
        secondCallerSettings,
        secondCallerManager,
        null,
        () => undefined,
        () => secondCallerOwner.refreshAuth(),
        secondCallerSettingsOwner,
      ),
      secondCallerSettingsOwner,
      profiles,
    );
    const fromClient = new TransformStream<Uint8Array, Uint8Array>();
    const fromAgent = new TransformStream<Uint8Array, Uint8Array>();
    secondUpdates = [];
    secondClient = new acp.ClientSideConnection(
      () => ({
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
        sessionUpdate: async ({ update }) => {
          secondUpdates.push(update);
        },
      }),
      acp.ndJsonStream(fromClient.writable, fromAgent.readable),
    );
    const serving = serveZedConnection(
      {
        config: secondCallerConfig,
        trustPort: secondCallerMcp.trust,
        createSessionSettings: () =>
          secondCallerSettingsOwner.createChildStore(),
        profileApplication: application,
        profileDefinitions: secondCallerMcp.profileDefinitions,
        providerInputs: { credentialAuthority: secondCredentials().authority },
      },
      acp.ndJsonStream(fromAgent.writable, fromClient.readable),
    );
    secondClose = () =>
      runCleanupSteps([
        () => fromClient.writable.close(),
        () => serving,
        secondCallerClose,
      ]);
    await secondClient.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
    });
  }
  useOwnedCredentials();
  useOwnedCredentials();

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it('keeps two same-label Agent/Zed connections independent across auth, model and recording, and cleanup', async () => {
    const label = 'equal-zed-agent-label';
    await openfirst(label);
    await opensecond(label);
    const sibling = await createAgent({
      provider: 'openai',
      model: 'gpt-4o-mini',
      workingDir: process.cwd(),
      sessionId: label,
      auth: { apiKey: 'agent-key', baseUrl: 'http://127.0.0.1:1/v1' },
    });
    try {
      await firstClient.authenticate({ methodId: 'alpha' });
      await secondClient.authenticate({ methodId: 'beta' });
      await sibling.session.setRecording({ enabled: true });
      await sibling.setModel('agent-own-model');
      expect([
        firstCallerSettingsOwner.readSelectedModel(),
        secondCallerSettingsOwner.readSelectedModel(),
        sibling.captureProfile().model,
      ]).toStrictEqual(['alpha-model', 'beta-model', 'agent-own-model']);
      expect(firstCallerSettings.getCurrentProfileName()).toBe('alpha');
      expect(secondCallerSettings.getCurrentProfileName()).toBe('beta');
      expect(firstCallerManager).not.toBe(secondCallerManager);
      expect(firstCallerOAuth).not.toBe(secondCallerOAuth);
      await firstClose();
      await secondClient.authenticate({ methodId: 'alpha' });
      await sibling.setModel('agent-after-first-close');
      expect([
        secondCallerSettingsOwner.readSelectedModel(),
        sibling.captureProfile().model,
      ]).toStrictEqual(['alpha-model', 'agent-after-first-close']);
      expect(sibling.session.getRecording().enabled).toBe(true);
    } finally {
      await secondClose();
      await sibling.dispose();
    }
  });
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
