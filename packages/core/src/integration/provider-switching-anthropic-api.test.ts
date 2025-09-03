import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../providers/anthropic/AnthropicProvider.js';
import { IMessage } from '../providers/IMessage.js';
import { ITool } from '../providers/ITool.js';

// Mock the entire Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: {
      create: mockCreate,
    },
    beta: {
      models: {
        list: vi.fn().mockReturnValue([]),
      },
    },
  }));

  return {
    default: MockAnthropic,
    __mockCreate: mockCreate,
  };
});

/**
 * Integration test for provider switching with Anthropic API.
 *
 * This test suite demonstrates:
 * 1. Tool call IDs are preserved correctly in normal scenarios
 * 2. The ID mismatch bug that causes "tool_use ids were found without tool_result blocks" errors
 * 3. The root cause: validateAndFixMessages() doesn't fix mismatched tool_call_id values
 *
 * The bug fix needed: Update validateAndFixMessages to correct tool_result IDs to match their
 * corresponding tool_use IDs, not just handle missing tool results.
 */
describe('Provider Switching - Anthropic API Integration', () => {
  let provider: AnthropicProvider;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Get the mock function
    const AnthropicMock = await import('@anthropic-ai/sdk');
    mockCreate = (AnthropicMock as { __mockCreate: ReturnType<typeof vi.fn> })
      .__mockCreate;

    // Reset all mocks
    vi.clearAllMocks();

    // Create provider with test API key and config to disable streaming
    provider = new AnthropicProvider('test-api-key', undefined, {
      getEphemeralSettings: () => ({ streaming: 'disabled' }),
    });

    // Mock successful API response (non-streaming)
    mockCreate.mockResolvedValue({
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'File found successfully.',
        },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('preserves tool call IDs through full conversion chain to Anthropic API', async () => {
    // These are OpenAI-style messages that would come from history conversion
    const openaiStyleMessages: IMessage[] = [
      {
        role: 'user',
        content: 'Please find the file test.txt',
      },
      {
        role: 'assistant',
        content: 'I will search for the file test.txt.',
        tool_calls: [
          {
            id: '7e6a3cd4d', // Original OpenAI tool call ID
            type: 'function',
            function: {
              name: 'find_file',
              arguments: '{"filename": "test.txt"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: '7e6a3cd4d', // Matching tool result ID
        content: 'File found: test.txt',
      },
    ];

    const tools: ITool[] = [
      {
        type: 'function',
        function: {
          name: 'find_file',
          description: 'Find a file by name',
          parameters: {
            type: 'object',
            properties: {
              filename: {
                type: 'string',
                description: 'The name of the file to find',
              },
            },
            required: ['filename'],
          },
        },
      },
    ];

    // Call generateChatCompletion which should format messages for Anthropic API
    const generator = provider.generateChatCompletion(
      openaiStyleMessages,
      tools,
    );

    // Consume the generator to trigger the API call
    const results = [];
    for await (const result of generator) {
      results.push(result);
    }

    // Verify the API was called
    expect(mockCreate).toHaveBeenCalledTimes(1);

    // Capture the actual request that would be sent to Anthropic API
    const apiRequest = mockCreate.mock.calls[0][0];

    // Extract the messages from the API request
    const anthropicMessages = apiRequest.messages;

    // Find the assistant message with tool_use
    const assistantMessage = anthropicMessages.find(
      (msg: {
        role: string;
        content: Array<{
          type: string;
          id?: string;
          name?: string;
          input?: unknown;
          tool_use_id?: string;
          content?: string;
          text?: string;
        }>;
      }) =>
        msg.role === 'assistant' &&
        Array.isArray(msg.content) &&
        msg.content.some((block) => block.type === 'tool_use'),
    );

    expect(assistantMessage).toBeDefined();
    expect(assistantMessage.content).toBeDefined();

    // Find the tool_use block
    const toolUseBlock = assistantMessage.content.find(
      (block) => block.type === 'tool_use',
    );

    expect(toolUseBlock).toBeDefined();
    expect(toolUseBlock.id).toBe('7e6a3cd4d'); // Should preserve original ID
    expect(toolUseBlock.name).toBe('find_file');
    expect(toolUseBlock.input).toEqual({ filename: 'test.txt' });

    // Find the user message with tool_result
    const toolResultMessage = anthropicMessages.find(
      (msg: {
        role: string;
        content: Array<{
          type: string;
          id?: string;
          name?: string;
          input?: unknown;
          tool_use_id?: string;
          content?: string;
          text?: string;
        }>;
      }) =>
        msg.role === 'user' &&
        Array.isArray(msg.content) &&
        msg.content.some((block) => block.type === 'tool_result'),
    );

    expect(toolResultMessage).toBeDefined();
    expect(toolResultMessage.content).toBeDefined();

    // Find the tool_result block
    const toolResultBlock = toolResultMessage.content.find(
      (block) => block.type === 'tool_result',
    );

    expect(toolResultBlock).toBeDefined();
    expect(toolResultBlock.tool_use_id).toBe('7e6a3cd4d'); // Should match tool_use ID
    expect(toolResultBlock.content).toBe('File found: test.txt');

    // Verify IDs match between tool_use and tool_result
    expect(toolUseBlock.id).toBe(toolResultBlock.tool_use_id);

    console.log('=== ANTHROPIC API REQUEST ===');
    console.log('Model:', apiRequest.model);
    console.log('Messages:', JSON.stringify(anthropicMessages, null, 2));
    console.log('Tools:', JSON.stringify(apiRequest.tools, null, 2));

    // More detailed analysis
    console.log('\n=== ID PRESERVATION ANALYSIS ===');
    console.log('Tool use ID:', toolUseBlock.id);
    console.log('Tool result tool_use_id:', toolResultBlock.tool_use_id);
    console.log('IDs match:', toolUseBlock.id === toolResultBlock.tool_use_id);
    console.log('Original OpenAI tool call ID was: 7e6a3cd4d');
  });

  test('handles multiple tool calls with different IDs correctly', async () => {
    const messagesWithMultipleTools: IMessage[] = [
      {
        role: 'user',
        content: 'Please find two files and read them',
      },
      {
        role: 'assistant',
        content: 'I will find and read both files for you.',
        tool_calls: [
          {
            id: 'tool-call-1',
            type: 'function',
            function: {
              name: 'find_file',
              arguments: '{"filename": "file1.txt"}',
            },
          },
          {
            id: 'tool-call-2',
            type: 'function',
            function: {
              name: 'find_file',
              arguments: '{"filename": "file2.txt"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'tool-call-1',
        content: 'Found file1.txt',
      },
      {
        role: 'tool',
        tool_call_id: 'tool-call-2',
        content: 'Found file2.txt',
      },
    ];

    const tools: ITool[] = [
      {
        type: 'function',
        function: {
          name: 'find_file',
          description: 'Find a file by name',
          parameters: {
            type: 'object',
            properties: {
              filename: {
                type: 'string',
                description: 'The name of the file to find',
              },
            },
            required: ['filename'],
          },
        },
      },
    ];

    // Call generateChatCompletion
    const generator = provider.generateChatCompletion(
      messagesWithMultipleTools,
      tools,
    );

    // Consume the generator
    const results = [];
    for await (const result of generator) {
      results.push(result);
    }

    // Verify the API was called
    expect(mockCreate).toHaveBeenCalledTimes(1);

    // Capture the actual request
    const apiRequest = mockCreate.mock.calls[0][0];
    const anthropicMessages = apiRequest.messages;

    // Find assistant message with tool_use blocks
    const assistantMessage = anthropicMessages.find(
      (msg: {
        role: string;
        content: Array<{
          type: string;
          id?: string;
          name?: string;
          input?: unknown;
          tool_use_id?: string;
          content?: string;
          text?: string;
        }>;
      }) => msg.role === 'assistant' && Array.isArray(msg.content),
    );

    expect(assistantMessage).toBeDefined();

    // Find all tool_use blocks
    const toolUseBlocks = assistantMessage.content.filter(
      (block) => block.type === 'tool_use',
    );

    expect(toolUseBlocks).toHaveLength(2);

    // Find all tool_result messages
    const toolResultMessages = anthropicMessages.filter(
      (msg: {
        role: string;
        content: Array<{
          type: string;
          id?: string;
          name?: string;
          input?: unknown;
          tool_use_id?: string;
          content?: string;
          text?: string;
        }>;
      }) =>
        msg.role === 'user' &&
        Array.isArray(msg.content) &&
        msg.content.some((block) => block.type === 'tool_result'),
    );

    expect(toolResultMessages).toHaveLength(2);

    // Extract all tool_result blocks
    const toolResultBlocks = toolResultMessages.flatMap((msg) =>
      msg.content.filter((block) => block.type === 'tool_result'),
    );

    expect(toolResultBlocks).toHaveLength(2);

    // Verify each tool_use has a matching tool_result
    for (const toolUse of toolUseBlocks) {
      const matchingResult = toolResultBlocks.find(
        (result) => result.tool_use_id === toolUse.id,
      );
      expect(matchingResult).toBeDefined();
      expect(['tool-call-1', 'tool-call-2']).toContain(toolUse.id);
    }

    console.log('=== MULTIPLE TOOLS API REQUEST ===');
    console.log(
      'Assistant message:',
      JSON.stringify(assistantMessage, null, 2),
    );
    console.log(
      'Tool result messages:',
      JSON.stringify(toolResultMessages, null, 2),
    );
  });

  test('demonstrates the ID mismatch bug that causes Anthropic API errors', async () => {
    // Simulate a scenario where IDs might get regenerated or corrupted
    const problematicMessages: IMessage[] = [
      {
        role: 'user',
        content: 'Use the tool please',
      },
      {
        role: 'assistant',
        content: 'Using the tool now.',
        tool_calls: [
          {
            id: 'original-id-123',
            type: 'function',
            function: {
              name: 'test_tool',
              arguments: '{"param": "value"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'different-id-456', // Intentionally mismatched ID
        content: 'Tool result here',
      },
    ];

    const tools: ITool[] = [
      {
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: {
            type: 'object',
            properties: {
              param: { type: 'string' },
            },
            required: ['param'],
          },
        },
      },
    ];

    // This should either fix the mismatch or fail appropriately
    const generator = provider.generateChatCompletion(
      problematicMessages,
      tools,
    );

    const results = [];
    for await (const result of generator) {
      results.push(result);
    }

    expect(mockCreate).toHaveBeenCalledTimes(1);

    const apiRequest = mockCreate.mock.calls[0][0];
    const anthropicMessages = apiRequest.messages;

    console.log('=== MISMATCHED IDs SCENARIO ===');
    console.log(
      'Full API request messages:',
      JSON.stringify(anthropicMessages, null, 2),
    );

    // The provider should either:
    // 1. Fix the mismatch by updating the tool_result ID to match tool_use
    // 2. Or handle it gracefully through validateAndFixMessages

    const assistantMsg = anthropicMessages.find(
      (msg: {
        role: string;
        content: Array<{
          type: string;
          id?: string;
          name?: string;
          input?: unknown;
          tool_use_id?: string;
          content?: string;
          text?: string;
        }>;
      }) => msg.role === 'assistant' && Array.isArray(msg.content),
    );
    const toolUseBlock = assistantMsg?.content?.find(
      (block) => block.type === 'tool_use',
    );

    const toolResultMsg = anthropicMessages.find(
      (msg: {
        role: string;
        content: Array<{
          type: string;
          id?: string;
          name?: string;
          input?: unknown;
          tool_use_id?: string;
          content?: string;
          text?: string;
        }>;
      }) => msg.role === 'user' && Array.isArray(msg.content),
    );
    const toolResultBlock = toolResultMsg?.content?.find(
      (block) => block.type === 'tool_result',
    );

    if (toolUseBlock && toolResultBlock) {
      console.log('Tool use ID:', toolUseBlock.id);
      console.log('Tool result tool_use_id:', toolResultBlock.tool_use_id);

      // CURRENT BUG: The AnthropicProvider is NOT fixing mismatched IDs
      // This is the problem that causes tool_use/tool_result mismatch errors
      expect(toolUseBlock.id).toBe('original-id-123'); // Original tool_use ID preserved
      expect(toolResultBlock.tool_use_id).toBe('different-id-456'); // BUG: ID is not corrected!

      // This mismatch will cause Anthropic API to return an error:
      // "tool_use ids were found without tool_result blocks"
      console.log('*** BUG DETECTED ***');
      console.log('Tool call ID:', toolUseBlock.id);
      console.log('Tool result ID:', toolResultBlock.tool_use_id);
      console.log(
        'These IDs do not match, which will cause Anthropic API errors!',
      );

      // Also log the full API request to see how this gets sent to Anthropic
      console.log('\n=== PROBLEMATIC API REQUEST ===');
      console.log(JSON.stringify(anthropicMessages, null, 2));
    }
  });
});
