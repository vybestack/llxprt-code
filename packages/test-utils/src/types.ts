/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Options for running a command with timeout support.
 */
export interface InteractiveRunOptions {
  /** Maximum time to wait for the command to complete (default: 30000ms) */
  timeout?: number;
  /** Time to wait after SIGTERM before sending SIGKILL (default: 5000ms) */
  gracefulKillTimeout?: number;
}

/**
 * Result of running a command.
 */
export interface InteractiveRunResult {
  /** The exit code of the process, or null if it was killed */
  exitCode: number | null;
  /** Standard output from the process */
  stdout: string;
  /** Standard error from the process */
  stderr: string;
  /** Whether the process timed out */
  timedOut: boolean;
  /** Whether the process was killed */
  killed: boolean;
}

/**
 * Attributes recorded on a telemetry log entry.
 */
export interface TelemetryAttributes {
  readonly 'event.name'?: string;
  readonly function_name?: string;
  readonly function_args?: string;
  readonly success?: boolean;
  readonly duration_ms?: number;
  readonly request_text?: string;
  readonly hook_event_name?: string;
  readonly hook_name?: string;
  readonly hook_input?: Record<string, unknown>;
  readonly hook_output?: Record<string, unknown>;
  readonly exit_code?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly error?: string;
  readonly 'event.timestamp'?: number;
}

/**
 * A single parsed telemetry object as emitted to telemetry.log.
 */
export interface ParsedLog {
  attributes?: TelemetryAttributes;
  scopeMetrics?: Array<{
    metrics: Array<{
      descriptor: {
        name: string;
      };
    }>;
  }>;
  body?: string;
  timestamp?: number;
}

/**
 * A normalized tool-call record extracted from telemetry or stdout.
 */
export interface ToolLogEntry {
  timestamp: number;
  toolRequest: {
    name: string;
    args: string;
    success: boolean;
    duration_ms: number;
  };
}

/**
 * A normalized hook-call record extracted from telemetry.
 */
export interface HookLogEntry {
  hookCall: {
    hook_event_name: string;
    hook_name: string;
    hook_input: Record<string, unknown>;
    hook_output: Record<string, unknown>;
    exit_code: number;
    stdout: string;
    stderr: string;
    duration_ms: number;
    success: boolean;
    error: string;
  };
}
