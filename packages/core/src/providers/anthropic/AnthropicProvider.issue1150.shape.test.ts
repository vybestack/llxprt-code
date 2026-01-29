/**
 * Issue #1150: Anthropic API Shape Validation Tests
 *
 * These tests validate that the messages sent to Anthropic API conform to
 * their strict requirements when extended thinking is enabled:
 *
 * 1. Assistant messages with tool_use MUST start with thinking/redacted_thinking
 * 2. Tool results must immediately follow the assistant message containing tool_use
 * 3. No duplicate tool_use blocks in the same conversation position
 *
 * These tests are designed to FAIL if the message shape is incorrect,
 * exposing the bugs that cause 400 errors from Anthropic.
 *
 * KNOWN FAILING TESTS (Issue #1150):
 * - "assistant message with tool_use must have thinking/redacted_thinking as first block"
 * - "should include thinking in assistant message even when history has text + functionCall without thinking"
 * - "should preserve signature when using redacted_thinking"
 * - "should synthesize redacted_thinking when no thinking exists but extended thinking is enabled"
 *
 * These tests document the exact bugs that need to be fixed.
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

describe('AnthropicProvider Issue #1150: API Shape Validation', () => {
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
        runtimeId: 'anthropic.shape.test',
        metadata: { source: 'AnthropicProvider.issue1150.shape.test.ts' },
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
   * Helper to extract all assistant messages from a request
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

  /**
   * Helper to check if a content block is tool_use
   */
  const isToolUseBlock = (
    block: AnthropicContentBlock,
  ): block is { type: 'tool_use'; id: string; name: string; input: unknown } =>
    block.type === 'tool_use';

  describe('Critical Shape Requirement: Assistant messages with tool_use must start with thinking', () => {
    /**
     * When history has a VALID thinking block with signature, and tool_use,
     * the thinking block should appear first in the assistant message.
     */
    it('assistant message with tool_use must have thinking/redacted_thinking as first block when thinking exists', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      // Real Anthropic signature (opaque encrypted string)
      const realSignature = 'EqoBCkYIAxgCIkAKHgoSdGhpbmtpbmdfY29udGVudA==';

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'List the files' }],
        },
        {
          speaker: 'ai',
          blocks: [
            // Valid thinking block with signature
            {
              type: 'thinking',
              thought: 'Let me analyze this request...',
              sourceField: 'thinking',
              signature: realSignature,
            } as ThinkingBlock,
            { type: 'text', text: 'Let me list the files for you.' },
            {
              type: 'tool_call',
              id: 'tool_001',
              name: 'list_directory',
              parameters: { path: '/tmp' },
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'tool_001',
              toolName: 'list_directory',
              result: { files: ['a.txt', 'b.txt'] },
            } as ToolResponseBlock,
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'What did you find?' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // Find the assistant message that has tool_use
      const assistantWithToolUse = request.messages.find(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some(isToolUseBlock),
      );

      expect(assistantWithToolUse).toBeDefined();
      const content = assistantWithToolUse!.content as AnthropicContentBlock[];

      // With valid thinking, first block must be thinking or redacted_thinking
      const firstBlockIsThinking = isThinkingBlock(content[0]);
      expect(firstBlockIsThinking).toBe(true);
    });

    /**
     * Test the scenario where thinking arrives as separate IContent during streaming
     * and needs to be merged into the tool_use message
     */
    it('should merge separate thinking IContent into subsequent tool_use message', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      // Simulate streaming scenario: thinking comes as separate message
      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Help me with files' }],
        },
        // Thinking block arrives first (separate IContent from streaming)
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'I should list the directory first',
              sourceField: 'thinking',
              signature: 'sig_abc123',
            } as ThinkingBlock,
          ],
        },
        // Then tool_use arrives (separate IContent from streaming)
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'tool_002',
              name: 'list_directory',
              parameters: { path: '/home' },
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'tool_002',
              toolName: 'list_directory',
              result: { files: ['docs', 'src'] },
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

      // The thinking-only message and tool_use-only message should be merged
      // Find assistant message with tool_use
      const assistantWithToolUse = request.messages.find(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some(isToolUseBlock),
      );

      expect(assistantWithToolUse).toBeDefined();
      const content = assistantWithToolUse!.content as AnthropicContentBlock[];

      // Must have thinking first, then tool_use
      expect(
        isThinkingBlock(content[0]),
        `Expected merged message to have thinking first, but got "${content[0]?.type}"`,
      ).toBe(true);

      // Should contain tool_use
      expect(content.some(isToolUseBlock)).toBe(true);
    });
  });

  describe('Critical Shape Requirement: tool_result must follow tool_use', () => {
    /**
     * CRITICAL TEST: This is the second error pattern:
     * "messages.2.content.0.type: Expected tool_result based on preceding tool_use block, but found tool_use"
     *
     * After an assistant message with tool_use, the next user message must
     * contain tool_result, not another tool_use.
     */
    it('user message after tool_use must contain tool_result, not tool_use', async () => {
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
              thought: 'Thinking about it',
              sourceField: 'thinking',
              signature: 'sig_001',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'tool_003',
              name: 'read_file',
              parameters: { path: 'test.txt' },
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'tool_003',
              toolName: 'read_file',
              result: 'file contents',
            } as ToolResponseBlock,
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Next question' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // Find the index of assistant message with tool_use
      const toolUseIndex = request.messages.findIndex(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some(isToolUseBlock),
      );

      expect(toolUseIndex).toBeGreaterThan(-1);

      // The message immediately after tool_use must be a user message with tool_result
      const nextMessage = request.messages[toolUseIndex + 1];
      expect(nextMessage).toBeDefined();
      expect(nextMessage.role).toBe('user');

      expect(Array.isArray(nextMessage.content)).toBe(true);

      // Check that it contains tool_result, not tool_use
      const content = nextMessage.content as AnthropicContentBlock[];
      const hasToolResult = content.some((b) => b.type === 'tool_result');
      const hasToolUse = content.some((b) => b.type === 'tool_use');

      // Message after tool_use must contain tool_result
      expect(hasToolResult).toBe(true);
      // Message after tool_use must NOT contain tool_use (duplicate tool call)
      expect(hasToolUse).toBe(false);
    });
  });

  describe('Multi-turn conversations with thinking and tool calls', () => {
    /**
     * Test a realistic multi-turn scenario similar to the actual failing case:
     * - User asks question
     * - AI thinks + calls tool
     * - Tool responds
     * - AI thinks + calls another tool
     * - Tool responds
     * - User asks follow-up
     */
    it('should maintain correct shape across multiple tool call turns', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Final response' }],
        usage: { input_tokens: 200, output_tokens: 100 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [
            { type: 'text', text: 'Make 4 tool calls with deep thinking' },
          ],
        },
        // Turn 1: thinking + tool call
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'First I should list the directory',
              sourceField: 'thinking',
              signature: 'sig_turn1',
            } as ThinkingBlock,
            { type: 'text', text: 'Let me start by listing files.' },
            {
              type: 'tool_call',
              id: 'tool_t1',
              name: 'list_directory',
              parameters: { path: '/' },
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'tool_t1',
              toolName: 'list_directory',
              result: { files: ['home', 'tmp'] },
            } as ToolResponseBlock,
          ],
        },
        // Turn 2: thinking + tool call
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Now I should read a file',
              sourceField: 'thinking',
              signature: 'sig_turn2',
            } as ThinkingBlock,
            { type: 'text', text: 'Now reading a file.' },
            {
              type: 'tool_call',
              id: 'tool_t2',
              name: 'read_file',
              parameters: { path: '/home/test.txt' },
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'tool_t2',
              toolName: 'read_file',
              result: 'file contents here',
            } as ToolResponseBlock,
          ],
        },
        // Turn 3: thinking + tool call
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Third tool call needed',
              sourceField: 'thinking',
              signature: 'sig_turn3',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'tool_t3',
              name: 'search',
              parameters: { query: 'test' },
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'tool_t3',
              toolName: 'search',
              result: { matches: 5 },
            } as ToolResponseBlock,
          ],
        },
        // Turn 4: thinking + tool call
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Final tool call',
              sourceField: 'thinking',
              signature: 'sig_turn4',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'tool_t4',
              name: 'write_file',
              parameters: { path: '/tmp/out.txt', content: 'done' },
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'tool_t4',
              toolName: 'write_file',
              result: { success: true },
            } as ToolResponseBlock,
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'What did you find?' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // Validate EVERY assistant message with tool_use has thinking first
      const assistantMessages = getAssistantMessages(request);

      for (let i = 0; i < assistantMessages.length; i++) {
        const msg = assistantMessages[i];
        if (!Array.isArray(msg.content)) continue;

        const hasToolUse = msg.content.some(isToolUseBlock);
        // Assistant messages with tool_use must have thinking first
        const firstBlockIsThinking = hasToolUse
          ? isThinkingBlock(msg.content[0])
          : true;
        expect(firstBlockIsThinking).toBe(true);
      }

      // Validate tool_result follows each tool_use
      // Collect indices of assistant messages with tool_use
      const toolUseIndices: number[] = [];
      for (let i = 0; i < request.messages.length; i++) {
        const msg = request.messages[i];
        if (
          msg.role === 'assistant' &&
          Array.isArray(msg.content) &&
          msg.content.some(isToolUseBlock)
        ) {
          toolUseIndices.push(i);
        }
      }

      // Verify each one has tool_result in next message
      for (const idx of toolUseIndices) {
        const nextMsg = request.messages[idx + 1];
        expect(nextMsg).toBeDefined();
        expect(nextMsg.role).toBe('user');
        expect(Array.isArray(nextMsg.content)).toBe(true);

        const nextContent = nextMsg.content as AnthropicContentBlock[];
        const hasToolResult = nextContent.some((b) => b.type === 'tool_result');
        // Message after assistant with tool_use should have tool_result
        expect(hasToolResult).toBe(true);
      }
    });

    /**
     * When history has NO thinking block (no signature), we cannot synthesize
     * a fake one. The message should have text first (not thinking).
     * This is valid for messages that were created before thinking was enabled.
     */
    it('should NOT have thinking when history has text + tool_call without valid thinking', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      // History has tool_call but NO thinking block (no signature to use)
      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'continue' }],
        },
        {
          speaker: 'ai',
          blocks: [
            // NO thinking block - can't synthesize fake thinking
            {
              type: 'text',
              text: "I'll make 4 tool calls with deep thinking between them.",
            },
            {
              type: 'tool_call',
              id: 'hist_tool_01Br5x5FFi2KbsSzhCVN5Pv9',
              name: 'list_directory',
              parameters: { path: '/Users/test/project' },
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_01Br5x5FFi2KbsSzhCVN5Pv9',
              toolName: 'list_directory',
              result: { files: ['src', 'package.json'] },
            } as ToolResponseBlock,
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'What next?' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      const assistantWithToolUse = request.messages.find(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some(isToolUseBlock),
      );

      expect(assistantWithToolUse).toBeDefined();
      const content = assistantWithToolUse!.content as AnthropicContentBlock[];

      // Without valid thinking in history, first block should be text (not fake thinking)
      // We cannot synthesize fake redacted_thinking - Anthropic validates it cryptographically
      const firstBlockIsThinking = isThinkingBlock(content[0]);
      expect(firstBlockIsThinking).toBe(false);
      expect(content[0].type).toBe('text');
    });
  });

  describe('Edge cases for thinking block handling', () => {
    /**
     * When thinking is stripped (redacted), the signature should be preserved
     */
    it('should preserve signature when using redacted_thinking', async () => {
      // Use stripFromContext to force redacted_thinking
      // With 'allButLast', only the LAST thinking message keeps full thinking
      // Earlier ones get redacted_thinking
      settingsService.set('reasoning.stripFromContext', 'allButLast');

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      // Need TWO assistant messages with thinking so first one gets redacted
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
              thought: 'First analysis - should be redacted',
              sourceField: 'thinking',
              signature: 'sig_first_should_be_redacted',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'tool_first',
              name: 'analyze',
              parameters: {},
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'tool_first',
              toolName: 'analyze',
              result: 'first result',
            } as ToolResponseBlock,
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
              thought: 'Second analysis - should stay as full thinking',
              sourceField: 'thinking',
              signature: 'sig_second_keep_full',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'tool_second',
              name: 'analyze',
              parameters: {},
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'tool_second',
              toolName: 'analyze',
              result: 'second result',
            } as ToolResponseBlock,
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

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      const assistantMessages = getAssistantMessages(request);
      expect(assistantMessages.length).toBeGreaterThan(0);

      // First assistant message should have redacted_thinking (stripped)
      const firstAssistant = assistantMessages[0]
        .content as AnthropicContentBlock[];
      const redactedBlock = firstAssistant.find(
        (b) => b.type === 'redacted_thinking',
      ) as { type: 'redacted_thinking'; data: string } | undefined;

      // First assistant message should have redacted_thinking when stripFromContext is enabled
      expect(redactedBlock).toBeDefined();

      // The redacted_thinking should have data (the signature)
      // redacted_thinking must have data field with signature
      expect(redactedBlock?.data).toBeDefined();
      expect(redactedBlock?.data?.length ?? 0).toBeGreaterThan(0);
    });

    /**
     * Test when there is NO thinking block at all but extended thinking is enabled.
     * We CANNOT synthesize fake redacted_thinking - Anthropic validates cryptographically.
     * The message should just have tool_use without thinking.
     */
    it('should NOT synthesize fake redacted_thinking when no thinking exists', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      // History has tool_use with NO thinking at all
      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Do something' }],
        },
        {
          speaker: 'ai',
          blocks: [
            // No thinking block at all - can't fake it
            {
              type: 'tool_call',
              id: 'tool_no_think',
              name: 'do_thing',
              parameters: {},
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'tool_no_think',
              toolName: 'do_thing',
              result: 'done',
            } as ToolResponseBlock,
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Next' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      const assistantWithToolUse = request.messages.find(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some(isToolUseBlock),
      );

      expect(assistantWithToolUse).toBeDefined();
      const content = assistantWithToolUse!.content as AnthropicContentBlock[];

      // Cannot synthesize fake thinking - first block should be tool_use
      const firstBlockIsThinking = isThinkingBlock(content[0]);
      expect(firstBlockIsThinking).toBe(false);
      expect(content[0].type).toBe('tool_use');
    });

    /**
     * Test that thinking blocks from Gemini (sourceField: 'thought') are
     * handled differently from Anthropic thinking (sourceField: 'thinking')
     */
    it('should only send sourceField=thinking blocks as thinking to Anthropic', async () => {
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
            // Gemini-style thought (sourceField: 'thought') - should NOT become Anthropic thinking
            {
              type: 'thinking',
              thought: 'Gemini thought process',
              sourceField: 'thought', // NOT 'thinking'
              // No signature - Gemini doesn't have signatures
            } as ThinkingBlock,
            // Anthropic-style thinking (sourceField: 'thinking') - SHOULD become thinking
            {
              type: 'thinking',
              thought: 'Anthropic extended thinking',
              sourceField: 'thinking',
              signature: 'sig_anthropic',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'tool_mixed',
              name: 'test',
              parameters: {},
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'tool_mixed',
              toolName: 'test',
              result: 'result',
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

      const assistantWithToolUse = request.messages.find(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some(isToolUseBlock),
      );

      expect(assistantWithToolUse).toBeDefined();
      const content = assistantWithToolUse!.content as AnthropicContentBlock[];

      // First block must be thinking (from the Anthropic-style block)
      expect(isThinkingBlock(content[0])).toBe(true);

      // Count thinking blocks - should only have 1 (from sourceField: 'thinking')
      const thinkingCount = content.filter(isThinkingBlock).length;
      expect(
        thinkingCount,
        'Should only include thinking blocks with sourceField=thinking, not sourceField=thought',
      ).toBe(1);
    });
  });
});
