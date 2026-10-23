import { adoptFixture } from '../../agents/src/api/__tests__/helpers/adoption-fixture.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../../agents/src/api/agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  ProviderFileLifecycle,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
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
import {
  createCapturedSessionOwner,
  capturedSessionClient,
} from '../../agents/src/api/__tests__/helpers/session-client-capture.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import {
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from '../../agents/src/api/__tests__/helpers/mcp-owner-fixture.js';
import { createAgentRuntimeFactoryBindings } from '../../agents/src/api/runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../../agents/src/api/confirmationForcing.js';
import { executeProviderActivation } from '../../agents/src/api/providerActivationExecutor.js';
import { assembleProviderSwitch } from '../../agents/src/api/providerSwitchAssembly.js';
import { assembleModelSelection } from '../../agents/src/api/model-selection.js';
import { AgentConfig } from '../../agents/src/api/config-types.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { UiTelemetryService } from '@vybestack/llxprt-code-telemetry';
import {
  makeHeadlessConfig,
  runHeadlessPolicyFixture,
} from './__tests__/headless-policy-fixture.js';
import { automock } from '@vybestack/llxprt-code-test-utils';
import {
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import { prepareAgentPreflight } from '../../agents/src/api/profile-preflight.js';
import { createAgentSetCommand } from './__tests__/set-command-test-owner.js';
import {
  type Agent,
  type AgentEvent,
  type AgentInput,
  type TurnOptions,
} from '@vybestack/llxprt-code-agents';
import { PLACEHOLDER_MODEL } from '@vybestack/llxprt-code-agents/constants.js';
import { runNonInteractive } from './__tests__/noninteractive-run-fixture.js';
import { LoadedSettings } from './config/settings.js';
import { CommandContext } from './ui/commands/types.js';
import { bindCommandErrorRecorder } from './ui/hooks/commandErrorRecorderHost.js';
import { BootstrapProfileArgs } from './config/profileBootstrap.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Captures the resolved query handed to the fake Agent's stream(), and the
// AgentEvents it should emit. Reset per-test in beforeEach.
const realAtCommandProcessorModule = {
  ...(await import('./ui/hooks/atCommandProcessor.js')),
};

const agentState = {
  // runNonInteractive passes the resolved query to agent.stream(); typed as
  // AgentInput | null (matching the stream() parameter type) so assertions get
  // compile-time checking instead of the looser `unknown`.
  streamInput: null as AgentInput | null,
  // The TurnOptions (signal/promptId/maxTurns) handed to agent.stream(), so
  // tests can assert runNonInteractive still forwards prompt_id and maxTurns.
  streamOpts: null as TurnOptions | null,
  events: [] as AgentEvent[],
};

// Activation params (_profileModelParams, _cliModelParams, _bootstrapArgs) have
// no public setter API on Config — production code reads/writes them via the
// same underscore-prefixed casts. This local non-readonly intersection mirrors
// those casts so the test can stage activation state.
type ConfigWithActivationParams = Config & {
  _profileModelParams?: Record<string, unknown>;
  _cliModelParams?: Record<string, unknown>;
  _bootstrapArgs?: BootstrapProfileArgs;
};

function makeConfig(sessionId: string): ReturnType<typeof makeHeadlessConfig> {
  const root = makeHeadlessConfig(sessionId);
  fixtureRoots.push(root);
  return root;
}

let mockCredentialAuthority: CredentialAuthority;

let mockProviderManager: ProviderManager;

let mockRuntimeSettings: {
  owner: SessionSettingsOwner;
  store: SettingsService;
};

const fixtureRoots: Array<{
  config: Config;
  manager: ProviderManager;
  settingsOwner: SessionSettingsOwner;
}> = [];

function runWithMcpBus(
  params: Parameters<typeof runNonInteractive>[0],
): Promise<void> {
  return runHeadlessPolicyFixture(
    params,
    mockRuntimeSettings.owner,
    mockProviderManager,
    mockRuntimeSettings.store,
    mockRuntimeSettings.owner,
    mockCredentialAuthority,
  );
}

const { adoptFixture: actualAdoption } = await import(
  '../../agents/src/api/__tests__/helpers/adoption-fixture.js'
);

void vi.mock(
  '../../agents/src/api/__tests__/helpers/adoption-fixture.js',
  () => ({
    adoptFixture: vi.fn(),
  }),
);

// Mock core modules
void vi.mock('./ui/hooks/atCommandProcessor.js', () =>
  automock(realAtCommandProcessorModule),
);

const actualOriginal = { ...(await import('@vybestack/llxprt-code-core')) };

void vi.mock('@vybestack/llxprt-code-core', () => ({
  ...actualOriginal,
  shutdownTelemetry: vi.fn(),
  isTelemetrySdkInitialized: vi.fn().mockReturnValue(true),
}));

const mockGetCommands = vi.fn();

const mockCommandServiceCreate = vi.fn();

void vi.mock('./services/CommandService.js', () => ({
  CommandService: {
    create: mockCommandServiceCreate,
  },
}));

// Direct-call streaming cases use a fake Agent; the owner command case uses a real one.
function buildFakeAgent(): Agent {
  return {
    getProvider: () => 'openai',
    getModel: () => PLACEHOLDER_MODEL,
    getCurrentSequenceModel: () => null,
    getActiveProfileName: () => null,
    metrics: new UiTelemetryService(),
    stream: (input: AgentInput, opts?: TurnOptions) => {
      agentState.streamInput = input;
      agentState.streamOpts = opts ?? null;
      return (async function* generateFakeStream(): AsyncIterable<AgentEvent> {
        for (const event of agentState.events) {
          yield event;
        }
      })();
    },
    getEphemeralSetting: (key: string) =>
      mockRuntimeSettings.owner.readNamedParameter(key),
    dispose: vi.fn().mockResolvedValue(undefined),
  } as unknown as Agent;
}

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
describe('runNonInteractive - slash commands and thinking output', () => {
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

  const credentials = useOwnedCredentials();

  let mockConfig: Config;

  let mockSettings: LoadedSettings;

  let mockShutdownTelemetry: Mock<(...args: never[]) => Promise<void>>;

  let mockIsTelemetrySdkInitialized: Mock<(...args: never[]) => boolean>;

  beforeEach(async () => {
    mockShutdownTelemetry = shutdownTelemetry as unknown as Mock<
      (...args: never[]) => Promise<void>
    >;
    mockShutdownTelemetry.mockResolvedValue(undefined);
    mockIsTelemetrySdkInitialized =
      isTelemetrySdkInitialized as unknown as Mock<
        (...args: never[]) => boolean
      >;
    mockIsTelemetrySdkInitialized.mockReturnValue(true);

    mockCommandServiceCreate.mockResolvedValue({
      getCommands: mockGetCommands,
    });
    mockGetCommands.mockReturnValue([]);

    vi.spyOn(DebugLogger.prototype, 'error').mockImplementation(() => {});
    vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true) as unknown as Mock<
      (...args: never[]) => boolean
    >;
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const { adoptFixture: fromConfig } = await import(
      '../../agents/src/api/__tests__/helpers/adoption-fixture.js'
    );
    (fromConfig as Mock<typeof adoptFixture>).mockResolvedValue(
      buildFakeAgent(),
    );

    // Default: the Agent emits a clean stop completion. Individual tests
    // override agentState.events to stage thinking/tool/text sequences.
    agentState.streamInput = null;
    agentState.streamOpts = null;
    agentState.events = [{ type: 'done', reason: 'stop' }];

    const builtOwner = makeConfig('test-session');
    mockCredentialAuthority = builtOwner.credentialAuthority;
    mockConfig = builtOwner.config;
    mockProviderManager = builtOwner.manager;
    mockRuntimeSettings = {
      owner: builtOwner.settingsOwner,
      store: builtOwner.settingsService,
    };
    vi.spyOn(mockConfig, 'getProvider').mockReturnValue(undefined);
    vi.spyOn(mockConfig, 'getModel').mockReturnValue(PLACEHOLDER_MODEL);

    mockSettings = {
      system: { path: '', settings: {} },
      systemDefaults: { path: '', settings: {} },
      user: { path: '', settings: {} },
      workspace: { path: '', settings: {} },
      errors: [],
      setValue: vi.fn(),
      merged: {
        security: {
          auth: {
            enforcedType: undefined,
          },
        },
        useExternalAuth: false,
      },
      isTrusted: true,
      migratedInMemorScopes: new Set(),
      forScope: vi.fn(),
      computeMergedSettings: vi.fn(),
    } as unknown as LoadedSettings;

    const { handleAtCommand } = await import(
      './ui/hooks/atCommandProcessor.js'
    );
    (handleAtCommand as Mock<typeof handleAtCommand>).mockImplementation(
      async ({ query }) => ({
        processedQuery: [{ type: 'text', text: query }],
      }),
    );
  });

  afterEach(async () => {
    for (const root of fixtureRoots.splice(0)) {
      await root.settingsOwner.dispose();
      root.manager.dispose();
      await root.config.dispose();
    }
    // Bun's restoreAllMocks restores implementations but leaves the call
    // history of module mocks in place, so clear it explicitly.
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('rejects a registered headless operation without an Agent owner', async () => {
    const recordError = bindCommandErrorRecorder(null, 'agent', undefined);
    mockGetCommands.mockReturnValue([
      {
        name: 'runtime',
        description: 'requires runtime state',
        action: async (invocation: CommandContext) => {
          expect(Reflect.has(invocation, 'services')).toBe(false);
          expect(Reflect.has(invocation, 'runtimeApi')).toBe(false);
          expect(Reflect.has(invocation, 'oauthControl')).toBe(false);
          expect(Reflect.has(invocation, 'refreshProviderAliases')).toBe(false);
          await recordError('Headless command requires an owning session');
          return { type: 'submit_prompt', content: 'unreachable' };
        },
      },
    ]);
    await expect(
      runWithMcpBus({
        config: mockConfig,
        settings: mockSettings,
        input: '/runtime',
        prompt_id: 'headless-owner-required',
      }),
    ).rejects.toThrow('Session agent is unavailable');
  });

  it('runs a real /set command against the supplied headless Agent owner rather than another ambient runtime', async () => {
    const {
      config: foreign,
      manager: foreignManager,
      settingsService: foreignSettings,
      settingsOwner: foreignOwner,
    } = makeConfig('headless-foreign-agent');
    foreignOwner.writeUserParameter('emojifilter', 'allowed');
    const foreignPreflight = await prepareAgentPreflight(
      { runtimeId: foreign.getSessionId() },
      credentials().authority,
      foreignSettings,
      foreignOwner,
    );

    const builtCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL(
        '../../agents/src/api/__tests__/fixtures/' + 'plain-text.jsonl',
        import.meta.url,
      ),
    );
    const builtCallerDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-caller-')),
    );
    const builtCallerOverrides: Readonly<Partial<AgentConfig>> = {};
    const builtCallerSelection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...builtCallerOverrides,
      workingDir: builtCallerDirectory,
    };
    const builtCallerParameters = {
      ...toConfigParameters(builtCallerSelection),
      ...{},
    };
    builtCallerParameters.interactive = true;

    builtCallerParameters.includeDirectories = [
      ...(builtCallerParameters.includeDirectories ?? []),
      process.cwd(),
    ];
    const builtCallerConfig = new Config(builtCallerParameters);
    const builtCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...{},
    };
    const builtCallerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      builtCallerConfig.getInitialSettings(),
    ))
      builtCallerSettings.set(key, value);
    const builtCallerPolicy = new RuntimePolicyOwner(builtCallerConfig);
    injectConfirmationForcingPolicy(builtCallerPolicy.session.confirmation);
    const builtCallerMcp = await buildTestMcpRuntime(
      builtCallerConfig,
      builtCallerPolicy.session.messageBus,
      builtCallerOverrides,
      undefined,
      builtCallerPolicy,
      undefined,
    );
    const builtCallerRuntimeId = 'caller-' + randomUUID();
    const builtCallerRelease = new AcquisitionRelease();
    const builtCallerSettingsOwner = new SessionSettingsOwner(
      builtCallerSettings,
    );
    builtCallerRelease.acquire('settings', () =>
      builtCallerSettingsOwner.dispose(),
    );
    builtCallerSettingsOwner.initializeProviderSelection(
      builtCallerConfig.getProvider(),
      builtCallerConfig.getModel(),
    );
    builtCallerSettingsOwner.bindTelemetry(builtCallerConfig);
    const builtCallerFiles = new ProviderFileLifecycle({
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
    const builtCallerManager = acquirePreferredProviderManager(
      builtCallerConfig,
      builtCallerSettings,
      builtCallerSettingsOwner,
      builtCallerFiles,
      builtCallerRuntimeId,
      builtCredentials().authority,
      builtCallerRelease,
    );
    const builtCallerTokenizer = configureProviderTokenizer(builtCallerManager);
    const builtCallerContent = createRuntimeContentGeneratorFactory();
    const builtCallerOAuth = acquirePreferredOAuth(
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
    const builtCallerMedia = new SessionMediaOwner(
      builtCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    const builtCallerOwner = await createCapturedSessionOwner(
      builtCallerConfig,
      assembleTaskSchemaPolicy(builtCallerSettings),
      builtCallerManager,
      builtCallerFactories.agentClientFactory,
      builtCallerMedia.store,
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
    const builtCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => builtCallerOwner.dispose(),
        () => builtCallerRelease.close(),
        () => builtCallerMedia.dispose(),
        () => builtCallerMcp.dispose(),
        () => builtCallerConfig.dispose(),
        () => rm(builtCallerDirectory, { recursive: true, force: true }),
      ],
      builtCallerPreviousReplay,
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
      const activation = await executeProviderActivation(
        builtCallerConfig,
        builtCallerSelection.activation ?? {
          provider: builtCallerConfig.getProvider(),
          model: builtCallerConfig.getModel(),
        },
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
      await capturedSessionClient(builtCallerOwner).startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, builtCallerClose);
    }

    const agent = await actualAdoption(
      builtCallerConfig,
      builtCallerSettings,
      { sessionId: builtCallerConfig.getSessionId() },
      builtCallerSettingsOwner,
      builtCallerManager,
      undefined,
      builtCallerPolicy.session.messageBus,
      builtCallerMcp,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      builtCallerPolicy,
    );
    mockGetCommands.mockReturnValue([createAgentSetCommand(agent)]);
    const { adoptFixture: fromConfig } = await import(
      '../../agents/src/api/__tests__/helpers/adoption-fixture.js'
    );
    try {
      await expect(
        runNonInteractive({
          config: builtCallerConfig,
          runtimeSettings: builtCallerSettingsOwner,
          settings: mockSettings,
          agent,
          input: '/set emojifilter error',
          prompt_id: 'headless-owned-set',
        }),
      ).rejects.toThrow(
        'Exiting due to command result that is not supported in non-interactive mode.',
      );
      expect(builtCallerSettingsOwner.readNamedParameter('emojifilter')).toBe(
        'error',
      );
      expect(foreignOwner.readNamedParameter('emojifilter')).toBe('allowed');
      expect(fromConfig as Mock<typeof adoptFixture>).not.toHaveBeenCalled();
    } finally {
      await agent.dispose();
      await builtCallerClose();
      await foreignPreflight.dispose();
      foreignManager.dispose();
      await foreignOwner.dispose();
      await foreign.dispose();
    }
  });

  it('creates and disposes the Agent for a slash command that submits a prompt', async () => {
    const mockCommand = {
      name: 'submits',
      description: 'a command that submits a prompt',
      action: vi.fn().mockResolvedValue({
        type: 'submit_prompt',
        content: [{ text: 'Prompt from command' }],
      }),
    };
    mockGetCommands.mockReturnValue([mockCommand]);
    const { adoptFixture: fromConfig } = await import(
      '../../agents/src/api/__tests__/helpers/adoption-fixture.js'
    );
    const fakeAgent = buildFakeAgent();
    (fromConfig as Mock<typeof adoptFixture>).mockResolvedValue(fakeAgent);
    agentState.events = [
      { type: 'text', text: 'ok' },
      { type: 'done', reason: 'stop' },
    ];

    await runWithMcpBus({
      config: mockConfig,
      settings: mockSettings,
      input: '/submits',
      prompt_id: 'prompt-id-agent-lifecycle',
    });

    expect(fromConfig as Mock<typeof adoptFixture>).toHaveBeenCalledTimes(1);
    const call = (fromConfig as Mock<typeof adoptFixture>).mock.calls[0];
    expect(call[16]?.session.messageBus).toBe(call[6]);
    expect(fakeAgent.dispose).toHaveBeenCalledTimes(1);
  });

  it('passes the resolved config model and merged model params to fromConfig activation when no CLI model override is present', async () => {
    const { adoptFixture: fromConfig } = await import(
      '../../agents/src/api/__tests__/helpers/adoption-fixture.js'
    );
    const configWithParams = mockConfig as ConfigWithActivationParams;
    (
      mockConfig.getProvider as Mock<typeof mockConfig.getProvider>
    ).mockReturnValue('openai');
    (mockConfig.getModel as Mock<typeof mockConfig.getModel>).mockReturnValue(
      'kimi-k2.5',
    );
    configWithParams._profileModelParams = { temperature: 0.4 };
    configWithParams._cliModelParams = { top_p: 0.9 };
    agentState.events = [{ type: 'done', reason: 'stop' }];

    await runWithMcpBus({
      config: mockConfig,
      settings: mockSettings,
      input: 'hello',
      prompt_id: 'prompt-id-activation-model',
    });

    expect(fromConfig as Mock<typeof adoptFixture>).toHaveBeenCalledTimes(1);
    const activation = (fromConfig as Mock<typeof adoptFixture>).mock
      .calls[0][2]?.activation;
    expect(activation).toMatchObject({
      provider: 'openai',
      model: 'kimi-k2.5',
      modelParams: { temperature: 0.4, top_p: 0.9 },
      authMode: 'auto',
    });
  });
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
