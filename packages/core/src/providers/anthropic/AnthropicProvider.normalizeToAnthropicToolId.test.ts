import { describe, it, expect } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';

type TestAnthropicProvider = AnthropicProvider & {
  normalizeToAnthropicToolId(id: string): string;
};

describe('AnthropicProvider.normalizeToAnthropicToolId', () => {
  describe('existing formats (backward compatibility)', () => {
    it('returns Anthropic format as-is', () => {
      const provider = new AnthropicProvider(
        'test-key',
      ) as TestAnthropicProvider;
      const result = provider.normalizeToAnthropicToolId('toolu_abc123');
      expect(result).toBe('toolu_abc123');
    });

    it('converts history format to Anthropic format', () => {
      const provider = new AnthropicProvider(
        'test-key',
      ) as TestAnthropicProvider;
      const result = provider.normalizeToAnthropicToolId('hist_tool_xyz789');
      expect(result).toBe('toolu_xyz789');
    });

    it('converts OpenAI format to Anthropic format', () => {
      const provider = new AnthropicProvider(
        'test-key',
      ) as TestAnthropicProvider;
      const result = provider.normalizeToAnthropicToolId('call_def456');
      expect(result).toBe('toolu_def456');
    });

    it('handles raw UUID by adding Anthropic prefix', () => {
      const provider = new AnthropicProvider(
        'test-key',
      ) as TestAnthropicProvider;
      const result = provider.normalizeToAnthropicToolId('ghi012');
      expect(result).toBe('toolu_ghi012');
    });
  });

  describe('issue #964: Kimi-style IDs with invalid characters', () => {
    it('normalizes Kimi "functions.toolname:0" format to valid Anthropic ID', () => {
      const provider = new AnthropicProvider(
        'test-key',
      ) as TestAnthropicProvider;
      const result = provider.normalizeToAnthropicToolId(
        'functions.read_file:0',
      );
      expect(result).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(result).toMatch(/^toolu_/);
    });

    it('normalizes "call:bad/id" to valid Anthropic ID', () => {
      const provider = new AnthropicProvider(
        'test-key',
      ) as TestAnthropicProvider;
      const result = provider.normalizeToAnthropicToolId('call:bad/id');
      expect(result).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(result).toMatch(/^toolu_/);
    });

    it('removes colons from IDs', () => {
      const provider = new AnthropicProvider(
        'test-key',
      ) as TestAnthropicProvider;
      const result = provider.normalizeToAnthropicToolId('call:some:value');
      expect(result).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(result).not.toContain(':');
      expect(result).toMatch(/^toolu_/);
    });

    it('removes forward slashes from IDs', () => {
      const provider = new AnthropicProvider(
        'test-key',
      ) as TestAnthropicProvider;
      const result = provider.normalizeToAnthropicToolId('call/some/id');
      expect(result).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(result).not.toContain('/');
      expect(result).toMatch(/^toolu_/);
    });

    it('removes periods from IDs', () => {
      const provider = new AnthropicProvider(
        'test-key',
      ) as TestAnthropicProvider;
      const result = provider.normalizeToAnthropicToolId('call.some.id');
      expect(result).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(result).not.toContain('.');
      expect(result).toMatch(/^toolu_/);
    });

    it('handles multiple separators in same ID', () => {
      const provider = new AnthropicProvider(
        'test-key',
      ) as TestAnthropicProvider;
      const result = provider.normalizeToAnthropicToolId('call:some/id.value');
      expect(result).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(result).not.toContain(':');
      expect(result).not.toContain('/');
      expect(result).not.toContain('.');
      expect(result).toMatch(/^toolu_/);
    });

    it('produces deterministic output for same input', () => {
      const provider = new AnthropicProvider(
        'test-key',
      ) as TestAnthropicProvider;
      const input = 'functions.read_file:0';
      const result1 = provider.normalizeToAnthropicToolId(input);
      const result2 = provider.normalizeToAnthropicToolId(input);
      expect(result1).toBe(result2);
    });

    it('produces deterministic output for different invalid IDs but same hash', () => {
      const provider = new AnthropicProvider(
        'test-key',
      ) as TestAnthropicProvider;
      const result1 = provider.normalizeToAnthropicToolId('call:bad/id');
      const result2 = provider.normalizeToAnthropicToolId('call:bad/id');
      expect(result1).toBe(result2);
    });
  });

  describe('issue #964: edge cases with special characters', () => {
    it('handles IDs with spaces', () => {
      const provider = new AnthropicProvider(
        'test-key',
      ) as TestAnthropicProvider;
      const result = provider.normalizeToAnthropicToolId('call with spaces');
      expect(result).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(result).not.toContain(' ');
      expect(result).toMatch(/^toolu_/);
    });

    it('handles IDs with special characters', () => {
      const provider = new AnthropicProvider(
        'test-key',
      ) as TestAnthropicProvider;
      const result = provider.normalizeToAnthropicToolId('call@#$%^&*()');
      expect(result).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(result).not.toMatch(/[@#$%^&*()]/);
      expect(result).toMatch(/^toolu_/);
    });

    it('handles empty string', () => {
      const provider = new AnthropicProvider(
        'test-key',
      ) as TestAnthropicProvider;
      const result = provider.normalizeToAnthropicToolId('');
      expect(result).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(result).toMatch(/^toolu_/);
    });

    it('handles only invalid characters', () => {
      const provider = new AnthropicProvider(
        'test-key',
      ) as TestAnthropicProvider;
      const result = provider.normalizeToAnthropicToolId('::///...');
      expect(result).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(result).toMatch(/^toolu_/);
    });
  });
});
