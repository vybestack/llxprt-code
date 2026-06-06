import { describe, it, expect } from 'vitest';
import { detectToolFormat } from './toolFormatDetection.js';

describe('detectToolFormat', () => {
  it('detects kimi format for Kimi K2 models', () => {
    expect(detectToolFormat('kimi-k2')).toBe('kimi');
    expect(detectToolFormat('moonshot-v1-kimi-k2')).toBe('kimi');
  });

  it('detects mistral format for Mistral models', () => {
    expect(detectToolFormat('mistral-large-latest')).toBe('mistral');
    expect(detectToolFormat('mistral-small-latest')).toBe('mistral');
  });

  it('detects qwen format for GLM-4 models', () => {
    expect(detectToolFormat('glm-4')).toBe('qwen');
    expect(detectToolFormat('glm-4.5-flash')).toBe('qwen');
    expect(detectToolFormat('GLM-4-Plus')).toBe('qwen');
  });

  it('detects qwen format for Qwen models', () => {
    expect(detectToolFormat('qwen3-coder-plus')).toBe('qwen');
    expect(detectToolFormat('qwen-turbo')).toBe('qwen');
  });

  it('defaults to openai format for standard models', () => {
    expect(detectToolFormat('gpt-4o')).toBe('openai');
    expect(detectToolFormat('gpt-4-turbo')).toBe('openai');
    expect(detectToolFormat('o3-mini')).toBe('openai');
  });

  it('defaults to openai format for unknown models', () => {
    expect(detectToolFormat('some-custom-model')).toBe('openai');
  });
});
