import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { useOwnedCredentials } from '../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
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
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { UiTelemetryService } from '@vybestack/llxprt-code-telemetry';
import {
  makeHeadlessConfig,
  runHeadlessPolicyFixture,
} from './__tests__/headless-policy-fixture.js';
import { makeBootstrapProfileArgs } from './test-utils/bootstrap-config.js';
import { automock } from '@vybestack/llxprt-code-test-utils';
import {
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import {
  type Agent,
  type AgentEvent,
  type AgentInput,
  type TurnOptions,
} from '@vybestack/llxprt-code-agents';
import { PLACEHOLDER_MODEL } from '@vybestack/llxprt-code-agents/constants.js';
import { runNonInteractive } from './nonInteractiveCli.js';
import { LoadedSettings } from './config/settings.js';
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

const original = { ...(await import('@vybestack/llxprt-code-agents')) };

void vi.mock('@vybestack/llxprt-code-agents', () => ({
  ...original,
  fromConfig: vi.fn(),
}));

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
  useOwnedCredentials();
  useOwnedCredentials();

  let mockConfig: Config;

  let mockSettings: LoadedSettings;

  let mockShutdownTelemetry: Mock<(...args: never[]) => Promise<void>>;

  let mockIsTelemetrySdkInitialized: Mock<(...args: never[]) => boolean>;

  let processStdoutSpy: Mock<(...args: never[]) => boolean>;

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
    processStdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true) as unknown as Mock<
      (...args: never[]) => boolean
    >;
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const { fromConfig } = await import('@vybestack/llxprt-code-agents');
    (fromConfig as Mock<typeof fromConfig>).mockResolvedValue(buildFakeAgent());

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

  it('preserves profile model params when the CLI provider override supplies the activation provider', async () => {
    const { fromConfig } = await import('@vybestack/llxprt-code-agents');
    const configWithParams = mockConfig as ConfigWithActivationParams;
    (
      mockConfig.getProvider as Mock<typeof mockConfig.getProvider>
    ).mockReturnValue(undefined);
    (mockConfig.getModel as Mock<typeof mockConfig.getModel>).mockReturnValue(
      'kimi-k2.5',
    );
    configWithParams._profileModelParams = { temperature: 0.4 };
    configWithParams._cliModelParams = { top_p: 0.9 };
    configWithParams._bootstrapArgs = makeBootstrapProfileArgs({
      providerOverride: 'anthropic',
    });
    agentState.events = [{ type: 'done', reason: 'stop' }];

    await runWithMcpBus({
      config: mockConfig,
      settings: mockSettings,
      input: 'hello',
      prompt_id: 'prompt-id-provider-override',
    });

    expect(fromConfig as Mock<typeof fromConfig>).toHaveBeenCalledTimes(1);
    const activation = (fromConfig as Mock<typeof fromConfig>).mock.calls[0][2]
      ?.activation;
    expect(activation).toBeDefined();
    expect(activation).toMatchObject({
      provider: 'anthropic',
      model: 'kimi-k2.5',
      modelParams: { temperature: 0.4, top_p: 0.9 },
      authMode: 'auto',
    });
  });

  it('omits the activation model when the resolved config model is the placeholder sentinel', async () => {
    const { fromConfig } = await import('@vybestack/llxprt-code-agents');
    (
      mockConfig.getProvider as Mock<typeof mockConfig.getProvider>
    ).mockReturnValue('openai');
    (mockConfig.getModel as Mock<typeof mockConfig.getModel>).mockReturnValue(
      PLACEHOLDER_MODEL,
    );
    agentState.events = [{ type: 'done', reason: 'stop' }];

    await runWithMcpBus({
      config: mockConfig,
      settings: mockSettings,
      input: 'hello',
      prompt_id: 'prompt-id-placeholder-model',
    });

    expect(fromConfig as Mock<typeof fromConfig>).toHaveBeenCalledTimes(1);
    const activation = (fromConfig as Mock<typeof fromConfig>).mock.calls[0][2]
      ?.activation;
    expect(activation).toBeDefined();
    expect(activation?.provider).toBe('openai');
    expect(activation?.model).toBeUndefined();
  });

  it('should treat an unknown slash command as a regular prompt', async () => {
    // No commands are mocked, so any slash command is "unknown"
    mockGetCommands.mockReturnValue([]);

    agentState.events = [
      { type: 'text', text: 'Response to unknown' },
      { type: 'done', reason: 'stop' },
    ];

    await runWithMcpBus({
      config: mockConfig,
      settings: mockSettings,
      input: '/unknowncommand',
      prompt_id: 'prompt-id-unknown',
    });

    // The unknown slash command falls through to resolveAtQuery which wraps
    // it as a ContentBlock[].
    expect(agentState.streamInput).toStrictEqual([
      { type: 'text', text: '/unknowncommand' },
    ]);
    expect(processStdoutSpy).toHaveBeenCalledWith('Response to unknown');
  });

  it('should throw for unhandled command result types', async () => {
    const mockCommand = {
      name: 'noaction',
      description: 'unhandled type',
      action: vi.fn().mockResolvedValue({
        type: 'unhandled',
      }),
    };
    mockGetCommands.mockReturnValue([mockCommand]);

    await expect(
      runWithMcpBus({
        config: mockConfig,
        settings: mockSettings,
        input: '/noaction',
        prompt_id: 'prompt-id-unhandled',
      }),
    ).rejects.toThrow(
      'Exiting due to command result that is not supported in non-interactive mode.',
    );
  });
});
