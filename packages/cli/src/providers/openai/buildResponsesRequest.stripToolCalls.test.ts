import { describe, it, expect } from 'vitest';
import { buildResponsesRequest } from './buildResponsesRequest';
import { IMessage } from '../index.js';

describe('buildResponsesRequest - tool_calls stripping', () => {
  it('should strip tool_calls from messages when building request', () => {
    const messages: IMessage[] = [
      {
        role: 'user',
        content: 'What is the weather?',
      },
      {
        role: 'assistant',
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
        role: 'tool',
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
    expect(request.input?.length).toBe(3); // 2 regular messages + 1 function_call_output

    // First message should be unchanged
    expect(request.input?.[0]).toEqual({
      role: 'user',
      content: 'What is the weather?',
    });

    // Second message should have tool_calls stripped
    expect(request.input?.[1]).toEqual({
      role: 'assistant',
      content: '',
    });
    expect(
      (request.input?.[1] as Record<string, unknown>).tool_calls,
    ).toBeUndefined();

    // Third entry should be the function_call_output
    expect(request.input?.[2]).toEqual({
      type: 'function_call_output',
      call_id: 'call_123',
      output: 'Sunny, 72°F',
    });
  });

  it('should handle messages without tool_calls', () => {
    const messages: IMessage[] = [
      {
        role: 'user',
        content: 'Hello',
      },
      {
        role: 'assistant',
        content: 'Hi there!',
      },
    ];

    const request = buildResponsesRequest({
      model: 'o3',
      messages,
    });

    expect(request.input).toEqual([
      {
        role: 'user',
        content: 'Hello',
      },
      {
        role: 'assistant',
        content: 'Hi there!',
      },
    ]);
  });

  it('should preserve usage data when stripping tool_calls', () => {
    const messages: IMessage[] = [
      {
        role: 'assistant',
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
      role: 'assistant',
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
