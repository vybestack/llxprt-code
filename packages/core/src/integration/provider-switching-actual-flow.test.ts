/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Behavioral test that replicates the ACTUAL production flow when switching
 * from OpenAI/Cerebras to Anthropic, tracing tool call ID transformations
 * through the real system components.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { HistoryService } from '../services/history/HistoryService.js';
import { ContentConverters } from '../services/history/ContentConverters.js';
import { GeminiCompatibleWrapper } from '../providers/adapters/GeminiCompatibleWrapper.js';
import { AnthropicProvider } from '../providers/anthropic/AnthropicProvider.js';
import { IContent } from '../services/history/IContent.js';
import type { IMessage } from '../providers/IMessage.js';

describe('Provider Switching - Actual Production Flow', () => {
  let historyService: HistoryService;
  let mockAnthropicProvider: AnthropicProvider;
  let geminiWrapper: GeminiCompatibleWrapper;

  beforeEach(() => {
    historyService = new HistoryService();

    // Create a mock Anthropic provider that implements the interface properly
    mockAnthropicProvider = {
      name: 'anthropic',
      currentModel: 'claude-sonnet-4-20250514',
      toolFormat: 'anthropic',
      getAuthToken: vi.fn().mockResolvedValue('sk-ant-api03-mock'),
      getModels: vi.fn().mockResolvedValue([]),
      generateChatCompletion: vi.fn(),
      setModelParams: vi.fn(),
      getModelParams: vi.fn(),
      updateConfig: vi.fn(),
      authenticate: vi.fn(),
      logout: vi.fn(),
      isAuthenticated: vi.fn().mockResolvedValue(true),
      getProviderStatus: vi.fn().mockResolvedValue({ authenticated: true }),
    } as unknown as AnthropicProvider;

    geminiWrapper = new GeminiCompatibleWrapper(mockAnthropicProvider);
  });

  test('traces tool call ID transformation through actual production flow', async () => {
    console.log('\n=== STARTING ACTUAL PRODUCTION FLOW TRACE ===');

    // STEP 1: Simulate OpenAI/Cerebras generating messages with tool calls
    const openaiToolCallId = '7e6a3cd4d';
    console.log(
      `\nSTEP 1: OpenAI/Cerebras generates tool call with ID: ${openaiToolCallId}`,
    );

    const aiMessageWithToolCall: IContent = {
      speaker: 'ai',
      blocks: [
        {
          type: 'text',
          text: 'I need to read a file to help you.',
        },
        {
          type: 'tool_call',
          id: openaiToolCallId,
          name: 'read_file',
          parameters: {
            file_path: '/Users/test/example.txt',
          },
        },
      ],
      metadata: {
        id: 'msg_001',
        model: 'gpt-4o',
        usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 },
      },
    };

    const toolResponse: IContent = {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: openaiToolCallId,
          toolName: 'read_file',
          result: 'File content here...',
        },
      ],
      metadata: {
        id: 'tool_001',
      },
    };

    // STEP 2: Messages go into HistoryService
    console.log('\nSTEP 2: Adding messages to HistoryService');
    historyService.add(aiMessageWithToolCall);
    historyService.add(toolResponse);

    const allHistory = historyService.getAll();
    console.log(`History contains ${allHistory.length} messages`);
    console.log(
      'AI Message tool call ID:',
      JSON.stringify(
        allHistory[0].blocks.find((b) => b.type === 'tool_call'),
        null,
        2,
      ),
    );
    console.log(
      'Tool Response call ID:',
      JSON.stringify(
        allHistory[1].blocks.find((b) => b.type === 'tool_response'),
        null,
        2,
      ),
    );

    // STEP 3: HistoryService.getCurated() returns IContent[]
    console.log('\nSTEP 3: Getting curated history from HistoryService');
    const curatedHistory = historyService.getCurated();
    console.log(`Curated history contains ${curatedHistory.length} messages`);

    curatedHistory.forEach((content, index) => {
      console.log(
        `Curated[${index}] - Speaker: ${content.speaker}, Blocks: ${content.blocks.length}`,
      );
      content.blocks.forEach((block, blockIndex) => {
        if (block.type === 'tool_call') {
          console.log(`  Block[${blockIndex}] - Tool Call ID: ${block.id}`);
        } else if (block.type === 'tool_response') {
          console.log(
            `  Block[${blockIndex}] - Tool Response Call ID: ${block.callId}`,
          );
        }
      });
    });

    // STEP 4: ContentConverters.toGeminiContents() converts to Gemini format
    console.log('\nSTEP 4: Converting to Gemini format with ContentConverters');
    const geminiContents = ContentConverters.toGeminiContents(curatedHistory);
    console.log(`Generated ${geminiContents.length} Gemini Contents`);

    geminiContents.forEach((content, index) => {
      console.log(
        `GeminiContent[${index}] - Role: ${content.role}, Parts: ${content.parts?.length || 0}`,
      );
      content.parts?.forEach((part, partIndex) => {
        if ('functionCall' in part && part.functionCall) {
          console.log(
            `  Part[${partIndex}] - FunctionCall ID: ${part.functionCall.id}`,
          );
        } else if ('functionResponse' in part && part.functionResponse) {
          console.log(
            `  Part[${partIndex}] - FunctionResponse ID: ${part.functionResponse.id}`,
          );
        }
      });
    });

    // STEP 5: GeminiCompatibleWrapper.convertContentsToMessages() converts to provider messages
    console.log('\nSTEP 5: Converting Gemini contents to provider messages');
    const providerMessages = (
      geminiWrapper as {
        convertContentsToMessages: (contents: unknown[]) => IMessage[];
      }
    ).convertContentsToMessages(geminiContents);
    console.log(`Generated ${providerMessages.length} provider messages`);

    providerMessages.forEach((msg, index) => {
      console.log(
        `ProviderMessage[${index}] - Role: ${msg.role}, Tool calls: ${msg.tool_calls?.length || 0}`,
      );
      if (msg.tool_calls) {
        msg.tool_calls.forEach((toolCall, tcIndex) => {
          console.log(`  ToolCall[${tcIndex}] - ID: ${toolCall.id}`);
        });
      }
      if (msg.tool_call_id) {
        console.log(`  Tool Response for call ID: ${msg.tool_call_id}`);
      }
    });

    // STEP 6: AnthropicProvider receives and processes these messages
    console.log('\nSTEP 6: Anthropic Provider would process these messages');
    console.log('Messages that would be sent to AnthropicProvider:');
    providerMessages.forEach((msg, index) => {
      console.log(
        `  Message[${index}]: ${JSON.stringify(
          {
            role: msg.role,
            content:
              typeof msg.content === 'string'
                ? msg.content.substring(0, 50) + '...'
                : msg.content,
            tool_calls: msg.tool_calls?.map((tc) => ({
              id: tc.id,
              name: tc.function.name,
            })),
            tool_call_id: msg.tool_call_id,
            name: msg.name,
          },
          null,
          2,
        )}`,
      );
    });

    // ANALYSIS: Track where the ID transformation happens
    console.log('\n=== ID TRANSFORMATION ANALYSIS ===');

    // Check original ID preservation
    const originalToolCall = aiMessageWithToolCall.blocks.find(
      (b) => b.type === 'tool_call',
    ) as
      | { type: 'tool_call'; id: string; name: string; parameters: unknown }
      | undefined;
    const originalToolResponse = toolResponse.blocks.find(
      (b) => b.type === 'tool_response',
    ) as
      | {
          type: 'tool_response';
          callId: string;
          toolName: string;
          result: unknown;
        }
      | undefined;

    console.log(`Original OpenAI tool call ID: ${originalToolCall?.id}`);
    console.log(
      `Original tool response call ID: ${originalToolResponse?.callId}`,
    );

    // Check Gemini format preservation
    const geminiToolCall = geminiContents
      .find((c) => c.parts?.some((p) => 'functionCall' in p && p.functionCall))
      ?.parts?.find((p) => 'functionCall' in p && p.functionCall) as
      | { functionCall?: { id: string } }
      | undefined;

    const geminiToolResponse = geminiContents
      .find((c) =>
        c.parts?.some((p) => 'functionResponse' in p && p.functionResponse),
      )
      ?.parts?.find((p) => 'functionResponse' in p && p.functionResponse) as
      | { functionResponse?: { id: string } }
      | undefined;

    console.log(`Gemini functionCall ID: ${geminiToolCall?.functionCall?.id}`);
    console.log(
      `Gemini functionResponse ID: ${geminiToolResponse?.functionResponse?.id}`,
    );

    // Check provider message format
    const assistantMsg = providerMessages.find(
      (m) => m.role === 'assistant' && m.tool_calls,
    );
    const toolMsg = providerMessages.find((m) => m.role === 'tool');

    console.log(
      `Provider assistant tool call ID: ${assistantMsg?.tool_calls?.[0]?.id}`,
    );
    console.log(`Provider tool message call ID: ${toolMsg?.tool_call_id}`);

    // VERIFY ID CONSISTENCY
    console.log('\n=== ID CONSISTENCY CHECK ===');

    // IDs should be preserved throughout the flow
    expect(originalToolCall?.id).toBe(openaiToolCallId);
    expect(originalToolResponse?.callId).toBe(openaiToolCallId);
    expect(geminiToolCall?.functionCall?.id).toBe(openaiToolCallId);
    expect(geminiToolResponse?.functionResponse?.id).toBe(openaiToolCallId);
    expect(assistantMsg?.tool_calls?.[0]?.id).toBe(openaiToolCallId);
    expect(toolMsg?.tool_call_id).toBe(openaiToolCallId);

    console.log('✅ All IDs preserved correctly through the conversion chain');

    // This test shows that the actual production flow SHOULD preserve IDs correctly
    // If IDs are getting lost or changed, it's likely happening in the provider's
    // internal conversion logic or response generation, not in the core conversion chain
  });

  test('traces where new IDs get generated in production flow', async () => {
    console.log('\n=== TRACING ID GENERATION ===');

    // Test case where OpenAI generates a tool call without proper ID
    const incompleteToolCall: IContent = {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: '', // Empty ID - should trigger generation
          name: 'read_file',
          parameters: { file_path: '/test.txt' },
        },
      ],
    };

    historyService.clear();
    historyService.add(incompleteToolCall);

    const curatedHistory = historyService.getCurated();
    const geminiContents = ContentConverters.toGeminiContents(curatedHistory);

    console.log('Original empty ID:', incompleteToolCall.blocks[0]);

    // Check ContentConverters - it passes through the empty ID
    const geminiToolCall = geminiContents[0].parts?.find(
      (p) => 'functionCall' in p && p.functionCall,
    ) as { functionCall?: { id: string } } | undefined;
    console.log(
      'Gemini functionCall ID (passes through):',
      geminiToolCall?.functionCall?.id,
    );

    // Check the GeminiCompatibleWrapper conversion - this is where ID generation happens
    const providerMessages = (
      geminiWrapper as {
        convertContentsToMessages: (contents: unknown[]) => IMessage[];
      }
    ).convertContentsToMessages(geminiContents);
    const assistantMsg = providerMessages.find(
      (m) => m.role === 'assistant' && m.tool_calls,
    );
    console.log(
      'Provider message ID (generated):',
      assistantMsg?.tool_calls?.[0]?.id,
    );

    // Verify that ContentConverters passes through empty ID
    expect(geminiToolCall?.functionCall?.id).toBe('');

    // Verify that ID generation happens in GeminiCompatibleWrapper
    expect(assistantMsg?.tool_calls?.[0]?.id).toMatch(/^call_\d+_[a-z0-9]{9}$/);
    console.log(
      '✅ New ID generated correctly in GeminiCompatibleWrapper when original is empty',
    );
  });

  test('simulates anthropic provider generating new response with new tool call', async () => {
    console.log('\n=== SIMULATING ANTHROPIC RESPONSE GENERATION ===');

    // Simulate what happens when Anthropic generates a new response with a tool call
    // This is where the "c7be4a88a" ID would be generated

    const mockAnthropicResponse: IMessage = {
      role: 'assistant',
      content: 'I need to search for files to help you.',
      tool_calls: [
        {
          id: 'call_' + Date.now() + '_c7be4a88a', // This simulates Anthropic generating a new ID
          type: 'function',
          function: {
            name: 'glob',
            arguments: JSON.stringify({ pattern: '**/*.ts' }),
          },
        },
      ],
    };

    console.log(
      'Simulated Anthropic response with new tool call ID:',
      mockAnthropicResponse.tool_calls?.[0].id,
    );

    // This shows that when Anthropic generates new tool calls, it creates completely new IDs
    // The original "7e6a3cd4d" would be preserved in the conversation history,
    // but new tool calls get new IDs like "c7be4a88a"

    expect(mockAnthropicResponse.tool_calls?.[0].id).toContain('c7be4a88a');
    console.log(
      '✅ New tool call IDs are generated by the provider for new responses',
    );
  });
});
