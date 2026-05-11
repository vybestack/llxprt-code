/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommand } from '../commands/types.js';
import type {
  ParsedSlashCommandPath,
  ParsedCommandArguments,
} from './slashCompletionTypes.js';

/**
 * Finds a command by name or alt name in a list.
 */
function findCommand(
  commands: readonly SlashCommand[],
  name: string,
): SlashCommand | undefined {
  return commands.find(
    (cmd) => cmd.name === name || cmd.altNames?.includes(name) === true,
  );
}

/**
 * Processes a single path part to resolve command hierarchy.
 */
function processPathPart(
  part: string,
  currentLevel: readonly SlashCommand[] | undefined,
): {
  found: SlashCommand | null;
  nextLevel: readonly SlashCommand[] | undefined;
} {
  if (!currentLevel) {
    return { found: null, nextLevel: undefined };
  }

  const found = findCommand(currentLevel, part);
  if (!found) {
    return { found: null, nextLevel: currentLevel };
  }

  return {
    found,
    nextLevel: found.subCommands as readonly SlashCommand[] | undefined,
  };
}

/**
 * Resolves command path parts.
 */
function resolveCommandPath(
  parts: string[],
  startLevel: readonly SlashCommand[],
): {
  pathParts: string[];
  leafCommand: SlashCommand | null;
  currentLevel: readonly SlashCommand[] | undefined;
} {
  const pathParts: string[] = [];
  let currentLevel: readonly SlashCommand[] | undefined = startLevel;
  let leafCommand: SlashCommand | null = null;

  for (const part of parts) {
    const { found, nextLevel } = processPathPart(part, currentLevel);
    if (!found) {
      break;
    }
    pathParts.push(part);
    leafCommand = found;
    currentLevel = nextLevel;
  }

  return { pathParts, leafCommand, currentLevel };
}

/**
 * Parses a slash command path and resolves command hierarchy.
 */
export function parseSlashCommandPath(
  fullPath: string,
  hasTrailingSpace: boolean,
  slashCommands: readonly SlashCommand[],
): ParsedSlashCommandPath {
  const rawParts = fullPath.split(/\s+/).filter((p) => p);
  const completeParts = hasTrailingSpace ? rawParts : rawParts.slice(0, -1);

  const { pathParts, leafCommand, currentLevel } = resolveCommandPath(
    completeParts,
    slashCommands,
  );

  const remainingParts = rawParts.slice(pathParts.length);

  return {
    pathParts,
    leafCommand,
    currentLevel,
    remainingParts,
    commandPathLength: pathParts.length,
  };
}

/**
 * Checks if a candidate has other matches at the current level.
 */
function hasOtherMatches(
  currentLevel: readonly SlashCommand[],
  exactMatch: SlashCommand,
  candidate: string,
): boolean {
  return currentLevel.some(
    (cmd) =>
      cmd !== exactMatch &&
      (cmd.name.toLowerCase().startsWith(candidate.toLowerCase()) ||
        cmd.altNames?.some((alt) =>
          alt.toLowerCase().startsWith(candidate.toLowerCase()),
        ) === true),
  );
}

/**
 * Finds exact match that could be a parent command.
 */
function findExactMatchParent(
  currentLevel: readonly SlashCommand[] | undefined,
  candidate: string,
): { exactMatchAsParent: SlashCommand | undefined; shouldDescend: boolean } {
  if (!currentLevel || candidate.length === 0) {
    return { exactMatchAsParent: undefined, shouldDescend: false };
  }

  const match = currentLevel.find(
    (cmd) =>
      findCommand([cmd], candidate) !== undefined && cmd.subCommands != null,
  );

  if (!match) {
    return { exactMatchAsParent: undefined, shouldDescend: false };
  }

  const hasOthers = hasOtherMatches(currentLevel, match, candidate);
  return {
    exactMatchAsParent: hasOthers ? undefined : match,
    shouldDescend: !hasOthers,
  };
}

/**
 * Parses command arguments for schema-based completion.
 */
export function parseCommandArguments(
  remainingParts: string[],
  hasTrailingSpace: boolean,
  leafCommand: SlashCommand | null,
  currentLevel: readonly SlashCommand[] | undefined,
): ParsedCommandArguments {
  const leafSupportsArguments = Boolean(leafCommand?.schema);

  let commandPartial = '';
  let argumentPartial = '';
  let completedArgsForSchema: string[] = [];

  if (leafSupportsArguments) {
    if (remainingParts.length > 0) {
      if (hasTrailingSpace) {
        completedArgsForSchema = remainingParts;
      } else {
        argumentPartial = remainingParts[remainingParts.length - 1];
        completedArgsForSchema = remainingParts.slice(0, -1);
      }
    }
  } else if (!hasTrailingSpace && remainingParts.length > 0) {
    commandPartial = remainingParts[remainingParts.length - 1];
  }

  const candidate =
    commandPartial.length > 0 ? commandPartial : argumentPartial;
  const { exactMatchAsParent } = findExactMatchParent(currentLevel, candidate);

  return {
    commandPartial,
    argumentPartial,
    completedArgsForSchema,
    leafSupportsArguments,
    exactMatchAsParent,
  };
}

/**
 * Calculates completion range positions.
 */
export function calculateCompletionRange(
  commandIndex: number,
  currentLine: string,
  hasTrailingSpace: boolean,
  exactMatchAsParent: SlashCommand | undefined,
  activePartial: string,
): { start: number; end: number } {
  if (hasTrailingSpace || exactMatchAsParent) {
    return { start: currentLine.length, end: currentLine.length };
  }
  if (activePartial) {
    return {
      start: currentLine.length - activePartial.length,
      end: currentLine.length,
    };
  }
  return { start: commandIndex + 1, end: currentLine.length };
}

/**
 * Checks if leaf command is a perfect executable match.
 */
function checkLeafCommandMatch(
  leafCommand: SlashCommand | null,
  commandPartial: string,
  argumentPartial: string,
  leafSupportsArguments: boolean,
): boolean {
  const hasExecutableLeaf = leafCommand?.action !== undefined;
  return (
    hasExecutableLeaf &&
    commandPartial === '' &&
    argumentPartial === '' &&
    !leafSupportsArguments
  );
}

/**
 * Checks if there's a perfect executable match in current level.
 */
function checkCurrentLevelMatch(
  currentLevel: readonly SlashCommand[] | undefined,
  commandPartial: string,
): SlashCommand | null {
  if (!currentLevel || commandPartial.length === 0) {
    return null;
  }
  const match = currentLevel.find(
    (cmd) =>
      findCommand([cmd], commandPartial) !== undefined && cmd.action != null,
  );
  return match ?? null;
}

/**
 * Checks if there's a perfect executable match.
 */
export function checkPerfectMatch(
  leafCommand: SlashCommand | null,
  commandPartial: string,
  argumentPartial: string,
  leafSupportsArguments: boolean,
  currentLevel: readonly SlashCommand[] | undefined,
  hasTrailingSpace: boolean,
): { isPerfectMatch: boolean; perfectMatchCommand: SlashCommand | null } {
  if (hasTrailingSpace) {
    return { isPerfectMatch: false, perfectMatchCommand: null };
  }

  if (
    checkLeafCommandMatch(
      leafCommand,
      commandPartial,
      argumentPartial,
      leafSupportsArguments,
    )
  ) {
    return { isPerfectMatch: true, perfectMatchCommand: leafCommand };
  }

  const levelMatch = checkCurrentLevelMatch(currentLevel, commandPartial);
  if (levelMatch) {
    return { isPerfectMatch: true, perfectMatchCommand: levelMatch };
  }

  return { isPerfectMatch: false, perfectMatchCommand: null };
}

/**
 * Checks if a command should be filtered out based on extension status.
 */
function shouldFilterExtensionCommand(
  cmd: SlashCommand,
  extensionConfig: {
    isExtensionEnabled?: (name: string) => boolean;
  } | null,
): boolean {
  if (cmd.kind !== 'extension') {
    return false;
  }
  if (!cmd.extensionName) {
    return true;
  }
  if (
    typeof extensionConfig?.isExtensionEnabled === 'function' &&
    !extensionConfig.isExtensionEnabled(cmd.extensionName)
  ) {
    return true;
  }
  return false;
}

/**
 * Checks if a command matches the partial input.
 */
function commandMatchesPartial(
  cmd: SlashCommand,
  commandPartial: string,
): boolean {
  return (
    typeof cmd.description === 'string' &&
    cmd.description.length > 0 &&
    (cmd.name.startsWith(commandPartial) ||
      cmd.altNames?.some((alt) => alt.startsWith(commandPartial)) === true)
  );
}

/**
 * Filters commands based on partial input and extension status.
 */
export function filterCommands(
  commands: readonly SlashCommand[],
  options: {
    commandPartial: string;
    extensionConfig: {
      isExtensionEnabled?: (name: string) => boolean;
    } | null;
  },
): SlashCommand[] {
  const { commandPartial, extensionConfig } = options;

  return commands.filter((cmd) => {
    if (shouldFilterExtensionCommand(cmd, extensionConfig)) {
      return false;
    }
    return commandMatchesPartial(cmd, commandPartial);
  });
}

/**
 * Checks if a command is an exact match for the partial.
 */
function isExactMatch(cmd: SlashCommand, commandPartial: string): boolean {
  return findCommand([cmd], commandPartial) !== undefined;
}

/**
 * Sorts suggestions so exact matches come first.
 */
export function sortSuggestionsByExactMatch(
  commands: SlashCommand[],
  commandPartial: string,
): SlashCommand[] {
  return [...commands].sort((a, b) => {
    const aIsExact = isExactMatch(a, commandPartial);
    const bIsExact = isExactMatch(b, commandPartial);
    if (aIsExact && !bIsExact) return -1;
    if (!aIsExact && bIsExact) return 1;
    return 0;
  });
}
