/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TruncationMetadata } from '@vybestack/llxprt-code-tools/acquisition.js';
import type { AnsiOutput } from '../utils/terminalSerializer.js';
import type { EnvironmentSanitizationConfig } from './environmentSanitization.js';

export type PtyExecutionMethod = 'lydell-node-pty' | 'node-pty' | 'bun-pty';

/** A structured result from a shell command execution. */
export interface ShellExecutionResult {
  /** The raw, unprocessed output buffer. */
  rawOutput: Buffer;
  /** The combined, decoded output as a string. */
  output: string;
  /** Acquisition-time truncation details when output exceeded retention. */
  outputTruncation?: TruncationMetadata;
  /** The process exit code, or null if terminated by a signal. */
  exitCode: number | null;
  /** The signal that terminated the process, if any. */
  signal: number | null;
  /** An error object if the process failed to spawn. */
  error: Error | null;
  /** A boolean indicating if the command was aborted by the user. */
  aborted: boolean;
  /** Whether the command was killed due to an inactivity timeout. */
  inactivityTimedOut?: boolean;
  /** The process ID of the spawned shell. */
  pid: number | undefined;
  /** The method used to execute the shell command. */
  executionMethod: PtyExecutionMethod | 'child_process' | 'none';
}

export interface ShellExecutionHandle {
  /** The spawned process id. */
  pid: number | undefined;
  result: Promise<ShellExecutionResult>;
}

export interface ShellExecutionConfig {
  terminalWidth?: number;
  terminalHeight?: number;
  pager?: string;
  showColor?: boolean;
  defaultFg?: string;
  defaultBg?: string;
  disableDynamicLineTrimming?: boolean;
  scrollback?: number;
  inactivityTimeoutMs?: number;
  isSandboxOrCI?: boolean;
  sanitizationConfig?: EnvironmentSanitizationConfig;
  /**
   * Maximum bytes of output retained during acquisition (child_process and
   * PTY paths). Must be a finite positive number. When unset, callers should
   * apply the shared finite default acquisition policy. Separate from
   * model-facing token limits.
   */
  outputRetentionMaxBytes?: number;
}

export type ShellOutputEvent =
  | {
      type: 'data';
      chunk: string | AnsiOutput;
    }
  | {
      type: 'binary_detected';
    }
  | {
      type: 'binary_progress';
      bytesReceived: number;
    };
