import { describe, it, expect } from 'vitest';
import { transformEvent, transformStream } from './llxprtAdapter';
import {
  GeminiEventType,
  type ServerGeminiContentEvent,
  type ServerGeminiThoughtEvent,
  type ServerGeminiToolCallRequestEvent,
  type ServerGeminiFinishedEvent,
  type ServerGeminiErrorEvent,
  type ServerGeminiStreamEvent,
} from '@vybestack/llxprt-code-core';
import { FinishReason } from '@google/genai';
import type { AdapterEvent } from '../../types/events';

describe('transformEvent', () => {
  it('should convert Content event to text_delta', () => {
    const input: ServerGeminiContentEvent = {
      type: GeminiEventType.Content,
      value: 'hello world',
    };
    const result = transformEvent(input);
    expect(result).toStrictEqual({ type: 'text_delta', text: 'hello world' });
  });

  it('should convert Thought event to thinking_delta', () => {
    const input: ServerGeminiThoughtEvent = {
      type: GeminiEventType.Thought,
      value: { subject: 'analysis', description: 'thinking about the problem' },
    };
    const result = transformEvent(input);
    expect(result).toStrictEqual({
      type: 'thinking_delta',
      text: 'thinking about the problem',
    });
  });

  it('should convert ToolCallRequest to tool_pending', () => {
    const input: ServerGeminiToolCallRequestEvent = {
      type: GeminiEventType.ToolCallRequest,
      value: {
        callId: 'call_123',
        name: 'read_file',
        args: { path: '/foo/bar.txt' },
        isClientInitiated: false,
        prompt_id: 'prompt_456',
      },
    };
    const result = transformEvent(input);
    expect(result).toStrictEqual({
      type: 'tool_pending',
      id: 'call_123',
      name: 'read_file',
      params: { path: '/foo/bar.txt' },
    });
  });

  it('should convert Finished to complete', () => {
    const input: ServerGeminiFinishedEvent = {
      type: GeminiEventType.Finished,
      value: { reason: FinishReason.STOP },
    };
    const result = transformEvent(input);
    expect(result).toStrictEqual({ type: 'complete' });
  });

  it('should convert Error to error event', () => {
    const input: ServerGeminiErrorEvent = {
      type: GeminiEventType.Error,
      value: { error: { message: 'something broke', status: 500 } },
    };
    const result = transformEvent(input);
    expect(result).toStrictEqual({ type: 'error', message: 'something broke' });
  });

  it('should handle unknown event type with fallback', () => {
    const input = {
      type: 'unknown_type' as GeminiEventType,
      value: { foo: 'bar' },
    } as unknown as ServerGeminiStreamEvent;
    const result = transformEvent(input);
    expect(result.type).toBe('unknown');
    expect(result).toHaveProperty('raw');
  });
});

describe('transformStream', () => {
  it('should yield transformed events from async iterable', async () => {
    const mockEvents: ServerGeminiStreamEvent[] = [
      {
        type: GeminiEventType.Content,
        value: 'Hello',
      } as ServerGeminiStreamEvent,
      {
        type: GeminiEventType.Content,
        value: ' world',
      } as ServerGeminiStreamEvent,
      {
        type: GeminiEventType.Finished,
        value: { reason: FinishReason.STOP },
      } as ServerGeminiStreamEvent,
    ];

    async function* mockStream(): AsyncGenerator<ServerGeminiStreamEvent> {
      for (const event of mockEvents) {
        yield await Promise.resolve(event);
      }
    }

    const results: AdapterEvent[] = [];
    for await (const event of transformStream(mockStream())) {
      results.push(event);
    }

    expect(results).toHaveLength(3);
    expect(results[0]).toStrictEqual({ type: 'text_delta', text: 'Hello' });
    expect(results[1]).toStrictEqual({ type: 'text_delta', text: ' world' });
    expect(results[2]).toStrictEqual({ type: 'complete' });
  });

  it('should handle empty stream', async () => {
    const createEmptyStream = (
      events: ServerGeminiStreamEvent[],
    ): AsyncGenerator<ServerGeminiStreamEvent> => {
      async function* generator(): AsyncGenerator<ServerGeminiStreamEvent> {
        for (const event of events) {
          yield await Promise.resolve(event);
        }
      }
      return generator();
    };

    const results: AdapterEvent[] = [];
    for await (const event of transformStream(createEmptyStream([]))) {
      results.push(event);
    }

    expect(results).toHaveLength(0);
  });
});
