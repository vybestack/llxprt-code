/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as child_process from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import { DebugLogger } from '@vybestack/llxprt-code-core';

vi.mock('node:child_process');
vi.mock('node:fs/promises');

import { setupSshAgentForwarding } from './sandbox.js';

const HOST_SOCKET = '/tmp/test-ssh-agent.sock';
const CONTAINER_SOCKET_ENV = 'SSH_AUTH_SOCK=/ssh-agent';
const EMPTY_AGENT_STDOUT = 'The agent has no identities.\n';
const COMMUNICATION_FAILURE_STDERR =
  'error fetching identities: communication with agent failed\n';
const EXPECTED_WARNING =
  'SSH agent socket is present, but no identities are loaded (ssh-add -l reported empty).\n' +
  'SSH forwarding is enabled, but git SSH auth will fail until a key is loaded.\n' +
  'Try: ssh-add ~/.ssh/id_ed25519\n';

interface SshAddOutcome {
  stdout?: string;
  stderr?: string;
  status?: number | null;
  signal?: NodeJS.Signals;
  spawnError?: Error;
}

/**
 * Stands in for the `ssh-add -l` child process, replaying a realistic outcome
 * (streamed output, then either a spawn error or an exit status) so the code
 * under test consumes the same events a real probe would produce.
 */
function mockSshAdd(outcome: SshAddOutcome): void {
  const child = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.assign(child, { stdout, stderr });

  vi.mocked(child_process.spawn).mockImplementation(() => {
    setImmediate(() => {
      if (outcome.spawnError) {
        child.emit('error', outcome.spawnError);
        return;
      }
      stdout.end(outcome.stdout ?? '');
      stderr.end(outcome.stderr ?? '');
      stdout.on('end', () => {
        child.emit('close', outcome.status ?? 0, outcome.signal ?? null);
      });
    });
    return child as unknown as child_process.ChildProcess;
  });
}

/**
 * Reaches the direct-mount fallback: SSH agent enabled, socket present on disk,
 * and a platform without a dedicated helper, so no sockets or tunnels are
 * created and every assertion stays hermetic.
 */
function enableForwardingViaFallback(): void {
  process.env.LLXPRT_SANDBOX_SSH_AGENT = 'auto';
  process.env.SSH_AUTH_SOCK = HOST_SOCKET;
  vi.spyOn(fs, 'existsSync').mockReturnValue(true);
  vi.spyOn(os, 'platform').mockReturnValue('freebsd');
}

function captureStderr(): () => string {
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  return () => spy.mock.calls.map((call) => String(call[0])).join('');
}

function silenceDebugWarnings(): void {
  vi.spyOn(DebugLogger.prototype, 'warn').mockImplementation(() => {});
}

async function runForwarding(
  command: 'docker' | 'podman' = 'docker',
  initialArgs: string[] = [],
): Promise<{ result: unknown; args: string[] }> {
  const args = [...initialArgs];
  const result = await setupSshAgentForwarding({ command }, args);
  return { result, args };
}

describe('setupSshAgentForwarding SSH agent identity preflight', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    process.env = { ...origEnv };
    vi.restoreAllMocks();
  });

  it('warns with remediation when the agent reports no identities', async () => {
    enableForwardingViaFallback();
    const stderrText = captureStderr();
    mockSshAdd({ status: 1, stdout: EMPTY_AGENT_STDOUT });

    await runForwarding();

    expect(stderrText()).toBe(EXPECTED_WARNING);
  });

  it('still configures forwarding when the agent reports no identities', async () => {
    enableForwardingViaFallback();
    captureStderr();
    mockSshAdd({ status: 1, stdout: EMPTY_AGENT_STDOUT });

    const { result, args } = await runForwarding();

    expect(result).toStrictEqual({});
    expect(args).toContain(CONTAINER_SOCKET_ENV);
  });

  it('stays silent when the agent has identities loaded', async () => {
    enableForwardingViaFallback();
    const stderrText = captureStderr();
    mockSshAdd({ status: 0, stdout: '256 SHA256:abc user@host (ED25519)\n' });

    const { args } = await runForwarding();

    expect(stderrText()).toBe('');
    expect(args).toContain(CONTAINER_SOCKET_ENV);
  });

  it('stays silent when listing identities fails for a reason other than an empty agent', async () => {
    enableForwardingViaFallback();
    silenceDebugWarnings();
    const stderrText = captureStderr();
    mockSshAdd({ status: 1, stderr: COMMUNICATION_FAILURE_STDERR });

    const { args } = await runForwarding();

    expect(stderrText()).toBe('');
    expect(args).toContain(CONTAINER_SOCKET_ENV);
  });

  it('stays silent when the agent cannot be contacted', async () => {
    enableForwardingViaFallback();
    silenceDebugWarnings();
    const stderrText = captureStderr();
    mockSshAdd({
      status: 2,
      stderr: 'Could not open a connection to your authentication agent.\n',
    });

    const { args } = await runForwarding();

    expect(stderrText()).toBe('');
    expect(args).toContain(CONTAINER_SOCKET_ENV);
  });

  it('stays silent when ssh-add is not installed', async () => {
    enableForwardingViaFallback();
    silenceDebugWarnings();
    const stderrText = captureStderr();
    mockSshAdd({
      spawnError: Object.assign(new Error('spawn ssh-add ENOENT'), {
        code: 'ENOENT',
      }),
    });

    const { args } = await runForwarding();

    expect(stderrText()).toBe('');
    expect(args).toContain(CONTAINER_SOCKET_ENV);
  });

  it('stays silent when the probe is killed after exceeding its timeout', async () => {
    enableForwardingViaFallback();
    silenceDebugWarnings();
    const stderrText = captureStderr();
    mockSshAdd({ status: null, signal: 'SIGKILL' });

    const { args } = await runForwarding();

    expect(stderrText()).toBe('');
    expect(args).toContain(CONTAINER_SOCKET_ENV);
  });

  it('queries the agent that is being forwarded, under a bounded timeout', async () => {
    enableForwardingViaFallback();
    captureStderr();
    mockSshAdd({ status: 0 });

    await runForwarding();

    expect(child_process.spawn).toHaveBeenCalledWith(
      'ssh-add',
      ['-l'],
      expect.objectContaining({
        env: expect.objectContaining({ SSH_AUTH_SOCK: HOST_SOCKET }),
        timeout: 5000,
        killSignal: 'SIGKILL',
      }),
    );
  });

  it('does not query the agent when forwarding is off', async () => {
    process.env.LLXPRT_SANDBOX_SSH_AGENT = 'off';
    process.env.SSH_AUTH_SOCK = HOST_SOCKET;
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const stderrText = captureStderr();

    await runForwarding();

    expect(child_process.spawn).not.toHaveBeenCalled();
    expect(stderrText()).toBe('');
  });

  it('does not query the agent when SSH_AUTH_SOCK is unset', async () => {
    process.env.LLXPRT_SANDBOX_SSH_AGENT = 'on';
    delete process.env.SSH_AUTH_SOCK;
    silenceDebugWarnings();
    const stderrText = captureStderr();

    await runForwarding();

    expect(child_process.spawn).not.toHaveBeenCalled();
    expect(stderrText()).toBe('');
  });

  it('does not query the agent when the socket path is missing', async () => {
    process.env.LLXPRT_SANDBOX_SSH_AGENT = 'on';
    process.env.SSH_AUTH_SOCK = '/nope/not-there.sock';
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    silenceDebugWarnings();
    const stderrText = captureStderr();

    await runForwarding();

    expect(child_process.spawn).not.toHaveBeenCalled();
    expect(stderrText()).toBe('');
  });

  it('does not claim forwarding is enabled when Podman declines to override the network mode', async () => {
    process.env.LLXPRT_SANDBOX_SSH_AGENT = 'on';
    process.env.SSH_AUTH_SOCK = HOST_SOCKET;
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(os, 'platform').mockReturnValue('darwin');
    silenceDebugWarnings();
    const stderrText = captureStderr();
    mockSshAdd({ status: 1, stdout: EMPTY_AGENT_STDOUT });

    const { args } = await runForwarding('podman', ['--network', 'none']);

    expect(args).toStrictEqual(['--network', 'none']);
    expect(stderrText()).toBe('');
  });
});
