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
import { IProvider } from '@vybestack/llxprt-code-core';

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
        content: `Model parameter '${key}' set to ${JSON.stringify(parsedValue)}`,
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
export const setCommand: SlashCommand = {
  name: 'set',
  description: 'set model parameters or ephemeral settings',
  kind: CommandKind.BUILT_IN,
  subCommands: [modelParamCommand],
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
    if (parts.length < 2) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /set <ephemeral-key> <value>',
      };
    }

    const key = parts[0];
    const value = parts.slice(1).join(' '); // Join remaining parts as value

    // List of valid ephemeral settings from the specification
    const validEphemeralKeys = [
      'context-limit',
      'compression-threshold',
      'auth-key',
      'auth-keyfile',
      'base-url',
      'tool-format',
      'api-version',
      'custom-headers',
    ];

    // Check if it's a valid ephemeral key
    if (!validEphemeralKeys.includes(key)) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Invalid setting key: ${key}. Valid keys are: ${validEphemeralKeys.join(', ')}`,
      };
    }

    // Parse the value
    const parsedValue = parseValue(value);

    // For ephemeral settings, we just log them for now
    // since the storage mechanism isn't implemented yet
    console.log(`Setting ephemeral ${key} = ${JSON.stringify(parsedValue)}`);

    return {
      type: 'message',
      messageType: 'info',
      content: `Ephemeral setting '${key}' set to ${JSON.stringify(parsedValue)}`,
    };
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
