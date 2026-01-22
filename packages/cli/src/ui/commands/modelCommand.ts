/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SlashCommand,
  CommandContext,
  OpenDialogActionReturn,
  MessageActionReturn,
  CommandKind,
  ModelsDialogData,
} from './types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';

/**
 * Parse command arguments for /model command
 */
interface ModelCommandArgs {
  search?: string;
  provider?: string;
  tools?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  audio?: boolean;
  all?: boolean;
}

function parseArgs(args: string): ModelCommandArgs {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const result: ModelCommandArgs = {};

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '--provider' || part === '-p') {
      // Check bounds and ensure next arg isn't another flag
      if (i + 1 < parts.length && !parts[i + 1].startsWith('-')) {
        result.provider = parts[++i];
      }
      // If no valid value, provider remains undefined
    } else if (part === '--reasoning' || part === '-r') {
      result.reasoning = true;
    } else if (part === '--tools' || part === '-t') {
      result.tools = true;
    } else if (part === '--vision') {
      result.vision = true;
    } else if (part === '--audio' || part === '-a') {
      result.audio = true;
    } else if (part === '--all') {
      result.all = true;
    } else if (!part.startsWith('-')) {
      // Positional arg is search term (or direct model name)
      result.search = part;
    }
    // Ignore --limit, --verbose, -v, -l (removed per spec)
  }

  return result;
}

/**
 * Check if any filter flags are set
 */
function hasAnyFlags(args: ModelCommandArgs): boolean {
  return !!(
    args.provider ||
    args.tools ||
    args.vision ||
    args.reasoning ||
    args.audio ||
    args.all
  );
}

/**
 * Convert parsed args to dialog props
 */
function argsToDialogData(args: ModelCommandArgs): ModelsDialogData {
  return {
    initialSearch: args.search,
    initialFilters: {
      tools: args.tools ?? false,
      vision: args.vision ?? false,
      reasoning: args.reasoning ?? false,
      audio: args.audio ?? false,
    },
    includeDeprecated: false,
    // --provider X sets the provider filter
    providerOverride: args.provider ?? undefined,
    // --all shows all providers (ignores current provider)
    showAllProviders: args.all ?? false,
  };
}

export const modelCommand: SlashCommand = {
  name: 'model',
  description: 'browse, search, or switch models',
  kind: CommandKind.BUILT_IN,
  action: async (
    _context: CommandContext,
    args: string,
  ): Promise<OpenDialogActionReturn | MessageActionReturn> => {
    const parsedArgs = parseArgs(args);

    // Direct switch: positional arg with NO flags
    // e.g., "/model gpt-4o" switches directly
    // but "/model gpt-4o --tools" opens dialog with search + filter
    if (parsedArgs.search && !hasAnyFlags(parsedArgs)) {
      try {
        const runtime = getRuntimeApi();
        const result = await runtime.setActiveModel(parsedArgs.search);
        return {
          type: 'message',
          messageType: 'info',
          content: `Switched from ${result.previousModel ?? 'unknown'} to ${result.nextModel} in provider '${result.providerName}'`,
        };
      } catch (error) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Failed to switch model: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    // Open dialog with filters
    const dialogData = argsToDialogData(parsedArgs);
    return {
      type: 'dialog',
      dialog: 'models',
      dialogData,
    };
  },
};
