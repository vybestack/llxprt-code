import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';

const mockSettingsService = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  setProviderSetting: vi.fn(),
  getProviderSetting: vi.fn(),
  getProviderSettings: vi.fn(),
  updateSettings: vi.fn(),
  settings: { providers: { anthropic: {} } },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(),
}));

vi.mock('../../tools/ToolFormatter.js', () => ({
  ToolFormatter: vi.fn().mockImplementation(() => ({
    convertGeminiToFormat: vi.fn(),
  })),
}));

vi.mock('../../core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('system prompt'),
}));

// REQ-RETRY-001: retryWithBackoff removed from providers
vi.mock('../../utils/retry.js', () => ({
  getErrorStatus: vi.fn(),
  isNetworkTransientError: vi.fn(),
}));

vi.mock('../../settings/settingsServiceInstance.js', () => ({
  getSettingsService: () => mockSettingsService,
}));

describe('AnthropicProvider tool format detection', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsService.settings = { providers: { anthropic: {} } };
    provider = new AnthropicProvider('test-key');
  });

  it('detects qwen format for GLM models', () => {
    vi.spyOn(provider, 'getCurrentModel').mockReturnValue('glm-4.6');

    expect(provider.getToolFormat()).toBe('qwen');
  });

  it('keeps anthropic format for non-GLM models', () => {
    vi.spyOn(provider, 'getCurrentModel').mockReturnValue('claude-3-7b');

    expect(provider.getToolFormat()).toBe('anthropic');
  });
});
