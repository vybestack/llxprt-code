/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockPlatform: NodeJS.Platform = 'win32';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    default: {
      ...actual,
      platform: () => mockPlatform,
    },
  };
});

import {
  formatShellDetails,
  formatShellDisplay,
} from './check-async-tasks-shell-formatter.js';
import type { ShellJobInfo } from '../interfaces/index.js';

function makeShellJob(overrides: Partial<ShellJobInfo> = {}): ShellJobInfo {
  return {
    kind: 'shell',
    id: 'shell_test',
    command: 'echo hello',
    cwd: '/tmp',
    status: 'running',
    launchedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('check-async-tasks-shell-formatter — Windows pid exposure', () => {
  beforeEach(() => {
    mockPlatform = 'win32';
  });

  it('formatShellDisplay emits taskkill termination line for a running shell job with pid', () => {
    const job = makeShellJob({ pid: 12345 });
    const display = formatShellDisplay(job);
    expect(display).toContain('Terminate: taskkill /T /F /PID 12345');
  });

  it('formatShellDetails includes terminate field for a running shell job with pid', () => {
    const job = makeShellJob({ pid: 9876 });
    const details = formatShellDetails(job, 'output');
    expect(details.terminate).toBe('taskkill /T /F /PID 9876');
  });

  it('does not emit termination line for a completed job', () => {
    const job = makeShellJob({
      pid: 12345,
      status: 'completed',
      exitCode: 0,
      completedAt: 1_700_000_005_000,
    });
    const display = formatShellDisplay(job);
    expect(display).not.toContain('taskkill');
    expect(display).toContain('Status: completed');
    expect(display).toContain('Exit code: 0');
    expect(display).toContain('shell_test');

    const details = formatShellDetails(job, 'output');
    expect(details.terminate).toBeUndefined();
    expect(details.status).toBe('completed');
    expect(details.exitCode).toBe(0);
    expect(details.completedAt).toBe('2023-11-14T22:14:10.000Z');
  });

  it('does not emit termination line for a failed job', () => {
    const job = makeShellJob({
      pid: 12345,
      status: 'failed',
      exitCode: 1,
      failureReason: 'boom',
      completedAt: 1_700_000_005_000,
    });
    const display = formatShellDisplay(job);
    expect(display).not.toContain('taskkill');
    expect(display).toContain('Status: failed');
    expect(display).toContain('Failure: boom');

    const details = formatShellDetails(job, 'output');
    expect(details.terminate).toBeUndefined();
    expect(details.status).toBe('failed');
    expect(details.failureReason).toBe('boom');
  });

  it('does not emit termination line for a cancelled job', () => {
    const job = makeShellJob({
      pid: 12345,
      status: 'cancelled',
      signal: 'SIGTERM',
      completedAt: 1_700_000_005_000,
    });
    const display = formatShellDisplay(job);
    expect(display).not.toContain('taskkill');
    expect(display).toContain('Status: cancelled');
    expect(display).toContain('Signal: SIGTERM');

    const details = formatShellDetails(job, 'output');
    expect(details.terminate).toBeUndefined();
    expect(details.status).toBe('cancelled');
    expect(details.signal).toBe('SIGTERM');
  });

  it('does not emit termination line when pid is missing', () => {
    const job = makeShellJob({ pid: undefined });
    const display = formatShellDisplay(job);
    expect(display).not.toContain('taskkill');
  });

  it('does not emit termination line when pid is 0', () => {
    const job = makeShellJob({ pid: 0 });
    const display = formatShellDisplay(job);
    expect(display).not.toContain('taskkill');
  });
});

describe('check-async-tasks-shell-formatter — POSIX no termination line', () => {
  beforeEach(() => {
    mockPlatform = 'linux';
  });

  it('does not emit termination line for a running shell job with pid', () => {
    const job = makeShellJob({ pid: 12345 });
    const display = formatShellDisplay(job);
    expect(display).not.toContain('taskkill');
    expect(display).not.toContain('Terminate');
  });

  it('does not include terminate field in details', () => {
    const job = makeShellJob({ pid: 12345 });
    const details = formatShellDetails(job, 'output');
    expect(details.terminate).toBeUndefined();
  });
});

describe('formatShellDetails — tailOutput / tailTruncated', () => {
  beforeEach(() => {
    mockPlatform = 'win32';
  });

  it('includes outputTail when tailOutput is provided', () => {
    const job = makeShellJob({ pid: 12345 });
    const details = formatShellDetails(job, 'some output here');
    expect(details.outputTail).toBe('some output here');
    expect(details.outputTruncated).toBeUndefined();
  });

  it('sets outputTruncated when tailTruncated is true', () => {
    const job = makeShellJob({ pid: 12345 });
    const details = formatShellDetails(job, 'partial output', true);
    expect(details.outputTail).toBe('partial output');
    expect(details.outputTruncated).toBe(true);
  });

  it('omits outputTail and outputTruncated when tailOutput is empty', () => {
    const job = makeShellJob({ pid: 12345 });
    const details = formatShellDetails(job, '');
    expect(details.outputTail).toBeUndefined();
    expect(details.outputTruncated).toBeUndefined();
  });

  it('omits outputTail and outputTruncated when tailOutput is undefined', () => {
    const job = makeShellJob({ pid: 12345 });
    const details = formatShellDetails(job);
    expect(details.outputTail).toBeUndefined();
    expect(details.outputTruncated).toBeUndefined();
  });

  it('does not set outputTruncated when tailTruncated is false', () => {
    const job = makeShellJob({ pid: 12345 });
    const details = formatShellDetails(job, 'full output', false);
    expect(details.outputTail).toBe('full output');
    expect(details.outputTruncated).toBeUndefined();
  });
});
