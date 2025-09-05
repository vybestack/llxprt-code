import { describe, it, expect } from 'vitest';
import { buildResponsesRequest } from './buildResponsesRequest.js';
import { IContent } from '../../services/history/IContent.js';
describe('buildResponsesRequest - undefined message handling', () => {
  it('should filter out undefined messages', () => {
    const messages: Array<IContent | undefined | null> = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
      undefined,
      { speaker: 'ai', blocks: [{ type: 'text', text: 'Hi there!' }] },
      null,
      { speaker: 'human', blocks: [{ type: 'text', text: 'How are you?' }] },
    ];

    const request = buildResponsesRequest({
      model: 'gpt-4o',
      messages: messages as IContent[],
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
    const messages: Array<IContent | undefined | null> = [
      undefined,
      null,
      undefined,
    ];

    const request = buildResponsesRequest({
      model: 'gpt-4o',
      messages: messages as IContent[],
    });

    expect(request.input).toBeDefined();
    expect(request.input?.length).toBe(0);
  });

  it('should handle empty array after filtering', () => {
    const messages: IContent[] = [];

    expect(() => {
      buildResponsesRequest({
        model: 'gpt-4o',
        messages,
      });
    }).toThrow('Either "prompt" or "messages" must be provided.');
  });
});
