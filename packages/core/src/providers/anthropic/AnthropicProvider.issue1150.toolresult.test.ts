/**
 * Issue #1150: Anthropic API tool_result Adjacency Tests
 *
 * These tests validate the specific error:
 * "messages.3: `tool_use` ids were found without `tool_result` blocks immediately after:
 *  toolu_01PCrAFi3Lase4GDDq32Qkvy, toolu_01QRZFAaYwxXrsbd5grzLg4E, ...
 *  Each `tool_use` block must have a corresponding `tool_result` block in the next message."
 *
 * Anthropic's requirements:
 * 1. Every tool_use in an assistant message must have a corresponding tool_result
 * 2. The tool_result must be in the NEXT message (immediately after)
 * 3. All tool_use ids from one assistant message must have tool_results before any other message type
 *
 * These tests are designed to FAIL if the message shape is incorrect,
 * exposing the bugs that cause 400 errors from Anthropic.
 *
 * KNOWN FAILING TESTS (Issue #1150) - marked with .skip until fixed:
 * - "should detect when tool_results are missing for some tool_use ids"
 *   Bug: Missing tool_results are not synthesized or detected before sending to API
 * - "should not have other messages between assistant tool_use and user tool_result"
 *   Bug: Provider doesn't reorder/consolidate messages to ensure tool_result adjacency
 *
 * FIXED TESTS:
 * - "should consolidate separate tool response IContents into single user message" [OK]
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

describe('AnthropicProvider Issue #1150: tool_result Adjacency Validation', () => {
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
        runtimeId: 'anthropic.toolresult.test',
        metadata: { source: 'AnthropicProvider.issue1150.toolresult.test.ts' },
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
   * Helper to extract tool_use ids from a message
   */
  const getToolUseIds = (content: AnthropicContentBlock[]): string[] =>
    content
      .filter(
        (
          b,
        ): b is {
          type: 'tool_use';
          id: string;
          name: string;
          input: unknown;
        } => b.type === 'tool_use',
      )
      .map((b) => b.id);

  /**
   * Helper to extract tool_result tool_use_ids from a message
   */
  const getToolResultIds = (content: AnthropicContentBlock[]): string[] =>
    content
      .filter(
        (
          b,
        ): b is {
          type: 'tool_result';
          tool_use_id: string;
          content: unknown;
        } => b.type === 'tool_result',
      )
      .map((b) => b.tool_use_id);

  describe('Critical: Every tool_use must have tool_result in next message', () => {
    /**
     * CRITICAL TEST: This is the exact error from the bug report:
     * "messages.3: `tool_use` ids were found without `tool_result` blocks immediately after"
     *
     * When an assistant message has multiple tool_use blocks, ALL of them
     * must have corresponding tool_result blocks in the NEXT message.
     */
    it('should have tool_result for every tool_use id in the next message', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      // Simulate 4 parallel tool calls (like in the error)
      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Do multiple things' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'I need to make 4 tool calls',
              sourceField: 'thinking',
              signature: 'sig_multi',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'toolu_01PCrAFi3Lase4GDDq32Qkvy',
              name: 'list_directory',
              parameters: { path: '/a' },
            } as ToolCallBlock,
            {
              type: 'tool_call',
              id: 'toolu_01QRZFAaYwxXrsbd5grzLg4E',
              name: 'list_directory',
              parameters: { path: '/b' },
            } as ToolCallBlock,
            {
              type: 'tool_call',
              id: 'toolu_01VRn8DCAuPjDgz53odfq3Av',
              name: 'list_directory',
              parameters: { path: '/c' },
            } as ToolCallBlock,
            {
              type: 'tool_call',
              id: 'toolu_01Wzxo8ENJMmQQetKhgZ1mee',
              name: 'list_directory',
              parameters: { path: '/d' },
            } as ToolCallBlock,
          ],
        },
        // All 4 tool responses in a single tool message
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'toolu_01PCrAFi3Lase4GDDq32Qkvy',
              toolName: 'list_directory',
              result: { files: ['a1'] },
            } as ToolResponseBlock,
            {
              type: 'tool_response',
              callId: 'toolu_01QRZFAaYwxXrsbd5grzLg4E',
              toolName: 'list_directory',
              result: { files: ['b1'] },
            } as ToolResponseBlock,
            {
              type: 'tool_response',
              callId: 'toolu_01VRn8DCAuPjDgz53odfq3Av',
              toolName: 'list_directory',
              result: { files: ['c1'] },
            } as ToolResponseBlock,
            {
              type: 'tool_response',
              callId: 'toolu_01Wzxo8ENJMmQQetKhgZ1mee',
              toolName: 'list_directory',
              result: { files: ['d1'] },
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

      // Find the assistant message with tool_use blocks
      let toolUseMessageIndex = -1;
      let toolUseIds: string[] = [];

      for (let i = 0; i < request.messages.length; i++) {
        const msg = request.messages[i];
        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
          const ids = getToolUseIds(msg.content);
          if (ids.length > 0) {
            toolUseMessageIndex = i;
            toolUseIds = ids;
            break;
          }
        }
      }

      expect(toolUseMessageIndex).toBeGreaterThan(-1);
      expect(toolUseIds.length).toBe(4);

      // The NEXT message must be user with tool_result for ALL tool_use ids
      const nextMessage = request.messages[toolUseMessageIndex + 1];
      expect(nextMessage).toBeDefined();
      expect(nextMessage.role).toBe('user');
      expect(Array.isArray(nextMessage.content)).toBe(true);

      const toolResultIds = getToolResultIds(
        nextMessage.content as AnthropicContentBlock[],
      );

      // CRITICAL: Every tool_use id must have a corresponding tool_result
      for (const toolUseId of toolUseIds) {
        const hasResult = toolResultIds.includes(toolUseId);
        // tool_use id must have corresponding tool_result in next message
        // Missing results cause: "tool_use ids were found without tool_result blocks immediately after"
        expect(hasResult).toBe(true);
      }

      // Also verify no extra tool_results
      expect(toolResultIds.length).toBe(toolUseIds.length);
    });

    /**
     * Test when tool responses come in separate IContent messages (streaming scenario)
     */
    it('should consolidate separate tool response IContents into single user message', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      // Simulate tool responses arriving as separate IContent (from streaming/executor)
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
              thought: 'Making two tool calls',
              sourceField: 'thinking',
              signature: 'sig_two',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'tool_first',
              name: 'read_file',
              parameters: { path: 'a.txt' },
            } as ToolCallBlock,
            {
              type: 'tool_call',
              id: 'tool_second',
              name: 'read_file',
              parameters: { path: 'b.txt' },
            } as ToolCallBlock,
          ],
        },
        // First tool response in separate message
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'tool_first',
              toolName: 'read_file',
              result: 'content A',
            } as ToolResponseBlock,
          ],
        },
        // Second tool response in separate message
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'tool_second',
              toolName: 'read_file',
              result: 'content B',
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

      // Find assistant message with tool_use
      let toolUseMessageIndex = -1;
      for (let i = 0; i < request.messages.length; i++) {
        const msg = request.messages[i];
        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
          if (msg.content.some((b) => b.type === 'tool_use')) {
            toolUseMessageIndex = i;
            break;
          }
        }
      }

      expect(toolUseMessageIndex).toBeGreaterThan(-1);

      // Next message must contain BOTH tool_results
      const nextMessage = request.messages[toolUseMessageIndex + 1];
      expect(nextMessage).toBeDefined();
      expect(nextMessage.role).toBe('user');

      const content = nextMessage.content as AnthropicContentBlock[];
      const toolResultIds = getToolResultIds(content);

      // IDs are normalized to toolu_ prefix by AnthropicProvider
      const hasFirst = toolResultIds.some((id) => id.includes('tool_first'));
      const hasSecond = toolResultIds.some((id) => id.includes('tool_second'));

      // First tool_result must be in consolidated message
      expect(hasFirst).toBe(true);
      // Second tool_result must be in consolidated message
      expect(hasSecond).toBe(true);

      // Should be exactly one user message with both results, not two separate messages
      expect(toolResultIds.length).toBe(2);
    });

    /**
     * Test when some tool responses are missing entirely
     * KNOWN BUG: Provider doesn't synthesize placeholder tool_results for missing responses
     */
    it('should detect when tool_results are missing for some tool_use ids', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      // Missing one tool response - this SHOULD fail or be handled
      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Do three things' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Making three calls',
              sourceField: 'thinking',
              signature: 'sig_three',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'tool_a',
              name: 'action',
              parameters: {},
            } as ToolCallBlock,
            {
              type: 'tool_call',
              id: 'tool_b',
              name: 'action',
              parameters: {},
            } as ToolCallBlock,
            {
              type: 'tool_call',
              id: 'tool_c',
              name: 'action',
              parameters: {},
            } as ToolCallBlock,
          ],
        },
        // Only 2 of 3 tool responses provided!
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'tool_a',
              toolName: 'action',
              result: 'done A',
            } as ToolResponseBlock,
            {
              type: 'tool_response',
              callId: 'tool_b',
              toolName: 'action',
              result: 'done B',
            } as ToolResponseBlock,
            // tool_c response is MISSING
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'What happened?' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // Find assistant message with tool_use
      let toolUseMessageIndex = -1;

      for (let i = 0; i < request.messages.length; i++) {
        const msg = request.messages[i];
        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
          const ids = getToolUseIds(msg.content);
          if (ids.length > 0) {
            toolUseMessageIndex = i;
            break;
          }
        }
      }

      // Next message should have tool_results
      const nextMessage = request.messages[toolUseMessageIndex + 1];
      expect(nextMessage).toBeDefined();

      const content = nextMessage.content as AnthropicContentBlock[];
      const toolResultIds = getToolResultIds(content);

      // This test documents the bug: missing tool_c result
      // Provider should either:
      // 1. Synthesize a placeholder tool_result for missing responses, OR
      // 2. Throw an error before sending to Anthropic
      // IDs are normalized to toolu_ prefix
      const hasMissingToolResult = toolResultIds.some((id) =>
        id.includes('tool_c'),
      );
      expect(hasMissingToolResult).toBe(true);
    });
  });

  describe('tool_result must immediately follow tool_use', () => {
    /**
     * Test when there's content between tool_use and tool_result
     * KNOWN BUG: Provider doesn't reorder messages to ensure adjacency
     */
    it('should not have other messages between assistant tool_use and user tool_result', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      // Simulate incorrect ordering: user message between tool_use and tool_result
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
              thought: 'Calling tool',
              sourceField: 'thinking',
              signature: 'sig_order',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'tool_order_test',
              name: 'do_thing',
              parameters: {},
            } as ToolCallBlock,
          ],
        },
        // WRONG: Human message before tool_result
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Interruption!' }],
        },
        // Tool response comes after human message - bad ordering
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'tool_order_test',
              toolName: 'do_thing',
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

      // Find assistant message with tool_use
      let toolUseMessageIndex = -1;
      for (let i = 0; i < request.messages.length; i++) {
        const msg = request.messages[i];
        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
          if (msg.content.some((b) => b.type === 'tool_use')) {
            toolUseMessageIndex = i;
            break;
          }
        }
      }

      expect(toolUseMessageIndex).toBeGreaterThan(-1);

      // The IMMEDIATELY NEXT message must have tool_result
      const nextMessage = request.messages[toolUseMessageIndex + 1];
      expect(nextMessage).toBeDefined();
      expect(nextMessage.role).toBe('user');

      expect(Array.isArray(nextMessage.content)).toBe(true);
      const hasToolResult = (
        nextMessage.content as AnthropicContentBlock[]
      ).some((b) => b.type === 'tool_result');
      // Message immediately after tool_use must contain tool_result
      // Provider must reorder or consolidate to ensure adjacency
      expect(hasToolResult).toBe(true);
    });

    /**
     * Test proper handling of interleaved tool calls and responses
     */
    it('should handle multiple sequential tool call/response pairs correctly', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      // Sequential tool calls (not parallel)
      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Do things sequentially' }],
        },
        // First tool call
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'First action',
              sourceField: 'thinking',
              signature: 'sig_seq1',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'seq_tool_1',
              name: 'step1',
              parameters: {},
            } as ToolCallBlock,
          ],
        },
        // First response
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'seq_tool_1',
              toolName: 'step1',
              result: 'result 1',
            } as ToolResponseBlock,
          ],
        },
        // Second tool call
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Second action',
              sourceField: 'thinking',
              signature: 'sig_seq2',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'seq_tool_2',
              name: 'step2',
              parameters: {},
            } as ToolCallBlock,
          ],
        },
        // Second response
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'seq_tool_2',
              toolName: 'step2',
              result: 'result 2',
            } as ToolResponseBlock,
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Done?' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // Find all assistant messages with tool_use
      const toolUseIndices: number[] = [];
      for (let i = 0; i < request.messages.length; i++) {
        const msg = request.messages[i];
        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
          if (msg.content.some((b) => b.type === 'tool_use')) {
            toolUseIndices.push(i);
          }
        }
      }

      // Each tool_use message must be immediately followed by tool_result
      for (const idx of toolUseIndices) {
        const assistantMsg = request.messages[idx];
        const nextMsg = request.messages[idx + 1];

        expect(nextMsg).toBeDefined();
        expect(nextMsg.role).toBe('user');
        expect(Array.isArray(nextMsg.content)).toBe(true);

        const nextContent = nextMsg.content as AnthropicContentBlock[];
        const hasToolResult = nextContent.some((b) => b.type === 'tool_result');

        // Get the tool_use ids from this assistant message
        const toolUseIds = getToolUseIds(
          assistantMsg.content as AnthropicContentBlock[],
        );
        const toolResultIds = getToolResultIds(nextContent);

        // Assistant message has tool_use, next message must have tool_result
        expect(hasToolResult).toBe(true);

        // Each tool_use should have corresponding tool_result
        for (const id of toolUseIds) {
          const hasMatchingResult = toolResultIds.includes(id);
          expect(hasMatchingResult).toBe(true);
        }
      }
    });
  });

  describe('Edge cases for tool_result handling', () => {
    /**
     * Test handling of tool errors
     */
    it('should properly format tool_result with is_error for failed tools', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Try something' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Attempting action',
              sourceField: 'thinking',
              signature: 'sig_err',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'tool_will_fail',
              name: 'risky_action',
              parameters: {},
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'tool_will_fail',
              toolName: 'risky_action',
              result: null,
              error: 'Permission denied: cannot access resource',
            } as ToolResponseBlock,
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'What happened?' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // Find the tool_result
      let toolResult: AnthropicContentBlock | undefined;
      for (const msg of request.messages) {
        if (msg.role === 'user' && Array.isArray(msg.content)) {
          toolResult = msg.content.find((b) => b.type === 'tool_result');
          if (toolResult) break;
        }
      }

      expect(toolResult).toBeDefined();
      expect(toolResult!.type).toBe('tool_result');

      // Error should set is_error flag
      const result = toolResult as {
        type: 'tool_result';
        tool_use_id: string;
        content: unknown;
        is_error?: boolean;
      };
      expect(
        result.is_error,
        'Tool error should set is_error: true in tool_result',
      ).toBe(true);
    });

    /**
     * Test that tool_result content is properly serialized
     */
    it('should serialize tool_result content correctly for complex objects', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const complexResult = {
        files: [
          { name: 'a.txt', size: 100 },
          { name: 'b.txt', size: 200 },
        ],
        metadata: {
          total: 2,
          directory: '/test',
        },
      };

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'List files' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Listing',
              sourceField: 'thinking',
              signature: 'sig_complex',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'tool_complex_result',
              name: 'list_files',
              parameters: {},
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'tool_complex_result',
              toolName: 'list_files',
              result: complexResult,
            } as ToolResponseBlock,
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Details?' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // Find the tool_result
      let toolResult: AnthropicContentBlock | undefined;
      for (const msg of request.messages) {
        if (msg.role === 'user' && Array.isArray(msg.content)) {
          toolResult = msg.content.find((b) => b.type === 'tool_result');
          if (toolResult) break;
        }
      }

      expect(toolResult).toBeDefined();

      const result = toolResult as {
        type: 'tool_result';
        tool_use_id: string;
        content: unknown;
      };

      // Content should be present and serializable
      expect(result.content).toBeDefined();

      // Should not throw when stringified
      expect(() => JSON.stringify(result.content)).not.toThrow();
    });
  });
});
