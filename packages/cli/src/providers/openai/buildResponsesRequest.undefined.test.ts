import { describe, it, expect } from 'vitest';
import { buildResponsesRequest } from './buildResponsesRequest';
import { IMessage } from '../index.js';

describe('buildResponsesRequest - undefined message handling', () => {
  it('should filter out undefined messages', () => {
    const messages: Array<IMessage | undefined | null> = [
      { role: 'user', content: 'Hello' },
      undefined,
      { role: 'assistant', content: 'Hi there!' },
      null,
      { role: 'user', content: 'How are you?' },
    ];

    const request = buildResponsesRequest({
      model: 'gpt-4o',
      messages: messages as IMessage[],
    });

    expect(request.input).toBeDefined();
    expect(request.input?.length).toBe(3);
    expect(request.input?.[0].content).toBe('Hello');
    expect(request.input?.[1].content).toBe('Hi there!');
    expect(request.input?.[2].content).toBe('How are you?');
  });

  it('should handle all undefined messages', () => {
    const messages: Array<IMessage | undefined | null> = [
      undefined,
      null,
      undefined,
    ];

    const request = buildResponsesRequest({
      model: 'gpt-4o',
      messages: messages as IMessage[],
    });

    expect(request.input).toBeDefined();
    expect(request.input?.length).toBe(0);
  });

  it('should handle empty array after filtering', () => {
    const messages: IMessage[] = [];

    expect(() => {
      buildResponsesRequest({
        model: 'gpt-4o',
        messages,
      });
    }).toThrow('Either "prompt" or "messages" must be provided.');
  });
});
