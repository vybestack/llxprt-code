import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { OpenAIProvider } from './OpenAIProvider.js';

describe('OpenAIProvider tool format detection', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider('test-key');
  });

  it('detects qwen format for GLM models', () => {
    vi.spyOn(provider, 'getModel').mockReturnValue('openai:hf:zai-org/GLM-4.6');

    expect(provider.getToolFormat()).toBe('qwen');
  });

  it('keeps openai format for non-GLM models', () => {
    vi.spyOn(provider, 'getModel').mockReturnValue('gpt-4.1-mini');

    expect(provider.getToolFormat()).toBe('openai');
  });
});
