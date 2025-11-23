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
 * @returns The matched command, its arguments, and the canonical path of resolved commands
 */
export function parseSlashCommand(
  rawQuery: string,
  commands: readonly SlashCommand[],
): {
  commandToExecute: SlashCommand | undefined;
  args: string;
  canonicalPath: string[];
} {
  const trimmed = rawQuery.trim();
  if (!trimmed.startsWith('/')) {
    return { commandToExecute: undefined, args: '', canonicalPath: [] };
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

  if (!commandToExecute) {
    return { commandToExecute: undefined, args, canonicalPath: [] };
  }

  // Build canonical path starting with the parent command
  const canonicalPath: string[] = [commandToExecute.name];

  // Check if there are subcommands and if args starts with a potential subcommand
  if (commandToExecute.subCommands && args) {
    const nextSpaceIndex = args.indexOf(' ');
    const potentialSubcommandName =
      nextSpaceIndex === -1
        ? args.toLowerCase()
        : args.substring(0, nextSpaceIndex).toLowerCase();

    // Try to find a matching subcommand
    const subCommand = commandToExecute.subCommands.find(
      (sub) =>
        sub.name.toLowerCase() === potentialSubcommandName ||
        sub.altNames?.some(
          (alt) => alt.toLowerCase() === potentialSubcommandName,
        ),
    );

    if (subCommand) {
      // We found a subcommand, so update the command to execute and adjust args
      canonicalPath.push(subCommand.name);
      return {
        commandToExecute: subCommand,
        args:
          nextSpaceIndex === -1
            ? ''
            : args.substring(nextSpaceIndex + 1).trim(),
        canonicalPath,
      };
    }
  }

  return { commandToExecute, args, canonicalPath };
}
