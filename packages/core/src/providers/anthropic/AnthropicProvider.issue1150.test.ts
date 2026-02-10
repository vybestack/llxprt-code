import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';
import type {
  IContent,
  ThinkingBlock,
} from '../../services/history/IContent.js';
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';
import {
  createProviderWithRuntime,
  createRuntimeConfigStub,
} from '../../test-utils/runtime.js';
import {
  createProviderCallOptions,
  type ProviderCallOptionsInit,
} from '../../test-utils/providerCallOptions.js';
import type { ProviderRuntimeContext } from '../../runtime/providerRuntimeContext.js';
import type { SettingsService } from '../../settings/SettingsService.js';
import {
  clearActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../../runtime/providerRuntimeContext.js';
import type {
  AnthropicContentBlock,
  AnthropicRequestBody,
} from './test-utils/anthropicTestUtils.js';

vi.mock('../../core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(
    async () => "You are Claude Code, Anthropic's official CLI for Claude.",
  ),
}));

vi.mock('../../utils/retry.js', () => ({
  retryWithBackoff: vi.fn(async (fn) => await fn()),
  getErrorStatus: vi.fn(() => undefined),
  isNetworkTransientError: vi.fn(() => false),
}));

const mockMessagesCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: mockMessagesCreate,
    },
  })),
}));

describe('AnthropicProvider Issue #1150: Thinking blocks disappear after tool calls', () => {
  let provider: AnthropicProvider;
  let runtimeContext: ProviderRuntimeContext;
  let settingsService: SettingsService;

  beforeEach(() => {
    vi.clearAllMocks();

    let ephemeralSettingsGetter: () => Record<string, unknown> = () => ({});

    const result = createProviderWithRuntime<AnthropicProvider>(
      ({ settingsService: svc }) => {
        svc.set('auth-key', 'test-api-key');
        svc.set('activeProvider', 'anthropic');
        svc.setProviderSetting('anthropic', 'streaming', 'disabled');

        ephemeralSettingsGetter = () => ({
          ...svc.getAllGlobalSettings(),
          ...svc.getProviderSettings('anthropic'),
        });

        return new AnthropicProvider('test-api-key', undefined, {
          ...TEST_PROVIDER_CONFIG,
          getEphemeralSettings: ephemeralSettingsGetter,
        });
      },
      {
        runtimeId: 'anthropic.issue1150.test',
        metadata: { source: 'AnthropicProvider.issue1150.test.ts' },
      },
    );

    provider = result.provider;
    runtimeContext = result.runtime;
    settingsService = result.settingsService;

    if (!runtimeContext.config) {
      runtimeContext.config = createRuntimeConfigStub(settingsService);
    }

    runtimeContext.config.getEphemeralSettings = () => ({
      ...settingsService.getAllGlobalSettings(),
      ...settingsService.getProviderSettings(provider.name),
    });

    runtimeContext.config.getEphemeralSetting = (key: string) => {
      const providerValue = settingsService.getProviderSetting(
        provider.name,
        key,
      );
      if (providerValue !== undefined) {
        return providerValue;
      }
      return settingsService.get(key);
    };

    setActiveProviderRuntimeContext(runtimeContext);

    settingsService.set('reasoning.enabled', true);
    settingsService.set('reasoning.budgetTokens', 10000);
    settingsService.set('reasoning.includeInContext', true);
    settingsService.set('reasoning.stripFromContext', 'none');
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  const buildCallOptions = (
    contents: IContent[],
    overrides: Omit<ProviderCallOptionsInit, 'providerName' | 'contents'> = {},
  ) =>
    createProviderCallOptions({
      providerName: provider.name,
      contents,
      settings: settingsService,
      runtime: runtimeContext,
      config: runtimeContext.config,
      ...overrides,
    });

  it('should preserve thinking blocks after first tool call in multi-turn conversation', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Final response' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'First question' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Analyzing first question',
            sourceField: 'thinking',
            signature: 'sig1',
          } as ThinkingBlock,
          {
            type: 'tool_call',
            id: 'hist_tool_001',
            name: 'list_files',
            parameters: {},
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'hist_tool_001',
            toolName: 'list_files',
            result: 'file1.txt',
          },
        ],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Second question' }],
      },
    ];

    const generator = provider.generateChatCompletion(
      buildCallOptions(messages),
    );
    await generator.next();

    const request = mockMessagesCreate.mock.calls[0][0] as AnthropicRequestBody;

    expect(request.thinking).toBeDefined();
    expect(request.thinking?.type).toBe('enabled');
    expect(request.thinking?.budget_tokens).toBe(10000);
  });

  it('should merge orphaned thinking blocks that arrive before tool calls during streaming', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Response' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Question' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Thinking about the problem',
            sourceField: 'thinking',
            signature: 'sig1',
          } as ThinkingBlock,
        ],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_002',
            name: 'read_file',
            parameters: { path: 'test.txt' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'hist_tool_002',
            toolName: 'read_file',
            result: 'content',
          },
        ],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Follow-up' }],
      },
    ];

    const generator = provider.generateChatCompletion(
      buildCallOptions(messages),
    );
    await generator.next();

    const request = mockMessagesCreate.mock.calls[0][0] as AnthropicRequestBody;

    expect(request.thinking).toBeDefined();

    const assistantMsgWithToolCall = request.messages.find(
      (m) =>
        m.role === 'assistant' &&
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === 'tool_use'),
    );

    expect(assistantMsgWithToolCall).toBeDefined();

    const content = assistantMsgWithToolCall!
      .content as AnthropicContentBlock[];
    const hasThinkingOrRedacted = content.some(
      (b) => b.type === 'thinking' || b.type === 'redacted_thinking',
    );
    expect(hasThinkingOrRedacted).toBe(true);
  });

  it('should handle multiple tool calls with thinking blocks across several turns', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Final' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Q1' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'First thought',
            sourceField: 'thinking',
            signature: 'sig1',
          } as ThinkingBlock,
          {
            type: 'tool_call',
            id: 'hist_tool_001',
            name: 'tool1',
            parameters: {},
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'hist_tool_001',
            toolName: 'tool1',
            result: 'r1',
          },
        ],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Q2' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Second thought',
            sourceField: 'thinking',
            signature: 'sig2',
          } as ThinkingBlock,
          {
            type: 'tool_call',
            id: 'hist_tool_002',
            name: 'tool2',
            parameters: {},
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'hist_tool_002',
            toolName: 'tool2',
            result: 'r2',
          },
        ],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Q3' }],
      },
    ];

    const generator = provider.generateChatCompletion(
      buildCallOptions(messages),
    );
    await generator.next();

    const request = mockMessagesCreate.mock.calls[0][0] as AnthropicRequestBody;

    expect(request.thinking).toBeDefined();
    expect(request.thinking?.type).toBe('enabled');
  });

  it('should look back up to 3 AI messages to find orphaned thinking blocks', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Response' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Start' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Initial thought',
            sourceField: 'thinking',
            signature: 'sig1',
          } as ThinkingBlock,
        ],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Intermediate 1' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Intermediate 2' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_003',
            name: 'tool',
            parameters: {},
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'hist_tool_003',
            toolName: 'tool',
            result: 'result',
          },
        ],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Continue' }],
      },
    ];

    const generator = provider.generateChatCompletion(
      buildCallOptions(messages),
    );
    await generator.next();

    const request = mockMessagesCreate.mock.calls[0][0] as AnthropicRequestBody;

    expect(request.thinking).toBeDefined();
    expect(request.thinking?.type).toBe('enabled');
  });

  it('should keep thinking enabled when tool calls appear without prior thinking', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Response' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Question' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_004',
            name: 'tool',
            parameters: {},
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'hist_tool_004',
            toolName: 'tool',
            result: 'result',
          },
        ],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Follow-up' }],
      },
    ];

    const generator = provider.generateChatCompletion(
      buildCallOptions(messages),
    );
    await generator.next();

    const request = mockMessagesCreate.mock.calls[0][0] as AnthropicRequestBody;

    expect(request.thinking).toBeDefined();
  });

  it('should handle stripFromContext policy with thinking blocks and tool calls', async () => {
    settingsService.set('reasoning.stripFromContext', 'allButLast');

    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Response' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Q1' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'First thought',
            sourceField: 'thinking',
            signature: 'sig1',
          } as ThinkingBlock,
          {
            type: 'tool_call',
            id: 'hist_tool_001',
            name: 'tool1',
            parameters: {},
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'hist_tool_001',
            toolName: 'tool1',
            result: 'r1',
          },
        ],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Q2' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Second thought',
            sourceField: 'thinking',
            signature: 'sig2',
          } as ThinkingBlock,
          {
            type: 'tool_call',
            id: 'hist_tool_002',
            name: 'tool2',
            parameters: {},
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'hist_tool_002',
            toolName: 'tool2',
            result: 'r2',
          },
        ],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Q3' }],
      },
    ];

    const generator = provider.generateChatCompletion(
      buildCallOptions(messages),
    );
    await generator.next();

    const request = mockMessagesCreate.mock.calls[0][0] as AnthropicRequestBody;

    expect(request.thinking).toBeDefined();

    const assistantMessages = request.messages.filter(
      (m) => m.role === 'assistant',
    );
    expect(assistantMessages.length).toBeGreaterThanOrEqual(2);

    const firstAssistant = assistantMessages[0]
      .content as AnthropicContentBlock[];
    const hasRedactedThinking = firstAssistant.some(
      (b) => b.type === 'redacted_thinking',
    );
    expect(hasRedactedThinking).toBe(true);

    const lastAssistant = assistantMessages[assistantMessages.length - 1]
      .content as AnthropicContentBlock[];
    const hasFullThinking = lastAssistant.some((b) => b.type === 'thinking');
    expect(hasFullThinking).toBe(true);
  });

  it('should merge consecutive assistant messages to maintain Anthropic role alternation', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Response' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Question' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Thinking',
            sourceField: 'thinking',
            signature: 'sig1',
          } as ThinkingBlock,
          { type: 'text', text: 'Some text' },
        ],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_005',
            name: 'tool',
            parameters: {},
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'hist_tool_005',
            toolName: 'tool',
            result: 'result',
          },
        ],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Follow-up' }],
      },
    ];

    const generator = provider.generateChatCompletion(
      buildCallOptions(messages),
    );
    await generator.next();

    const request = mockMessagesCreate.mock.calls[0][0] as AnthropicRequestBody;

    const assistantMessages = request.messages.filter(
      (m) => m.role === 'assistant',
    );

    expect(assistantMessages).toHaveLength(1);

    const merged = assistantMessages[0].content as AnthropicContentBlock[];
    const hasThinking = merged.some(
      (b) => b.type === 'thinking' || b.type === 'redacted_thinking',
    );
    expect(hasThinking).toBe(true);

    const hasText = merged.some((b) => b.type === 'text');
    expect(hasText).toBe(true);

    const hasToolUse = merged.some((b) => b.type === 'tool_use');
    expect(hasToolUse).toBe(true);
  });
});
