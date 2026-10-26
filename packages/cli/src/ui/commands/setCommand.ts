/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommand, MessageActionReturn } from './types.js';
import { CommandKind } from './types.js';
import { coreEvents } from '@vybestack/llxprt-code-core';
import {
  ephemeralSettingHelp,
  parseEphemeralSettingValue,
} from '@vybestack/llxprt-code-settings/settings/ephemeral-settings.js';
import {
  isStrictNumericString,
  legacySettingCanonicalKey,
  validateSetting,
} from '@vybestack/llxprt-code-settings';
import { buildSetSchema } from './setCommandSchema.js';

// Subcommand for /set unset - removes ephemeral settings or model parameters

/**
 * Implementation for the /set command that handles both:
 * - /set modelparam <key> <value>
 * - /set <ephemeral-key> <value>
 */

export interface SetCommandOperations {
  getEphemeralSettings: () => Readonly<Record<string, unknown>>;
  setEphemeralSetting: (key: string, value: unknown) => void;
  getActiveModelParams: () => Readonly<Record<string, unknown>>;
  setActiveModelParam: (key: string, value: unknown) => void;
  clearActiveModelParam: (key: string) => void;
  isFuzzyFilteringEnabled: () => boolean;
}

/**
 * Legacy key spellings are migrated once at settings load; /set must not
 * silently accept them, so reject with the canonical spelling instead.
 */
function rejectLegacySettingKey(key: string): MessageActionReturn | null {
  const canonicalKey = legacySettingCanonicalKey(key);
  if (canonicalKey === undefined) {
    return null;
  }
  return {
    type: 'message',
    messageType: 'error',
    content: `Unknown setting '${key}'. Canonical key: '${canonicalKey}'.`,
  };
}

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

function handleSetModelParam(
  operations: SetCommandOperations,
  parts: string[],
): MessageActionReturn {
  if (parts.length < 3) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        'Usage: /set modelparam <key> <value>\nExample: /set modelparam temperature 0.7',
    };
  }

  const paramName = parts[1];
  const legacyParamRejection = rejectLegacySettingKey(paramName);
  if (legacyParamRejection) {
    return legacyParamRejection;
  }
  const rawValue = parts.slice(2).join(' ');
  const parsed = parseValue(rawValue);

  // Type-check against the registry before storing. A registered param with
  // the wrong type would otherwise be persisted verbatim and put a malformed
  // field on the wire — OpenRouter answers 400 "top_p: Invalid input:
  // expected number, received string" (issue #2896). Unregistered keys are
  // still accepted so arbitrary provider-specific passthrough keeps working.
  const validation = validateSetting(paramName, parsed);
  if (!validation.success) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        validation.message ??
        `Invalid value for model parameter '${paramName}'`,
    };
  }
  const parsedParamValue = validation.value ?? parsed;

  try {
    operations.setActiveModelParam(paramName, parsedParamValue);
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

function handleUnsetModelParam(
  operations: SetCommandOperations,
  subKey: string,
): MessageActionReturn {
  if (!subKey) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        'Usage: /set unset modelparam <key>\nExample: /set unset modelparam temperature',
    };
  }

  try {
    operations.clearActiveModelParam(subKey);
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to clear model parameter: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  try {
    operations.setEphemeralSetting(subKey, undefined);
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to clear ephemeral model parameter: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return {
    type: 'message',
    messageType: 'info',
    content: `Model parameter '${subKey}' cleared`,
  };
}

function handleUnsetCustomHeader(
  operations: SetCommandOperations,
  targetKey: string,
  subKey: string,
): MessageActionReturn {
  const currentHeaders = operations.getEphemeralSettings()['custom-headers'] as
    | Record<string, unknown>
    | undefined;
  if (currentHeaders && subKey in currentHeaders) {
    const nextHeaders = { ...currentHeaders };
    delete nextHeaders[subKey];
    operations.setEphemeralSetting(
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

function handleSetUnset(
  operations: SetCommandOperations,
  parts: string[],
): MessageActionReturn {
  if (parts.length < 2) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        'Usage: /set unset <ephemeral-key|modelparam> [subkey]\nExample: /set unset base-url',
    };
  }

  const targetKey = parts[1];
  const subKey = parts[2];

  if (targetKey === 'modelparam') {
    const legacyParamRejection = rejectLegacySettingKey(subKey);
    if (legacyParamRejection) {
      return legacyParamRejection;
    }
    return handleUnsetModelParam(operations, subKey);
  }

  const legacyUnsetRejection = rejectLegacySettingKey(targetKey);
  if (legacyUnsetRejection) {
    return legacyUnsetRejection;
  }

  const validEphemeralKeys = Object.keys(ephemeralSettingHelp);
  if (!validEphemeralKeys.includes(targetKey)) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Invalid setting key: ${targetKey}. Valid keys are: ${validEphemeralKeys.join(', ')}`,
    };
  }

  if (targetKey === 'custom-headers' && subKey) {
    return handleUnsetCustomHeader(operations, targetKey, subKey);
  }

  operations.setEphemeralSetting(targetKey, undefined);
  return {
    type: 'message',
    messageType: 'info',
    content: `Ephemeral setting '${targetKey}' cleared`,
  };
}

function handleSetEphemeral(
  operations: SetCommandOperations,
  key: string,
  parts: string[],
): MessageActionReturn {
  const legacyRejection = rejectLegacySettingKey(key);
  if (legacyRejection) {
    return legacyRejection;
  }

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

  // Store compression settings as ephemeral settings
  // They will be read by chatSession.ts when compression is needed
  if (key === 'context-limit' || key === 'compression-threshold') {
    // Settings are stored via setEphemeralSetting below
    // chatSession.ts will read them directly when needed
  }

  // Store emojifilter in ephemeral settings like everything else
  // No special handling needed - it will be stored below with other settings

  // Store ephemeral settings in memory only. They are saved only when the user
  // explicitly saves a profile.
  operations.setEphemeralSetting(key, parsedValue);
  coreEvents.emitSettingsChanged();

  return {
    type: 'message',
    messageType: 'info',
    content: `Ephemeral setting '${key}' set to ${JSON.stringify(parsedValue)} (session only, use /profile save to persist)`,
  };
}

export function createSetCommand(
  operations: SetCommandOperations,
): SlashCommand {
  return {
    name: 'set',
    description: 'set model parameters or ephemeral settings',
    kind: CommandKind.BUILT_IN,
    schema: buildSetSchema(operations),
    action: async (
      _invocation: Readonly<{ signal: AbortSignal }>,
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
        return handleSetModelParam(operations, parts);
      }

      if (key === 'unset') {
        return handleSetUnset(operations, parts);
      }

      return handleSetEphemeral(operations, key, parts);
    },
  };
}

// Stryker disable all -- Parsing is covered by higher-level integration tests and mutating this
// helper introduces hundreds of equivalent mutants unrelated to autocomplete behaviour.
/**
 * Parse a string value into the appropriate type.
 * Handles numbers, booleans, and JSON objects/arrays.
 */
export function parseValue(value: string): unknown {
  // Try to parse as number. An overflow literal such as '1e400' is
  // syntactically numeric but evaluates to Infinity, which JSON-serializes to
  // null; keep it as text so it never reaches a request body, matching the
  // settings layer's ingress and egress guards (issue #2896).
  if (looksNumeric(value)) {
    const num = Number(value);
    return Number.isFinite(num) ? num : value;
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
  return isStrictNumericString(value);
}
// Stryker restore all
