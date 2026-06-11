/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const SHELL_TOOL_NAMES = ['run_shell_command', 'ShellTool'];

export interface SplitCommandsOptions {
  /**
   * Whether to split on pipe operators (|).
   * Default: true (split pipes for security checks).
   * Set to false for command instrumentation where pipelines should stay intact.
   */
  splitOnPipes?: boolean;
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
 * Split a command string into individual commands respecting common shell
 * separators. This intentionally contains the lightweight fallback behavior
 * used by the policy engine and does not depend on core shell tooling.
 */
export function splitCommands(
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
        i++;
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
 * Detects whether a shell command contains shell redirection operators
 * (>, >>, <, <<, <<<, fd forms such as 2>, &>, >&), respecting shell quoting rules.
 * Pipe operators (|) are NOT treated as redirection.
 */
export function hasRedirection(command: string): boolean {
  let inSingleQuotes = false;
  let inDoubleQuotes = false;
  let i = 0;

  while (i < command.length) {
    const char = command[i];

    if (char === '\\' && !inSingleQuotes && i < command.length - 1) {
      i += 2;
      continue;
    }

    if (char === "'" && !inDoubleQuotes) {
      inSingleQuotes = !inSingleQuotes;
    } else if (char === '"' && !inSingleQuotes) {
      inDoubleQuotes = !inDoubleQuotes;
    }

    if (!inSingleQuotes && !inDoubleQuotes && (char === '>' || char === '<')) {
      return true;
    }

    i++;
  }

  return false;
}
