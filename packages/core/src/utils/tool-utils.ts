/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
    toolNames = [toolOrToolName as string];
  }

  if (toolNames.some((name) => SHELL_TOOL_NAMES.includes(name))) {
    toolNames = [...new Set([...toolNames, ...SHELL_TOOL_NAMES])];
  }

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

    if (toolNames.some((name) => SHELL_TOOL_NAMES.includes(name))) {
      if (command === argPattern || command.startsWith(argPattern + ' ')) {
        return true;
      }
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
  if (!allowedPatterns.length) {
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

  if (
    !('params' in invocation) ||
    typeof invocation.params !== 'object' ||
    invocation.params === null ||
    !('command' in invocation.params)
  ) {
    return false;
  }

  const commandValue = (invocation.params as { command?: unknown }).command;
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
