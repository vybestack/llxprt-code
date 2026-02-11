/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* @jsxImportSource react */

import React from 'react';
import { Text } from 'ink';
import {
  SlashCommand,
  CommandContext,
  SlashCommandActionReturn,
  CommandKind,
} from './types.js';
import { MessageType } from '../types.js';
import { Colors } from '../colors.js';
import { DebugLogger } from '@vybestack/llxprt-code-core';

const logger = new DebugLogger('llxprt:ui:subagent');
import { withFuzzyFilter } from '../utils/fuzzyFilter.js';
import { SubagentView } from '../components/SubagentManagement/types.js';
import { generateAutoPrompt } from '../utils/autoPromptGenerator.js';

/**
 * Parse save command arguments
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P12
 * @requirement:REQ-004
 * @requirement:REQ-011
 * @pseudocode SubagentCommand.md lines 1-17
 */
function parseSaveArgs(args: string): {
  name: string;
  profile: string;
  mode: 'auto' | 'manual';
  input: string;
} | null {
  const match = args.match(
    /^(\S+)\s+(\S+)\s+(auto|manual)\s+"((?:[^"\\]|\\.)*)("|"?)/,
  );

  if (!match) {
    return null;
  }

  const [, name, profile, mode, input] = match;
  return { name, profile, mode: mode as 'auto' | 'manual', input };
}

/**
 * Handle manual mode subagent save
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P12
 * @requirement:REQ-004
 * @pseudocode SubagentCommand.md lines 61-66
 */
const handleManualMode = async (
  context: CommandContext,
  name: string,
  profile: string,
  systemPrompt: string,
  options?: { existed: boolean },
): Promise<SlashCommandActionReturn> => {
  const existed = options?.existed ?? false;
  return saveSubagent(context, name, profile, systemPrompt, existed);
};

/**
 * Shared save subagent logic
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
 * @requirement:REQ-002
 * @requirement:REQ-004
 * @requirement:REQ-014
 * @pseudocode SubagentCommand.md lines 67-93
 */
async function saveSubagent(
  context: CommandContext,
  name: string,
  profile: string,
  systemPrompt: string,
  existed: boolean,
): Promise<SlashCommandActionReturn> {
  const manager = context.services.subagentManager;
  if (!manager) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Service not available. Run system integration (Phase 15).',
    };
  }

  try {
    await manager.saveSubagent(name, profile, systemPrompt);

    const status = existed ? 'updated' : 'created';
    return {
      type: 'message',
      messageType: 'info',
      content: `Subagent '${name}' ${status} successfully with profile '${profile}'.`,
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        error instanceof Error
          ? `Failed to save subagent: ${error.message}`
          : 'Failed to save subagent due to an unknown error.',
    };
  }
}

/**
 * @plan:PLAN-20251013-AUTOCOMPLETE.P08
 * @requirement:REQ-002
 * @requirement:REQ-003
 * @requirement:REQ-004
 * @pseudocode ArgumentSchema.md lines 91-104
 * Schema definition for subagent command completion
 */
const subagentSchema = [
  {
    kind: 'value' as const,
    name: 'name',
    description: 'Enter subagent name',
    completer: withFuzzyFilter(async (ctx: CommandContext) => {
      const manager = ctx.services.subagentManager;
      if (!manager) {
        return [];
      }

      const names = await manager.listSubagents();

      const suggestions = await Promise.all(
        names.map(async (name) => {
          try {
            const details = await manager.loadSubagent(name);
            return {
              value: name,
              description: `Profile: ${details.profile}`,
            };
          } catch {
            return {
              value: name,
              description: 'Subagent',
            };
          }
        }),
      );

      return suggestions;
    }),
  },
  {
    kind: 'value' as const,
    name: 'profile',
    description: 'Select profile configuration',
    completer: withFuzzyFilter(async (ctx: CommandContext) => {
      const profileManager = ctx.services.profileManager;
      if (
        !profileManager ||
        typeof profileManager.listProfiles !== 'function'
      ) {
        return [];
      }

      try {
        const profiles = await profileManager.listProfiles();

        return profiles.map((name) => ({
          value: name,
          description: 'Saved profile',
        }));
      } catch (error) {
        logger.warn(
          () =>
            `Error loading profiles for subagent completion: ${error instanceof Error ? error.message : String(error)}`,
        );
        return [];
      }
    }),
  },
  {
    kind: 'literal' as const,
    value: 'auto',
    description: 'Automatic mode',
    next: [
      {
        kind: 'value' as const,
        name: 'prompt',
        description: 'Enter system prompt for automatic mode',
      },
    ],
  },
  {
    kind: 'literal' as const,
    value: 'manual',
    description: 'Manual mode',
    next: [
      {
        kind: 'value' as const,
        name: 'prompt',
        description: 'Enter system prompt for manual mode',
      },
    ],
  },
];

/**
 * /subagent save command - Auto and Manual modes
 *
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P14
 * @requirement:REQ-003
 * @requirement:REQ-004
 * @requirement:REQ-014
 * @requirement:REQ-015
 * @pseudocode SubagentCommand.md lines 1-90
 */
const saveCommand: SlashCommand = {
  name: 'save',
  description: 'Save a subagent configuration (auto or manual mode)',
  kind: CommandKind.BUILT_IN,
  // Schema-based completion replaces legacy completion function
  schema: subagentSchema,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<SlashCommandActionReturn> => {
    // Parse arguments: <name> <profile> <mode> "<text>"
    const parsedArgs = parseSaveArgs(args);

    if (!parsedArgs) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /subagent save <name> <profile> auto|manual "<text>"',
      };
    }

    const { name, profile, mode, input } = parsedArgs;
    const { services, overwriteConfirmed, invocation } = context;
    const subagentManager = services.subagentManager; // @plan:PLAN-20250117-SUBAGENTCONFIG.P14 @requirement:REQ-003
    if (!subagentManager) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          'SubagentManager service is unavailable. Please run integration (Phase 15) before using /subagent.',
      };
    }

    // Validate profile exists (pseudocode lines 263-281 cover this)
    const profileExists =
      await subagentManager.validateProfileReference(profile);
    if (!profileExists) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Profile '${profile}' not found. Use '/profile list' to see available profiles.`,
      };
    }

    // Check if exists for overwrite confirmation
    const exists = await subagentManager.subagentExists(name);

    if (exists && !overwriteConfirmed) {
      return {
        type: 'confirm_action',
        prompt: React.createElement(
          Text,
          null,
          'A subagent with the name ',
          React.createElement(Text, { color: Colors.AccentPurple }, name),
          ' already exists. Do you want to overwrite it?',
        ),
        originalInvocation: {
          raw: invocation?.raw || '',
        },
      };
    }

    let finalSystemPrompt: string;

    if (mode === 'manual') {
      // Manual mode: use input directly
      finalSystemPrompt = input;
      return handleManualMode(context, name, profile, finalSystemPrompt, {
        existed: exists,
      });
    } else {
      // Auto mode: generate using LLM
      const configService = services.config; // @plan:PLAN-20250117-SUBAGENTCONFIG.P14 @requirement:REQ-003
      if (!configService) {
        return {
          type: 'message',
          messageType: 'error',
          content:
            'Configuration service unavailable. Set up the CLI before using auto mode.',
        };
      }

      try {
        finalSystemPrompt = await generateAutoPrompt(configService, input);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          type: 'message',
          messageType: 'error',
          content: `Error: Failed to generate system prompt (${errorMessage}). Try manual mode or check your connection.`,
        };
      }
      return saveSubagent(context, name, profile, finalSystemPrompt, exists);
    }
  },
};

/**
 * /subagent list command - Displays non-interactive text list
 *
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
 * @requirement:REQ-005
 */
const listCommand: SlashCommand = {
  name: 'list',
  description: 'List all saved subagents',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, _args: string): Promise<void> => {
    const manager = context.services.subagentManager;
    if (!manager) {
      context.ui.addItem(
        {
          type: MessageType.ERROR,
          text: 'SubagentManager service is unavailable.',
        },
        Date.now(),
      );
      return;
    }

    const names = await manager.listSubagents();

    if (names.length === 0) {
      context.ui.addItem(
        {
          type: MessageType.INFO,
          text: 'No subagents configured. Use /subagent create to create one.',
        },
        Date.now(),
      );
      return;
    }

    const lines: string[] = ['Subagents:'];
    for (const name of names) {
      try {
        const config = await manager.loadSubagent(name);
        lines.push(`  • ${name} (profile: ${config.profile})`);
      } catch {
        lines.push(`  • ${name}`);
      }
    }

    context.ui.addItem(
      { type: MessageType.INFO, text: lines.join('\n') },
      Date.now(),
    );
  },
};

/**
 * /subagent show command - Opens interactive show view
 *
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
 * @requirement:REQ-006
 */
const showCommand: SlashCommand = {
  name: 'show',
  description: 'Show detailed subagent configuration (interactive)',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<SlashCommandActionReturn> => {
    const name = args.trim();

    if (!name) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /subagent show <name>',
      };
    }

    // Validate subagent exists
    const { services } = context;
    const subagentManager = services.subagentManager;
    if (!subagentManager) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'SubagentManager service is unavailable.',
      };
    }

    const exists = await subagentManager.subagentExists(name);
    if (!exists) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Subagent '${name}' not found. Use /subagent list to see available subagents.`,
      };
    }

    return {
      type: 'dialog',
      dialog: 'subagent',
      dialogData: { initialView: SubagentView.SHOW, initialSubagentName: name },
    };
  },
};

/**
 * /subagent delete command - Opens interactive delete confirmation
 *
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
 * @requirement:REQ-007
 */
const deleteCommand: SlashCommand = {
  name: 'delete',
  description: 'Delete a subagent configuration (interactive)',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<SlashCommandActionReturn> => {
    const name = args.trim();

    if (!name) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /subagent delete <name>',
      };
    }

    const { services } = context;
    const subagentManager = services.subagentManager;
    if (!subagentManager) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'SubagentManager service is unavailable.',
      };
    }

    const exists = await subagentManager.subagentExists(name);
    if (!exists) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Subagent '${name}' not found.`,
      };
    }

    return {
      type: 'dialog',
      dialog: 'subagent',
      dialogData: {
        initialView: SubagentView.DELETE,
        initialSubagentName: name,
      },
    };
  },
};

/**
 * /subagent edit command - Opens interactive edit form
 *
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P11
 * @requirement:REQ-008
 */
const editCommand: SlashCommand = {
  name: 'edit',
  description: 'Edit subagent configuration (interactive)',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<SlashCommandActionReturn> => {
    const name = args.trim();

    if (!name) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /subagent edit <name>',
      };
    }

    const { services } = context;
    const subagentManager = services.subagentManager;
    if (!subagentManager) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'SubagentManager service is unavailable.',
      };
    }

    const exists = await subagentManager.subagentExists(name);
    if (!exists) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Subagent '${name}' not found.`,
      };
    }

    return {
      type: 'dialog',
      dialog: 'subagent',
      dialogData: { initialView: SubagentView.EDIT, initialSubagentName: name },
    };
  },
};

/**
 * /subagent create command - Opens interactive creation wizard
 */
const createCommand: SlashCommand = {
  name: 'create',
  description: 'Create a new subagent (interactive wizard)',
  kind: CommandKind.BUILT_IN,
  action: async (
    _context: CommandContext,
    _args: string,
  ): Promise<SlashCommandActionReturn> => ({
    type: 'dialog',
    dialog: 'subagent',
    dialogData: { initialView: SubagentView.CREATE },
  }),
};

/**
 * /subagent menu command - Opens the subagent manager menu
 */
const menuCommand: SlashCommand = {
  name: 'menu',
  description: 'Open the subagent manager menu',
  kind: CommandKind.BUILT_IN,
  action: async (
    _context: CommandContext,
    _args: string,
  ): Promise<SlashCommandActionReturn> => ({
    type: 'dialog',
    dialog: 'subagent',
    dialogData: { initialView: SubagentView.MENU },
  }),
};

/**
 * /subagent parent command with schema-based completion
 *
 * @plan:PLAN-20251013-AUTOCOMPLETE.P08
 * @requirement:REQ-002
 * @requirement:REQ-003
 * @requirement:REQ-004
 * Legacy completion removed - now fully schema-driven
 */
export const subagentCommand: SlashCommand = {
  name: 'subagent',
  description: 'Manage subagent configurations.',
  kind: CommandKind.BUILT_IN,
  action: async (
    _context: CommandContext,
    _args: string,
  ): Promise<SlashCommandActionReturn> => ({
    type: 'dialog',
    dialog: 'subagent',
    dialogData: { initialView: SubagentView.MENU },
  }),
  subCommands: [
    menuCommand,
    saveCommand,
    createCommand,
    listCommand,
    showCommand,
    editCommand,
    deleteCommand,
  ],
};
