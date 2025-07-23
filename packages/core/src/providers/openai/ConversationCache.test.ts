import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConversationCache } from './ConversationCache.js';
import { IMessage } from '../IMessage.js';
import { ContentGeneratorRole } from '../ContentGeneratorRole.js';
describe('ConversationCache', () => {
  let cache: ConversationCache;

  beforeEach(() => {
    cache = new ConversationCache(3, 2); // Small cache for testing
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createMessage = (content: string): IMessage => ({
    role: ContentGeneratorRole.ASSISTANT,
    content,
  });

  it('should store and retrieve messages', () => {
    const messages = [createMessage('Hello'), createMessage('World')];

    cache.set('conv1', 'parent1', messages);

    const retrieved = cache.get('conv1', 'parent1');
    expect(retrieved).toEqual(messages);
  });

  it('should return null for non-existent conversations', () => {
    const retrieved = cache.get('nonexistent', 'parent');
    expect(retrieved).toBeNull();
  });

  it('should respect TTL and expire old entries', () => {
    const messages = [createMessage('Test message')];

    cache.set('conv1', 'parent1', messages);
    expect(cache.get('conv1', 'parent1')).toEqual(messages);

    // Fast forward past TTL (2 hours + 1 minute)
    vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 60 * 1000);

    expect(cache.get('conv1', 'parent1')).toBeNull();
    expect(cache.has('conv1', 'parent1')).toBe(false);
  });

  it('should evict oldest entries when max size is reached', () => {
    const messages1 = [createMessage('Message 1')];
    const messages2 = [createMessage('Message 2')];
    const messages3 = [createMessage('Message 3')];
    const messages4 = [createMessage('Message 4')];

    cache.set('conv1', 'parent1', messages1);
    cache.set('conv2', 'parent2', messages2);
    cache.set('conv3', 'parent3', messages3);

    // Cache is now full (max size = 3)
    expect(cache.size()).toBe(3);

    // Adding a fourth item should evict the oldest (conv1)
    cache.set('conv4', 'parent4', messages4);

    expect(cache.size()).toBe(3);
    expect(cache.get('conv1', 'parent1')).toBeNull();
    expect(cache.get('conv2', 'parent2')).toEqual(messages2);
    expect(cache.get('conv3', 'parent3')).toEqual(messages3);
    expect(cache.get('conv4', 'parent4')).toEqual(messages4);
  });

  it('should update access order on get', () => {
    const messages1 = [createMessage('Message 1')];
    const messages2 = [createMessage('Message 2')];
    const messages3 = [createMessage('Message 3')];
    const messages4 = [createMessage('Message 4')];

    cache.set('conv1', 'parent1', messages1);
    cache.set('conv2', 'parent2', messages2);
    cache.set('conv3', 'parent3', messages3);

    // Access conv1 to move it to the end
    cache.get('conv1', 'parent1');

    // Now adding conv4 should evict conv2 (oldest unaccessed)
    cache.set('conv4', 'parent4', messages4);

    expect(cache.get('conv1', 'parent1')).toEqual(messages1);
    expect(cache.get('conv2', 'parent2')).toBeNull();
    expect(cache.get('conv3', 'parent3')).toEqual(messages3);
    expect(cache.get('conv4', 'parent4')).toEqual(messages4);
  });

  it('should handle has() method correctly', () => {
    const messages = [createMessage('Test')];

    cache.set('conv1', 'parent1', messages);

    expect(cache.has('conv1', 'parent1')).toBe(true);
    expect(cache.has('conv2', 'parent2')).toBe(false);

    // Test expiration
    vi.advanceTimersByTime(3 * 60 * 60 * 1000); // 3 hours
    expect(cache.has('conv1', 'parent1')).toBe(false);
  });

  it('should clear all entries', () => {
    cache.set('conv1', 'parent1', [createMessage('Message 1')]);
    cache.set('conv2', 'parent2', [createMessage('Message 2')]);

    expect(cache.size()).toBe(2);

    cache.clear();

    expect(cache.size()).toBe(0);
    expect(cache.get('conv1', 'parent1')).toBeNull();
    expect(cache.get('conv2', 'parent2')).toBeNull();
  });

  it('should handle updating existing entries', () => {
    const messages1 = [createMessage('Original')];
    const messages2 = [createMessage('Updated')];

    cache.set('conv1', 'parent1', messages1);
    expect(cache.get('conv1', 'parent1')).toEqual(messages1);

    // Update with new messages
    cache.set('conv1', 'parent1', messages2);
    expect(cache.get('conv1', 'parent1')).toEqual(messages2);

    // Should still have only one entry
    expect(cache.size()).toBe(1);
  });

  it('should use different keys for different conversation/parent combinations', () => {
    const messages1 = [createMessage('Conv1 Parent1')];
    const messages2 = [createMessage('Conv1 Parent2')];
    const messages3 = [createMessage('Conv2 Parent1')];

    cache.set('conv1', 'parent1', messages1);
    cache.set('conv1', 'parent2', messages2);
    cache.set('conv2', 'parent1', messages3);

    expect(cache.get('conv1', 'parent1')).toEqual(messages1);
    expect(cache.get('conv1', 'parent2')).toEqual(messages2);
    expect(cache.get('conv2', 'parent1')).toEqual(messages3);
    expect(cache.size()).toBe(3);
  });
});
