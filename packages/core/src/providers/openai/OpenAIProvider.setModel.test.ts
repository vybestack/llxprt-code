/**
 * Test for OpenAIProvider setModel and getCurrentModel methods
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import * as settingsServiceInstance from '../../settings/settingsServiceInstance.js';

describe('OpenAIProvider.setModel', () => {
  let provider: OpenAIProvider;
  let mockSettingsService: {
    set: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Mock the settings service
    mockSettingsService = {
      set: vi.fn(),
      get: vi.fn(),
    };

    vi.spyOn(settingsServiceInstance, 'getSettingsService').mockReturnValue(
      mockSettingsService as unknown as ReturnType<
        typeof settingsServiceInstance.getSettingsService
      >,
    );

    provider = new OpenAIProvider('test-api-key');
  });

  it('should set the model using setModel', () => {
    const modelId = 'gpt-4-turbo';
    provider.setModel(modelId);

    expect(mockSettingsService.set).toHaveBeenCalledWith('model', modelId);
  });

  it('should get the current model using getCurrentModel', () => {
    // Mock the getModel method on the provider
    const expectedModel = 'gpt-4';
    vi.spyOn(provider, 'getModel').mockReturnValue(expectedModel);

    const currentModel = provider.getCurrentModel();

    expect(currentModel).toBe(expectedModel);
  });

  it('should update model and retrieve it correctly', () => {
    const newModel = 'gpt-4o';

    // Set the model
    provider.setModel(newModel);
    expect(mockSettingsService.set).toHaveBeenCalledWith('model', newModel);

    // Mock getModel to return the new model
    vi.spyOn(provider, 'getModel').mockReturnValue(newModel);

    // Get the current model
    const currentModel = provider.getCurrentModel();
    expect(currentModel).toBe(newModel);
  });
});
