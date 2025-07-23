import { describe, it, expect } from 'vitest';
import { buildResponsesRequest } from './buildResponsesRequest.js';
import { IMessage } from '../IMessage.js';
import { ContentGeneratorRole } from '../ContentGeneratorRole.js';
describe('buildResponsesRequest - tool_calls stripping', () => {
  it('should strip tool_calls from messages when building request', () => {
    const messages: IMessage[] = [
      {
        role: ContentGeneratorRole.USER,
        content: 'What is the weather?',
      },
      {
        role: ContentGeneratorRole.ASSISTANT,
        content: '',
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"location": "San Francisco"}',
            },
          },
        ],
      },
      {
        role: ContentGeneratorRole.TOOL,
        content: 'Sunny, 72°F',
        tool_call_id: 'call_123',
      },
    ];

    const request = buildResponsesRequest({
      model: 'o3',
      messages,
      stream: true,
    });

    // Check that input messages don't have tool_calls
    expect(request.input).toBeDefined();
    expect(request.input?.length).toBe(4); // 2 regular messages + 1 function_call + 1 function_call_output

    // First message should be unchanged
    expect(request.input?.[0]).toEqual({
      role: ContentGeneratorRole.USER,
      content: 'What is the weather?',
    });

    // Second message should have tool_calls stripped
    expect(request.input?.[1]).toEqual({
      role: ContentGeneratorRole.ASSISTANT,
      content: '',
    });
    expect(
      (request.input?.[1] as Record<string, unknown>).tool_calls,
    ).toBeUndefined();

    // Third entry should be the function_call
    expect(request.input?.[2]).toEqual({
      type: 'function_call',
      call_id: 'call_123',
      name: 'get_weather',
      arguments: '{"location": "San Francisco"}',
    });

    // Fourth entry should be the function_call_output
    expect(request.input?.[3]).toEqual({
      type: 'function_call_output',
      call_id: 'call_123',
      output: 'Sunny, 72°F',
    });
  });

  it('should handle messages without tool_calls', () => {
    const messages: IMessage[] = [
      {
        role: ContentGeneratorRole.USER,
        content: 'Hello',
      },
      {
        role: ContentGeneratorRole.ASSISTANT,
        content: 'Hi there!',
      },
    ];

    const request = buildResponsesRequest({
      model: 'o3',
      messages,
    });

    expect(request.input).toEqual([
      {
        role: ContentGeneratorRole.USER,
        content: 'Hello',
      },
      {
        role: ContentGeneratorRole.ASSISTANT,
        content: 'Hi there!',
      },
    ]);
  });

  it('should preserve usage data when stripping tool_calls', () => {
    const messages: IMessage[] = [
      {
        role: ContentGeneratorRole.ASSISTANT,
        content: 'Let me check the weather',
        tool_calls: [
          {
            id: 'call_456',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{}',
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      },
    ];

    const request = buildResponsesRequest({
      model: 'o3',
      messages,
    });

    // Should strip tool_calls but keep usage
    expect(request.input?.[0]).toEqual({
      role: ContentGeneratorRole.ASSISTANT,
      content: 'Let me check the weather',
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    });
    expect(
      (request.input?.[0] as Record<string, unknown>).tool_calls,
    ).toBeUndefined();
  });
});
