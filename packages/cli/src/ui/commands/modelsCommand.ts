/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SlashCommand,
  CommandContext,
  OpenDialogActionReturn,
  CommandKind,
  ModelsDialogData,
} from './types.js';

/**
 * Parse command arguments for /models command
 */
interface ModelsCommandArgs {
  search?: string;
  provider?: string;
  tools?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  audio?: boolean;
  all?: boolean;
}

function parseArgs(args: string): ModelsCommandArgs {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const result: ModelsCommandArgs = {};

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '--provider' || part === '-p') {
      result.provider = parts[++i];
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
      // Positional arg is search term
      result.search = part;
    }
    // Ignore --limit, --verbose, -v, -l (removed per spec)
  }

  return result;
}

/**
 * Convert parsed args to dialog props
 */
function argsToDialogData(args: ModelsCommandArgs): ModelsDialogData {
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

export const modelsCommand: SlashCommand = {
  name: 'models',
  description: 'browse and search models from registry',
  kind: CommandKind.BUILT_IN,
  action: (_context: CommandContext, args: string): OpenDialogActionReturn => {
    // Parse arguments
    const parsedArgs = parseArgs(args);

    // Convert to dialog data
    const dialogData = argsToDialogData(parsedArgs);

    // Return dialog action
    return {
      type: 'dialog',
      dialog: 'models',
      dialogData,
    };
  },
};
