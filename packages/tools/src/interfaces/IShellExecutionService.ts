/**
 * @plan:PLAN-20260608-ISSUE1585.P03
 * @requirement:REQ-INTERFACE-OWNERSHIP
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tools-owned interface for shell execution.
 *
 * Provides command execution and command allowlist checking
 * needed by the shell tool.
 *
 * Consumed by: shell.
 * Implemented by tests and compatibility bridges; production core shell wiring uses IShellToolHost.
 */

/** Options for shell command execution. */
export interface ShellOptions {
  /** Working directory for the command. */
  cwd?: string;
  /** Environment variables for the command. */
  env?: Record<string, string>;
  /** Timeout in milliseconds. */
  timeout?: number;
  /** Whether to include stderr in output. */
  combineOutput?: boolean;
}

/** Result of a shell command execution. */
export interface ShellResult {
  /** The standard output. */
  stdout: string;
  /** The standard error output. */
  stderr: string;
  /** The exit code. */
  exitCode: number;
  /** Whether the command was aborted. */
  aborted: boolean;
}

export interface IShellExecutionService {
  /**
   * Execute a shell command.
   * @param command - The command to execute.
   * @param options - Optional execution options.
   * @returns The execution result.
   */
  execute(command: string, options?: ShellOptions): Promise<ShellResult>;

  /**
   * Check if a command is allowed by policy.
   * @param command - The command to check.
   * @returns Whether the command is allowed.
   */
  isCommandAllowed(command: string): boolean;
}
