import { createScriptedHeadlessMcpOwner } from './__tests__/scripted-headless-mcp-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { useOwnedCredentials } from '../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { useFakeResponsesReplay } from '../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
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
  fromConfig,
  type Agent,
  type AgentEvent,
  type AgentInput,
} from '@vybestack/llxprt-code-agents';
import { PLACEHOLDER_MODEL } from '@vybestack/llxprt-code-agents/constants.js';
import {
  runNonInteractive,
  buildNonInteractiveActivationIntent,
} from './__tests__/noninteractive-run-fixture.js';
import { LoadedSettings } from './config/settings.js';
import { BootstrapProfileArgs } from './config/profileBootstrap.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Captures the resolved query handed to the Agent's stream(), and the
// AgentEvents the scripted provider replays. Reset per-test in beforeEach.
const realAtCommandProcessorModule = {
  ...(await import('./ui/hooks/atCommandProcessor.js')),
};

const agentState = {
  // runNonInteractive passes the resolved query to agent.stream(); typed as
  // AgentInput | null (matching the stream() parameter type) so assertions get
  // compile-time checking instead of the looser `unknown`.
  streamInput: null as AgentInput | null,
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

// What the activation left on the Agent right after fromConfig returned it,
// read through the public Agent API (the run disposes the Agent afterwards).
interface ActivatedAgentState {
  provider: string;
  model: string;
}

let activated: ActivatedAgentState | undefined;

// Observes the query the run hands to the Agent on the instance, the public
// seam the headless run streams through.
function observeStreamInput(agent: Agent): Agent {
  const stream = agent.stream.bind(agent);
  agent.stream = (input, options) => {
    agentState.streamInput = input;
    return stream(input, options);
  };
  return agent;
}

// The activation cases read the activated Agent and have no provider to answer
// a request, so their stream ends without one.
function endStreamImmediately(agent: Agent): Agent {
  agent.stream = () =>
    (async function* noEvents(): AsyncIterable<AgentEvent> {})();
  return agent;
}

function runWithMcpBus(
  params: Parameters<typeof runNonInteractive>[0],
  activation: ReturnType<typeof buildNonInteractiveActivationIntent>,
  decorate: (agent: Agent) => Agent,
): Promise<void> {
  return runHeadlessPolicyFixture(
    params,
    mockRuntimeSettings.owner,
    mockProviderManager,
    async () => {
      const agent = await fromConfig(
        params.config,
        mockRuntimeSettings.store,
        { sessionId: params.config.getSessionId(), activation },
        mockCredentialAuthority,
      );
      activated = {
        provider: agent.getProvider(),
        model: agent.getModel(),
      };
      return decorate(agent);
    },
  );
}

// Runs the scripted events through the fake provider's replay seam and the
// production fromConfig route.
async function runScripted(
  params: Parameters<typeof runNonInteractive>[0],
): Promise<void> {
  const scripted = await createScriptedHeadlessMcpOwner(agentState.events);
  scriptedOwners.push(scripted);
  process.env.LLXPRT_FAKE_RESPONSES = scripted.responsesFile;
  return runWithMcpBus(
    params,
    { provider: 'fake', model: 'fake-model', authMode: 'auto' },
    observeStreamInput,
  );
}

const scriptedOwners: Array<{ close: () => Promise<void> }> = [];

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

// Every case runs a real Agent built through fromConfig.
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
  useFakeResponsesReplay('plain-text.jsonl');

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

    // Default: the Agent emits a clean stop completion. Individual tests
    // override agentState.events to stage thinking/tool/text sequences.
    agentState.streamInput = null;
    activated = undefined;
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
    for (const scripted of scriptedOwners.splice(0)) await scripted.close();
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
    const configWithParams = mockConfig as ConfigWithActivationParams;
    (
      mockConfig.getProvider as Mock<typeof mockConfig.getProvider>
    ).mockReturnValue(undefined);
    (mockConfig.getModel as Mock<typeof mockConfig.getModel>).mockReturnValue(
      'kimi-k2.5',
    );
    delete process.env.LLXPRT_FAKE_RESPONSES;
    configWithParams._profileModelParams = { temperature: 0.4 };
    configWithParams._cliModelParams = { top_p: 0.9 };
    configWithParams._bootstrapArgs = makeBootstrapProfileArgs({
      providerOverride: 'anthropic',
    });
    agentState.events = [{ type: 'done', reason: 'stop' }];

    const params = {
      config: mockConfig,
      settings: mockSettings,
      input: 'hello',
      prompt_id: 'prompt-id-provider-override',
    };
    await runWithMcpBus(
      params,
      buildNonInteractiveActivationIntent(mockConfig, mockSettings),
      endStreamImmediately,
    );

    expect(activated).toStrictEqual({
      provider: 'anthropic',
      model: 'kimi-k2.5',
    });
    // The model params land in the provider settings of the SettingsService
    // the host handed to fromConfig.
    expect(
      mockRuntimeSettings.store.getProviderSettings('anthropic'),
    ).toMatchObject({ temperature: 0.4, top_p: 0.9 });
  });

  it('should treat an unknown slash command as a regular prompt', async () => {
    // No commands are mocked, so any slash command is "unknown"
    mockGetCommands.mockReturnValue([]);

    agentState.events = [
      { type: 'text', text: 'Response to unknown' },
      { type: 'done', reason: 'stop' },
    ];

    await runScripted({
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
      runScripted({
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
