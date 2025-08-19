/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
  CommandKind,
} from './types.js';
import { IProvider, EmojiFilterMode } from '@vybestack/llxprt-code-core';

// Subcommand for /set unset - removes ephemeral settings or model parameters
const unsetCommand: SlashCommand = {
  name: 'unset',
  description: 'remove an ephemeral setting or model parameter',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    const parts = args?.trim().split(/\s+/);
    if (!parts || parts.length === 0 || !parts[0]) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          'Usage: /set unset <key> [subkey]\nExamples:\n  /set unset context-limit\n  /set unset custom-headers Authorization\n  /set unset modelparam max_tokens',
      };
    }

    const key = parts[0];
    const subkey = parts[1];

    // Get the config
    const config = context.services.config;
    if (!config) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No configuration available',
      };
    }

    // Handle unset for model parameters
    if (key === 'modelparam' && subkey) {
      const providerManager = config.getProviderManager();
      const activeProvider = providerManager?.getActiveProvider();

      if (!activeProvider) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'No active provider',
        };
      }

      if (
        'getModelParams' in activeProvider &&
        typeof activeProvider.getModelParams === 'function'
      ) {
        const modelParams = activeProvider.getModelParams();
        if (!modelParams || !(subkey in modelParams)) {
          return {
            type: 'message',
            messageType: 'error',
            content: `Model parameter '${subkey}' is not set`,
          };
        }

        if (
          'setModelParams' in activeProvider &&
          typeof activeProvider.setModelParams === 'function'
        ) {
          activeProvider.setModelParams({ [subkey]: undefined });
          return {
            type: 'message',
            messageType: 'info',
            content: `Model parameter '${subkey}' has been removed`,
          };
        }
      }

      return {
        type: 'message',
        messageType: 'error',
        content: 'Provider does not support model parameters',
      };
    }

    // Handle nested unset for custom-headers
    if (key === 'custom-headers' && subkey) {
      const currentHeaders = config.getEphemeralSetting('custom-headers') as
        | Record<string, string>
        | undefined;
      if (!currentHeaders || !(subkey in currentHeaders)) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Custom header '${subkey}' is not set`,
        };
      }

      // Remove the specific header
      const updatedHeaders = { ...currentHeaders };
      delete updatedHeaders[subkey];

      // If no headers left, remove the entire setting
      if (Object.keys(updatedHeaders).length === 0) {
        // Note: SettingsService doesn't currently support ephemeral settings,
        // so we continue to use the config directly for these session-only settings
        config.setEphemeralSetting('custom-headers', undefined);
        return {
          type: 'message',
          messageType: 'info',
          content: `Removed custom header '${subkey}' and cleared custom-headers setting`,
        };
      } else {
        config.setEphemeralSetting('custom-headers', updatedHeaders);
        return {
          type: 'message',
          messageType: 'info',
          content: `Removed custom header '${subkey}'`,
        };
      }
    }

    // Handle regular unset (non-nested)
    if (subkey) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Setting '${key}' does not support nested unset. Use: /set unset ${key}`,
      };
    }

    // No special handling for emojifilter - treat it like any other ephemeral setting

    // Check if the setting exists
    const currentValue = config.getEphemeralSetting(key);
    if (currentValue === undefined) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Ephemeral setting '${key}' is not set`,
      };
    }

    // Clear the ephemeral setting
    // Note: SettingsService doesn't currently support ephemeral settings,
    // so we continue to use the config directly for these session-only settings
    config.setEphemeralSetting(key, undefined);

    // Special handling for context-limit and compression-threshold
    if (key === 'context-limit' || key === 'compression-threshold') {
      const geminiClient = config.getGeminiClient();
      if (geminiClient) {
        // Reset to defaults by passing undefined
        geminiClient.setCompressionSettings(
          key === 'compression-threshold'
            ? undefined
            : (config.getEphemeralSetting('compression-threshold') as
                | number
                | undefined),
          key === 'context-limit'
            ? undefined
            : (config.getEphemeralSetting('context-limit') as
                | number
                | undefined),
        );
      }
    }

    return {
      type: 'message',
      messageType: 'info',
      content: `Ephemeral setting '${key}' has been removed`,
    };
  },
  completion: async (_context: CommandContext, partialArg: string) => {
    // Get all current ephemeral settings
    const config = _context.services.config;
    if (!config) return [];

    const ephemeralSettings = config.getEphemeralSettings();
    const ephemeralKeys = Object.keys(ephemeralSettings).filter(
      (key) => ephemeralSettings[key] !== undefined,
    );

    // Add 'modelparam' and 'emojifilter' as completion options
    const specialKeys = ['modelparam', 'emojifilter'];

    const allKeys = [...ephemeralKeys, ...specialKeys];

    if (partialArg) {
      const parts = partialArg.split(/\s+/);

      // If user typed "emojifilter " (with space), offer mode options
      if (parts.length === 2 && parts[0] === 'emojifilter') {
        const modes = ['allowed', 'auto', 'warn', 'error'];
        if (parts[1]) {
          return modes.filter((mode) => mode.startsWith(parts[1]));
        }
        return modes;
      }

      // If user typed "modelparam " (with space), offer model param names
      if (parts.length === 2 && parts[0] === 'modelparam') {
        const providerManager = config.getProviderManager();
        const activeProvider = providerManager?.getActiveProvider();
        if (
          activeProvider &&
          'getModelParams' in activeProvider &&
          typeof activeProvider.getModelParams === 'function'
        ) {
          const modelParams = activeProvider.getModelParams();
          if (modelParams) {
            const paramNames = Object.keys(modelParams);
            if (parts[1]) {
              return paramNames.filter((name) => name.startsWith(parts[1]));
            }
            return paramNames;
          }
        }
        return [];
      }

      // If user typed "custom-headers " (with space), offer header names
      if (parts.length === 2 && parts[0] === 'custom-headers') {
        const headers = ephemeralSettings['custom-headers'] as
          | Record<string, string>
          | undefined;
        if (headers) {
          const headerNames = Object.keys(headers);
          if (parts[1]) {
            return headerNames.filter((name) => name.startsWith(parts[1]));
          }
          return headerNames;
        }
        return [];
      }

      // Otherwise, complete the setting key
      return allKeys.filter((key) => key.startsWith(parts[0]));
    }

    return allKeys;
  },
};

// Subcommand for /set modelparam
const modelParamCommand: SlashCommand = {
  name: 'modelparam',
  description: 'set model parameters like temperature, max_tokens, etc',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    const parts = args?.trim().split(/\s+/);
    if (!parts || parts.length < 2) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          'Usage: /set modelparam <key> <value>\nExample: /set modelparam temperature 0.7',
      };
    }

    const key = parts[0];
    const value = parts.slice(1).join(' ');

    // Get provider manager from config
    const config = context.services.config;
    if (!config) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No configuration available',
      };
    }

    const providerManager = config.getProviderManager();
    if (!providerManager) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Provider manager not initialized',
      };
    }

    const activeProvider = providerManager.getActiveProvider() as IProvider;
    if (!activeProvider) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No active provider',
      };
    }

    // Check if provider supports setModelParams
    if (
      !('setModelParams' in activeProvider) ||
      typeof activeProvider.setModelParams !== 'function'
    ) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Provider '${activeProvider.name}' does not support model parameters`,
      };
    }

    // Parse the value
    const parsedValue = parseValue(value);

    // Set the model parameter
    try {
      await activeProvider.setModelParams({ [key]: parsedValue });
      return {
        type: 'message',
        messageType: 'info',
        content: `Model parameter '${key}' set to ${JSON.stringify(parsedValue)} (use /profile save to persist)`,
      };
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to set model parameter: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
  completion: async (_context: CommandContext, partialArg: string) => {
    // Common model parameters across providers
    const commonParams = [
      'temperature',
      'max_tokens',
      'maxOutputTokens',
      'top_p',
      'top_k',
      'presence_penalty',
      'frequency_penalty',
      'stop_sequences',
      'seed',
      'enable_thinking',
    ];

    // If user has typed part of a parameter name, filter suggestions
    if (partialArg) {
      const parts = partialArg.split(/\s+/);
      if (parts.length === 1) {
        // Still typing the parameter name
        return commonParams.filter((param) => param.startsWith(parts[0]));
      }
    }

    return [];
  },
};

/**
 * Implementation for the /set command that handles both:
 * - /set modelparam <key> <value>
 * - /set <ephemeral-key> <value>
 */
// Help text for ephemeral settings - these are session-only and saved only via profiles
const ephemeralSettingHelp: Record<string, string> = {
  'context-limit':
    'Maximum number of tokens for the context window (e.g., 100000)',
  'compression-threshold':
    'Fraction of context limit that triggers compression (0.0-1.0, e.g., 0.7 for 70%)',
  'base-url': 'Base URL for API requests',
  'tool-format': 'Tool format override for the provider',
  'api-version': 'API version to use',
  'custom-headers': 'Custom HTTP headers as JSON object',
  'stream-options':
    'Stream options for OpenAI API (default: { include_usage: true })',
  streaming:
    'Enable or disable streaming responses (enabled/disabled, default: enabled)',
  'shell-replacement':
    'Allow command substitution ($(), <(), backticks) in shell commands (default: false)',
  // Tool output limit settings - apply to all tools that can return large outputs
  'tool-output-max-items':
    'Maximum number of items/files/matches returned by tools (default: 50)',
  'tool-output-max-tokens': 'Maximum tokens in tool output (default: 50000)',
  'tool-output-truncate-mode':
    'How to handle exceeding limits: warn, truncate, or sample (default: warn)',
  'tool-output-item-size-limit':
    'Maximum size per item/file in bytes (default: 524288 = 512KB)',
  // Final catch-all to prevent context overflow
  'max-prompt-tokens':
    'Maximum tokens allowed in any prompt sent to LLM (default: 200000)',
  // Emoji filter settings
  emojifilter: 'Emoji filter mode (allowed, auto, warn, error)',
};

export const setCommand: SlashCommand = {
  name: 'set',
  description: 'set model parameters or ephemeral settings',
  kind: CommandKind.BUILT_IN,
  subCommands: [modelParamCommand, unsetCommand],
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    // This handles direct ephemeral settings: /set <ephemeral-key> <value>
    const trimmedArgs = args?.trim();
    if (!trimmedArgs) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          'Usage: /set <ephemeral-key> <value>\nExample: /set context-limit 100000\n\nFor model parameters use: /set modelparam <key> <value>',
      };
    }

    const parts = trimmedArgs.split(/\s+/);
    const key = parts[0];

    // If only key is provided, show help for that key
    if (parts.length === 1) {
      if (ephemeralSettingHelp[key]) {
        return {
          type: 'message',
          messageType: 'info',
          content: `${key}: ${ephemeralSettingHelp[key]}`,
        };
      }
      return {
        type: 'message',
        messageType: 'error',
        content: `Usage: /set ${key} <value>\n\nValid ephemeral keys:\n${Object.entries(
          ephemeralSettingHelp,
        )
          .map(([k, v]) => `  ${k}: ${v}`)
          .join('\n')}`,
      };
    }

    const value = parts.slice(1).join(' '); // Join remaining parts as value

    // List of valid ephemeral settings from the specification
    const validEphemeralKeys = Object.keys(ephemeralSettingHelp);

    // Check if it's a valid ephemeral key
    if (!validEphemeralKeys.includes(key)) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Invalid setting key: ${key}. Valid keys are: ${validEphemeralKeys.join(', ')}`,
      };
    }

    // Parse the value
    let parsedValue = parseValue(value);

    // Validate specific settings
    if (key === 'compression-threshold') {
      const numValue = parsedValue as number;
      if (typeof numValue !== 'number' || numValue <= 0 || numValue > 1) {
        return {
          type: 'message',
          messageType: 'error',
          content: `compression-threshold must be a decimal between 0 and 1 (e.g., 0.7 for 70%)`,
        };
      }
    }

    if (key === 'context-limit') {
      const numValue = parsedValue as number;
      if (
        typeof numValue !== 'number' ||
        numValue <= 0 ||
        !Number.isInteger(numValue)
      ) {
        return {
          type: 'message',
          messageType: 'error',
          content: `context-limit must be a positive integer (e.g., 100000)`,
        };
      }
    }

    // Validate tool output settings
    if (
      key === 'tool-output-max-items' ||
      key === 'tool-output-max-tokens' ||
      key === 'tool-output-item-size-limit' ||
      key === 'max-prompt-tokens'
    ) {
      const numValue = parsedValue as number;
      if (
        typeof numValue !== 'number' ||
        numValue <= 0 ||
        !Number.isInteger(numValue)
      ) {
        return {
          type: 'message',
          messageType: 'error',
          content: `${key} must be a positive integer`,
        };
      }
    }

    if (key === 'tool-output-truncate-mode') {
      const validModes = ['warn', 'truncate', 'sample'];
      if (!validModes.includes(parsedValue as string)) {
        return {
          type: 'message',
          messageType: 'error',
          content: `${key} must be one of: ${validModes.join(', ')}`,
        };
      }
    }

    // Validate emojifilter mode
    if (key === 'emojifilter') {
      const validModes: EmojiFilterMode[] = [
        'allowed',
        'auto',
        'warn',
        'error',
      ];
      const normalizedValue = (
        parsedValue as string
      ).toLowerCase() as EmojiFilterMode;
      if (!validModes.includes(normalizedValue)) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Invalid emoji filter mode '${parsedValue}'. Valid modes are: ${validModes.join(', ')}`,
        };
      }
      // Override the parsed value with normalized lowercase version
      parsedValue = normalizedValue;
    }

    // Validate shell-replacement setting
    if (key === 'shell-replacement') {
      if (typeof parsedValue !== 'boolean') {
        return {
          type: 'message',
          messageType: 'error',
          content: `shell-replacement must be either 'true' or 'false'`,
        };
      }
    }

    // Validate streaming mode
    if (key === 'streaming') {
      const validModes = ['enabled', 'disabled'];
      const normalizedValue = (parsedValue as string).toLowerCase();
      if (!validModes.includes(normalizedValue)) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Invalid streaming mode '${parsedValue}'. Valid modes are: ${validModes.join(', ')}`,
        };
      }
      // Override the parsed value with normalized lowercase version
      parsedValue = normalizedValue;
    }

    // Get the config to apply settings
    const config = context.services.config;
    if (!config) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No configuration available',
      };
    }

    const settingsService = config.getSettingsService();
    const useSettingsService = settingsService !== null;

    // Apply settings to GeminiClient for context-limit and compression-threshold
    if (key === 'context-limit' || key === 'compression-threshold') {
      const geminiClient = config.getGeminiClient();
      if (geminiClient) {
        const contextLimit =
          key === 'context-limit' ? (parsedValue as number) : undefined;
        const compressionThreshold =
          key === 'compression-threshold' ? (parsedValue as number) : undefined;
        geminiClient.setCompressionSettings(compressionThreshold, contextLimit);
      }
    }

    // Store emojifilter in ephemeral settings like everything else
    // No special handling needed - it will be stored below with other settings

    // Store ephemeral settings in memory only
    // They will be saved only when user explicitly saves a profile
    // Note: SettingsService doesn't currently support ephemeral settings,
    // so we continue to use the config directly for these session-only settings
    if (useSettingsService) {
      // When SettingsService is available, we still use config for ephemeral settings
      // as they are session-only and not persisted to the settings file
      config.setEphemeralSetting(key, parsedValue);
    } else {
      // Fallback to direct config usage
      config.setEphemeralSetting(key, parsedValue);
    }

    return {
      type: 'message',
      messageType: 'info',
      content: `Ephemeral setting '${key}' set to ${JSON.stringify(parsedValue)} (session only, use /profile save to persist)`,
    };
  },
  completion: async (_context: CommandContext, partialArg: string) => {
    // Provide completions for ephemeral settings
    const ephemeralKeys = Object.keys(ephemeralSettingHelp);

    if (partialArg) {
      const parts = partialArg.split(/\s+/);
      if (parts.length === 1) {
        // Still typing the key
        return ephemeralKeys.filter((key) => key.startsWith(parts[0]));
      } else if (parts.length === 2) {
        // User has typed the key and a space, provide value completions for specific keys
        const key = parts[0];

        // Provide completions for tool-output-truncate-mode
        if (key === 'tool-output-truncate-mode') {
          const modes = ['warn', 'truncate', 'sample'];
          if (parts[1]) {
            return modes.filter((mode) => mode.startsWith(parts[1]));
          }
          return modes;
        }

        // Provide completions for emojifilter
        if (key === 'emojifilter') {
          const modes = ['allowed', 'auto', 'warn', 'error'];
          if (parts[1]) {
            return modes.filter((mode) =>
              mode.startsWith(parts[1].toLowerCase()),
            );
          }
          return modes;
        }

        // Provide completions for shell-replacement
        if (key === 'shell-replacement') {
          const values = ['true', 'false'];
          if (parts[1]) {
            return values.filter((value) =>
              value.startsWith(parts[1].toLowerCase()),
            );
          }
          return values;
        }

        // Provide completions for streaming
        if (key === 'streaming') {
          const modes = ['enabled', 'disabled'];
          if (parts[1]) {
            return modes.filter((mode) =>
              mode.startsWith(parts[1].toLowerCase()),
            );
          }
          return modes;
        }
      }
    }

    return ephemeralKeys;
  },
};

/**
 * Parse a string value into the appropriate type.
 * Handles numbers, booleans, and JSON objects/arrays.
 */
function parseValue(value: string): unknown {
  // Try to parse as number
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    const num = Number(value);
    if (!isNaN(num)) {
      return num;
    }
  }

  // Try to parse as boolean
  if (value.toLowerCase() === 'true') {
    return true;
  }
  if (value.toLowerCase() === 'false') {
    return false;
  }

  // Try to parse as JSON
  try {
    return JSON.parse(value);
  } catch {
    // If all parsing fails, return as string
    return value;
  }
}
