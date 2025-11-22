import type { Config } from '@vybestack/llxprt-code-core';
import type { SettingDefinition } from '../config/settingsSchema.js';

type DynamicSettings = Record<string, SettingDefinition>;

class DynamicSettingsRegistry {
  private dynamicSettings: DynamicSettings = {};
  private isInitialized = false;

  register(settings: DynamicSettings): void {
    if (this.isInitialized) {
      throw new Error(
        'DynamicSettingsRegistry: Already initialized. Use reset() if needed.',
      );
    }
    this.validateSettings(settings);
    this.dynamicSettings = settings;
    this.isInitialized = true;
  }

  private validateSettings(settings: DynamicSettings): void {
    if (!settings || typeof settings !== 'object') {
      throw new Error('Settings must be a valid object');
    }

    if (Array.isArray(settings)) {
      throw new Error('Settings must be an object, not an array');
    }

    for (const [key, definition] of Object.entries(settings)) {
      if (!definition || typeof definition !== 'object') {
        throw new Error(
          `Setting definition for key '${key}' must be an object`,
        );
      }

      if (!definition.type || typeof definition.type !== 'string') {
        throw new Error(
          `Setting definition for key '${key}' must have a valid type`,
        );
      }

      if (!definition.label || typeof definition.label !== 'string') {
        throw new Error(
          `Setting definition for key '${key}' must have a valid label`,
        );
      }

      // Validate type is one of the allowed types
      const allowedTypes = [
        'boolean',
        'string',
        'number',
        'array',
        'object',
        'enum',
      ];
      if (!allowedTypes.includes(definition.type)) {
        throw new Error(
          `Setting definition for key '${key}' has invalid type '${definition.type}'. Allowed types: ${allowedTypes.join(', ')}`,
        );
      }
    }
  }

  reset(): void {
    this.dynamicSettings = {};
    this.isInitialized = false;
  }

  has(key: string): boolean {
    return key in this.dynamicSettings;
  }

  get(key: string): SettingDefinition | undefined {
    return this.dynamicSettings[key];
  }

  requiresRestart(key: string): boolean {
    return this.dynamicSettings[key]?.requiresRestart ?? false;
  }

  getAllRestartRequiredKeys(): string[] {
    return Object.entries(this.dynamicSettings)
      .filter(([, definition]) => definition.requiresRestart)
      .map(([key]) => key);
  }
}

export const dynamicSettingsRegistry = new DynamicSettingsRegistry();

/**
 * Generate dynamic tool settings based on all potential tools (registered and unregistered)
 */
export function generateDynamicToolSettings(
  config?: Config,
): Record<string, SettingDefinition> {
  if (!config) {
    return {};
  }

  try {
    const toolSettings: Record<string, SettingDefinition> = {};
    const toolRegistryInfo = config.getToolRegistryInfo();

    console.debug(
      `[generateDynamicToolSettings] Processing ${toolRegistryInfo.registered.length} registered and ${toolRegistryInfo.unregistered.length} unregistered tools`,
    );

    // Process registered tools
    for (const { displayName } of toolRegistryInfo.registered) {
      const settingKey = displayName.replace(/\s+/g, '');
      toolSettings[settingKey] = {
        type: 'boolean',
        label: displayName,
        category: 'Advanced',
        requiresRestart: true,
        default: true,
        description: `Enable the ${displayName} tool`,
        showInDialog: true,
      };
      console.debug(
        `[generateDynamicToolSettings]   ✅ REGISTERED: ${displayName}`,
      );
    }

    // Process unregistered tools with availability status
    for (const { displayName, reason } of toolRegistryInfo.unregistered) {
      const settingKey = displayName.replace(/\s+/g, '');
      toolSettings[settingKey] = {
        type: 'boolean',
        label: displayName,
        category: 'Advanced',
        requiresRestart: true,
        default: false,
        description: `${displayName} (unavailable: ${reason})`,
        showInDialog: true,
      };
      console.debug(
        `[generateDynamicToolSettings]   🚫 UNREGISTERED: ${displayName} - ${reason}`,
      );
    }

    console.debug(
      `[generateDynamicToolSettings] Final toolSettings count: ${Object.keys(toolSettings).length}`,
    );

    return toolSettings;
  } catch (error) {
    console.error('[generateDynamicToolSettings] Error:', error);
    return {};
  }
}
