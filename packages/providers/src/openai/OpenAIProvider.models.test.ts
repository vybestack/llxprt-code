import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';

const mockModelsList = vi.fn();

vi.mock('openai', () => ({
  default: class MockOpenAI {
    readonly models = {
      list: mockModelsList,
    };
  },
}));

describe('OpenAIProvider fallback models', () => {
  beforeEach(() => {
    mockModelsList.mockReset();
  });

  it('includes the GPT-5.6 alias and named tiers when model discovery fails', async () => {
    mockModelsList.mockRejectedValueOnce(
      new Error('model discovery unavailable'),
    );
    const provider = new OpenAIProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );

    const models = await provider.getModels();

    expect(models.map((model) => model.id)).toStrictEqual(
      expect.arrayContaining([
        'gpt-5.6',
        'gpt-5.6-sol',
        'gpt-5.6-terra',
        'gpt-5.6-luna',
      ]),
    );
  });

  it('exposes GPT-5.6 fallback models without baked-in contextWindow or maxOutputTokens', async () => {
    mockModelsList.mockRejectedValueOnce(
      new Error('model discovery unavailable'),
    );
    const provider = new OpenAIProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );

    const models = await provider.getModels();
    const sol = models.find((m) => m.id === 'gpt-5.6-sol');

    expect(sol).toBeDefined();
    // Fallback models defer geometry to models.dev hydration in ProviderManager.
    expect(sol?.contextWindow).toBeUndefined();
    expect(sol?.maxOutputTokens).toBeUndefined();
  });
});
