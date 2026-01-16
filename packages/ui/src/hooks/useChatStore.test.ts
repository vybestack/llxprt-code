import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { useChatStore } from './useChatStore';

// Simple renderHook implementation for testing React hooks
function renderHook<T>(hook: () => T): { result: { current: T } } {
  const result = { current: hook() };
  return { result };
}

describe('useChatStore message handling', () => {
  let idCounter = 0;
  const makeId = () => `test-${idCounter++}`;

  it('should append a system message', () => {
    const { result } = renderHook(() => useChatStore(makeId));

    act(() => {
      result.current.appendMessage('system', 'System notification');
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]).toMatchObject({
      kind: 'message',
      role: 'system',
      text: 'System notification',
    });
  });

  it('should append a model message', () => {
    const { result } = renderHook(() => useChatStore(makeId));

    act(() => {
      result.current.appendMessage('model', 'Model response');
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]).toMatchObject({
      kind: 'message',
      role: 'model',
      text: 'Model response',
    });
  });

  it('should store messages with correct role', () => {
    const { result } = renderHook(() => useChatStore(makeId));

    act(() => {
      result.current.appendMessage('user', 'User input');
      result.current.appendMessage('model', 'Model response');
      result.current.appendMessage('thinking', 'Model thinking');
      result.current.appendMessage('system', 'System message');
    });

    expect(result.current.entries).toHaveLength(4);
    const messages = result.current.entries.filter((e) => e.kind === 'message');
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('model');
    expect(messages[2].role).toBe('thinking');
    expect(messages[3].role).toBe('system');
  });

  it('should append text to an existing message', () => {
    const { result } = renderHook(() => useChatStore(makeId));

    let messageId: string;
    act(() => {
      messageId = result.current.appendMessage('model', 'First line');
    });

    act(() => {
      result.current.appendToMessage(messageId!, '\nSecond line');
    });

    expect(result.current.entries).toHaveLength(1);
    const message = result.current.entries[0];
    expect(message.kind).toBe('message');
    expect((message as { text: string }).text).toBe('First line\nSecond line');
  });

  it('should return the message id from appendMessage', () => {
    const { result } = renderHook(() => useChatStore(makeId));

    let messageId: string;
    act(() => {
      messageId = result.current.appendMessage('user', 'Test message');
    });

    expect(messageId!).toBeDefined();
    expect(typeof messageId!).toBe('string');
    expect(result.current.entries[0].id).toBe(messageId!);
  });

  it('should clear all entries and reset counts', () => {
    const { result } = renderHook(() => useChatStore(makeId));

    // Add some entries and update counts
    act(() => {
      result.current.appendMessage('user', 'First message');
      result.current.appendMessage('model', 'Response');
      result.current.setPromptCount(5);
      result.current.setResponderWordCount(100);
    });

    expect(result.current.entries).toHaveLength(2);
    expect(result.current.promptCount).toBe(5);
    expect(result.current.responderWordCount).toBe(100);

    // Clear everything
    act(() => {
      result.current.clearEntries();
    });

    expect(result.current.entries).toHaveLength(0);
    expect(result.current.promptCount).toBe(0);
    expect(result.current.responderWordCount).toBe(0);
  });
});
