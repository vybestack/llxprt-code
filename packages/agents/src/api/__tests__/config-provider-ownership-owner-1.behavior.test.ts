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
import { beforeAll, afterAll, describe, expect, it, vi } from 'bun:test';
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
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

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
  it('strips prior session thought signatures during a GenAI to Vertex client replacement', async () => {
    await withSession(async () => {
      const priorEnvironment = {
        GEMINI_API_KEY: process.env.GEMINI_API_KEY,
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
      };
      try {
        delete process.env.GEMINI_API_KEY;
        delete process.env.GOOGLE_API_KEY;
        await sessionClient().initialize({
          model: 'fake-model',
          vertexai: false,
        });
        await sessionClient().setHistory([
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'thinking',
                thought: 'Reasoning before migration',
                signature: 'genai-session-signature',
              },
              { type: 'text', text: 'Visible history' },
            ],
          },
        ]);
        process.env.GOOGLE_API_KEY = 'local-vertex-metadata-only';
        await builtCallerOwner.refreshAuth();
        const retained = await sessionClient().getHistory();
        expect(
          retained
            .flatMap((content) => content.blocks)
            .filter((block) => 'signature' in block),
        ).toHaveLength(0);
        expect(
          retained
            .flatMap((content) => content.blocks)
            .filter((block) => block.type === 'thinking'),
        ).toHaveLength(1);
      } finally {
        for (const [key, value] of Object.entries(priorEnvironment)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });
  });

  it('refreshes authentication and clears fallback mode', async () => {
    await withSession(async () => {
      const previous = sessionClient();
      builtCallerSettingsOwner.chooseModel('replacement-model');
      builtCallerConfig.setFallbackMode(true);
      await builtCallerOwner.refreshAuth();
      expect(sessionClient().getContentGeneratorConfig()?.model).toBe(
        'replacement-model',
      );
      expect(previous).not.toBe(sessionClient());
      expect(builtCallerConfig.isInFallbackMode()).toBe(false);
    });
  });

  it('preserves conversation history when refreshing authentication', async () => {
    await withSession(async () => {
      await sessionClient().setHistory(history);
      await builtCallerOwner.refreshAuth();
      await sessionClient().startChat(await sessionClient().getHistory());
      expect(
        (await sessionClient().getHistory()).map(({ speaker, blocks }) => ({
          speaker,
          blocks,
        })),
      ).toStrictEqual(history);
    });
  });

  it('preserves carried history before chat initialization (#2500)', async () => {
    await withSession(async () => {
      await builtCallerOwner.refreshAuth();
      expect(sessionClient().hasChatInitialized()).toBe(false);
      await sessionClient().storeHistoryForLaterUse(history);
      await builtCallerOwner.refreshAuth();
      await sessionClient().startChat(await sessionClient().getHistory());
      expect(
        (await sessionClient().getHistory()).map(({ speaker, blocks }) => ({
          speaker,
          blocks,
        })),
      ).toStrictEqual(history);
    });
  });

  it('preserves committed chat history without waiting for idle history', async () => {
    await withSession(async () => {
      await sessionClient().setHistory(history);
      const idleHistory = vi
        .spyOn(sessionClient(), 'getHistory')
        .mockImplementation(async () => {
          throw new Error('Idle history must not be awaited');
        });
      try {
        await builtCallerOwner.refreshAuth();
        await sessionClient().startChat(await sessionClient().getHistory());
        expect(
          (await sessionClient().getHistory()).map(({ speaker, blocks }) => ({
            speaker,
            blocks,
          })),
        ).toStrictEqual(history);
      } finally {
        idleHistory.mockRestore();
      }
    });
  });
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
