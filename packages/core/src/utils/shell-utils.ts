/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shell command security validation and parsing.
 *
 * **Layered validation architecture:**
 *
 * 1. `checkCommandPermissions` is the main entry point. It resolves the
 *    shell-replacement mode (`none` | `allowlist` | `all`) and dispatches:
 *    - **`none`**: Any command substitution (`$()`, ``, `<()`, `>()`) triggers
 *      an immediate hard denial.
 *    - **`allowlist`** (default): Uses tree-sitter to extract ALL nested commands
 *      (including inside substitutions), then validates each against the
 *      allowlist. A tree-sitter parse failure is treated as a hard denial —
 *      malformed commands are never allowed through.
 *    - **`all`**: Substitution is permitted; validation falls through to the
 *      blocklist / allowlist checks below.
 * 2. Blocklist check — rejects commands on `excludeTools`.
 * 3. Allowlist matching — checks each command segment against `coreTools` /
 *    `sessionAllowlist` using `doesToolInvocationMatch`.
 *
 * Tree-sitter (`shell-parser.ts`) is the primary parser. The regex-based
 * functions in this file are best-effort fallbacks used only when the
 * tree-sitter WASM bundle failed to load at startup. Because those fallbacks
 * cannot model multiline or heredoc semantics, `none` and `allowlist` modes
 * fail closed for line breaks and heredoc operators while the parser is
 * unavailable.
 */

import type { AnyToolInvocation } from '../index.js';
import type { ShellReplacementMode } from '../config/configTypes.js';
import { normalizeShellReplacement } from '../config/config.js';
import { quote } from 'shell-quote';
import { isWindows } from './runtime.js';
import { doesToolInvocationMatch } from './tool-utils.js';
import {
  isParserAvailable,
  extractCommandNamesForLanguage,
  hasCommandSubstitutionForLanguage,
  splitCommandsWithTreeForLanguage,
  parseCommandDetailsForLanguage,
  hasPromptCommandTransform,
} from './shell-parser.js';
import { withParsedTreeForLanguage } from './shell-parser-lifetime.js';
import type { ParserLanguage, ParsedCommandDetail } from './shell-parser.js';
import { debugLogger } from './debugLogger.js';

export const SHELL_TOOL_NAMES = ['run_shell_command', 'ShellTool'];

/**
 * An identifier for the shell type.
 */
export type ShellType = 'cmd' | 'powershell' | 'bash';

/**
 * Map an execution {@link ShellType} to the corresponding parser grammar
 * language.  Only `powershell` maps to the PowerShell grammar; `cmd` maps
 * to `bash` (the default) because cmd.exe syntax is not PowerShell and no
 * dedicated cmd grammar exists — using Bash is the same as the pre-#3181
 * behavior and does not make a false claim about the language.
 */
export function shellTypeToParserLanguage(
  shellType?: ShellType,
): ParserLanguage {
  if (shellType === 'powershell') {
    return 'powershell';
  }
  return 'bash';
}

/**
 * Resolve the execution shell type, using the platform shell configuration
 * when no override is provided.
 */
function resolveShellType(shellType?: ShellType): ShellType {
  return shellType ?? getShellConfiguration().shell;
}

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
   *
   * Originally added for now-removed command instrumentation (PR #1546);
   * retained because it is zero-cost, tested, and useful for future
   * pipeline-aware display. Security validation always uses the default
   * (true) so every pipeline stage is validated individually.
   */
  splitOnPipes?: boolean;
}

/**
 * Split a command string into individual commands respecting shell syntax.
 * Handles &&, ||, ;, and properly ignores these inside quotes.
 * Uses tree-sitter for accurate parsing when available.
 * @param command The shell command string to parse
 * @param options Optional settings for split behavior
 * @param shellType Optional shell type override; defaults to bash grammar
 * @returns An array of individual command strings
 * @plan PLAN-20260825-SHELLMEM.P02
 * @requirement REQ-3329-08
 */
export function splitCommands(
  command: string,
  options?: SplitCommandsOptions,
  shellType?: ShellType,
): string[] {
  const splitOnPipes = options?.splitOnPipes ?? true;
  const language = shellTypeToParserLanguage(shellType);

  // Try tree-sitter first for accurate parsing
  if (isParserAvailable(language)) {
    const result = withParsedTreeForLanguage(command, language, (tree) =>
      splitCommandsWithTreeForLanguage(tree, language, { splitOnPipes }),
    );
    if (result !== null && result.length > 0) {
      return result;
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
 *
 * Known limitations (mitigated because allowlist mode hard-denies on
 * tree-sitter parse failure and tree-sitter is bundled):
 * - Backtick quoting state is not tracked (backticks not used as delimiters)
 * - `$()` / `$(())` nesting is not tracked
 * - Process substitution `<()`, `>()` is not tracked
 * - The `&` redirection heuristic (prevChar/nextChar `>`) is fragile
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
 * Extracts the first command token from a trimmed command string, respecting
 * double quotes, single quotes, and bare tokens. Returns the unquoted content
 * or undefined if no token is found.
 */
function extractFirstCommandToken(cmd: string): string | undefined {
  if (cmd.length === 0) {
    return undefined;
  }
  const first = cmd[0];
  if (first === '"' || first === "'") {
    const closeIdx = cmd.indexOf(first, 1);
    if (closeIdx > 1) {
      return cmd.slice(1, closeIdx);
    }
    return undefined;
  }
  // Bare token: read until first whitespace
  let end = 0;
  while (end < cmd.length && !isWhitespaceChar(cmd[end])) {
    end++;
  }
  if (end === 0) {
    return undefined;
  }
  return cmd.slice(0, end);
}

function isWhitespaceChar(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
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

  const commandRoot = extractFirstCommandToken(trimmedCommand);
  if (commandRoot) {
    // If the command is a path, return the last component.
    return commandRoot.split(/[\\/]/).pop();
  }

  return undefined;
}

/** @plan PLAN-20260825-SHELLMEM.P02 @requirement REQ-3329-08 */
export function getCommandRoots(
  command: string,
  shellType?: ShellType,
): string[] {
  if (!command) {
    return [];
  }

  const language = shellTypeToParserLanguage(shellType);

  // Try tree-sitter first for accurate parsing
  if (isParserAvailable(language)) {
    const parsed = withParsedTreeForLanguage(command, language, (tree) => ({
      hasPromptTransform:
        language === 'bash' && hasPromptCommandTransform(tree.rootNode),
      commandNames: extractCommandNamesForLanguage(tree, language),
    }));
    if (parsed !== null) {
      // Prompt transformations (${var@P}) can execute arbitrary commands, so
      // the command is treated as unsafe and no roots are returned.
      if (parsed.hasPromptTransform) {
        return [];
      }
      if (parsed.commandNames.length > 0) {
        return parsed.commandNames;
      }
      // When the PowerShell parser is available and found no static command
      // names (e.g., a pure .NET expression), do not fall back to regex —
      // a pure expression has no command root and the regex fallback would
      // fabricate one (#3181 OCR Finding 11).
      if (language === 'powershell') {
        return [];
      }
    }
  }

  // Fall back to regex-based parsing
  return splitCommands(command, undefined, shellType)
    .map((c) => getCommandRoot(c))
    .filter((c): c is string => !!c);
}

export function stripShellWrapper(command: string): string {
  const trimmed = command.trim();
  const prefixLength = matchShellWrapperPrefix(trimmed);
  if (prefixLength > 0) {
    let newCommand = trimmed.slice(prefixLength).trim();
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

const SHELL_WRAPPERS = ['sh', 'bash', 'zsh'] as const;

const POWERSHELL_WRAPPERS = ['powershell', 'pwsh'] as const;

/**
 * Checks if a trimmed command starts with a known shell wrapper prefix and
 * returns the length of the prefix (including the wrapper and its flags), or
 * 0 if no wrapper is found.
 */
function matchShellWrapperPrefix(cmd: string): number {
  const lowerCmd = cmd.toLowerCase();

  // Returns the index after the prefix if `cmd` starts with `prefix` followed
  // by whitespace (space, tab, or newline); otherwise -1.
  const startsWithWs = (prefix: string): number => {
    if (!lowerCmd.startsWith(prefix)) {
      return -1;
    }
    const next = cmd[prefix.length];
    return isWhitespaceChar(next) ? prefix.length + 1 : -1;
  };

  // Check for sh/bash/zsh -c
  for (const shell of SHELL_WRAPPERS) {
    const afterShell = startsWithWs(shell);
    if (afterShell === -1) {
      continue;
    }
    const rest = cmd.slice(afterShell).trimStart();
    if (rest.toLowerCase().startsWith('-c') && isWhitespaceChar(rest[2])) {
      return cmd.length - rest.length + 3;
    }
  }

  // Check for cmd.exe /c
  const afterCmd = startsWithWs('cmd.exe');
  if (afterCmd !== -1) {
    const rest = cmd.slice(afterCmd).trimStart();
    if (rest.toLowerCase().startsWith('/c') && isWhitespaceChar(rest[2])) {
      return cmd.length - rest.length + 3;
    }
  }

  // Check for powershell/pwsh [-NoProfile] -Command
  for (const pwsh of POWERSHELL_WRAPPERS) {
    const withExe = pwsh + '.exe';
    let afterExe = startsWithWs(pwsh);
    if (afterExe === -1) {
      afterExe = startsWithWs(withExe);
    }
    if (afterExe === -1) {
      continue;
    }
    let rest = cmd.slice(afterExe).trimStart();
    // Optional -NoProfile
    if (
      rest.toLowerCase().startsWith('-noprofile') &&
      isWhitespaceChar(rest['-noprofile'.length])
    ) {
      rest = rest.slice('-noprofile'.length + 1).trimStart();
    }
    if (
      rest.toLowerCase().startsWith('-command') &&
      isWhitespaceChar(rest['-command'.length])
    ) {
      return cmd.length - rest.length + '-command'.length;
    }
  }

  return 0;
}

/**
 * Detects command substitution patterns in a shell command.
 *
 * **Bash** (default): `$()`, backticks, and `<()`/`>()` process substitution.
 *
 * **PowerShell**: `$()` subexpressions only.  Backticks are escapes, not
 * substitution.  When the PowerShell parser is unavailable, fail closed
 * (return true) because structural substitution detection cannot be trusted.
 * @plan PLAN-20260825-SHELLMEM.P02
 * @requirement REQ-3329-08
 */
export function detectCommandSubstitution(
  command: string,
  shellType?: ShellType,
): boolean {
  const language = shellTypeToParserLanguage(shellType);

  if (isParserAvailable(language)) {
    const parsed = withParsedTreeForLanguage(command, language, (tree) => ({
      detected: hasCommandSubstitutionForLanguage(tree, language),
      hasError: tree.rootNode.hasError,
    }));
    if (parsed !== null) {
      if (language === 'powershell') {
        // Fail closed on parse errors: a malformed tree may have missed
        // $() subexpressions during error recovery. PowerShell backticks
        // are escapes, not substitution — only valid trees are trusted.
        return parsed.detected || parsed.hasError;
      }
      if (parsed.detected || !parsed.hasError) {
        return parsed.detected;
      }
    }
  }

  if (language === 'powershell') {
    // PowerShell parser unavailable: fail closed.
    return true;
  }

  return detectCommandSubstitutionRegex(command);
}

/**
 * Regex-based fallback for detecting command substitution.
 * Used only when tree-sitter WASM failed to load at startup.
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

    // Check for command substitution patterns that would be executed.
    // Detection runs BEFORE state toggles so that an opening backtick is
    // flagged immediately rather than only at the closing tick.
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

      // An opening backtick (outside single quotes, not already inside backticks)
      // begins command substitution — flag immediately.
      if (char === '`' && !inBackticks) {
        return true;
      }
    }

    // Handle quote state changes (after detection so opening backtick is caught)
    if (char === "'" && !inDoubleQuotes && !inBackticks) {
      inSingleQuotes = !inSingleQuotes;
    } else if (char === '"' && !inSingleQuotes && !inBackticks) {
      inDoubleQuotes = !inDoubleQuotes;
    } else if (char === '`' && !inSingleQuotes) {
      // Backticks work outside single quotes (including in double quotes)
      inBackticks = !inBackticks;
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

export interface ShellPermissionConfig {
  getEphemeralSetting(key: string): unknown;
  getShellReplacement(): ShellReplacementMode;
  getExcludeTools(): string[] | undefined;
  getCoreTools(): string[] | undefined;
}

function resolveShellReplacementMode(
  config: ShellPermissionConfig,
): 'allowlist' | 'all' | 'none' {
  const ephemeralValue = config.getEphemeralSetting('shell-replacement') as
    | 'allowlist'
    | 'all'
    | 'none'
    | boolean
    | undefined;
  const configValue = config.getShellReplacement();
  return normalizeShellReplacement(ephemeralValue ?? configValue);
}

function hasHeredocOperator(command: string): boolean {
  let inSingleQuotes = false;
  let inDoubleQuotes = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (char === '\\' && !inSingleQuotes) {
      index += 1;
    } else if (char === "'" && !inDoubleQuotes) {
      inSingleQuotes = !inSingleQuotes;
    } else if (char === '"' && !inSingleQuotes) {
      inDoubleQuotes = !inDoubleQuotes;
    } else if (char === '<' && !inSingleQuotes && !inDoubleQuotes) {
      // Measure the full contiguous run of '<' so that the Bash here-string
      // '<<<' (3+) is not misclassified as a heredoc '<<'. Only an exact
      // two-character run is a heredoc operator (<< or <<-).
      let runLength = 1;
      while (command[index + runLength] === '<') {
        runLength += 1;
      }
      if (runLength === 2) {
        return true;
      }
      // Skip the entire run so no later pair within it is reclassified.
      index += runLength - 1;
    }
  }

  return false;
}

function checkParserUnavailableBlock(
  command: string,
  shellReplacementMode: 'allowlist' | 'all' | 'none',
  language: ParserLanguage,
): PermissionCheckResult | null {
  if (
    shellReplacementMode !== 'all' &&
    !isParserAvailable(language) &&
    (/\r|\n/u.test(command) || hasHeredocOperator(command))
  ) {
    return {
      allAllowed: false,
      disallowedCommands: [command],
      blockReason:
        language === 'powershell'
          ? 'Command rejected because multiline syntax requires the PowerShell shell parser'
          : 'Command rejected because multiline and heredoc syntax requires the shell parser',
      isHardDenial: true,
    };
  }
  return null;
}

function checkShellReplacementBlock(
  command: string,
  shellReplacementMode: 'allowlist' | 'all' | 'none',
  language: ParserLanguage,
): PermissionCheckResult | null {
  if (
    shellReplacementMode === 'none' &&
    detectCommandSubstitution(
      command,
      language === 'powershell' ? 'powershell' : 'bash',
    )
  ) {
    return {
      allAllowed: false,
      disallowedCommands: [command],
      blockReason:
        language === 'powershell'
          ? 'PowerShell command substitution using $() is not allowed for security reasons'
          : 'Command substitution using $(), `` ` ``, <(), or >() is not allowed for security reasons',
      isHardDenial: true,
    };
  }
  return null;
}

function getStrictAllowlistDenial(
  details: readonly ParsedCommandDetail[],
  hasStrictAllowlist: boolean,
  command: string,
): PermissionCheckResult | null {
  if (!hasStrictAllowlist) {
    return null;
  }
  const unresolvable = details.find(
    (d) => d.nameKind === 'dynamic' || d.nameKind === 'expression',
  );
  if (!unresolvable) {
    return null;
  }
  return {
    allAllowed: false,
    disallowedCommands: [command],
    blockReason:
      'Command rejected because it contains a dynamic or ' +
      'expression invocation target that cannot be validated ' +
      'against the allowlist',
    isHardDenial: true,
  };
}

function extractCommandsToValidate(
  command: string,
  shellReplacementMode: 'allowlist' | 'all' | 'none',
  language: ParserLanguage,
  hasStrictAllowlist: boolean,
): string[] | PermissionCheckResult {
  const normalize = (cmd: string): string => cmd.trim().replace(/\s+/g, ' ');

  if (shellReplacementMode === 'allowlist') {
    const parseResult = parseCommandDetailsForLanguage(command, language);

    if (parseResult?.hasError === true) {
      return {
        allAllowed: false,
        disallowedCommands: [command],
        blockReason:
          parseResult.errorReason ??
          'Command rejected because it could not be parsed safely',
        isHardDenial: true,
      };
    }

    if (parseResult) {
      const strictDenial = getStrictAllowlistDenial(
        parseResult.details,
        hasStrictAllowlist,
        command,
      );
      if (strictDenial) {
        return strictDenial;
      }

      const commands = parseResult.details
        .map((detail) => normalize(detail.canonicalText ?? detail.text))
        .filter(Boolean);
      if (commands.length > 0) {
        return commands;
      }
      // All details filtered to empty (e.g., empty targets). Fall through
      // to the normalized command so allowlist checking is not bypassed.

      const normalized = normalize(command);
      if (normalized) {
        return [normalized];
      }

      // Successful parse produced zero details and the command normalizes
      // to empty. Return an empty array rather than falling through to the
      // parser-unavailable diagnostic — the parser WAS available (#3181
      // OCR Finding 6).
      return [];
    }

    // Parser unavailable.
    if (language === 'powershell') {
      return {
        allAllowed: false,
        disallowedCommands: [command],
        blockReason:
          'PowerShell command rejected because the structural parser ' +
          'is unavailable',
        isHardDenial: true,
      };
    }

    // Bash: fall back to regex splitting.
    return splitCommands(command, undefined, language).map(normalize);
  }

  // For 'all' and 'none' modes: use recursive structured details when the
  // parser is available so that blocklisted commands nested inside script
  // blocks, pipelines, and wrapper payloads are caught (Finding 6, #3181).
  // Substitution was already handled by checkShellReplacementBlock for 'none'.
  if (isParserAvailable(language)) {
    const parseResult = parseCommandDetailsForLanguage(command, language);
    if (parseResult?.hasError === false && parseResult.details.length > 0) {
      const commands = parseResult.details
        .map((detail) => normalize(detail.canonicalText ?? detail.text))
        .filter(Boolean);
      if (commands.length > 0) {
        return commands;
      }
      // All details filtered to empty; fall through to shallow splitter so
      // blocklist checking is not bypassed (#3181 review).
    }
  }

  // Parser unavailable or parse error: fall back to shallow splitting for
  // best-effort blocklist checking. For PowerShell without parser, the
  // shallow regex splitter is the only option (substitution already checked).
  return splitCommands(command, undefined, language).map(normalize);
}

function checkBlocklist(
  commandsToValidate: string[],
  config: ShellPermissionConfig,
  language: ParserLanguage,
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

  // PowerShell command resolution is case-insensitive; Bash is case-sensitive.
  const caseInsensitive = language === 'powershell';

  const invocation: AnyToolInvocation & { params: { command: string } } = {
    params: { command: '' },
  } as AnyToolInvocation & { params: { command: string } };

  for (const cmd of commandsToValidate) {
    invocation.params['command'] = cmd;
    if (
      doesToolInvocationMatch(
        'run_shell_command',
        invocation,
        excludeTools,
        caseInsensitive,
      )
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
  language: ParserLanguage,
): PermissionCheckResult | null {
  const invocation: AnyToolInvocation & { params: { command: string } } = {
    params: { command: '' },
  } as AnyToolInvocation & { params: { command: string } };

  const normalizedSessionAllowlist = new Set(
    [...sessionAllowlist].flatMap((cmd) =>
      SHELL_TOOL_NAMES.map((name) => `${name}(${cmd})`),
    ),
  );

  // PowerShell command resolution is case-insensitive; Bash is case-sensitive.
  const caseInsensitive = language === 'powershell';

  const disallowedCommands: string[] = [];

  for (const cmd of commandsToValidate) {
    invocation.params['command'] = cmd;
    const isSessionAllowed = doesToolInvocationMatch(
      'run_shell_command',
      invocation,
      [...normalizedSessionAllowlist],
      caseInsensitive,
    );
    const isGloballyAllowed = isSessionAllowed
      ? true
      : doesToolInvocationMatch(
          'run_shell_command',
          invocation,
          coreTools,
          caseInsensitive,
        );
    if (isSessionAllowed || isGloballyAllowed) {
      continue;
    }

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
  language: ParserLanguage,
): PermissionCheckResult | null {
  const hasSpecificAllowedCommands =
    coreTools.filter((tool) =>
      SHELL_TOOL_NAMES.some((name) => tool.startsWith(`${name}(`)),
    ).length > 0;

  if (!hasSpecificAllowedCommands) return null;

  // PowerShell command resolution is case-insensitive; Bash is case-sensitive.
  const caseInsensitive = language === 'powershell';

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
      caseInsensitive,
    );
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
 * @param shellType Optional override for the shell type; defaults to the
 *   platform's execution shell so validation always matches execution (#3181).
 * @returns An object detailing which commands are not allowed.
 */
export function checkCommandPermissions(
  command: string,
  config: ShellPermissionConfig,
  sessionAllowlist?: Set<string>,
  shellType?: ShellType,
): PermissionCheckResult {
  const shellReplacementMode = resolveShellReplacementMode(config);
  const language = shellTypeToParserLanguage(resolveShellType(shellType));

  // Debug logging when VERBOSE is set
  if (process.env.VERBOSE === 'true') {
    const ephemeralValue = config.getEphemeralSetting('shell-replacement');
    const configValue = config.getShellReplacement();
    debugLogger.log('[SHELL-UTILS] Shell replacement check:', {
      ephemeralValue,
      configValue,
      shellReplacementMode,
      language,
      command: command.substring(0, 50) + (command.length > 50 ? '...' : ''),
    });
  }

  const parserUnavailableBlock = checkParserUnavailableBlock(
    command,
    shellReplacementMode,
    language,
  );
  if (parserUnavailableBlock) return parserUnavailableBlock;

  const replacementBlock = checkShellReplacementBlock(
    command,
    shellReplacementMode,
    language,
  );
  if (replacementBlock) return replacementBlock;

  const coreTools = config.getCoreTools() ?? [];
  const isWildcardAllowed = SHELL_TOOL_NAMES.some((name) =>
    coreTools.includes(name),
  );
  const hasSpecificAllowedCommands = coreTools.some((tool) =>
    SHELL_TOOL_NAMES.some((name) => tool.startsWith(`${name}(`)),
  );
  const hasStrictAllowlist =
    !isWildcardAllowed && (!!sessionAllowlist || hasSpecificAllowedCommands);

  const commandsOrError = extractCommandsToValidate(
    command,
    shellReplacementMode,
    language,
    hasStrictAllowlist,
  );
  if (!Array.isArray(commandsOrError)) return commandsOrError;
  const commandsToValidate = commandsOrError;

  const blocklistResult = checkBlocklist(commandsToValidate, config, language);
  if (blocklistResult) return blocklistResult;

  if (isWildcardAllowed) {
    return { allAllowed: true, disallowedCommands: [] };
  }

  if (sessionAllowlist) {
    const sessionResult = checkSessionAllowlistMode(
      commandsToValidate,
      sessionAllowlist,
      coreTools,
      language,
    );
    if (sessionResult) return sessionResult;
  } else {
    const defaultResult = checkDefaultAllowMode(
      commandsToValidate,
      coreTools,
      language,
    );
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
 * @param shellType Optional override for the shell type; defaults to the
 *   platform's execution shell.
 * @returns An object with 'allowed' boolean and optional 'reason' string if not allowed.
 */
export function isCommandAllowed(
  command: string,
  config: ShellPermissionConfig,
  shellType?: ShellType,
): { allowed: boolean; reason?: string } {
  // By not providing a sessionAllowlist, we invoke "default allow" behavior.
  const { allAllowed, blockReason } = checkCommandPermissions(
    command,
    config,
    undefined,
    shellType,
  );
  if (allAllowed) {
    return { allowed: true };
  }
  return { allowed: false, reason: blockReason };
}
