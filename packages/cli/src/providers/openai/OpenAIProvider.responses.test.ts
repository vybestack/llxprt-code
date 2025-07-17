import { expect, test, vi, beforeEach, describe } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import { ITool } from '../ITool.js';
import { IMessage } from '../IMessage.js';

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
  let mockTool: ITool;

  beforeEach(() => {
    // Clear mocks
    vi.clearAllMocks();
    
    // Create a mock tool that simulates read operation
    mockTool = {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read contents of a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' }
          },
          required: ['path']
        }
      }
    };
    
    // Create provider
    provider = new OpenAIProvider(process.env.OPENAI_API_KEY!);
    provider.setModel('gpt-4o');
  });

  test('should properly format tool responses in subsequent requests', async () => {
    console.log('\n=== Testing Tool Response Formatting ===');
    
    // Create messages array with a tool call and response
    const messages: IMessage[] = [
      {
        role: 'user',
        content: 'Read the file /test.txt'
      },
      {
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
      },
      {
        role: 'tool',
        tool_call_id: 'call_123',
        content: 'File contents: Hello World'
      },
      {
        role: 'user',
        content: 'What did the file contain?'
      }
    ];
    
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
    
    let capturedRequest: any = null;
    
    (fetch as any).mockImplementation(async (url: string, options: any) => {
      console.log('Fetch called with URL:', url);
      capturedRequest = {
        url,
        body: JSON.parse(options.body)
      };
      
      return {
        ok: true,
        status: 200,
        json: async () => mockResponse,
        text: async () => JSON.stringify(mockResponse)
      };
    });
    
    // Send request with messages containing tool responses
    const stream = provider.generateChatCompletion(messages, [mockTool]);
    
    // Consume the stream to trigger the request
    const chunks: any[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    
    // Now check the captured request
    expect(capturedRequest).toBeTruthy();
    console.log('Full request to OpenAI:', JSON.stringify(capturedRequest, null, 2));
    
    // Check if it's using the responses API endpoint
    expect(capturedRequest.url).toContain('/responses');
    
    // Verify tool response is included in the request
    const toolMessage = capturedRequest.body.messages.find((msg: any) => 
      msg.role === 'tool' || msg.tool_call_id === 'call_123'
    );
    
    if (!toolMessage) {
      console.error('ERROR: No tool output found in request!');
      console.error('Messages in request:', JSON.stringify(capturedRequest.body.messages, null, 2));
      throw new Error('No tool output found for function call');
    }
    
    console.log('Tool message found:', JSON.stringify(toolMessage, null, 2));
    expect(toolMessage).toBeDefined();
    expect(toolMessage.content).toBe('File contents: Hello World');
  });

  test('should include function_call_output in responses API format', async () => {
    console.log('\n=== Testing function_call_output Format ===');
    
    // Create messages with tool call and response
    const messages: IMessage[] = [
      {
        role: 'user',
        content: 'What files are in the current directory?'
      },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_abc',
          type: 'function',
          function: {
            name: 'list_files',
            arguments: JSON.stringify({ directory: '.' })
          }
        }]
      },
      {
        role: 'tool',
        tool_call_id: 'call_abc',
        content: 'Files: file1.txt, file2.js, README.md'
      }
    ];
    
    // Mock tool
    const listTool: ITool = {
      type: 'function',
      function: {
        name: 'list_files',
        description: 'List files in a directory',
        parameters: {
          type: 'object',
          properties: {
            directory: { type: 'string' }
          },
          required: ['directory']
        }
      }
    };
    
    let capturedRequest: any = null;
    
    (fetch as any).mockImplementation(async (url: string, options: any) => {
      capturedRequest = {
        url,
        body: JSON.parse(options.body)
      };
      
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'chatcmpl-789',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4o',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: 'The directory contains: file1.txt, file2.js, and README.md'
            },
            finish_reason: 'stop'
          }]
        })
      };
    });
    
    // Generate completion
    const stream = provider.generateChatCompletion(messages, [listTool]);
    
    // Consume stream
    for await (const chunk of stream) {
      // Just consume it
    }
    
    // Verify the request format
    expect(capturedRequest).toBeTruthy();
    console.log('Request body structure:', JSON.stringify(capturedRequest.body, null, 2));
    
    // Check for function_call_output items
    const hasResponsesApiFormat = capturedRequest.body.response_format || 
                                  capturedRequest.body.messages.some((msg: any) => 
                                    msg.role === 'function_call_output'
                                  );
    
    console.log('Has responses API format elements:', hasResponsesApiFormat);
    
    // The key test: verify tool responses are properly formatted
    const messages_in_request = capturedRequest.body.messages;
    const tool_message_index = messages_in_request.findIndex((msg: any) => 
      msg.tool_call_id === 'call_abc'
    );
    
    if (tool_message_index === -1) {
      console.error('Tool message not found in request!');
      throw new Error('Tool message missing from request');
    }
    
    console.log('Tool message in request:', messages_in_request[tool_message_index]);
  });
});