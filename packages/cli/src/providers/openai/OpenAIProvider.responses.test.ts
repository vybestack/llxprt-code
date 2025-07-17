import { expect, test, vi, beforeEach, describe } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import { ConversationContext } from '../../utils/ConversationContext.js';
import { Tool } from '@anthropic/tool-kit';
import { LLXPRTLogger } from '../../../../core/src/core/logger.js';

// Mock fetch
global.fetch = vi.fn();

// Setup environment - read API key from file
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Read API key from ~/.openai_key if not in environment
if (!process.env.OPENAI_API_KEY) {
  try {
    const keyPath = join(homedir(), '.openai_key');
    process.env.OPENAI_API_KEY = readFileSync(keyPath, 'utf-8').trim();
  } catch (error) {
    // If file doesn't exist, tests will use mock
    process.env.OPENAI_API_KEY = 'test-key-for-mocked-tests';
  }
}

describe('OpenAIProvider - Responses API Tool Calls', () => {
  let provider: OpenAIProvider;
  let context: ConversationContext;
  let mockTool: Tool;

  beforeEach(() => {
    // Clear mocks
    vi.clearAllMocks();
    
    // Create context
    context = new ConversationContext('test');
    
    // Create a mock tool that simulates read operation
    mockTool = {
      name: 'read_file',
      description: 'Read contents of a file',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        },
        required: ['path']
      },
      execute: vi.fn().mockResolvedValue({
        result: 'File contents: Hello World',
        error: null
      })
    };
    
    // Create provider
    provider = new OpenAIProvider({
      model: 'gpt-4o',
      apiKey: process.env.OPENAI_API_KEY!,
      useResponsesApi: true,
      logger: new LLXPRTLogger({ verbose: true })
    });
  });

  test('should handle tool calls with responses API', async () => {
    console.log('=== Starting Responses API Tool Call Test ===');
    
    // Mock the initial completion response with a tool call
    const mockCompletionResponse = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: Date.now(),
      model: 'gpt-4o',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_abc123',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: JSON.stringify({ path: '/test.txt' })
            }
          }]
        },
        finish_reason: 'tool_calls'
      }]
    };

    // First call - returns tool call
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockCompletionResponse,
      text: async () => JSON.stringify(mockCompletionResponse)
    });

    // Start the stream
    const requestObj = {
      messages: [{
        role: 'user' as const,
        content: 'Read the file /test.txt'
      }],
      tools: [mockTool],
      onContent: vi.fn(),
      onToolUse: vi.fn(),
      onComplete: vi.fn(),
      signal: new AbortController().signal
    };

    console.log('Sending initial request...');
    await provider.sendRequest(requestObj);

    // Verify tool was called
    expect(requestObj.onToolUse).toHaveBeenCalledWith({
      id: 'call_abc123',
      name: 'read_file',
      input: { path: '/test.txt' }
    });

    // Now simulate the tool execution and response
    await mockTool.execute({ path: '/test.txt' });

    // Check what the second request would look like
    console.log('\n=== Checking Second Request Format ===');
    
    // The provider should make a second request with the tool response
    // Let's verify the request format
    if ((fetch as any).mock.calls.length > 0) {
      const secondCall = (fetch as any).mock.calls[0];
      const requestBody = JSON.parse(secondCall[1].body);
      
      console.log('Request body:', JSON.stringify(requestBody, null, 2));
      
      // Check if function_call_output is included
      const hasToolOutput = requestBody.messages.some((msg: any) => 
        msg.role === 'tool' || 
        (msg.tool_call_id && msg.content)
      );
      
      console.log('Has tool output in request:', hasToolOutput);
      
      if (!hasToolOutput) {
        console.error('ERROR: No tool output found in request!');
        console.error('Messages:', JSON.stringify(requestBody.messages, null, 2));
      }
    }
  });

  test('should properly format tool responses in subsequent requests', async () => {
    console.log('\n=== Testing Tool Response Formatting ===');
    
    // Add initial messages with a tool call and response
    context.addMessage({
      role: 'user',
      content: 'Read the file /test.txt'
    });
    
    context.addMessage({
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call_123',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: JSON.stringify({ path: '/test.txt' })
        }
      }]
    });
    
    context.addMessage({
      role: 'tool',
      tool_call_id: 'call_123',
      content: 'File contents: Hello World'
    });
    
    // Mock response for continuation
    const mockResponse = {
      id: 'chatcmpl-456',
      object: 'chat.completion',
      created: Date.now(),
      model: 'gpt-4o',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'The file contains: Hello World'
        },
        finish_reason: 'stop'
      }]
    };
    
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
      text: async () => JSON.stringify(mockResponse)
    });
    
    // Send request with context containing tool responses
    await provider.sendRequest({
      messages: context.getMessages(),
      tools: [mockTool],
      onContent: vi.fn(),
      onToolUse: vi.fn(),
      onComplete: vi.fn(),
      signal: new AbortController().signal
    });
    
    // Inspect the actual request
    const requestCall = (fetch as any).mock.calls[0];
    const requestBody = JSON.parse(requestCall[1].body);
    
    console.log('Full request to OpenAI:', JSON.stringify(requestBody, null, 2));
    
    // Verify tool response is included
    const toolMessage = requestBody.messages.find((msg: any) => 
      msg.role === 'tool' || msg.tool_call_id === 'call_123'
    );
    
    if (!toolMessage) {
      throw new Error('No tool output found for function call');
    }
    
    console.log('Tool message found:', JSON.stringify(toolMessage, null, 2));
    expect(toolMessage).toBeDefined();
    expect(toolMessage.content).toBe('File contents: Hello World');
  });
});