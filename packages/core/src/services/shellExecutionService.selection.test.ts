/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import EventEmitter from 'events';
import type { Readable } from 'stream';
import { type ChildProcess } from 'child_process';
import type { ShellOutputEvent } from './shellExecutionService.js';
import { ShellExecutionService } from './shellExecutionService.js';

// Hoisted Mocks
const mockPtySpawn = vi.hoisted(() => vi.fn());
const mockCpSpawn = vi.hoisted(() => vi.fn());
const mockIsBinary = vi.hoisted(() => vi.fn());
const mockPlatform = vi.hoisted(() => vi.fn());
const mockGetPty = vi.hoisted(() => vi.fn());

// Top-level Mocks
vi.mock('@lydell/node-pty', () => ({
  spawn: mockPtySpawn,
}));
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    spawn: mockCpSpawn,
  };
});
vi.mock('../utils/textUtils.js', () => ({
  isBinary: mockIsBinary,
}));
vi.mock('os', () => ({
  default: {
    platform: mockPlatform,
    homedir: () => '/tmp/test-home',
    constants: {
      signals: {
        SIGTERM: 15,
        SIGKILL: 9,
      },
    },
  },
  platform: mockPlatform,
  homedir: () => '/tmp/test-home',
  constants: {
    signals: {
      SIGTERM: 15,
      SIGKILL: 9,
    },
  },
}));
vi.mock('../utils/getPty.js', () => ({
  getPty: mockGetPty,
}));

describe('Shell Environment Sanitization', () => {
  describe('sanitizeEnvironment', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      // Reset process.env before each test
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should only forward allowlisted vars in sandbox/CI mode', () => {
      const testEnv = {
        PATH: '/usr/bin',
        HOME: '/home/user',
        API_KEY: 'test-api-key-placeholder',
        AWS_SECRET_ACCESS_KEY: 'test-aws-placeholder',
        GITHUB_TOKEN: 'test-token-placeholder',
        SECRET_PASSWORD: 'test-password-placeholder',
        DATABASE_PASSWORD: 'test-dbpass-placeholder',
        PRIVATE_KEY: 'test-privkey-placeholder',
        SAFE_VAR: 'safe-value',
        NODE_ENV: 'test',
        EDITOR: 'vim',
      };

      const sanitized = ShellExecutionService.sanitizeEnvironment(
        testEnv,
        true,
      );

      // Built-in allowlisted vars should be preserved
      expect(sanitized.PATH).toBe('/usr/bin');
      expect(sanitized.HOME).toBe('/home/user');

      // Everything not on the allowlist should be excluded
      expect(sanitized.API_KEY).toBeUndefined();
      expect(sanitized.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(sanitized.GITHUB_TOKEN).toBeUndefined();
      expect(sanitized.SECRET_PASSWORD).toBeUndefined();
      expect(sanitized.DATABASE_PASSWORD).toBeUndefined();
      expect(sanitized.PRIVATE_KEY).toBeUndefined();
      expect(sanitized.SAFE_VAR).toBeUndefined();
      expect(sanitized.NODE_ENV).toBeUndefined();
      expect(sanitized.EDITOR).toBeUndefined();
    });

    it('should forward all LLXPRT_* prefixed variables (legacy test - updated)', () => {
      const testEnv = {
        PATH: '/usr/bin',
        LLXPRT_CODE_TEST_MODE: 'true',
        LLXPRT_CODE_TEST_TIMEOUT: '5000',
        LLXPRT_DEBUG: '1',
        LLXPRT_CODE: '1',
        LLXPRT_CONFIG_PATH: '/path/to/config',
      };

      const sanitized = ShellExecutionService.sanitizeEnvironment(
        testEnv,
        true,
      );

      // All LLXPRT_* vars should be preserved (changed from LLXPRT_CODE*)
      expect(sanitized.LLXPRT_CODE_TEST_MODE).toBe('true');
      expect(sanitized.LLXPRT_CODE_TEST_TIMEOUT).toBe('5000');
      expect(sanitized.LLXPRT_CODE).toBe('1');
      expect(sanitized.LLXPRT_DEBUG).toBe('1');
      expect(sanitized.LLXPRT_CONFIG_PATH).toBe('/path/to/config');
    });

    it('should forward all built-in Unix safe vars', () => {
      const testEnv = {
        PATH: '/usr/bin:/bin',
        HOME: '/home/user',
        USER: 'testuser',
        SHELL: '/bin/bash',
        TMPDIR: '/tmp',
        LANG: 'en_US.UTF-8',
        LOGNAME: 'testuser',
      };

      const sanitized = ShellExecutionService.sanitizeEnvironment(
        testEnv,
        true,
      );

      expect(sanitized.PATH).toBe('/usr/bin:/bin');
      expect(sanitized.HOME).toBe('/home/user');
      expect(sanitized.USER).toBe('testuser');
      expect(sanitized.SHELL).toBe('/bin/bash');
      expect(sanitized.TMPDIR).toBe('/tmp');
      expect(sanitized.LANG).toBe('en_US.UTF-8');
      expect(sanitized.LOGNAME).toBe('testuser');
    });

    it('should forward all built-in Windows safe vars', () => {
      const testEnv = {
        Path: 'C:\\Windows',
        SYSTEMROOT: 'C:\\Windows',
        SystemRoot: 'C:\\Windows',
        COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
        PATHEXT: '.COM;.EXE;.BAT',
        WINDIR: 'C:\\Windows',
        TEMP: 'C:\\Users\\test\\AppData\\Local\\Temp',
        TMP: 'C:\\Users\\test\\AppData\\Local\\Temp',
        USERPROFILE: 'C:\\Users\\test',
        SYSTEMDRIVE: 'C:',
        SystemDrive: 'C:',
      };

      const sanitized = ShellExecutionService.sanitizeEnvironment(
        testEnv,
        true,
      );

      expect(sanitized.Path).toBe('C:\\Windows');
      expect(sanitized.SYSTEMROOT).toBe('C:\\Windows');
      expect(sanitized.SystemRoot).toBe('C:\\Windows');
      expect(sanitized.COMSPEC).toBe('C:\\Windows\\System32\\cmd.exe');
      expect(sanitized.ComSpec).toBe('C:\\Windows\\System32\\cmd.exe');
      expect(sanitized.PATHEXT).toBe('.COM;.EXE;.BAT');
      expect(sanitized.WINDIR).toBe('C:\\Windows');
      expect(sanitized.TEMP).toBe('C:\\Users\\test\\AppData\\Local\\Temp');
      expect(sanitized.TMP).toBe('C:\\Users\\test\\AppData\\Local\\Temp');
      expect(sanitized.USERPROFILE).toBe('C:\\Users\\test');
      expect(sanitized.SYSTEMDRIVE).toBe('C:');
      expect(sanitized.SystemDrive).toBe('C:');
    });

    it('should forward user-specified allowlist variables', () => {
      const testEnv = {
        PATH: '/usr/bin',
        CUSTOM_VAR: 'custom-value',
        SPECIAL_CONFIG: 'special',
        OTHER_VAR: 'other',
      };

      const allowlist = ['CUSTOM_VAR', 'SPECIAL_CONFIG'];
      const sanitized = ShellExecutionService.sanitizeEnvironment(
        testEnv,
        true,
        allowlist,
      );

      // Allowlisted vars should be preserved
      expect(sanitized.PATH).toBe('/usr/bin');
      expect(sanitized.CUSTOM_VAR).toBe('custom-value');
      expect(sanitized.SPECIAL_CONFIG).toBe('special');

      // Non-allowlisted vars should be excluded
      expect(sanitized.OTHER_VAR).toBeUndefined();
    });

    it('should not sanitize when isSandboxOrCI is false (local dev mode)', () => {
      const testEnv = {
        PATH: '/usr/bin',
        API_KEY: 'secret-key',
        AWS_SECRET_ACCESS_KEY: 'aws-secret',
        GITHUB_TOKEN: 'token',
        CUSTOM_VAR: 'value',
      };

      const sanitized = ShellExecutionService.sanitizeEnvironment(
        testEnv,
        false, // Not in CI/sandbox mode
      );

      // All vars should be preserved in local dev mode
      expect(sanitized.PATH).toBe('/usr/bin');
      expect(sanitized.API_KEY).toBe('secret-key');
      expect(sanitized.AWS_SECRET_ACCESS_KEY).toBe('aws-secret');
      expect(sanitized.GITHUB_TOKEN).toBe('token');
      expect(sanitized.CUSTOM_VAR).toBe('value');
    });

    it('should exclude vars not on allowlist even if they look safe', () => {
      const testEnv = {
        PATH: '/usr/bin',
        GIT_AUTHOR_NAME: 'Test User',
        SSH_AUTH_SOCK: '/tmp/ssh-agent.sock',
        XDG_CONFIG_HOME: '/home/user/.config',
        CI: 'true',
        GITHUB_ACTIONS: 'true',
        NODE_ENV: 'test',
        TERM: 'xterm-256color',
      };

      const sanitized = ShellExecutionService.sanitizeEnvironment(
        testEnv,
        true,
      );

      // Only PATH is on the built-in allowlist
      expect(sanitized.PATH).toBe('/usr/bin');

      // TERM is on the allowlist (needed for proper terminal behavior)
      expect(sanitized.TERM).toBe('xterm-256color');

      // None of these are on the allowlist
      expect(sanitized.GIT_AUTHOR_NAME).toBeUndefined();
      expect(sanitized.SSH_AUTH_SOCK).toBeUndefined();
      expect(sanitized.XDG_CONFIG_HOME).toBeUndefined();
      expect(sanitized.CI).toBeUndefined();
      expect(sanitized.GITHUB_ACTIONS).toBeUndefined();
      expect(sanitized.NODE_ENV).toBeUndefined();
    });

    it('should return only allowlisted keys with no extras', () => {
      const testEnv = {
        PATH: '/usr/bin',
        HOME: '/home/user',
        USER: 'testuser',
        LLXPRT_CODE_TEST_FOO: 'bar',
        LLXPRT_CUSTOM: 'custom-value',
        RANDOM_VAR: 'should-not-appear',
        ANOTHER_SECRET: 'nope',
      };

      const sanitized = ShellExecutionService.sanitizeEnvironment(
        testEnv,
        true,
      );

      // Result should contain exactly the allowlisted vars that exist in env
      // All LLXPRT_* vars are now allowed (changed from LLXPRT_CODE* only)
      expect(Object.keys(sanitized).sort()).toStrictEqual(
        [
          'HOME',
          'LLXPRT_CODE_TEST_FOO',
          'LLXPRT_CUSTOM',
          'PATH',
          'USER',
        ].sort(),
      );
    });

    it('should forward GitHub Actions environment variables in sandbox/CI mode', () => {
      const testEnv = {
        PATH: '/usr/bin',
        HOME: '/home/user',
        // GitHub Actions-related variables
        ADDITIONAL_CONTEXT: 'some context',
        AVAILABLE_LABELS: 'bug,enhancement',
        BRANCH_NAME: 'main',
        DESCRIPTION: 'PR description',
        EVENT_NAME: 'pull_request',
        GITHUB_ENV: '/home/runner/work/_temp/_runner_file_commands/set_env_',
        IS_PULL_REQUEST: 'true',
        ISSUES_TO_TRIAGE: '123,456',
        ISSUE_BODY: 'Issue body text',
        ISSUE_NUMBER: '789',
        ISSUE_TITLE: 'Issue title',
        PULL_REQUEST_NUMBER: '101',
        REPOSITORY: 'owner/repo',
        TITLE: 'PR title',
        TRIGGERING_ACTOR: 'username',
        // Non-allowlisted var
        SECRET_TOKEN: 'should-not-pass',
      };

      const sanitized = ShellExecutionService.sanitizeEnvironment(
        testEnv,
        true,
      );

      // Built-in safe vars should be preserved
      expect(sanitized.PATH).toBe('/usr/bin');
      expect(sanitized.HOME).toBe('/home/user');

      // GitHub Actions variables should be preserved
      expect(sanitized.ADDITIONAL_CONTEXT).toBe('some context');
      expect(sanitized.AVAILABLE_LABELS).toBe('bug,enhancement');
      expect(sanitized.BRANCH_NAME).toBe('main');
      expect(sanitized.DESCRIPTION).toBe('PR description');
      expect(sanitized.EVENT_NAME).toBe('pull_request');
      expect(sanitized.GITHUB_ENV).toBe(
        '/home/runner/work/_temp/_runner_file_commands/set_env_',
      );
      expect(sanitized.IS_PULL_REQUEST).toBe('true');
      expect(sanitized.ISSUES_TO_TRIAGE).toBe('123,456');
      expect(sanitized.ISSUE_BODY).toBe('Issue body text');
      expect(sanitized.ISSUE_NUMBER).toBe('789');
      expect(sanitized.ISSUE_TITLE).toBe('Issue title');
      expect(sanitized.PULL_REQUEST_NUMBER).toBe('101');
      expect(sanitized.REPOSITORY).toBe('owner/repo');
      expect(sanitized.TITLE).toBe('PR title');
      expect(sanitized.TRIGGERING_ACTOR).toBe('username');

      // Secret tokens should not pass through
      expect(sanitized.SECRET_TOKEN).toBeUndefined();
    });

    it('should forward all LLXPRT_* prefixed variables in sandbox/CI mode', () => {
      const testEnv = {
        PATH: '/usr/bin',
        LLXPRT_CODE: '1',
        LLXPRT_CODE_TEST_MODE: 'true',
        LLXPRT_DEBUG: '1',
        LLXPRT_CONFIG_PATH: '/path/to/config',
        LLXPRT_SECRET_KEY: 'secret-value',
        LLXPRT_API_TOKEN: 'api-token',
        OTHER_VAR: 'should-not-pass',
      };

      const sanitized = ShellExecutionService.sanitizeEnvironment(
        testEnv,
        true,
      );

      // All LLXPRT_* vars should be preserved (broadened from LLXPRT_CODE*)
      expect(sanitized.LLXPRT_CODE).toBe('1');
      expect(sanitized.LLXPRT_CODE_TEST_MODE).toBe('true');
      expect(sanitized.LLXPRT_DEBUG).toBe('1');
      expect(sanitized.LLXPRT_CONFIG_PATH).toBe('/path/to/config');
      expect(sanitized.LLXPRT_SECRET_KEY).toBe('secret-value');
      expect(sanitized.LLXPRT_API_TOKEN).toBe('api-token');

      // Non-LLXPRT vars should not pass through
      expect(sanitized.OTHER_VAR).toBeUndefined();
    });
  });
});

describe('ShellExecutionService execution method selection', () => {
  let onOutputEventMock: Mock<(event: ShellOutputEvent) => void>;
  let mockPtyProcess: EventEmitter & {
    pid: number;
    kill: Mock;
    onData: Mock;
    onExit: Mock;
  };
  let mockChildProcess: EventEmitter & Partial<ChildProcess>;

  beforeEach(() => {
    vi.clearAllMocks();
    onOutputEventMock = vi.fn();

    // Mock for pty
    mockPtyProcess = new EventEmitter() as EventEmitter & {
      pid: number;
      kill: Mock;
      onData: Mock;
      onExit: Mock;
    };
    mockPtyProcess.pid = 12345;
    mockPtyProcess.kill = vi.fn();
    mockPtyProcess.onData = vi.fn().mockReturnValue({ dispose: vi.fn() });
    mockPtyProcess.onExit = vi.fn().mockReturnValue({ dispose: vi.fn() });
    mockPtySpawn.mockReturnValue(mockPtyProcess);
    mockGetPty.mockResolvedValue({
      module: { spawn: mockPtySpawn },
      name: 'mock-pty',
    });

    // Mock for child_process
    mockChildProcess = new EventEmitter() as EventEmitter &
      Partial<ChildProcess>;
    mockChildProcess.stdout = new EventEmitter() as Readable;
    mockChildProcess.stderr = new EventEmitter() as Readable;
    mockChildProcess.kill = vi.fn();
    Object.defineProperty(mockChildProcess, 'pid', {
      value: 54321,
      configurable: true,
    });
    mockChildProcess.once = mockChildProcess.on.bind(mockChildProcess);
    mockCpSpawn.mockReturnValue(mockChildProcess);
  });

  // Default shell execution config for tests
  const defaultShellConfig = {
    showColor: false,
    scrollback: 600000,
    terminalWidth: 80,
    terminalHeight: 24,
  };

  it('should use node-pty when shouldUseNodePty is true and pty is available', async () => {
    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      'test command',
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      true, // shouldUseNodePty
      defaultShellConfig,
    );

    // Simulate exit to allow promise to resolve
    mockPtyProcess.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
    const result = await handle.result;

    expect(mockGetPty).toHaveBeenCalled();
    expect(mockPtySpawn).toHaveBeenCalled();
    expect(mockCpSpawn).not.toHaveBeenCalled();
    expect(result.executionMethod).toBe('mock-pty');
  });

  it('should use child_process when shouldUseNodePty is false', async () => {
    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      'test command',
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      false, // shouldUseNodePty
      defaultShellConfig,
    );

    // Simulate exit to allow promise to resolve
    mockChildProcess.emit('exit', 0, null);
    const result = await handle.result;

    expect(mockGetPty).not.toHaveBeenCalled();
    expect(mockPtySpawn).not.toHaveBeenCalled();
    expect(mockCpSpawn).toHaveBeenCalled();
    expect(result.executionMethod).toBe('child_process');
  });

  it('should fall back to child_process if pty is not available even if shouldUseNodePty is true', async () => {
    mockGetPty.mockResolvedValue(null);

    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      'test command',
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      true, // shouldUseNodePty
      defaultShellConfig,
    );

    // Simulate exit to allow promise to resolve
    mockChildProcess.emit('exit', 0, null);
    const result = await handle.result;

    expect(mockGetPty).toHaveBeenCalled();
    expect(mockPtySpawn).not.toHaveBeenCalled();
    expect(mockCpSpawn).toHaveBeenCalled();
    expect(result.executionMethod).toBe('child_process');
  });
});

describe('ShellExecutionService environment sanitization wiring', () => {
  let onOutputEventMock: Mock<(event: ShellOutputEvent) => void>;
  let mockPtyProcess: EventEmitter & {
    pid: number;
    kill: Mock;
    onData: Mock;
    onExit: Mock;
  };
  let mockChildProcess: EventEmitter & Partial<ChildProcess>;

  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    onOutputEventMock = vi.fn();

    // Reset process.env to a copy, preserving the real special object for afterEach restore
    process.env = { ...originalEnv };

    // Inject a sensitive env var so we can verify it gets stripped
    process.env.MY_API_KEY = 'super-secret';
    process.env.LLXPRT_CODE_TEST_WIRING = 'keep-me';

    // Mock for pty
    mockPtyProcess = new EventEmitter() as EventEmitter & {
      pid: number;
      kill: Mock;
      onData: Mock;
      onExit: Mock;
    };
    mockPtyProcess.pid = 12345;
    mockPtyProcess.kill = vi.fn();
    mockPtyProcess.onData = vi.fn().mockReturnValue({ dispose: vi.fn() });
    mockPtyProcess.onExit = vi.fn().mockReturnValue({ dispose: vi.fn() });
    mockPtySpawn.mockReturnValue(mockPtyProcess);
    mockGetPty.mockResolvedValue({
      module: { spawn: mockPtySpawn },
      name: 'mock-pty',
    });

    // Mock for child_process
    mockChildProcess = new EventEmitter() as EventEmitter &
      Partial<ChildProcess>;
    mockChildProcess.stdout = new EventEmitter() as Readable;
    mockChildProcess.stderr = new EventEmitter() as Readable;
    mockChildProcess.kill = vi.fn();
    Object.defineProperty(mockChildProcess, 'pid', {
      value: 54321,
      configurable: true,
    });
    mockChildProcess.once = mockChildProcess.on.bind(mockChildProcess);
    mockCpSpawn.mockReturnValue(mockChildProcess);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should strip sensitive env vars in child_process mode when isSandboxOrCI is true', async () => {
    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      'echo test',
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      false, // child_process mode
      { isSandboxOrCI: true },
    );

    // Verify the env passed to spawn does NOT contain the sensitive var
    const spawnCall = mockCpSpawn.mock.calls[0];
    const spawnEnv = spawnCall[2].env;
    expect(spawnEnv.MY_API_KEY).toBeUndefined();
    expect(spawnEnv.LLXPRT_CODE_TEST_WIRING).toBe('keep-me');

    // Cleanup
    mockChildProcess.emit('exit', 0, null);
    await handle.result;
  });

  it('should strip sensitive env vars in PTY mode when isSandboxOrCI is true', async () => {
    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      'echo test',
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      true, // PTY mode
      {
        isSandboxOrCI: true,
        terminalWidth: 80,
        terminalHeight: 24,
      },
    );

    // Verify the env passed to pty spawn does NOT contain the sensitive var
    const ptySpawnCall = mockPtySpawn.mock.calls[0];
    const ptyEnv = ptySpawnCall[2].env;
    expect(ptyEnv.MY_API_KEY).toBeUndefined();
    expect(ptyEnv.LLXPRT_CODE_TEST_WIRING).toBe('keep-me');

    // Cleanup
    mockPtyProcess.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
    await handle.result;
  });

  it('should NOT strip sensitive env vars in child_process mode when isSandboxOrCI is false', async () => {
    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      'echo test',
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      false, // child_process mode
      { isSandboxOrCI: false },
    );

    // Verify the env passed to spawn DOES contain all vars (local mode)
    const spawnCall = mockCpSpawn.mock.calls[0];
    const spawnEnv = spawnCall[2].env;
    expect(spawnEnv.MY_API_KEY).toBe('super-secret');
    expect(spawnEnv.LLXPRT_CODE_TEST_WIRING).toBe('keep-me');

    // Cleanup
    mockChildProcess.emit('exit', 0, null);
    await handle.result;
  });

  it('should NOT strip sensitive env vars when isSandboxOrCI is not set (defaults to local mode)', async () => {
    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      'echo test',
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      false, // child_process mode
      {}, // no isSandboxOrCI
    );

    // Verify the env passed to spawn DOES contain all vars (local mode)
    const spawnCall = mockCpSpawn.mock.calls[0];
    const spawnEnv = spawnCall[2].env;
    expect(spawnEnv.MY_API_KEY).toBe('super-secret');
    expect(spawnEnv.LLXPRT_CODE_TEST_WIRING).toBe('keep-me');

    // Cleanup
    mockChildProcess.emit('exit', 0, null);
    await handle.result;
  });
});
