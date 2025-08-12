/**
 * Comprehensive behavioral tests for SettingsService
 * Tests ACTUAL BEHAVIOR with real data flows based on specification requirements
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { SettingsService } from '../../src/settings/SettingsService.js';
import {
  ISettingsRepository,
  GlobalSettings,
  ProviderSettings,
  SettingsChangeEvent,
} from '../../src/settings/types.js';

// Mock repository for testing
class MockSettingsRepository implements ISettingsRepository {
  private settings: GlobalSettings | null = null;
  private shouldFailLoad = false;
  private shouldFailSave = false;
  private watchCallback: ((settings: GlobalSettings) => void) | null = null;

  async load(): Promise<GlobalSettings> {
    if (this.shouldFailLoad) {
      throw new Error('Repository load failed');
    }
    return this.settings || this.getDefaultSettings();
  }

  async save(settings: GlobalSettings): Promise<void> {
    if (this.shouldFailSave) {
      throw new Error('Repository save failed');
    }
    this.settings = settings;
  }

  watch(callback: (settings: GlobalSettings) => void): () => void {
    this.watchCallback = callback;
    return () => {
      this.watchCallback = null;
    };
  }

  // Test helpers
  setFailLoad(fail: boolean): void {
    this.shouldFailLoad = fail;
  }

  setFailSave(fail: boolean): void {
    this.shouldFailSave = fail;
  }

  simulateFileChange(settings: GlobalSettings): void {
    this.settings = settings;
    if (this.watchCallback) {
      this.watchCallback(settings);
    }
  }

  private getDefaultSettings(): GlobalSettings {
    // Match the new "no defaults" architecture - start with empty settings
    return {
      providers: {},
    };
  }
}

// Test data generators for property-based tests
const providerNameArbitrary = fc.constantFrom(
  'openai',
  'gemini',
  'anthropic',
  'glm',
);

const validProviderSettingsArbitrary = fc.record({
  enabled: fc.boolean(),
  model: fc.string({ minLength: 1, maxLength: 50 }),
  temperature: fc.double({ min: 0, max: 2, noNaN: true }),
  maxTokens: fc.option(fc.integer({ min: 1, max: 100000 })),
  apiKey: fc.option(fc.string({ minLength: 10, maxLength: 100 })),
  baseUrl: fc.option(fc.webUrl()),
  toolFormat: fc.option(
    fc.constantFrom(
      'auto',
      'openai',
      'qwen',
      'hermes',
      'xml',
      'anthropic',
      'deepseek',
      'gemma',
      'llama',
    ),
  ),
});

const globalSettingsArbitrary = fc.record({
  defaultProvider: providerNameArbitrary,
  providers: fc.dictionary(
    providerNameArbitrary,
    validProviderSettingsArbitrary,
  ),
  ui: fc.option(
    fc.record({
      theme: fc.constantFrom('light', 'dark', 'auto'),
    }),
  ),
});

describe('SettingsService Behavioral Tests', () => {
  let repository: MockSettingsRepository;
  let service: SettingsService;

  beforeEach(async () => {
    repository = new MockSettingsRepository();
    service = new SettingsService(repository);

    // Wait for service initialization to complete
    await new Promise<void>((resolve) => {
      service.on('initialized' as never, () => resolve());
    });
  });

  describe('Settings Retrieval', () => {
    /**
     * @requirement REQ-001.1
     * @scenario Get current global settings
     * @given Settings service with valid repository
     * @when getSettings() is called
     * @then Returns complete global settings object with providers
     */
    it('should return complete global settings with all providers', async () => {
      const settings = await service.getSettings();

      // With the new "no defaults" architecture, service starts empty
      expect(settings).toEqual({
        providers: {},
      });
    });

    /**
     * @requirement REQ-001.2
     * @scenario Repository provides persistent settings
     * @given Repository with saved settings
     * @when getSettings() is called
     * @then Returns exactly what repository provided
     */
    it('should return settings from repository when available', async () => {
      const savedSettings: GlobalSettings = {
        defaultProvider: 'qwen',
        providers: {
          qwen: {
            enabled: true,
            baseUrl: 'https://portal.qwen.ai/v1',
            model: 'qwen3-coder-plus',
            temperature: 0.5,
            apiKey: 'qwen_test_key',
          },
          openai: {
            enabled: false,
            model: 'gpt-3.5-turbo',
            temperature: 0.7,
          },
        },
        ui: {
          theme: 'dark',
        },
      };

      await repository.save(savedSettings);
      const retrievedSettings = await service.getSettings();

      expect(retrievedSettings).toEqual(savedSettings);
    });

    /**
     * @requirement REQ-004.1
     * @scenario Handle repository load failure gracefully
     * @given Repository that fails to load
     * @when getSettings() is called
     * @then Returns default settings without throwing
     */
    it('should return default settings when repository fails to load', async () => {
      repository.setFailLoad(true);

      const settings = await service.getSettings();

      // With "no defaults" architecture, returns empty settings when repository fails
      expect(settings).toEqual({
        providers: {},
      });
      expect(settings.defaultProvider).toBeUndefined();
    });
  });

  describe('Settings Updates', () => {
    /**
     * @requirement REQ-003.2
     * @scenario Update settings with validation
     * @given Valid temperature value
     * @when updateSettings called with temperature change
     * @then Settings persisted and contains new temperature
     */
    it('should update settings and persist changes', async () => {
      const updates: Partial<GlobalSettings> = {
        providers: {
          openai: {
            enabled: true,
            model: 'gpt-4',
            temperature: 1.5,
          },
        },
      };

      await service.updateSettings(updates);
      const updatedSettings = await service.getSettings();

      expect(updatedSettings.providers.openai?.temperature).toBe(1.5);
    });

    /**
     * @requirement REQ-004.1
     * @scenario Reject invalid temperature settings
     * @given Temperature value > 2
     * @when updateSettings called
     * @then Throws validation error and no state change
     */
    it('should reject invalid temperature values and maintain state', async () => {
      const originalSettings = await service.getSettings();

      const invalidUpdates: Partial<GlobalSettings> = {
        providers: {
          openai: {
            enabled: true,
            model: 'gpt-4',
            temperature: 3.5, // Invalid: > 2
          },
        },
      };

      await expect(service.updateSettings(invalidUpdates)).rejects.toThrow();

      const unchangedSettings = await service.getSettings();
      expect(unchangedSettings).toEqual(originalSettings);
    });

    /**
     * @requirement REQ-003.2
     * @scenario Partial settings updates merge correctly
     * @given Existing provider settings
     * @when updateSettings called with partial update
     * @then Only specified fields are changed, others preserved
     */
    it('should merge partial updates with existing settings', async () => {
      // First set up initial settings
      const initialUpdates: Partial<GlobalSettings> = {
        providers: {
          openai: {
            enabled: true,
            model: 'gpt-4',
            temperature: 1.0,
            maxTokens: 1000,
          },
        },
      };
      await service.updateSettings(initialUpdates);

      // Then update only temperature
      const partialUpdates: Partial<GlobalSettings> = {
        providers: {
          openai: {
            enabled: true,
            model: 'gpt-4',
            temperature: 0.8,
          },
        },
      };

      await service.updateSettings(partialUpdates);
      const updatedSettings = await service.getSettings();

      expect(updatedSettings.providers.openai).toEqual({
        enabled: true,
        model: 'gpt-4',
        temperature: 0.8,
        maxTokens: 1000, // Should be preserved
      });
    });

    /**
     * @requirement REQ-004.4
     * @scenario Rollback on persistence failure
     * @given Repository that fails to save
     * @when updateSettings called
     * @then Error thrown and original state preserved
     */
    it('should rollback changes when persistence fails', async () => {
      const originalSettings = await service.getSettings();
      repository.setFailSave(true);

      const updates: Partial<GlobalSettings> = {
        defaultProvider: 'qwen',
      };

      await expect(service.updateSettings(updates)).rejects.toThrow();

      const unchangedSettings = await service.getSettings();
      expect(unchangedSettings).toEqual(originalSettings);
    });
  });

  describe('Provider Management', () => {
    /**
     * @requirement REQ-003.3
     * @scenario Switch to qwen provider
     * @given Current provider is openai
     * @when switchProvider('qwen') called
     * @then Active provider updated and qwen configuration active
     */
    it('should switch active provider successfully', async () => {
      await service.switchProvider('openai');

      const settings = await service.getSettings();
      expect(settings.defaultProvider).toBe('openai');
      // Verify openai provider was created with minimal defaults
      expect(settings.providers.openai).toEqual({
        enabled: true,
      });
    });

    /**
     * @requirement REQ-003.3
     * @scenario Switch to non-existent provider creates defaults
     * @given Provider not configured
     * @when switchProvider called for unconfigured provider
     * @then Provider created with defaults and activated
     */
    it('should create default settings for unconfigured provider', async () => {
      await service.switchProvider('gemini');

      const settings = await service.getSettings();
      expect(settings.defaultProvider).toBe('gemini');
      expect(settings.providers.gemini).toEqual({
        enabled: true,
        // No hardcoded defaults anymore - just enabled flag
      });
      expect(settings.providers.gemini?.enabled).toBe(true);
    });

    /**
     * @requirement REQ-003.3
     * @scenario Switch to same provider is idempotent
     * @given Current provider is openai
     * @when switchProvider('openai') called
     * @then No changes occur, operation succeeds
     */
    it('should handle switching to current provider gracefully', async () => {
      // First switch to a provider to establish a default
      await service.switchProvider('openai');
      const originalSettings = await service.getSettings();

      await service.switchProvider('openai'); // Switch to same provider

      const unchangedSettings = await service.getSettings();
      expect(unchangedSettings).toEqual(originalSettings);
    });

    /**
     * @requirement REQ-004.2
     * @scenario Prevent invalid provider configurations
     * @given Qwen provider without required baseUrl
     * @when switchProvider('qwen') called without baseUrl
     * @then Error thrown for invalid configuration
     */
    it('should validate provider-specific requirements', async () => {
      // Update qwen to invalid state
      await service.updateSettings({
        providers: {
          qwen: {
            enabled: true,
            model: 'qwen3-coder-plus',
            baseUrl: '', // Invalid: required for qwen
          },
        },
      });

      await expect(service.switchProvider('qwen')).rejects.toThrow();
    });
  });

  describe('Event System', () => {
    /**
     * @requirement REQ-002.1
     * @scenario Provider receives settings update event
     * @given Event listener registered for settings changes
     * @when Settings updated
     * @then Listener receives change event with correct data
     */
    it('should emit events when settings change', async () => {
      const eventPromise = new Promise<SettingsChangeEvent>((resolve) => {
        service.on('settings_changed', resolve);
      });

      const updates: Partial<GlobalSettings> = {
        defaultProvider: 'qwen',
      };

      await service.updateSettings(updates);

      const event = await eventPromise;
      expect(event.type).toBe('settings_changed');
      expect(event.changes).toEqual(updates);
      expect(event.timestamp).toBeInstanceOf(Date);
    });

    /**
     * @requirement REQ-002.1
     * @scenario Multiple listeners receive events
     * @given Multiple event listeners registered
     * @when Settings change occurs
     * @then All listeners receive the same event data
     */
    it('should notify all event listeners of changes', async () => {
      const listener1Promise = new Promise<SettingsChangeEvent>((resolve) => {
        service.on('settings_changed', resolve);
      });

      const listener2Promise = new Promise<SettingsChangeEvent>((resolve) => {
        service.on('settings_changed', resolve);
      });

      const updates: Partial<GlobalSettings> = {
        ui: { theme: 'dark' },
      };

      await service.updateSettings(updates);

      const [event1, event2] = await Promise.all([
        listener1Promise,
        listener2Promise,
      ]);
      expect(event1).toEqual(event2);
    });

    /**
     * @requirement REQ-002.1
     * @scenario Event unsubscription works correctly
     * @given Event listener with unsubscribe function
     * @when unsubscribe called and settings change
     * @then Unsubscribed listener does not receive events
     */
    it('should support event listener unsubscription', async () => {
      let eventReceived = false;
      const unsubscribe = service.on('settings_changed', () => {
        eventReceived = true;
      });

      unsubscribe();

      await service.updateSettings({
        defaultProvider: 'qwen',
      });

      expect(eventReceived).toBe(false);
    });
  });

  describe('File System Integration', () => {
    /**
     * @requirement REQ-002.4
     * @scenario File changes trigger in-memory updates
     * @given Settings service watching file
     * @when External file change occurs
     * @then In-memory settings reflect file changes
     */
    it('should update settings when file changes externally', async () => {
      const newSettings: GlobalSettings = {
        defaultProvider: 'qwen',
        providers: {
          qwen: {
            enabled: true,
            baseUrl: 'https://portal.qwen.ai/v1',
            model: 'qwen3-coder-plus',
            temperature: 0.3,
          },
        },
        ui: {
          theme: 'light',
        },
      };

      repository.simulateFileChange(newSettings);

      const updatedSettings = await service.getSettings();
      expect(updatedSettings).toEqual(newSettings);
    });
  });

  describe('Property-Based Tests', () => {
    /**
     * @requirement REQ-003.2
     * @scenario Settings updates with valid data always succeed
     * @given Any valid settings configuration
     * @when updateSettings called
     * @then Operation succeeds and settings are persisted
     */
    it('should handle all valid settings updates', () => {
      fc.assert(
        fc.asyncProperty(globalSettingsArbitrary, async (settings) => {
          const partialSettings: Partial<GlobalSettings> = {
            defaultProvider: settings.defaultProvider,
            ui: settings.ui,
          };

          await service.updateSettings(partialSettings);
          const updatedSettings = await service.getSettings();

          expect(updatedSettings.defaultProvider).toBe(
            settings.defaultProvider,
          );
          if (settings.ui) {
            expect(updatedSettings.ui).toEqual(settings.ui);
          }
        }),
      );
    });

    /**
     * @requirement REQ-004.1
     * @scenario Invalid temperature values always fail validation
     * @given Temperature outside valid range (0-2)
     * @when updateSettings called with invalid temperature
     * @then Validation error thrown and state unchanged
     */
    it('should reject all invalid temperature values', () => {
      fc.assert(
        fc.asyncProperty(
          providerNameArbitrary,
          fc.double({ min: 2.01, max: 100, noNaN: true }),
          async (provider, invalidTemp) => {
            const originalSettings = await service.getSettings();
            const originalProvider = originalSettings.defaultProvider;

            const invalidUpdates: Partial<GlobalSettings> = {
              providers: {
                [provider]: {
                  enabled: true,
                  model: 'test-model',
                  temperature: invalidTemp,
                },
              },
            };

            await expect(
              service.updateSettings(invalidUpdates),
            ).rejects.toThrow();

            const unchangedSettings = await service.getSettings();
            // Core invariant: original defaultProvider should be unchanged
            expect(unchangedSettings.defaultProvider).toBe(originalProvider);
            // State should not have invalid temperature
            if (unchangedSettings.providers[provider]) {
              expect(
                unchangedSettings.providers[provider]?.temperature,
              ).not.toBe(invalidTemp);
            }
          },
        ),
      );
    });

    /**
     * @requirement REQ-003.3
     * @scenario Provider switching works for all valid provider names
     * @given Any valid provider name
     * @when switchProvider called
     * @then Provider becomes active and settings contain provider
     */
    it('should switch to any valid provider successfully', () => {
      fc.assert(
        fc.asyncProperty(providerNameArbitrary, async (providerName) => {
          await service.switchProvider(providerName);

          const settings = await service.getSettings();
          expect(settings.defaultProvider).toBe(providerName);
          // With "no defaults" architecture, switchProvider should create the provider
          expect(settings.providers[providerName]).toBeDefined();
          expect(settings.providers[providerName]?.enabled).toBe(true);
        }),
      );
    });

    /**
     * @requirement REQ-001.2
     * @scenario Settings persistence maintains data integrity
     * @given Any valid settings configuration
     * @when Settings updated and retrieved
     * @then Retrieved settings match updated settings exactly
     */
    it('should maintain data integrity across save/load cycles', () => {
      fc.assert(
        fc.asyncProperty(
          fc.record({
            defaultProvider: providerNameArbitrary,
            ui: fc.option(
              fc.record({
                theme: fc.constantFrom('light', 'dark', 'auto'),
              }),
            ),
          }),
          async (partialSettings) => {
            await service.updateSettings(partialSettings);
            const retrievedSettings = await service.getSettings();

            expect(retrievedSettings.defaultProvider).toBe(
              partialSettings.defaultProvider,
            );
            if (partialSettings.ui) {
              expect(retrievedSettings.ui).toEqual(partialSettings.ui);
            }
          },
        ),
      );
    });

    /**
     * @requirement REQ-004.4
     * @scenario Rollback preserves original state for any settings
     * @given Any initial settings state
     * @when Update fails due to repository error
     * @then Original state is perfectly preserved
     */
    it('should preserve original state on any rollback scenario', () => {
      fc.assert(
        fc.asyncProperty(globalSettingsArbitrary, async (initialSettings) => {
          // Set up initial state
          await service.updateSettings({
            defaultProvider: initialSettings.defaultProvider,
            ui: initialSettings.ui,
          });

          const beforeFailure = await service.getSettings();

          // Simulate repository failure
          repository.setFailSave(true);

          try {
            await service.updateSettings({
              defaultProvider: 'qwen',
              ui: { theme: 'dark' },
            });
          } catch {
            // Expected failure
          }

          const afterFailure = await service.getSettings();
          expect(afterFailure).toEqual(beforeFailure);

          // Restore repository for next test
          repository.setFailSave(false);
        }),
      );
    });

    /**
     * @requirement REQ-002.1
     * @scenario Event data consistency across all update scenarios
     * @given Any valid settings update
     * @when Settings change event emitted
     * @then Event contains exactly the changes that were made
     */
    it('should emit consistent event data for all updates', () => {
      fc.assert(
        fc.asyncProperty(
          fc.record({
            defaultProvider: providerNameArbitrary,
            ui: fc.option(
              fc.record({
                theme: fc.constantFrom('light', 'dark', 'auto'),
              }),
            ),
          }),
          async (updates) => {
            const eventPromise = new Promise<SettingsChangeEvent>((resolve) => {
              service.on('settings_changed', resolve);
            });

            await service.updateSettings(updates);

            const event = await eventPromise;
            expect(event.type).toBe('settings_changed');
            expect(event.changes).toEqual(updates);
            expect(event.timestamp).toBeInstanceOf(Date);
            expect(Date.now() - event.timestamp.getTime()).toBeLessThan(1000);
          },
        ),
      );
    });

    /**
     * @requirement REQ-004.3
     * @scenario Concurrent updates maintain consistency
     * @given Multiple concurrent setting updates
     * @when Operations execute simultaneously
     * @then All operations complete successfully and final state is consistent
     */
    it('should maintain consistency during concurrent updates', () => {
      fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              defaultProvider: providerNameArbitrary,
              ui: fc.option(
                fc.record({
                  theme: fc.constantFrom('light', 'dark', 'auto'),
                }),
              ),
            }),
            { minLength: 2, maxLength: 5 },
          ),
          async (updates) => {
            const operations = updates.map((update) =>
              service.updateSettings(update),
            );

            await Promise.all(operations);

            const finalSettings = await service.getSettings();
            // Verify that the final state is one of the updates that was applied
            const finalProvider = finalSettings.defaultProvider;
            if (finalProvider) {
              const appliedProviders = updates.map((u) => u.defaultProvider);
              expect(appliedProviders).toContain(finalProvider);

              // With "no defaults" architecture, providers created by updateSettings may be undefined
              // if defaultProvider is set but the provider isn't explicitly created
              if (finalSettings.providers[finalProvider]) {
                expect(finalSettings.providers[finalProvider]).toMatchObject({
                  enabled: true,
                });
              }
            }
          },
        ),
        { numRuns: 20 },
      );
    });

    /**
     * @requirement REQ-003.3
     * @scenario Provider switching with any valid provider maintains consistency
     * @given Any sequence of valid provider names
     * @when switchProvider called for each provider
     * @then Each switch succeeds and provider becomes active with valid configuration
     */
    it('should handle provider switching sequence consistently', () => {
      fc.assert(
        fc.asyncProperty(
          fc.array(providerNameArbitrary, { minLength: 2, maxLength: 5 }),
          async (providerSequence) => {
            for (const provider of providerSequence) {
              await service.switchProvider(provider);

              const settings = await service.getSettings();
              expect(settings.defaultProvider).toBe(provider);
              // With "no defaults" architecture, switchProvider creates minimal defaults
              expect(settings.providers[provider]).toBeDefined();
              expect(settings.providers[provider]?.enabled).toBe(true);
            }

            // Final state should be the last provider in sequence
            const finalSettings = await service.getSettings();
            const lastProvider = providerSequence[providerSequence.length - 1];
            expect(finalSettings.defaultProvider).toBe(lastProvider);
          },
        ),
        { numRuns: 25 },
      );
    });
  });

  describe('Error Handling and Edge Cases', () => {
    /**
     * @requirement REQ-004.3
     * @scenario Atomic operations maintain consistency
     * @given Multiple rapid setting updates
     * @when Operations overlap
     * @then All operations complete successfully or fail cleanly
     */
    it('should handle concurrent operations safely', async () => {
      const operations = Array.from({ length: 10 }, (_, i) =>
        service.updateSettings({
          providers: {
            openai: {
              enabled: true,
              model: `gpt-4-${i}`,
              temperature: 0.5,
            },
          },
        }),
      );

      await Promise.all(operations);

      const finalSettings = await service.getSettings();
      expect(finalSettings.providers.openai?.model).toMatch(/^gpt-4-\d$/);
    });

    /**
     * @requirement REQ-001.4
     * @scenario Service handles empty updates gracefully
     * @given Empty update object
     * @when updateSettings called with empty object
     * @then Operation succeeds without changes
     */
    it('should handle empty updates without error', async () => {
      const originalSettings = await service.getSettings();

      await service.updateSettings({});

      const unchangedSettings = await service.getSettings();
      expect(unchangedSettings).toEqual(originalSettings);
    });

    /**
     * @requirement REQ-004.2
     * @scenario Provider validation prevents invalid states
     * @given Provider settings with missing required fields
     * @when Settings validation occurs
     * @then Appropriate validation errors are thrown
     */
    it('should validate required provider fields', async () => {
      const invalidUpdates: Partial<GlobalSettings> = {
        providers: {
          qwen: {
            enabled: true,
            // Missing required model and baseUrl
            temperature: 1.0,
          } as ProviderSettings,
        },
      };

      await expect(service.updateSettings(invalidUpdates)).rejects.toThrow();
    });
  });
});
