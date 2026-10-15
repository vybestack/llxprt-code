import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  Config,
  ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  configureProviderRuntimeFactories,
  createSessionAuthPolicyReader,
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
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
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
import {
  createTestProvider,
  makeToken,
} from './helpers/provider-auth-fixtures.js';
import { fromConfig } from '@vybestack/llxprt-code-agents';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import {
  buildAgent,
  drain,
  internalConfig,
  internalSettingsOwner,
} from './helpers/agentHarness.js';

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
describe('explicit provider owner construction', () => {
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
      new URL('./fixtures/' + fixture, import.meta.url),
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

  const credentials = useOwnedCredentials();
  it('constructs a public Agent without storing manager authority on Config', async () => {
    const built = await buildAgent('multi-turn-text.jsonl');
    try {
      const events = await drain(
        built.agent.stream('Construct without a Config service locator'),
      );
      expect(events.some((event) => event.type === 'text')).toBe(true);
      expect('providerManager' in internalConfig(built.agent)).toBe(false);
      expect('getProviderManager' in internalConfig(built.agent)).toBe(false);
      expect('setProviderManager' in internalConfig(built.agent)).toBe(false);
    } finally {
      await built.cleanup();
    }
  });

  it('adopts an initialized caller Config and exact explicit manager without manager discovery', async () => {
    await openbuiltCaller('multi-turn-text.jsonl');
    const client = builtCallerOwner.getAgentClient();
    await client.startChat();
    Object.defineProperty(builtCallerConfig, 'getProviderManager', {
      configurable: true,
      value: () => {
        throw new Error('Forbidden Config provider manager discovery');
      },
    });
    try {
      const options = {
        settingsService: builtCallerSettings,
        config: builtCallerConfig,
        agentClient: builtCallerOwner.getAgentClient(),
        providerManager: builtCallerManager,
        mcpRuntime: builtCallerMcp,
      };
      const agent = await fromConfig(options);
      try {
        expect(internalConfig(agent)).toBe(builtCallerConfig);
        expect(agent.providerManager).toBe(builtCallerManager);
        expect(client).toBe(builtCallerOwner.getAgentClient());
        const events = await drain(agent.stream('Adopt the explicit owner'));
        expect(events.some((event) => event.type === 'text')).toBe(true);
        await agent.dispose();
        expect(client.isInitialized()).toBe(true);
        expect(builtCallerManager.hasActiveProvider()).toBe(true);
        await client.startChat();
        expect(client.hasChatInitialized()).toBe(true);
      } finally {
        await agent.dispose();
      }
    } finally {
      await builtCallerClose();
    }
  });

  it('keeps the caller client usable after explicit-owner activation failure', async () => {
    await openbuiltCaller('multi-turn-text.jsonl');
    const client = builtCallerOwner.getAgentClient();
    await client.startChat();
    Object.defineProperty(builtCallerConfig, 'getProviderManager', {
      configurable: true,
      value: () => {
        throw new Error('Forbidden Config provider manager discovery');
      },
    });
    try {
      const options = {
        settingsService: builtCallerSettings,
        config: builtCallerConfig,
        agentClient: builtCallerOwner.getAgentClient(),
        providerManager: builtCallerManager,
        mcpRuntime: builtCallerMcp,
        activation: { provider: 'missing-provider', authMode: 'auto' },
      };
      await expect(
        fromConfig({
          ...options,
          activation: { ...options.activation, authMode: 'auto' },
        }),
      ).rejects.toThrow('activation failed');
      expect(client.isInitialized()).toBe(true);
      expect(builtCallerManager.getActiveProviderName()).toBe('fake');
      await client.startChat();
      expect(client.hasChatInitialized()).toBe(true);
    } finally {
      await builtCallerClose();
    }
  });

  it('publishes telemetry changes to an explicit lifecycle subscriber without manager ownership', async () => {
    const built = await buildAgent('multi-turn-text.jsonl');
    const settings = internalSettingsOwner(built.agent);
    const observed: boolean[] = [];
    const unsubscribe = settings.onTelemetrySettingsChange(() =>
      observed.push(settings.readTelemetrySettings().enabled === true),
    );
    try {
      await settings.updateTelemetrySettings({ enabled: true });
      expect(observed.length).toBe(1);
      unsubscribe();
      await settings.updateTelemetrySettings({ enabled: false });
      expect(observed).toHaveLength(1);
    } finally {
      await built.cleanup();
    }
  });

  it('retains the caller OAuth owner through activation and borrowed facade shutdown', async () => {
    await openbuiltCaller('multi-turn-text.jsonl');
    const store = credentials().authority.createTokenStore();
    const callerOAuth = new OAuthManager(store, undefined, {
      config: builtCallerConfig,
      messageBus: builtCallerPolicy.session.messageBus,
      readSessionAuthPolicy: createSessionAuthPolicyReader(builtCallerSettings),
    });
    callerOAuth.registerProvider(createTestProvider('fake'));
    await callerOAuth.toggleOAuthEnabled('fake');
    try {
      const agent = await fromConfig({
        credentialAuthority: credentials().authority,
        oauthManager: callerOAuth,
        providerFileLifecycle: builtCallerFiles,
        settingsOwner: builtCallerSettingsOwner,
        settingsService: builtCallerSettings,
        config: builtCallerConfig,
        agentClient: builtCallerOwner.getAgentClient(),
        providerManager: builtCallerManager,
        mcpRuntime: builtCallerMcp,
      });
      try {
        expect((await agent.auth.detailedStatus('fake')).authenticated).toBe(
          false,
        );
        await store.saveToken('fake', makeToken('borrowed-oauth'));
        expect((await agent.auth.detailedStatus('fake')).authenticated).toBe(
          true,
        );
        expect(callerOAuth.getTokenStore()).toBe(store);
        builtCallerSettingsOwner.writeUserParameter('auth.noBrowser', true);
        expect(callerOAuth.isBrowserDisabled()).toBe(true);
        await agent.dispose();
        builtCallerSettings.set('auth.noBrowser', false);
        expect(callerOAuth.isBrowserDisabled()).toBe(false);
        expect(await callerOAuth.isAuthenticated('fake')).toBe(true);
        expect(credentials().snapshot()).toStrictEqual([0]);
        await store.removeToken('fake');
        expect(await callerOAuth.isAuthenticated('fake')).toBe(false);
      } finally {
        await agent.dispose();
      }
    } finally {
      await callerOAuth.dispose();
      await builtCallerClose();
    }
  });
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
