/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import type { HookDefinition, HookConfig } from './types.js';
import { HookEventName } from './types.js';
import { DebugLogger } from '../debug/index.js';
import { TrustedHooksManager } from './trustedHooks.js';
import { coreEvents, CoreEvent } from '../utils/events.js';

/**
 * Fields in the hooks configuration that are not hook event names.
 * Only include keys verified in LLxprt's actual hook config schema.
 */
const HOOKS_CONFIG_FIELDS = ['disabled', 'enabled', 'notifications'];

const debugLogger = DebugLogger.getLogger('llxprt:core:hooks:registry');

/**
 * Configuration source levels in precedence order (highest to lowest)
 */
export enum ConfigSource {
  Project = 'project',
  User = 'user',
  System = 'system',
  Extensions = 'extensions',
}

/**
 * Hook registry entry with source information
 */
export interface HookRegistryEntry {
  config: HookConfig;
  source: ConfigSource;
  eventName: HookEventName;
  matcher?: string;
  sequential?: boolean;
  enabled: boolean;
}

/**
 * Hook registry that loads and validates hook definitions from multiple sources
 */
export class HookRegistry {
  private readonly config: Config;
  private entries: HookRegistryEntry[] = [];

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Initialize the registry by processing hooks from config
   */
  async initialize(): Promise<void> {
    this.entries = [];
    this.processHooksFromConfig();

    debugLogger.log(
      `Hook registry initialized with ${this.entries.length} hook entries`,
    );
  }

  /**
   * Get all hook entries for a specific event
   */
  getHooksForEvent(eventName: HookEventName): HookRegistryEntry[] {
    return this.entries
      .filter((entry) => entry.eventName === eventName && entry.enabled)
      .sort(
        (a, b) =>
          this.getSourcePriority(a.source) - this.getSourcePriority(b.source),
      );
  }

  /**
   * Get all registered hooks
   */
  getAllHooks(): HookRegistryEntry[] {
    return [...this.entries];
  }

  /**
   * Enable or disable a specific hook
   */
  setHookEnabled(hookName: string, enabled: boolean): void {
    this.setHookEnabledByName(hookName, enabled);
  }

  /**
   * Internal method to enable or disable a hook by name
   */
  private setHookEnabledByName(hookName: string, enabled: boolean): void {
    const updated = this.entries.filter((entry) => {
      const name = this.getHookName(entry);
      if (name === hookName) {
        entry.enabled = enabled;
        return true;
      }
      return false;
    });

    if (updated.length > 0) {
      debugLogger.log(
        `${enabled ? 'Enabled' : 'Disabled'} ${updated.length} hook(s) matching "${hookName}"`,
      );
    } else {
      debugLogger.warn(`No hooks found matching "${hookName}"`);
    }
  }

  /**
   * Get hook name for identification and display purposes (public for external use)
   */
  getHookName(entry: HookRegistryEntry | { config: HookConfig }): string {
    return entry.config.name || entry.config.command || 'unknown-command';
  }

  /**
   * Check if project hooks are trusted, warn and auto-trust if not
   */
  private checkProjectHooksTrust(): void {
    const projectHooks = this.config.getProjectHooks();

    // Collect all hook configs from project settings
    const allProjectHooks: HookConfig[] = [];
    if (projectHooks) {
      for (const [key, eventDefinitions] of Object.entries(projectHooks)) {
        // Skip the 'disabled' key
        if (key === 'disabled') continue;

        if (Array.isArray(eventDefinitions)) {
          for (const definition of eventDefinitions) {
            if (
              definition &&
              typeof definition === 'object' &&
              'hooks' in definition
            ) {
              const hookDef = definition;
              if (hookDef.hooks) {
                allProjectHooks.push(...hookDef.hooks);
              }
            }
          }
        }
      }
    }

    if (allProjectHooks.length === 0) {
      return;
    }

    const trustManager = new TrustedHooksManager();
    trustManager.load();

    const untrusted = trustManager.getUntrustedHooks(allProjectHooks);

    if (untrusted.length > 0) {
      const hookNames = untrusted.map((h) => h.name || h.command).join(', ');
      const warning = `WARNING: Project defines ${untrusted.length} untrusted hook(s): ${hookNames}. Review these hooks before trusting them.
`;

      coreEvents.emit(CoreEvent.Output, {
        chunk: warning,
        isStderr: true,
      });
    }
  }

  /**
   * Process hooks from the config that was already loaded by the CLI
   */
  private processHooksFromConfig(): void {
    // Check project hooks trust if folder is trusted
    if (this.config.isTrustedFolder()) {
      this.checkProjectHooksTrust();
    }

    // Get hooks from the main config (this comes from the merged settings)
    const configHooks = this.config.getHooks();

    // Skip project hooks if folder is not trusted
    if (!this.config.isTrustedFolder()) {
      debugLogger.log('Skipping project hooks - folder not trusted');
    } else if (configHooks) {
      this.processHooksConfiguration(configHooks, ConfigSource.Project);
    }

    // Get hooks from extensions (always allowed)
    const extensions = this.config.getExtensions() || [];
    for (const extension of extensions) {
      if (extension.isActive && extension.hooks) {
        this.processHooksConfiguration(
          extension.hooks,
          ConfigSource.Extensions,
        );
      }
    }
  }

  /**
   * Process hooks configuration and add entries
   */
  private processHooksConfiguration(
    hooksConfig: { [K in HookEventName]?: HookDefinition[] },
    source: ConfigSource,
  ): void {
    for (const [eventName, definitions] of Object.entries(hooksConfig)) {
      // Warn about config keys that belong under hooksConfig, not hooks
      if (HOOKS_CONFIG_FIELDS.includes(eventName)) {
        coreEvents.emit(CoreEvent.Output, {
          chunk: `Warning: "${eventName}" is a hooksConfig field, not a hook event. It is ignored under "hooks" — move it to "hooksConfig". Skipping.
`,
          isStderr: true,
        });
        continue;
      }

      if (!this.isValidEventName(eventName)) {
        coreEvents.emit(CoreEvent.Output, {
          chunk: `Warning: Invalid hook event name: "${eventName}" from ${source} config. Skipping.
`,
          isStderr: true,
        });
        continue;
      }

      const typedEventName = eventName;

      if (!Array.isArray(definitions)) {
        debugLogger.warn(
          `Hook definitions for event "${eventName}" from source "${source}" is not an array. Skipping.`,
        );
        continue;
      }

      for (const definition of definitions) {
        this.processHookDefinition(definition, typedEventName, source);
      }
    }
  }

  /**
   * Process a single hook definition
   */
  private processHookDefinition(
    definition: HookDefinition,
    eventName: HookEventName,
    source: ConfigSource,
  ): void {
    if (
      !definition ||
      typeof definition !== 'object' ||
      !Array.isArray(definition.hooks)
    ) {
      debugLogger.warn(
        `Discarding invalid hook definition for ${eventName} from ${source}:`,
        definition,
      );
      return;
    }

    const disabledHooks = this.config.getDisabledHooks() || [];

    for (const hookConfig of definition.hooks) {
      if (
        hookConfig &&
        typeof hookConfig === 'object' &&
        this.validateHookConfig(hookConfig, eventName, source)
      ) {
        // Set source on the hook config for secondary security check
        (hookConfig as { source?: ConfigSource }).source = source;

        const hookName = this.getHookName({
          config: hookConfig,
        } as HookRegistryEntry);
        const isDisabled = disabledHooks.includes(hookName);

        this.entries.push({
          config: hookConfig,
          source,
          eventName,
          matcher: definition.matcher,
          sequential: definition.sequential,
          enabled: !isDisabled,
        });
      } else {
        // Invalid hooks are logged and discarded here, they won't reach HookRunner
        debugLogger.warn(
          `Discarding invalid hook configuration for ${eventName} from ${source}:`,
          hookConfig,
        );
      }
    }
  }

  /**
   * Validate a hook configuration
   */
  private validateHookConfig(
    config: HookConfig,
    eventName: HookEventName,
    source: ConfigSource,
  ): boolean {
    if (!config.type || !['command', 'plugin'].includes(config.type)) {
      debugLogger.warn(
        `Invalid hook ${eventName} from ${source} type: ${config.type}`,
      );
      return false;
    }

    if (config.type === 'command' && !config.command) {
      debugLogger.warn(
        `Command hook ${eventName} from ${source} missing command field`,
      );
      return false;
    }

    return true;
  }

  /**
   * Check if an event name is valid
   */
  private isValidEventName(eventName: string): eventName is HookEventName {
    const validEventNames = Object.values(HookEventName);
    return validEventNames.includes(eventName as HookEventName);
  }

  /**
   * Get source priority (lower number = higher priority)
   */
  private getSourcePriority(source: ConfigSource): number {
    switch (source) {
      case ConfigSource.Project:
        return 1;
      case ConfigSource.User:
        return 2;
      case ConfigSource.System:
        return 3;
      case ConfigSource.Extensions:
        return 4;
      default:
        return 999;
    }
  }
}
