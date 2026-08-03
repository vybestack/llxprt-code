/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  formatShellJobCompletionNotification,
  SHELL_NOTIF_TAIL_MAX_LINES,
  SHELL_NOTIF_TAIL_MAX_BYTES,
} from './shellJobNotification.js';
import type { ShellJob } from './shellJobTypes.js';

function makeJob(overrides: Partial<ShellJob> = {}): ShellJob {
  return {
    id: 'shell_abc123',
    command: 'echo hello',
    cwd: '/tmp',
    state: 'completed',
    startedAt: 1000,
    endedAt: 2000,
    pid: 12345,
    exitCode: 0,
    ...overrides,
  };
}

describe('formatShellJobCompletionNotification', () => {
  it('formats a completed job with id, command, and exit code', () => {
    const job = makeJob({ state: 'completed', exitCode: 0 });
    const text = formatShellJobCompletionNotification(job, {
      output: 'hello\n',
      truncated: false,
    });
    expect(text).toContain('shell_abc123');
    expect(text).toContain('echo hello');
    expect(text).toContain('completed');
    expect(text).toContain('exit_code');
    expect(text).toContain('0');
    expect(text).toContain('hello');
  });

  it('formats a failed job with exit code', () => {
    const job = makeJob({ state: 'failed', exitCode: 1 });
    const text = formatShellJobCompletionNotification(job, {
      output: 'error msg\n',
      truncated: false,
    });
    expect(text).toContain('failed');
    expect(text).toContain('exit_code');
    expect(text).toContain('1');
    expect(text).toContain('error msg');
  });

  it('formats a job that died by signal', () => {
    const job = makeJob({
      state: 'failed',
      signal: 'SIGTERM',
      exitCode: undefined,
    });
    const text = formatShellJobCompletionNotification(job, {
      output: '',
      truncated: false,
    });
    expect(text).toContain('signal');
    expect(text).toContain('SIGTERM');
  });

  it('formats a cancelled job', () => {
    const job = makeJob({ state: 'cancelled', exitCode: undefined });
    const text = formatShellJobCompletionNotification(job, {
      output: '',
      truncated: false,
    });
    expect(text).toContain('cancelled');
  });

  it('includes a capped output tail (line cap)', () => {
    const manyLines =
      Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n') + '\n';
    const job = makeJob();
    const text = formatShellJobCompletionNotification(job, {
      output: manyLines,
      truncated: true,
    });
    // The tail should NOT contain all 100 lines — it must be capped.
    const outputSection = text.split('output_tail')[1] ?? '';
    const lineCount = outputSection.split('\n').length;
    expect(lineCount).toBeLessThanOrEqual(SHELL_NOTIF_TAIL_MAX_LINES + 2);
    expect(text).toContain('truncated');
  });

  it('includes a capped output tail (character cap)', () => {
    const longLine = 'x'.repeat(20000);
    const job = makeJob();
    const text = formatShellJobCompletionNotification(job, {
      output: longLine,
      truncated: true,
    });
    // The raw text of the notification should not balloon past the cap + overhead.
    expect(text.length).toBeLessThan(SHELL_NOTIF_TAIL_MAX_BYTES + 2000);
  });

  it('omits the tail section when output is empty', () => {
    const job = makeJob();
    const text = formatShellJobCompletionNotification(job, {
      output: '',
      truncated: false,
    });
    expect(text).not.toContain('output_tail');
  });
});
