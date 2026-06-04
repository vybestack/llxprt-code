/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AnyToolInvocation } from '../index.js';
import type { Config } from '../config/config.js';
import { normalizeShellReplacement } from '../config/config.js';
import os from 'node:os';
import { quote } from 'shell-quote';
import { doesToolInvocationMatch } from './tool-utils.js';
import {
  isParserAvailable,
  parseShellCommand,
  extractCommandNames,
  hasCommandSubstitution as treeSitterHasCommandSubstitution,
  splitCommandsWithTree,
  parseCommandDetails,
} from './shell-parser.js';
import { debugLogger } from './debugLogger.js';

export const SHELL_TOOL_NAMES = ['run_shell_command', 'ShellTool'];

/**
 * An identifier for the shell type.
 */
export type ShellType = 'cmd' | 'powershell' | 'bash';

/**
 * Defines the configuration required to execute a command string within a specific shell.
 */
export interface ShellConfiguration {
  /** The path or name of the shell executable (e.g., 'bash', 'cmd.exe'). */
  executable: string;
  /**
   * The arguments required by the shell to execute a subsequent string argument.
   */
  argsPrefix: string[];
  /** An identifier for the shell type. */
  shell: ShellType;
}

/**
 * Determines the appropriate shell configuration for the current platform.
 *
 * This ensures we can execute command strings predictably and securely across platforms
 * using the `spawn(executable, [...argsPrefix, commandString], { shell: false })` pattern.
 *
 * @returns The ShellConfiguration for the current environment.
 */
export function getShellConfiguration(): ShellConfiguration {
  if (isWindows()) {
    const comSpec = process.env['ComSpec'];
    if (comSpec) {
      const executable = comSpec.toLowerCase();
      if (
        executable.endsWith('powershell.exe') ||
        executable.endsWith('pwsh.exe')
      ) {
        return {
          executable: comSpec,
          argsPrefix: ['-NoProfile', '-Command'],
          shell: 'powershell',
        };
      }
    }

    // Default to PowerShell for all other Windows configurations.
    return {
      executable: 'powershell.exe',
      argsPrefix: ['-NoProfile', '-Command'],
      shell: 'powershell',
    };
  }

  // Unix-like systems (Linux, macOS)
  return { executable: 'bash', argsPrefix: ['-c'], shell: 'bash' };
}

/**
 * Export the platform detection constant for use in process management (e.g., killing processes).
 */
export const isWindows = () => os.platform() === 'win32';

/**
 * Escapes a string so that it can be safely used as a single argument
 * in a shell command, preventing command injection.
 *
 * @param arg The argument string to escape.
 * @param shell The type of shell the argument is for.
 * @returns The shell-escaped string.
 */
export function escapeShellArg(arg: string, shell: ShellType): string {
  if (!arg) {
    return '';
  }

  switch (shell) {
    case 'powershell':
      // For PowerShell, wrap in single quotes and escape internal single quotes by doubling them.
      return `'${arg.replace(/'/g, "''")}'`;
    case 'cmd':
      // Simple Windows escaping for cmd.exe: wrap in double quotes and escape inner double quotes.
      return `"${arg.replace(/"/g, '""')}"`;
    case 'bash':
    default:
      // POSIX shell escaping using shell-quote.
      return quote([arg]);
  }
}

/**
 * Options for splitCommands function.
 */
export interface SplitCommandsOptions {
  /**
   * Whether to split on pipe operators (|).
   * Default: true (split pipes for security checks).
   * Set to false for command instrumentation where pipelines should stay intact.
   */
  splitOnPipes?: boolean;
}

/**
 * Split a command string into individual commands respecting shell syntax.
 * Handles &&, ||, ;, and properly ignores these inside quotes.
 * Uses tree-sitter for accurate parsing when available.
 * @param command The shell command string to parse
 * @param options Optional settings for split behavior
 * @returns An array of individual command strings
 */
export function splitCommands(
  command: string,
  options?: SplitCommandsOptions,
): string[] {
  const splitOnPipes = options?.splitOnPipes ?? true;

  // Try tree-sitter first for accurate parsing
  if (isParserAvailable()) {
    const tree = parseShellCommand(command);
    if (tree) {
      const result = splitCommandsWithTree(tree, { splitOnPipes });
      if (result.length > 0) {
        return result;
      }
    }
  }

  // Fall back to regex-based parsing
  return splitCommandsRegex(command, { splitOnPipes });
}

type SplitState = {
  commands: string[];
  currentCommand: string;
  inSingleQuotes: boolean;
  inDoubleQuotes: boolean;
};

function handleDoubleOperator(
  char: string,
  nextChar: string,
  state: SplitState,
): boolean {
  if (
    (char === '&' && nextChar === '&') ||
    (char === '|' && nextChar === '|')
  ) {
    state.commands.push(state.currentCommand.trim());
    state.currentCommand = '';
    return true;
  }
  return false;
}

function handleSingleOperator(
  char: string,
  nextChar: string,
  state: SplitState,
  splitOnPipes: boolean,
): void {
  if (char === ';') {
    state.commands.push(state.currentCommand.trim());
    state.currentCommand = '';
  } else if (char === '&') {
    const prevChar = state.currentCommand[state.currentCommand.length - 1];
    if (prevChar === '>' || nextChar === '>') {
      state.currentCommand += char;
    } else {
      state.commands.push(state.currentCommand.trim());
      state.currentCommand = '';
    }
  } else if (char === '|') {
    if (splitOnPipes) {
      state.commands.push(state.currentCommand.trim());
      state.currentCommand = '';
    } else {
      state.currentCommand += char;
    }
  } else {
    state.currentCommand += char;
  }
}

/**
 * Regex-based fallback for splitting shell commands.
 * Used when tree-sitter is not available.
 */
function splitCommandsRegex(
  command: string,
  options?: SplitCommandsOptions,
): string[] {
  const splitOnPipes = options?.splitOnPipes ?? true;
  const state: SplitState = {
    commands: [],
    currentCommand: '',
    inSingleQuotes: false,
    inDoubleQuotes: false,
  };
  let i = 0;

  while (i < command.length) {
    const char = command[i];
    const nextChar = command[i + 1];

    if (char === '\\' && i < command.length - 1) {
      state.currentCommand += char + command[i + 1];
      i += 2;
      continue;
    }

    if (char === "'" && !state.inDoubleQuotes) {
      state.inSingleQuotes = !state.inSingleQuotes;
    } else if (char === '"' && !state.inSingleQuotes) {
      state.inDoubleQuotes = !state.inDoubleQuotes;
    }

    if (!state.inSingleQuotes && !state.inDoubleQuotes) {
      if (handleDoubleOperator(char, nextChar, state)) {
        i++; // Skip the next character
      } else {
        handleSingleOperator(char, nextChar, state, splitOnPipes);
      }
    } else {
      state.currentCommand += char;
    }
    i++;
  }

  if (state.currentCommand.trim()) {
    state.commands.push(state.currentCommand.trim());
  }

  return state.commands.filter(Boolean);
}

/**
 * Extracts the root command from a given shell command string.
 * This is used to identify the base command for permission checks.
 * @param command The shell command string to parse
 * @returns The root command name, or undefined if it cannot be determined
 * @example getCommandRoot("ls -la /tmp") returns "ls"
 * @example getCommandRoot("git status && npm test") returns "git"
 */
export function getCommandRoot(command: string): string | undefined {
  const trimmedCommand = command.trim();
  if (!trimmedCommand) {
    return undefined;
  }

  // This regex is designed to find the first "word" of a command,
  // while respecting quotes. It looks for a sequence of non-whitespace
  // characters that are not inside quotes.
  // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
  const match = trimmedCommand.match(/^"([^"]+)"|^'([^']+)'|^(\S+)/);
  if (match) {
    // The first element in the match array is the full match.
    // The subsequent elements are the capture groups.
    // We prefer a captured group because it will be unquoted.
    const commandRoot = match[1] || match[2] || match[3];
    if (commandRoot) {
      // If the command is a path, return the last component.
      return commandRoot.split(/[\\/]/).pop();
    }
  }

  return undefined;
}

export function getCommandRoots(command: string): string[] {
  if (!command) {
    return [];
  }

  // Try tree-sitter first for accurate parsing
  if (isParserAvailable()) {
    const tree = parseShellCommand(command);
    if (tree) {
      const result = extractCommandNames(tree);
      if (result.length > 0) {
        return result;
      }
    }
  }

  // Fall back to regex-based parsing
  return splitCommands(command)
    .map((c) => getCommandRoot(c))
    .filter((c): c is string => !!c);
}

export function stripShellWrapper(command: string): string {
  const pattern =
    // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
    /^\s*(?:(?:sh|bash|zsh)\s+-c|cmd\.exe\s+\/c|powershell(?:\.exe)?\s+(?:-NoProfile\s+)?-Command|pwsh(?:\.exe)?\s+(?:-NoProfile\s+)?-Command)\s+/i;
  const match = command.match(pattern);
  if (match) {
    let newCommand = command.substring(match[0].length).trim();
    if (
      (newCommand.startsWith('"') && newCommand.endsWith('"')) ||
      (newCommand.startsWith("'") && newCommand.endsWith("'"))
    ) {
      newCommand = newCommand.substring(1, newCommand.length - 1);
    }
    return newCommand;
  }
  return command.trim();
}

/**
 * Detects command substitution patterns in a shell command, following bash quoting rules:
 * - Single quotes ('): Everything literal, no substitution possible
 * - Double quotes ("): Command substitution with $() and backticks unless escaped with \
 * - No quotes: Command substitution with $(), <(), and backticks
 * Uses tree-sitter for accurate parsing when available, falls back to regex.
 * @param command The shell command string to check
 * @returns true if command substitution would be executed by bash
 */
export function detectCommandSubstitution(command: string): boolean {
  // Try tree-sitter first for accurate parsing
  if (isParserAvailable()) {
    const tree = parseShellCommand(command);
    if (tree) {
      return treeSitterHasCommandSubstitution(tree);
    }
  }

  // Fall back to regex-based detection
  return detectCommandSubstitutionRegex(command);
}

/**
 * Regex-based fallback for detecting command substitution.
 * Used when tree-sitter is not available.
 */
function detectCommandSubstitutionRegex(command: string): boolean {
  let inSingleQuotes = false;
  let inDoubleQuotes = false;
  let inBackticks = false;
  let i = 0;

  while (i < command.length) {
    const char = command[i];
    const nextChar = command[i + 1];

    // Handle escaping - only works outside single quotes
    if (char === '\\' && !inSingleQuotes) {
      i += 2; // Skip the escaped character
      continue;
    }

    // Handle quote state changes
    if (char === "'" && !inDoubleQuotes && !inBackticks) {
      inSingleQuotes = !inSingleQuotes;
    } else if (char === '"' && !inSingleQuotes && !inBackticks) {
      inDoubleQuotes = !inDoubleQuotes;
    } else if (char === '`' && !inSingleQuotes) {
      // Backticks work outside single quotes (including in double quotes)
      inBackticks = !inBackticks;
    }

    // Check for command substitution patterns that would be executed
    if (!inSingleQuotes) {
      // $(...) command substitution - works in double quotes and unquoted
      if (char === '$' && nextChar === '(') {
        return true;
      }

      // <(...) process substitution - works unquoted only (not in double quotes)
      if (char === '<' && nextChar === '(' && !inDoubleQuotes && !inBackticks) {
        return true;
      }

      // >(...) process substitution - works unquoted only (not in double quotes)
      if (char === '>' && nextChar === '(' && !inDoubleQuotes && !inBackticks) {
        return true;
      }

      // Backtick command substitution - check for opening backtick
      // (We track the state above, so this catches the start of backtick substitution)
      if (char === '`' && !inBackticks) {
        return true;
      }
    }

    i++;
  }

  return false;
}

/**
 * Detects whether a shell command contains shell redirection operators
 * (>, >>, <, <<, <<<, fd forms such as 2>, &>, >&), respecting shell quoting rules.
 * Pipe operators (|) are NOT treated as redirection.
 * Single-quoted content is treated as fully literal.
 * @param command The shell command string to check
 * @returns true if the command contains redirection operators outside quotes
 */
export function hasRedirection(command: string): boolean {
  let inSingleQuotes = false;
  let inDoubleQuotes = false;
  let i = 0;

  while (i < command.length) {
    const char = command[i];

    // Handle escaping outside single quotes
    if (char === '\\' && !inSingleQuotes && i < command.length - 1) {
      i += 2;
      continue;
    }

    if (char === "'" && !inDoubleQuotes) {
      inSingleQuotes = !inSingleQuotes;
    } else if (char === '"' && !inSingleQuotes) {
      inDoubleQuotes = !inDoubleQuotes;
    }

    // Redirection: >, >>, <, <<, <<<, 2>, &>, >&
    if (!inSingleQuotes && !inDoubleQuotes && (char === '>' || char === '<')) {
      return true;
    }

    i++;
  }

  return false;
}

type PermissionCheckResult = {
  allAllowed: boolean;
  disallowedCommands: string[];
  blockReason?: string;
  isHardDenial?: boolean;
};

function resolveShellReplacementMode(
  config: Config,
): 'allowlist' | 'all' | 'none' {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Shell permission test doubles may omit ephemeral settings support.
  const ephemeralValue = config.getEphemeralSetting?.('shell-replacement') as
    | 'allowlist'
    | 'all'
    | 'none'
    | boolean
    | undefined;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Shell permission test doubles may omit static shell replacement support.
  const configValue = config.getShellReplacement?.();
  return normalizeShellReplacement(
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Shell permission config may omit both ephemeral and static replacement settings.
    ephemeralValue ?? configValue ?? 'allowlist',
  );
}

function checkShellReplacementBlock(
  command: string,
  shellReplacementMode: 'allowlist' | 'all' | 'none',
): PermissionCheckResult | null {
  if (shellReplacementMode === 'none' && detectCommandSubstitution(command)) {
    return {
      allAllowed: false,
      disallowedCommands: [command],
      blockReason:
        'Command substitution using $(), `` ` ``, <(), or >() is not allowed for security reasons',
      isHardDenial: true,
    };
  }
  return null;
}

function extractCommandsToValidate(
  command: string,
  shellReplacementMode: 'allowlist' | 'all' | 'none',
): string[] | PermissionCheckResult {
  const normalize = (cmd: string): string => cmd.trim().replace(/\s+/g, ' ');

  if (shellReplacementMode === 'allowlist') {
    const parseResult = parseCommandDetails(command);
    if (
      parseResult &&
      parseResult.hasError !== true &&
      parseResult.details.length > 0
    ) {
      return parseResult.details
        .map((detail) => normalize(detail.text))
        .filter(Boolean);
    }
    if (parseResult?.hasError === true) {
      return {
        allAllowed: false,
        disallowedCommands: [command],
        blockReason: 'Command rejected because it could not be parsed safely',
        isHardDenial: true,
      };
    }
    return splitCommands(command).map(normalize);
  }
  return splitCommands(command).map(normalize);
}

function checkBlocklist(
  commandsToValidate: string[],
  config: Config,
): PermissionCheckResult | null {
  const excludeTools = config.getExcludeTools() ?? [];
  const isWildcardBlocked = SHELL_TOOL_NAMES.some((name) =>
    excludeTools.includes(name),
  );

  if (isWildcardBlocked) {
    return {
      allAllowed: false,
      disallowedCommands: commandsToValidate,
      blockReason: 'Shell tool is globally disabled in configuration',
      isHardDenial: true,
    };
  }

  const invocation: AnyToolInvocation & { params: { command: string } } = {
    params: { command: '' },
  } as AnyToolInvocation & { params: { command: string } };

  for (const cmd of commandsToValidate) {
    invocation.params['command'] = cmd;
    if (
      doesToolInvocationMatch('run_shell_command', invocation, excludeTools)
    ) {
      return {
        allAllowed: false,
        disallowedCommands: [cmd],
        blockReason: `Command '${cmd}' is blocked by configuration`,
        isHardDenial: true,
      };
    }
  }
  return null;
}

function checkSessionAllowlistMode(
  commandsToValidate: string[],
  sessionAllowlist: Set<string>,
  coreTools: string[],
): PermissionCheckResult | null {
  const invocation: AnyToolInvocation & { params: { command: string } } = {
    params: { command: '' },
  } as AnyToolInvocation & { params: { command: string } };

  const normalizedSessionAllowlist = new Set(
    [...sessionAllowlist].flatMap((cmd) =>
      SHELL_TOOL_NAMES.map((name) => `${name}(${cmd})`),
    ),
  );

  const disallowedCommands: string[] = [];

  // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
  for (const cmd of commandsToValidate) {
    invocation.params['command'] = cmd;
    const isSessionAllowed = doesToolInvocationMatch(
      'run_shell_command',
      invocation,
      [...normalizedSessionAllowlist],
    );
    if (isSessionAllowed) continue;

    const isGloballyAllowed = doesToolInvocationMatch(
      'run_shell_command',
      invocation,
      coreTools,
    );
    if (isGloballyAllowed) continue;

    disallowedCommands.push(cmd);
  }

  if (disallowedCommands.length > 0) {
    return {
      allAllowed: false,
      disallowedCommands,
      blockReason: `Command(s) not on the global or session allowlist. Disallowed commands: ${disallowedCommands
        .map((c) => JSON.stringify(c))
        .join(', ')}`,
      isHardDenial: false,
    };
  }
  return null;
}

function checkDefaultAllowMode(
  commandsToValidate: string[],
  coreTools: string[],
): PermissionCheckResult | null {
  const hasSpecificAllowedCommands =
    coreTools.filter((tool) =>
      SHELL_TOOL_NAMES.some((name) => tool.startsWith(`${name}(`)),
    ).length > 0;

  if (!hasSpecificAllowedCommands) return null;

  const invocation: AnyToolInvocation & { params: { command: string } } = {
    params: { command: '' },
  } as AnyToolInvocation & { params: { command: string } };

  const disallowedCommands: string[] = [];
  for (const cmd of commandsToValidate) {
    invocation.params['command'] = cmd;
    const isGloballyAllowed = doesToolInvocationMatch(
      'run_shell_command',
      invocation,
      coreTools,
    );
    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    if (!isGloballyAllowed) {
      disallowedCommands.push(cmd);
    }
  }
  if (disallowedCommands.length > 0) {
    return {
      allAllowed: false,
      disallowedCommands,
      blockReason: `Command(s) not in the allowed commands list. Disallowed commands: ${disallowedCommands
        .map((c) => JSON.stringify(c))
        .join(', ')}`,
      isHardDenial: false,
    };
  }
  return null;
}

/**
 * Checks a shell command against security policies and allowlists.
 *
 * This function operates in one of two modes depending on the presence of
 * the `sessionAllowlist` parameter:
 *
 * 1.  **"Default Deny" Mode (sessionAllowlist is provided):** This is the
 *     strictest mode, used for user-defined scripts like custom commands.
 *     A command is only permitted if it is found on the global `coreTools`
 *     allowlist OR the provided `sessionAllowlist`. It must not be on the
 *     global `excludeTools` blocklist.
 *
 * 2.  **"Default Allow" Mode (sessionAllowlist is NOT provided):** This mode
 *     is used for direct tool invocations (e.g., by the model). If a strict
 *     global `coreTools` allowlist exists, commands must be on it. Otherwise,
 *     any command is permitted as long as it is not on the `excludeTools`
 *     blocklist.
 *
 * @param command The shell command string to validate.
 * @param config The application configuration.
 * @param sessionAllowlist A session-level list of approved commands. Its
 *   presence activates "Default Deny" mode.
 * @returns An object detailing which commands are not allowed.
 */
export function checkCommandPermissions(
  command: string,
  config: Config,
  sessionAllowlist?: Set<string>,
): PermissionCheckResult {
  const shellReplacementMode = resolveShellReplacementMode(config);

  // Debug logging when VERBOSE is set
  if (process.env.VERBOSE === 'true') {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Shell permission test doubles may omit ephemeral settings support.
    const ephemeralValue = config.getEphemeralSetting?.('shell-replacement');
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Shell permission test doubles may omit static shell replacement support.
    const configValue = config.getShellReplacement?.();
    debugLogger.log('[SHELL-UTILS] Shell replacement check:', {
      ephemeralValue,
      configValue,
      shellReplacementMode,
      command: command.substring(0, 50) + (command.length > 50 ? '...' : ''),
    });
  }

  const replacementBlock = checkShellReplacementBlock(
    command,
    shellReplacementMode,
  );
  if (replacementBlock) return replacementBlock;

  const commandsOrError = extractCommandsToValidate(
    command,
    shellReplacementMode,
  );
  if (!Array.isArray(commandsOrError)) return commandsOrError;
  const commandsToValidate = commandsOrError;

  const blocklistResult = checkBlocklist(commandsToValidate, config);
  if (blocklistResult) return blocklistResult;

  const coreTools = config.getCoreTools() ?? [];
  const isWildcardAllowed = SHELL_TOOL_NAMES.some((name) =>
    coreTools.includes(name),
  );
  if (isWildcardAllowed) {
    return { allAllowed: true, disallowedCommands: [] };
  }

  if (sessionAllowlist) {
    const sessionResult = checkSessionAllowlistMode(
      commandsToValidate,
      sessionAllowlist,
      coreTools,
    );
    if (sessionResult) return sessionResult;
  } else {
    const defaultResult = checkDefaultAllowMode(commandsToValidate, coreTools);
    if (defaultResult) return defaultResult;
  }

  return { allAllowed: true, disallowedCommands: [] };
}

/**
 * Determines whether a given shell command is allowed to execute based on
 * the tool's configuration including allowlists and blocklists.
 *
 * This function operates in "default allow" mode. It is a wrapper around
 * `checkCommandPermissions`.
 *
 * @param command The shell command string to validate.
 * @param config The application configuration.
 * @returns An object with 'allowed' boolean and optional 'reason' string if not allowed.
 */
export function isCommandAllowed(
  command: string,
  config: Config,
): { allowed: boolean; reason?: string } {
  // By not providing a sessionAllowlist, we invoke "default allow" behavior.
  const { allAllowed, blockReason } = checkCommandPermissions(command, config);
  if (allAllowed) {
    return { allowed: true };
  }
  return { allowed: false, reason: blockReason };
}
