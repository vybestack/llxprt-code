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

vi.mock('@vybestack/llxprt-code-tools/ToolFormatter.js', () => ({
  ToolFormatter: vi.fn().mockImplementation(() => ({
    convertToolDeclarationsToFormat: vi.fn(),
  })),
}));

vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('system prompt'),
}));

// REQ-RETRY-001: retryWithBackoff removed from providers
vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  getErrorStatus: vi.fn(),
  isNetworkTransientError: vi.fn(),
}));

vi.mock('@vybestack/llxprt-code-settings', async () => ({
  ...(await vi.importActual<typeof import('@vybestack/llxprt-code-settings')>(
    '@vybestack/llxprt-code-settings',
  )),
  getSettingsService: () => mockSettingsService,
  SETTINGS_REGISTRY: [],
}));

describe('AnthropicProvider tool format detection', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsService.settings = { providers: { anthropic: {} } };
    mockSettingsService.getProviderSettings.mockReturnValue({});
    mockSettingsService.get.mockReturnValue(undefined);
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

  // Issue #2410 regression: getCurrentModel() must reflect the CONFIGURED model,
  // not a hard-coded default. Previously it always returned 'claude-opus-4-8',
  // so a GLM model served over this Anthropic-compatible provider (e.g. z.ai)
  // was mis-detected as 'anthropic' tool format and rejected with error 1213.
  describe('getCurrentModel reflects configured model (Issue #2410)', () => {
    it('returns the provider-configured model instead of the hard-coded default', () => {
      mockSettingsService.getProviderSettings.mockReturnValue({
        model: 'glm-5.2',
      });

      expect(provider.getCurrentModel()).toBe('glm-5.2');
      expect(provider.getCurrentModel()).not.toBe('claude-opus-4-8');
    });

    it('auto-detects qwen tool format for a configured GLM model WITHOUT mocking getCurrentModel', () => {
      // No getCurrentModel spy here: the real method must resolve glm-5.2 from
      // settings so detectToolFormat() maps it to 'qwen'.
      mockSettingsService.getProviderSettings.mockReturnValue({
        model: 'glm-5.2',
      });

      expect(provider.getToolFormat()).toBe('qwen');
    });

    it('falls back to the default model when nothing is configured', () => {
      mockSettingsService.getProviderSettings.mockReturnValue({});
      mockSettingsService.get.mockReturnValue(undefined);

      expect(provider.getCurrentModel()).toBe('claude-opus-4-8');
    });
  });
});
