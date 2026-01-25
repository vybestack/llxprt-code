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
import type { AnthropicRequestBody } from './test-utils/anthropicTestUtils.js';

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

describe('AnthropicProvider Issue #1150 Reproduction: Edge cases causing thinking to disappear', () => {
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
        runtimeId: 'anthropic.issue1150repro.test',
        metadata: { source: 'AnthropicProvider.issue1150-repro.test.ts' },
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

  it('keeps thinking enabled when the only thinking block is more than 3 AI messages back', async () => {
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
            thought: 'Original thought',
            sourceField: 'thinking',
            signature: 'sig1',
          } as ThinkingBlock,
        ],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Text1' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Text2' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Text3' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_001',
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
            callId: 'hist_tool_001',
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
  });

  it('keeps thinking enabled when sourceField is not thinking and no signatures are present', async () => {
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
            thought: 'This is a thought',
            sourceField: 'reasoning_content',
          } as ThinkingBlock,
          {
            type: 'tool_call',
            id: 'hist_tool_002',
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
            callId: 'hist_tool_002',
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

  it('keeps thinking enabled when tool calls are separated from thinking by text', async () => {
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
            thought: 'Analyzing',
            sourceField: 'thinking',
            signature: 'sig1',
          } as ThinkingBlock,
          { type: 'text', text: 'Let me check...' },
        ],
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
  });

  it('keeps thinking enabled when stripping thinking without signatures', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Response' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    settingsService.set('reasoning.stripFromContext', 'all');

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
            thought: 'Thought without signature',
            sourceField: 'thinking',
          } as ThinkingBlock,
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

  it('COMPLEX SCENARIO: Multiple tool calls in rapid succession with orphaned thinking', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Final response' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const messages: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Q1' }] },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'First thought',
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
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Second thought',
            sourceField: 'thinking',
            signature: 'sig2',
          } as ThinkingBlock,
        ],
      },
      {
        speaker: 'ai',
        blocks: [
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
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Third thought',
            sourceField: 'thinking',
            signature: 'sig3',
          } as ThinkingBlock,
        ],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_003',
            name: 'tool3',
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
            toolName: 'tool3',
            result: 'r3',
          },
        ],
      },
      { speaker: 'human', blocks: [{ type: 'text', text: 'Q2' }] },
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
    let missingThinkingCount = 0;
    for (const msg of assistantMessages) {
      if (Array.isArray(msg.content)) {
        const hasToolUse = msg.content.some((b) => b.type === 'tool_use');
        const hasThinking = msg.content.some(
          (b) => b.type === 'thinking' || b.type === 'redacted_thinking',
        );
        if (hasToolUse && !hasThinking) {
          missingThinkingCount++;
        }
      }
    }

    expect(missingThinkingCount).toBe(0);
  });
});
