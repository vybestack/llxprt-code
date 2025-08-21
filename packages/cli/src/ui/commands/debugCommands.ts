/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20250120-DEBUGLOGGING.P11
 * @requirement REQ-004
 */

import {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
  CommandKind,
} from './types.js';
import { ConfigurationManager } from '@vybestack/llxprt-code-core';

/**
 * Handle /debug enable command
 */
function handleDebugEnable(
  _context: CommandContext,
  args: string,
): MessageActionReturn {
  const configManager = ConfigurationManager.getInstance();
  const namespace = args.trim() || 'llxprt:*';

  // Validate namespace pattern
  if (!isValidNamespace(namespace)) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Invalid namespace pattern: ${namespace}\nNamespaces should use colons as separators (e.g., llxprt:*:provider)`,
    };
  }

  try {
    const currentConfig = configManager.getEffectiveConfig();
    const namespaces = Array.isArray(currentConfig.namespaces)
      ? [...currentConfig.namespaces]
      : [];

    if (!namespaces.includes(namespace)) {
      namespaces.push(namespace);
    } else {
      return {
        type: 'message',
        messageType: 'info',
        content: `Debug logging already enabled for namespace: ${namespace}`,
      };
    }

    configManager.setEphemeralConfig({
      enabled: true,
      namespaces,
    });

    return {
      type: 'message',
      messageType: 'info',
      content: `✓ Debug logging enabled for namespace: ${namespace}`,
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to enable debug logging: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Handle /debug disable command
 */
function handleDebugDisable(
  _context: CommandContext,
  args: string,
): MessageActionReturn {
  const configManager = ConfigurationManager.getInstance();
  const namespace = args.trim();

  try {
    const currentConfig = configManager.getEffectiveConfig();

    if (!currentConfig.enabled) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'Debug logging is already disabled',
      };
    }

    if (!namespace) {
      // Disable all debug logging
      configManager.setEphemeralConfig({
        enabled: false,
      });
      return {
        type: 'message',
        messageType: 'info',
        content: '✓ Debug logging disabled for all namespaces',
      };
    }

    // Validate namespace pattern
    if (!isValidNamespace(namespace)) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Invalid namespace pattern: ${namespace}`,
      };
    }

    const namespaces = Array.isArray(currentConfig.namespaces)
      ? currentConfig.namespaces.filter((ns) => ns !== namespace)
      : [];

    if (
      !Array.isArray(currentConfig.namespaces) ||
      !currentConfig.namespaces.includes(namespace)
    ) {
      return {
        type: 'message',
        messageType: 'info',
        content: `Namespace ${namespace} was not enabled`,
      };
    }

    configManager.setEphemeralConfig({
      namespaces,
      enabled: namespaces.length > 0,
    });

    return {
      type: 'message',
      messageType: 'info',
      content: `✓ Debug logging disabled for namespace: ${namespace}`,
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to disable debug logging: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Handle /debug level command
 */
function handleDebugLevel(
  _context: CommandContext,
  args: string,
): MessageActionReturn {
  const configManager = ConfigurationManager.getInstance();
  const level = args.trim().toLowerCase();

  const validLevels = ['verbose', 'debug', 'info', 'error'];

  if (!level) {
    const currentLevel = configManager.getEffectiveConfig().level;
    return {
      type: 'message',
      messageType: 'info',
      content: `Current debug level: **${currentLevel}**\n\nValid levels:\n  • verbose - All debug output including detailed traces\n  • debug - Debug messages and above\n  • info - Informational messages and above\n  • error - Only error messages`,
    };
  }

  if (!validLevels.includes(level)) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Invalid debug level: ${level}\n\nValid levels: ${validLevels.join(', ')}\n\nExample: /debug level verbose`,
    };
  }

  try {
    const currentLevel = configManager.getEffectiveConfig().level;
    if (currentLevel === level) {
      return {
        type: 'message',
        messageType: 'info',
        content: `Debug level is already set to: ${level}`,
      };
    }

    configManager.setEphemeralConfig({
      level,
    });

    return {
      type: 'message',
      messageType: 'info',
      content: `✓ Debug level changed from ${currentLevel} to ${level}`,
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to set debug level: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Handle /debug output command
 */
function handleDebugOutput(
  _context: CommandContext,
  args: string,
): MessageActionReturn {
  const configManager = ConfigurationManager.getInstance();
  const target = args.trim().toLowerCase();

  const validTargets = ['file', 'console', 'stderr', 'both'];

  if (!target) {
    const currentTarget = configManager.getOutputTarget();
    return {
      type: 'message',
      messageType: 'info',
      content: `Current debug output: ${currentTarget}\nValid targets: ${validTargets.join(', ')}`,
    };
  }

  if (!validTargets.includes(target)) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Invalid output target: ${target}\nValid targets: ${validTargets.join(', ')}`,
    };
  }

  try {
    let outputConfig: string;

    if (target === 'both') {
      outputConfig = 'file,stderr';
    } else if (target === 'console') {
      outputConfig = 'stderr';
    } else {
      outputConfig = target;
    }

    configManager.setEphemeralConfig({
      output: outputConfig,
    });

    return {
      type: 'message',
      messageType: 'info',
      content: `Debug output set to: ${target}`,
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to set debug output: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Handle /debug persist command
 */
function handleDebugPersist(
  _context: CommandContext,
  _args: string,
): MessageActionReturn {
  const configManager = ConfigurationManager.getInstance();

  try {
    const config = configManager.getEffectiveConfig();
    const hasEphemeralChanges =
      (configManager as unknown as { ephemeralConfig: unknown })
        .ephemeralConfig !== null;

    if (!hasEphemeralChanges) {
      return {
        type: 'message',
        messageType: 'info',
        content:
          'No ephemeral settings to persist. Use /debug enable, /debug level, or /debug output first.',
      };
    }

    configManager.persistEphemeralConfig();

    return {
      type: 'message',
      messageType: 'info',
      content: `✓ Debug settings saved to user configuration:\n  • Enabled: ${config.enabled}\n  • Level: ${config.level}\n  • Namespaces: ${Array.isArray(config.namespaces) ? config.namespaces.join(', ') : 'none'}`,
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to persist debug settings: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Handle /debug status command
 */
function handleDebugStatus(
  _context: CommandContext,
  _args: string,
): MessageActionReturn {
  const configManager = ConfigurationManager.getInstance();

  try {
    const config = configManager.getEffectiveConfig();
    const outputTarget = configManager.getOutputTarget();

    const namespaces = Array.isArray(config.namespaces)
      ? config.namespaces
      : [];

    const status = [
      `Debug Status:`,
      `  Enabled: ${config.enabled}`,
      `  Level: ${config.level}`,
      `  Output: ${outputTarget}`,
      `  Namespaces: ${namespaces.length > 0 ? namespaces.join(', ') : 'none'}`,
      `  Lazy Evaluation: ${config.lazyEvaluation}`,
      `  Redact Patterns: ${config.redactPatterns.join(', ')}`,
    ].join('\n');

    return {
      type: 'message',
      messageType: 'info',
      content: status,
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to get debug status: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Main debug command handler
 */
export function handleDebugCommand(args: string[]): MessageActionReturn {
  if (args.length === 0) {
    return {
      type: 'message',
      messageType: 'info',
      content:
        '## Debug Commands\n\n' +
        '• `/debug enable [namespace]` - Enable debug logging (default: llxprt:*)\n' +
        '• `/debug disable [namespace]` - Disable debug logging\n' +
        '• `/debug level [level]` - Set log level (verbose, debug, info, error)\n' +
        '• `/debug output [target]` - Set output (file, stderr, both)\n' +
        '• `/debug persist` - Save current settings permanently\n' +
        '• `/debug status` - Show current configuration\n\n' +
        '### Examples\n' +
        '```\n' +
        '/debug enable llxprt:openai:*\n' +
        '/debug level verbose\n' +
        '/debug persist\n' +
        '```',
    };
  }

  const subcommand = args[0]?.toLowerCase();
  const validSubcommands = [
    'enable',
    'disable',
    'level',
    'output',
    'persist',
    'status',
  ];

  if (!validSubcommands.includes(subcommand)) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Unknown debug subcommand: ${subcommand}\n\nValid subcommands: ${validSubcommands.join(', ')}\n\nUse /debug for help.`,
    };
  }

  return {
    type: 'message',
    messageType: 'error',
    content: 'This subcommand should be handled by the subcommand system.',
  };
}

/**
 * Validate namespace pattern
 */
function isValidNamespace(namespace: string): boolean {
  // Allow alphanumeric, colons, hyphens, underscores, and wildcards
  const validPattern = /^[a-zA-Z0-9:_\-*]+$/;
  if (!validPattern.test(namespace)) {
    return false;
  }

  // Check for common mistakes
  if (namespace.includes('**') || namespace.includes('::')) {
    return false;
  }

  return true;
}

/**
 * Register debug commands in the CLI command system
 */
export function registerDebugCommands(): SlashCommand[] {
  return [debugCommand];
}

/**
 * Debug command with all subcommands
 */
export const debugCommand: SlashCommand = {
  name: 'debug',
  description: 'debug logging controls',
  kind: CommandKind.BUILT_IN,
  subCommands: [
    {
      name: 'enable',
      description: 'enable debug logging',
      kind: CommandKind.BUILT_IN,
      action: (context: CommandContext, args: string): MessageActionReturn =>
        handleDebugEnable(context, args),
    },
    {
      name: 'disable',
      description: 'disable debug logging',
      kind: CommandKind.BUILT_IN,
      action: (context: CommandContext, args: string): MessageActionReturn =>
        handleDebugDisable(context, args),
    },
    {
      name: 'level',
      description: 'set debug logging level',
      kind: CommandKind.BUILT_IN,
      action: (context: CommandContext, args: string): MessageActionReturn =>
        handleDebugLevel(context, args),
    },
    {
      name: 'output',
      description: 'set debug output destination',
      kind: CommandKind.BUILT_IN,
      action: (context: CommandContext, args: string): MessageActionReturn =>
        handleDebugOutput(context, args),
    },
    {
      name: 'persist',
      description: 'toggle debug persistence',
      kind: CommandKind.BUILT_IN,
      action: (context: CommandContext, args: string): MessageActionReturn =>
        handleDebugPersist(context, args),
    },
    {
      name: 'status',
      description: 'show debug logging status',
      kind: CommandKind.BUILT_IN,
      action: (context: CommandContext, args: string): MessageActionReturn =>
        handleDebugStatus(context, args),
    },
  ],
};
