import {
  DebugLogger,
  type Config,
  debugLogger,
} from '@vybestack/llxprt-code-core';
import type { SettingDefinition } from '../config/settingsSchema.js';

const logger = new DebugLogger('llxprt:dynamic-settings');

type DynamicSettings = Record<string, SettingDefinition>;
type DynamicSettingsInput = Record<string, unknown>;

const allowedTypes = [
  'boolean',
  'string',
  'number',
  'array',
  'object',
  'enum',
] as const;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAllowedType(value: unknown): value is SettingDefinition['type'] {
  return (
    typeof value === 'string' &&
    allowedTypes.includes(value as SettingDefinition['type'])
  );
}

class DynamicSettingsRegistry {
  private dynamicSettings: DynamicSettings = {};
  private isInitialized = false;

  register(settings: DynamicSettingsInput): void {
    if (this.isInitialized) {
      throw new Error(
        'DynamicSettingsRegistry: Already initialized. Use reset() if needed.',
      );
    }
    const validatedSettings = this.validateSettings(settings);
    this.dynamicSettings = validatedSettings;
    this.isInitialized = true;
  }

  private validateSettings(settings: unknown): DynamicSettings {
    if (typeof settings !== 'object' || settings === null) {
      throw new Error('Settings must be a valid object');
    }

    if (Array.isArray(settings)) {
      throw new Error('Settings must be an object, not an array');
    }

    const validatedSettings: DynamicSettings = {};
    for (const [key, definition] of Object.entries(settings)) {
      if (!isObjectRecord(definition)) {
        throw new Error(
          `Setting definition for key '${key}' must be an object`,
        );
      }

      if (!isAllowedType(definition.type)) {
        throw new Error(
          `Setting definition for key '${key}' must have a valid type`,
        );
      }

      if (
        typeof definition.label !== 'string' ||
        definition.label.length === 0
      ) {
        throw new Error(
          `Setting definition for key '${key}' must have a valid label`,
        );
      }

      validatedSettings[key] = definition as unknown as SettingDefinition;
    }

    return validatedSettings;
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
    const definition = this.get(key);
    return definition?.requiresRestart ?? false;
  }

  getAllRestartRequiredKeys(): string[] {
    return Object.entries(this.dynamicSettings)
      .filter(([, definition]) => definition.requiresRestart === true)
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

    logger.log(
      `Processing ${toolRegistryInfo.registered.length} registered and ${toolRegistryInfo.unregistered.length} unregistered tools`,
    );

    // Detailed output only in verbose mode
    const verboseDebug = process.env.DEBUG?.includes('verbose') === true;

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
      if (verboseDebug) {
        logger.log(`✅ REGISTERED: ${displayName}`);
      }
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
      if (verboseDebug) {
        logger.log(`🚫 UNREGISTERED: ${displayName} - ${reason}`);
      }
    }

    logger.log(`Final toolSettings count: ${Object.keys(toolSettings).length}`);

    return toolSettings;
  } catch (error) {
    debugLogger.error('[generateDynamicToolSettings] Error:', error);
    return {};
  }
}
