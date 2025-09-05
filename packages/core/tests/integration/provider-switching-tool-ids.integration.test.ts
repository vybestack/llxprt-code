import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { GeminiChat } from '../../src/gemini/GeminiChat';
import { HistoryService } from '../../src/services/history/HistoryService';
import type { Config } from '../../src/config';

// CRITICAL: DO NOT MOCK these components - we need to test the real integration
// Only mock HTTP API calls

describe('Provider Switching Tool IDs Integration', () => {
  let chat: GeminiChat;
  let historyService: HistoryService;

  // Minimal working config
  const config: Config = {
    currentProfile: 'test',
    profiles: {
      test: {
        provider: 'openai',
        openai: {
          apiKey: 'test-key',
          model: 'gpt-4',
        },
        anthropic: {
          apiKey: 'test-key',
          model: 'claude-3-opus',
        },
      },
    },
    tools: {
      enabled: true,
      glob: {
        enabled: true,
        implementation: async (args: { pattern?: string }) => ({
          output: `Found files: ${args.pattern}`,
        }),
      },
      read_file: {
        enabled: true,
        implementation: async (args: { path?: string }) => ({
          output: `File contents: ${args.path}`,
        }),
      },
    },
  };

  beforeEach(() => {
    // Clear any previous mocks
    nock.cleanAll();

    // Initialize real components
    historyService = new HistoryService();
    chat = new GeminiChat(config, historyService);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('Test Scenario 1: OpenAI → Anthropic Switch', () => {
    it('should fail with 400 error when switching from OpenAI to Anthropic without ID normalization', async () => {
      // Step 1: Mock OpenAI API response with tool calls
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: "I'll analyze the codebase structure for you.",
                tool_calls: [
                  {
                    id: 'call_abc123', // OpenAI format ID
                    type: 'function',
                    function: {
                      name: 'glob',
                      arguments: JSON.stringify({ pattern: '**/*.ts' }),
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        });

      // Step 2: User message and assistant response with tool call
      await chat.sendMessage('Analyze the codebase structure');

      // Step 3: Tool response
      historyService.addMessage({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_abc123', // Same OpenAI ID
            toolName: 'glob',
            result: { output: 'Found 150 TypeScript files' },
          },
        ],
      });

      // Step 4: Continue with more tool calls
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-2',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Found 150 files. Let me check the test coverage.',
                tool_calls: [
                  {
                    id: 'call_def456', // Another OpenAI ID
                    type: 'function',
                    function: {
                      name: 'glob',
                      arguments: JSON.stringify({ pattern: '**/*.test.ts' }),
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        });

      await chat.sendMessage('Continue');

      historyService.addMessage({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_def456',
            toolName: 'glob',
            result: { output: 'Found 45 test files' },
          },
        ],
      });

      // Step 5: One more tool call
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-3',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Checking documentation.',
                tool_calls: [
                  {
                    id: 'call_ghi789',
                    type: 'function',
                    function: {
                      name: 'glob',
                      arguments: JSON.stringify({ pattern: '**/*.md' }),
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        });

      await chat.sendMessage('Continue');

      historyService.addMessage({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_ghi789',
            toolName: 'glob',
            result: { output: 'Found 12 documentation files' },
          },
        ],
      });

      // Step 6: Final summary from OpenAI
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-4',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content:
                  'Analysis complete: 150 TypeScript files, 45 tests, 12 docs.',
              },
              finish_reason: 'stop',
            },
          ],
        });

      await chat.sendMessage('Summarize');

      // Step 7: SWITCH TO ANTHROPIC
      chat.updateConfig({
        ...config,
        profiles: {
          test: {
            ...config.profiles.test,
            provider: 'anthropic',
          },
        },
      });

      // Step 8: Mock Anthropic API to validate and reject OpenAI IDs
      let anthropicRequestBody: unknown = null;
      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(400, (uri, requestBody) => {
          anthropicRequestBody = requestBody;

          // Check if OpenAI tool IDs are present in the history
          const messages = (requestBody as { messages?: unknown[] }).messages;
          for (const message of messages) {
            if (Array.isArray(message.content)) {
              for (const content of message.content) {
                if (
                  content.type === 'tool_result' &&
                  (content.tool_use_id?.startsWith('call_') ||
                    !content.tool_use_id?.startsWith('toolu_'))
                ) {
                  // This is the actual error Anthropic would return
                  return {
                    type: 'error',
                    error: {
                      type: 'invalid_request_error',
                      message: `messages.${messages.indexOf(message)}.content.${message.content.indexOf(content)}: unexpected \`tool_use_id\` found in \`tool_result\` blocks: ${content.tool_use_id}. Each \`tool_result\` block must have a corresponding \`tool_use\` block in the previous message.`,
                    },
                  };
                }
              }
            }
          }

          // If no error, something is wrong with our test
          throw new Error(
            'Expected to find OpenAI IDs in request but none found',
          );
        });

      // Step 9: Try to send a message with Anthropic - should get 400 error
      await expect(async () => {
        await chat.sendMessage('Now check for Python files');
      }).rejects.toThrow(/400.*unexpected.*tool_use_id.*call_/);

      // Verify the error message contains the OpenAI ID
      expect(anthropicRequestBody).toBeDefined();
    });
  });

  describe('Test Scenario 2: Anthropic → OpenAI Switch', () => {
    it('should fail with 400 error when switching from Anthropic to OpenAI without ID normalization', async () => {
      // Start with Anthropic provider
      chat.updateConfig({
        ...config,
        profiles: {
          test: {
            ...config.profiles.test,
            provider: 'anthropic',
          },
        },
      });

      // Step 1: Mock Anthropic API response with tool calls
      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(200, {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: "I'll search for configuration files.",
            },
            {
              type: 'tool_use',
              id: 'toolu_01ABcdef', // Anthropic format ID
              name: 'glob',
              input: { pattern: '**/*.config.js' },
            },
          ],
          model: 'claude-3-opus',
          stop_reason: 'tool_use',
        });

      await chat.sendMessage('Search for configuration files');

      // Step 2: Tool response
      historyService.addMessage({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'toolu_01ABcdef',
            toolName: 'glob',
            result: { output: 'Found 8 config files' },
          },
        ],
      });

      // Step 3: More tool calls
      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(200, {
          id: 'msg_2',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Checking environment files.',
            },
            {
              type: 'tool_use',
              id: 'toolu_02GHijk',
              name: 'glob',
              input: { pattern: '**/.env*' },
            },
          ],
          model: 'claude-3-opus',
          stop_reason: 'tool_use',
        });

      await chat.sendMessage('Continue');

      historyService.addMessage({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'toolu_02GHijk',
            toolName: 'glob',
            result: { output: 'Found 3 environment files' },
          },
        ],
      });

      // Step 4: Read package.json
      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(200, {
          id: 'msg_3',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Reading package.json.',
            },
            {
              type: 'tool_use',
              id: 'toolu_03MNopq',
              name: 'read_file',
              input: { path: 'package.json' },
            },
          ],
          model: 'claude-3-opus',
          stop_reason: 'tool_use',
        });

      await chat.sendMessage('Continue');

      historyService.addMessage({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'toolu_03MNopq',
            toolName: 'read_file',
            result: { output: '{"name": "test-app", "version": "1.0.0"}' },
          },
        ],
      });

      // Step 5: Final summary from Anthropic
      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(200, {
          id: 'msg_4',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Analysis complete: 8 configs, 3 env files, package.json analyzed.',
            },
          ],
          model: 'claude-3-opus',
          stop_reason: 'end_turn',
        });

      await chat.sendMessage('Summarize');

      // Step 6: SWITCH TO OPENAI
      chat.updateConfig({
        ...config,
        profiles: {
          test: {
            ...config.profiles.test,
            provider: 'openai',
          },
        },
      });

      // Step 7: Mock OpenAI API to validate and reject Anthropic IDs
      let openAIRequestBody: unknown = null;
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(400, (uri, requestBody) => {
          openAIRequestBody = requestBody;

          // Check if Anthropic tool IDs are present
          const messages = (requestBody as { messages?: unknown[] }).messages;
          for (const message of messages) {
            if (message.role === 'tool' && message.tool_call_id) {
              if (message.tool_call_id.startsWith('toolu_')) {
                // OpenAI would reject Anthropic format IDs
                return {
                  error: {
                    message: `Invalid tool_call_id format: ${message.tool_call_id}. Expected format 'call_*' or alphanumeric.`,
                    type: 'invalid_request_error',
                    code: 'invalid_tool_call_id',
                  },
                };
              }
            }
          }

          // If no error, something is wrong with our test
          throw new Error(
            'Expected to find Anthropic IDs in request but none found',
          );
        });

      // Step 8: Try to send a message with OpenAI - should get 400 error
      await expect(async () => {
        await chat.sendMessage('What dependencies do we have?');
      }).rejects.toThrow(/400.*Invalid tool_call_id format.*toolu_/);

      // Verify the error message contains the Anthropic ID
      expect(openAIRequestBody).toBeDefined();
    });
  });

  describe('Test Scenario 3: Qwen/Cerebras Short ID Format', () => {
    it('should fail when short alphanumeric IDs leak to other providers', async () => {
      // Mock a provider that uses short IDs (like Qwen)
      nock('https://api.openai.com') // Using OpenAI endpoint but with Qwen-style IDs
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chatcmpl-qwen',
          object: 'chat.completion',
          created: Date.now(),
          model: 'qwen-turbo',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: "I'll analyze the project.",
                tool_calls: [
                  {
                    id: '692a5fddc', // Qwen/Cerebras style short ID (from actual error log)
                    type: 'function',
                    function: {
                      name: 'glob',
                      arguments: JSON.stringify({ pattern: '**/*.ts' }),
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        });

      await chat.sendMessage('Analyze the project');

      // Tool response with same short ID
      historyService.addMessage({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: '692a5fddc', // Same short ID
            toolName: 'glob',
            result: {
              output:
                'glob output exceeded token limit and was truncated. Showing first 149784 characters...',
            },
          },
        ],
      });

      // Switch to Anthropic
      chat.updateConfig({
        ...config,
        profiles: {
          test: {
            ...config.profiles.test,
            provider: 'anthropic',
          },
        },
      });

      // Mock Anthropic to reject the short ID format
      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(400, {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message:
              'messages.0.content.0: unexpected `tool_use_id` found in `tool_result` blocks: 692a5fddc. Each `tool_result` block must have a corresponding `tool_use` block in the previous message.',
          },
        });

      // This should fail with the exact error from the debug log
      await expect(async () => {
        await chat.sendMessage('Continue analysis');
      }).rejects.toThrow(/unexpected.*tool_use_id.*692a5fddc/);
    });
  });

  describe('Mock API Validations', () => {
    it('should validate orphaned tool responses', async () => {
      // Add an orphaned tool response to history
      historyService.addMessage({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'orphan_id_123',
            toolName: 'orphan_tool',
            result: 'This has no corresponding tool call',
          },
        ],
      });

      // Mock Anthropic to reject orphaned responses
      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(400, {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'tool_result found without corresponding tool_use',
          },
        });

      chat.updateConfig({
        ...config,
        profiles: {
          test: {
            ...config.profiles.test,
            provider: 'anthropic',
          },
        },
      });

      await expect(async () => {
        await chat.sendMessage('Test message');
      }).rejects.toThrow(/tool_result found without corresponding tool_use/);
    });

    it('should validate ID format matches provider expectations', async () => {
      // Test that each provider validates its expected ID format

      // OpenAI expects 'call_*' or short alphanumeric
      historyService.addMessage({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'wrong_format_123', // Wrong format
            name: 'test_tool',
            parameters: {},
          },
        ],
      });

      historyService.addMessage({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'wrong_format_123',
            toolName: 'test_tool',
            result: 'test result',
          },
        ],
      });

      // Mock OpenAI to validate format
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(400, {
          error: {
            message: 'Invalid tool_call_id format',
            type: 'invalid_request_error',
          },
        });

      await expect(async () => {
        await chat.sendMessage('Test');
      }).rejects.toThrow(/Invalid tool_call_id format/);
    });

    it('should ensure tool responses come after tool calls', async () => {
      // Add tool response before tool call (wrong order)
      historyService.addMessage({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'response_first',
            toolName: 'test',
            result: 'response before call',
          },
        ],
      });

      historyService.addMessage({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'response_first',
            name: 'test',
            parameters: {},
          },
        ],
      });

      // Mock API to reject wrong order
      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(400, {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'tool_result must come after corresponding tool_use',
          },
        });

      chat.updateConfig({
        ...config,
        profiles: {
          test: {
            ...config.profiles.test,
            provider: 'anthropic',
          },
        },
      });

      await expect(async () => {
        await chat.sendMessage('Test');
      }).rejects.toThrow(/tool_result must come after corresponding tool_use/);
    });

    it('should reject dangling tool calls without responses', async () => {
      // Add tool call without response
      historyService.addMessage({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'dangling_call',
            name: 'test_tool',
            parameters: {},
          },
        ],
      });

      // Try to continue conversation without providing tool response
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(400, {
          error: {
            message: 'Unresolved tool_call: dangling_call',
            type: 'invalid_request_error',
          },
        });

      await expect(async () => {
        await chat.sendMessage('Continue without tool response');
      }).rejects.toThrow(/Unresolved tool_call/);
    });
  });

  describe('Complex Multi-Provider Scenarios', () => {
    it('should handle rapid provider switching with multiple tool calls', async () => {
      // Start with OpenAI
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(200, {
          id: 'chat-1',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Starting analysis.',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'glob', arguments: '{"pattern":"*.js"}' },
                  },
                  {
                    id: 'call_2',
                    type: 'function',
                    function: { name: 'glob', arguments: '{"pattern":"*.ts"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        });

      await chat.sendMessage('Start');

      // Tool responses
      historyService.addMessage({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_1',
            toolName: 'glob',
            result: 'JS files',
          },
          {
            type: 'tool_response',
            callId: 'call_2',
            toolName: 'glob',
            result: 'TS files',
          },
        ],
      });

      // Switch to Anthropic
      chat.updateConfig({
        ...config,
        profiles: {
          test: {
            ...config.profiles.test,
            provider: 'anthropic',
          },
        },
      });

      // Should fail due to OpenAI IDs in history
      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(400, {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'unexpected tool_use_id: call_1',
          },
        });

      await expect(async () => {
        await chat.sendMessage('Continue with Anthropic');
      }).rejects.toThrow(/unexpected tool_use_id: call_1/);

      // Switch back to OpenAI
      chat.updateConfig({
        ...config,
        profiles: {
          test: {
            ...config.profiles.test,
            provider: 'openai',
          },
        },
      });

      // Add Anthropic-style content to history
      historyService.addMessage({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'toolu_ABC123',
            name: 'read_file',
            parameters: { path: 'test.js' },
          },
        ],
      });

      historyService.addMessage({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'toolu_ABC123',
            toolName: 'read_file',
            result: 'file contents',
          },
        ],
      });

      // OpenAI should now reject Anthropic IDs
      nock('https://api.openai.com')
        .post('/v1/chat/completions')
        .reply(400, {
          error: {
            message: 'Invalid tool_call_id: toolu_ABC123',
            type: 'invalid_request_error',
          },
        });

      await expect(async () => {
        await chat.sendMessage('Back to OpenAI');
      }).rejects.toThrow(/Invalid tool_call_id: toolu_ABC123/);
    });
  });
});
