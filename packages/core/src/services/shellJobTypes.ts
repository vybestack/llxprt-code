/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChildProcess } from 'node:child_process';

export const SHELL_JOB_ID_PREFIX = 'shell_';
export const DEFAULT_MAX_BACKGROUND_JOBS = 10;
export const DEFAULT_LOG_MAX_BYTES = 8 * 1024 * 1024;
export const LOG_CAP_POLL_INTERVAL_MS = 2000;

export type ShellJobState = 'running' | 'completed' | 'failed' | 'cancelled';

export type ShellJobPhase = 'starting' | 'cancelling' | null;

export interface ShellJob {
  id: string;
  command: string;
  cwd: string;
  state: ShellJobState;
  startedAt: number;
  endedAt?: number;
  pid: number;
  exitCode?: number;
  signal?: string;
  failureReason?: string;
  notifiedAt?: number;
}

export interface ShellJobLaunchInput {
  command: string;
  cwd: string;
}

export interface ShellJobTailOptions {
  lines: number;
  maxBytes: number;
}

export interface ShellJobTailResult {
  id: string;
  output: string;
  truncated: boolean;
}

export interface TerminalDetails {
  exitCode?: number;
  signal?: string;
  failureReason?: string;
}

export interface ShellJobRecord {
  id: string;
  command: string;
  cwd: string;
  state: ShellJobState;
  phase: ShellJobPhase;
  startedAt: number;
  endedAt?: number;
  pid: number;
  exitCode?: number;
  signal?: string;
  failureReason?: string;
  notifiedAt?: number;
  logPath: string;
  child: ChildProcess;
  escalateTimer?: ReturnType<typeof setTimeout>;
  terminalPromise: Promise<void>;
  resolveTerminal: () => void;
}

export function generateJobId(): string {
  const part1 = Math.floor(Math.random() * 0x100000000)
    .toString(16)
    .padStart(8, '0');
  const part2 = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, '0');
  return `${SHELL_JOB_ID_PREFIX}${part1}${part2}`;
}

export function toPublicJob(record: ShellJobRecord): ShellJob {
  return {
    id: record.id,
    command: record.command,
    cwd: record.cwd,
    state: record.state,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    pid: record.pid,
    exitCode: record.exitCode,
    signal: record.signal,
    failureReason: record.failureReason,
    notifiedAt: record.notifiedAt,
  };
}
