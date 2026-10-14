/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* @jsxImportSource react */

import React from 'react';
import { Text } from 'ink';
import type {
  SlashCommand,
  CommandContext,
  SlashCommandActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import type { CommandArgumentSchema } from './schema/types.js';
import { MessageType } from '../types.js';
import { Colors } from '../colors.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';

const logger = new DebugLogger('llxprt:ui:subagent');
import { filterCompletions } from '../utils/fuzzyFilter.js';
import { SubagentView } from '../components/SubagentManagement/types.js';
import type {
  SubagentDefinitionReads,
  SubagentDefinitionWrites,
} from '@vybestack/llxprt-code-core';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
export interface SubagentCommandOperations {
  readonly isAvailable: boolean;
  readonly isConfigured: boolean;
  readonly listSubagents: SubagentDefinitionReads['listSubagents'];
  readonly loadSubagent: SubagentDefinitionReads['loadSubagent'];
  readonly subagentExists: SubagentDefinitionReads['subagentExists'];
  readonly subagentExistsOnDisk: SubagentDefinitionReads['subagentExistsOnDisk'];
  readonly hasSettingsSubagent: SubagentDefinitionReads['hasSettingsSubagent'];
  readonly validateProfileReference: SubagentDefinitionReads['validateProfileReference'];
  readonly saveSubagent: SubagentDefinitionWrites['saveSubagent'];
  readonly listProfiles: () => Promise<string[]>;
  readonly isFuzzyEnabled: () => boolean;
  readonly generatePrompt: (description: string) => Promise<string>;
  readonly addItem: UseHistoryManagerReturn['addItem'];
}

/**
 * Parse save command arguments
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P12
 * @requirement:REQ-004
 * @requirement:REQ-011
 * @pseudocode SubagentCommand.md lines 1-17
 */
const SAVE_ARGS_REGEX =
  /^(\S+)\s+(\S+)\s+(auto|manual)\s+"((?:[^"\\]|\\.)*)("|"?)/;

function parseSaveArgs(args: string): {
  name: string;
  profile: string;
  mode: 'auto' | 'manual';
  input: string;
} | null {
  const match = args.match(SAVE_ARGS_REGEX);

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
  operations: SubagentCommandOperations,
  name: string,
  profile: string,
  systemPrompt: string,
  options?: { existed: boolean },
): Promise<SlashCommandActionReturn> => {
  const existed = options?.existed ?? false;
  return saveSubagent(operations, name, profile, systemPrompt, existed);
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
  operations: SubagentCommandOperations,
  name: string,
  profile: string,
  systemPrompt: string,
  existed: boolean,
): Promise<SlashCommandActionReturn> {
  const manager = operations.isAvailable ? operations : null;
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
 * Shared completer that lists existing subagents as autocomplete suggestions.
 *
 * @plan:PLAN-20251013-AUTOCOMPLETE.P08
 * @requirement:REQ-002
 * @requirement:REQ-004
 */
function createSubagentNameCompleter(
  operations: SubagentCommandOperations,
): NonNullable<
  Extract<CommandArgumentSchema[number], { kind: 'value' }>['completer']
> {
  return async (_invocation, partialArg) => {
    const manager = operations.isAvailable ? operations : null;
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
        } catch (error) {
          logger.warn(
            () =>
              `Error loading subagent '${name}' for autocomplete: ${error instanceof Error ? error.message : String(error)}`,
          );
          return {
            value: name,
            description: 'Subagent',
          };
        }
      }),
    );

    return filterCompletions(suggestions, partialArg, {
      enableFuzzy: operations.isFuzzyEnabled(),
    });
  };
}

/**
 * Schema exposing subagent-name autocomplete for single-argument commands
 * (`/subagent edit|show|delete <name>`).
 *
 * @requirement:REQ-004
 */
function createSubagentNameSchema(
  operations: SubagentCommandOperations,
): CommandArgumentSchema {
  return [
    {
      kind: 'value',
      name: 'name',
      description: 'Enter subagent name',
      completer: createSubagentNameCompleter(operations),
    },
  ];
}

/**
 * @plan:PLAN-20251013-AUTOCOMPLETE.P08
 * @requirement:REQ-002
 * @requirement:REQ-003
 * @requirement:REQ-004
 * @pseudocode ArgumentSchema.md lines 91-104
 * Schema definition for subagent command completion
 */
function createSubagentSchema(
  operations: SubagentCommandOperations,
): CommandArgumentSchema {
  return [
    {
      kind: 'value' as const,
      name: 'name',
      description: 'Enter subagent name',
      completer: createSubagentNameCompleter(operations),
    },
    {
      kind: 'value' as const,
      name: 'profile',
      description: 'Select profile configuration',
      completer: async (_invocation, partialArg) => {
        try {
          const profiles = await operations.listProfiles();

          return filterCompletions(
            profiles.map((name) => ({
              value: name,
              description: 'Saved profile',
            })),
            partialArg,
            { enableFuzzy: operations.isFuzzyEnabled() },
          );
        } catch (error) {
          logger.warn(
            () =>
              `Error loading profiles for subagent completion: ${error instanceof Error ? error.message : String(error)}`,
          );
          return [];
        }
      },
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
}

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
function createSaveCommand(
  operations: SubagentCommandOperations,
): SlashCommand {
  return {
    name: 'save',
    description: 'Save a subagent configuration (auto or manual mode)',
    kind: CommandKind.BUILT_IN,
    // Schema-based completion replaces legacy completion function
    schema: createSubagentSchema(operations),
    action: async (
      context: Pick<CommandContext, 'invocation' | 'overwriteConfirmed'>,
      args: string,
    ): Promise<SlashCommandActionReturn> => {
      // Parse arguments: <name> <profile> <mode> "<text>"
      const parsedArgs = parseSaveArgs(args);

      if (!parsedArgs) {
        return {
          type: 'message',
          messageType: 'error',
          content:
            'Usage: /subagent save <name> <profile> auto|manual "<text>"',
        };
      }

      const { name, profile, mode, input } = parsedArgs;
      const { overwriteConfirmed, invocation } = context;
      const subagentManager = operations.isAvailable ? operations : null; // @plan:PLAN-20250117-SUBAGENTCONFIG.P14 @requirement:REQ-003
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

      if (exists && overwriteConfirmed !== true) {
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
            raw: invocation?.raw ?? '',
          },
        };
      }

      if (mode === 'manual') {
        // Manual mode: use input directly
        const finalSystemPrompt = input;
        return handleManualMode(operations, name, profile, finalSystemPrompt, {
          existed: exists,
        });
      }
      return handleAutoMode(operations, name, profile, input, exists);
    },
  };
}

/**
 * /subagent list command - Displays non-interactive text list
 *
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
 * @requirement:REQ-005
 */
function createListCommand(
  operations: SubagentCommandOperations,
): SlashCommand {
  return {
    name: 'list',
    description: 'List all saved subagents',
    kind: CommandKind.BUILT_IN,
    action: async (
      _invocation: Pick<CommandContext, 'invocation' | 'overwriteConfirmed'>,
      _args: string,
    ): Promise<void> => {
      const manager = operations.isAvailable ? operations : null;
      if (!manager) {
        operations.addItem(
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
        operations.addItem(
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
          let line = `  • ${name} (profile: ${config.profile})`;

          // Show provenance for non-user subagents and user overrides
          if (config.source === 'settings') {
            line += ` [settings]`;
          } else if (config.source === 'extension') {
            line += ` [ext: ${config.sourceExtension}]`;
          } else if (
            config.source === 'user' &&
            manager.hasSettingsSubagent(name)
          ) {
            // User override of settings subagent
            line += ` [settings, user override]`;
          }

          lines.push(line);
        } catch {
          lines.push(`  • ${name}`);
        }
      }

      operations.addItem(
        { type: MessageType.INFO, text: lines.join('\n') },
        Date.now(),
      );
    },
  };
}

/**
 * /subagent show command - Opens interactive show view
 *
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
 * @requirement:REQ-006
 */
function createShowCommand(
  operations: SubagentCommandOperations,
): SlashCommand {
  return {
    name: 'show',
    description: 'Show detailed subagent configuration (interactive)',
    kind: CommandKind.BUILT_IN,
    schema: createSubagentNameSchema(operations),
    action: async (
      _invocation: Pick<CommandContext, 'invocation' | 'overwriteConfirmed'>,
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
      const subagentManager = operations.isAvailable ? operations : null;
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
        dialogData: {
          initialView: SubagentView.SHOW,
          initialSubagentName: name,
        },
      };
    },
  };
}

/**
 * /subagent delete command - Opens interactive delete confirmation
 *
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
 * @requirement:REQ-007
 */
function createDeleteCommand(
  operations: SubagentCommandOperations,
): SlashCommand {
  return {
    name: 'delete',
    description: 'Delete a subagent configuration (interactive)',
    kind: CommandKind.BUILT_IN,
    schema: createSubagentNameSchema(operations),
    action: async (
      _invocation: Pick<CommandContext, 'invocation' | 'overwriteConfirmed'>,
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

      const subagentManager = operations.isAvailable ? operations : null;
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

      // Check if it's a settings-only or extension-only subagent
      try {
        const config = await subagentManager.loadSubagent(name);
        if (config.source === 'settings') {
          return {
            type: 'message',
            messageType: 'error',
            content: `Cannot delete settings-defined subagent '${name}'. Modify it in settings.json instead.`,
          };
        }
        if (config.source === 'extension') {
          // Check if user has a disk override
          const diskExists = await subagentManager.subagentExistsOnDisk(name);
          if (!diskExists) {
            return {
              type: 'message',
              messageType: 'error',
              content: `Cannot delete extension-provided subagent '${name}'. It is managed by extension '${config.sourceExtension}'.`,
            };
          }
        }
      } catch (error) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Error checking subagent: ${error instanceof Error ? error.message : String(error)}`,
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
}

/**
 * /subagent edit command - Opens interactive edit form
 *
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P11
 * @requirement:REQ-008
 */
function createEditCommand(
  operations: SubagentCommandOperations,
): SlashCommand {
  return {
    name: 'edit',
    description: 'Edit subagent configuration (interactive)',
    kind: CommandKind.BUILT_IN,
    schema: createSubagentNameSchema(operations),
    action: async (
      _invocation: Pick<CommandContext, 'invocation' | 'overwriteConfirmed'>,
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

      const subagentManager = operations.isAvailable ? operations : null;
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

      // Check if it's a settings-only or extension-only subagent
      try {
        const config = await subagentManager.loadSubagent(name);
        if (config.source === 'settings') {
          return {
            type: 'message',
            messageType: 'error',
            content: `Cannot edit settings-defined subagent '${name}'. Modify it in settings.json instead.`,
          };
        }
        if (config.source === 'extension') {
          // Check if user has a disk override
          const diskExists = await subagentManager.subagentExistsOnDisk(name);
          if (!diskExists) {
            return {
              type: 'message',
              messageType: 'error',
              content: `Cannot edit extension-provided subagent '${name}'. It is managed by extension '${config.sourceExtension}'.`,
            };
          }
        }
      } catch (error) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Error checking subagent: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      return {
        type: 'dialog',
        dialog: 'subagent',
        dialogData: {
          initialView: SubagentView.EDIT,
          initialSubagentName: name,
        },
      };
    },
  };
}

/**
 * /subagent create command - Opens interactive creation wizard
 */
function createCreateCommand(): SlashCommand {
  return {
    name: 'create',
    description: 'Create a new subagent (interactive wizard)',
    kind: CommandKind.BUILT_IN,
    action: async (
      __invocation: Pick<CommandContext, 'invocation' | 'overwriteConfirmed'>,
      _args: string,
    ): Promise<SlashCommandActionReturn> => ({
      type: 'dialog',
      dialog: 'subagent',
      dialogData: { initialView: SubagentView.CREATE },
    }),
  };
}

/**
 * /subagent menu command - Opens the subagent manager menu
 */
function createMenuCommand(): SlashCommand {
  return {
    name: 'menu',
    description: 'Open the subagent manager menu',
    kind: CommandKind.BUILT_IN,
    action: async (
      __invocation: Pick<CommandContext, 'invocation' | 'overwriteConfirmed'>,
      _args: string,
    ): Promise<SlashCommandActionReturn> => ({
      type: 'dialog',
      dialog: 'subagent',
      dialogData: { initialView: SubagentView.MENU },
    }),
  };
}

/**
 * /subagent parent command with schema-based completion
 *
 * @plan:PLAN-20251013-AUTOCOMPLETE.P08
 * @requirement:REQ-002
 * @requirement:REQ-003
 * @requirement:REQ-004
 * Legacy completion removed - now fully schema-driven
 */

export function createSubagentCommand(
  operations: SubagentCommandOperations,
): SlashCommand {
  return {
    name: 'subagent',
    description: 'Manage subagent configurations.',
    kind: CommandKind.BUILT_IN,
    action: async (
      __invocation: Pick<CommandContext, 'invocation' | 'overwriteConfirmed'>,
      _args: string,
    ): Promise<SlashCommandActionReturn> => ({
      type: 'dialog',
      dialog: 'subagent',
      dialogData: { initialView: SubagentView.MENU },
    }),
    subCommands: [
      createMenuCommand(),
      createSaveCommand(operations),
      createCreateCommand(),
      createListCommand(operations),
      createShowCommand(operations),
      createEditCommand(operations),
      createDeleteCommand(operations),
    ],
  };
}

async function handleAutoMode(
  operations: SubagentCommandOperations,
  name: string,
  profile: string,
  input: string,
  exists: boolean,
): Promise<SlashCommandActionReturn> {
  // Auto mode: generate using LLM
  const configService = operations.isConfigured; // @plan:PLAN-20250117-SUBAGENTCONFIG.P14 @requirement:REQ-003
  if (!configService) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        'Configuration service unavailable. Set up the CLI before using auto mode.',
    };
  }

  let finalSystemPrompt: string;
  try {
    finalSystemPrompt = await operations.generatePrompt(input);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      type: 'message',
      messageType: 'error',
      content: `Error: Failed to generate system prompt (${errorMessage}). Try manual mode or check your connection.`,
    };
  }
  return saveSubagent(operations, name, profile, finalSystemPrompt, exists);
}
