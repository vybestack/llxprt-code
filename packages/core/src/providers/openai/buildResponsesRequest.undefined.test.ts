import { describe, it, expect } from 'vitest';
import { buildResponsesRequest } from './buildResponsesRequest.js';
import { IMessage } from '../IMessage.js';
import { ContentGeneratorRole } from '../ContentGeneratorRole.js';
describe('buildResponsesRequest - undefined message handling', () => {
  it('should filter out undefined messages', () => {
    const messages: Array<IMessage | undefined | null> = [
      { role: ContentGeneratorRole.USER, content: 'Hello' },
      undefined,
      { role: ContentGeneratorRole.ASSISTANT, content: 'Hi there!' },
      null,
      { role: ContentGeneratorRole.USER, content: 'How are you?' },
    ];

    const request = buildResponsesRequest({
      model: 'gpt-4o',
      messages: messages as IMessage[],
    });

    expect(request.input).toBeDefined();
    expect(request.input?.length).toBe(3);
    // Type guard to check if message has content property
    const msg0 = request.input?.[0];
    const msg1 = request.input?.[1];
    const msg2 = request.input?.[2];
    expect(msg0 && 'content' in msg0 ? msg0.content : undefined).toBe('Hello');
    expect(msg1 && 'content' in msg1 ? msg1.content : undefined).toBe(
      'Hi there!',
    );
    expect(msg2 && 'content' in msg2 ? msg2.content : undefined).toBe(
      'How are you?',
    );
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
