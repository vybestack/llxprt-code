/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandArgumentSchema } from './schema/types.js';
import {
  CommandKind,
  type MessageActionReturn,
  type SlashCommand,
} from './types.js';

export type ChatSubcommandName =
  | 'list'
  | 'save'
  | 'resume'
  | 'delete'
  | 'rename'
  | 'clear'
  | 'restore'
  | 'name'
  | 'debug';

export type ChatSubcommandActions = Readonly<
  Record<ChatSubcommandName, NonNullable<SlashCommand['action']>>
>;

interface ChatSubcommandDefinition {
  readonly name: ChatSubcommandName;
  readonly altNames?: readonly string[];
  readonly description: string;
  readonly autoExecute?: true;
  readonly selectsCheckpoint?: true;
}

// Both recording owners expose this one surface; only the actions differ.
const SUBCOMMANDS: readonly ChatSubcommandDefinition[] = [
  {
    name: 'list',
    description: 'List saved conversation checkpoints',
  },
  {
    name: 'save',
    description:
      'Save the current conversation as a checkpoint. Usage: /chat save <tag>',
  },
  {
    name: 'resume',
    altNames: ['load'],
    description:
      'Resume a conversation from a checkpoint. Usage: /chat resume <tag>',
    autoExecute: true,
    selectsCheckpoint: true,
  },
  {
    name: 'delete',
    altNames: ['rm', 'remove'],
    description:
      'Delete a conversation checkpoint. Usage: /chat delete <tag> [--force]',
    autoExecute: true,
    selectsCheckpoint: true,
  },
  {
    name: 'rename',
    altNames: ['mv'],
    description:
      'Rename a conversation checkpoint. Usage: /chat rename <old_tag> <new_tag>',
  },
  {
    name: 'clear',
    description: 'Clear the current conversation history',
  },
  {
    name: 'restore',
    altNames: ['undo'],
    description:
      'Restore conversation to N turns ago. Usage: /chat restore <number>',
  },
  {
    name: 'name',
    description: 'Name the active session. Usage: /chat name <name>',
  },
  {
    name: 'debug',
    description: 'Show chat diagnostics and debug information',
  },
];

const CHAT_HELP_CONTENT = `Available /chat commands:
• list - List all saved conversation checkpoints
• save <tag> - Save current conversation with a tag
• resume <tag> - Resume a saved conversation (alias of /continue)
• delete <tag> [--force] - Delete a saved checkpoint
• rename <old_tag> <new_tag> - Rename a checkpoint
• clear - Clear current conversation history
• restore <number> - Restore conversation to N turns ago
• name <name> - Name the active session
• debug - Show chat diagnostics and debug information`;

export function composeChatCommand(
  actions: ChatSubcommandActions,
  checkpointSchema: CommandArgumentSchema,
): SlashCommand {
  return {
    name: 'chat',
    description: 'Manage conversation checkpoints',
    kind: CommandKind.BUILT_IN,
    subCommands: SUBCOMMANDS.map(
      ({ name, altNames, description, autoExecute, selectsCheckpoint }) => ({
        name,
        ...(altNames ? { altNames: [...altNames] } : {}),
        description,
        kind: CommandKind.BUILT_IN,
        ...(selectsCheckpoint ? { schema: checkpointSchema } : {}),
        ...(autoExecute ? { autoExecute } : {}),
        action: actions[name],
      }),
    ),
    action: async (): Promise<MessageActionReturn> => ({
      type: 'message',
      messageType: 'info',
      content: CHAT_HELP_CONTENT,
    }),
  };
}
