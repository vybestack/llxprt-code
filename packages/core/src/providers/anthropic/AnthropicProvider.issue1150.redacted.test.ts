/**
 * Issue #1150: Anthropic API redacted_thinking Validation Tests
 *
 * These tests validate that the redacted_thinking blocks sent to Anthropic API
 * have correctly formatted `data` fields:
 *
 * 1. The `data` field must be the EXACT signature returned by Anthropic in previous responses
 * 2. The signature should NOT be re-encoded (it's already in the correct format)
 * 3. Synthesized/fake redacted_thinking blocks are NOT valid - Anthropic rejects them
 * 4. When stripFromContext is 'none', NO redacted_thinking should appear at all
 *
 * Error being fixed: "messages.X.content.0: Invalid `data` in `redacted_thinking` block"
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
import type { AnthropicRequestBody } from './test-utils/anthropicTestUtils.js';

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

describe('AnthropicProvider Issue #1150: redacted_thinking Data Validation', () => {
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
        runtimeId: 'anthropic.redacted.test',
        metadata: { source: 'AnthropicProvider.issue1150.redacted.test.ts' },
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

    // Default: Enable extended thinking with NO stripping
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
   * Helper to find all redacted_thinking blocks in a request
   */
  const findRedactedThinkingBlocks = (
    request: AnthropicRequestBody,
  ): Array<{ type: 'redacted_thinking'; data: string }> => {
    const blocks: Array<{ type: 'redacted_thinking'; data: string }> = [];
    for (const msg of request.messages) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'redacted_thinking') {
            blocks.push(block as { type: 'redacted_thinking'; data: string });
          }
        }
      }
    }
    return blocks;
  };

  /**
   * Helper to find all thinking blocks in a request
   */
  const findThinkingBlocks = (
    request: AnthropicRequestBody,
  ): Array<{ type: 'thinking'; thinking: string; signature: string }> => {
    const blocks: Array<{
      type: 'thinking';
      thinking: string;
      signature: string;
    }> = [];
    for (const msg of request.messages) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'thinking') {
            blocks.push(
              block as {
                type: 'thinking';
                thinking: string;
                signature: string;
              },
            );
          }
        }
      }
    }
    return blocks;
  };

  describe('Critical: stripFromContext=none should NEVER produce redacted_thinking', () => {
    /**
     * CRITICAL TEST: When stripFromContext is 'none', we should send full thinking blocks,
     * not redacted_thinking. The sonnetinclude profile has this setting and is failing.
     */
    it('should send full thinking blocks when stripFromContext is none', async () => {
      // stripFromContext: 'none' is already set in beforeEach
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      // Simulate a real Anthropic signature (these are opaque encrypted strings)
      const realAnthropicSignature =
        'EqoBCkYIAxgCIkAKHgoSdGhpbmtpbmdfY29udGVudBIIc2lnbmF0dXJlEiIKIHRoaW5raW5nX2NvbnRlbnRfc2lnbmF0dXJlX2tleQ==';

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
              thought: 'Let me think about this carefully...',
              sourceField: 'thinking',
              signature: realAnthropicSignature,
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'toolu_test_001',
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
              callId: 'toolu_test_001',
              toolName: 'list_directory',
              result: { files: ['a.txt'] },
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

      // With stripFromContext: 'none', there should be NO redacted_thinking
      const redactedBlocks = findRedactedThinkingBlocks(request);
      expect(redactedBlocks.length).toBe(0);

      // Should have full thinking blocks instead
      const thinkingBlocks = findThinkingBlocks(request);
      expect(thinkingBlocks.length).toBeGreaterThan(0);

      // Thinking block should have the full thought and signature
      const thinkingBlock = thinkingBlocks[0];
      expect(thinkingBlock.thinking).toBe(
        'Let me think about this carefully...',
      );
      expect(thinkingBlock.signature).toBe(realAnthropicSignature);
    });

    /**
     * Test with multiple turns - should never have redacted_thinking when strip is none
     */
    it('should never produce redacted_thinking across multiple turns when stripFromContext is none', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const sig1 = 'EqoBCkYIAxgCIkAKHgoSdGhpbmtpbmdfMRIIc2lnXzEyMzQ=';
      const sig2 = 'EqoBCkYIAxgCIkAKHgoSdGhpbmtpbmdfMhIIc2lnXzU2Nzg=';

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
              thought: 'First thought process',
              sourceField: 'thinking',
              signature: sig1,
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'toolu_turn1',
              name: 'tool1',
              parameters: {},
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'toolu_turn1',
              toolName: 'tool1',
              result: 'result1',
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
              thought: 'Second thought process',
              sourceField: 'thinking',
              signature: sig2,
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'toolu_turn2',
              name: 'tool2',
              parameters: {},
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'toolu_turn2',
              toolName: 'tool2',
              result: 'result2',
            } as ToolResponseBlock,
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Final question' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // NO redacted_thinking when strip is 'none'
      const redactedBlocks = findRedactedThinkingBlocks(request);
      expect(redactedBlocks.length).toBe(0);

      // Should have 2 full thinking blocks
      const thinkingBlocks = findThinkingBlocks(request);
      expect(thinkingBlocks.length).toBe(2);
    });
  });

  describe('Critical: redacted_thinking.data must be exact signature from Anthropic', () => {
    /**
     * When stripFromContext is 'allButLast', the data field must be the EXACT
     * signature that Anthropic returned - NOT re-encoded or modified.
     */
    it('should use exact signature as data field without re-encoding', async () => {
      settingsService.set('reasoning.stripFromContext', 'allButLast');

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      // This is what a real Anthropic signature looks like - opaque base64-ish string
      const realSignature =
        'EqoBCkYIAxgCIkAKHgoSdGhpbmtpbmdfY29udGVudBIIc2lnbmF0dXJlEiIKIHRoaW5raW5nX2NvbnRlbnRfc2lnbmF0dXJlX2tleQ==';
      const secondSignature = 'EqoBCkYIAxgCIkAKHgoSc2Vjb25kX3NpZw==';

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'First' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'First thinking - should be redacted',
              sourceField: 'thinking',
              signature: realSignature,
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'toolu_first',
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
              callId: 'toolu_first',
              toolName: 'tool',
              result: 'done',
            } as ToolResponseBlock,
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Second' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Second thinking - should be full',
              sourceField: 'thinking',
              signature: secondSignature,
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'toolu_second',
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
              callId: 'toolu_second',
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

      // First message should have redacted_thinking
      const redactedBlocks = findRedactedThinkingBlocks(request);
      expect(redactedBlocks.length).toBe(1);

      // CRITICAL: The data field must be the EXACT signature - not re-encoded
      // If we base64-encode the signature again, we get a different value
      const redacted = redactedBlocks[0];
      expect(redacted.data).toBe(realSignature);

      // Verify it's NOT double-encoded
      const doubleEncoded = Buffer.from(realSignature).toString('base64');
      expect(redacted.data).not.toBe(doubleEncoded);

      // Last message should have full thinking
      const thinkingBlocks = findThinkingBlocks(request);
      expect(thinkingBlocks.length).toBe(1);
      expect(thinkingBlocks[0].signature).toBe(secondSignature);
    });
  });

  describe('Critical: Cannot synthesize fake redacted_thinking', () => {
    /**
     * When there's no thinking in history but thinking is enabled,
     * we CANNOT create a fake redacted_thinking block.
     * Anthropic validates the signature cryptographically.
     */
    it('should NOT synthesize fake redacted_thinking when no thinking exists', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      // History has tool_call WITHOUT any thinking block
      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Do something' }],
        },
        {
          speaker: 'ai',
          blocks: [
            // NO thinking block - just tool_call
            { type: 'text', text: 'I will help you.' },
            {
              type: 'tool_call',
              id: 'toolu_no_think',
              name: 'action',
              parameters: {},
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'toolu_no_think',
              toolName: 'action',
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

      // Should NOT have any redacted_thinking (we can't fake it)
      const redactedBlocks = findRedactedThinkingBlocks(request);
      expect(redactedBlocks.length).toBe(0);

      // Should NOT have any thinking either (there wasn't any in history)
      const thinkingBlocks = findThinkingBlocks(request);
      expect(thinkingBlocks.length).toBe(0);
    });

    /**
     * Even with stripFromContext set, if no thinking exists, don't synthesize fake blocks
     */
    it('should not synthesize fake redacted_thinking even with stripFromContext enabled', async () => {
      settingsService.set('reasoning.stripFromContext', 'all');

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
            // Tool call without thinking
            {
              type: 'tool_call',
              id: 'toolu_no_think_strip',
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
              callId: 'toolu_no_think_strip',
              toolName: 'tool',
              result: 'result',
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

      // No fake redacted_thinking
      const redactedBlocks = findRedactedThinkingBlocks(request);
      expect(redactedBlocks.length).toBe(0);
    });
  });

  describe('Thinking blocks from non-Anthropic sources', () => {
    /**
     * Thinking blocks from Gemini (sourceField: 'thought') should not become
     * Anthropic thinking or redacted_thinking - they don't have valid signatures.
     */
    it('should not convert Gemini thoughts to Anthropic thinking blocks', async () => {
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
              thought: 'Gemini reasoning process',
              sourceField: 'thought', // NOT 'thinking' - this is Gemini
              // No signature - Gemini doesn't have signatures
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'toolu_gemini',
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
              callId: 'toolu_gemini',
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

      // No thinking or redacted_thinking (Gemini thoughts are not valid Anthropic thinking)
      const thinkingBlocks = findThinkingBlocks(request);
      const redactedBlocks = findRedactedThinkingBlocks(request);

      expect(thinkingBlocks.length).toBe(0);
      expect(redactedBlocks.length).toBe(0);
    });
  });
});
