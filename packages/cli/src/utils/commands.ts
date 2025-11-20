/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommand } from '../ui/commands/types.js';

/**
 * Parses a slash command string and finds the matching command.
 * @param rawQuery The raw user input string
 * @param commands The list of available commands
 * @returns The matched command and its arguments
 */
export function parseSlashCommand(
  rawQuery: string,
  commands: readonly SlashCommand[],
): { commandToExecute: SlashCommand | undefined; args: string } {
  const trimmed = rawQuery.trim();
  if (!trimmed.startsWith('/')) {
    return { commandToExecute: undefined, args: '' };
  }

  // Split the command from its arguments
  const spaceIndex = trimmed.indexOf(' ');
  let commandName: string;
  let args: string;

  if (spaceIndex === -1) {
    commandName = trimmed.substring(1).toLowerCase();
    args = '';
  } else {
    commandName = trimmed.substring(1, spaceIndex).toLowerCase();
    args = trimmed.substring(spaceIndex + 1).trim();
  }

  // Find matching command by name or alias
  const commandToExecute = commands.find(
    (cmd) =>
      cmd.name.toLowerCase() === commandName ||
      cmd.altNames?.some((alt) => alt.toLowerCase() === commandName),
  );

  return { commandToExecute, args };
}
