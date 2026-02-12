/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as child_process from 'node:child_process';
import fs from 'node:fs';

vi.mock('node:child_process');

import {
  setupSshAgentForwarding,
  setupSshAgentDockerMacOS,
  getPodmanMachineConnection,
  setupSshAgentPodmanMacOS,
} from './sandbox.js';

describe('setupSshAgentDockerMacOS', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mounts magic socket when Docker Desktop detected (R6.1)', () => {
    vi.mocked(child_process.execSync).mockReturnValue(
      Buffer.from('Docker Desktop'),
    );
    const args: string[] = [];
    setupSshAgentDockerMacOS(args);
    const vol = args.find((a) =>
      a.includes('/run/host-services/ssh-auth.sock'),
    );
    expect(vol).toBeDefined();
    expect(args).toContain('SSH_AUTH_SOCK=/ssh-agent');
  });

  it('warns and skips when Docker Desktop not detected (R6.2)', () => {
    vi.mocked(child_process.execSync).mockReturnValue(
      Buffer.from('Alpine Linux'),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const args: string[] = [];
    setupSshAgentDockerMacOS(args);
    expect(args).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Docker Desktop not detected'),
    );
  });

  it('warns gracefully on docker info failure (R6.2)', () => {
    vi.mocked(child_process.execSync).mockImplementation(() => {
      throw new Error('docker not available');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const args: string[] = [];
    setupSshAgentDockerMacOS(args);
    expect(args).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe('getPodmanMachineConnection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses default connection (R7.2)', () => {
    vi.mocked(child_process.execSync).mockReturnValue(
      Buffer.from(
        JSON.stringify([
          {
            Name: 'podman-machine-default',
            URI: 'ssh://core@localhost:54321/run/podman/podman.sock',
            Identity: '/Users/alice/.ssh/podman-machine-default',
            Default: true,
          },
        ]),
      ),
    );
    const result = getPodmanMachineConnection();
    expect(result.user).toBe('core');
    expect(result.host).toBe('localhost');
    expect(result.port).toBe(54321);
    expect(result.identityPath).toBe(
      '/Users/alice/.ssh/podman-machine-default',
    );
  });

  it('falls back to sole connection when no default (R7.2)', () => {
    vi.mocked(child_process.execSync).mockReturnValue(
      Buffer.from(
        JSON.stringify([
          {
            Name: 'my-machine',
            URI: 'ssh://user@127.0.0.1:22222/run/podman/podman.sock',
            Identity: '/Users/alice/.ssh/id',
            Default: false,
          },
        ]),
      ),
    );
    const result = getPodmanMachineConnection();
    expect(result.user).toBe('user');
    expect(result.port).toBe(22222);
  });

  it('throws on empty connection list (R7.2)', () => {
    vi.mocked(child_process.execSync).mockReturnValue(
      Buffer.from(JSON.stringify([])),
    );
    expect(() => getPodmanMachineConnection()).toThrow(
      /No Podman machine connections found/,
    );
  });

  it('throws on multiple non-default connections (R7.2)', () => {
    vi.mocked(child_process.execSync).mockReturnValue(
      Buffer.from(
        JSON.stringify([
          {
            Name: 'a',
            URI: 'ssh://u@h:1/s',
            Identity: '/i',
            Default: false,
          },
          {
            Name: 'b',
            URI: 'ssh://u@h:2/s',
            Identity: '/i',
            Default: false,
          },
        ]),
      ),
    );
    expect(() => getPodmanMachineConnection()).toThrow(
      /Multiple Podman connections/,
    );
  });

  it('throws on malformed JSON (R7.6)', () => {
    vi.mocked(child_process.execSync).mockReturnValue(Buffer.from('not json'));
    expect(() => getPodmanMachineConnection()).toThrow(
      /Failed to parse Podman connection list JSON/,
    );
  });

  it('throws on command failure with guidance', () => {
    vi.mocked(child_process.execSync).mockImplementation(() => {
      throw new Error('podman not found');
    });
    expect(() => getPodmanMachineConnection()).toThrow(
      /Failed to list Podman connections/,
    );
  });
});

describe('setupSshAgentForwarding', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    process.env = { ...origEnv };
    vi.restoreAllMocks();
  });

  it('returns empty result when SSH agent is off (R4.1)', async () => {
    process.env.LLXPRT_SANDBOX_SSH_AGENT = 'off';
    const args: string[] = [];
    const result = await setupSshAgentForwarding({ command: 'docker' }, args);
    expect(result).toEqual({});
    expect(args).toHaveLength(0);
  });

  it('warns and skips when SSH_AUTH_SOCK not set (R4.2)', async () => {
    process.env.LLXPRT_SANDBOX_SSH_AGENT = 'on';
    delete process.env.SSH_AUTH_SOCK;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const args: string[] = [];
    const result = await setupSshAgentForwarding({ command: 'docker' }, args);
    expect(result).toEqual({});
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('SSH_AUTH_SOCK is not set'),
    );
  });

  it('returns empty when not explicitly enabled and no SSH_AUTH_SOCK (R4.4)', async () => {
    delete process.env.LLXPRT_SANDBOX_SSH_AGENT;
    delete process.env.SANDBOX_SSH_AGENT;
    delete process.env.SSH_AUTH_SOCK;
    const args: string[] = [];
    const result = await setupSshAgentForwarding({ command: 'docker' }, args);
    expect(result).toEqual({});
  });

  it('warns and skips when SSH_AUTH_SOCK path does not exist on disk (R4.3)', async () => {
    process.env.LLXPRT_SANDBOX_SSH_AGENT = 'on';
    process.env.SSH_AUTH_SOCK = '/nonexistent/ssh-agent.sock';
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const args: string[] = [];
    const result = await setupSshAgentForwarding({ command: 'docker' }, args);
    expect(result).toEqual({});
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('SSH_AUTH_SOCK path not found'),
    );
    existsSpy.mockRestore();
  });
});

describe('setupSshAgentPodmanMacOS', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockValidConnection() {
    vi.mocked(child_process.execSync).mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('connection list')) {
        return Buffer.from(
          JSON.stringify([
            {
              Name: 'default',
              URI: 'ssh://core@localhost:12345/run/podman/podman.sock',
              Identity: '/Users/test/.ssh/key',
              Default: true,
            },
          ]),
        );
      }
      // TCP port poll via ss
      if (cmdStr.includes('ss -tln')) {
        return Buffer.from('ok');
      }
      return Buffer.from('');
    });
  }

  function mockTunnelProcess(exitCode: number | null = null) {
    const fakeProcess = {
      pid: 99999,
      exitCode,
      on: vi.fn().mockReturnThis(),
      removeListener: vi.fn().mockReturnThis(),
      kill: vi.fn(),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
    };
    vi.mocked(child_process.spawn).mockReturnValue(
      fakeProcess as unknown as child_process.ChildProcess,
    );
    return fakeProcess;
  }

  it('spawns SSH tunnel with -R TCP reverse forwarding (R7.1)', async () => {
    mockValidConnection();
    mockTunnelProcess();

    await setupSshAgentPodmanMacOS([], '/tmp/auth.sock');

    const spawnCall = vi.mocked(child_process.spawn).mock.calls[0];
    expect(spawnCall[0]).toBe('ssh');
    const sshArgs = spawnCall[1] as string[];
    expect(sshArgs).toContain('-R');
    // Verify -R arg uses TCP port format (127.0.0.1:PORT:/tmp/auth.sock)
    const rIdx = sshArgs.indexOf('-R');
    expect(sshArgs[rIdx + 1]).toMatch(/^127\.0\.0\.1:\d+:\/tmp\/auth\.sock$/);
    expect(sshArgs).toContain('-N');
    expect(sshArgs).toContain('ExitOnForwardFailure=yes');
  }, 10000);

  it('adds --network host and SSH_AUTH_SOCK env on success (R7.5)', async () => {
    mockValidConnection();
    mockTunnelProcess();

    const args: string[] = [];
    const result = await setupSshAgentPodmanMacOS(args, '/tmp/auth.sock');

    // TCP approach uses --network=host instead of --volume socket mount
    expect(args).toContain('--network');
    const netIdx = args.indexOf('--network');
    expect(args[netIdx + 1]).toBe('host');
    const sshEnv = args.find((a) => a.includes('SSH_AUTH_SOCK'));
    expect(sshEnv).toBe('SSH_AUTH_SOCK=/tmp/ssh-agent');
    expect(result.cleanup).toBeDefined();
    expect(result.entrypointPrefix).toBeDefined();
  }, 10000);

  it('returns entrypointPrefix with socat relay command (R7.5)', async () => {
    mockValidConnection();
    mockTunnelProcess();

    const result = await setupSshAgentPodmanMacOS([], '/tmp/auth.sock');

    expect(result.entrypointPrefix).toContain(
      'socat UNIX-LISTEN:/tmp/ssh-agent,fork TCP4:127.0.0.1:',
    );
    // Should include socat availability guard
    expect(result.entrypointPrefix).toContain('command -v socat');
  }, 10000);

  it('returns cleanup function that kills tunnel (R7.9)', async () => {
    mockValidConnection();
    const fakeProc = mockTunnelProcess();

    const result = await setupSshAgentPodmanMacOS([], '/tmp/auth.sock');
    expect(result.cleanup).toBeDefined();

    result.cleanup!();
    expect(fakeProc.kill).toHaveBeenCalledWith('SIGTERM');
  }, 10000);

  it('cleanup is idempotent (R7.10)', async () => {
    mockValidConnection();
    const fakeProc = mockTunnelProcess();

    const result = await setupSshAgentPodmanMacOS([], '/tmp/auth.sock');
    result.cleanup!();
    result.cleanup!(); // second call should not throw

    // kill is only called once due to idempotent guard
    expect(fakeProc.kill).toHaveBeenCalledTimes(1);
  }, 10000);

  it('warns and skips when --network already set (conflict guard)', async () => {
    mockValidConnection();
    const fakeProc = mockTunnelProcess();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Pre-populate args with a conflicting network flag
    const args = ['--network', 'none'];
    const result = await setupSshAgentPodmanMacOS(args, '/tmp/auth.sock');

    expect(result).toEqual({});
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('--network=none is already set'),
    );
    // Tunnel should be killed since we're bailing
    expect(fakeProc.kill).toHaveBeenCalledWith('SIGTERM');
  }, 10000);

  it('throws FatalSandboxError when tunnel fails to start (R7.7)', async () => {
    mockValidConnection();
    mockTunnelProcess(1); // exitCode=1 means process died

    await expect(
      setupSshAgentPodmanMacOS([], '/tmp/auth.sock'),
    ).rejects.toThrow(/SSH tunnel process failed to start/);
  }, 10000);

  it('throws when poll timeout expires and TCP port never ready (R7.4)', async () => {
    vi.mocked(child_process.execSync).mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('connection list')) {
        return Buffer.from(
          JSON.stringify([
            {
              Name: 'default',
              URI: 'ssh://core@localhost:12345/run/podman/podman.sock',
              Identity: '/Users/test/.ssh/key',
              Default: true,
            },
          ]),
        );
      }
      // ss -tln always fails: port never appears
      if (cmdStr.includes('ss -tln')) {
        throw new Error('port not found');
      }
      return Buffer.from('');
    });
    mockTunnelProcess();

    // Use a very short poll timeout so test runs quickly
    await expect(
      setupSshAgentPodmanMacOS([], '/tmp/auth.sock', 800),
    ).rejects.toThrow(/SSH agent forwarding timed out/);
  }, 10000);

  it('kills tunnel process when poll timeout expires (R7.8)', async () => {
    vi.mocked(child_process.execSync).mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr.includes('connection list')) {
        return Buffer.from(
          JSON.stringify([
            {
              Name: 'default',
              URI: 'ssh://core@localhost:12345/run/podman/podman.sock',
              Identity: '/Users/test/.ssh/key',
              Default: true,
            },
          ]),
        );
      }
      // ss -tln always fails
      if (cmdStr.includes('ss -tln')) {
        throw new Error('port not found');
      }
      return Buffer.from('');
    });
    const fakeProc = mockTunnelProcess();

    try {
      await setupSshAgentPodmanMacOS([], '/tmp/auth.sock', 800);
    } catch {
      // Expected to throw
    }

    // Tunnel process should have been killed on timeout
    expect(fakeProc.kill).toHaveBeenCalledWith('SIGTERM');
  }, 10000);
});
