import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationCache } from './ConversationCache.js';
import { IMessage } from '../IMessage.js';
import { ContentGeneratorRole } from '../ContentGeneratorRole.js';

describe('ConversationCache.accumTokens', () => {
  let cache: ConversationCache;

  beforeEach(() => {
    cache = new ConversationCache();
  });

  it('should initialize with zero accumulated tokens', () => {
    const tokens = cache.getAccumulatedTokens('conv1', 'parent1');
    expect(tokens).toBe(0);
  });

  it('should store and retrieve accumulated tokens', () => {
    const messages: IMessage[] = [
      { role: ContentGeneratorRole.ASSISTANT, content: 'Hello world' },
    ];

    cache.set('conv1', 'parent1', messages, 1500);

    const tokens = cache.getAccumulatedTokens('conv1', 'parent1');
    expect(tokens).toBe(1500);
  });

  it('should update token count incrementally', () => {
    const messages: IMessage[] = [
      { role: ContentGeneratorRole.ASSISTANT, content: 'First response' },
    ];

    // First interaction
    cache.set('conv1', 'parent1', messages, 1000);
    expect(cache.getAccumulatedTokens('conv1', 'parent1')).toBe(1000);

    // Update token count
    cache.updateTokenCount('conv1', 'parent1', 500);
    expect(cache.getAccumulatedTokens('conv1', 'parent1')).toBe(1500);

    // Another update
    cache.updateTokenCount('conv1', 'parent1', 300);
    expect(cache.getAccumulatedTokens('conv1', 'parent1')).toBe(1800);
  });

  it('should handle different conversation/parent combinations', () => {
    const messages: IMessage[] = [
      { role: ContentGeneratorRole.ASSISTANT, content: 'Response' },
    ];

    cache.set('conv1', 'parent1', messages, 1000);
    cache.set('conv1', 'parent2', messages, 2000);
    cache.set('conv2', 'parent1', messages, 3000);

    expect(cache.getAccumulatedTokens('conv1', 'parent1')).toBe(1000);
    expect(cache.getAccumulatedTokens('conv1', 'parent2')).toBe(2000);
    expect(cache.getAccumulatedTokens('conv2', 'parent1')).toBe(3000);
  });

  it('should return 0 for non-existent entries', () => {
    expect(cache.getAccumulatedTokens('nonexistent', 'parent')).toBe(0);
  });

  it('should return 0 for expired entries', () => {
    // Create cache with very short TTL (1ms)
    const shortCache = new ConversationCache(100, 0.000000278); // 1ms in hours
    const messages: IMessage[] = [
      { role: ContentGeneratorRole.ASSISTANT, content: 'Response' },
    ];

    shortCache.set('conv1', 'parent1', messages, 1000);

    // Wait for expiry
    setTimeout(() => {
      expect(shortCache.getAccumulatedTokens('conv1', 'parent1')).toBe(0);
    }, 5);
  });

  it('should invalidate entries and reset token count', () => {
    const messages: IMessage[] = [
      { role: ContentGeneratorRole.ASSISTANT, content: 'Response' },
    ];

    cache.set('conv1', 'parent1', messages, 5000);
    expect(cache.getAccumulatedTokens('conv1', 'parent1')).toBe(5000);

    // Invalidate the entry
    cache.invalidate('conv1', 'parent1');

    // Should return 0 after invalidation
    expect(cache.getAccumulatedTokens('conv1', 'parent1')).toBe(0);
    expect(cache.has('conv1', 'parent1')).toBe(false);
  });

  it('should not update token count for non-existent entries', () => {
    // Try to update a non-existent entry
    cache.updateTokenCount('nonexistent', 'parent', 1000);

    // Should still return 0
    expect(cache.getAccumulatedTokens('nonexistent', 'parent')).toBe(0);
  });

  it('should maintain token count through cache eviction', () => {
    // Create a small cache
    const smallCache = new ConversationCache(2);
    const messages: IMessage[] = [
      { role: ContentGeneratorRole.ASSISTANT, content: 'Response' },
    ];

    // Fill the cache
    smallCache.set('conv1', 'parent1', messages, 1000);
    smallCache.set('conv2', 'parent2', messages, 2000);

    // This should evict the oldest entry (conv1/parent1)
    smallCache.set('conv3', 'parent3', messages, 3000);

    // Oldest entry should be evicted
    expect(smallCache.getAccumulatedTokens('conv1', 'parent1')).toBe(0);

    // Others should remain
    expect(smallCache.getAccumulatedTokens('conv2', 'parent2')).toBe(2000);
    expect(smallCache.getAccumulatedTokens('conv3', 'parent3')).toBe(3000);
  });
});
