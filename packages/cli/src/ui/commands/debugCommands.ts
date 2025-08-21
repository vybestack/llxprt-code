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
  const namespace = args.trim() || '*';

  try {
    const currentConfig = configManager.getEffectiveConfig();
    const namespaces = Array.isArray(currentConfig.namespaces)
      ? [...currentConfig.namespaces]
      : [];

    if (!namespaces.includes(namespace)) {
      namespaces.push(namespace);
    }

    configManager.setEphemeralConfig({
      enabled: true,
      namespaces,
    });

    return {
      type: 'message',
      messageType: 'info',
      content: `Debug logging enabled for namespace: ${namespace}`,
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
    if (!namespace) {
      // Disable all debug logging
      configManager.setEphemeralConfig({
        enabled: false,
      });
      return {
        type: 'message',
        messageType: 'info',
        content: 'Debug logging disabled for all namespaces',
      };
    }

    const currentConfig = configManager.getEffectiveConfig();
    const namespaces = Array.isArray(currentConfig.namespaces)
      ? currentConfig.namespaces.filter((ns) => ns !== namespace)
      : [];

    configManager.setEphemeralConfig({
      namespaces,
      enabled: namespaces.length > 0,
    });

    return {
      type: 'message',
      messageType: 'info',
      content: `Debug logging disabled for namespace: ${namespace}`,
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

  const validLevels = ['debug', 'info', 'warn', 'error'];

  if (!level) {
    const currentLevel = configManager.getEffectiveConfig().level;
    return {
      type: 'message',
      messageType: 'info',
      content: `Current debug level: ${currentLevel}\nValid levels: ${validLevels.join(', ')}`,
    };
  }

  if (!validLevels.includes(level)) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Invalid debug level: ${level}\nValid levels: ${validLevels.join(', ')}`,
    };
  }

  try {
    configManager.setEphemeralConfig({
      level,
    });

    return {
      type: 'message',
      messageType: 'info',
      content: `Debug level set to: ${level}`,
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
    configManager.persistEphemeralConfig();

    return {
      type: 'message',
      messageType: 'info',
      content: 'Ephemeral debug settings saved to user configuration',
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
        'Debug commands available:\n  /debug enable [namespace] - Enable debug logging\n  /debug disable [namespace] - Disable debug logging\n  /debug level [level] - Set debug log level\n  /debug output [target] - Set output target\n  /debug persist - Save settings to user config\n  /debug status - Show current configuration',
    };
  }

  return {
    type: 'message',
    messageType: 'error',
    content: 'Invalid debug command. Use /debug without arguments for help.',
  };
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
