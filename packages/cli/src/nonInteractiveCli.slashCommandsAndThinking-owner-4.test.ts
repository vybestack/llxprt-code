import {
  createScriptedHeadlessMcpOwner,
  type ScriptedHeadlessMcpOwner,
} from './__tests__/scripted-headless-mcp-owner.js';
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
import { automock } from '@vybestack/llxprt-code-test-utils';
import {
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import {
  fromConfig,
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

async function runWithMcpBus(
  params: Parameters<typeof runNonInteractive>[0],
  acquisitions: { count: number } = { count: 0 },
): Promise<void> {
  let scripted: ScriptedHeadlessMcpOwner | undefined;
  try {
    await runHeadlessPolicyFixture(
      params,
      mockRuntimeSettings.owner,
      mockProviderManager,
      async () => {
        acquisitions.count += 1;
        scripted = await createScriptedHeadlessMcpOwner(agentState.events);
        process.env.LLXPRT_FAKE_RESPONSES = scripted.responsesFile;
        params.config.setMcpServers(scripted.mcpServers);
        const agent = await fromConfig(
          params.config,
          mockRuntimeSettings.store,
          {
            sessionId: params.config.getSessionId(),
            activation: buildNonInteractiveActivationIntent(
              params.config,
              params.settings,
            ),
          },
          mockCredentialAuthority,
        );
        const stream = agent.stream.bind(agent);
        agent.stream = (input, options) => {
          agentState.streamInput = input;
          agentState.streamOpts = options ?? null;
          return stream(input, options);
        };
        return agent;
      },
    );
  } finally {
    await scripted?.close();
  }
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

// Every case runs a real Agent over a scripted provider replay.
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

  function thinkingTextFromDefinedOutput(
    thinkOutput: [string, ...unknown[]] | undefined,
  ): string {
    if (thinkOutput === undefined) {
      throw new Error('Expected a thinking output');
    }
    return thinkOutput[0];
  }

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

  it('should suppress thinking blocks with emojis in error mode', async () => {
    const thinkOutput =
      await verifyShouldSuppressThinkingBlocksWithEmojisInErrorMode();
    expect(thinkOutput).toBeUndefined();
  });

  it('should pass through thinking blocks when emojifilter is allowed', async () => {
    const thinkOutput =
      await verifyShouldPassThroughThinkingBlocksWhenEmojifilterIsAllowed();

    expect(thinkOutput).toBeDefined();
    const thinkText = thinkingTextFromDefinedOutput(thinkOutput);
    expect(thinkText).toContain('\u{1F914}');
    expect(thinkText).toContain('\u{1F4AD}');
  });
});
