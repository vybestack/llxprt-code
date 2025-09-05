/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HistoryService } from '../services/history/HistoryService.js';
import { OpenAIProvider } from '../providers/openai/OpenAIProvider.js';
import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
} from '../services/history/IContent.js';
import { DebugLogger } from '../debug/index.js';

// Enable debug logging for this test
const debugLogger = new DebugLogger('test:orphaned-tools');

describe.skip('Orphaned Tool Calls Behavioral Test (OBSOLETE - atomic implementation prevents orphans)', () => {
  let historyService: HistoryService;
  let openAIProvider: OpenAIProvider;

  beforeEach(() => {
    historyService = new HistoryService();
    openAIProvider = new OpenAIProvider();

    // Mock the API key and base URL
    openAIProvider.setApiKey('test-api-key');
    openAIProvider.setBaseUrl('https://api.openai.com/v1');

    // Mock the fetch to avoid actual API calls
    global.fetch = vi.fn();
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

    // Step 6: Get curated history - should have synthetic response added
    const curatedHistory = historyService.getCurated();

    // Verify synthetic response was added
    const toolResponses = curatedHistory.filter((c) => c.speaker === 'tool');
    expect(toolResponses).toHaveLength(1);
    expect(toolResponses[0].metadata?.synthetic).toBe(true);
    expect(toolResponses[0].metadata?.reason).toBe('orphaned_tool_call');

    const syntheticBlock = toolResponses[0].blocks[0];
    expect(syntheticBlock.type).toBe('tool_response');
    expect((syntheticBlock as ToolResponseBlock).callId).toBe(toolCallId);
    expect((syntheticBlock as ToolResponseBlock).error).toContain(
      'cancelled or failed',
    );

    // Step 7: Mock the OpenAI API to verify correct request format
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;

    // Create a mock readable stream
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant","content":"Here is a joke!"},"finish_reason":null}]}\n\n',
          ),
        );
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
          ),
        );
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: mockStream,
    });

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

    // Attempt to generate completion - should work with synthetic responses
    const generator = openAIProvider.generateChatCompletionIContent(
      curatedHistory,
      tools,
    );

    // Consume the generator
    let responseReceived = false;
    for await (const chunk of generator) {
      if (chunk) {
        responseReceived = true;
        break;
      }
    }

    // Verify the request was made and succeeded
    expect(mockFetch).toHaveBeenCalled();
    expect(responseReceived).toBe(true);

    // Verify the request body has proper tool response pairing
    const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);

    // Count tool calls and responses in the request
    const toolCallMessages = requestBody.messages.filter(
      (m: { role: string; tool_calls?: unknown[] }) =>
        m.role === 'assistant' && m.tool_calls,
    );
    const toolResponseMessages = requestBody.messages.filter(
      (m: { role: string }) => m.role === 'tool',
    );

    // Should have equal number of tool calls and responses
    const totalToolCalls = toolCallMessages.reduce(
      (sum: number, m: { tool_calls?: unknown[] }) =>
        sum + (m.tool_calls?.length || 0),
      0,
    );
    expect(toolResponseMessages.length).toBe(totalToolCalls);
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

    // After fix: should have 2 tool response entries (1 real + 1 synthetic with 2 blocks)
    expect(toolResponseCount).toBe(2);
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
