/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Programmatic output of a foreground shell execution (issue #4084), built
 * from the execution result itself rather than from the model-facing text,
 * which may be summarized, token-limited or decorated with notices.
 */

import type { ShellExecutionResult } from '../interfaces/IShellToolHost.js';
import { ToolErrorType } from '../types/tool-error.js';
import { applyOutputFilters, type ShellFilterParams } from './shell-helpers.js';
import type { ToolResult } from './tools.js';
import type { ToolExecutionScope } from './tool-execution-scope.js';

/** Execute arguments after `updateOutput`; the shell tool reads the scope. */
export type OptionalExecuteTail = [
  number?,
  number?,
  ((pid: number) => void)?,
  ToolExecutionScope?,
];

/**
 * Adds `{ stdout, stderr, exitCode, streamsMerged }` and completeness to a
 * shell result. A PTY merges the two streams at the terminal; its combined
 * output is reported as stdout with `streamsMerged: true` rather than
 * pretending stderr was empty. Output filters the caller asked for apply to
 * each stream. Acquisition truncation makes the result `partial`.
 */
export function withShellStructuredOutput<T extends ToolResult>(
  toolResult: T,
  execution: ShellExecutionResult,
  filters: ShellFilterParams,
): T {
  const merged = execution.streams === undefined;
  const stdout = execution.streams?.stdout ?? execution.output;
  const stderr = execution.streams?.stderr ?? '';
  return {
    ...toolResult,
    completeness:
      execution.outputTruncation === undefined ? 'complete' : 'partial',
    structuredOutput: {
      stdout: applyOutputFilters(stdout, filters).content,
      stderr: merged ? '' : applyOutputFilters(stderr, filters).content,
      exitCode: execution.exitCode,
      streamsMerged: merged,
    },
  };
}

/** Code mode scripts may only run foreground commands. */
export function scriptBackgroundRejection(): ToolResult {
  const message =
    'Background shell jobs are not available to code mode scripts; run the command in the foreground.';
  return {
    llmContent: message,
    returnDisplay: message,
    error: { message, type: ToolErrorType.INVALID_TOOL_PARAMS },
  };
}

/** Maps a spawn error, timeout or abort to the shell tool's error result. */
export function buildShellExecutionError(
  result: ShellExecutionResult,
  llmContent: string,
  timeoutTriggered: boolean,
): { error: { message: string; type: ToolErrorType } } | Record<string, never> {
  const commandError = result.error as typeof result.error | null | undefined;
  if (commandError !== undefined && commandError !== null) {
    return {
      error: {
        message: commandError.message,
        type: ToolErrorType.SHELL_EXECUTE_ERROR,
      },
    };
  } else if (result.aborted === true && timeoutTriggered) {
    return {
      error: {
        message: llmContent,
        type: ToolErrorType.TIMEOUT,
      },
    };
  } else if (result.aborted === true) {
    return {
      error: {
        message: llmContent,
        type: ToolErrorType.EXECUTION_FAILED,
      },
    };
  }
  return {};
}
