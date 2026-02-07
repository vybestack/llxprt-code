/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  getSettingsSchema,
  SETTINGS_SCHEMA_DEFINITIONS,
  type SettingCollectionDefinition,
  type SettingDefinition,
  SETTINGS_SCHEMA,
  Settings,
} from './settingsSchema.js';

describe('SettingsSchema', () => {
  describe('SETTINGS_SCHEMA', () => {
    it('should contain all expected top-level settings', () => {
      const expectedSettings = [
        'ui',
        'accessibility',
        'checkpointing',
        'fileFiltering',
        'disableAutoUpdate',
        'useExternalAuth',
        'sandbox',
        'coreTools',
        'excludeTools',
        'toolDiscoveryCommand',
        'toolCallCommand',
        'mcpServerCommand',
        'mcpServers',
        'allowMCPServers',
        'excludeMCPServers',
        'telemetry',
        'bugCommand',
        'summarizeToolOutput',
        'dnsResolutionOrder',
        'excludedProjectEnvVars',
        'disableUpdateNag',
        'includeDirectories',
        'loadMemoryFromIncludeDirectories',
        'model',
        'hasSeenIdeIntegrationNudge',
        'folderTrustFeature',
        'useRipgrep',
        'debugKeystrokeLogging',
        'toolCallProcessingMode',
        'enableFuzzyFiltering',
        'shouldUseNodePtyShell',
        'allowPtyThemeOverride',
        'ptyScrollbackLimit',
      ];

      expectedSettings.forEach((setting) => {
        expect(
          SETTINGS_SCHEMA[setting as keyof typeof SETTINGS_SCHEMA],
        ).toBeDefined();
      });
    });

    it('should have correct structure for each setting', () => {
      Object.entries(SETTINGS_SCHEMA).forEach(([_key, definition]) => {
        expect(definition).toHaveProperty('type');
        expect(definition).toHaveProperty('label');
        expect(definition).toHaveProperty('category');
        expect(definition).toHaveProperty('requiresRestart');
        expect(definition).toHaveProperty('default');
        expect(typeof definition.type).toBe('string');
        expect(typeof definition.label).toBe('string');
        expect(typeof definition.category).toBe('string');
        expect(typeof definition.requiresRestart).toBe('boolean');
      });
    });

    it('should have correct nested setting structure', () => {
      const nestedSettings = [
        'ui',
        'accessibility',
        'checkpointing',
        'fileFiltering',
      ];

      nestedSettings.forEach((setting) => {
        const definition = SETTINGS_SCHEMA[
          setting as keyof typeof SETTINGS_SCHEMA
        ] as (typeof SETTINGS_SCHEMA)[keyof typeof SETTINGS_SCHEMA] & {
          properties: unknown;
        };
        expect(definition.type).toBe('object');
        expect(definition.properties).toBeDefined();
        expect(typeof definition.properties).toBe('object');
      });
    });

    it('should have accessibility nested properties', () => {
      expect(
        SETTINGS_SCHEMA.accessibility.properties?.disableLoadingPhrases,
      ).toBeDefined();
      expect(
        SETTINGS_SCHEMA.accessibility.properties?.disableLoadingPhrases.type,
      ).toBe('boolean');
    });

    it('should have checkpointing nested properties', () => {
      expect(SETTINGS_SCHEMA.checkpointing.properties?.enabled).toBeDefined();
      expect(SETTINGS_SCHEMA.checkpointing.properties?.enabled.type).toBe(
        'boolean',
      );
    });

    it('should have fileFiltering nested properties', () => {
      expect(
        SETTINGS_SCHEMA.fileFiltering.properties?.respectGitIgnore,
      ).toBeDefined();
      expect(
        SETTINGS_SCHEMA.fileFiltering.properties?.respectLlxprtIgnore,
      ).toBeDefined();
      expect(
        SETTINGS_SCHEMA.fileFiltering.properties?.enableRecursiveFileSearch,
      ).toBeDefined();
    });

    it('should have unique categories', () => {
      const categories = new Set();

      // Collect categories from top-level settings
      Object.values(SETTINGS_SCHEMA).forEach((definition) => {
        categories.add(definition.category);
        // Also collect from nested properties
        const defWithProps = definition as typeof definition & {
          properties?: Record<string, unknown>;
        };
        if (defWithProps.properties) {
          Object.values(defWithProps.properties).forEach(
            (nestedDef: unknown) => {
              const nestedDefTyped = nestedDef as { category?: string };
              if (nestedDefTyped.category) {
                categories.add(nestedDefTyped.category);
              }
            },
          );
        }
      });

      expect(categories.size).toBeGreaterThan(0);
      expect(categories).toContain('General');
      expect(categories).toContain('UI');
      expect(categories).toContain('Updates');
      expect(categories).toContain('Accessibility');
      expect(categories).toContain('Checkpointing');
      expect(categories).toContain('File Filtering');
      expect(categories).toContain('Advanced');
    });

    it('should have consistent default values for boolean settings', () => {
      const checkBooleanDefaults = (schema: Record<string, unknown>) => {
        Object.entries(schema).forEach(
          ([_key, definition]: [string, unknown]) => {
            const def = definition as {
              type?: string;
              default?: unknown;
              properties?: Record<string, unknown>;
            };
            // Boolean settings can have boolean or undefined defaults (for optional settings)
            expect(
              def.type !== 'boolean' ||
                ['boolean', 'undefined'].includes(typeof def.default),
            ).toBe(true);
            if (def.properties) {
              checkBooleanDefaults(def.properties);
            }
          },
        );
      };

      checkBooleanDefaults(SETTINGS_SCHEMA as Record<string, unknown>);
    });

    it('should have showInDialog property configured', () => {
      // Check that user-facing settings are marked for dialog display
      expect(SETTINGS_SCHEMA.ui.properties?.showMemoryUsage.showInDialog).toBe(
        true,
      );
      expect(SETTINGS_SCHEMA.ui.properties?.vimMode.showInDialog).toBe(true);
      expect(SETTINGS_SCHEMA.ui.properties?.ideMode.showInDialog).toBe(true);
      expect(SETTINGS_SCHEMA.disableAutoUpdate.showInDialog).toBe(true);
      expect(SETTINGS_SCHEMA.ui.properties?.hideWindowTitle.showInDialog).toBe(
        true,
      );
      expect(SETTINGS_SCHEMA.ui.properties?.hideTips.showInDialog).toBe(true);
      expect(SETTINGS_SCHEMA.ui.properties?.hideBanner.showInDialog).toBe(true);
      expect(
        SETTINGS_SCHEMA.ui.properties?.enableMouseEvents.showInDialog,
      ).toBe(true);
      expect(
        SETTINGS_SCHEMA.ui.properties?.usageStatisticsEnabled.showInDialog,
      ).toBe(false);

      // Check that advanced settings are hidden from dialog
      expect(SETTINGS_SCHEMA.coreTools.showInDialog).toBe(false);
      expect(SETTINGS_SCHEMA.mcpServers.showInDialog).toBe(false);
      expect(SETTINGS_SCHEMA.telemetry.showInDialog).toBe(false);

      // Check that some settings are appropriately hidden
      expect(SETTINGS_SCHEMA.ui.properties?.theme.showInDialog).toBe(false); // Changed to false
      expect(SETTINGS_SCHEMA.ui.properties?.customThemes.showInDialog).toBe(
        false,
      ); // Managed via theme editor
      expect(SETTINGS_SCHEMA.checkpointing.showInDialog).toBe(false); // Experimental feature
      expect(SETTINGS_SCHEMA.accessibility.showInDialog).toBe(false); // Changed to false
      expect(SETTINGS_SCHEMA.fileFiltering.showInDialog).toBe(false); // Changed to false
      expect(SETTINGS_SCHEMA.ui.properties?.preferredEditor.showInDialog).toBe(
        false,
      ); // Changed to false
      expect(
        SETTINGS_SCHEMA.ui.properties?.autoConfigureMaxOldSpaceSize
          .showInDialog,
      ).toBe(true);
    });

    it('should infer Settings type correctly', () => {
      // This test ensures that the Settings type is properly inferred from the schema
      const settings: Settings = {
        ui: {
          theme: 'dark',
        },
        includeDirectories: ['/path/to/dir'],
        loadMemoryFromIncludeDirectories: true,
      };

      // TypeScript should not complain about these properties
      expect(settings.ui?.theme).toBe('dark');
      expect(settings.includeDirectories).toEqual(['/path/to/dir']);
      expect(settings.loadMemoryFromIncludeDirectories).toBe(true);
    });

    it('should have includeDirectories setting in schema', () => {
      expect(SETTINGS_SCHEMA.includeDirectories).toBeDefined();
      expect(SETTINGS_SCHEMA.includeDirectories.type).toBe('array');
      expect(SETTINGS_SCHEMA.includeDirectories.category).toBe('General');
      expect(SETTINGS_SCHEMA.includeDirectories.default).toEqual([]);
    });

    it('should have loadMemoryFromIncludeDirectories setting in schema', () => {
      expect(SETTINGS_SCHEMA.loadMemoryFromIncludeDirectories).toBeDefined();
      expect(SETTINGS_SCHEMA.loadMemoryFromIncludeDirectories.type).toBe(
        'boolean',
      );
      expect(SETTINGS_SCHEMA.loadMemoryFromIncludeDirectories.category).toBe(
        'General',
      );
      expect(SETTINGS_SCHEMA.loadMemoryFromIncludeDirectories.default).toBe(
        false,
      );
    });

    it('should have folderTrustFeature setting in schema', () => {
      expect(SETTINGS_SCHEMA.folderTrustFeature).toBeDefined();
      expect(SETTINGS_SCHEMA.folderTrustFeature.type).toBe('boolean');
      expect(SETTINGS_SCHEMA.folderTrustFeature.category).toBe('General');
      expect(SETTINGS_SCHEMA.folderTrustFeature.default).toBe(false);
      expect(SETTINGS_SCHEMA.folderTrustFeature.showInDialog).toBe(true);
    });

    it('should have debugKeystrokeLogging setting in schema', () => {
      expect(SETTINGS_SCHEMA.debugKeystrokeLogging).toBeDefined();
      expect(SETTINGS_SCHEMA.debugKeystrokeLogging.type).toBe('boolean');
      expect(SETTINGS_SCHEMA.debugKeystrokeLogging.category).toBe('General');
      expect(SETTINGS_SCHEMA.debugKeystrokeLogging.default).toBe(false);
      expect(SETTINGS_SCHEMA.debugKeystrokeLogging.requiresRestart).toBe(false);
      expect(SETTINGS_SCHEMA.debugKeystrokeLogging.showInDialog).toBe(true);
      expect(SETTINGS_SCHEMA.debugKeystrokeLogging.description).toBe(
        'Enable debug logging of keystrokes to the console.',
      );
    });

    it('has JSON schema definitions for every referenced ref', () => {
      const schema = getSettingsSchema();
      const referenced = new Set<string>();
      const missing: string[] = [];

      const visitDefinition = (definition: SettingDefinition) => {
        if (definition.ref) {
          referenced.add(definition.ref);
          if (!SETTINGS_SCHEMA_DEFINITIONS[definition.ref]) {
            missing.push(definition.ref);
          }
        }
        if (definition.properties) {
          Object.values(definition.properties).forEach(visitDefinition);
        }
        if (definition.items) {
          visitCollection(definition.items);
        }
        if (definition.additionalProperties) {
          visitCollection(definition.additionalProperties);
        }
      };

      const visitCollection = (collection: SettingCollectionDefinition) => {
        if (collection.ref) {
          referenced.add(collection.ref);
          if (!SETTINGS_SCHEMA_DEFINITIONS[collection.ref]) {
            missing.push(collection.ref);
          }
          return;
        }
        if (collection.properties) {
          Object.values(collection.properties).forEach(visitDefinition);
        }
        if (collection.type === 'array' && collection.properties) {
          Object.values(collection.properties).forEach(visitDefinition);
        }
      };

      Object.values(schema).forEach(visitDefinition);

      // Check all referenced definitions exist
      expect(missing).toEqual([]);

      // Ensure definitions map doesn't accumulate stale entries.
      const unreferenced = Object.keys(SETTINGS_SCHEMA_DEFINITIONS).filter(
        (key) => !referenced.has(key),
      );
      expect(unreferenced).toEqual([]);
    });
  });
});
