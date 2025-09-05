import { describe, it, expect, vi } from 'vitest';
import { GeminiCompatibleWrapper } from '../providers/adapters/GeminiCompatibleWrapper.js';
import type { IProvider } from '../providers/IProvider.js';
import type { Content } from '@google/genai';

describe('GeminiCompatibleWrapper Provider Switching', () => {
  it('🔥 MUST convert Gemini format to Anthropic format when provider is Anthropic', () => {
    // Mock Anthropic provider
    const mockAnthropicProvider: IProvider = {
      name: 'anthropic',
      generateChatCompletion: vi.fn().mockImplementation(async function* () {
        yield {
          role: 'assistant',
          content: [{ type: 'text', text: 'response' }],
        };
      }),
      registerServerTools: vi.fn(),
    };

    const wrapper = new GeminiCompatibleWrapper(mockAnthropicProvider);

    // Gemini format with tool response (from history)
    const geminiContents: Content[] = [
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'hist_tool_ad9c11ef9',
              name: 'glob',
              response: {
                error: "params must have required property 'pattern'",
              },
            },
          },
        ],
      },
      {
        role: 'model',
        parts: [
          {
            text: 'Let me correct my approach',
          },
        ],
      },
    ];

    // Convert contents to messages
    const messages = (
      wrapper as {
        convertContentsToMessages: (contents: Content[]) => Array<{
          role: 'user' | 'assistant';
          content: Array<
            | { type: 'text'; text: string }
            | { type: 'tool_use'; id: string; name: string; input: unknown }
            | { type: 'tool_result'; tool_use_id: string; content: string }
          >;
        }>;
      }
    ).convertContentsToMessages(geminiContents);

    // Should have converted to Anthropic format
    expect(messages).toHaveLength(2);

    // First message should be tool response in Anthropic format
    const toolMessage = messages[0];
    expect(toolMessage.role).toBe('user'); // Anthropic uses 'user' for tool responses
    expect(toolMessage.content).toBeInstanceOf(Array);

    const toolContent = toolMessage.content as Array<
      | { type: 'text'; text: string }
      | { type: 'tool_use'; id: string; name: string; input: unknown }
      | { type: 'tool_result'; tool_use_id: string; content: string }
    >;
    expect(toolContent).toHaveLength(1);
    expect(toolContent[0].type).toBe('tool_result');
    expect(toolContent[0].tool_use_id).toMatch(/^toolu_/);
    expect(toolContent[0].tool_use_id).toBe('toolu_ad9c11ef9');

    // Second message should be assistant text
    const assistantMessage = messages[1];
    expect(assistantMessage.role).toBe('assistant');
    expect(assistantMessage.content).toBeInstanceOf(Array);

    const assistantContent = assistantMessage.content as Array<
      | { type: 'text'; text: string }
      | { type: 'tool_use'; id: string; name: string; input: unknown }
      | { type: 'tool_result'; tool_use_id: string; content: string }
    >;
    expect(assistantContent).toHaveLength(1);
    expect(assistantContent[0].type).toBe('text');
    expect(assistantContent[0].text).toBe('Let me correct my approach');
  });

  it('🔥 MUST convert Gemini format to OpenAI format when provider is OpenAI', () => {
    // Mock OpenAI provider
    const mockOpenAIProvider: IProvider = {
      name: 'openai',
      generateChatCompletion: vi.fn().mockImplementation(async function* () {
        yield {
          role: 'assistant',
          content: 'response',
        };
      }),
      registerServerTools: vi.fn(),
    };

    const wrapper = new GeminiCompatibleWrapper(mockOpenAIProvider);

    // Gemini format with tool call and response
    const geminiContents: Content[] = [
      {
        role: 'model',
        parts: [
          {
            functionCall: {
              id: 'hist_tool_c050a3d56',
              name: 'glob',
              args: { pattern: '*.ts' },
            },
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'hist_tool_c050a3d56',
              name: 'glob',
              response: {
                output: 'Found 50 files',
              },
            },
          },
        ],
      },
    ];

    // Convert contents to messages
    const messages = (
      wrapper as {
        convertContentsToMessages: (contents: Content[]) => Array<{
          role: string;
          content?: string;
          tool_calls?: Array<{
            id: string;
            type: string;
            function: { name: string; arguments: string };
          }>;
          tool_call_id?: string;
          name?: string;
        }>;
      }
    ).convertContentsToMessages(geminiContents);

    // Should have converted to OpenAI format
    expect(messages).toHaveLength(2);

    // First message should be assistant with tool_calls
    const callMessage = messages[0];
    expect(callMessage.role).toBe('assistant');
    expect(callMessage.tool_calls).toBeDefined();
    expect(callMessage.tool_calls).toHaveLength(1);
    expect(callMessage.tool_calls![0].id).toMatch(/^call_/);
    expect(callMessage.tool_calls![0].id).toBe('call_c050a3d56');

    // Second message should be tool response
    const responseMessage = messages[1];
    expect(responseMessage.role).toBe('tool');
    expect(responseMessage.tool_call_id).toBe('call_c050a3d56');
    expect(responseMessage.content).toContain('Found 50 files');
  });

  it('🔥 MUST handle orphaned tool responses correctly', () => {
    // Mock Anthropic provider
    const mockAnthropicProvider: IProvider = {
      name: 'anthropic',
      generateChatCompletion: vi.fn().mockImplementation(async function* () {
        yield {
          role: 'assistant',
          content: [{ type: 'text', text: 'response' }],
        };
      }),
      registerServerTools: vi.fn(),
    };

    const wrapper = new GeminiCompatibleWrapper(mockAnthropicProvider);

    // Orphaned tool response (no matching tool call)
    const geminiContents: Content[] = [
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'orphaned_id',
              name: 'unknown_tool',
              response: {
                error: 'This is orphaned',
              },
            },
          },
        ],
      },
    ];

    // Convert contents to messages
    const messages = (
      wrapper as {
        convertContentsToMessages: (contents: Content[]) => Array<{
          role: 'user' | 'assistant';
          content: Array<
            | { type: 'text'; text: string }
            | { type: 'tool_use'; id: string; name: string; input: unknown }
            | { type: 'tool_result'; tool_use_id: string; content: string }
          >;
        }>;
      }
    ).convertContentsToMessages(geminiContents);

    // Should still convert but with normalized ID
    expect(messages).toHaveLength(1);

    const toolMessage = messages[0];
    expect(toolMessage.role).toBe('user');
    expect(toolMessage.content).toBeInstanceOf(Array);

    const toolContent = toolMessage.content as Array<
      | { type: 'text'; text: string }
      | { type: 'tool_use'; id: string; name: string; input: unknown }
      | { type: 'tool_result'; tool_use_id: string; content: string }
    >;
    expect(toolContent[0].type).toBe('tool_result');
    // Orphaned responses should still get normalized IDs
    expect(toolContent[0].tool_use_id).toMatch(/^toolu_/);
  });
});
