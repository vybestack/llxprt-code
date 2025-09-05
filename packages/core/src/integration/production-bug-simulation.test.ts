import { describe, it, expect, vi } from 'vitest';
import { GeminiCompatibleWrapper } from '../providers/adapters/GeminiCompatibleWrapper.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { ContentConverters } from '../services/history/ContentConverters.js';
import type { IProvider } from '../providers/IProvider.js';
import type { IMessage } from '../providers/IMessage.js';

describe('PRODUCTION BUG: Provider Switching with Tool Calls', () => {
  it('🔥 MUST handle real production scenario: Qwen -> Anthropic switch with orphaned tool response', () => {
    // This simulates the EXACT scenario from the production error log
    const historyService = new HistoryService();

    // Step 1: User was using Qwen (Cerebras) and made a tool call with SHORT ID
    const qwenToolCall: IMessage = {
      role: 'assistant',
      tool_calls: [
        {
          id: 'ad9c11ef9', // SHORT ID from Qwen/Cerebras
          type: 'function',
          function: {
            name: 'glob',
            arguments: JSON.stringify({ pattern: '**/*.ts' }),
          },
        },
      ],
    };

    // Add to history (this should normalize to hist_tool_ad9c11ef9)
    historyService.addMessage(qwenToolCall, 'openai'); // Qwen uses OpenAI format

    // Step 2: Tool response with error (SHORT ID)
    const toolResponse: IMessage = {
      role: 'tool',
      tool_call_id: 'ad9c11ef9',
      name: 'glob',
      content: JSON.stringify({
        error: "params must have required property 'pattern'",
      }),
    };

    historyService.addMessage(toolResponse, 'openai');

    // Step 3: AI acknowledges error and tries to correct
    const aiResponse: IMessage = {
      role: 'assistant',
      content:
        'Let me correct my approach and examine the codebase structure more systematically.',
    };

    historyService.addMessage(aiResponse, 'openai');

    // Step 4: User switches to Anthropic
    // This is where the bug happens - we need to convert history to Anthropic format

    // Get history as IContent
    const history = historyService.getAll();

    // Convert to Gemini format (as geminiChat.ts does)
    const geminiContents = ContentConverters.toGeminiContents(history);

    // Now simulate GeminiCompatibleWrapper converting for Anthropic
    const mockAnthropicProvider: IProvider = {
      name: 'anthropic',
      generateChatCompletion: vi.fn().mockImplementation(async function* () {
        yield {
          role: 'assistant',
          content: [{ type: 'text', text: 'response' }],
        };
      }),
      registerServerTools: vi.fn(),
    };

    const wrapper = new GeminiCompatibleWrapper(mockAnthropicProvider);

    // This is what happens when the wrapper processes the history
    const anthropicMessages = (
      wrapper as {
        convertContentsToMessages: (contents: unknown[]) => Array<{
          role: 'user' | 'assistant';
          content: Array<
            | { type: 'text'; text: string }
            | { type: 'tool_use'; id: string; name: string; input: unknown }
            | { type: 'tool_result'; tool_use_id: string; content: string }
          >;
        }>;
      }
    ).convertContentsToMessages(geminiContents);

    // Verify the messages are in correct Anthropic format
    expect(anthropicMessages).toHaveLength(3);

    // First message: tool call (assistant)
    const toolCallMsg = anthropicMessages[0];
    expect(toolCallMsg.role).toBe('assistant');
    expect(toolCallMsg.content).toBeInstanceOf(Array);
    const toolUse = (
      toolCallMsg.content as Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: unknown }
        | { type: 'tool_result'; tool_use_id: string; content: string }
      >
    ).find((c) => c.type === 'tool_use');
    expect(toolUse).toBeDefined();
    expect(toolUse.id).toMatch(/^toolu_/);
    expect(toolUse.id).toBe('toolu_ad9c11ef9'); // Should be normalized

    // Second message: tool response (user role for Anthropic)
    const toolResponseMsg = anthropicMessages[1];
    expect(toolResponseMsg.role).toBe('user');
    expect(toolResponseMsg.content).toBeInstanceOf(Array);
    const toolResult = (
      toolResponseMsg.content as Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: unknown }
        | { type: 'tool_result'; tool_use_id: string; content: string }
      >
    ).find((c) => c.type === 'tool_result');
    expect(toolResult).toBeDefined();
    expect(toolResult.tool_use_id).toBe('toolu_ad9c11ef9'); // Must match tool_use.id

    // Third message: assistant text
    const textMsg = anthropicMessages[2];
    expect(textMsg.role).toBe('assistant');
    expect(textMsg.content).toBeInstanceOf(Array);
    const textContent = (
      textMsg.content as Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: unknown }
        | { type: 'tool_result'; tool_use_id: string; content: string }
      >
    ).find((c) => c.type === 'text');
    expect(textContent).toBeDefined();
    expect(textContent.text).toContain('correct my approach');

    // The key assertion: NO orphaned tool responses
    // Every tool_result must have a matching tool_use
    const allToolResults = anthropicMessages.flatMap((msg) =>
      msg.content && Array.isArray(msg.content)
        ? msg.content.filter((c) => c.type === 'tool_result')
        : [],
    );

    const allToolUses = anthropicMessages.flatMap((msg) =>
      msg.content && Array.isArray(msg.content)
        ? msg.content.filter((c) => c.type === 'tool_use')
        : [],
    );

    // Every tool_result must have a matching tool_use
    for (const toolResult of allToolResults) {
      const matchingToolUse = allToolUses.find(
        (tu) =>
          'id' in tu &&
          'tool_use_id' in toolResult &&
          tu.id === toolResult.tool_use_id,
      );
      expect(matchingToolUse).toBeDefined();
      expect(matchingToolUse.id).toBe(toolResult.tool_use_id);
    }
  });

  it('🔥 MUST NOT send Gemini format (functionResponse) to Anthropic', () => {
    // This test ensures we never send Gemini's functionResponse format to Anthropic
    const historyService = new HistoryService();

    // Add a tool call and response
    historyService.addMessage(
      {
        role: 'assistant',
        tool_calls: [
          {
            id: 'test_id',
            type: 'function',
            function: { name: 'test_tool', arguments: '{}' },
          },
        ],
      },
      'openai',
    );

    historyService.addMessage(
      {
        role: 'tool',
        tool_call_id: 'test_id',
        name: 'test_tool',
        content: 'test result',
      },
      'openai',
    );

    // Get history and convert to Gemini format
    const history = historyService.getAll();
    const geminiContents = ContentConverters.toGeminiContents(history);

    // Mock Anthropic provider
    const mockAnthropicProvider: IProvider = {
      name: 'anthropic',
      generateChatCompletion: vi.fn(),
      registerServerTools: vi.fn(),
    };

    const wrapper = new GeminiCompatibleWrapper(mockAnthropicProvider);
    const anthropicMessages = (
      wrapper as {
        convertContentsToMessages: (contents: unknown[]) => Array<{
          role: 'user' | 'assistant';
          content: Array<
            | { type: 'text'; text: string }
            | { type: 'tool_use'; id: string; name: string; input: unknown }
            | { type: 'tool_result'; tool_use_id: string; content: string }
          >;
        }>;
      }
    ).convertContentsToMessages(geminiContents);

    // Verify NO Gemini format leaks through
    for (const msg of anthropicMessages) {
      // Check that we never have functionResponse (Gemini format)
      if (msg.content && Array.isArray(msg.content)) {
        for (const content of msg.content) {
          expect(content).not.toHaveProperty('functionResponse');
          expect(content).not.toHaveProperty('functionCall');
        }
      }

      // Check message-level fields
      expect(msg).not.toHaveProperty('parts'); // Gemini-specific
      expect(msg).not.toHaveProperty('functionResponse'); // Gemini-specific
    }

    // Verify correct Anthropic format
    const toolResponseMsg = anthropicMessages.find(
      (m) =>
        m.content &&
        Array.isArray(m.content) &&
        m.content.some((c) => c.type === 'tool_result'),
    );

    expect(toolResponseMsg).toBeDefined();
    expect(toolResponseMsg!.role).toBe('user'); // Anthropic uses 'user' for tool results

    const toolResult = (
      toolResponseMsg!.content as Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: unknown }
        | { type: 'tool_result'; tool_use_id: string; content: string }
      >
    ).find((c) => c.type === 'tool_result')!;
    expect(toolResult.type).toBe('tool_result');
    expect(toolResult.tool_use_id).toMatch(/^toolu_/);
  });
});
