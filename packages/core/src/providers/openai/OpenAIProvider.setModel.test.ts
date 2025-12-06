/**
 * Test for OpenAIProvider setModel and getCurrentModel methods
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import { SettingsService } from '../../settings/SettingsService.js';
import { createProviderWithRuntime } from '../../test-utils/runtime.js';

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
  });

  it('should have provider see the same settings service', () => {
    const internal = provider as unknown as {
      defaultSettingsService?: SettingsService;
    };
    expect(internal.defaultSettingsService).toStrictEqual(settingsService);
  });

  it('uses SettingsService global model override when present', () => {
    const modelId = 'gpt-4-turbo';
    const service = (
      provider as unknown as {
        resolveSettingsService: () => SettingsService;
      }
    ).resolveSettingsService();
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
    const service = (
      provider as unknown as {
        resolveSettingsService: () => SettingsService;
      }
    ).resolveSettingsService();
    service.set('model', undefined);
    service.setProviderSetting('openai', 'model', 'gpt-4o');

    expect(provider.getCurrentModel()).toBe('gpt-4o');
  });
});
