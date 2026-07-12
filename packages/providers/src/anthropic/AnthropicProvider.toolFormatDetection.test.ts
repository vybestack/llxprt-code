import { describe, expect, it, vi } from 'bun:test';
import { AnthropicProvider } from './AnthropicProvider.js';

describe('AnthropicProvider tool format detection', () => {
  it('detects qwen format for GLM models', () => {
    const provider = new AnthropicProvider('test-key');
    vi.spyOn(provider, 'getCurrentModel').mockReturnValue('glm-4.6');

    expect(provider.getToolFormat()).toBe('qwen');
  });

  it('keeps anthropic format for non-GLM models', () => {
    const provider = new AnthropicProvider('test-key');
    vi.spyOn(provider, 'getCurrentModel').mockReturnValue('claude-3-7b');

    expect(provider.getToolFormat()).toBe('anthropic');
  });

  describe('getCurrentModel reflects configured model (Issue #2410)', () => {
    it('returns the provider-configured model instead of the hard-coded default', () => {
      const provider = new AnthropicProvider('test-key', undefined, {
        defaultModel: 'glm-5.2',
      });

      expect(provider.getCurrentModel()).toBe('glm-5.2');
      expect(provider.getCurrentModel()).not.toBe('claude-opus-4-8');
    });

    it('auto-detects qwen tool format for a configured GLM model WITHOUT mocking getCurrentModel', () => {
      const provider = new AnthropicProvider('test-key', undefined, {
        defaultModel: 'glm-5.2',
      });

      expect(provider.getToolFormat()).toBe('qwen');
    });

    it('falls back to the default model when nothing is configured', () => {
      const provider = new AnthropicProvider('test-key');

      expect(provider.getCurrentModel()).toBe('claude-opus-4-8');
    });
  });
});
