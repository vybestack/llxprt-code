import { adoptScriptedHeadlessOwner } from './__tests__/scripted-headless-owner.js';
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
import {
  type AgentEvent,
  type AgentInput,
  type TurnOptions,
} from '@vybestack/llxprt-code-agents';
import { PLACEHOLDER_MODEL } from '@vybestack/llxprt-code-agents/constants.js';
import {
  runNonInteractive,
  buildNonInteractiveActivationIntent,
} from './__tests__/noninteractive-run-fixture.js';
import { LoadedSettings } from './config/settings.js';

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
    async (policy) => {
      const { fromConfig } = await import('@vybestack/llxprt-code-agents');
      const acquire = fromConfigSentinel;
      acquire.mockImplementation((config, settings, intent, authority) =>
        adoptScriptedHeadlessOwner(
          [
            config,
            settings,
            intent,
            mockRuntimeSettings.owner,
            mockProviderManager,
            undefined,
            policy.session.messageBus,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            authority,
            policy,
          ],
          policy,
          agentState.events,
          (input, options) => {
            agentState.streamInput = input;
            agentState.streamOpts = options ?? null;
          },
        ),
      );
      return fromConfig(
        params.config,
        mockRuntimeSettings.store,
        {
          sessionId: params.config.getSessionId(),
          sessionIdentityOwnership: 'config',
          activation: buildNonInteractiveActivationIntent(
            params.config,
            params.settings,
          ),
          mcpOwnership: 'agent',
        },
        mockCredentialAuthority,
      );
    },
  );
}

const original = { ...(await import('@vybestack/llxprt-code-agents')) };
const fromConfigSentinel = vi.fn<typeof original.fromConfig>();

void vi.mock('@vybestack/llxprt-code-agents', () => ({
  ...original,
  fromConfig: fromConfigSentinel,
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
    (fromConfig as Mock<typeof fromConfig>).mockReset();

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

  async function verifyShouldNOTEmitPyramidStyleRepeatedPrefixesInNonInteractiveCLI() {
    agentState.events = [
      {
        type: 'thinking',
        thought: { subject: 'Analyzing', description: '' },
      },
      { type: 'thinking', thought: { subject: 'request', description: '' } },
      { type: 'text', text: 'Response' },
      { type: 'done', reason: 'stop' },
    ];

    await runWithMcpBus({
      config: mockConfig,
      settings: mockSettings,
      input: 'test query',
      prompt_id: 'test-prompt-id',
    });

    return bufferedThinkingOutputs(processStdoutSpy.mock.calls);
  }

  function bufferedThinkingOutputs(
    stdoutCalls: readonly unknown[][],
  ): Array<[string, ...unknown[]]> {
    return stdoutCalls.filter(
      (output): output is [string, ...unknown[]] =>
        typeof output[0] === 'string' && output[0].includes('<think>'),
    );
  }

  function thinkingTextFromSingleOutput(
    thinkingOutputs: Array<[string, ...unknown[]]>,
  ): string {
    const thinkingOutput = thinkingOutputs.at(0);
    if (thinkingOutput === undefined) {
      throw new Error('Expected one buffered thinking output');
    }
    return thinkingOutput[0];
  }

  function analyzingThoughtCount(thinkingText: string): number {
    return (thinkingText.match(/Analyzing/g) ?? []).length;
  }

  it('should pass arguments to the slash command action', async () => {
    const mockAction = vi.fn().mockResolvedValue({
      type: 'submit_prompt',
      content: [{ text: 'Prompt from command' }],
    });
    const mockCommand = {
      name: 'testargs',
      description: 'a test command',
      action: mockAction,
    };
    mockGetCommands.mockReturnValue([mockCommand]);

    agentState.events = [
      { type: 'text', text: 'Acknowledged' },
      { type: 'done', reason: 'stop' },
    ];

    await runWithMcpBus({
      config: mockConfig,
      settings: mockSettings,
      input: '/testargs arg1 arg2',
      prompt_id: 'prompt-id-args',
    });

    expect(mockAction).toHaveBeenCalledWith(expect.any(Object), 'arg1 arg2');
    expect(processStdoutSpy).toHaveBeenCalledWith('Acknowledged');
  });

  it('should render tool-result display output through the Agent stream', async () => {
    // After migration, tool execution is owned by the Agent. This verifies the
    // tool-result AgentEvent renders its display end-to-end through
    // runNonInteractive. (The tool-call event only writes to the stream-json
    // formatter, which is null here; its rendering is covered by the
    // stream-json unit tests in nonInteractiveCli.test.ts.)
    // Allowlist governance (--allowed-tools overriding ShellTool/EditTool/
    // WriteFile exclusion) is config-level and covered by the fast unit suite
    // config/__tests__/toolGovernanceParity.test.ts (getExcludeTools parity) and
    // the integration-tests/run_shell_command.test.ts scenarios.
    agentState.events = [
      {
        type: 'tool-call',
        call: {
          id: 'tool-shell-1',
          name: 'ShellTool',
          args: { command: 'ls' },
        },
      },
      {
        type: 'tool-result',
        result: {
          id: 'tool-shell-1',
          name: 'ShellTool',
          display: 'file.txt',
          output: 'file.txt',
        },
      },
      { type: 'text', text: 'file.txt' },
      { type: 'done', reason: 'stop' },
    ];

    await runWithMcpBus({
      config: mockConfig,
      settings: mockSettings,
      input: 'List the files',
      prompt_id: 'prompt-id-allowed',
    });

    expect(processStdoutSpy).toHaveBeenCalledWith('file.txt\n');
  });

  it('should accumulate multiple Thought events and flush once on content boundary', async () => {
    agentState.events = [
      {
        type: 'thinking',
        thought: { subject: 'First', description: 'thought' },
      },
      {
        type: 'thinking',
        thought: { subject: 'Second', description: 'thought' },
      },
      { type: 'text', text: 'Response text' },
      { type: 'done', reason: 'stop' },
    ];

    await runWithMcpBus({
      config: mockConfig,
      settings: mockSettings,
      input: 'test query',
      prompt_id: 'test-prompt-id',
    });

    const thinkingOutputs = bufferedThinkingOutputs(
      processStdoutSpy.mock.calls,
    );

    // Both thought events should be buffered and flushed as a single <think> block
    expect(thinkingOutputs).toHaveLength(1);
    const thinkingText = thinkingTextFromSingleOutput(thinkingOutputs);
    // Code formats thoughts as "subject: description" when both present
    expect(thinkingText).toContain('First: thought');
    expect(thinkingText).toContain('Second: thought');
  });

  it('should NOT emit pyramid-style repeated prefixes in non-interactive CLI', async () => {
    const thinkingOutputs =
      await verifyShouldNOTEmitPyramidStyleRepeatedPrefixesInNonInteractiveCLI();

    // All thoughts should be buffered into one <think> block (no pyramid repetition)
    expect(thinkingOutputs).toHaveLength(1);
    const thinkingText = thinkingTextFromSingleOutput(thinkingOutputs);
    // "Analyzing" should appear exactly once — not repeated for each subsequent thought
    const thoughtCount = analyzingThoughtCount(thinkingText);
    expect(thoughtCount).toBe(1);
  });
});
