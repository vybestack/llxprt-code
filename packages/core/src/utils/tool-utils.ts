/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import levenshtein from 'fast-levenshtein';
import type { AnyDeclarativeTool, AnyToolInvocation } from '../index.js';
import { isTool } from '../index.js';
import { SHELL_TOOL_NAMES, splitCommands } from './shell-utils.js';

/**
 * Checks if a tool invocation matches any of a list of patterns.
 *
 * @param toolOrToolName The tool object or the name of the tool being invoked.
 * @param invocation The invocation object for the tool or the command invoked.
 * @param patterns A list of patterns to match against.
 *   Patterns can be:
 *   - A tool name (e.g., "ReadFileTool") to match any invocation of that tool.
 *   - A tool name with a prefix (e.g., "ShellTool(git status)") to match
 *     invocations where the arguments start with that prefix.
 * @returns True if the invocation matches any pattern, false otherwise.
 */
export function doesToolInvocationMatch(
  toolOrToolName: AnyDeclarativeTool | string,
  invocation: AnyToolInvocation | string,
  patterns: string[],
): boolean {
  let toolNames: string[];
  if (isTool(toolOrToolName)) {
    toolNames = [toolOrToolName.name, toolOrToolName.constructor.name];
  } else {
    toolNames = [toolOrToolName];
  }

  if (toolNames.some((name) => SHELL_TOOL_NAMES.includes(name))) {
    toolNames = [...new Set([...toolNames, ...SHELL_TOOL_NAMES])];
  }

  // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
  for (const pattern of patterns) {
    const openParen = pattern.indexOf('(');

    if (openParen === -1) {
      // No arguments, just a tool name
      if (toolNames.includes(pattern)) {
        return true;
      }
      continue;
    }

    const patternToolName = pattern.substring(0, openParen);
    if (!toolNames.includes(patternToolName)) {
      continue;
    }

    if (!pattern.endsWith(')')) {
      continue;
    }

    const argPattern = pattern.substring(openParen + 1, pattern.length - 1);

    let command: string;
    if (typeof invocation === 'string') {
      command = invocation;
    } else {
      if (!('command' in invocation.params)) {
        // This invocation has no command - nothing to check.
        continue;
      }
      command = String((invocation.params as { command: string }).command);
    }

    if (
      toolNames.some((name) => SHELL_TOOL_NAMES.includes(name)) &&
      (command === argPattern || command.startsWith(argPattern + ' '))
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if a shell tool invocation is allowlisted based on shell-specific semantics.
 * This function handles chained commands (e.g., "echo foo && ls -l") by ensuring
 * ALL segments of the chained command are allowlisted.
 *
 * @param invocation The tool invocation containing the command to check.
 * @param allowedPatterns A list of patterns that represent allowed tools/commands.
 * @returns True if the invocation is allowlisted, false otherwise.
 */
export function isShellInvocationAllowlisted(
  invocation: AnyToolInvocation,
  allowedPatterns: string[],
): boolean {
  if (allowedPatterns.length === 0) {
    return false;
  }

  const hasShellWildcard = allowedPatterns.some((pattern) =>
    SHELL_TOOL_NAMES.includes(pattern),
  );
  const hasShellSpecificPattern = allowedPatterns.some((pattern) =>
    SHELL_TOOL_NAMES.some((name) => pattern.startsWith(`${name}(`)),
  );

  if (!hasShellWildcard && !hasShellSpecificPattern) {
    return false;
  }

  if (hasShellWildcard) {
    return true;
  }

  const params = invocation.params as unknown;
  if (typeof params !== 'object' || params === null || !('command' in params)) {
    return false;
  }

  const commandValue = (params as { command?: unknown }).command;

  if (typeof commandValue !== 'string' || !commandValue.trim()) {
    return false;
  }

  const command = commandValue.trim();

  const normalize = (cmd: string): string => cmd.trim().replace(/\s+/g, ' ');
  const commandsToValidate = splitCommands(command)
    .map(normalize)
    .filter(Boolean);

  if (commandsToValidate.length === 0) {
    return false;
  }

  return commandsToValidate.every((commandSegment) =>
    doesToolInvocationMatch(
      SHELL_TOOL_NAMES[0],
      { params: { command: commandSegment } } as AnyToolInvocation,
      allowedPatterns,
    ),
  );
}

/**
 * Build a friendly suggestion message when a tool can't be found.
 * Uses Levenshtein distance to find similar tool names.
 *
 * @param unknownToolName The name of the tool that couldn't be found
 * @param allToolNames Array of all available tool names
 * @param topN Number of suggestions to return (default: 3)
 * @returns A suggestion message, or empty string if no suggestions
 */
export function getToolSuggestion(
  unknownToolName: string,
  allToolNames: string[],
  topN = 3,
): string {
  if (allToolNames.length === 0) {
    return '';
  }

  const matches = allToolNames
    .map((toolName) => ({
      name: toolName,
      distance: levenshtein.get(unknownToolName, toolName),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, topN);

  if (matches.length === 0 || matches[0].distance === Infinity) {
    return '';
  }

  const suggestedNames = matches.map((match) => `"${match.name}"`).join(', ');
  return matches.length > 1
    ? ` Did you mean one of: ${suggestedNames}?`
    : ` Did you mean ${suggestedNames}?`;
}
