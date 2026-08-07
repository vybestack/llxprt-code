import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { OpenAIProvider } from './OpenAIProvider.js';

const realLlxprtCodeSettingsModule = {
  ...(await import('@vybestack/llxprt-code-settings')),
};

const mockSettingsService = {
  set: vi.fn(),
  get: vi.fn(),
  setProviderSetting: vi.fn(),
  getProviderSetting: vi.fn(),
  getProviderSettings: vi.fn(),
  updateSettings: vi.fn(),
  settings: { providers: { openai: {} } },
};

void vi.mock('openai', () => ({
  default: vi.fn(),
}));

void vi.mock('@vybestack/llxprt-code-settings', () => ({
  ...realLlxprtCodeSettingsModule,
  getSettingsService: () => mockSettingsService,
  SETTINGS_REGISTRY: [],
}));

describe('OpenAIProvider tool format detection', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsService.settings = { providers: { openai: {} } };
    mockSettingsService.getProviderSettings.mockReturnValue({});
    mockSettingsService.get.mockReturnValue(undefined);
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
