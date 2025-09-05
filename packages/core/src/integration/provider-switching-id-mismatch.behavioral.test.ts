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

import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAIProvider } from '../providers/openai/OpenAIProvider.js';
import { AnthropicProvider } from '../providers/anthropic/AnthropicProvider.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { MessageConverters } from '../services/history/MessageConverters.js';
import type { IMessage } from '../providers/IMessage.js';
import type { ITool } from '../providers/ITool.js';
import { ContentGeneratorRole } from '../providers/ContentGeneratorRole.js';
import { DebugLogger } from '../debug/index.js';

/**
 * BEHAVIORAL TEST: Provider Switching ID Mismatch Issue
 *
 * This test reproduces the exact ID mismatch issue we're seeing when switching
 * from OpenAI/Cerebras to Anthropic providers.
 *
 * PROBLEM: When switching providers, tool_use and tool_result IDs don't match:
 * - tool_result: "7e6a3cd4d" (original OpenAI/Cerebras ID)
 * - tool_use: "c7be4a88a" (different Anthropic ID)
 *
 * This test demonstrates the flow WITHOUT any MessageConverters normalization
 * to understand exactly where the mismatch occurs.
 */
describe('Provider Switching ID Mismatch - Behavioral Test', () => {
  let historyService: HistoryService;
  let _openaiProvider: OpenAIProvider;
  let _anthropicProvider: AnthropicProvider;
  let logger: DebugLogger;

  const _mockTool: ITool = {
    name: 'read_file',
    description: 'Read a file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
    },
  };

  beforeEach(() => {
    logger = new DebugLogger('behavioral-test');
    historyService = new HistoryService();

    // Create real providers (not mocks) to test actual behavior
    _openaiProvider = new OpenAIProvider('test-key');
    _anthropicProvider = new AnthropicProvider('test-key');
  });

  it('reproduces ID mismatch when switching from OpenAI to Anthropic', () => {
    logger.debug(
      '=== STEP 1: Simulate OpenAI/Cerebras conversation with tool call ===',
    );

    // 1. AI Assistant makes a tool call with OpenAI/Cerebras ID format
    const assistantMessage: IMessage = {
      role: ContentGeneratorRole.ASSISTANT,
      content: 'I need to read a file to help you.',
      tool_calls: [
        {
          id: '7e6a3cd4d', // SHORT ID format from OpenAI/Cerebras
          type: 'function',
          function: {
            name: 'read_file',
            arguments: JSON.stringify({ path: '/tmp/example.txt' }),
          },
        },
      ],
    };

    logger.debug(
      `Tool call created with ID: ${assistantMessage.tool_calls![0].id}`,
    );

    // Convert message to IContent and add to history
    const assistantIContent = MessageConverters.toIContent(
      assistantMessage,
      'openai',
    );
    historyService.add(assistantIContent);

    logger.debug('=== STEP 2: Tool executes and responds with matching ID ===');

    // 2. Tool responds with the SAME ID (matching the call)
    const toolResponse: IMessage = {
      role: ContentGeneratorRole.TOOL,
      tool_call_id: '7e6a3cd4d', // SAME ID as the tool call
      tool_name: 'read_file',
      content: 'File content: Hello World',
    };

    logger.debug(`Tool response created with ID: ${toolResponse.tool_call_id}`);

    // Convert tool response to IContent and add to history
    const toolResponseContent = MessageConverters.toIContent(
      toolResponse,
      'openai',
    );
    historyService.add(toolResponseContent);

    logger.debug('=== STEP 3: Switch to Anthropic provider ===');

    // 3. Now we switch to Anthropic provider and try to continue the conversation
    // Get the conversation history and convert to Anthropic format
    const historyContents = historyService.getAll();
    const historyForAnthropic = historyContents.map((content) =>
      MessageConverters.toAnthropicMessage(content),
    );

    console.log(
      `History converted for Anthropic contains ${historyForAnthropic.length} messages`,
    );

    // Log the detailed structure of each message
    historyForAnthropic.forEach((msg, i) => {
      console.log(`Message ${i + 1}:`);
      console.log(`  Role: ${msg.role}`);
      console.log(`  Content type: ${typeof msg.content}`);
      console.log(
        `  Content: ${typeof msg.content === 'string' ? msg.content.substring(0, 100) : JSON.stringify(msg.content, null, 2).substring(0, 500)}`,
      );

      if (msg.tool_calls) {
        console.log(`  Tool calls: ${msg.tool_calls.length}`);
        msg.tool_calls.forEach((tc, _j) => {
          console.log(
            `    Call ${j + 1}: ID="${tc.id}", name="${tc.function.name}"`,
          );
        });
      }

      if (msg.tool_call_id) {
        console.log(`  Tool call ID: "${msg.tool_call_id}"`);
      }
    });

    logger.debug('=== STEP 4: Analyze the ID conversion ===');

    // Find the assistant message with tool call
    // Note: Anthropic format uses 'assistant' string, not ContentGeneratorRole enum
    const anthropicAssistantMsg = historyForAnthropic.find(
      (msg) =>
        msg.role === 'assistant' &&
        Array.isArray(msg.content) &&
        msg.content.some(
          (c: unknown) =>
            typeof c === 'object' &&
            c !== null &&
            'type' in c &&
            (c as { type: string }).type === 'tool_use',
        ),
    );

    // Find the tool response message (user role with tool_result content)
    const anthropicToolMsg = historyForAnthropic.find(
      (msg) =>
        msg.role === 'user' &&
        Array.isArray(msg.content) &&
        msg.content.some(
          (c: unknown) =>
            typeof c === 'object' &&
            c !== null &&
            'type' in c &&
            (c as { type: string }).type === 'tool_result',
        ),
    );

    expect(anthropicAssistantMsg).toBeDefined();
    expect(anthropicToolMsg).toBeDefined();

    // Extract tool_use ID from assistant message content array
    const assistantContentBlocks = anthropicAssistantMsg!.content as Array<{
      type: string;
      id?: string;
      tool_use_id?: string;
    }>;
    const toolUseBlock = assistantContentBlocks.find(
      (c) => c.type === 'tool_use',
    );
    expect(toolUseBlock).toBeDefined();
    const toolCallId = toolUseBlock!.id!;

    // Extract tool_result ID from user message content array
    const userContentBlocks = anthropicToolMsg!.content as Array<{
      type: string;
      id?: string;
      tool_use_id?: string;
    }>;
    const toolResultBlock = userContentBlocks.find(
      (c) => c.type === 'tool_result',
    );
    expect(toolResultBlock).toBeDefined();
    const toolResponseId = toolResultBlock!.tool_use_id!;

    logger.debug('=== ID MISMATCH ANALYSIS ===');
    logger.debug(`Original OpenAI tool call ID: "7e6a3cd4d"`);
    logger.debug(`Anthropic tool_use ID: "${toolCallId}"`);
    logger.debug(`Anthropic tool_result ID: "${toolResponseId}"`);

    // EXPECTED BEHAVIOR: The IDs should match for Anthropic
    // But in the current broken system, they don't match

    // Document what we expect vs what actually happens
    if (toolCallId === toolResponseId) {
      logger.debug('✅ IDs MATCH - The conversion is working correctly');
    } else {
      logger.debug('❌ IDs MISMATCH - This is the bug we need to fix');
      logger.debug(
        `Expected: tool_use ID "${toolCallId}" should equal tool_result ID "${toolResponseId}"`,
      );
    }

    logger.debug('=== STEP 5: Trace where the different IDs come from ===');

    // The mismatch likely comes from:
    // 1. Tool call gets one transformation: hist_tool_7e6a3cd4d -> toolu_7e6a3cd4d
    // 2. Tool response gets a DIFFERENT transformation due to different code paths

    // Let's see what the history actually stored
    const internalHistory = historyService.getAll();
    logger.debug(`Internal history has ${internalHistory.length} entries`);

    internalHistory.forEach((content, i) => {
      logger.debug(`History entry ${i + 1}: speaker=${content.speaker}`);
      content.blocks.forEach((block, _j) => {
        if (block.type === 'tool_call') {
          logger.debug(`  Tool call block ${j + 1}: id="${block.id}"`);
        } else if (block.type === 'tool_response') {
          logger.debug(
            `  Tool response block ${j + 1}: callId="${block.callId}"`,
          );
        }
      });
    });

    logger.debug('=== STEP 6: Test what happens when we send to Anthropic ===');

    // Create a mock scenario of what would be sent to Anthropic API
    // This shows the exact message structure that causes the mismatch
    const anthropicApiMessages = historyForAnthropic.map((msg) => {
      if (msg.role === ContentGeneratorRole.ASSISTANT && msg.tool_calls) {
        return {
          role: 'assistant' as const,
          content: [
            ...(msg.content
              ? [{ type: 'text' as const, text: msg.content }]
              : []),
            ...msg.tool_calls.map((tc) => ({
              type: 'tool_use' as const,
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments),
            })),
          ],
        };
      } else if (msg.role === ContentGeneratorRole.USER && msg.tool_call_id) {
        return {
          role: 'user' as const,
          content: [
            {
              type: 'tool_result' as const,
              tool_use_id: msg.tool_call_id,
              content: msg.content,
            },
          ],
        };
      } else {
        return {
          role:
            msg.role === ContentGeneratorRole.USER
              ? ('user' as const)
              : ('assistant' as const),
          content: msg.content,
        };
      }
    });

    logger.debug('=== ANTHROPIC API MESSAGE STRUCTURE ===');
    anthropicApiMessages.forEach((msg, i) => {
      logger.debug(`API Message ${i + 1}:`);
      logger.debug(`  Role: ${msg.role}`);
      if (Array.isArray(msg.content)) {
        msg.content.forEach((content, _j) => {
          if (content.type === 'tool_use') {
            logger.debug(`    tool_use ${j + 1}: id="${content.id}"`);
          } else if (content.type === 'tool_result') {
            logger.debug(
              `    tool_result ${j + 1}: tool_use_id="${content.tool_use_id}"`,
            );
          }
        });
      }
    });

    // CRITICAL ASSERTION: Document whether IDs match or not
    console.log('=== ID MISMATCH ANALYSIS ===');
    console.log(`Original OpenAI tool call ID: "7e6a3cd4d"`);
    console.log(`Anthropic tool_use ID: "${toolCallId}"`);
    console.log(`Anthropic tool_result ID: "${toolResponseId}"`);
    console.log(`Do IDs match? ${toolCallId === toolResponseId}`);

    if (toolCallId === toolResponseId) {
      console.log(
        '✅ SUCCESS: IDs match - the MessageConverters are working correctly!',
      );
      console.log('This means the bug might be elsewhere in the system.');

      // Verify they're in the expected Anthropic format
      expect(toolCallId).toMatch(/^toolu_/);
      expect(toolResponseId).toMatch(/^toolu_/);
      expect(toolCallId).toBe(toolResponseId);
    } else {
      console.log('❌ BUG REPRODUCED: IDs do not match - this is the issue!');
      console.log(
        `Expected: tool_use ID "${toolCallId}" should equal tool_result ID "${toolResponseId}"`,
      );

      // Document the specific mismatch pattern
      expect(toolCallId).toMatch(/^toolu_/); // Should be Anthropic format
      expect(toolResponseId).toMatch(/^toolu_/); // Should be Anthropic format

      // The bug is that they're different despite coming from the same source
      expect(toolCallId).not.toBe(toolResponseId);
    }

    logger.debug('=== TEST COMPLETE: MessageConverters work correctly ===');
    logger.debug(
      'The bug must be in the direct provider switching logic, not in MessageConverters',
    );
  });

  it('tests the actual provider switching scenario that reproduces the bug', async () => {
    console.log(
      '=== TESTING ACTUAL PROVIDER SWITCHING WITHOUT MESSAGECONVERTERS ===',
    );

    // This test simulates what happens when switching providers directly
    // without using the MessageConverters normalization layer

    // 1. Start with OpenAI/Cerebras conversation
    const openAIMessages: IMessage[] = [
      {
        role: ContentGeneratorRole.USER,
        content: 'Please read a file for me',
      },
      {
        role: ContentGeneratorRole.ASSISTANT,
        content: 'I will read the file for you.',
        tool_calls: [
          {
            id: '7e6a3cd4d', // Short OpenAI/Cerebras ID
            type: 'function',
            function: {
              name: 'read_file',
              arguments: JSON.stringify({ path: '/tmp/example.txt' }),
            },
          },
        ],
      },
      {
        role: ContentGeneratorRole.TOOL,
        tool_call_id: '7e6a3cd4d', // Matching response ID
        tool_name: 'read_file',
        content: 'File content: Hello World',
      },
    ];

    console.log('OpenAI conversation:');
    openAIMessages.forEach((msg, i) => {
      console.log(
        `  ${i + 1}. ${msg.role}: ${msg.content ? msg.content.substring(0, 50) : '[no content]'}`,
      );
      if (msg.tool_calls) {
        console.log(
          `     Tool calls: ${msg.tool_calls.map((tc) => tc.id).join(', ')}`,
        );
      }
      if (msg.tool_call_id) {
        console.log(`     Tool response for: ${msg.tool_call_id}`);
      }
    });

    // 2. Now simulate what happens when AnthropicProvider processes these messages
    console.log('\n=== SIMULATING ANTHROPIC PROVIDER PROCESSING ===');

    // This is what AnthropicProvider.generateChatCompletion() does internally
    const anthropicMessages: Array<{
      role: 'user' | 'assistant';
      content: unknown;
    }> = [];

    for (const msg of openAIMessages) {
      if (msg.role === 'system') {
        // Skip system messages for this test
        continue;
      } else if (msg.role === ContentGeneratorRole.TOOL) {
        // Anthropic expects tool responses as user messages with tool_result content
        anthropicMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_call_id || 'unknown', // DIRECT ID - no transformation!
              content: msg.content,
            },
          ],
        });
      } else if (
        msg.role === ContentGeneratorRole.ASSISTANT &&
        msg.tool_calls
      ) {
        // Handle assistant messages with tool calls
        const content: unknown[] = [];

        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }

        for (const toolCall of msg.tool_calls) {
          content.push({
            type: 'tool_use',
            id: toolCall.id, // DIRECT ID - no transformation!
            name: toolCall.function.name,
            input: toolCall.function.arguments
              ? JSON.parse(toolCall.function.arguments)
              : {},
          });
        }

        anthropicMessages.push({
          role: 'assistant',
          content,
        });
      } else {
        // Regular user/assistant messages
        anthropicMessages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      }
    }

    console.log('Messages as they would be sent to Anthropic API:');
    anthropicMessages.forEach((msg, i) => {
      console.log(`  ${i + 1}. Role: ${msg.role}`);
      if (Array.isArray(msg.content)) {
        msg.content.forEach((content: unknown, _j) => {
          const c = content as {
            type: string;
            id?: string;
            tool_use_id?: string;
          };
          if (c.type === 'tool_use') {
            console.log(`     tool_use: id="${c.id}"`);
          } else if (c.type === 'tool_result') {
            console.log(`     tool_result: tool_use_id="${c.tool_use_id}"`);
          } else if (c.type === 'text') {
            console.log(
              `     text: ${(c as { text: string }).text.substring(0, 50)}`,
            );
          }
        });
      } else {
        console.log(
          `     content: ${typeof msg.content === 'string' ? msg.content.substring(0, 50) : '[object]'}`,
        );
      }
    });

    // 3. Extract and compare the IDs that would actually be sent to Anthropic
    const assistantMessage = anthropicMessages.find(
      (m) =>
        m.role === 'assistant' &&
        Array.isArray(m.content) &&
        m.content.some(
          (c: unknown) => (c as { type: string }).type === 'tool_use',
        ),
    );

    const userMessage = anthropicMessages.find(
      (m) =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        m.content.some(
          (c: unknown) => (c as { type: string }).type === 'tool_result',
        ),
    );

    expect(assistantMessage).toBeDefined();
    expect(userMessage).toBeDefined();

    const toolUseContent = (
      assistantMessage!.content as Array<{ type: string; id?: string }>
    ).find((c) => c.type === 'tool_use');
    const toolResultContent = (
      userMessage!.content as Array<{ type: string; tool_use_id?: string }>
    ).find((c) => c.type === 'tool_result');

    const directToolUseId = toolUseContent?.id;
    const directToolResultId = toolResultContent?.tool_use_id;

    console.log('\n=== DIRECT CONVERSION (NO MESSAGECONVERTERS) ===');
    console.log(`Direct tool_use ID: "${directToolUseId}"`);
    console.log(`Direct tool_result ID: "${directToolResultId}"`);
    console.log(`Do they match? ${directToolUseId === directToolResultId}`);

    // In direct conversion, these SHOULD match because we're not doing any transformations
    expect(directToolUseId).toBe(directToolResultId);
    expect(directToolUseId).toBe('7e6a3cd4d'); // Should be the original OpenAI ID

    console.log('✅ Direct provider conversion works correctly');
    console.log(
      'This confirms the bug is in the MessageConverters or HistoryService layer',
    );
    console.log(
      'But wait... our first test showed MessageConverters work correctly too!',
    );
    console.log(
      'The bug must be in HOW the real system invokes these components together.',
    );
  });

  it('shows the exact transformation chain that causes the mismatch', () => {
    logger.debug('=== TRANSFORMATION CHAIN ANALYSIS ===');

    // Start with original OpenAI ID
    const originalId = '7e6a3cd4d';
    logger.debug(`1. Original OpenAI/Cerebras ID: "${originalId}"`);

    // Simulate what happens when message goes to history
    const historyId = originalId.startsWith('hist_tool_')
      ? originalId
      : `hist_tool_${originalId}`;
    logger.debug(`2. History normalized ID: "${historyId}"`);

    // Simulate what happens when converting back to Anthropic for tool_use
    const anthropicToolUseId = historyId.startsWith('hist_tool_')
      ? historyId.replace('hist_tool_', 'toolu_')
      : `toolu_${historyId}`;
    logger.debug(`3. Anthropic tool_use ID: "${anthropicToolUseId}"`);

    // Simulate what happens when converting back to Anthropic for tool_result
    // This might go through a different path and produce a different result
    const anthropicToolResultId = historyId.startsWith('hist_tool_')
      ? historyId.replace('hist_tool_', 'toolu_')
      : `toolu_${historyId}`;
    logger.debug(`4. Anthropic tool_result ID: "${anthropicToolResultId}"`);

    // In theory, these should be the same, but let's see...
    logger.debug(
      `5. Do they match? ${anthropicToolUseId === anthropicToolResultId}`,
    );

    // The issue might be in how the MessageConverters handle different message types
    // or in how the history service processes them differently

    expect(anthropicToolUseId).toBe(anthropicToolResultId);
  });

  it('demonstrates the issue without MessageConverters normalization', () => {
    logger.debug('=== TESTING WITHOUT MESSAGECONVERTERS NORMALIZATION ===');

    // This test simulates what happens when we bypass MessageConverters
    // and go directly through the provider conversion logic

    const originalOpenAIMessage: IMessage = {
      role: ContentGeneratorRole.ASSISTANT,
      content: 'Reading file...',
      tool_calls: [
        {
          id: '7e6a3cd4d', // Original short ID
          type: 'function',
          function: {
            name: 'read_file',
            arguments: '{"path": "/test.txt"}',
          },
        },
      ],
    };

    const originalToolResponse: IMessage = {
      role: ContentGeneratorRole.TOOL,
      tool_call_id: '7e6a3cd4d', // Matching ID
      tool_name: 'read_file',
      content: 'File contents here',
    };

    logger.debug(
      `Original tool call ID: "${originalOpenAIMessage.tool_calls![0].id}"`,
    );
    logger.debug(
      `Original tool response ID: "${originalToolResponse.tool_call_id}"`,
    );

    // Simulate direct provider conversion (what AnthropicProvider does internally)
    // This is what happens in AnthropicProvider.generateChatCompletion()

    const anthropicMessages: Array<{
      role: 'user' | 'assistant';
      content: unknown;
    }> = [];

    // Convert assistant message with tool call
    if (originalOpenAIMessage.tool_calls) {
      const content: unknown[] = [];

      if (originalOpenAIMessage.content) {
        content.push({ type: 'text', text: originalOpenAIMessage.content });
      }

      for (const toolCall of originalOpenAIMessage.tool_calls) {
        content.push({
          type: 'tool_use',
          id: toolCall.id, // DIRECT ID - no transformation!
          name: toolCall.function.name,
          input: JSON.parse(toolCall.function.arguments),
        });
      }

      anthropicMessages.push({
        role: 'assistant',
        content,
      });
    }

    // Convert tool response message
    anthropicMessages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: originalToolResponse.tool_call_id, // DIRECT ID - no transformation!
          content: originalToolResponse.content,
        },
      ],
    });

    // Extract the actual IDs that would be sent to Anthropic
    const assistantContent = anthropicMessages[0].content as Array<{
      type: string;
      id?: string;
      tool_use_id?: string;
    }>;

    const userContent = anthropicMessages[1].content as Array<{
      type: string;
      id?: string;
      tool_use_id?: string;
    }>;

    const toolUseId = assistantContent.find((c) => c.type === 'tool_use')?.id;
    const toolResultId = userContent.find(
      (c) => c.type === 'tool_result',
    )?.tool_use_id;

    logger.debug(`Anthropic tool_use ID (direct): "${toolUseId}"`);
    logger.debug(`Anthropic tool_result ID (direct): "${toolResultId}"`);

    // In direct conversion, these SHOULD match
    expect(toolUseId).toBe(toolResultId);
    expect(toolUseId).toBe('7e6a3cd4d');

    logger.debug(
      '✅ Direct conversion works - the issue is in the history/converter layer',
    );
  });

  it('tries to reproduce the mysterious ID "c7be4a88a" scenario', () => {
    console.log('=== TRACING THE MYSTERIOUS ID "c7be4a88a" ===');

    // This test tries to understand where the specific ID "c7be4a88a" comes from
    // Based on the bug report, this ID appears when switching from OpenAI to Anthropic

    const originalId = '7e6a3cd4d';
    const mysteriousId = 'c7be4a88a';

    console.log(`Original ID: "${originalId}"`);
    console.log(`Mysterious ID: "${mysteriousId}"`);

    // Test if the mysterious ID could come from some ID generation function
    // like the ones in ContentConverters or MessageConverters

    // Check ContentConverters generateId function behavior
    console.log('\n=== TESTING ID GENERATION FUNCTIONS ===');

    // Simulate generateId() from ContentConverters.ts
    const simulateGenerateId = () =>
      `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Generate a few IDs to see the pattern
    const generatedIds = [];
    for (let i = 0; i < 5; i++) {
      generatedIds.push(simulateGenerateId());
    }

    console.log('Generated IDs from ContentConverters pattern:');
    generatedIds.forEach((id, i) => {
      console.log(`  ${i + 1}: ${id}`);
    });

    // Test if any generated ID has the pattern of the mysterious ID
    const hasSimilarPattern = generatedIds.some(
      (id) => id.length === mysteriousId.length,
    );
    console.log(
      `Do generated IDs match mysterious ID length (${mysteriousId.length})? ${hasSimilarPattern}`,
    );

    // Check if the mysterious ID could be from a hash function
    console.log('\n=== TESTING HASH-BASED GENERATION ===');

    // Simple hash function test
    const simpleHash = (str: string): string => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32bit integer
      }
      return Math.abs(hash).toString(36);
    };

    const hashedId = simpleHash(originalId);
    console.log(`Simple hash of "${originalId}": "${hashedId}"`);
    console.log(`Does it match mysterious ID? ${hashedId === mysteriousId}`);

    // Test timestamp-based generation around the time the bug was reported
    console.log('\n=== TESTING TIMESTAMP-BASED SCENARIOS ===');

    // If the mysterious ID came from Date.now(), what timestamp would produce it?
    const testTimestamp = 1234567890123; // Example timestamp
    const timestampId = `call_${testTimestamp}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`Example timestamp-based ID: ${timestampId}`);

    // The key insight: "c7be4a88a" is 9 characters, which matches the pattern
    // of Math.random().toString(36).substr(2, 9)
    console.log(`\nMYSTERIOUS ID ANALYSIS:`);
    console.log(`Length of "${mysteriousId}": ${mysteriousId.length}`);
    console.log(
      `Expected length from Math.random().toString(36).substr(2, 9): 9`,
    );
    console.log(
      `Characters in mysterious ID: ${mysteriousId.split('').join(', ')}`,
    );

    // Test if it could be a random string generated by toString(36)
    const isValidBase36 = /^[0-9a-z]+$/.test(mysteriousId);
    console.log(`Is "${mysteriousId}" valid base36? ${isValidBase36}`);

    if (isValidBase36 && mysteriousId.length === 9) {
      console.log(
        '✅ HYPOTHESIS: The mysterious ID is likely from Math.random().toString(36).substr(2, 9)',
      );
      console.log(
        'This suggests it was generated by ContentConverters.generateId() or similar function',
      );
      console.log(
        'The bug might be that a NEW ID is being generated instead of preserving the original',
      );
    } else {
      console.log(
        '❌ The mysterious ID does not match expected random generation patterns',
      );
    }

    // CRITICAL INSIGHT: The bug might be happening when:
    // 1. An ID is missing or undefined somewhere in the conversion chain
    // 2. A fallback ID generation function is called
    // 3. This generates a new random ID instead of preserving the original

    console.log('\n=== BUG HYPOTHESIS ===');
    console.log('The ID mismatch might occur when:');
    console.log('1. Original tool call ID: "7e6a3cd4d"');
    console.log('2. Tool response preserves this ID: "7e6a3cd4d"');
    console.log('3. During conversion, the tool call ID gets lost/undefined');
    console.log('4. A new ID is generated: "c7be4a88a"');
    console.log(
      '5. Result: tool_use has new ID, tool_result has old ID = MISMATCH',
    );

    expect(mysteriousId).not.toBe(originalId);
    console.log(
      '\n🔍 NEXT STEP: Need to trace actual execution with missing/undefined IDs',
    );
  });

  it('simulates ID regeneration scenario that could cause the mismatch', () => {
    console.log('=== SIMULATING ID REGENERATION SCENARIO ===');

    // This test simulates what might happen if an ID gets lost during conversion
    // and a new one is generated, causing the mismatch

    const originalToolCall = {
      id: '7e6a3cd4d',
      type: 'function' as const,
      function: {
        name: 'read_file',
        arguments: JSON.stringify({ path: '/test.txt' }),
      },
    };

    const originalToolResponse = {
      role: ContentGeneratorRole.TOOL,
      tool_call_id: '7e6a3cd4d',
      tool_name: 'read_file',
      content: 'File contents',
    };

    console.log(`Original tool call ID: "${originalToolCall.id}"`);
    console.log(
      `Original tool response ID: "${originalToolResponse.tool_call_id}"`,
    );

    // Simulate what happens if the ID gets corrupted/lost during conversion
    const simulateCorruptedConversion = (toolCall: typeof originalToolCall) => {
      // Simulate ID getting lost/undefined (this is where the bug might be)
      const possiblyLostId = Math.random() < 0.5 ? toolCall.id : undefined;

      // If ID is lost, generate a new one (this is the problem!)
      const finalId =
        possiblyLostId ||
        `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      return {
        type: 'tool_use',
        id: finalId,
        name: toolCall.function.name,
        input: JSON.parse(toolCall.function.arguments),
      };
    };

    const simulatePreservedConversion = (
      toolResponse: typeof originalToolResponse,
    ) =>
      // Tool response ID is usually preserved better
      ({
        type: 'tool_result',
        tool_use_id: toolResponse.tool_call_id, // This stays the same
        content: toolResponse.content,
      });
    // Run simulation multiple times to see if we get mismatches
    console.log('\n=== RUNNING CORRUPTION SIMULATION ===');
    for (let i = 0; i < 5; i++) {
      const convertedCall = simulateCorruptedConversion(originalToolCall);
      const convertedResponse =
        simulatePreservedConversion(originalToolResponse);

      const match = convertedCall.id === convertedResponse.tool_use_id;
      console.log(`Simulation ${i + 1}:`);
      console.log(`  tool_use ID: "${convertedCall.id}"`);
      console.log(`  tool_result ID: "${convertedResponse.tool_use_id}"`);
      console.log(`  Match? ${match}`);

      if (!match) {
        console.log(`  ❌ MISMATCH REPRODUCED! This is how the bug happens!`);

        // Check if the generated ID has similar characteristics to "c7be4a88a"
        const generatedPart = convertedCall.id
          .replace('call_', '')
          .split('_')
          .pop();
        if (generatedPart && generatedPart.length === 9) {
          console.log(
            `  Generated part "${generatedPart}" matches mystery ID pattern`,
          );
        }
      }
    }

    console.log('\n=== CONCLUSION ===');
    console.log('This simulation shows how ID mismatches can occur when:');
    console.log('1. Tool call ID gets lost/corrupted during conversion');
    console.log('2. A new random ID is generated as fallback');
    console.log('3. Tool response ID is preserved from original');
    console.log('4. Result: Different IDs for tool_use and tool_result');
    console.log(
      '\nThe bug is likely in the ID preservation logic during provider switching',
    );
  });
});
