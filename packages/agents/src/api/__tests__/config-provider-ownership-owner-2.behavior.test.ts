import {
  createCapturedSessionOwner,
  ownerClients,
} from './helpers/session-client-capture.js';
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
import { buildAgentClientFactory } from '../agentBootstrap.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { AgentConfig, ProviderActivationIntent } from '../config-types.js';
import { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import { transferHistoryToNewClient } from '@vybestack/llxprt-code-core/config/agentClientLifecycle.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createTestAgentClient } from '@vybestack/llxprt-code-test-utils/core/config.js';
import {
  MemoryTokenStore,
  createTestProvider,
} from './helpers/provider-auth-fixtures.js';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';

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
describe('explicit session authentication lifecycle', () => {
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

  let builtCallerRelease: AcquisitionRelease;

  let builtCallerFiles: ProviderFileLifecycle;

  let builtCallerRuntimeId: string;

  let builtCallerOAuth: ReturnType<typeof acquirePreferredOAuth>;

  let builtCallerTokenizer: ReturnType<typeof configureProviderTokenizer>;

  let builtCallerContent: ReturnType<
    typeof createRuntimeContentGeneratorFactory
  >;

  function sessionClient(): AgentClientContract {
    const clients = ownerClients(builtCallerOwner);
    if (clients.length === 0)
      throw new Error('Session owner has built no client');
    return clients[clients.length - 1];
  }

  async function openbuiltCaller(
    fixture: string,
    overrides: Readonly<Partial<AgentConfig>> = {},
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
    builtCallerOwner = await createCapturedSessionOwner(
      builtCallerConfig,
      assembleTaskSchemaPolicy(builtCallerSettings),
      builtCallerManager,
      buildAgentClientFactory(),
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
        undefined,
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
    const factoriesTokenizer = configureProviderTokenizer(builtCallerManager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    builtCallerTokenizer = factoriesTokenizer;
    builtCallerContent = factoriesContent;
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
      undefined,
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
    await sessionClient().startChat();
  }

  async function withSession(run: () => Promise<void>): Promise<void> {
    await openbuiltCaller('multi-turn-text.jsonl');
    try {
      await run();
    } finally {
      await builtCallerClose();
    }
  }

  const history: IContent[] = [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Remember the passphrase' }],
    },
    {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'PURPLE-TANGERINE-7741' }],
    },
  ];
  it('initializes a replacement without conversation history', async () => {
    await withSession(async () => {
      await builtCallerOwner.refreshAuth();
      await sessionClient().startChat(await sessionClient().getHistory());
      expect(sessionClient().isInitialized()).toBe(true);
      expect(await sessionClient().getHistory()).toStrictEqual([]);
    });
  });

  it('strips thought signatures when migrating from GenAI to Vertex', async () => {
    const thoughts: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Hidden reasoning',
            signature: 'genai-signature',
          },
          { type: 'text', text: 'Visible response' },
        ],
      },
    ];
    const stored: IContent[][] = [];
    const client = createTestAgentClient({
      storeHistoryForLaterUse: async (contents) => {
        stored.push(structuredClone([...contents]));
      },
    });
    await transferHistoryToNewClient(
      new DebugLogger('test'),
      client,
      thoughts,
      null,
      { model: 'vertex-model', vertexai: true },
      false,
    );
    expect(
      stored
        .flatMap((contents) => contents.flatMap((content) => content.blocks))
        .some((block) => 'signature' in block),
    ).toBe(false);
    expect(thoughts[0].blocks[0]).toHaveProperty('signature');
  });

  it('preserves thought signatures when migrating from Vertex to GenAI', async () => {
    const thoughts: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Reasoning',
            signature: 'vertex-signature',
          },
        ],
      },
    ];
    const stored: IContent[][] = [];
    const client = createTestAgentClient({
      storeHistoryForLaterUse: async (contents) => {
        stored.push(structuredClone([...contents]));
      },
    });
    await transferHistoryToNewClient(
      new DebugLogger('test'),
      client,
      thoughts,
      null,
      { model: 'genai-model', vertexai: false },
      true,
    );
    expect(
      stored
        .flatMap((contents) => contents.flatMap((content) => content.blocks))
        .filter((block) => 'signature' in block),
    ).toHaveLength(1);
  });

  it('does not trigger OAuth during explicit authentication refresh', async () => {
    await withSession(async () => {
      const store = new MemoryTokenStore();
      const oauth = new OAuthManager(store, undefined, {
        config: builtCallerConfig,
      });
      const provider = createTestProvider('fake');
      let logins = 0;
      oauth.registerProvider({
        ...provider,
        initiateAuth: async () => {
          logins += 1;
          throw new Error('Unexpected OAuth login');
        },
      });
      builtCallerOwner.bindProviderFiles(builtCallerFiles, (provider) =>
        oauth.composeRetryOperations(provider),
      );
      await builtCallerOwner.refreshAuth();
      await sessionClient().startChat(await sessionClient().getHistory());
      expect(sessionClient().isInitialized()).toBe(true);
      expect(logins).toBe(0);
    });
  });

  it('preserves history and caller OAuth ownership after refresh', async () => {
    await withSession(async () => {
      await sessionClient().setHistory(history);
      const oauth = new OAuthManager(new MemoryTokenStore(), undefined, {
        config: builtCallerConfig,
      });
      builtCallerOwner.bindProviderFiles(builtCallerFiles, (provider) =>
        oauth.composeRetryOperations(provider),
      );
      await builtCallerOwner.refreshAuth();
      await sessionClient().startChat(await sessionClient().getHistory());
      expect(
        (await sessionClient().getHistory()).map(({ speaker, blocks }) => ({
          speaker,
          blocks,
        })),
      ).toStrictEqual(history);
      expect(await oauth.getTokenStore().listProviders()).toStrictEqual([]);
    });
  });
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
