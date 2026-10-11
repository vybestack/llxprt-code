import { runHeadlessPolicyFixture } from './__tests__/headless-policy-fixture.js';
import { makeBootstrapProfileArgs } from './test-utils/bootstrap-config.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';

import { automock } from '@vybestack/llxprt-code-test-utils';
import {
  Config,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  OpenAIProvider,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import {} from '@vybestack/llxprt-code-providers/runtime.js';
import { beginCliRuntimeRegistration } from '@vybestack/llxprt-code-providers/runtime/cliForegroundRuntime.js';
import { setCommand } from './ui/commands/setCommand.js';
import { buildCliStyleConfig } from '../../agents/src/api/__tests__/helpers/buildCliStyleConfig.js';
import {
  type Agent,
  type AgentEvent,
  type AgentInput,
  type TurnOptions,
} from '@vybestack/llxprt-code-agents';
import { PLACEHOLDER_MODEL } from '@vybestack/llxprt-code-agents/constants.js';
import { runNonInteractive } from './nonInteractiveCli.js';

import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import type { LoadedSettings } from './config/settings.js';
import type { CommandContext } from './ui/commands/types.js';
import type { BootstrapProfileArgs } from './config/profileBootstrap.js';

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

function makeConfig(sessionId: string): {
  config: Config;
  manager: ProviderManager;
  settingsService: SettingsService;
  settingsOwner: SessionSettingsOwner;
} {
  const settingsService = new SettingsService();
  const config = new Config({
    cwd: process.cwd(),
    targetDir: process.cwd(),
    debugMode: false,
    sessionId,
    model: PLACEHOLDER_MODEL,
    provider: 'openai',
  });
  const settingsOwner = new SessionSettingsOwner(settingsService);
  settingsOwner.bindTelemetry(config);
  settingsOwner.initializeProviderSelection('openai', PLACEHOLDER_MODEL);
  const manager = new ProviderManager({ config, settingsService });
  manager.registerProvider(new OpenAIProvider(undefined));
  manager.setActiveProvider('openai');
  configureProviderRuntimeFactories(config, manager);
  fixtureRoots.push({ config, manager, settingsOwner });
  return { config, manager, settingsOwner, settingsService };
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
): Promise<void> {
  return runHeadlessPolicyFixture(
    params,
    mockRuntimeSettings,
    mockProviderManager,
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

  it('should preprocess @include commands before sending to the model', async () => {
    const { handleAtCommand } = await import(
      './ui/hooks/atCommandProcessor.js'
    );
    const mockHandleAtCommand = handleAtCommand as Mock<typeof handleAtCommand>;

    const rawInput = 'Summarize @file.txt';
    const processedParts = [
      { type: 'text' as const, text: 'Summarize @file.txt' },
      {
        type: 'text' as const,
        text: '\n--- Content from referenced files ---\n',
      },
      { type: 'text' as const, text: 'This is the content of the file.' },
      { type: 'text' as const, text: '\n--- End of content ---\n' },
    ];

    mockHandleAtCommand.mockResolvedValue({
      processedQuery: processedParts,
    });

    agentState.events = [
      { type: 'text', text: 'Summary complete.' },
      { type: 'done', reason: 'stop' },
    ];

    await runWithMcpBus({
      config: mockConfig,
      settings: mockSettings,
      input: rawInput,
      prompt_id: 'prompt-id-7',
    });

    // The PROCESSED parts (not the raw input) must reach the Agent stream.
    expect(agentState.streamInput).toStrictEqual(processedParts);
    // runNonInteractive must forward prompt_id and maxTurns to agent.stream().
    expect(agentState.streamOpts?.promptId).toBe('prompt-id-7');
    expect(agentState.streamOpts?.maxTurns).toBe(
      mockConfig.getMaxSessionTurns(),
    );
    expect(processStdoutSpy).toHaveBeenCalledWith('Summary complete.');
  });

  it('should execute a slash command that returns a prompt', async () => {
    const mockCommand = {
      name: 'testcommand',
      description: 'a test command',
      action: vi.fn().mockResolvedValue({
        type: 'submit_prompt',
        content: [{ text: 'Prompt from command' }],
      }),
    };
    mockGetCommands.mockReturnValue([mockCommand]);

    agentState.events = [
      { type: 'text', text: 'Response from command' },
      { type: 'done', reason: 'stop' },
    ];

    await runWithMcpBus({
      config: mockConfig,
      settings: mockSettings,
      input: '/testcommand',
      prompt_id: 'prompt-id-slash',
    });

    // The prompt sent to the Agent is from the command, not the raw input.
    expect(agentState.streamInput).toStrictEqual([
      // Command content blocks are forwarded as-is without a TextBlock `type`
      // discriminator at runtime.
      { text: 'Prompt from command' },
    ] as unknown as AgentInput);
    expect(processStdoutSpy).toHaveBeenCalledWith('Response from command');
  });

  it('should throw FatalInputError if a command requires confirmation', async () => {
    const mockCommand = {
      name: 'confirm',
      description: 'a command that needs confirmation',
      action: vi.fn().mockResolvedValue({
        type: 'confirm_shell_commands',
        commands: ['rm -rf /'],
      }),
    };
    mockGetCommands.mockReturnValue([mockCommand]);

    await expect(
      runWithMcpBus({
        config: mockConfig,
        settings: mockSettings,
        input: '/confirm',
        prompt_id: 'prompt-id-confirm',
      }),
    ).rejects.toThrow(
      'Exiting due to a confirmation prompt requested by the command.',
    );
  });

  it('resolves slash commands before creating the Agent, so a failing slash-only input never constructs one', async () => {
    const mockCommand = {
      name: 'confirm',
      description: 'a command that needs confirmation',
      action: vi.fn().mockResolvedValue({
        type: 'confirm_shell_commands',
        commands: ['rm -rf /'],
      }),
    };
    mockGetCommands.mockReturnValue([mockCommand]);
    const { fromConfig } = await import('@vybestack/llxprt-code-agents');

    await expect(
      runWithMcpBus({
        config: mockConfig,
        settings: mockSettings,
        input: '/confirm',
        prompt_id: 'prompt-id-no-agent',
      }),
    ).rejects.toThrow(
      'Exiting due to a confirmation prompt requested by the command.',
    );

    expect(fromConfig as Mock<typeof fromConfig>).not.toHaveBeenCalled();
  });

  it('rejects runtime access from a headless command without an Agent owner', async () => {
    mockGetCommands.mockReturnValue([
      {
        name: 'runtime',
        description: 'requires runtime state',
        action: (context: CommandContext) => {
          context.runtimeApi.getActiveModelName();
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
    ).rejects.toThrow('Headless command requires an Agent-owned runtime API.');
  });

  it('runs a real /set command against the supplied headless Agent owner rather than another ambient runtime', async () => {
    const {
      config: foreign,
      manager: foreignManager,
      settingsService: foreignSettings,
      settingsOwner: foreignOwner,
    } = makeConfig('headless-foreign-agent');
    foreignOwner.writeUserParameter('emojifilter', 'allowed');
    const foreignRegistration = beginCliRuntimeRegistration(
      foreignSettings,
      foreign,
      { runtimeId: 'headless-foreign-agent' },
    );
    foreignRegistration.expectManager(foreignManager);
    mockGetCommands.mockReturnValue([setCommand]);
    const built = await buildCliStyleConfig('plain-text.jsonl');
    const agent = await original.fromConfig({
      settingsService: built.settingsService,
      settingsOwner: built.settingsOwner,
      providerManager: built.providerManager,
      config: built.config,
      mcpRuntime: built.mcpRuntime,
      messageBus: built.messageBus,
      policyOwner: built.policyOwner,
      sessionId: built.config.getSessionId(),
    });
    const { fromConfig } = await import('@vybestack/llxprt-code-agents');
    try {
      await expect(
        runNonInteractive({
          config: built.config,
          runtimeSettings: {
            owner: built.settingsOwner,
            store: built.settingsService,
          },
          settings: mockSettings,
          agent,
          runtimeMessageBus: built.messageBus,
          input: '/set emojifilter error',
          prompt_id: 'headless-owned-set',
        }),
      ).rejects.toThrow(
        'Exiting due to command result that is not supported in non-interactive mode.',
      );
      expect(built.settingsOwner.readNamedParameter('emojifilter')).toBe(
        'error',
      );
      expect(foreignOwner.readNamedParameter('emojifilter')).toBe('allowed');
      expect(fromConfig as Mock<typeof fromConfig>).not.toHaveBeenCalled();
    } finally {
      await agent.dispose();
      await built.cleanup();
      foreignRegistration.dispose();
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
    const { fromConfig } = await import('@vybestack/llxprt-code-agents');
    const fakeAgent = buildFakeAgent();
    (fromConfig as Mock<typeof fromConfig>).mockResolvedValue(fakeAgent);
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

    expect(fromConfig as Mock<typeof fromConfig>).toHaveBeenCalledTimes(1);
    const options = (fromConfig as Mock<typeof fromConfig>).mock.calls[0][0];
    expect(options.mcpRuntime?.messageBus).toBe(options.messageBus);
    expect(fakeAgent.dispose).toHaveBeenCalledTimes(1);
  });

  it('passes the resolved config model and merged model params to fromConfig activation when no CLI model override is present', async () => {
    const { fromConfig } = await import('@vybestack/llxprt-code-agents');
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

    expect(fromConfig as Mock<typeof fromConfig>).toHaveBeenCalledTimes(1);
    const activation = (fromConfig as Mock<typeof fromConfig>).mock.calls[0][0]
      .activation;
    expect(activation).toMatchObject({
      provider: 'openai',
      model: 'kimi-k2.5',
      modelParams: { temperature: 0.4, top_p: 0.9 },
      authMode: 'auto',
    });
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
    const activation = (fromConfig as Mock<typeof fromConfig>).mock.calls[0][0]
      .activation;
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
    const activation = (fromConfig as Mock<typeof fromConfig>).mock.calls[0][0]
      .activation;
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

  function thinkingTextFromDefinedOutput(
    thinkOutput: [string, ...unknown[]] | undefined,
  ): string {
    if (thinkOutput === undefined) {
      throw new Error('Expected a thinking output');
    }
    return thinkOutput[0];
  }

  function analyzingThoughtCount(thinkingText: string): number {
    return (thinkingText.match(/Analyzing/g) ?? []).length;
  }

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

  async function verifyShouldFilterEmojisFromThinkingBlocksInAutoMode() {
    mockRuntimeSettings.owner.writeUserParameter('emojifilter', 'auto');
    mockRuntimeSettings.owner.writeUserParameter(
      'reasoning.includeInResponse',
      true,
    );

    agentState.events = [
      {
        type: 'thinking',
        thought: {
          subject: 'Planning \u{1F914} the approach',
          description: 'Let me think \u{1F4AD} carefully',
        },
      },
      { type: 'text', text: 'Here is my answer' },
      { type: 'done', reason: 'stop' },
    ];

    await runWithMcpBus({
      config: mockConfig,
      settings: mockSettings,
      input: 'Test input',
      prompt_id: 'prompt-id-emoji-think',
    });

    const stdoutCalls: unknown[][] = processStdoutSpy.mock.calls;
    const thinkOutput = stdoutCalls.find(
      (value): value is [string, ...unknown[]] =>
        typeof value[0] === 'string' && value[0].includes('<think>'),
    );

    return thinkOutput;
  }

  it('should filter emojis from thinking blocks in auto mode', async () => {
    const thinkOutput =
      await verifyShouldFilterEmojisFromThinkingBlocksInAutoMode();

    expect(thinkOutput).toBeDefined();
    const thinkText = thinkingTextFromDefinedOutput(thinkOutput);
    expect(thinkText).not.toContain('\u{1F914}');
    expect(thinkText).not.toContain('\u{1F4AD}');
    expect(thinkText).toContain('Planning');
    expect(thinkText).toContain('the approach');
    expect(thinkText).toContain('Let me think');
    expect(thinkText).toContain('carefully');
  });

  async function verifyShouldSuppressThinkingBlocksWithEmojisInErrorMode() {
    mockRuntimeSettings.owner.writeUserParameter('emojifilter', 'error');
    mockRuntimeSettings.owner.writeUserParameter(
      'reasoning.includeInResponse',
      true,
    );
    agentState.events = [
      {
        type: 'thinking',
        thought: {
          subject: 'Planning \u{1F914}',
          description: 'Think carefully \u{1F4AD}',
        },
      },
      { type: 'text', text: 'Here is my answer' },
      { type: 'done', reason: 'stop' },
    ];
    await runWithMcpBus({
      config: mockConfig,
      settings: mockSettings,
      input: 'Test input',
      prompt_id: 'prompt-id-emoji-error',
    });
    const stdoutCalls: unknown[][] = processStdoutSpy.mock.calls;
    const thinkOutput = stdoutCalls.find(
      (value): value is [string, ...unknown[]] =>
        typeof value[0] === 'string' && value[0].includes('<think>'),
    );

    return thinkOutput;
  }

  it('should suppress thinking blocks with emojis in error mode', async () => {
    const thinkOutput =
      await verifyShouldSuppressThinkingBlocksWithEmojisInErrorMode();
    expect(thinkOutput).toBeUndefined();
  });

  async function verifyShouldPassThroughThinkingBlocksWhenEmojifilterIsAllowed() {
    mockRuntimeSettings.owner.writeUserParameter('emojifilter', 'allowed');
    mockRuntimeSettings.owner.writeUserParameter(
      'reasoning.includeInResponse',
      true,
    );

    agentState.events = [
      {
        type: 'thinking',
        thought: {
          subject: 'Planning \u{1F914}',
          description: 'Think carefully \u{1F4AD}',
        },
      },
      { type: 'text', text: 'Here is my answer' },
      { type: 'done', reason: 'stop' },
    ];

    await runWithMcpBus({
      config: mockConfig,
      settings: mockSettings,
      input: 'Test input',
      prompt_id: 'prompt-id-emoji-allowed',
    });

    const stdoutCalls: unknown[][] = processStdoutSpy.mock.calls;
    const thinkOutput = stdoutCalls.find(
      (value): value is [string, ...unknown[]] =>
        typeof value[0] === 'string' && value[0].includes('<think>'),
    );

    return thinkOutput;
  }

  it('should pass through thinking blocks when emojifilter is allowed', async () => {
    const thinkOutput =
      await verifyShouldPassThroughThinkingBlocksWhenEmojifilterIsAllowed();

    expect(thinkOutput).toBeDefined();
    const thinkText = thinkingTextFromDefinedOutput(thinkOutput);
    expect(thinkText).toContain('\u{1F914}');
    expect(thinkText).toContain('\u{1F4AD}');
  });
});
