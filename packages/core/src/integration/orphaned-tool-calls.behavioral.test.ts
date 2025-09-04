/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryService } from '../services/history/HistoryService.js';
import { OpenAIProvider } from '../providers/openai/OpenAIProvider.js';
import type { IContent, ToolCallBlock } from '../services/history/IContent.js';
import { DebugLogger } from '../debug/index.js';

// Enable debug logging for this test
const debugLogger = new DebugLogger('test:orphaned-tools');

describe('Orphaned Tool Calls Behavioral Test', () => {
  let historyService: HistoryService;
  let openAIProvider: OpenAIProvider;

  beforeEach(() => {
    historyService = new HistoryService();
    openAIProvider = new OpenAIProvider();

    // Set a valid API key and base URL (for testing)
    openAIProvider.setApiKey('test-api-key');
    openAIProvider.setBaseUrl('https://api.openai.com/v1');
  });

  it('should handle orphaned tool calls when user cancels tool execution', async () => {
    debugLogger.debug('Starting orphaned tool call test');

    // Step 1: Add initial user message
    const userMessage: IContent = {
      speaker: 'human',
      blocks: [
        {
          type: 'text',
          text: 'Please write a file with some content',
        },
      ],
    };
    historyService.add(userMessage, 'gpt-4o-mini');

    // Step 2: Add AI response with tool call (simulating what happens in real flow)
    const toolCallId = historyService.generateHistoryId(); // Generate hist_tool_* ID
    const aiResponseWithToolCall: IContent = {
      speaker: 'ai',
      blocks: [
        {
          type: 'text',
          text: "I'll write that file for you.",
        },
        {
          type: 'tool_call',
          id: toolCallId,
          name: 'write_file',
          parameters: {
            path: '/tmp/test.txt',
            content: 'Hello, world!',
          },
        } as ToolCallBlock,
      ],
    };
    historyService.add(aiResponseWithToolCall, 'gpt-4o-mini');

    // Step 3: Simulate user cancellation (ESC key)
    // In real flow, this would prevent the tool response from being created
    // So we intentionally DON'T add a tool response here
    debugLogger.debug(
      'User cancelled tool execution - no tool response created',
    );

    // Step 4: User sends another message
    const followUpMessage: IContent = {
      speaker: 'human',
      blocks: [
        {
          type: 'text',
          text: 'Never mind, just tell me a joke instead',
        },
      ],
    };
    historyService.add(followUpMessage, 'gpt-4o-mini');

    // Step 5: Verify we have an orphaned tool call
    const unmatchedCalls = historyService.findUnmatchedToolCalls();
    expect(unmatchedCalls).toHaveLength(1);
    expect(unmatchedCalls[0].id).toBe(toolCallId);
    debugLogger.debug(`Found orphaned tool call: ${toolCallId}`);

    // Step 6: Get curated history and attempt to send to OpenAI
    const curatedHistory = historyService.getCurated();

    // Step 7: Try to generate a response using OpenAI provider
    // This SHOULD work if synthetic responses are properly added
    // Currently this will FAIL with the OpenAI API error about missing tool responses

    let errorOccurred = false;
    let errorMessage = '';

    try {
      // Create a mock tool declaration for the API call
      const tools = [
        {
          functionDeclarations: [
            {
              name: 'write_file',
              description: 'Write content to a file',
              parameters: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                  content: { type: 'string' },
                },
                required: ['path', 'content'],
              },
            },
          ],
        },
      ];

      // Attempt to generate completion with orphaned tool call in history
      const generator = openAIProvider.generateChatCompletionIContent(
        curatedHistory,
        tools,
      );

      // Try to consume the generator
      for await (const _chunk of generator) {
        // If we get here, synthetic responses were properly added
        break; // Just need to test that it doesn't throw
      }
    } catch (error) {
      errorOccurred = true;
      errorMessage = error instanceof Error ? error.message : String(error);
      debugLogger.debug(`Error occurred as expected: ${errorMessage}`);
    }

    // CURRENT BEHAVIOR: This test FAILS because OpenAI rejects orphaned tool calls
    // EXPECTED BEHAVIOR: After fix, this should pass (synthetic responses auto-added)

    // This assertion documents the CURRENT broken behavior
    // After implementing the fix, change this to expect(errorOccurred).toBe(false)
    expect(errorOccurred).toBe(true);
    expect(errorMessage).toContain('tool_call_id');
    expect(errorMessage).toContain('hist_tool_'); // The ID format that shouldn't be sent to OpenAI

    // Additional assertions to verify the fix when implemented:
    // After fix, we should be able to verify that:
    // 1. Synthetic responses were added automatically
    // 2. IDs were transformed properly (hist_tool_* → call_*)
    // 3. OpenAI API accepts the request without error
  });

  it('should handle multiple orphaned tool calls from interrupted execution', async () => {
    debugLogger.debug('Starting multiple orphaned tool calls test');

    // Add user message
    historyService.add(
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Create three files' }],
      },
      'gpt-4o-mini',
    );

    // Add AI response with multiple tool calls
    const toolCallIds = [
      historyService.generateHistoryId(),
      historyService.generateHistoryId(),
      historyService.generateHistoryId(),
    ];

    historyService.add(
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: "I'll create three files for you." },
          {
            type: 'tool_call',
            id: toolCallIds[0],
            name: 'write_file',
            parameters: { path: '/tmp/file1.txt', content: 'Content 1' },
          } as ToolCallBlock,
          {
            type: 'tool_call',
            id: toolCallIds[1],
            name: 'write_file',
            parameters: { path: '/tmp/file2.txt', content: 'Content 2' },
          } as ToolCallBlock,
          {
            type: 'tool_call',
            id: toolCallIds[2],
            name: 'write_file',
            parameters: { path: '/tmp/file3.txt', content: 'Content 3' },
          } as ToolCallBlock,
        ],
      },
      'gpt-4o-mini',
    );

    // Add response for only the first tool call (simulating partial execution before cancellation)
    historyService.add(
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: toolCallIds[0],
            toolName: 'write_file',
            result: { success: true },
          },
        ],
      },
      'gpt-4o-mini',
    );

    // User cancelled before the other two could execute
    debugLogger.debug('User cancelled - 2 out of 3 tool calls are orphaned');

    // Verify we have exactly 2 orphaned tool calls
    const unmatchedCalls = historyService.findUnmatchedToolCalls();
    expect(unmatchedCalls).toHaveLength(2);
    expect(unmatchedCalls.map((c) => c.id)).toEqual([
      toolCallIds[1],
      toolCallIds[2],
    ]);

    // Add a follow-up message
    historyService.add(
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'What files did you create?' }],
      },
      'gpt-4o-mini',
    );

    // Get curated history - should include synthetic responses for orphaned calls
    const curatedHistory = historyService.getCurated();

    // Currently this would fail with OpenAI
    // After fix, synthetic responses should be added for toolCallIds[1] and toolCallIds[2]

    // Count tool responses in curated history
    let toolResponseCount = 0;
    for (const content of curatedHistory) {
      if (content.speaker === 'tool') {
        toolResponseCount++;
      }
    }

    // CURRENT: Only 1 tool response (the completed one)
    // EXPECTED AFTER FIX: 3 tool responses (1 real + 2 synthetic)
    expect(toolResponseCount).toBe(1); // Change to 3 after implementing fix
  });

  it('should properly transform IDs when sending to OpenAI provider', async () => {
    debugLogger.debug('Testing ID transformation for OpenAI');

    // Create a simple history with tool call and response
    const histToolId = 'hist_tool_test_123';

    historyService.add(
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Test message' }],
      },
      'gpt-4o-mini',
    );

    historyService.add(
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'Using tool' },
          {
            type: 'tool_call',
            id: histToolId,
            name: 'test_tool',
            parameters: {},
          } as ToolCallBlock,
        ],
      },
      'gpt-4o-mini',
    );

    historyService.add(
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: histToolId,
            toolName: 'test_tool',
            result: { data: 'test' },
          },
        ],
      },
      'gpt-4o-mini',
    );

    const curatedHistory = historyService.getCurated();

    // Spy on the actual API call to check ID format
    // This is a simplified test - in reality we'd need to mock the fetch call
    // and inspect the request body to verify IDs are transformed

    // CURRENT BEHAVIOR: hist_tool_* IDs are sent directly to OpenAI
    // EXPECTED BEHAVIOR: IDs should be transformed to call_* format

    // For now, just verify the history contains our hist_tool ID
    const aiContent = curatedHistory.find((c) => c.speaker === 'ai');
    const toolCall = aiContent?.blocks.find((b) => b.type === 'tool_call') as
      | ToolCallBlock
      | undefined;
    expect(toolCall?.id).toBe(histToolId);

    // After fix, we'd verify that OpenAIProvider transforms this to 'call_test_123'
  });
});
