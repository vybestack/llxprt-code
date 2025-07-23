import { expect, test, vi, beforeEach, describe, type Mock } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import { ITool } from '../ITool.js';
import { IMessage } from '../IMessage.js';
import { ContentGeneratorRole } from '../ContentGeneratorRole.js';
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
  } catch (_error) {
    // If file doesn't exist, tests will use mock
    process.env.OPENAI_API_KEY = 'test-key-for-mocked-tests';
  }
}

interface CapturedRequest {
  url: string;
  body: {
    input?: Array<{
      type?: string;
      call_id?: string;
      output?: string;
      role?: string;
      content?: string;
    }>;
    [key: string]: unknown;
  };
}

interface MockResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: string;
  }>;
}

describe('OpenAIProvider - Responses API Tool Calls', () => {
  let provider: OpenAIProvider;
  let mockTool: ITool;

  beforeEach(() => {
    console.log('=== Test Setup ===');
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
            path: { type: 'string' },
          },
          required: ['path'],
        },
      },
    };

    // Create provider
    provider = new OpenAIProvider(process.env.OPENAI_API_KEY!);
    provider.setModel('gpt-4o');
  });

  test('should properly format tool responses in subsequent requests', async () => {
    console.log('\n=== Testing Tool Response Formatting ===');
    console.log('Test starting with model:', provider.getCurrentModel?.());

    // Create messages array with a tool call and response
    const messages: IMessage[] = [
      {
        role: ContentGeneratorRole.USER,
        content: 'Read the file /test.txt',
      },
      {
        role: ContentGeneratorRole.ASSISTANT,
        content: '',
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: JSON.stringify({ path: '/test.txt' }),
            },
          },
        ],
      },
      {
        role: ContentGeneratorRole.TOOL,
        tool_call_id: 'call_123',
        content: 'File contents: Hello World',
      },
      {
        role: ContentGeneratorRole.USER,
        content: 'What did the file contain?',
      },
    ];

    // Mock response for continuation
    const mockResponse: MockResponse = {
      id: 'chatcmpl-456',
      object: 'chat.completion',
      created: Date.now(),
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: {
            role: ContentGeneratorRole.ASSISTANT,
            content: 'The file contains: Hello World',
          },
          finish_reason: 'stop',
        },
      ],
    };

    let capturedRequest: CapturedRequest | null = null;

    (fetch as unknown as Mock<typeof fetch>).mockImplementation(
      async (url, options) => {
        console.log('Fetch called with URL:', url);
        console.log('Fetch options:', options);
        console.log('Request body (raw):', options?.body as string);

        try {
          capturedRequest = {
            url: url as string,
            body: JSON.parse(
              options?.body as string,
            ) as CapturedRequest['body'],
          };
        } catch (e) {
          console.error('Failed to parse request body:', e);
          capturedRequest = {
            url: url as string,
            body: { raw: options?.body as string },
          };
        }

        return {
          ok: true,
          status: 200,
          json: async () => mockResponse,
          text: async () => JSON.stringify(mockResponse),
        } as Response;
      },
    );

    // Send request with messages containing tool responses
    console.log('Starting generateChatCompletion...');
    const stream = provider.generateChatCompletion(messages, [mockTool]);

    // Consume the stream to trigger the request
    const chunks: unknown[] = [];
    try {
      for await (const chunk of stream) {
        console.log('Received chunk:', chunk);
        chunks.push(chunk);
      }
    } catch (error) {
      console.error('Error consuming stream:', error);
      throw error;
    }

    // Now check the captured request
    if (!capturedRequest) {
      console.error('No request was captured!');
      console.error(
        'Fetch mock calls:',
        (fetch as unknown as Mock<typeof fetch>).mock.calls.length,
      );
      throw new Error('No request was made to the API');
    }

    console.log(
      'Full request to OpenAI:',
      JSON.stringify(capturedRequest, null, 2),
    );

    // TypeScript needs explicit assertion even after null check
    const request = capturedRequest as CapturedRequest;

    // Check if it's using the responses API endpoint
    expect(request.url).toContain('/responses');

    // Check if body exists - Responses API uses 'input' field, not 'messages'
    if (!request.body || !request.body.input) {
      console.error('Request body or input missing:', request.body);
      throw new Error('Request body is malformed');
    }

    // Verify tool response is included in the request as function_call_output
    const toolMessage = request.body.input.find(
      (item) =>
        item.type === 'function_call_output' && item.call_id === 'call_123',
    );

    if (!toolMessage) {
      console.error('ERROR: No tool output found in request!');
      console.error(
        'Input items in request:',
        JSON.stringify(request.body.input, null, 2),
      );
      throw new Error('No tool output found for function call');
    }

    console.log('Tool message found:', JSON.stringify(toolMessage, null, 2));
    expect(toolMessage).toBeDefined();
    expect(toolMessage.output).toBe('File contents: Hello World');
  });

  test('should handle edge case where tool response might be missing', async () => {
    console.log('\n=== Testing Edge Case: Missing Tool Response ===');

    // Create messages with tool call but NO tool response
    const messages: IMessage[] = [
      {
        role: ContentGeneratorRole.USER,
        content: 'What files are in the current directory?',
      },
      {
        role: ContentGeneratorRole.ASSISTANT,
        content: '',
        tool_calls: [
          {
            id: 'call_missing',
            type: 'function',
            function: {
              name: 'list_files',
              arguments: JSON.stringify({ directory: '.' }),
            },
          },
        ],
      },
      // NOTE: No tool response message here!
      {
        role: ContentGeneratorRole.USER,
        content: 'Please tell me what files you found',
      },
    ];

    let capturedRequest: CapturedRequest | null = null;

    (fetch as unknown as Mock<typeof fetch>).mockImplementation(
      async (url, options) => {
        capturedRequest = {
          url: url as string,
          body: JSON.parse(options?.body as string) as CapturedRequest['body'],
        };

        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'chatcmpl-edge',
            object: 'chat.completion',
            created: Date.now(),
            model: 'gpt-4o',
            choices: [
              {
                index: 0,
                message: {
                  role: ContentGeneratorRole.ASSISTANT,
                  content: 'I need to run the tool first to see the files.',
                },
                finish_reason: 'stop',
              },
            ],
          }),
        } as Response;
      },
    );

    // Generate completion
    const stream = provider.generateChatCompletion(messages, [mockTool]);

    // Consume stream
    for await (const _chunk of stream) {
      // Just consume it
    }

    // Verify the request was made
    expect(capturedRequest).toBeTruthy();

    // Check that there are NO function_call_output items since we didn't provide tool responses
    const functionCallOutputs =
      capturedRequest!.body.input?.filter(
        (item) => item.type === 'function_call_output',
      ) || [];

    console.log(
      'Function call outputs in edge case:',
      functionCallOutputs.length,
    );
    expect(functionCallOutputs.length).toBe(0);
  });

  test('should include function_call_output in responses API format', async () => {
    console.log('\n=== Testing function_call_output Format ===');

    // Create messages with tool call and response
    const messages: IMessage[] = [
      {
        role: ContentGeneratorRole.USER,
        content: 'What files are in the current directory?',
      },
      {
        role: ContentGeneratorRole.ASSISTANT,
        content: '',
        tool_calls: [
          {
            id: 'call_abc',
            type: 'function',
            function: {
              name: 'list_files',
              arguments: JSON.stringify({ directory: '.' }),
            },
          },
        ],
      },
      {
        role: ContentGeneratorRole.TOOL,
        tool_call_id: 'call_abc',
        content: 'Files: file1.txt, file2.js, README.md',
      },
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
            directory: { type: 'string' },
          },
          required: ['directory'],
        },
      },
    };

    let capturedRequest: CapturedRequest | null = null;

    (fetch as unknown as Mock<typeof fetch>).mockImplementation(
      async (url, options) => {
        capturedRequest = {
          url: url as string,
          body: JSON.parse(options?.body as string) as CapturedRequest['body'],
        };

        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'chatcmpl-789',
            object: 'chat.completion',
            created: Date.now(),
            model: 'gpt-4o',
            choices: [
              {
                index: 0,
                message: {
                  role: ContentGeneratorRole.ASSISTANT,
                  content:
                    'The directory contains: file1.txt, file2.js, and README.md',
                },
                finish_reason: 'stop',
              },
            ],
          }),
        } as Response;
      },
    );

    // Generate completion
    const stream = provider.generateChatCompletion(messages, [listTool]);

    // Consume stream
    for await (const _chunk of stream) {
      // Just consume it
    }

    // Verify the request format
    expect(capturedRequest).toBeTruthy();
    console.log(
      'Request body structure:',
      JSON.stringify(capturedRequest!.body, null, 2),
    );

    // Check for function_call_output items in the input array
    const functionCallOutputs =
      capturedRequest!.body.input?.filter(
        (item) => item.type === 'function_call_output',
      ) || [];

    console.log('Function call outputs found:', functionCallOutputs.length);
    console.log(
      'Function call outputs:',
      JSON.stringify(functionCallOutputs, null, 2),
    );

    // The key test: verify tool responses are properly formatted as function_call_output
    const toolOutput = capturedRequest!.body.input?.find(
      (item) =>
        item.type === 'function_call_output' && item.call_id === 'call_abc',
    );

    if (!toolOutput) {
      console.error('Tool output not found in request!');
      console.error(
        'Full input array:',
        JSON.stringify(capturedRequest!.body.input, null, 2),
      );
      throw new Error('Tool output missing from request');
    }

    console.log('Tool output in request:', toolOutput);
    expect(toolOutput.output).toBe('Files: file1.txt, file2.js, README.md');
  });
});
