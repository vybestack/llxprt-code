import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../../../settings/SettingsService.js';
import { OpenAIProvider } from '../OpenAIProvider.js';
import OpenAI from 'openai';
import { createProviderCallOptions } from '../../../test-utils/providerCallOptions.js';

vi.mock('openai', () => {
  class FakeOpenAI {
    chat = {
      completions: {
        create: vi.fn(async () => {
          const error = new Error('Too Many Requests');
          (error as { status?: number }).status = 429;
          throw error;
        }),
      },
    };

    constructor(_opts: Record<string, unknown>) {}
  }

  return { default: FakeOpenAI };
});

const FakeOpenAIClass = OpenAI as unknown as {
  reset?: () => void;
};

class ThrowingAuthOpenAIProvider extends OpenAIProvider {
  protected override async getAuthToken(): Promise<string> {
    return 'token-bucket-a';
  }

  protected override async getAuthTokenForPrompt(): Promise<string> {
    throw new Error('auth refresh failed');
  }
}

describe('OpenAIProvider bucket failover error handling', () => {
  beforeEach(() => {
    FakeOpenAIClass.reset?.();
  });

  afterEach(() => {
    FakeOpenAIClass.reset?.();
  });

  it('surfaces the original 429 when auth refresh throws during bucket failover', async () => {
    const provider = new ThrowingAuthOpenAIProvider(
      'token-bucket-a',
      'https://api.openai.com/v1',
    );

    const settings = new SettingsService();
    settings.set('call-id', 'openai-failover-auth-error');
    settings.set('retries', 3);
    settings.set('retrywait', 0);

    const failoverHandler = {
      isEnabled: () => true,
      tryFailover: vi.fn(async () => true),
      getCurrentBucket: () => 'bucket-b',
    };

    const callOptions = createProviderCallOptions({
      providerName: provider.name,
      contents: [],
      settings,
      runtimeId: 'openai-failover-auth-error',
      configOverrides: {
        getBucketFailoverHandler: () => failoverHandler,
      },
    });

    await expect(
      provider.generateChatCompletion(callOptions).next(),
    ).rejects.toMatchObject({
      message: 'Too Many Requests',
      status: 429,
    });
    expect(failoverHandler.tryFailover).toHaveBeenCalled();
  });
});
