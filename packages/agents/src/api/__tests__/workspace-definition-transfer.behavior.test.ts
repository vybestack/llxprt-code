import {
  createCapturedSessionOwner,
  capturedSessionClient,
} from './helpers/session-client-capture.js';
import { captureAgentAdoption as fromConfig } from './helpers/agent-resource-capture.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  Config,
  ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import {
  mkdtemp,
  realpath,
  rm,
  readFile,
  mkdir,
  writeFile,
} from 'node:fs/promises';
import { basename, join } from 'node:path';
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
import { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
import { gateReadFile } from './helpers/gated-read-file.js';

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

  it('closes and drains a transferred definition root without retiring the borrowed workspace', async () => {
    await opencallerCaller('multi-turn-text.jsonl', {
      workingDir: root,
      harness: { includeProcessCwd: false, forceConfirmations: false },
    });
    const definitions = new WorkspaceDefinitionOwner(
      join(root, 'owned/profiles'),
      join(root, 'owned/subagents'),
    );
    const agent = await fromConfig(
      callerCallerConfig,
      callerCallerSettings,
      { definitionOwnership: 'agent' },
      callerCallerSettingsOwner,
      callerCallerManager,
      undefined,
      callerCallerPolicy.session.messageBus,
      callerCallerMcp,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      definitions,
    );
    await mkdir(join(root, 'owned/profiles'), { recursive: true });
    await writeFile(
      join(root, 'owned/profiles/held.json'),
      JSON.stringify(agent.captureProfile()),
    );
    const read = gateReadFile((file) => basename(String(file)) === 'held.json');
    try {
      const accepted = agent.workspace.profileDefinitions.loadProfile('held');
      await read.entered;
      let finished = false;
      const closing = agent.dispose().then(() => {
        finished = true;
      });
      expect(() => definitions.profileReads.listProfiles()).toThrow('closed');
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      expect(finished).toBe(false);
      read.release();
      await accepted;
      await closing;
      expect(finished).toBe(true);
    } finally {
      read.restore();
    }
    try {
      expect(callerCallerMcp.isStopped()).toBe(false);
      await callerCallerMcp.profileWrites.saveProfile(
        'survivor',
        agent.captureProfile(),
      );
      expect(await callerCallerMcp.profileDefinitions.listProfiles()).toContain(
        'survivor',
      );
    } finally {
      await callerCallerClose();
      await definitions.dispose();
    }
  }, 30000);

  it('retires an explicitly transferred same definition root without stopping its borrowed MCP owner', async () => {
    await opencallerCaller('multi-turn-text.jsonl', {
      workingDir: root,
    });
    const definitions = callerCallerMcp.workspaceDefinitions;
    const agent = await fromConfig(
      callerCallerConfig,
      callerCallerSettings,
      { definitionOwnership: 'agent' },
      callerCallerSettingsOwner,
      callerCallerManager,
      undefined,
      callerCallerPolicy.session.messageBus,
      callerCallerMcp,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      definitions,
    );
    try {
      await agent.saveProfileSnapshot('transferred');
      await agent.dispose();
      expect(() => definitions.profileReads.listProfiles()).toThrow('closed');
      expect(callerCallerMcp.isStopped()).toBe(false);
      expect(
        JSON.parse(
          await readFile(
            join(root, 'config/profiles/transferred.json'),
            'utf8',
          ),
        ).version,
      ).toBe(1);
      callerCallerSettingsOwner.assertSettingsIdentity(callerCallerSettings);
    } finally {
      await agent.dispose();
      await callerCallerClose();
    }
  }, 30000);

  it('cleans a transferred definition root when adoption fails before session preparation', async () => {
    await opencallerCaller('multi-turn-text.jsonl', {
      workingDir: root,
    });
    const definitions = new WorkspaceDefinitionOwner(
      join(root, 'failure/profiles'),
      join(root, 'failure/subagents'),
    );
    try {
      await expect(
        fromConfig(
          callerCallerConfig,
          callerCallerSettings,
          { sessionId: '', definitionOwnership: 'agent' },
          callerCallerSettingsOwner,
          callerCallerManager,
          undefined,
          callerCallerPolicy.session.messageBus,
          callerCallerMcp,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          definitions,
        ),
      ).rejects.toThrow('non-empty');
      expect(() => definitions.profileReads.listProfiles()).toThrow('closed');
      expect(callerCallerMcp.isStopped()).toBe(false);
    } finally {
      await definitions.dispose();
      await callerCallerClose();
    }
  }, 30000);
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
