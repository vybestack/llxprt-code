/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Test for model diagnostics synchronization issue
 * Reproduces the bug where /diagnostics shows wrong model after /model command
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SettingsService } from '../../src/settings/SettingsService.js';

describe('Model Diagnostics Synchronization', () => {
  let settingsService: SettingsService;

  beforeEach(() => {
    settingsService = new SettingsService();
  });

  describe('Issue: /diagnostics shows wrong model after /model switch', () => {
    /**
     * @scenario User loads profile -> switches model -> checks diagnostics
     * @given Profile with model A is loaded
     * @when User switches to model B with /model command
     * @then /diagnostics should show model B, not model A
     */
    it('should show updated model in diagnostics after model switch', async () => {
      // Step 1: Simulate profile load setting initial model
      const initialModel = 'gpt-3.5-turbo';
      settingsService.setProviderSetting('openai', 'model', initialModel);
      settingsService.set('activeProvider', 'openai');

      // Verify initial state - should now return the model from provider settings
      let diagnostics = await settingsService.getDiagnosticsData();
      expect(diagnostics.model).toBe(initialModel); // Should now return the actual model

      // Step 2: Simulate /model command updating the model
      const newModel = 'gpt-4';

      // This is what the /model command should do to update SettingsService
      settingsService.setProviderSetting('openai', 'model', newModel);

      // Step 3: Check diagnostics - it should show the new model
      diagnostics = await settingsService.getDiagnosticsData();

      // This should pass once we fix the getDiagnosticsData method
      expect(diagnostics.model).toBe(newModel);
      expect(diagnostics.provider).toBe('openai');
    });

    /**
     * @scenario Provider returns current model
     * @given Provider has a current model set
     * @when getDiagnosticsData is called
     * @then Should return the provider's current model
     */
    it('should get model from provider settings when available', async () => {
      const testModel = 'claude-3';
      const testProvider = 'anthropic';

      // Set up provider settings
      settingsService.setProviderSetting(testProvider, 'model', testModel);
      settingsService.set('activeProvider', testProvider);

      const diagnostics = await settingsService.getDiagnosticsData();

      expect(diagnostics.model).toBe(testModel);
      expect(diagnostics.provider).toBe(testProvider);
    });

    /**
     * @scenario Active provider and model params are included in diagnostics
     * @given Provider has model params set
     * @when getDiagnosticsData is called
     * @then Should return provider's model params
     */
    it('should include provider model params in diagnostics', async () => {
      const testProvider = 'openai';
      const testModel = 'gpt-4';
      const testParams = { temperature: 0.7, max_tokens: 1000 };

      settingsService.set('activeProvider', testProvider);
      settingsService.setProviderSetting(testProvider, 'model', testModel);
      settingsService.setProviderSetting(
        testProvider,
        'temperature',
        testParams.temperature,
      );
      settingsService.setProviderSetting(
        testProvider,
        'max_tokens',
        testParams.max_tokens,
      );

      const diagnostics = await settingsService.getDiagnosticsData();

      expect(diagnostics.model).toBe(testModel);
      expect(diagnostics.providerSettings).toEqual({
        model: testModel,
        temperature: testParams.temperature,
        max_tokens: testParams.max_tokens,
      });
    });
  });

  describe('Real-world integration scenario', () => {
    /**
     * @scenario Complete flow: load profile -> switch model -> check diagnostics
     * @given User loads a profile with model A
     * @when User switches to model B using /model command simulation
     * @then Diagnostics should show model B and correct provider
     */
    it('should handle profile load -> model switch -> diagnostics correctly', async () => {
      const originalProvider = 'openai';
      const originalModel = 'gpt-3.5-turbo';
      const newModel = 'gpt-4';

      // Step 1: Simulate profile load (what /profile load does)
      settingsService.set('activeProvider', originalProvider);
      settingsService.setProviderSetting(
        originalProvider,
        'model',
        originalModel,
      );
      settingsService.setCurrentProfileName('test-profile');

      // Verify profile loaded state
      let diagnostics = await settingsService.getDiagnosticsData();
      expect(diagnostics.provider).toBe(originalProvider);
      expect(diagnostics.model).toBe(originalModel);
      expect(diagnostics.profile).toBe('test-profile');

      // Step 2: Simulate /model command (what modelCommand.ts does)
      // Update SettingsService provider settings with new model
      await settingsService.updateSettings(originalProvider, {
        model: newModel,
      });

      // Step 3: Check diagnostics - should show new model
      diagnostics = await settingsService.getDiagnosticsData();
      expect(diagnostics.provider).toBe(originalProvider);
      expect(diagnostics.model).toBe(newModel);
      expect(diagnostics.profile).toBe('test-profile'); // Profile should remain

      // Verify provider settings contain the new model
      const providerSettings =
        settingsService.getProviderSettings(originalProvider);
      expect(providerSettings.model).toBe(newModel);
    });

    /**
     * @scenario Provider switch affects diagnostics
     * @given Active provider is set
     * @when Provider is switched
     * @then Diagnostics should reflect the new active provider
     */
    it('should update diagnostics when active provider changes', async () => {
      const provider1 = 'openai';
      const provider2 = 'anthropic';
      const model1 = 'gpt-4';
      const model2 = 'claude-3';

      // Set up two providers with different models
      settingsService.setProviderSetting(provider1, 'model', model1);
      settingsService.setProviderSetting(provider2, 'model', model2);

      // Start with provider1
      settingsService.set('activeProvider', provider1);
      let diagnostics = await settingsService.getDiagnosticsData();
      expect(diagnostics.provider).toBe(provider1);
      expect(diagnostics.model).toBe(model1);

      // Switch to provider2
      settingsService.set('activeProvider', provider2);
      diagnostics = await settingsService.getDiagnosticsData();
      expect(diagnostics.provider).toBe(provider2);
      expect(diagnostics.model).toBe(model2);
    });
  });
});
