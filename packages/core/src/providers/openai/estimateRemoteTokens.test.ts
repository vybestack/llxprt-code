import { describe, it, expect, beforeEach } from 'vitest';
import {
  estimateRemoteTokens,
  estimateMessagesTokens,
  MODEL_CONTEXT_SIZE,
} from './estimateRemoteTokens.js';
import { ConversationCache } from './ConversationCache.js';
import { IMessage } from '../IMessage.js';
import { ContentGeneratorRole } from '../ContentGeneratorRole.js';
describe('estimateRemoteTokens', () => {
  let cache: ConversationCache;

  beforeEach(() => {
    cache = new ConversationCache();
  });

  it('should calculate context usage with no remote tokens', () => {
    const result = estimateRemoteTokens(
      'gpt-4o',
      cache,
      undefined,
      undefined,
      1000, // prompt tokens
    );

    expect(result).toEqual({
      totalTokens: 1000,
      remoteTokens: 0,
      promptTokens: 1000,
      maxTokens: 128000,
      contextUsedPercent: (1000 / 128000) * 100,
      tokensRemaining: 127000,
    });
  });

  it('should include remote tokens in calculation', () => {
    // Set up cache with accumulated tokens
    cache.set('conv1', 'parent1', [], 50000);

    const result = estimateRemoteTokens(
      'gpt-4o',
      cache,
      'conv1',
      'parent1',
      2000, // prompt tokens
    );

    expect(result).toEqual({
      totalTokens: 52000,
      remoteTokens: 50000,
      promptTokens: 2000,
      maxTokens: 128000,
      contextUsedPercent: (52000 / 128000) * 100,
      tokensRemaining: 76000,
    });
  });

  it('should handle context overflow', () => {
    // Set up cache with large accumulated tokens
    cache.set('conv1', 'parent1', [], 125000);

    const result = estimateRemoteTokens(
      'gpt-4o',
      cache,
      'conv1',
      'parent1',
      5000, // prompt tokens
    );

    expect(result).toEqual({
      totalTokens: 130000,
      remoteTokens: 125000,
      promptTokens: 5000,
      maxTokens: 128000,
      contextUsedPercent: 100, // Capped at 100%
      tokensRemaining: 0, // No tokens remaining
    });
  });

  it('should use correct model context sizes', () => {
    // Test GPT-3.5 with smaller context
    const result = estimateRemoteTokens(
      'gpt-3.5-turbo',
      cache,
      undefined,
      undefined,
      10000,
    );

    expect(result.maxTokens).toBe(16385);
    expect(result.tokensRemaining).toBe(6385);

    // Test o3 model
    const o3Result = estimateRemoteTokens(
      'o3',
      cache,
      undefined,
      undefined,
      10000,
    );

    expect(o3Result.maxTokens).toBe(200000);
  });

  it('should use default context size for unknown models', () => {
    const result = estimateRemoteTokens(
      'unknown-model',
      cache,
      undefined,
      undefined,
      1000,
    );

    expect(result.maxTokens).toBe(MODEL_CONTEXT_SIZE.default);
  });
});

describe('estimateMessagesTokens', () => {
  it('should estimate tokens for simple messages', () => {
    const messages: IMessage[] = [
      { role: ContentGeneratorRole.USER, content: 'Hello, how are you?' },
      {
        role: ContentGeneratorRole.ASSISTANT,
        content: 'I am doing well, thank you!',
      },
    ];

    const tokens = estimateMessagesTokens(messages);

    // Rough calculation: ~4 chars per token + role overhead
    // "Hello, how are you?" = 19 chars
    // "I am doing well, thank you!" = 28 chars
    // Plus role overhead (8 chars each) = 16
    // Total: 19 + 28 + 16 = 63 chars / 4 = ~16 tokens
    expect(tokens).toBeGreaterThan(10);
    expect(tokens).toBeLessThan(25);
  });

  it('should handle empty messages', () => {
    const messages: IMessage[] = [];
    const tokens = estimateMessagesTokens(messages);
    expect(tokens).toBe(0);
  });

  it('should include tool calls in estimation', () => {
    const messages: IMessage[] = [
      {
        role: ContentGeneratorRole.ASSISTANT,
        content: 'Let me search for that.',
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'search',
              arguments: '{"query": "weather in San Francisco"}',
            },
          },
        ],
      },
    ];

    const tokens = estimateMessagesTokens(messages);

    // Should include content + tool call JSON
    expect(tokens).toBeGreaterThan(20);
  });

  it('should handle messages with no content', () => {
    const messages: IMessage[] = [
      { role: ContentGeneratorRole.USER, content: '' }, // No content
      { role: ContentGeneratorRole.ASSISTANT, content: '' }, // Empty content
    ];

    const tokens = estimateMessagesTokens(messages);

    // Should still count role overhead
    expect(tokens).toBeGreaterThan(0);
  });

  it('should handle very long messages', () => {
    const longContent = 'a'.repeat(10000); // 10k characters
    const messages: IMessage[] = [
      { role: ContentGeneratorRole.USER, content: longContent },
    ];

    const tokens = estimateMessagesTokens(messages);

    // ~10k chars / 4 = ~2500 tokens
    expect(tokens).toBeGreaterThan(2000);
    expect(tokens).toBeLessThan(3000);
  });
});
