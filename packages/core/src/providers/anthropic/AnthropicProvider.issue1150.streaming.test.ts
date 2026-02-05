/**
 * Issue #1150: Anthropic Streaming Thinking Block Integration Tests
 *
 * These tests validate that thinking blocks are properly captured during streaming
 * and MERGED with subsequent assistant content (text + tool_use) before being
 * added to history.
 *
 * THE BUG: When Anthropic streams extended thinking:
 * 1. Provider yields thinking block as separate IContent: { speaker: 'ai', blocks: [thinking] }
 * 2. Provider yields text+tool_use as separate IContent: { speaker: 'ai', blocks: [text, tool_call...] }
 * 3. These are added to history as SEPARATE entries
 * 4. On next request, the AI message with tool_use has NO thinking block
 * 5. Anthropic rejects: "messages.1.content.0.type: Expected thinking, but found text"
 *
 * The fix requires either:
 * A) Provider merges thinking into subsequent AI content before yielding, OR
 * B) History service merges consecutive AI messages with thinking + tool_use
 *
 * Error: "messages.1.content.0.type: Expected `thinking` or `redacted_thinking`, but found `text`"
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';
import type {
  IContent,
  ThinkingBlock,
  ToolCallBlock,
  ToolResponseBlock,
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
  AnthropicMessage,
  AnthropicRequestBody,
} from './test-utils/anthropicTestUtils.js';

// Mock dependencies
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

describe('AnthropicProvider Issue #1150: Streaming Thinking Block Consolidation', () => {
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
        runtimeId: 'anthropic.streaming.test',
        metadata: { source: 'AnthropicProvider.issue1150.streaming.test.ts' },
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

    // Enable extended thinking
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

  /**
   * Helper to find all assistant messages in a request
   */
  const getAssistantMessages = (
    request: AnthropicRequestBody,
  ): AnthropicMessage[] =>
    request.messages.filter((m) => m.role === 'assistant');

  /**
   * Helper to check if a content block is thinking-related
   */
  const isThinkingBlock = (
    block: AnthropicContentBlock,
  ): block is
    | { type: 'thinking'; thinking: string; signature: string }
    | { type: 'redacted_thinking'; data: string } =>
    block.type === 'thinking' || block.type === 'redacted_thinking';

  describe('Critical: History with separate thinking and tool_use IContents', () => {
    /**
     * THIS IS THE ACTUAL BUG SCENARIO
     *
     * When history has:
     * - IContent 1: { speaker: 'ai', blocks: [thinking] }  <- yielded separately by provider
     * - IContent 2: { speaker: 'ai', blocks: [text, tool_call] }  <- yielded separately
     *
     * The provider must MERGE these into a single assistant message with thinking FIRST.
     *
     * NOTE: This test passes because buildAnthropicMessages() has lookback logic to find
     * orphaned thinking blocks. The REAL bug is that thinking blocks are NEVER making it
     * to history in the first place - see the next test.
     */
    it('should merge separate thinking IContent with subsequent tool_use IContent', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const realSignature =
        'EqoBCkYIAxgCIkAKHgoSdGhpbmtpbmdfY29udGVudBIIc2lnbmF0dXJl';

      // Simulate what happens when streaming yields separate IContents
      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Do something with tools' }],
        },
        // First AI IContent: just thinking (as streamed)
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Let me think about how to help...',
              sourceField: 'thinking',
              signature: realSignature,
            } as ThinkingBlock,
          ],
        },
        // Second AI IContent: text + tool_use (as streamed)
        {
          speaker: 'ai',
          blocks: [
            { type: 'text', text: 'I will help you.' },
            {
              type: 'tool_call',
              id: 'toolu_streaming_test',
              name: 'read_file',
              parameters: { path: '/tmp/test.txt' },
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'toolu_streaming_test',
              toolName: 'read_file',
              result: 'file contents',
            } as ToolResponseBlock,
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

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // Find the assistant message that has tool_use
      const assistantMessages = getAssistantMessages(request);
      const assistantWithToolUse = assistantMessages.find(
        (m) =>
          Array.isArray(m.content) &&
          m.content.some((b) => b.type === 'tool_use'),
      );

      expect(assistantWithToolUse).toBeDefined();
      const content = assistantWithToolUse!.content as AnthropicContentBlock[];

      // CRITICAL: First block MUST be thinking or redacted_thinking
      // This test FAILS if the provider doesn't merge the separate IContents
      expect(content.length).toBeGreaterThan(0);
      const firstBlock = content[0];
      expect(
        isThinkingBlock(firstBlock),
        `First block should be thinking/redacted_thinking but was ${firstBlock.type}`,
      ).toBe(true);
    });

    /**
     * Test the exact scenario from the debug logs:
     * - Thinking block: 633 chars
     * - History shows: ["text","tool_call","tool_call","tool_call","tool_call"]
     * - No thinking in history!
     */
    it('should include thinking when history has multiple tool_calls but thinking was streamed separately', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const realSignature = 'EqoBCkYIAxgCIkAKHgoSc2lnXzEyMzQ1Njc4OTA=';

      // Exact reproduction of the bug scenario from logs
      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [
            {
              type: 'text',
              text: 'make 4 tool calls while thinking deeply',
            },
          ],
        },
        // Thinking yielded separately during streaming
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought:
                'The user wants me to make 4 tool calls while thinking deeply. This is a test to verify that thinking support is working correctly...',
              sourceField: 'thinking',
              signature: realSignature,
            } as ThinkingBlock,
          ],
        },
        // Text + 4 tool calls yielded together (as seen in logs)
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'text',
              text: "I'll make 4 different tool calls to test the thinking support.",
            },
            {
              type: 'tool_call',
              id: 'toolu_01',
              name: 'todo_read',
              parameters: {},
            } as ToolCallBlock,
            {
              type: 'tool_call',
              id: 'toolu_02',
              name: 'list_directory',
              parameters: { path: '/tmp' },
            } as ToolCallBlock,
            {
              type: 'tool_call',
              id: 'toolu_03',
              name: 'glob',
              parameters: { pattern: '**/*.ts' },
            } as ToolCallBlock,
            {
              type: 'tool_call',
              id: 'toolu_04',
              name: 'read_file',
              parameters: { absolute_path: '/tmp/test.txt' },
            } as ToolCallBlock,
          ],
        },
        // Tool responses
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'toolu_01',
              toolName: 'todo_read',
              result: 'No todos found.',
            } as ToolResponseBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'toolu_02',
              toolName: 'list_directory',
              result: 'a.txt b.txt',
            } as ToolResponseBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'toolu_03',
              toolName: 'glob',
              result: 'Found 100 files',
            } as ToolResponseBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'toolu_04',
              toolName: 'read_file',
              result: 'file contents',
            } as ToolResponseBlock,
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

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // Find the assistant message with all the tool_use blocks
      const assistantWithToolUse = request.messages.find(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.filter((b) => b.type === 'tool_use').length === 4,
      );

      expect(
        assistantWithToolUse,
        'Should have assistant message with 4 tool_use blocks',
      ).toBeDefined();

      const content = assistantWithToolUse!.content as AnthropicContentBlock[];

      // CRITICAL: First block MUST be thinking
      // Error if not: "messages.1.content.0.type: Expected thinking, but found text"
      const firstBlock = content[0];
      expect(
        isThinkingBlock(firstBlock),
        `First block must be thinking/redacted_thinking, got: ${firstBlock.type}`,
      ).toBe(true);

      // Should have all 4 tool_use blocks after thinking
      const toolUseBlocks = content.filter((b) => b.type === 'tool_use');
      expect(toolUseBlocks.length).toBe(4);
    });

    /**
     * Test that text-only thinking (no tool_use) remains separate
     */
    it('should keep thinking-only messages separate when no tool_use follows', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const realSignature = 'EqoBCkYIAxgCIkAKHgoSc2lnXzEyMzQ=';

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Tell me something' }],
        },
        // Just thinking + text, no tool_use
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Let me think about this...',
              sourceField: 'thinking',
              signature: realSignature,
            } as ThinkingBlock,
          ],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Here is my response.' }],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Thanks' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // When no tool_use, thinking can be in its own message
      // or merged with text - either is valid for Anthropic
      // (The strict requirement is only for tool_use messages)
      const assistantMessages = getAssistantMessages(request);
      expect(assistantMessages.length).toBeGreaterThan(0);

      // Verify at least one message has thinking
      const hasThinking = assistantMessages.some((m) => {
        if (Array.isArray(m.content)) {
          return m.content.some((b) => isThinkingBlock(b));
        }
        return false;
      });
      expect(hasThinking, 'Should have thinking block somewhere').toBe(true);
    });
  });

  describe('Edge case: Thinking signature preservation through merge', () => {
    /**
     * When merging thinking with tool_use, the signature MUST be preserved
     */
    it('should preserve thinking signature after merging with tool_use IContent', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const originalSignature =
        'EqoBCkYIAxgCIkAKHgoSdGhpbmtpbmdfb3JpZ2luYWxfc2ln';

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
              thought: 'Analyzing...',
              sourceField: 'thinking',
              signature: originalSignature,
            } as ThinkingBlock,
          ],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'toolu_sig_test',
              name: 'tool',
              parameters: {},
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'toolu_sig_test',
              toolName: 'tool',
              result: 'done',
            } as ToolResponseBlock,
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

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // Find assistant with tool_use
      const assistantWithToolUse = request.messages.find(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some((b) => b.type === 'tool_use'),
      );

      expect(assistantWithToolUse).toBeDefined();
      const content = assistantWithToolUse!.content as AnthropicContentBlock[];

      // First block should be thinking with original signature
      const firstBlock = content[0];
      expect(firstBlock).toMatchObject({
        type: 'thinking',
        signature: originalSignature,
      });
    });
  });

  describe('Issue #1293: Fragmented tool_use blocks across 3+ AI messages', () => {
    it('should merge 3+ consecutive AI messages including fragmented tool calls (issue #1293)', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const realSignature = 'EqoBCkYIAxgCIkAKHgoSaXNzdWUxMjkzX3Rlc3Q=';

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Do two things' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Planning to execute both tasks...',
              sourceField: 'thinking',
              signature: realSignature,
            } as ThinkingBlock,
          ],
        },
        {
          speaker: 'ai',
          blocks: [
            { type: 'text', text: 'I will help with both tasks.' },
            {
              type: 'tool_call',
              id: 'toolu_1293_A',
              name: 'task_a',
              parameters: { action: 'first' },
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'toolu_1293_B',
              name: 'task_b',
              parameters: { action: 'second' },
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'toolu_1293_A',
              toolName: 'task_a',
              result: 'Task A complete',
            } as ToolResponseBlock,
            {
              type: 'tool_response',
              callId: 'toolu_1293_B',
              toolName: 'task_b',
              result: 'Task B complete',
            } as ToolResponseBlock,
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Thanks' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      const assistantMessages = getAssistantMessages(request);
      const assistantWithToolUse = assistantMessages.find(
        (m) =>
          Array.isArray(m.content) &&
          m.content.some((b) => b.type === 'tool_use'),
      );

      expect(assistantWithToolUse).toBeDefined();
      const content = assistantWithToolUse!.content as AnthropicContentBlock[];

      expect(
        isThinkingBlock(content[0]),
        `First block must be thinking, got ${content[0].type}`,
      ).toBe(true);

      const toolUseBlocks = content.filter((b) => b.type === 'tool_use');
      expect(toolUseBlocks.length).toBe(2);

      const toolUseIds = toolUseBlocks.map((b) => (b as { id: string }).id);
      expect(toolUseIds).toContain('toolu_1293_A');
      expect(toolUseIds).toContain('toolu_1293_B');

      const userMessages = request.messages.filter((m) => m.role === 'user');
      const toolResultMessage = userMessages.find((m) => {
        if (Array.isArray(m.content)) {
          return m.content.some((b) => b.type === 'tool_result');
        }
        return false;
      });

      expect(toolResultMessage).toBeDefined();
      const toolResults = (
        toolResultMessage!.content as AnthropicContentBlock[]
      ).filter((b) => b.type === 'tool_result');
      expect(toolResults.length).toBe(2);
    });

    it('should handle 4+ consecutive AI messages with multiple thinking blocks', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const sig1 = 'EqoBCkYIAxgCIkAKHgoSc2lnXzE=';
      const sig2 = 'EqoBCkYIAxgCIkAKHgoSc2lnXzI=';

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Complex task' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'First thought...',
              sourceField: 'thinking',
              signature: sig1,
            } as ThinkingBlock,
          ],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Second thought...',
              sourceField: 'thinking',
              signature: sig2,
            } as ThinkingBlock,
          ],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Working on it.' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'toolu_multi',
              name: 'execute',
              parameters: {},
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'toolu_multi',
              toolName: 'execute',
              result: 'Done',
            } as ToolResponseBlock,
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

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      const assistantMessages = getAssistantMessages(request);
      const assistantWithToolUse = assistantMessages.find(
        (m) =>
          Array.isArray(m.content) &&
          m.content.some((b) => b.type === 'tool_use'),
      );

      expect(assistantWithToolUse).toBeDefined();
      const content = assistantWithToolUse!.content as AnthropicContentBlock[];

      const thinkingBlocks = content.filter((b) => isThinkingBlock(b));
      expect(thinkingBlocks.length).toBe(2);

      expect(isThinkingBlock(content[0]), 'First block must be thinking').toBe(
        true,
      );
      expect(isThinkingBlock(content[1]), 'Second block must be thinking').toBe(
        true,
      );

      const textBlocks = content.filter((b) => b.type === 'text');
      expect(textBlocks.length).toBe(1);

      const toolUseBlocks = content.filter((b) => b.type === 'tool_use');
      expect(toolUseBlocks.length).toBe(1);
    });
  });
});
