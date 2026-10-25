import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { useOwnedCredentials } from '../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { openRouteAAgent } from '../../agents/src/api/__tests__/helpers/route-a-agent.js';
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

function makeConfig(sessionId: string): ReturnType<typeof makeHeadlessConfig> {
  const root = makeHeadlessConfig(sessionId);
  fixtureRoots.push(root);
  return root;
}

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
  agent: Agent,
  acquisitions: { count: number },
): Promise<void> {
  return runHeadlessPolicyFixture(
    params,
    mockRuntimeSettings.owner,
    mockProviderManager,
    async () => {
      acquisitions.count += 1;
      return agent;
    },
  );
}

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

  useFakeResponsesReplay('plain-text.jsonl');

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

    // Default: the Agent emits a clean stop completion. Individual tests
    // override agentState.events to stage thinking/tool/text sequences.
    agentState.streamInput = null;
    agentState.streamOpts = null;
    agentState.events = [{ type: 'done', reason: 'stop' }];

    const builtOwner = makeConfig('test-session');
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
      runWithMcpBus(
        {
          config: mockConfig,
          settings: mockSettings,
          input: '/runtime',
          prompt_id: 'headless-owner-required',
        },
        buildFakeAgent(),
        { count: 0 },
      ),
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

    const caller = await openRouteAAgent();
    const { agent, settings: callerSettings } = caller;
    const callerSettingsOwner = new SessionSettingsOwner(callerSettings);
    callerSettingsOwner.bindTelemetry(caller.config);
    mockGetCommands.mockReturnValue([createAgentSetCommand(agent)]);
    const unexpectedAcquisitions = { count: 0 };
    try {
      await expect(
        runNonInteractive({
          config: caller.config,
          runtimeSettings: callerSettingsOwner,
          settings: mockSettings,
          agent,
          acquireAgent: async () => {
            unexpectedAcquisitions.count += 1;
            throw new Error('Unexpected agent acquisition');
          },
          input: '/set emojifilter error',
          prompt_id: 'headless-owned-set',
        }),
      ).rejects.toThrow(
        'Exiting due to command result that is not supported in non-interactive mode.',
      );
      expect(callerSettingsOwner.readNamedParameter('emojifilter')).toBe(
        'error',
      );
      expect(foreignOwner.readNamedParameter('emojifilter')).toBe('allowed');
      expect(unexpectedAcquisitions.count).toBe(0);
    } finally {
      await caller.close();
      await callerSettingsOwner.dispose();
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
    const fakeAgent = buildFakeAgent();
    const acquisitions = { count: 0 };
    agentState.events = [
      { type: 'text', text: 'ok' },
      { type: 'done', reason: 'stop' },
    ];

    await runWithMcpBus(
      {
        config: mockConfig,
        settings: mockSettings,
        input: '/submits',
        prompt_id: 'prompt-id-agent-lifecycle',
      },
      fakeAgent,
      acquisitions,
    );

    expect(acquisitions.count).toBe(1);
    expect(fakeAgent.dispose).toHaveBeenCalledTimes(1);
  });
});
