/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core';
import {
  parseAndFormatApiError,
  FatalTurnLimitedError,
  FatalCancellationError,
  FatalToolExecutionError,
  isFatalToolError,
} from '@vybestack/llxprt-code-core';

/**
 * Extracts a string error message from an unknown error type
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}

interface ErrorWithCode extends Error {
  exitCode?: number;
  code?: string | number;
  status?: string | number;
}

/**
 * Extracts the appropriate error code from an error object.
 */
function extractErrorCode(error: unknown): string | number {
  const errorWithCode = error as ErrorWithCode;

  // Prioritize exitCode for FatalError types, fall back to other codes
  if (typeof errorWithCode.exitCode === 'number') {
    return errorWithCode.exitCode;
  }
  if (errorWithCode.code !== undefined) {
    return errorWithCode.code;
  }
  if (errorWithCode.status !== undefined) {
    return errorWithCode.status;
  }

  return 1; // Default exit code
}

/**
 * Converts an error code to a numeric exit code.
 */
function getNumericExitCode(errorCode: string | number): number {
  return typeof errorCode === 'number' ? errorCode : 1;
}

/**
 * Handles errors consistently.
 * Outputs error message to stderr and re-throws the error.
 */
export function handleError(
  error: unknown,
  config: Config,
  customErrorCode?: string | number,
): never {
  const errorMessage = parseAndFormatApiError(
    error,
    config.getContentGeneratorConfig()?.authType,
  );

  console.error(errorMessage);

  // If we have a custom error code or the error has an exit code, exit with that code
  if (customErrorCode !== undefined) {
    process.exit(getNumericExitCode(customErrorCode));
  }

  const errorCode = extractErrorCode(error);
  if (typeof errorCode === 'number') {
    process.exit(errorCode);
  }

  throw error;
}

/**
 * Handles tool execution errors specifically.
 *
 * Fatal errors (e.g., NO_SPACE_LEFT) cause the CLI to exit immediately,
 * as they indicate unrecoverable system state.
 *
 * Non-fatal errors (e.g., INVALID_TOOL_PARAMS, FILE_NOT_FOUND, PATH_NOT_IN_WORKSPACE)
 * are logged to stderr and the error response is sent back to the model,
 * allowing it to self-correct.
 */
export function handleToolError(
  toolName: string,
  toolError: Error,
  config: Config,
  errorType?: string,
  resultDisplay?: string,
): void {
  const errorMessage = `Error executing tool ${toolName}: ${resultDisplay || toolError.message}`;

  const isFatal = isFatalToolError(errorType);

  if (isFatal) {
    const toolExecutionError = new FatalToolExecutionError(errorMessage);
    console.error(errorMessage);
    process.exit(toolExecutionError.exitCode);
  }

  // Non-fatal: log and continue
  console.error(errorMessage);
}

/**
 * Handles cancellation/abort signals consistently.
 */
export function handleCancellationError(_config: Config): never {
  const cancellationError = new FatalCancellationError('Operation cancelled.');
  console.error(cancellationError.message);
  process.exit(cancellationError.exitCode);
}

/**
 * Handles max session turns exceeded consistently.
 */
export function handleMaxTurnsExceededError(_config: Config): never {
  const maxTurnsError = new FatalTurnLimitedError(
    'Reached max session turns for this session. Increase the number of turns by specifying maxSessionTurns in settings.json.',
  );

  console.error(maxTurnsError.message);
  process.exit(maxTurnsError.exitCode);
}
