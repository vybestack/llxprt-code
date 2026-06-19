/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import { coreEvents } from '@vybestack/llxprt-code-core';
import {
  ephemeralSettingHelp,
  parseEphemeralSettingValue,
} from '@vybestack/llxprt-code-providers/runtime/ephemeralSettings.js';
import { resolveAlias } from '@vybestack/llxprt-code-settings';
import { buildSetSchema } from './setCommandSchema.js';

// Subcommand for /set unset - removes ephemeral settings or model parameters

/**
 * Implementation for the /set command that handles both:
 * - /set modelparam <key> <value>
 * - /set <ephemeral-key> <value>
 */

const setSchema = buildSetSchema();

function formatParsedValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

function handleSetModelParam(parts: string[]): MessageActionReturn {
  if (parts.length < 3) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        'Usage: /set modelparam <key> <value>\nExample: /set modelparam temperature 0.7',
    };
  }

  const runtime = getRuntimeApi();
  const paramName = parts[1];
  const rawValue = parts.slice(2).join(' ');
  const parsedParamValue = parseValue(rawValue);

  try {
    runtime.setActiveModelParam(paramName, parsedParamValue);
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to set model parameter: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const formattedValue = formatParsedValue(parsedParamValue);

  return {
    type: 'message',
    messageType: 'info',
    content: `Model parameter '${paramName}' set to ${formattedValue}`,
  };
}

function handleUnsetModelParam(subKey: string): MessageActionReturn {
  if (!subKey) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        'Usage: /set unset modelparam <key>\nExample: /set unset modelparam temperature',
    };
  }

  const runtime = getRuntimeApi();
  try {
    runtime.clearActiveModelParam(subKey);
    runtime.setEphemeralSetting(subKey, undefined);
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to clear model parameter: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return {
    type: 'message',
    messageType: 'info',
    content: `Model parameter '${subKey}' cleared`,
  };
}

function handleUnsetCustomHeader(
  targetKey: string,
  subKey: string,
): MessageActionReturn {
  const runtime = getRuntimeApi();
  const currentHeaders = runtime.getEphemeralSettings()['custom-headers'] as
    | Record<string, unknown>
    | undefined;
  if (currentHeaders && subKey in currentHeaders) {
    const nextHeaders = { ...currentHeaders };
    delete nextHeaders[subKey];
    runtime.setEphemeralSetting(
      targetKey,
      Object.keys(nextHeaders).length > 0 ? nextHeaders : undefined,
    );
    return {
      type: 'message',
      messageType: 'info',
      content: `Custom header '${subKey}' cleared`,
    };
  }
  return {
    type: 'message',
    messageType: 'info',
    content: `No custom header named '${subKey}' found`,
  };
}

function handleSetUnset(parts: string[]): MessageActionReturn {
  if (parts.length < 2) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        'Usage: /set unset <ephemeral-key|modelparam> [subkey]\nExample: /set unset base-url',
    };
  }

  const runtime = getRuntimeApi();
  const targetKey = parts[1];
  const subKey = parts[2];

  if (targetKey === 'modelparam') {
    return handleUnsetModelParam(subKey);
  }

  const resolvedTargetKey = resolveAlias(targetKey);
  const validEphemeralKeys = Object.keys(ephemeralSettingHelp);
  if (!validEphemeralKeys.includes(resolvedTargetKey)) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Invalid setting key: ${targetKey}. Valid keys are: ${validEphemeralKeys.join(', ')}`,
    };
  }

  if (resolvedTargetKey === 'custom-headers' && subKey) {
    return handleUnsetCustomHeader(targetKey, subKey);
  }

  runtime.setEphemeralSetting(targetKey, undefined);
  return {
    type: 'message',
    messageType: 'info',
    content: `Ephemeral setting '${targetKey}' cleared`,
  };
}

function handleSetEphemeral(
  context: CommandContext,
  key: string,
  parts: string[],
): MessageActionReturn {
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

  const runtime = getRuntimeApi();
  const value = parts.slice(1).join(' ');

  const parseResult = parseEphemeralSettingValue(key, value);
  if (!parseResult.success) {
    return {
      type: 'message',
      messageType: 'error',
      content: parseResult.message,
    };
  }
  const parsedValue = parseResult.value;

  const config = context.services.config;
  if (!config) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'No configuration available',
    };
  }

  // Store compression settings as ephemeral settings
  // They will be read by chatSession.ts when compression is needed
  if (key === 'context-limit' || key === 'compression-threshold') {
    // Settings are stored via setEphemeralSetting below
    // chatSession.ts will read them directly when needed
  }

  // Store emojifilter in ephemeral settings like everything else
  // No special handling needed - it will be stored below with other settings

  // Store ephemeral settings in memory only
  // They will be saved only when user explicitly saves a profile
  // Note: SettingsService doesn't currently support ephemeral settings,
  // so we continue to use the config directly for these session-only settings
  runtime.setEphemeralSetting(key, parsedValue);
  coreEvents.emitSettingsChanged();

  return {
    type: 'message',
    messageType: 'info',
    content: `Ephemeral setting '${key}' set to ${JSON.stringify(parsedValue)} (session only, use /profile save to persist)`,
  };
}

export const setCommand: SlashCommand = {
  name: 'set',
  description: 'set model parameters or ephemeral settings',
  kind: CommandKind.BUILT_IN,
  schema: setSchema,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    const trimmedArgs = args.trim();
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

    if (key === 'modelparam') {
      return handleSetModelParam(parts);
    }

    if (key === 'unset') {
      return handleSetUnset(parts);
    }

    return handleSetEphemeral(context, key, parts);
  },
};

// Stryker disable all -- Parsing is covered by higher-level integration tests and mutating this
// helper introduces hundreds of equivalent mutants unrelated to autocomplete behaviour.
/**
 * Parse a string value into the appropriate type.
 * Handles numbers, booleans, and JSON objects/arrays.
 */
export function parseValue(value: string): unknown {
  // Try to parse as number
  if (looksNumeric(value)) {
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

function looksNumeric(value: string): boolean {
  let i = 0;
  if (value[0] === '-') {
    i = 1;
  }
  const digitsStart = i;
  while (i < value.length && value[i] >= '0' && value[i] <= '9') {
    i++;
  }
  const hasIntegerDigits = i > digitsStart;

  if (i < value.length && value[i] === '.') {
    i++;
    const fractionStart = i;
    while (i < value.length && value[i] >= '0' && value[i] <= '9') {
      i++;
    }
    const hasFractionDigits = i > fractionStart;
    // Dot must be followed by at least one digit
    return hasIntegerDigits && hasFractionDigits && i === value.length;
  }

  return hasIntegerDigits && i === value.length;
}
// Stryker restore all
