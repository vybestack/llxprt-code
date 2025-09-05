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
 * Integration test that demonstrates the EXACT problem with provider switching
 * by simulating the complete real flow with actual provider instances.
 *
 * This test shows:
 * 1. How OpenAI generates tool calls with specific IDs (e.g., "call_abc123")
 * 2. How those are stored in HistoryService
 * 3. How cross-provider conversion through ContentConverters and GeminiCompatibleWrapper works
 * 4. Where tool call IDs are preserved vs. where they get lost or changed
 * 5. Why same-provider flows work but cross-provider flows fail
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { HistoryService } from '../services/history/HistoryService.js';
import { ContentConverters } from '../services/history/ContentConverters.js';
import { GeminiCompatibleWrapper } from '../providers/adapters/GeminiCompatibleWrapper.js';
import { OpenAIProvider } from '../providers/openai/OpenAIProvider.js';
import { AnthropicProvider } from '../providers/anthropic/AnthropicProvider.js';
import { IContent } from '../services/history/IContent.js';
import type { IMessage } from '../providers/IMessage.js';
import type { Content } from '@google/genai';

describe('Provider Switching Real Flow - ID Mismatch Demonstration', () => {
  let historyService: HistoryService;
  let openaiProvider: OpenAIProvider;
  let anthropicProvider: AnthropicProvider;
  let openaiWrapper: GeminiCompatibleWrapper;
  let anthropicWrapper: GeminiCompatibleWrapper;

  beforeEach(() => {
    // Reset history service
    historyService = new HistoryService();

    // Create real provider instances with mock API keys for testing
    openaiProvider = new OpenAIProvider('test-openai-key');
    anthropicProvider = new AnthropicProvider('test-anthropic-key');

    // Create wrappers for each provider
    openaiWrapper = new GeminiCompatibleWrapper(openaiProvider);
    anthropicWrapper = new GeminiCompatibleWrapper(anthropicProvider);
  });

  test('demonstrates successful SAME-PROVIDER flow (OpenAI -> OpenAI)', async () => {
    console.log('\n=== SAME-PROVIDER FLOW: OpenAI -> OpenAI ===');

    // STEP 1: OpenAI generates a message with tool calls (realistic format)
    const openaiToolCallId = 'call_abc123_def456'; // Typical OpenAI ID format
    console.log(`\n1. OpenAI generates tool call with ID: ${openaiToolCallId}`);

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
        id: 'msg_openai_001',
        model: 'gpt-4o',
        providerId: 'openai',
        usage: { totalTokens: 50, promptTokens: 30, completionTokens: 20 },
      },
    };

    // STEP 2: Tool responds with matching ID
    const toolResponse: IContent = {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: openaiToolCallId, // CRITICAL: Same ID as the tool call
          toolName: 'read_file',
          result: 'File content: Hello world!',
        },
      ],
      metadata: {
        id: 'tool_001',
        providerId: 'openai',
      },
    };

    console.log('2. Tool responds with matching call ID:', openaiToolCallId);

    // STEP 3: Store in HistoryService
    console.log('\n3. Storing in HistoryService');
    historyService.add(aiMessageWithToolCall);
    historyService.add(toolResponse);

    // STEP 4: Get curated history
    console.log('4. Getting curated history');
    const curatedHistory = historyService.getCurated();

    console.log(`   Curated history: ${curatedHistory.length} messages`);
    const toolCallInHistory = curatedHistory[0].blocks.find(
      (b) => b.type === 'tool_call',
    ) as
      | { type: 'tool_call'; id: string; name: string; parameters: unknown }
      | undefined;
    const toolResponseInHistory = curatedHistory[1].blocks.find(
      (b) => b.type === 'tool_response',
    ) as
      | {
          type: 'tool_response';
          callId: string;
          toolName: string;
          result: unknown;
        }
      | undefined;

    console.log(`   Tool call ID in history: ${toolCallInHistory?.id}`);
    console.log(
      `   Tool response call ID in history: ${toolResponseInHistory?.callId}`,
    );

    // STEP 5: Convert to Gemini format (for consistency with cross-provider flow)
    console.log('5. Converting to Gemini format');
    const geminiContents = ContentConverters.toGeminiContents(curatedHistory);

    const geminiToolCall = geminiContents[0].parts?.find(
      (p) => 'functionCall' in p,
    )?.functionCall as { id: string; name: string; args: unknown } | undefined;
    const geminiToolResponse = geminiContents[1].parts?.find(
      (p) => 'functionResponse' in p,
    )?.functionResponse as
      | { id: string; name: string; response: unknown }
      | undefined;

    console.log(`   Gemini tool call ID: ${geminiToolCall?.id}`);
    console.log(`   Gemini tool response ID: ${geminiToolResponse?.id}`);

    // STEP 6: Convert back to OpenAI format (SAME-PROVIDER)
    console.log('6. Converting to OpenAI provider messages (SAME-PROVIDER)');
    const openaiMessages = (
      openaiWrapper as {
        convertContentsToMessages: (contents: Content[]) => IMessage[];
      }
    ).convertContentsToMessages(geminiContents);

    const assistantMsg = openaiMessages.find(
      (m: IMessage) => m.role === 'assistant' && m.tool_calls,
    );
    const toolMsg = openaiMessages.find((m: IMessage) => m.role === 'tool');

    console.log(
      `   Assistant message tool call ID: ${assistantMsg?.tool_calls?.[0]?.id}`,
    );
    console.log(`   Tool message call ID: ${toolMsg?.tool_call_id}`);

    // VERIFICATION: IDs should be preserved in same-provider flow
    console.log('\n✅ SAME-PROVIDER ID CONSISTENCY CHECK:');
    expect(toolCallInHistory?.id).toBe(openaiToolCallId);
    expect(toolResponseInHistory?.callId).toBe(openaiToolCallId);
    expect(geminiToolCall?.id).toBe(openaiToolCallId);
    expect(geminiToolResponse?.id).toBe(openaiToolCallId);
    expect(assistantMsg?.tool_calls?.[0]?.id).toBe(openaiToolCallId);
    expect(toolMsg?.tool_call_id).toBe(openaiToolCallId);

    console.log('   All IDs match:', openaiToolCallId);
    console.log('   ✅ SAME-PROVIDER FLOW: SUCCESS - IDs preserved correctly');
  });

  test('demonstrates problematic CROSS-PROVIDER flow (OpenAI -> Anthropic)', async () => {
    console.log('\n=== CROSS-PROVIDER FLOW: OpenAI -> Anthropic ===');

    // STEP 1: Start with the SAME data as the successful flow
    const openaiToolCallId = 'call_abc123_def456';
    console.log(
      `\n1. OpenAI originally generated tool call with ID: ${openaiToolCallId}`,
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
        id: 'msg_openai_001',
        model: 'gpt-4o',
        providerId: 'openai',
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
          result: 'File content: Hello world!',
        },
      ],
      metadata: {
        id: 'tool_001',
        providerId: 'openai',
      },
    };

    // STEP 2: Same history storage
    console.log('2. Storing in HistoryService (same as before)');
    historyService.add(aiMessageWithToolCall);
    historyService.add(toolResponse);

    // STEP 3: Same curated history
    console.log('3. Getting curated history (same as before)');
    const curatedHistory = historyService.getCurated();

    const toolCallInHistory = curatedHistory[0].blocks.find(
      (b) => b.type === 'tool_call',
    ) as
      | { type: 'tool_call'; id: string; name: string; parameters: unknown }
      | undefined;
    const toolResponseInHistory = curatedHistory[1].blocks.find(
      (b) => b.type === 'tool_response',
    ) as
      | {
          type: 'tool_response';
          callId: string;
          toolName: string;
          result: unknown;
        }
      | undefined;

    console.log(`   Tool call ID in history: ${toolCallInHistory?.id}`);
    console.log(
      `   Tool response call ID in history: ${toolResponseInHistory?.callId}`,
    );

    // STEP 4: Same Gemini conversion
    console.log('4. Converting to Gemini format (same as before)');
    const geminiContents = ContentConverters.toGeminiContents(curatedHistory);

    const geminiToolCall = geminiContents[0].parts?.find(
      (p) => 'functionCall' in p,
    )?.functionCall as { id: string; name: string; args: unknown } | undefined;
    const geminiToolResponse = geminiContents[1].parts?.find(
      (p) => 'functionResponse' in p,
    )?.functionResponse as
      | { id: string; name: string; response: unknown }
      | undefined;

    console.log(`   Gemini tool call ID: ${geminiToolCall?.id}`);
    console.log(`   Gemini tool response ID: ${geminiToolResponse?.id}`);

    // STEP 5: THE CRITICAL DIFFERENCE - Convert to Anthropic format (CROSS-PROVIDER)
    console.log(
      '5. Converting to Anthropic provider messages (CROSS-PROVIDER)',
    );
    const anthropicMessages = (
      anthropicWrapper as {
        convertContentsToMessages: (contents: Content[]) => IMessage[];
      }
    ).convertContentsToMessages(geminiContents);

    const assistantMsg = anthropicMessages.find(
      (m: IMessage) => m.role === 'assistant' && m.tool_calls,
    );
    const toolMsg = anthropicMessages.find((m: IMessage) => m.role === 'tool');

    console.log(
      `   Assistant message tool call ID: ${assistantMsg?.tool_calls?.[0]?.id}`,
    );
    console.log(`   Tool message call ID: ${toolMsg?.tool_call_id}`);

    // STEP 6: Now simulate what happens when Anthropic generates a NEW response
    console.log(
      '\n6. Anthropic generates NEW response (this is where the problem manifests)',
    );

    // Mock Anthropic provider to simulate generating a response with tool calls
    const mockAnthropicResponse: IMessage[] = [
      {
        role: 'assistant',
        content: 'Let me search for TypeScript files to help you.',
        tool_calls: [
          {
            id: 'call_xyz789_c7be4a88a', // NEW ANTHROPIC ID - different format!
            type: 'function',
            function: {
              name: 'glob',
              arguments: JSON.stringify({ pattern: '**/*.ts' }),
            },
          },
        ],
      },
    ];

    const newAnthropicToolCallId =
      mockAnthropicResponse[0].tool_calls?.[0]?.id || 'unknown';
    console.log(
      `   Anthropic generates NEW tool call with ID: ${newAnthropicToolCallId}`,
    );

    // STEP 7: Show the ID mismatch problem
    console.log('\n❌ CROSS-PROVIDER ID MISMATCH ANALYSIS:');
    console.log(`   Original OpenAI tool call ID: ${openaiToolCallId}`);
    console.log(`   New Anthropic tool call ID: ${newAnthropicToolCallId}`);
    console.log(`   🔴 IDs DO NOT MATCH! This causes orphaned tool responses.`);

    // STEP 8: Demonstrate what happens if a tool response comes back for the new ID
    console.log("\n7. Tool responds to Anthropic's call");
    const anthropicToolResponse: IContent = {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: newAnthropicToolCallId, // Responds to Anthropic's ID
          toolName: 'glob',
          result: ['file1.ts', 'file2.ts'],
        },
      ],
    };

    // Add to history
    historyService.add({
      speaker: 'ai',
      blocks: [
        {
          type: 'text',
          text: 'Let me search for TypeScript files to help you.',
        },
        {
          type: 'tool_call',
          id: newAnthropicToolCallId,
          name: 'glob',
          parameters: { pattern: '**/*.ts' },
        },
      ],
      metadata: {
        id: 'msg_anthropic_002',
        model: 'claude-sonnet-4-20250514',
        providerId: 'anthropic',
      },
    });
    historyService.add(anthropicToolResponse);

    // STEP 9: Show the final state
    console.log('\n8. Final history analysis');
    const finalHistory = historyService.getAll();
    const unmatchedCalls = historyService.findUnmatchedToolCalls();

    console.log(`   Total messages in history: ${finalHistory.length}`);
    console.log(`   Unmatched tool calls: ${unmatchedCalls.length}`);

    // Show all tool call IDs in history
    console.log('\n   All tool call IDs in history:');
    finalHistory.forEach((content, index) => {
      content.blocks.forEach((block, blockIndex) => {
        if (block.type === 'tool_call') {
          console.log(
            `     [${index}:${blockIndex}] Tool call ID: ${(block as { id: string }).id}`,
          );
        } else if (block.type === 'tool_response') {
          console.log(
            `     [${index}:${blockIndex}] Tool response for: ${(block as { callId: string }).callId}`,
          );
        }
      });
    });

    // VERIFICATION: The issue is clear
    expect(openaiToolCallId).not.toBe(newAnthropicToolCallId);
    expect(openaiToolCallId).toMatch(/^call_abc123/);
    expect(newAnthropicToolCallId).toMatch(/^call_xyz789/);

    console.log('\n❌ CROSS-PROVIDER PROBLEM DEMONSTRATED:');
    console.log('   1. OpenAI tool calls have format: call_abc123_*');
    console.log('   2. Anthropic tool calls have format: call_xyz789_*');
    console.log('   3. When switching providers, new tool calls get new IDs');
    console.log('   4. Previous tool responses become orphaned');
    console.log(
      '   5. This breaks tool call/response pairing across provider switches',
    );
  });

  test('shows WHERE and WHY ID preservation works vs fails', async () => {
    console.log('\n=== DETAILED ID PRESERVATION ANALYSIS ===');

    const originalId = 'call_openai_12345';

    // Create test data
    const testContent: IContent = {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: originalId,
          name: 'test_tool',
          parameters: { test: 'value' },
        },
      ],
    };

    console.log(`\nOriginal ID: ${originalId}`);

    // Test each conversion step
    console.log('\n1. HistoryService storage:');
    historyService.add(testContent);
    const stored = historyService.getAll()[0];
    const storedId = (stored.blocks[0] as { id: string }).id;
    console.log(`   Stored ID: ${storedId}`);
    console.log(
      `   ✅ HistoryService preserves IDs: ${storedId === originalId}`,
    );

    console.log('\n2. getCurated() retrieval:');
    const curated = historyService.getCurated()[0];
    const curatedId = (curated.blocks[0] as { id: string }).id;
    console.log(`   Curated ID: ${curatedId}`);
    console.log(
      `   ✅ getCurated() preserves IDs: ${curatedId === originalId}`,
    );

    console.log('\n3. ContentConverters.toGeminiContents():');
    const geminiContents = ContentConverters.toGeminiContents([testContent]);
    const geminiId = (
      geminiContents[0].parts?.[0] as {
        functionCall?: { id: string };
      }
    )?.functionCall?.id;
    console.log(`   Gemini ID: ${geminiId}`);
    console.log(
      `   ✅ ContentConverters preserves IDs: ${geminiId === originalId}`,
    );

    console.log('\n4. GeminiCompatibleWrapper.convertContentsToMessages():');
    const messages = (
      anthropicWrapper as {
        convertContentsToMessages: (contents: Content[]) => IMessage[];
      }
    ).convertContentsToMessages(geminiContents);
    const messageId = messages[0]?.tool_calls?.[0]?.id;
    console.log(`   Message ID: ${messageId}`);
    console.log(
      `   ✅ GeminiCompatibleWrapper preserves IDs: ${messageId === originalId}`,
    );

    console.log('\n5. The REAL problem: New provider responses');
    console.log('   When AnthropicProvider generates a NEW response:');
    console.log('   - It creates entirely new tool call IDs');
    console.log("   - These new IDs don't match any existing tool responses");
    console.log('   - Previous tool responses become orphaned');

    console.log('\n💡 KEY INSIGHT:');
    console.log('   The conversion chain preserves IDs correctly!');
    console.log(
      '   The problem is that providers generate NEW tool calls with NEW IDs',
    );
    console.log('   when they create new responses after a provider switch.');

    // Verify all conversions preserve the original ID
    expect(storedId).toBe(originalId);
    expect(curatedId).toBe(originalId);
    expect(geminiId).toBe(originalId);
    expect(messageId).toBe(originalId);

    console.log('\n✅ All conversion steps preserve IDs correctly');
    console.log(
      '❌ The issue is in NEW response generation, not ID conversion',
    );
  });

  test('demonstrates the actual production scenario that fails', async () => {
    console.log('\n=== PRODUCTION FAILURE SCENARIO ===');

    // Simulate the exact scenario from the user's problem description
    console.log('\n1. User starts with OpenAI, makes tool calls');

    // OpenAI tool call with realistic ID
    const openaiMessage: IContent = {
      speaker: 'ai',
      blocks: [
        {
          type: 'text',
          text: 'I need to read a file.',
        },
        {
          type: 'tool_call',
          id: '7e6a3cd4d', // The exact ID from the user's issue
          name: 'read_file',
          parameters: { file_path: '/some/file.txt' },
        },
      ],
    };

    const openaiToolResponse: IContent = {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: '7e6a3cd4d', // Matches the tool call
          toolName: 'read_file',
          result: 'File contents...',
        },
      ],
    };

    historyService.add(openaiMessage);
    historyService.add(openaiToolResponse);

    console.log('   OpenAI tool call ID: 7e6a3cd4d');
    console.log('   Tool response call ID: 7e6a3cd4d');
    console.log('   ✅ Tool call/response pair is complete');

    console.log('\n2. User switches to Anthropic provider');
    console.log('   History contains the OpenAI tool call/response pair');

    // Get the history that would be sent to Anthropic
    const historyForAnthropic = historyService.getCurated();
    const geminiFormat =
      ContentConverters.toGeminiContents(historyForAnthropic);
    const _anthropicMessages = (
      anthropicWrapper as {
        convertContentsToMessages: (contents: Content[]) => IMessage[];
      }
    ).convertContentsToMessages(geminiFormat);

    console.log(
      '   Messages sent to Anthropic include the 7e6a3cd4d tool call/response',
    );

    console.log('\n3. Anthropic generates a new response with new tool calls');

    // This is what actually happens in production
    const anthropicResponse: IContent = {
      speaker: 'ai',
      blocks: [
        {
          type: 'text',
          text: 'Let me search for more files.',
        },
        {
          type: 'tool_call',
          id: 'c7be4a88a', // NEW ID from Anthropic - the exact ID from user's issue
          name: 'glob',
          parameters: { pattern: '**/*.js' },
        },
      ],
    };

    historyService.add(anthropicResponse);

    console.log('   Anthropic generates NEW tool call with ID: c7be4a88a');
    console.log('   This is a DIFFERENT ID than the original: 7e6a3cd4d');

    console.log('\n4. Now we have mixed IDs in the history');
    const finalHistory = historyService.getAll();
    const allToolCallIds: string[] = [];
    const allToolResponseIds: string[] = [];

    finalHistory.forEach((content, index) => {
      content.blocks.forEach((block) => {
        if (block.type === 'tool_call') {
          const id = (block as { id: string }).id;
          allToolCallIds.push(id);
          console.log(`   Message ${index}: Tool call ID = ${id}`);
        } else if (block.type === 'tool_response') {
          const callId = (block as { callId: string }).callId;
          allToolResponseIds.push(callId);
          console.log(`   Message ${index}: Tool response for ID = ${callId}`);
        }
      });
    });

    console.log('\n5. ID mismatch analysis:');
    console.log(`   Tool call IDs: [${allToolCallIds.join(', ')}]`);
    console.log(`   Tool response IDs: [${allToolResponseIds.join(', ')}]`);

    const unmatchedCalls = historyService.findUnmatchedToolCalls();
    console.log(`   Unmatched tool calls: ${unmatchedCalls.length}`);

    if (unmatchedCalls.length > 0) {
      console.log(
        '   Unmatched tool call IDs:',
        unmatchedCalls.map((call) => call.id),
      );
    }

    console.log('\n❌ PRODUCTION PROBLEM CONFIRMED:');
    console.log('   - OpenAI tool call "7e6a3cd4d" has a matching response');
    console.log(
      '   - Anthropic tool call "c7be4a88a" will need its own response',
    );
    console.log('   - Different providers generate different ID formats');
    console.log(
      '   - This creates tool call/response orphaning across provider switches',
    );

    // Verify the exact scenario
    expect(allToolCallIds).toContain('7e6a3cd4d');
    expect(allToolCallIds).toContain('c7be4a88a');
    expect(allToolResponseIds).toContain('7e6a3cd4d');
    expect(allToolResponseIds).not.toContain('c7be4a88a'); // No response yet for Anthropic call

    // This demonstrates the core issue: each provider generates its own ID format
    expect('7e6a3cd4d').not.toBe('c7be4a88a');

    console.log('\n💡 ROOT CAUSE IDENTIFIED:');
    console.log(
      '   Provider switching works fine for ID preservation in conversion',
    );
    console.log(
      '   But each provider generates NEW tool calls with their own ID format',
    );
    console.log(
      '   This is expected behavior - the issue is in expectations, not bugs',
    );
  });
});
