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
  type Settings,
  getEnableHooks,
  getEnableHooksUI,
} from './settingsSchema.js';
import { validateSettings } from './settings-validation.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function getGeneratedSettingsSchemaPath(): string {
  const schemaPath = [
    resolve(process.cwd(), 'schemas/settings.schema.json'),
    resolve(process.cwd(), '../../schemas/settings.schema.json'),
  ].find((path) => existsSync(path));

  if (schemaPath === undefined) {
    throw new Error('Unable to locate schemas/settings.schema.json');
  }

  return schemaPath;
}

const generatedSettingsSchemaPath = getGeneratedSettingsSchemaPath();

type GeneratedSettingsSchema = {
  properties: {
    model: { anyOf?: Array<{ $ref: string }> };
    streamIdleTimeoutMs?: {
      type?: string;
      default?: number;
      minimum?: number;
      maximum?: number;
    };
  };
  $defs: {
    ModelConfig: {
      properties: {
        compressionThreshold: { minimum?: number; maximum?: number };
      };
    };
  };
};

function getGeneratedSchema(): GeneratedSettingsSchema {
  return JSON.parse(
    readFileSync(generatedSettingsSchemaPath, 'utf8'),
  ) as GeneratedSettingsSchema;
}

const parsedGeneratedSchema = getGeneratedSchema();

describe('SettingsSchema', () => {
  describe('SETTINGS_SCHEMA', () => {
    it('should contain all expected top-level settings', () => {
      const expectedSettings = [
        'ui',
        'accessibility',
        'checkpointing',
        'fileFiltering',
        'enableAutoUpdate',
        'useExternalAuth',
        'sandbox',
        'coreTools',
        'excludeTools',
        'defaultDisabledTools',
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
        'enableAutoUpdateNotification',
        'includeDirectories',
        'loadMemoryFromIncludeDirectories',
        'model',
        'hasSeenIdeIntegrationNudge',
        'folderTrustFeature',
        'useRipgrep',
        'enableFuzzyFiltering',
        'shouldUseNodePtyShell',
        'allowPtyThemeOverride',
        'ptyScrollbackLimit',
        'streamIdleTimeoutMs',
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
        SETTINGS_SCHEMA.accessibility.properties.enableLoadingPhrases,
      ).toBeDefined();
      expect(
        SETTINGS_SCHEMA.accessibility.properties.enableLoadingPhrases.type,
      ).toBe('boolean');
    });

    it('should have checkpointing nested properties', () => {
      expect(SETTINGS_SCHEMA.checkpointing.properties.enabled).toBeDefined();
      expect(SETTINGS_SCHEMA.checkpointing.properties.enabled.type).toBe(
        'boolean',
      );
    });

    it('should have fileFiltering nested properties', () => {
      expect(
        SETTINGS_SCHEMA.fileFiltering.properties.respectGitIgnore,
      ).toBeDefined();
      expect(
        SETTINGS_SCHEMA.fileFiltering.properties.respectLlxprtIgnore,
      ).toBeDefined();
      expect(
        SETTINGS_SCHEMA.fileFiltering.properties.enableRecursiveFileSearch,
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
      expect(SETTINGS_SCHEMA.ui.properties.showMemoryUsage.showInDialog).toBe(
        true,
      );
      expect(SETTINGS_SCHEMA.ui.properties.vimMode.showInDialog).toBe(true);
      expect(SETTINGS_SCHEMA.ui.properties.ideMode.showInDialog).toBe(true);
      expect(SETTINGS_SCHEMA.enableAutoUpdate.showInDialog).toBe(true);
      expect(SETTINGS_SCHEMA.ui.properties.hideWindowTitle.showInDialog).toBe(
        true,
      );
      expect(SETTINGS_SCHEMA.ui.properties.hideTips.showInDialog).toBe(true);
      expect(SETTINGS_SCHEMA.ui.properties.hideBanner.showInDialog).toBe(true);
      expect(SETTINGS_SCHEMA.ui.properties.enableMouseEvents.showInDialog).toBe(
        true,
      );
      expect(
        SETTINGS_SCHEMA.ui.properties.usageStatisticsEnabled.showInDialog,
      ).toBe(false);

      // Check that advanced settings are hidden from dialog
      expect(SETTINGS_SCHEMA.coreTools.showInDialog).toBe(false);
      expect(SETTINGS_SCHEMA.mcpServers.showInDialog).toBe(false);
      expect(SETTINGS_SCHEMA.telemetry.showInDialog).toBe(false);

      // Check that some settings are appropriately hidden
      expect(SETTINGS_SCHEMA.ui.properties.theme.showInDialog).toBe(false); // Changed to false
      expect(SETTINGS_SCHEMA.ui.properties.customThemes.showInDialog).toBe(
        false,
      ); // Managed via theme editor
      expect(SETTINGS_SCHEMA.checkpointing.showInDialog).toBe(false); // Experimental feature
      expect(SETTINGS_SCHEMA.accessibility.showInDialog).toBe(false); // Changed to false
      expect(SETTINGS_SCHEMA.fileFiltering.showInDialog).toBe(false); // Changed to false
      expect(SETTINGS_SCHEMA.ui.properties.preferredEditor.showInDialog).toBe(
        false,
      ); // Changed to false
      expect(
        SETTINGS_SCHEMA.ui.properties.autoConfigureMaxOldSpaceSize.showInDialog,
      ).toBe(true);
    });

    describe('ui.maxHeapSizeMB', () => {
      it('should be defined in the UI settings schema', () => {
        expect(SETTINGS_SCHEMA.ui.properties.maxHeapSizeMB).toBeDefined();
      });

      it('should be a number type', () => {
        expect(SETTINGS_SCHEMA.ui.properties.maxHeapSizeMB.type).toBe('number');
      });

      it('should have label Max Heap Size (MB)', () => {
        expect(SETTINGS_SCHEMA.ui.properties.maxHeapSizeMB.label).toBe(
          'Max Heap Size (MB)',
        );
      });

      it('should be in the UI category', () => {
        expect(SETTINGS_SCHEMA.ui.properties.maxHeapSizeMB.category).toBe('UI');
      });

      it('should require restart', () => {
        expect(
          SETTINGS_SCHEMA.ui.properties.maxHeapSizeMB.requiresRestart,
        ).toBe(true);
      });

      it('should default to 8192', () => {
        expect(SETTINGS_SCHEMA.ui.properties.maxHeapSizeMB.default).toBe(8192);
      });

      it('should have minimum of 512', () => {
        expect(SETTINGS_SCHEMA.ui.properties.maxHeapSizeMB.minimum).toBe(512);
      });

      it('should show in dialog', () => {
        expect(SETTINGS_SCHEMA.ui.properties.maxHeapSizeMB.showInDialog).toBe(
          true,
        );
      });

      it('should have a description', () => {
        const description =
          SETTINGS_SCHEMA.ui.properties.maxHeapSizeMB.description;
        expect(typeof description).toBe('string');
        expect(typeof description === 'string' && description.length > 0).toBe(
          true,
        );
      });

      it('should have multipleOf 1 (integer constraint)', () => {
        expect(SETTINGS_SCHEMA.ui.properties.maxHeapSizeMB.multipleOf).toBe(1);
      });

      it('should accept integer value 512 via validation', () => {
        const result = validateSettings({
          ui: { maxHeapSizeMB: 512 },
        });
        expect(result.success).toBe(true);
      });

      it('should accept integer value 8192 via validation', () => {
        const result = validateSettings({
          ui: { maxHeapSizeMB: 8192 },
        });
        expect(result.success).toBe(true);
      });

      it('should reject fractional value 1536.75 via validation', () => {
        const result = validateSettings({
          ui: { maxHeapSizeMB: 1536.75 },
        });
        expect(result.success).toBe(false);
      });

      it('should reject value below minimum 512 (e.g. 511) via validation', () => {
        const result = validateSettings({
          ui: { maxHeapSizeMB: 511 },
        });
        expect(result.success).toBe(false);
      });

      it('should accept value exactly at minimum 512 via validation', () => {
        const result = validateSettings({
          ui: { maxHeapSizeMB: 512 },
        });
        expect(result.success).toBe(true);
      });

      it('should reject fractional value below minimum via validation', () => {
        const result = validateSettings({
          ui: { maxHeapSizeMB: 511.5 },
        });
        expect(result.success).toBe(false);
      });

      it('should infer Settings[ui][maxHeapSizeMB] as number (accepts 4096 without casts)', () => {
        // Compile-time proof: maxHeapSizeMB is `number`, not the literal 8192.
        // If InferSettings incorrectly produced the literal type 8192, assigning
        // 4096 (or any other number) would fail to compile.
        const settings: Settings = {
          ui: {
            maxHeapSizeMB: 4096,
          },
        };
        expect(settings.ui?.maxHeapSizeMB).toBe(4096);

        // Also prove it accepts the default value
        const defaultSettings: Settings = {
          ui: {
            maxHeapSizeMB: 8192,
          },
        };
        expect(defaultSettings.ui?.maxHeapSizeMB).toBe(8192);
      });
    });

    describe('streamIdleTimeoutMs', () => {
      it('should be defined as a top-level setting in SETTINGS_SCHEMA', () => {
        expect(SETTINGS_SCHEMA.streamIdleTimeoutMs).toBeDefined();
      });

      it('should be a number type in SETTINGS_SCHEMA', () => {
        expect(SETTINGS_SCHEMA.streamIdleTimeoutMs.type).toBe('number');
      });

      it('should not define minimum or maximum constraints (permissive finite-number intent)', () => {
        expect('minimum' in SETTINGS_SCHEMA.streamIdleTimeoutMs).toBe(false);
        expect('maximum' in SETTINGS_SCHEMA.streamIdleTimeoutMs).toBe(false);
      });

      it('should default to 0 (watchdog disabled by default)', () => {
        expect(SETTINGS_SCHEMA.streamIdleTimeoutMs.default).toBe(0);
      });

      it('should accept a positive integer value via validation', () => {
        const result = validateSettings({ streamIdleTimeoutMs: 5000 });
        expect(result.success).toBe(true);
      });

      it('should accept zero (watchdog disabled) via validation', () => {
        const result = validateSettings({ streamIdleTimeoutMs: 0 });
        expect(result.success).toBe(true);
      });

      it('should accept a negative value via validation (no minimum constraint)', () => {
        const result = validateSettings({ streamIdleTimeoutMs: -1 });
        expect(result.success).toBe(true);
      });

      it('should accept a fractional value via validation (no multipleOf constraint)', () => {
        const result = validateSettings({ streamIdleTimeoutMs: 0.5 });
        expect(result.success).toBe(true);
      });

      it('should be present in the generated settings.schema.json as type number without minimum/maximum', () => {
        const setting = parsedGeneratedSchema.properties.streamIdleTimeoutMs;
        expect(setting).toBeDefined();
        expect(setting?.type).toBe('number');
        expect(setting?.default).toBe(0);
        expect(setting?.minimum).toBeUndefined();
        expect(setting?.maximum).toBeUndefined();
      });
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
      expect(settings.includeDirectories).toStrictEqual(['/path/to/dir']);
      expect(settings.loadMemoryFromIncludeDirectories).toBe(true);
    });

    it('should have includeDirectories setting in schema', () => {
      expect(SETTINGS_SCHEMA.includeDirectories).toBeDefined();
      expect(SETTINGS_SCHEMA.includeDirectories.type).toBe('array');
      expect(SETTINGS_SCHEMA.includeDirectories.category).toBe('General');
      expect(SETTINGS_SCHEMA.includeDirectories.default).toStrictEqual([]);
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

    it('should have defaultDisabledTools setting in schema', () => {
      expect(SETTINGS_SCHEMA.defaultDisabledTools).toBeDefined();
      expect(SETTINGS_SCHEMA.defaultDisabledTools.type).toBe('array');
      expect(SETTINGS_SCHEMA.defaultDisabledTools.category).toBe('Advanced');
      expect(SETTINGS_SCHEMA.defaultDisabledTools.default).toStrictEqual([
        'google_web_fetch',
        'google_web_search',
      ]);
      expect(SETTINGS_SCHEMA.defaultDisabledTools.showInDialog).toBe(false);
      expect(SETTINGS_SCHEMA.defaultDisabledTools.requiresRestart).toBe(true);
    });

    it('should represent model as an explicit string-or-object union', () => {
      expect(SETTINGS_SCHEMA.model.type).toBe('union');
      expect(SETTINGS_SCHEMA.model.refs).toStrictEqual([
        'ModelName',
        'ModelConfig',
      ]);
      expect(SETTINGS_SCHEMA_DEFINITIONS.ModelName).toMatchObject({
        type: 'string',
      });
      expect(SETTINGS_SCHEMA_DEFINITIONS.ModelConfig).toMatchObject({
        type: 'object',
        additionalProperties: false,
        properties: {
          compressionThreshold: { type: 'number', minimum: 0, maximum: 1 },
        },
      });
    });

    it('should keep generated JSON schema model union consistent with schema definitions', () => {
      expect(parsedGeneratedSchema.properties.model.anyOf).toStrictEqual([
        { $ref: '#/$defs/ModelName' },
        { $ref: '#/$defs/ModelConfig' },
      ]);
      expect(
        parsedGeneratedSchema.$defs.ModelConfig.properties.compressionThreshold,
      ).toMatchObject({
        minimum: 0,
        maximum: 1,
      });
    });

    it('has JSON schema definitions for every referenced ref', () => {
      const schema = getSettingsSchema();
      const referenced = new Set<string>();
      const missing: string[] = [];

      const recordReference = (ref: string): void => {
        referenced.add(ref);
        if (!(ref in SETTINGS_SCHEMA_DEFINITIONS)) {
          missing.push(ref);
        }
      };

      const visitRefs = (refs: readonly string[] | undefined): void => {
        for (const ref of refs ?? []) {
          recordReference(ref);
        }
      };

      const visitDefinition = (definition: SettingDefinition): void => {
        if (definition.ref) {
          recordReference(definition.ref);
        }
        visitRefs(definition.refs);

        if (definition.properties) {
          Object.values(definition.properties).forEach(visitDefinition);
        }
        if (definition.items) {
          visitCollection(definition.items);
        }
        if (definition.additionalProperties !== undefined) {
          const additionalProperties = definition.additionalProperties;
          if (additionalProperties !== false) {
            visitCollection(additionalProperties);
          }
        }
      };

      const visitCollection = (
        collection: SettingCollectionDefinition,
      ): void => {
        if (collection.ref) {
          recordReference(collection.ref);
        }
        visitRefs(collection.refs);

        if (collection.properties) {
          Object.values(collection.properties).forEach(visitDefinition);
        }
      };

      Object.values(schema).forEach(visitDefinition);

      // Check all referenced definitions exist
      expect(missing).toStrictEqual([]);

      // Ensure definitions map doesn't accumulate stale entries.
      const unreferenced = Object.keys(SETTINGS_SCHEMA_DEFINITIONS).filter(
        (key) => !referenced.has(key),
      );
      expect(unreferenced).toStrictEqual([]);
    });
  });
});

describe('getEnableHooks', () => {
  it('returns false when no settings are provided (both defaults)', () => {
    expect(getEnableHooks({} as Settings)).toBe(false);
  });

  it('returns false when only tools.enableHooks is true (hooksConfig.enabled defaults to false)', () => {
    expect(getEnableHooks({ tools: { enableHooks: true } } as Settings)).toBe(
      false,
    );
  });

  it('returns true when hooksConfig.enabled is true and tools.enableHooks is absent (defaults true)', () => {
    expect(getEnableHooks({ hooksConfig: { enabled: true } } as Settings)).toBe(
      true,
    );
  });

  it('returns true when both gates are explicitly true', () => {
    expect(
      getEnableHooks({
        tools: { enableHooks: true },
        hooksConfig: { enabled: true },
      } as Settings),
    ).toBe(true);
  });

  it('returns false when tools.enableHooks is explicitly false', () => {
    expect(
      getEnableHooks({
        tools: { enableHooks: false },
        hooksConfig: { enabled: true },
      } as Settings),
    ).toBe(false);
  });

  it('returns false when hooksConfig.enabled is explicitly false', () => {
    expect(
      getEnableHooks({
        tools: { enableHooks: true },
        hooksConfig: { enabled: false },
      } as Settings),
    ).toBe(false);
  });
});

describe('getEnableHooksUI', () => {
  it('returns true when no settings are provided (tools.enableHooks defaults to true)', () => {
    expect(getEnableHooksUI({} as Settings)).toBe(true);
  });

  it('returns false when tools.enableHooks is explicitly false', () => {
    expect(
      getEnableHooksUI({ tools: { enableHooks: false } } as Settings),
    ).toBe(false);
  });
});
