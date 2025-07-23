import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';

describe('OpenAIProvider.shouldUseResponses', () => {
  let provider: OpenAIProvider;
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    provider = new OpenAIProvider('test-key');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return true for gpt-4o model', () => {
    provider.setModel('gpt-4o');
    expect(
      (
        provider as unknown as {
          shouldUseResponses: (model: string) => boolean;
        }
      ).shouldUseResponses('gpt-4o'),
    ).toBe(true);
  });

  it('should return true for gpt-4o-mini model', () => {
    provider.setModel('gpt-4o-mini');
    expect(
      (
        provider as unknown as {
          shouldUseResponses: (model: string) => boolean;
        }
      ).shouldUseResponses('gpt-4o-mini'),
    ).toBe(true);
  });

  it('should return true for gpt-4o-realtime model', () => {
    provider.setModel('gpt-4o-realtime');
    expect(
      (
        provider as unknown as {
          shouldUseResponses: (model: string) => boolean;
        }
      ).shouldUseResponses('gpt-4o-realtime'),
    ).toBe(true);
  });

  it('should return true for gpt-4-turbo model', () => {
    provider.setModel('gpt-4-turbo');
    expect(
      (
        provider as unknown as {
          shouldUseResponses: (model: string) => boolean;
        }
      ).shouldUseResponses('gpt-4-turbo'),
    ).toBe(true);
  });

  it('should return true for gpt-4-turbo-preview model', () => {
    provider.setModel('gpt-4-turbo-preview');
    expect(
      (
        provider as unknown as {
          shouldUseResponses: (model: string) => boolean;
        }
      ).shouldUseResponses('gpt-4-turbo-preview'),
    ).toBe(true);
  });

  it('should return false for legacy gpt-3.5-turbo model', () => {
    provider.setModel('gpt-3.5-turbo');
    expect(
      (
        provider as unknown as {
          shouldUseResponses: (model: string) => boolean;
        }
      ).shouldUseResponses('gpt-3.5-turbo'),
    ).toBe(false);
  });

  it('should return false for unknown model', () => {
    provider.setModel('custom-model');
    expect(
      (
        provider as unknown as {
          shouldUseResponses: (model: string) => boolean;
        }
      ).shouldUseResponses('custom-model'),
    ).toBe(false);
  });

  it('should return false when OPENAI_RESPONSES_DISABLE is set to true', () => {
    process.env.OPENAI_RESPONSES_DISABLE = 'true';
    provider.setModel('gpt-4o');
    expect(
      (
        provider as unknown as {
          shouldUseResponses: (model: string) => boolean;
        }
      ).shouldUseResponses('gpt-4o'),
    ).toBe(false);
  });

  it('should return true when OPENAI_RESPONSES_DISABLE is not true', () => {
    process.env.OPENAI_RESPONSES_DISABLE = 'false';
    provider.setModel('gpt-4o');
    expect(
      (
        provider as unknown as {
          shouldUseResponses: (model: string) => boolean;
        }
      ).shouldUseResponses('gpt-4o'),
    ).toBe(true);
  });

  it('should return true when OPENAI_RESPONSES_DISABLE is not set', () => {
    delete process.env.OPENAI_RESPONSES_DISABLE;
    provider.setModel('gpt-4o');
    expect(
      (
        provider as unknown as {
          shouldUseResponses: (model: string) => boolean;
        }
      ).shouldUseResponses('gpt-4o'),
    ).toBe(true);
  });
});
