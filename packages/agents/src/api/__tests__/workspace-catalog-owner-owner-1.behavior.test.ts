import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  Config,
  ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
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
  startCatalogFixture,
  type PhysicalCatalogFixture,
} from './helpers/workspace-catalog-http-fixture.js';

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
describe('workspace catalog ownership through public Agent operations', () => {
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
  useOwnedCredentials();

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
      new URL('./fixtures/' + fixture, import.meta.url),
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

  let firstDirectory: string;
  let firstServer: PhysicalCatalogFixture;

  async function openfirst(
    serverNames: string[] = ['physical'],
  ): Promise<void> {
    firstDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'workspace-catalog-')),
    );
    firstServer = await startCatalogFixture(firstDirectory);
    await openfirstCaller('plain-text.jsonl', {
      workingDir: firstDirectory,
      folderTrust: true,
      mcpServers: Object.fromEntries(
        serverNames.map((name) => [
          name,
          { httpUrl: firstServer.url, trust: true },
        ]),
      ),
      telemetry: { enabled: false },
      recording: { enabled: false },
    });
    await firstCallerMcp.awaitDiscovery();
  }

  async function closefirst(): Promise<void> {
    firstServer.release();
    await runCleanupSteps([
      firstCallerClose,
      () => firstServer.stop(),
      () => rm(firstDirectory, { recursive: true, force: true }),
    ]);
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
      new URL('./fixtures/' + fixture, import.meta.url),
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

  let secondDirectory: string;
  let secondServer: PhysicalCatalogFixture;

  async function opensecond(
    serverNames: string[] = ['physical'],
  ): Promise<void> {
    secondDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'workspace-catalog-')),
    );
    secondServer = await startCatalogFixture(secondDirectory);
    await opensecondCaller('plain-text.jsonl', {
      workingDir: secondDirectory,
      folderTrust: true,
      mcpServers: Object.fromEntries(
        serverNames.map((name) => [
          name,
          { httpUrl: secondServer.url, trust: true },
        ]),
      ),
      telemetry: { enabled: false },
      recording: { enabled: false },
    });
    await secondCallerMcp.awaitDiscovery();
  }

  async function closesecond(): Promise<void> {
    secondServer.release();
    await runCleanupSteps([
      secondCallerClose,
      () => secondServer.stop(),
      () => rm(secondDirectory, { recursive: true, force: true }),
    ]);
  }

  it('keeps same-label physical workspace resources and prompts independent', async () => {
    await openfirst();
    await opensecond();
    try {
      await writeFile(join(secondDirectory, 'quantity'), '11');
      expect(
        await firstCallerMcp.readResource('physical', 'fixture:///quantity'),
      ).toMatchObject({ contents: [{ text: '7' }] });
      expect(
        await secondCallerMcp.readResource('physical', 'fixture:///quantity'),
      ).toMatchObject({ contents: [{ text: '11' }] });
      const firstPrompt = firstCallerMcp
        .listPrompts('physical')
        .find((prompt) => prompt.name === 'quantity');
      const secondPrompt = secondCallerMcp
        .listPrompts('physical')
        .find((prompt) => prompt.name === 'quantity');
      if (firstPrompt === undefined || secondPrompt === undefined)
        throw new Error('Missing independent physical prompts');
      expect((await firstPrompt.invoke({})).messages[0]?.content).toMatchObject(
        { text: 'Quantity squared is 49' },
      );
      expect(
        (await secondPrompt.invoke({})).messages[0]?.content,
      ).toMatchObject({ text: 'Quantity squared is 121' });
      await firstCallerMcp.dispose();
      expect(
        await secondCallerMcp.readResource('physical', 'fixture:///quantity'),
      ).toMatchObject({ contents: [{ text: '11' }] });
      expect(
        (await secondPrompt.invoke({})).messages[0]?.content,
      ).toMatchObject({ text: 'Quantity squared is 121' });
    } finally {
      await closefirst();
      await closesecond();
    }
  }, 30000);
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
