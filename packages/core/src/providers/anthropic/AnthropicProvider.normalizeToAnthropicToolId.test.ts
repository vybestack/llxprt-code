import { describe, it, expect } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';

type TestAnthropicProvider = AnthropicProvider & {
  normalizeToAnthropicToolId(id: string): string;
};

describe('AnthropicProvider.normalizeToAnthropicToolId', () => {
  it('returns Anthropic format as-is', () => {
    const provider = new AnthropicProvider('test-key') as TestAnthropicProvider;
    const result = provider.normalizeToAnthropicToolId('toolu_abc123');
    expect(result).toBe('toolu_abc123');
  });

  it('converts history format to Anthropic format', () => {
    const provider = new AnthropicProvider('test-key') as TestAnthropicProvider;
    const result = provider.normalizeToAnthropicToolId('hist_tool_xyz789');
    expect(result).toBe('toolu_xyz789');
  });

  it('converts OpenAI format to Anthropic format', () => {
    const provider = new AnthropicProvider('test-key') as TestAnthropicProvider;
    const result = provider.normalizeToAnthropicToolId('call_def456');
    expect(result).toBe('toolu_def456');
  });

  it('handles raw IDs by adding Anthropic prefix', () => {
    const provider = new AnthropicProvider('test-key') as TestAnthropicProvider;
    const result = provider.normalizeToAnthropicToolId('ghi012');
    expect(result).toBe('toolu_ghi012');
  });

  it('handles empty IDs gracefully by generating a fallback', () => {
    const provider = new AnthropicProvider('test-key') as TestAnthropicProvider;
    const result = provider.normalizeToAnthropicToolId('');
    // When ID is empty, a deterministic fallback is generated
    expect(result).toMatch(/^toolu_[a-f0-9]{16}$/);
  });
});
