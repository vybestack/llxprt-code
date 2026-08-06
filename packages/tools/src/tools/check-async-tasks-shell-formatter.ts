/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import os from 'node:os';

import type { ShellJobInfo } from '../interfaces/index.js';
import {
  formatDuration,
  statusIcon,
} from './check-async-tasks-subagent-formatter.js';

function windowsTerminateLine(task: ShellJobInfo): string | undefined {
  if (os.platform() !== 'win32' || task.status !== 'running') {
    return undefined;
  }
  if (task.pid === undefined || task.pid <= 0) {
    return undefined;
  }
  return `taskkill /T /F /PID ${task.pid}`;
}

export function formatShellDetails(
  task: ShellJobInfo,
  tailOutput?: string,
  tailTruncated?: boolean,
): Record<string, unknown> {
  const details: Record<string, unknown> = {
    kind: 'shell',
    id: task.id,
    command: task.command,
    cwd: task.cwd,
    status: task.status,
    launchedAt:
      task.launchedAt !== undefined
        ? new Date(task.launchedAt).toISOString()
        : undefined,
    duration: formatDuration(task.launchedAt, task.completedAt),
  };

  if (
    task.completedAt !== undefined &&
    task.completedAt !== 0 &&
    !Number.isNaN(task.completedAt)
  ) {
    details.completedAt = new Date(task.completedAt).toISOString();
  }

  if (task.exitCode !== undefined) {
    details.exitCode = task.exitCode;
  }
  if (task.signal !== undefined) {
    details.signal = task.signal;
  }
  if (task.failureReason !== undefined && task.failureReason !== '') {
    details.failureReason = task.failureReason;
  }

  const terminate = windowsTerminateLine(task);
  if (terminate !== undefined) {
    details.terminate = terminate;
  }

  if (tailOutput !== undefined && tailOutput !== '') {
    details.outputTail = tailOutput;
    if (tailTruncated === true) {
      details.outputTruncated = true;
    }
  }

  return details;
}

export function formatShellDisplay(
  task: ShellJobInfo,
  tailOutput?: string,
): string {
  const lines: string[] = [];
  const icon = statusIcon(task.status);

  lines.push(`${icon} **${task.id}**`);
  lines.push(`Kind: shell`);
  lines.push(`Command: \`${task.command}\``);
  lines.push(`Status: ${task.status}`);

  if (task.exitCode !== undefined) {
    lines.push(`Exit code: ${task.exitCode}`);
  }
  if (task.signal !== undefined) {
    lines.push(`Signal: ${task.signal}`);
  }
  if (task.failureReason !== undefined && task.failureReason !== '') {
    lines.push(`Failure: ${task.failureReason}`);
  }

  const terminate = windowsTerminateLine(task);
  if (terminate !== undefined) {
    lines.push(`Terminate: ${terminate}`);
  }

  lines.push(`Duration: ${formatDuration(task.launchedAt, task.completedAt)}`);

  if (tailOutput !== undefined && tailOutput !== '') {
    lines.push('Output tail:');
    lines.push('```');
    lines.push(tailOutput);
    lines.push('```');
  }

  return lines.join('\n');
}
