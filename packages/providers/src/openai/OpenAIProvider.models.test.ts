import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';

// Use vi.hoisted so the mock is created in the hoisted scope the vi.mock
// factory runs in. This avoids referencing a module-scoped binding from
// inside the factory (a fragile pattern under parallel/multi-file runs) and
// gives each run a cleanly resettable instance.
const { mockModelsList } = vi.hoisted(() => ({
  mockModelsList: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    readonly models = {
      list: mockModelsList,
    };
  },
}));

// The deterministic fallback set OpenAIProvider returns when live model
// discovery fails. Asserting the exact list (order included) makes the
// regression tests fail on ANY unintended addition, removal, or reorder.
const EXPECTED_FALLBACK_MODEL_IDS = [
  'gpt-5.6',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-4.2-turbo-preview',
  'gpt-4.2-turbo',
] as const;

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

    // Strict full-list assertion: catches unintended changes to the entire
    // fallback set, not merely the presence of the GPT-5.6 family.
    expect(models.map((model) => model.id)).toStrictEqual([
      ...EXPECTED_FALLBACK_MODEL_IDS,
    ]);
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
