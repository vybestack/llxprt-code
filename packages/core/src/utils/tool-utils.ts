/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import levenshtein from 'fast-levenshtein';
import type { AnyDeclarativeTool, AnyToolInvocation } from '../index.js';
import { isTool } from '../index.js';
import {
  SHELL_TOOL_NAMES,
  splitCommands,
  shellTypeToParserLanguage,
  type ShellType,
} from './shell-utils.js';
import {
  parseCommandDetailsForLanguage,
  isParserAvailable,
} from './shell-parser.js';
import type { ParserLanguage } from './shell-parser.js';

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
  caseInsensitive = false,
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

  for (const pattern of patterns) {
    if (matchesToolPattern(pattern, toolNames, invocation, caseInsensitive)) {
      return true;
    }
  }

  return false;
}

function matchesToolPattern(
  pattern: string,
  toolNames: string[],
  invocation: AnyToolInvocation | string,
  caseInsensitive = false,
): boolean {
  const openParen = pattern.indexOf('(');

  if (openParen === -1) {
    return toolNames.includes(pattern);
  }

  const patternToolName = pattern.substring(0, openParen);
  if (!toolNames.includes(patternToolName) || !pattern.endsWith(')')) {
    return false;
  }

  const argPattern = pattern.substring(openParen + 1, pattern.length - 1);

  let command: string;
  if (typeof invocation === 'string') {
    command = invocation;
  } else {
    if (!('command' in invocation.params)) {
      return false;
    }
    const commandValue = (invocation.params as { command?: unknown }).command;
    if (typeof commandValue !== 'string') {
      return false;
    }
    command = commandValue;
  }

  // PowerShell command resolution is case-insensitive; Bash is case-sensitive.
  // Normalize both sides for comparison without mutating the original values.
  const compareCommand = caseInsensitive ? command.toLowerCase() : command;
  const compareArgPattern = caseInsensitive
    ? argPattern.toLowerCase()
    : argPattern;

  return (
    toolNames.some((name) => SHELL_TOOL_NAMES.includes(name)) &&
    (compareCommand === compareArgPattern ||
      compareCommand.startsWith(compareArgPattern + ' '))
  );
}

/**
 * Checks if a shell tool invocation is allowlisted based on shell-specific semantics.
 * This function handles chained commands (e.g., "echo foo && ls -l") by ensuring
 * ALL segments of the chained command are allowlisted.
 *
 * When `shellType` is provided, uses shell-aware recursive structured detail
 * parsing so that nested commands inside script blocks, pipelines, subshells,
 * and wrapper payloads are all validated (Finding 5, #3181).
 *
 * @param invocation The tool invocation containing the command to check.
 * @param allowedPatterns A list of patterns that represent allowed tools/commands.
 * @param shellType The execution shell type; defaults to Bash when omitted.
 * @returns True if the invocation is allowlisted, false otherwise.
 */
export function isShellInvocationAllowlisted(
  invocation: AnyToolInvocation,
  allowedPatterns: string[],
  shellType?: ShellType,
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

  // AnyToolInvocation.params is an intentionally shape-less `object` boundary, so
  // widen to unknown before structural checks.
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
  const language: ParserLanguage = shellTypeToParserLanguage(shellType);

  const commandsToValidate = resolveAllowlistCommands(
    command,
    language,
    normalize,
  );

  if (commandsToValidate.length === 0) {
    return false;
  }

  // PowerShell command resolution is case-insensitive; Bash is case-sensitive.
  const caseInsensitive = language === 'powershell';

  return commandsToValidate.every((commandSegment) =>
    doesToolInvocationMatch(
      SHELL_TOOL_NAMES[0],
      { params: { command: commandSegment } } as AnyToolInvocation,
      allowedPatterns,
      caseInsensitive,
    ),
  );
}

/**
 * Resolve the list of command texts to validate against the allowlist.
 *
 * For shells with a matching parser (Bash, PowerShell under Bun), use the
 * recursive structured detail extraction so nested commands, script blocks,
 * pipelines, and wrapper payloads are all enumerated. Each detail's
 * canonicalText (or text fallback) is normalized for pattern matching.
 *
 * For Bash without a parser, fall back to `splitCommands`.
 * For PowerShell without a parser, fail closed (return an empty array,
 * which matches no specific allowlist pattern).
 */
function resolveAllowlistCommands(
  command: string,
  language: ParserLanguage,
  normalize: (cmd: string) => string,
): string[] {
  if (isParserAvailable(language)) {
    const parseResult = parseCommandDetailsForLanguage(command, language);

    if (parseResult?.hasError === false && parseResult.details.length > 0) {
      return parseResult.details
        .map((detail) => normalize(detail.canonicalText ?? detail.text))
        .filter(Boolean);
    }

    // Parse error: fail closed by returning an empty array, which will not
    // match any specific allowlist pattern.
    if (parseResult?.hasError === true) {
      return [];
    }
  }

  // PowerShell parser unavailable: fail closed.
  if (language === 'powershell') {
    return [];
  }

  // Bash fallback: split using regex.
  return splitCommands(command).map(normalize).filter(Boolean);
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
