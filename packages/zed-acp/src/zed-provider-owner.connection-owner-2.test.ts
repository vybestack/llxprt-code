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
import { mkdtemp, realpath, rm, readdir, readFile } from 'node:fs/promises';
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
  useOwnedCredentials();
  useOwnedCredentials();
  useOwnedCredentials();

  const ownerCredentials = useOwnedCredentials();

  let ownerCallerConfig: Config;

  let ownerCallerSettings: SettingsService;

  let ownerCallerSettingsOwner: SessionSettingsOwner;

  let ownerCallerPolicy: RuntimePolicyOwner;

  let ownerCallerMcp: McpRuntimeOwner;

  let ownerCallerManager: ReturnType<typeof acquirePreferredProviderManager>;

  let ownerCallerOwner: SessionClientOwner;

  let ownerCallerClose: () => Promise<void>;

  let ownerCallerFactories: AgentRuntimeFactoryBindings;

  let ownerCallerRelease: AcquisitionRelease;

  let ownerCallerFiles: ProviderFileLifecycle;

  let ownerCallerRuntimeId: string;

  let ownerCallerOAuth: ReturnType<typeof acquirePreferredOAuth>;

  let ownerCallerTokenizer: ReturnType<typeof configureProviderTokenizer>;

  let ownerCallerContent: ReturnType<
    typeof createRuntimeContentGeneratorFactory
  >;

  async function openownerCaller(
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
      await mkdtemp(join(tmpdir(), 'ownerCaller-adoption-')),
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
    ownerCallerConfig = new Config(parameters);
    ownerCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...suppliedFactories,
    };
    ownerCallerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      ownerCallerConfig.getInitialSettings(),
    ))
      ownerCallerSettings.set(key, value);
    ownerCallerPolicy = new RuntimePolicyOwner(ownerCallerConfig);
    injectConfirmationForcingPolicy(ownerCallerPolicy.session.confirmation);
    ownerCallerMcp = await buildTestMcpRuntime(
      ownerCallerConfig,
      ownerCallerPolicy.session.messageBus,
      overrides,
      extensionLoader,
      ownerCallerPolicy,
      skillOperations,
    );
    acquireownerCallerProviders();
    const media = new SessionMediaOwner(
      ownerCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    ownerCallerOwner = await SessionClientOwner.create(
      ownerCallerConfig,
      assembleTaskSchemaPolicy(ownerCallerSettings),
      ownerCallerManager,
      ownerCallerFactories.agentClientFactory,
      media.store,
      ownerCallerMcp.readInstructions,
      ownerCallerMcp.workspacePaths,
      ownerCallerSettingsOwner,
      ownerCallerContent,
      ownerCallerTokenizer,
    );
    ownerCallerOwner.bindMcpRuntime(ownerCallerMcp);
    ownerCallerOwner.bindProviderFiles(ownerCallerFiles, (provider) =>
      ownerCallerOAuth.composeRetryOperations(provider),
    );
    ownerCallerOwner.bindHooks();
    ownerCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => ownerCallerOwner.dispose(),
        () => ownerCallerRelease.close(),
        () => media.dispose(),
        () => ownerCallerMcp.dispose(),
        () => ownerCallerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        ownerCallerConfig,
        ownerCallerSettings,
        ownerCallerSettingsOwner,
        ownerCallerManager,
        ownerCallerOAuth,
        ownerCallerRuntimeId,
        ownerCallerTokenizer,
        undefined,
      );
      await ownerCallerMcp.initialize();
      await activateownerCallerClient(selection.activation);
    } catch (primary) {
      await cleanupAfterFailure(primary, ownerCallerClose);
    }
  }

  function acquireownerCallerProviders(): void {
    ownerCallerRuntimeId = 'ownerCaller-' + randomUUID();
    ownerCallerRelease = new AcquisitionRelease();
    ownerCallerSettingsOwner = new SessionSettingsOwner(ownerCallerSettings);
    ownerCallerRelease.acquire('settings', () =>
      ownerCallerSettingsOwner.dispose(),
    );
    ownerCallerSettingsOwner.initializeProviderSelection(
      ownerCallerConfig.getProvider(),
      ownerCallerConfig.getModel(),
    );
    ownerCallerSettingsOwner.bindTelemetry(ownerCallerConfig);
    ownerCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [
      ownerCallerRuntimeId,
      ownerCallerConfig.getSessionId(),
    ])
      ownerCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(ownerCallerFiles, scope),
      );
    ownerCallerManager = acquirePreferredProviderManager(
      ownerCallerConfig,
      ownerCallerSettings,
      ownerCallerSettingsOwner,
      ownerCallerFiles,
      ownerCallerRuntimeId,
      ownerCredentials().authority,
      ownerCallerRelease,
    );
    const factoriesTokenizer = configureProviderTokenizer(ownerCallerManager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    ownerCallerTokenizer = factoriesTokenizer;
    ownerCallerContent = factoriesContent;
    ownerCallerOAuth = acquirePreferredOAuth(
      undefined,
      ownerCallerPolicy.session.messageBus,
      ownerCallerConfig,
      ownerCallerSettings,
      ownerCallerManager,
      ownerCallerRuntimeId,
      ownerCallerMcp.profileDefinitions,
      ownerCredentials().authority,
      ownerCallerRelease,
      undefined,
    );
  }

  async function activateownerCallerClient(
    intent: ProviderActivationIntent = {
      provider: ownerCallerConfig.getProvider(),
      model: ownerCallerConfig.getModel(),
    },
  ): Promise<void> {
    const activation = await executeProviderActivation(
      ownerCallerConfig,
      intent,
      assembleProviderSwitch(
        ownerCallerConfig,
        ownerCallerSettings,
        ownerCallerManager,
        ownerCallerOAuth,
        () => 'agent',
        () => ownerCallerOwner.refreshAuth(),
        ownerCallerSettingsOwner,
      ),
      ownerCallerSettings,
      ownerCallerManager,
      (method) => ownerCallerOwner.refreshAuth(method),
      assembleModelSelection(ownerCallerSettingsOwner),
    );
    requireCallerActivation(activation);
    await ownerCallerOwner.initializeTools();
    await ownerCallerOwner.getAgentClient().startChat();
  }

  let ownerRoot: string;
  let ownerClient: acp.ClientSideConnection;
  let ownerUpdates: acp.SessionUpdate[];
  let ownerClose: () => Promise<void>;

  async function openowner(label: string): Promise<void> {
    ownerRoot = await mkdtemp(join(tmpdir(), 'zed-owner-'));
    roots.push(ownerRoot);
    await openownerCaller('multi-turn-text.jsonl', {
      workingDir: ownerRoot,
      sessionId: label,
      settings: { profileDirectory: join(ownerRoot, 'profiles') },
    });
    const profiles = new ProfileManager(join(ownerRoot, 'profiles'));
    for (const name of ['alpha', 'beta'])
      await profiles.saveProfile(name, {
        version: 1,
        provider: 'fake',
        model: name + '-model',
        modelParams: {},
        ephemeralSettings: {},
      });
    const application = assembleProfileApplication(
      ownerCallerSettings,
      ownerCallerManager,
      null,
      assembleProviderSwitch(
        ownerCallerConfig,
        ownerCallerSettings,
        ownerCallerManager,
        null,
        () => undefined,
        () => ownerCallerOwner.refreshAuth(),
        ownerCallerSettingsOwner,
      ),
      ownerCallerSettingsOwner,
      profiles,
    );
    const fromClient = new TransformStream<Uint8Array, Uint8Array>();
    const fromAgent = new TransformStream<Uint8Array, Uint8Array>();
    ownerUpdates = [];
    ownerClient = new acp.ClientSideConnection(
      () => ({
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
        sessionUpdate: async ({ update }) => {
          ownerUpdates.push(update);
        },
      }),
      acp.ndJsonStream(fromClient.writable, fromAgent.readable),
    );
    const serving = serveZedConnection(
      {
        config: ownerCallerConfig,
        trustPort: ownerCallerMcp.trust,
        createSessionSettings: () =>
          ownerCallerSettingsOwner.createChildStore(),
        profileApplication: application,
        profileDefinitions: ownerCallerMcp.profileDefinitions,
        providerInputs: { credentialAuthority: ownerCredentials().authority },
      },
      acp.ndJsonStream(fromAgent.writable, fromClient.readable),
    );
    ownerClose = () =>
      runCleanupSteps([
        () => fromClient.writable.close(),
        () => serving,
        ownerCallerClose,
      ]);
    await ownerClient.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
    });
  }

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });
  it('closes one session without disposing another session or the connection owner', async () => {
    await openowner('one-connection');
    try {
      await ownerClient.authenticate({ methodId: 'alpha' });
      const first = await ownerClient.newSession({
        cwd: ownerRoot,
        mcpServers: [],
      });
      const second = await ownerClient.newSession({
        cwd: ownerRoot,
        mcpServers: [],
      });
      await ownerClient.closeSession({ sessionId: first.sessionId });
      await ownerClient.closeSession({ sessionId: first.sessionId });
      expect(ownerCallerMcp.isStopped()).toBe(false);
      expect(
        (
          await ownerClient.prompt({
            sessionId: second.sessionId,
            prompt: [{ type: 'text', text: 'surviving-session-marker' }],
          })
        ).stopReason,
      ).toBe('end_turn');
      const journalNames = await readdir(ownerCallerConfig.projectChatsDir);
      const journals = await Promise.all(
        journalNames
          .filter((name) => name.endsWith('.jsonl'))
          .map((name) =>
            readFile(join(ownerCallerConfig.projectChatsDir, name), 'utf8'),
          ),
      );
      expect(journals.join('\n')).toContain('surviving-session-marker');
    } finally {
      await ownerClose();
    }
  });
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
