import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  Config,
  ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises';
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
  waitForFixtureFile,
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

  const fixtureCredentials = useOwnedCredentials();

  let fixtureCallerConfig: Config;

  let fixtureCallerSettings: SettingsService;

  let fixtureCallerSettingsOwner: SessionSettingsOwner;

  let fixtureCallerPolicy: RuntimePolicyOwner;

  let fixtureCallerMcp: McpRuntimeOwner;

  let fixtureCallerManager: ReturnType<typeof acquirePreferredProviderManager>;

  let fixtureCallerOwner: SessionClientOwner;

  let fixtureCallerClose: () => Promise<void>;

  let fixtureCallerFactories: AgentRuntimeFactoryBindings;

  let fixtureCallerRelease: AcquisitionRelease;

  let fixtureCallerFiles: ProviderFileLifecycle;

  let fixtureCallerRuntimeId: string;

  let fixtureCallerOAuth: ReturnType<typeof acquirePreferredOAuth>;

  let fixtureCallerTokenizer: ReturnType<typeof configureProviderTokenizer>;

  let fixtureCallerContent: ReturnType<
    typeof createRuntimeContentGeneratorFactory
  >;

  async function openfixtureCaller(
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
      await mkdtemp(join(tmpdir(), 'fixtureCaller-adoption-')),
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
    fixtureCallerConfig = new Config(parameters);
    fixtureCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...suppliedFactories,
    };
    fixtureCallerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      fixtureCallerConfig.getInitialSettings(),
    ))
      fixtureCallerSettings.set(key, value);
    fixtureCallerPolicy = new RuntimePolicyOwner(fixtureCallerConfig);
    injectConfirmationForcingPolicy(fixtureCallerPolicy.session.confirmation);
    fixtureCallerMcp = await buildTestMcpRuntime(
      fixtureCallerConfig,
      fixtureCallerPolicy.session.messageBus,
      overrides,
      extensionLoader,
      fixtureCallerPolicy,
      skillOperations,
    );
    acquirefixtureCallerProviders();
    const media = new SessionMediaOwner(
      fixtureCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    fixtureCallerOwner = await SessionClientOwner.create(
      fixtureCallerConfig,
      assembleTaskSchemaPolicy(fixtureCallerSettings),
      fixtureCallerManager,
      fixtureCallerFactories.agentClientFactory,
      media.store,
      fixtureCallerMcp.readInstructions,
      fixtureCallerMcp.workspacePaths,
      fixtureCallerSettingsOwner,
      fixtureCallerContent,
      fixtureCallerTokenizer,
    );
    fixtureCallerOwner.bindMcpRuntime(fixtureCallerMcp);
    fixtureCallerOwner.bindProviderFiles(fixtureCallerFiles, (provider) =>
      fixtureCallerOAuth.composeRetryOperations(provider),
    );
    fixtureCallerOwner.bindHooks();
    fixtureCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => fixtureCallerOwner.dispose(),
        () => fixtureCallerRelease.close(),
        () => media.dispose(),
        () => fixtureCallerMcp.dispose(),
        () => fixtureCallerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        fixtureCallerConfig,
        fixtureCallerSettings,
        fixtureCallerSettingsOwner,
        fixtureCallerManager,
        fixtureCallerOAuth,
        fixtureCallerRuntimeId,
        fixtureCallerTokenizer,
        undefined,
      );
      await fixtureCallerMcp.initialize();
      await activatefixtureCallerClient(selection.activation);
    } catch (primary) {
      await cleanupAfterFailure(primary, fixtureCallerClose);
    }
  }

  function acquirefixtureCallerProviders(): void {
    fixtureCallerRuntimeId = 'fixtureCaller-' + randomUUID();
    fixtureCallerRelease = new AcquisitionRelease();
    fixtureCallerSettingsOwner = new SessionSettingsOwner(
      fixtureCallerSettings,
    );
    fixtureCallerRelease.acquire('settings', () =>
      fixtureCallerSettingsOwner.dispose(),
    );
    fixtureCallerSettingsOwner.initializeProviderSelection(
      fixtureCallerConfig.getProvider(),
      fixtureCallerConfig.getModel(),
    );
    fixtureCallerSettingsOwner.bindTelemetry(fixtureCallerConfig);
    fixtureCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [
      fixtureCallerRuntimeId,
      fixtureCallerConfig.getSessionId(),
    ])
      fixtureCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(fixtureCallerFiles, scope),
      );
    fixtureCallerManager = acquirePreferredProviderManager(
      fixtureCallerConfig,
      fixtureCallerSettings,
      fixtureCallerSettingsOwner,
      fixtureCallerFiles,
      fixtureCallerRuntimeId,
      fixtureCredentials().authority,
      fixtureCallerRelease,
    );
    const factoriesTokenizer = configureProviderTokenizer(fixtureCallerManager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    fixtureCallerTokenizer = factoriesTokenizer;
    fixtureCallerContent = factoriesContent;
    fixtureCallerOAuth = acquirePreferredOAuth(
      undefined,
      fixtureCallerPolicy.session.messageBus,
      fixtureCallerConfig,
      fixtureCallerSettings,
      fixtureCallerManager,
      fixtureCallerRuntimeId,
      fixtureCallerMcp.profileDefinitions,
      fixtureCredentials().authority,
      fixtureCallerRelease,
      undefined,
    );
  }

  async function activatefixtureCallerClient(
    intent: ProviderActivationIntent = {
      provider: fixtureCallerConfig.getProvider(),
      model: fixtureCallerConfig.getModel(),
    },
  ): Promise<void> {
    const activation = await executeProviderActivation(
      fixtureCallerConfig,
      intent,
      assembleProviderSwitch(
        fixtureCallerConfig,
        fixtureCallerSettings,
        fixtureCallerManager,
        fixtureCallerOAuth,
        () => 'agent',
        () => fixtureCallerOwner.refreshAuth(),
        fixtureCallerSettingsOwner,
      ),
      fixtureCallerSettings,
      fixtureCallerManager,
      (method) => fixtureCallerOwner.refreshAuth(method),
      assembleModelSelection(fixtureCallerSettingsOwner),
    );
    requireCallerActivation(activation);
    await fixtureCallerOwner.initializeTools();
    await fixtureCallerOwner.getAgentClient().startChat();
  }

  let fixtureDirectory: string;
  let fixtureServer: PhysicalCatalogFixture;

  async function openfixture(
    serverNames: string[] = ['physical'],
  ): Promise<void> {
    fixtureDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'workspace-catalog-')),
    );
    fixtureServer = await startCatalogFixture(fixtureDirectory);
    await openfixtureCaller('plain-text.jsonl', {
      workingDir: fixtureDirectory,
      folderTrust: true,
      mcpServers: Object.fromEntries(
        serverNames.map((name) => [
          name,
          { httpUrl: fixtureServer.url, trust: true },
        ]),
      ),
      telemetry: { enabled: false },
      recording: { enabled: false },
    });
    await fixtureCallerMcp.awaitDiscovery();
  }

  async function closefixture(): Promise<void> {
    fixtureServer.release();
    await runCleanupSteps([
      fixtureCallerClose,
      () => fixtureServer.stop(),
      () => rm(fixtureDirectory, { recursive: true, force: true }),
    ]);
  }
  useOwnedCredentials();
  useOwnedCredentials();

  it('cancels retained physical prompt invocation and denies reuse after root disposal', async () => {
    await openfixture();
    try {
      const prompt = fixtureCallerMcp
        .listPrompts('physical')
        .find((prompt) => prompt.serverName === 'physical');
      if (!prompt) throw new Error('Physical prompt was not published');
      expect((await prompt.invoke({})).messages[0]?.content).toMatchObject({
        text: 'Quantity squared is 49',
      });
      const outcome = prompt.invoke({ hold: 'yes' }).then(
        () => 'fulfilled',
        () => 'rejected',
      );
      expect(await waitForFixtureFile(join(fixtureDirectory, 'entered'))).toBe(
        'prompts/get',
      );
      await fixtureCallerMcp.dispose();
      expect(await outcome).toBe('rejected');
      await expect(prompt.invoke({})).rejects.toThrow('stopped');
      expect(
        (await readFile(join(fixtureDirectory, 'requests'), 'utf8')).split(
          '\n',
        ),
      ).toContain('notifications/cancelled');
    } finally {
      await closefixture();
    }
  }, 30000);
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
