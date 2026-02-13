/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-SECURESTORE.P13, PLAN-20260211-SECURESTORE.P15
 * @requirement R12, R13, R14, R15, R16, R17, R18, R19
 */

import {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
  SlashCommandActionReturn,
  CommandKind,
} from './types.js';
import type { CommandArgumentSchema, CompleterFn } from './schema/types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import {
  getProviderKeyStorage,
  maskKeyForDisplay,
  SecureStoreError,
} from '@vybestack/llxprt-code-core';

/**
 * @plan PLAN-20260211-SECURESTORE.P13
 * @requirement R12.1
 */
const SUBCOMMANDS = ['save', 'load', 'show', 'list', 'delete'] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

// ─── Error Formatting (R18.1) ────────────────────────────────────────────────

/**
 * @plan PLAN-20260211-SECURESTORE.P15
 * @pseudocode lines 221-234
 * @requirement R18.1
 */
function formatStorageError(error: unknown): string {
  if (error instanceof SecureStoreError) {
    if (error.code === 'UNAVAILABLE') {
      return "Cannot access keyring. Keys cannot be saved. Use '/key <raw-key>' for ephemeral session key.";
    }
    return `${error.message} — ${error.remediation}`;
  }
  if (error instanceof Error && error.message.includes('is invalid')) {
    return error.message;
  }
  return `Key operation failed: ${error instanceof Error ? error.message : String(error)}`;
}

// ─── /key save (R13) ────────────────────────────────────────────────────────

/**
 * @plan PLAN-20260211-SECURESTORE.P15
 * @pseudocode lines 31-84
 * @requirement R13.1, R13.2, R13.3, R13.4, R13.5
 */
async function handleSave(
  tokens: string[],
  context: CommandContext,
): Promise<MessageActionReturn | SlashCommandActionReturn> {
  // Missing name and key (R13.5)
  if (tokens.length === 0) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Usage: /key save <name> <api-key>',
    };
  }

  const name = tokens[0];

  // Missing API key (R13.4)
  const apiKey = tokens.slice(1).join(' ');
  if (apiKey.trim().length === 0) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'API key value cannot be empty.',
    };
  }

  const storage = getProviderKeyStorage();

  // Check for existing key — prompt overwrite (R13.2, R13.3)
  try {
    const exists = await storage.hasKey(name);
    if (exists) {
      const config = context.services.config;
      const isInteractive =
        config && 'isInteractive' in config
          ? (config as { isInteractive: () => boolean }).isInteractive()
          : true;

      if (!isInteractive) {
        // Non-interactive: fail (R13.3)
        return {
          type: 'message',
          messageType: 'error',
          content: `Key '${name}' already exists. Overwriting requires interactive confirmation.`,
        };
      }

      // Interactive: prompt confirmation via confirm_action (R13.2)
      if (!context.overwriteConfirmed) {
        return {
          type: 'confirm_action',
          prompt: `Key '${name}' already exists. Overwrite?`,
          originalInvocation: {
            raw: context.invocation?.raw || `/key save ${name} ***`,
          },
        };
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[key save] Could not check if key '${name}' exists: ${msg}`);
  }

  // Save the key (R13.1)
  try {
    await storage.saveKey(name, apiKey);
    return {
      type: 'message',
      messageType: 'info',
      content: `Saved key '${name}' to OS keyring. Use /key load ${name} to activate it for this session.`,
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: formatStorageError(error),
    };
  }
}

// ─── /key load (R14) ────────────────────────────────────────────────────────

/**
 * @plan PLAN-20260211-SECURESTORE.P15
 * @pseudocode lines 85-111
 * @requirement R14.1, R14.2, R14.3
 */
async function handleLoad(
  tokens: string[],
  context: CommandContext,
): Promise<MessageActionReturn> {
  // Missing name (R14.3)
  if (tokens.length === 0) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Usage: /key load <name>',
    };
  }

  const name = tokens[0];
  const storage = getProviderKeyStorage();

  try {
    const key = await storage.getKey(name);

    // Key not found (R14.2)
    if (key === null) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Key '${name}' not found. Use '/key list' to see saved keys.`,
      };
    }

    // Set as active session key (R14.1)
    const runtime = getRuntimeApi();
    await runtime.updateActiveProviderApiKey(key);

    // Set auth-key-name so profile saves capture the name reference,
    // not the raw key value. Clear auth-key/auth-keyfile to prevent
    // buildRuntimeProfileSnapshot from persisting the resolved secret.
    const config = context.services.config;
    if (config) {
      config.setEphemeralSetting('auth-key-name', name);
      config.setEphemeralSetting('auth-key', undefined);
      config.setEphemeralSetting('auth-keyfile', undefined);
    }

    const extendedContext = context as CommandContext & {
      checkPaymentModeChange?: () => void;
    };
    if (extendedContext.checkPaymentModeChange) {
      setTimeout(extendedContext.checkPaymentModeChange, 100);
    }

    return {
      type: 'message',
      messageType: 'info',
      content: `Loaded key '${name}' — active for this session`,
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: formatStorageError(error),
    };
  }
}

// ─── /key show (R15) ────────────────────────────────────────────────────────

/**
 * @plan PLAN-20260211-SECURESTORE.P15
 * @pseudocode lines 112-137
 * @requirement R15.1, R15.2
 */
async function handleShow(tokens: string[]): Promise<MessageActionReturn> {
  if (tokens.length === 0) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Usage: /key show <name>',
    };
  }

  const name = tokens[0];
  const storage = getProviderKeyStorage();

  try {
    const key = await storage.getKey(name);

    // Key not found (R15.2)
    if (key === null) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Key '${name}' not found. Use '/key list' to see saved keys.`,
      };
    }

    // Display masked preview (R15.1)
    const masked = maskKeyForDisplay(key);
    return {
      type: 'message',
      messageType: 'info',
      content: `${name}: ${masked} (${key.length} chars)`,
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: formatStorageError(error),
    };
  }
}

// ─── /key list (R16) ────────────────────────────────────────────────────────

/**
 * @plan PLAN-20260211-SECURESTORE.P15
 * @pseudocode lines 138-164
 * @requirement R16.1, R16.2
 */
async function handleList(): Promise<MessageActionReturn> {
  const storage = getProviderKeyStorage();

  try {
    const names = await storage.listKeys();

    // No keys stored (R16.2)
    if (names.length === 0) {
      return {
        type: 'message',
        messageType: 'info',
        content:
          "No saved keys. Use '/key save <name> <api-key>' to store one.",
      };
    }

    // Display each key with masked value, sorted alphabetically (R16.1)
    const sorted = [...names].sort();
    const lines: string[] = ['Saved keys:'];
    for (const name of sorted) {
      const key = await storage.getKey(name);
      if (key !== null) {
        const masked = maskKeyForDisplay(key);
        lines.push(`  ${name}  ${masked}`);
      } else {
        lines.push(`  ${name}  (unable to retrieve)`);
      }
    }

    return {
      type: 'message',
      messageType: 'info',
      content: lines.join('\n'),
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: formatStorageError(error),
    };
  }
}

// ─── /key delete (R17) ──────────────────────────────────────────────────────

/**
 * @plan PLAN-20260211-SECURESTORE.P15
 * @pseudocode lines 165-203
 * @requirement R17.1, R17.2, R17.3, R17.4
 */
async function handleDelete(
  tokens: string[],
  context: CommandContext,
): Promise<MessageActionReturn | SlashCommandActionReturn> {
  // Missing name (R17.4)
  if (tokens.length === 0) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Usage: /key delete <name>',
    };
  }

  const name = tokens[0];

  // Non-interactive check (R17.2)
  const config = context.services.config;
  const isInteractive =
    config && 'isInteractive' in config
      ? (config as { isInteractive: () => boolean }).isInteractive()
      : true;

  if (!isInteractive) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Deleting keys requires interactive confirmation.',
    };
  }

  const storage = getProviderKeyStorage();

  try {
    // Check if key exists (R17.3)
    const exists = await storage.hasKey(name);
    if (!exists) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Key '${name}' not found. Use '/key list' to see saved keys.`,
      };
    }

    // Prompt for confirmation (R17.1)
    if (!context.overwriteConfirmed) {
      return {
        type: 'confirm_action',
        prompt: `Delete key '${name}'?`,
        originalInvocation: {
          raw: context.invocation?.raw || `/key delete ${name}`,
        },
      };
    }

    // Delete (R17.1)
    await storage.deleteKey(name);
    return {
      type: 'message',
      messageType: 'info',
      content: `Deleted key '${name}'`,
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: formatStorageError(error),
    };
  }
}

// ─── Autocomplete Schema (R19) ──────────────────────────────────────────────

/**
 * @plan PLAN-20260211-SECURESTORE.P15
 * @pseudocode lines 235-259
 * @requirement R19.1, R19.2, R19.3
 *
 * Schema-based completion for /key subcommands. The framework's
 * useSlashCompletion hook uses schema (not the completion property)
 * to provide argument-level autocomplete suggestions.
 */
const keyNameCompleter: CompleterFn = async (_ctx, partial) => {
  try {
    const names = await getProviderKeyStorage().listKeys();
    return names
      .filter((name) => name.startsWith(partial))
      .map((name) => ({ value: name }));
  } catch {
    // Keyring unavailable during autocomplete (R19.3)
    return [];
  }
};

const keyNameArg: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'name',
    description: 'Saved key name',
    completer: keyNameCompleter,
  },
];

const keySchema: CommandArgumentSchema = [
  {
    kind: 'literal',
    value: 'save',
    description: 'Save an API key to the keyring',
    next: [
      {
        kind: 'value',
        name: 'name',
        description: 'Name for the key',
        completer: keyNameCompleter,
        next: [
          {
            kind: 'value',
            name: 'api-key',
            description: 'API key value',
            hint: 'Paste your API key',
          },
        ],
      },
    ],
  },
  {
    kind: 'literal',
    value: 'load',
    description: 'Load a saved key for this session',
    next: keyNameArg,
  },
  {
    kind: 'literal',
    value: 'show',
    description: 'Show a masked preview of a saved key',
    next: keyNameArg,
  },
  {
    kind: 'literal',
    value: 'list',
    description: 'List all saved key names',
  },
  {
    kind: 'literal',
    value: 'delete',
    description: 'Delete a saved key',
    next: keyNameArg,
  },
];

// ─── Main Command ────────────────────────────────────────────────────────────

export const keyCommand: SlashCommand = {
  name: 'key',
  description: 'set or remove API key for the current provider',
  kind: CommandKind.BUILT_IN,
  schema: keySchema,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn | SlashCommandActionReturn> => {
    // @plan PLAN-20260211-SECURESTORE.P15
    // @pseudocode lines 2-30
    // @requirement R12.6 — trim whitespace
    const trimmedArgs = args?.trim() ?? '';

    // @requirement R12.4 — no args: show status (legacy behavior)
    if (trimmedArgs.length === 0) {
      return handleLegacyKeyAction(null, context);
    }

    // @requirement R12.1 — split by whitespace
    const tokens = trimmedArgs.split(/\s+/);
    const firstToken = tokens[0];

    // @requirement R12.5 — case-sensitive match
    if (SUBCOMMANDS.includes(firstToken as Subcommand)) {
      const subcommand = firstToken as Subcommand;
      switch (subcommand) {
        case 'save':
          return handleSave(tokens.slice(1), context);
        case 'load':
          return handleLoad(tokens.slice(1), context);
        case 'show':
          return handleShow(tokens.slice(1));
        case 'list':
          return handleList();
        case 'delete':
          return handleDelete(tokens.slice(1), context);
        default:
          break;
      }
    }

    // @requirement R12.3 — no match: legacy behavior
    return handleLegacyKeyAction(trimmedArgs, context);
  },
};

// ─── Legacy Behavior (preserved from original) ─────────────────────────────

/**
 * Original /key behavior: set or remove API key for the current provider.
 * @pseudocode lines 204-220
 * @requirement R12.3, R12.4
 */
async function handleLegacyKeyAction(
  apiKey: string | null,
  context: CommandContext,
): Promise<MessageActionReturn> {
  const runtime = getRuntimeApi();
  try {
    const targetKey =
      !apiKey || apiKey.toLowerCase() === 'none' ? null : apiKey;
    const result = await runtime.updateActiveProviderApiKey(targetKey);

    const extendedContext = context as CommandContext & {
      checkPaymentModeChange?: () => void;
    };
    if (extendedContext.checkPaymentModeChange) {
      setTimeout(extendedContext.checkPaymentModeChange, 100);
    }

    return {
      type: 'message',
      messageType: 'info',
      content: result.message,
    };
  } catch (error) {
    const status = runtime.getActiveProviderStatus();
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to update API key for provider '${status.providerName ?? 'unknown'}': ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
