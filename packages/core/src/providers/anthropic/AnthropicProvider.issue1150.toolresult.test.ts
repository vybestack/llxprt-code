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

  describe('Issue #1312: Interrupted tool calls and consecutive same-role messages', () => {
    const assertStrictAlternation = (
      messages: Array<{ role: string; content: unknown }>,
    ) => {
      for (let i = 1; i < messages.length; i++) {
        expect(messages[i].role).not.toBe(messages[i - 1].role);
      }
    };

    it('should handle interrupted tool calls followed by user messages (issue #1312)', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Find some files' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'I will search for files',
              sourceField: 'thinking',
              signature: 'sig_interrupted',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'toolu_01QzKQrpaCwfR4JgXphWnGrC',
              name: 'glob',
              parameters: { pattern: '**/*.ts' },
            } as ToolCallBlock,
            {
              type: 'tool_call',
              id: 'toolu_017u1Ybt9ECtS4GYE46hXB8H',
              name: 'glob',
              parameters: { pattern: '**/*.js' },
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'human',
          blocks: [
            {
              type: 'text',
              text: 'First, reason in your scratchpad...',
            },
          ],
        },
        {
          speaker: 'human',
          blocks: [
            { type: 'text', text: 'do you remember what we are doing?' },
          ],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'The user is asking me to remember',
              sourceField: 'thinking',
              signature: 'sig_response',
            } as ThinkingBlock,
            {
              type: 'text',
              text: 'Yes, I remember we were looking for files.',
            },
          ],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      assertStrictAlternation(request.messages);

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
      expect(toolUseIds.length).toBe(2);

      const nextMessage = request.messages[toolUseMessageIndex + 1];
      expect(nextMessage).toBeDefined();
      expect(nextMessage.role).toBe('user');
      expect(Array.isArray(nextMessage.content)).toBe(true);

      const toolResultIds = getToolResultIds(
        nextMessage.content as AnthropicContentBlock[],
      );
      for (const toolUseId of toolUseIds) {
        expect(toolResultIds).toContain(toolUseId);
      }

      const toolResults = (
        nextMessage.content as AnthropicContentBlock[]
      ).filter((b) => b.type === 'tool_result') as Array<{
        type: 'tool_result';
        tool_use_id: string;
        content: unknown;
        is_error?: boolean;
      }>;
      for (const tr of toolResults) {
        expect(tr.is_error).toBe(true);
        expect(tr.content).toBe('[tool execution interrupted]');
      }
    });

    it('should merge consecutive user messages containing tool_results to maintain role alternation', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Do something' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Calling a tool',
              sourceField: 'thinking',
              signature: 'sig_tool',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'tool_merge_test',
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
              callId: 'tool_merge_test',
              toolName: 'read_file',
              result: 'file contents',
            } as ToolResponseBlock,
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Now do something else' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Got it',
              sourceField: 'thinking',
              signature: 'sig_response',
            } as ThinkingBlock,
            { type: 'text', text: 'Done.' },
          ],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      assertStrictAlternation(request.messages);

      let toolUseIdx = -1;
      for (let i = 0; i < request.messages.length; i++) {
        const msg = request.messages[i];
        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
          if (msg.content.some((b) => b.type === 'tool_use')) {
            toolUseIdx = i;
            break;
          }
        }
      }

      expect(toolUseIdx).toBeGreaterThan(-1);
      const nextMsg = request.messages[toolUseIdx + 1];
      expect(nextMsg.role).toBe('user');
      expect(Array.isArray(nextMsg.content)).toBe(true);

      const content = nextMsg.content as AnthropicContentBlock[];
      const hasToolResult = content.some((b) => b.type === 'tool_result');
      const hasText = content.some((b) => b.type === 'text');
      expect(hasToolResult).toBe(true);
      expect(hasText).toBe(true);
    });

    it('should handle tool_use followed by user interruption then another tool_use cycle', async () => {
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
              thought: 'First tool call',
              sourceField: 'thinking',
              signature: 'sig_first_call',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'tool_interrupted_1',
              name: 'read_file',
              parameters: { path: 'a.txt' },
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Actually, try something else' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Second tool call',
              sourceField: 'thinking',
              signature: 'sig_second_call',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'tool_success_2',
              name: 'read_file',
              parameters: { path: 'b.txt' },
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'tool_success_2',
              toolName: 'read_file',
              result: 'content of b.txt',
            } as ToolResponseBlock,
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Great, what did you find?' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      assertStrictAlternation(request.messages);

      const toolUseIndices: Array<{
        index: number;
        ids: string[];
      }> = [];
      for (let i = 0; i < request.messages.length; i++) {
        const msg = request.messages[i];
        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
          const ids = getToolUseIds(msg.content);
          if (ids.length > 0) {
            toolUseIndices.push({ index: i, ids });
          }
        }
      }

      for (const { index, ids } of toolUseIndices) {
        const nextMsg = request.messages[index + 1];
        expect(nextMsg).toBeDefined();
        expect(nextMsg.role).toBe('user');
        expect(Array.isArray(nextMsg.content)).toBe(true);

        const resultIds = getToolResultIds(
          nextMsg.content as AnthropicContentBlock[],
        );
        for (const id of ids) {
          expect(resultIds).toContain(id);
        }
      }

      const firstToolUse = toolUseIndices.find((t) =>
        t.ids.some((id) => id.includes('tool_interrupted_1')),
      );
      expect(firstToolUse).toBeDefined();
      const firstNextMsg = request.messages[firstToolUse!.index + 1];
      const firstToolResults = (
        firstNextMsg.content as AnthropicContentBlock[]
      ).filter((b) => b.type === 'tool_result') as Array<{
        type: 'tool_result';
        tool_use_id: string;
        content: unknown;
        is_error?: boolean;
      }>;
      const interruptedResult = firstToolResults.find((tr) =>
        tr.tool_use_id.includes('tool_interrupted_1'),
      );
      expect(interruptedResult).toBeDefined();
      expect(interruptedResult!.is_error).toBe(true);
      expect(interruptedResult!.content).toBe('[tool execution interrupted]');

      const secondToolUse = toolUseIndices.find((t) =>
        t.ids.some((id) => id.includes('tool_success_2')),
      );
      expect(secondToolUse).toBeDefined();
      const secondNextMsg = request.messages[secondToolUse!.index + 1];
      const secondToolResults = (
        secondNextMsg.content as AnthropicContentBlock[]
      ).filter((b) => b.type === 'tool_result') as Array<{
        type: 'tool_result';
        tool_use_id: string;
        content: unknown;
        is_error?: boolean;
      }>;
      const successResult = secondToolResults.find((tr) =>
        tr.tool_use_id.includes('tool_success_2'),
      );
      expect(successResult).toBeDefined();
      expect(successResult!.is_error).toBeUndefined();
    });

    it('should merge consecutive text-only user messages to maintain role alternation', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'First message' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Thinking about it',
              sourceField: 'thinking',
              signature: 'sig_consec_user',
            } as ThinkingBlock,
            { type: 'text', text: 'Let me think...' },
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Actually, do this instead' }],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'And also this' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Got updated instructions',
              sourceField: 'thinking',
              signature: 'sig_consec_response',
            } as ThinkingBlock,
            { type: 'text', text: 'Sure, doing both.' },
          ],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      assertStrictAlternation(request.messages);
    });

    it('should merge consecutive assistant messages to maintain role alternation', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Tell me something' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Here is part one.' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'And here is part two.' }],
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

      assertStrictAlternation(request.messages);
    });
  });
});
