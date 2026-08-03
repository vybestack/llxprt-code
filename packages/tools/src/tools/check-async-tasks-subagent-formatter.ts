/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SubagentTaskInfo } from '../interfaces/index.js';

export function formatDuration(
  startTime: number | undefined,
  endTime?: number,
): string {
  const end = endTime ?? Date.now();
  const durationMs = end - (startTime ?? end);
  const seconds = Math.floor(durationMs / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function statusIcon(status: SubagentTaskInfo['status']): string {
  if (status === 'completed') {
    return '[OK]';
  }
  if (status === 'failed') {
    return '[FAILED]';
  }
  return '';
}

export function formatSubagentDetails(
  task: SubagentTaskInfo,
): Record<string, unknown> {
  const details: Record<string, unknown> = {
    kind: 'subagent',
    id: task.id,
    subagentName: task.subagentName,
    goalPrompt: task.goalPrompt,
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

  if (task.output !== undefined && task.output !== '') {
    details.output = task.output;
  }

  if (task.error !== undefined && task.error !== '') {
    details.error = task.error;
  }

  return details;
}

export function formatSubagentDisplay(task: SubagentTaskInfo): string {
  const lines: string[] = [];
  const icon = statusIcon(task.status);
  const goalPrompt = task.goalPrompt;

  lines.push(`${icon} **${task.subagentName}**`);
  lines.push(`ID: \`${task.id}\``);
  lines.push(`Status: ${task.status}`);
  lines.push(
    `Goal: ${goalPrompt.substring(0, 100)}${goalPrompt.length > 100 ? '...' : ''}`,
  );
  lines.push(`Duration: ${formatDuration(task.launchedAt, task.completedAt)}`);

  const output = task.output as
    | { emitted_vars?: Record<string, unknown> }
    | undefined;
  if (output?.emitted_vars && Object.keys(output.emitted_vars).length > 0) {
    lines.push('Emitted variables:');
    for (const [key, value] of Object.entries(output.emitted_vars)) {
      const valueStr = String(value);
      const truncated = valueStr.substring(0, 50);
      const suffix = valueStr.length > 50 ? '...' : '';
      lines.push(`  - ${key}: ${truncated}${suffix}`);
    }
  }

  if (task.error) {
    lines.push(`Error: ${task.error}`);
  }
  return lines.join('\n');
}
