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
  AnthropicRequestBody,
  AnthropicContentBlock,
} from './test-utils/anthropicTestUtils.js';

vi.mock('../../core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(
    async () => "You are Claude Code, Anthropic's official CLI for Claude.",
  ),
}));

vi.mock('../../utils/retry.js', () => ({
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

describe('AnthropicProvider Issue #1494: thinking blocks without signatures must not be silently dropped', () => {
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
        runtimeId: 'anthropic.issue1494.test',
        metadata: { source: 'AnthropicProvider.issue1494.test.ts' },
      },
    );

    provider = result.provider;
    runtimeContext = result.runtime;
    settingsService = result.settingsService;

    if (runtimeContext.config == null) {
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
      settings: settingsService,
      runtime: runtimeContext,
      config: runtimeContext.config,
      ...overrides,
      contents,
    });

  it('preserves unsigned thinking blocks as thinking type (z.ai GLM models)', async () => {
    // GLM-5 on z.ai uses the Anthropic API but does not produce cryptographic
    // signatures on thinking blocks. These must NOT be silently dropped.
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'I will help you with that.' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Help me fix this bug' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Let me analyze the code structure first...',
            sourceField: 'thinking',
            // No signature — this is a z.ai GLM model
          } as ThinkingBlock,
          {
            type: 'tool_call',
            id: 'tool_001',
            name: 'read_file',
            parameters: { path: '/src/main.ts' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'tool_001',
            toolName: 'read_file',
            result: 'file contents here',
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

    // Find the assistant message that should contain the thinking block
    const assistantMsg = request.messages.find(
      (m) =>
        m.role === 'assistant' &&
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === 'tool_use'),
    );

    expect(assistantMsg).toBeDefined();
    const blocks = assistantMsg!.content as AnthropicContentBlock[];
    const thinkingBlock = blocks.find((b) => b.type === 'thinking');

    // The thinking block must be preserved — not dropped
    expect(thinkingBlock).toBeDefined();
    expect(thinkingBlock!.type).toBe('thinking');
    expect((thinkingBlock as { thinking: string }).thinking).toBe(
      'Let me analyze the code structure first...',
    );
  });

  it('does not produce empty assistant messages from thinking-only blocks without signatures', async () => {
    // When an AI message contains ONLY unsigned thinking blocks, the content
    // must not become empty (which would be sanitized to "[No content generated]").
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Done.' }],
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
            thought: 'Planning my approach to this task...',
            sourceField: 'thinking',
            // No signature
          } as ThinkingBlock,
        ],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'tool_002',
            name: 'search',
            parameters: { query: 'test' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'tool_002',
            toolName: 'search',
            result: 'found it',
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

    // No assistant message should contain "[No content generated]"
    const assistantStringContent = request.messages
      .filter(
        (msg) => msg.role === 'assistant' && typeof msg.content === 'string',
      )
      .map((msg) => msg.content as string);
    for (const content of assistantStringContent) {
      expect(content).not.toBe('[No content generated]');
    }
  });

  it('converts non-Anthropic thinking blocks (reasoning_content) to text', async () => {
    // Thinking blocks from non-Anthropic sources (e.g., DeepSeek reasoning_content)
    // should be preserved as text blocks, not dropped.
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
            thought: 'Deep reasoning about the problem...',
            sourceField: 'reasoning_content',
          } as ThinkingBlock,
          {
            type: 'tool_call',
            id: 'tool_003',
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
            callId: 'tool_003',
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

    // Find the assistant message with tool_use
    const assistantMsg = request.messages.find(
      (m) =>
        m.role === 'assistant' &&
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === 'tool_use'),
    );

    expect(assistantMsg).toBeDefined();
    const blocks = assistantMsg!.content as AnthropicContentBlock[];

    // The reasoning_content thinking should be preserved as a text block
    const textBlock = blocks.find(
      (b) =>
        b.type === 'text' &&
        (b as { text: string }).text.includes('Deep reasoning'),
    );
    expect(textBlock).toBeDefined();
  });

  it('redacts unsigned thinking blocks as text when stripping is enabled', async () => {
    // When strip policy says to redact, but thinking has no signature,
    // we cannot produce redacted_thinking (needs signature data).
    // Fall back to including as text instead of dropping entirely.
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Response' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    settingsService.set('reasoning.stripFromContext', 'allButLast');

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
            thought: 'Old reasoning that should be redacted',
            sourceField: 'thinking',
            // No signature — cannot create redacted_thinking
          } as ThinkingBlock,
          {
            type: 'tool_call',
            id: 'tool_004',
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
            callId: 'tool_004',
            toolName: 'tool',
            result: 'result',
          },
        ],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Second question' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Latest reasoning',
            sourceField: 'thinking',
            // No signature
          } as ThinkingBlock,
          { type: 'text', text: 'Here is my answer' },
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

    // No messages should have been turned into "[No content generated]"
    // The old thinking should be preserved as text (fallback for redaction without signature)
    const assistantStringContent = request.messages
      .filter(
        (msg) => msg.role === 'assistant' && typeof msg.content === 'string',
      )
      .map((msg) => msg.content as string);
    for (const content of assistantStringContent) {
      expect(content).not.toBe('[No content generated]');
    }

    // Explicitly verify the redacted thinking was preserved as text fallback
    const assistantWithToolUse = request.messages.find(
      (m) =>
        m.role === 'assistant' &&
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === 'tool_use'),
    );
    expect(assistantWithToolUse).toBeDefined();
    const blocks = assistantWithToolUse!.content as AnthropicContentBlock[];
    const textFallback = blocks.find(
      (b) =>
        b.type === 'text' &&
        (b as { text: string }).text.includes('Old reasoning'),
    );
    expect(
      textFallback,
      'Unsigned thinking should be preserved as text when redacted',
    ).toBeDefined();
  });

  it('still uses proper thinking/redacted_thinking for signed blocks', async () => {
    // Ensure the fix doesn't break normal Claude behavior with signatures
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
            thought: 'Signed thinking content',
            sourceField: 'thinking',
            signature: 'cryptographic_sig_123',
          } as ThinkingBlock,
          {
            type: 'tool_call',
            id: 'tool_005',
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
            callId: 'tool_005',
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

    const assistantMsg = request.messages.find(
      (m) =>
        m.role === 'assistant' &&
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === 'tool_use'),
    );

    expect(assistantMsg).toBeDefined();
    const blocks = assistantMsg!.content as AnthropicContentBlock[];
    const thinkingBlock = blocks.find((b) => b.type === 'thinking');

    expect(thinkingBlock).toBeDefined();
    expect(thinkingBlock!.type).toBe('thinking');
    expect(
      (thinkingBlock as { thinking: string; signature: string }).signature,
    ).toBe('cryptographic_sig_123');
  });
});
