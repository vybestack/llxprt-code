/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ShellJob, ShellJobTailResult } from './shellJobTypes.js';

/**
 * Hard caps for the output tail included in a completion notification. A
 * chatty background job must never flood the conversation — these limits are
 * enforced on BOTH the number of lines and the total character count.
 */
export const SHELL_NOTIF_TAIL_MAX_LINES = 20;
export const SHELL_NOTIF_TAIL_MAX_BYTES = 2048;

/**
 * Applies the notification-specific caps to a raw tail result. The tail reader
 * already bounds output, but a notification is an additional surface with its
 * own (tighter) budget so multiple jobs can coalesce into one message.
 */
function capTail(raw: string): { output: string; truncated: boolean } {
  let output = raw;
  let truncated = false;

  if (output.length > SHELL_NOTIF_TAIL_MAX_BYTES) {
    output = output.slice(output.length - SHELL_NOTIF_TAIL_MAX_BYTES);
    truncated = true;
  }

  const lines = output.split('\n');
  if (lines.length > SHELL_NOTIF_TAIL_MAX_LINES) {
    output = lines.slice(lines.length - SHELL_NOTIF_TAIL_MAX_LINES).join('\n');
    truncated = true;
  }

  return { output, truncated };
}

/**
 * Formats a shell job completion into a compact, JSON-structured notification
 * suitable for injection into a model turn. The tail is hard-capped so that a
 * chatty job cannot flood the conversation.
 */
export function formatShellJobCompletionNotification(
  job: ShellJob,
  tail: ShellJobTailResult,
): string {
  const payload: Record<string, unknown> = {
    job_id: job.id,
    command: job.command,
    state: job.state,
  };

  if (job.exitCode !== undefined) {
    payload.exit_code = job.exitCode;
  }
  if (job.signal !== undefined) {
    payload.signal = job.signal;
  }
  if (job.failureReason !== undefined) {
    payload.failure_reason = job.failureReason;
  }

  if (tail.output !== '') {
    const capped = capTail(tail.output);
    payload.output_tail = capped.output;
    payload.output_truncated = tail.truncated || capped.truncated;
  }

  return JSON.stringify(payload, null, 2);
}
