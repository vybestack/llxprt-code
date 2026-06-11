/**
 * @plan:PLAN-20260608-ISSUE1585.P11
 * @requirement:REQ-INTERFACE-OWNERSHIP
 */

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tools-owned interface for shell tool host dependencies.
 *
 * Encapsulates all behaviors that shell tool needs from core
 * (command policy, path validation, shell execution, output limiting,
 * summarization, debug mode, timeout settings, etc.) behind a single
 * adapter interface.
 *
 * Consumed by: shell tool in packages/tools.
 * Implemented by: CoreShellToolHostAdapter in packages/core.
 */

/** Result of a shell execution with full metadata. */
export interface ShellExecutionResult {
  /** Standard output and error combined. */
  output: string;
  /** Process exit code, null if terminated by signal. */
  exitCode: number | null;
  /** Signal that terminated the process, null for normal exit. */
  signal: string | null;
  /** Error from spawning the process. */
  error: Error | null;
  /** Whether the command was aborted. */
  aborted: boolean;
  /** Process ID of the spawned process. */
  pid: number | undefined;
  /** Background process IDs discovered for non-Windows shells. */
  backgroundPIDs?: number[];
  /** Process group ID discovered for non-Windows shells. */
  pgid?: number | null;
}

/** Result of command policy check. */
export interface CommandPolicyResult {
  /** Whether the command is allowed. */
  allowed: boolean;
  /** Reason for denial if not allowed. */
  reason?: string;
}

/** Output limits configuration. */
export interface OutputLimits {
  /** Maximum output tokens, undefined for no limit. */
  maxTokens?: number;
  /** Truncation mode. */
  truncateMode?: string;
  /** Token limit for summarization. */
  effectiveTokenLimit?: number;
}

/** Shell execution configuration from host. */
export interface ShellExecutionConfig {
  /** Whether to use node-pty for shell execution. */
  shouldUseNodePty: boolean;
  /** Shell execution options. */
  executionOptions: Record<string, unknown>;
  /** PTY terminal width. */
  ptyTerminalWidth?: number;
  /** PTY terminal height. */
  ptyTerminalHeight?: number;
}

/** Timeout configuration resolved from settings. */
export interface ShellTimeoutConfig {
  /** Resolved timeout in seconds, undefined for no timeout. */
  timeoutSeconds: number | undefined;
  /** Default timeout in seconds. */
  defaultTimeoutSeconds: number;
}

/** Command roots extraction result. */
export interface CommandRootsResult {
  /** The root commands extracted. */
  roots: string[];
}

export interface IShellToolHost {
  /**
   * Get the target/working directory.
   */
  getTargetDir(): string;

  /**
   * Get the workspace context for path validation.
   */
  getWorkspaceContext(): {
    getDirectories(): string[];
    isPathWithinWorkspace(resolvedPath: string): boolean;
  };

  /**
   * Check if a command is allowed by policy.
   */
  isCommandAllowed(command: string): CommandPolicyResult;

  /**
   * Check if a shell invocation is allowlisted (non-interactive mode).
   */
  isShellInvocationAllowlisted(command: string, toolName: string): boolean;

  /**
   * Check if the environment is interactive.
   */
  isInteractive(): boolean;

  /**
   * Check if approval mode is YOLO.
   */
  isYoloMode(): boolean;

  /**
   * Get debug mode status.
   */
  getDebugMode(): boolean;

  /**
   * Get shell execution configuration.
   */
  getShellExecutionConfig(): ShellExecutionConfig;

  /**
   * Get timeout configuration for shell commands.
   */
  getTimeoutConfig(): ShellTimeoutConfig;

  /**
   * Get output limits for shell tool.
   */
  getOutputLimits(): OutputLimits;

  /**
   * Execute a shell command.
   */
  executeShellCommand(
    command: string,
    cwd: string,
    onOutput: (event: ShellOutputEvent) => void,
    signal: AbortSignal,
  ): Promise<ShellExecutionResult>;

  /**
   * Get the command roots for a command string.
   */
  getCommandRoots(command: string): string[];

  /**
   * Strip shell wrapper from a command.
   */
  stripShellWrapper(command: string): string;

  /**
   * Validate a path is within workspace.
   */
  validatePathWithinWorkspace(
    workspaceContext: {
      getDirectories(): string[];
      isPathWithinWorkspace(resolvedPath: string): boolean;
    },
    dirPath: string,
    label: string,
  ): string | null;

  /**
   * Check if a PTY PID is active.
   */
  isPtyActive(pid: number): boolean;

  /**
   * Format memory usage for display.
   */
  formatMemoryUsage(bytes: number): string;

  /**
   * Try to summarize tool output if summarization is configured.
   * @returns Summarized output or original content.
   */
  trySummarizeOutput(
    content: string,
    signal: AbortSignal,
    tokenBudget?: number,
  ): Promise<string>;

  /**
   * Get summarize tool output config for shell tool.
   */
  getSummarizeConfig(): { tokenBudget?: number } | undefined;

  /**
   * Apply output token limiting.
   */
  limitOutputTokens(content: string): {
    content: string;
    wasTruncated: boolean;
  };
}

/**
 * Shell output event from the execution service.
 */
export interface ShellOutputEvent {
  type: 'data' | 'binary_detected' | 'binary_progress';
  chunk?: string;
  bytesReceived?: number;
}
