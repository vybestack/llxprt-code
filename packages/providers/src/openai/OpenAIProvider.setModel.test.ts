/**
 * Test for OpenAIProvider setModel and getCurrentModel methods
 */
import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { OpenAIProvider } from './OpenAIProvider.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderWithRuntime } from '@vybestack/llxprt-code-test-utils/core/runtime.js';

describe('OpenAIProvider model resolution', () => {
  let provider: OpenAIProvider;
  let settingsService: SettingsService;

  beforeEach(() => {
    settingsService = new SettingsService();

    ({ provider } = createProviderWithRuntime<OpenAIProvider>(
      () => new OpenAIProvider('test-api-key', undefined, undefined),
      {
        settingsService,
        runtimeId: 'openai.provider.setModel.test',
        metadata: { source: 'OpenAIProvider.setModel.test.ts' },
      },
    ));
    provider.setRuntimeSettingsService(settingsService);
  });

  it('observes replacements from its explicitly bound owner', () => {
    settingsService.setProviderSetting('openai', 'model', 'owner-model');
    expect(provider.getCurrentModel()).toBe('owner-model');
  });

  it('uses SettingsService global model override when present', () => {
    const modelId = 'gpt-4-turbo';
    const service = new SettingsService();
    provider.setRuntimeSettingsService(service);
    service.set('model', modelId);

    expect(provider.getCurrentModel()).toBe(modelId);
  });

  it('should get the current model using getCurrentModel', () => {
    // Mock the getModel method on the provider
    const expectedModel = 'gpt-4';
    vi.spyOn(provider, 'getModel').mockReturnValue(expectedModel);

    const currentModel = provider.getCurrentModel();

    expect(currentModel).toBe(expectedModel);
  });

  it('prefers provider-specific model setting when global override absent', () => {
    const service = new SettingsService();
    provider.setRuntimeSettingsService(service);
    service.set('model', undefined);
    service.setProviderSetting('openai', 'model', 'gpt-4o');

    expect(provider.getCurrentModel()).toBe('gpt-4o');
  });
});
