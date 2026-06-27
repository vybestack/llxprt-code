/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core';
import {
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import type { Part } from '@google/genai';
import type {
  Agent,
  AgentEvent,
  AgentInput,
} from '@vybestack/llxprt-code-agents';
import { runNonInteractive } from './nonInteractiveCli.js';

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Mock, MockInstance } from 'vitest';
import type { LoadedSettings } from './config/settings.js';

// Captures the resolved query handed to the fake Agent's stream(), and the
// AgentEvents it should emit. Reset per-test in beforeEach.
const agentState = vi.hoisted(() => ({
  // runNonInteractive passes the resolved query to agent.stream(); typed as
  // AgentInput | null (matching the stream() parameter type) so assertions get
  // compile-time checking instead of the looser `unknown`.
  streamInput: null as AgentInput | null,
  events: [] as AgentEvent[],
}));

vi.mock('@vybestack/llxprt-code-agents', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@vybestack/llxprt-code-agents')>();
  return {
    ...original,
    fromConfig: vi.fn(),
  };
});

// Mock core modules
vi.mock('./ui/hooks/atCommandProcessor.js');
vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...original,
    shutdownTelemetry: vi.fn(),
    isTelemetrySdkInitialized: vi.fn().mockReturnValue(true),
  };
});

const mockGetCommands = vi.hoisted(() => vi.fn());
const mockCommandServiceCreate = vi.hoisted(() => vi.fn());
vi.mock('./services/CommandService.js', () => ({
  CommandService: {
    create: mockCommandServiceCreate,
  },
}));

/**
 * Builds a fake Agent whose stream() records its input and yields the events
 * currently staged in agentState.events. Drives runNonInteractive end-to-end
 * without a real Agent/Config round-trip.
 */
// Only `stream` and `dispose` are exercised by runNonInteractive; the cast
// back to the full Agent interface is needed because fromConfig() is typed to
// return a complete Agent. If production code calls a new Agent method, extend
// this fake accordingly.
function buildFakeAgent(): Agent {
  return {
    stream: (input: AgentInput) => {
      agentState.streamInput = input;
      return (async function* generateFakeStream(): AsyncIterable<AgentEvent> {
        for (const event of agentState.events) {
          yield event;
        }
      })();
    },
    dispose: vi.fn().mockResolvedValue(undefined),
  } as unknown as Agent;
}

describe('runNonInteractive - slash commands and thinking output', () => {
  let mockConfig: Config;
  let mockSettings: LoadedSettings;
  let mockShutdownTelemetry: Mock;
  let mockIsTelemetrySdkInitialized: Mock;
  let processStdoutSpy: MockInstance;

  beforeEach(async () => {
    mockShutdownTelemetry = vi.mocked(shutdownTelemetry);
    mockShutdownTelemetry.mockResolvedValue(undefined);
    mockIsTelemetrySdkInitialized = vi.mocked(isTelemetrySdkInitialized);
    mockIsTelemetrySdkInitialized.mockReturnValue(true);

    mockCommandServiceCreate.mockResolvedValue({
      getCommands: mockGetCommands,
    });
    mockGetCommands.mockReturnValue([]);

    vi.spyOn(DebugLogger.prototype, 'error').mockImplementation(() => {});
    processStdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const { fromConfig } = await import('@vybestack/llxprt-code-agents');
    vi.mocked(fromConfig).mockResolvedValue(buildFakeAgent());

    // Default: the Agent emits a clean stop completion. Individual tests
    // override agentState.events to stage thinking/tool/text sequences.
    agentState.streamInput = null;
    agentState.events = [{ type: 'done', reason: 'stop' }];

    mockConfig = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getMaxSessionTurns: vi.fn().mockReturnValue(10),
      getIdeMode: vi.fn().mockReturnValue(false),
      getContentGeneratorConfig: vi.fn().mockReturnValue({}),
      getDebugMode: vi.fn().mockReturnValue(false),
      getProviderManager: vi.fn().mockReturnValue(undefined),
      getOutputFormat: vi.fn().mockReturnValue('text'),
      getFolderTrust: vi.fn().mockReturnValue(false),
      isTrustedFolder: vi.fn().mockReturnValue(false),
      getProjectRoot: vi.fn().mockReturnValue('/tmp/test-project'),
      getSessionId: vi.fn().mockReturnValue('test-session'),
      getEphemeralSetting: vi.fn().mockReturnValue(undefined),
      getSettingsService: vi
        .fn()
        .mockReturnValue({ get: vi.fn(), set: vi.fn() }),
      storage: {
        getDir: vi.fn().mockReturnValue('/tmp/.llxprt'),
      },
    } as unknown as Config;

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
      },
      isTrusted: true,
      migratedInMemorScopes: new Set(),
      forScope: vi.fn(),
      computeMergedSettings: vi.fn(),
    } as unknown as LoadedSettings;

    const { handleAtCommand } = await import(
      './ui/hooks/atCommandProcessor.js'
    );
    vi.mocked(handleAtCommand).mockImplementation(async ({ query }) => ({
      processedQuery: [{ text: query }],
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should preprocess @include commands before sending to the model', async () => {
    const { handleAtCommand } = await import(
      './ui/hooks/atCommandProcessor.js'
    );
    const mockHandleAtCommand = vi.mocked(handleAtCommand);

    const rawInput = 'Summarize @file.txt';
    const processedParts: Part[] = [
      { text: 'Summarize @file.txt' },
      { text: '\n--- Content from referenced files ---\n' },
      { text: 'This is the content of the file.' },
      { text: '\n--- End of content ---\n' },
    ];

    mockHandleAtCommand.mockResolvedValue({
      processedQuery: processedParts,
    });

    agentState.events = [
      { type: 'text', text: 'Summary complete.' },
      { type: 'done', reason: 'stop' },
    ];

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: rawInput,
      prompt_id: 'prompt-id-7',
    });

    // The PROCESSED parts (not the raw input) must reach the Agent stream.
    expect(agentState.streamInput).toBe(processedParts);
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

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: '/testcommand',
      prompt_id: 'prompt-id-slash',
    });

    // The prompt sent to the Agent is from the command, not the raw input.
    expect(agentState.streamInput).toStrictEqual([
      { text: 'Prompt from command' },
    ]);
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
      runNonInteractive({
        config: mockConfig,
        settings: mockSettings,
        input: '/confirm',
        prompt_id: 'prompt-id-confirm',
      }),
    ).rejects.toThrow(
      'Exiting due to a confirmation prompt requested by the command.',
    );
  });

  it('should treat an unknown slash command as a regular prompt', async () => {
    // No commands are mocked, so any slash command is "unknown"
    mockGetCommands.mockReturnValue([]);

    agentState.events = [
      { type: 'text', text: 'Response to unknown' },
      { type: 'done', reason: 'stop' },
    ];

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: '/unknowncommand',
      prompt_id: 'prompt-id-unknown',
    });

    // The raw input is sent to the Agent.
    expect(agentState.streamInput).toStrictEqual([{ text: '/unknowncommand' }]);
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
      runNonInteractive({
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

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: '/testargs arg1 arg2',
      prompt_id: 'prompt-id-args',
    });

    expect(mockAction).toHaveBeenCalledWith(expect.any(Object), 'arg1 arg2');
    expect(processStdoutSpy).toHaveBeenCalledWith('Acknowledged');
  });

  it('should render tool-call and tool-result events through the Agent stream', async () => {
    // After migration, tool execution is owned by the Agent. This verifies the
    // tool-call/tool-result AgentEvents render their display end-to-end through
    // runNonInteractive.
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

    await runNonInteractive({
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

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'test query',
      prompt_id: 'test-prompt-id',
    });

    const thinkingOutputs = processStdoutSpy.mock.calls.filter(
      (output: unknown[]) => (output[0] as string).includes('<think>'),
    );

    // Both thought events should be buffered and flushed as a single <think> block
    expect(thinkingOutputs).toHaveLength(1);
    const thinkingText = thinkingOutputs[0][0];
    // Code formats thoughts as "subject: description" when both present
    expect(thinkingText).toContain('First: thought');
    expect(thinkingText).toContain('Second: thought');
  });

  it('should NOT emit pyramid-style repeated prefixes in non-interactive CLI', async () => {
    agentState.events = [
      { type: 'thinking', thought: { subject: 'Analyzing', description: '' } },
      { type: 'thinking', thought: { subject: 'request', description: '' } },
      { type: 'text', text: 'Response' },
      { type: 'done', reason: 'stop' },
    ];

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'test query',
      prompt_id: 'test-prompt-id',
    });

    const thinkingOutputs = processStdoutSpy.mock.calls.filter(
      (output: unknown[]) => (output[0] as string).includes('<think>'),
    );

    // All thoughts should be buffered into one <think> block (no pyramid repetition)
    expect(thinkingOutputs).toHaveLength(1);
    const thinkingText = thinkingOutputs[0][0];
    // "Analyzing" should appear exactly once — not repeated for each subsequent thought
    const thoughtCount = (thinkingText.match(/Analyzing/g) ?? []).length;
    expect(thoughtCount).toBe(1);
  });

  it('should filter emojis from thinking blocks in auto mode', async () => {
    const mockGetEphemeralSetting = vi.fn((key: string) => {
      if (key === 'emojifilter') return 'auto';
      if (key === 'reasoning.includeInResponse') return true;
      return undefined;
    });
    vi.mocked(mockConfig.getEphemeralSetting).mockImplementation(
      mockGetEphemeralSetting,
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

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Test input',
      prompt_id: 'prompt-id-emoji-think',
    });

    const thinkOutput = processStdoutSpy.mock.calls.find((value: unknown[]) =>
      (value[0] as string).includes('<think>'),
    );
    expect(thinkOutput).toBeDefined();
    const thinkText = thinkOutput?.[0] as string;
    expect(thinkText).not.toContain('\u{1F914}');
    expect(thinkText).not.toContain('\u{1F4AD}');
    expect(thinkText).toContain('Planning');
    expect(thinkText).toContain('the approach');
    expect(thinkText).toContain('Let me think');
    expect(thinkText).toContain('carefully');
  });

  it('should suppress thinking blocks with emojis in error mode', async () => {
    const mockGetEphemeralSetting = vi.fn((key: string) => {
      if (key === 'emojifilter') return 'error';
      if (key === 'reasoning.includeInResponse') return true;
      return undefined;
    });
    vi.mocked(mockConfig.getEphemeralSetting).mockImplementation(
      mockGetEphemeralSetting,
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

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Test input',
      prompt_id: 'prompt-id-emoji-error',
    });

    const thinkOutput = processStdoutSpy.mock.calls.find((value: unknown[]) =>
      (value[0] as string).includes('<think>'),
    );
    expect(thinkOutput).toBeUndefined();
  });

  it('should pass through thinking blocks when emojifilter is allowed', async () => {
    const mockGetEphemeralSetting = vi.fn((key: string) => {
      if (key === 'emojifilter') return 'allowed';
      if (key === 'reasoning.includeInResponse') return true;
      return undefined;
    });
    vi.mocked(mockConfig.getEphemeralSetting).mockImplementation(
      mockGetEphemeralSetting,
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

    await runNonInteractive({
      config: mockConfig,
      settings: mockSettings,
      input: 'Test input',
      prompt_id: 'prompt-id-emoji-allowed',
    });

    const thinkOutput = processStdoutSpy.mock.calls.find((value: unknown[]) =>
      (value[0] as string).includes('<think>'),
    );
    expect(thinkOutput).toBeDefined();
    const thinkText = thinkOutput?.[0] as string;
    expect(thinkText).toContain('\u{1F914}');
    expect(thinkText).toContain('\u{1F4AD}');
  });
});
