/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for issue #2469: tmux harness isolation.
 *
 * scripts/tmux-harness-io.mjs must invoke every tmux command through a
 * dedicated private socket (-S <path>) and must scrub the inherited tmux
 * client environment variables (TMUX, TMUX_PANE, TMUX_TMPDIR) from the
 * subprocess environment so harness commands can never attach to / mutate an
 * outer tmux server that llxprt happens to be running inside.
 *
 * These tests mock node:child_process spawnSync and never start a real tmux
 * server.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Capture spawnSync calls. The module under test imports `spawnSync` from
// `node:child_process`, so we mock that specifier.
const { spawnSyncMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawnSync: (...args) => spawnSyncMock(...args),
}));

// Re-import fresh after the mock is registered so the module binds to the
// mocked spawnSync.
const {
  runTmux,
  tryTmux,
  buildTmuxSocketArgs,
  getTmuxSocketPath,
  cleanupTmuxSocketDir,
  TMUX_ENV_KEYS,
} = await import('../tmux-harness-io.mjs');

/**
 * Default successful spawnSync return value (utf8 encoding => stdout is a
 * string).
 */
function okReturn(stdout = '') {
  return {
    stdout,
    stderr: '',
    status: 0,
    error: undefined,
  };
}

function expectKillServerCall() {
  const killServerCall = spawnSyncMock.mock.calls.find(([, args]) =>
    args.includes('kill-server'),
  );
  expect(killServerCall).toBeDefined();
}

beforeEach(() => {
  spawnSyncMock.mockReset();
  spawnSyncMock.mockReturnValue(okReturn(''));
  cleanupTmuxSocketDir();
});

afterEach(() => {
  vi.unstubAllEnvs();
  spawnSyncMock.mockReset();
  spawnSyncMock.mockReturnValue(okReturn(''));
  // Remove the lazily-created socket temp directory if any test created one.
  cleanupTmuxSocketDir();
});

describe('issue #2469: cleanupTmuxSocketDir', () => {
  it('is a safe no-op when nothing was created', () => {
    expect(() => cleanupTmuxSocketDir()).not.toThrow();
    expect(() => cleanupTmuxSocketDir()).not.toThrow();
  });

  it('exports the expected tmux environment keys', () => {
    expect(TMUX_ENV_KEYS).toEqual(['TMUX', 'TMUX_PANE', 'TMUX_TMPDIR']);
  });

  it('keeps the cached socket path when cleanup fails', () => {
    const socketPath = getTmuxSocketPath();
    const rmSyncSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {
      throw new Error('EBUSY');
    });

    try {
      expect(() => cleanupTmuxSocketDir()).not.toThrow();
      expectKillServerCall();
      expect(getTmuxSocketPath()).toBe(socketPath);
    } finally {
      rmSyncSpy.mockRestore();
    }
    cleanupTmuxSocketDir();
  });

  it('keeps the cached socket path when kill-server fails', () => {
    const socketPath = getTmuxSocketPath();
    spawnSyncMock.mockReturnValue({
      stdout: '',
      stderr: 'kill failed',
      status: 1,
      error: undefined,
    });

    expect(() => cleanupTmuxSocketDir()).not.toThrow();
    expectKillServerCall();
    expect(getTmuxSocketPath()).toBe(socketPath);
    expect(fs.existsSync(path.dirname(socketPath))).toBe(true);
  });

  it('removes the socket directory when kill-server reports no server running', () => {
    const socketPath = getTmuxSocketPath();
    const dir = path.dirname(socketPath);
    spawnSyncMock.mockReturnValue({
      stdout: '',
      stderr: 'no server running',
      status: 1,
      error: undefined,
    });

    expect(() => cleanupTmuxSocketDir()).not.toThrow();
    expectKillServerCall();
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('keeps the cached socket path when kill-server has a spawn error', () => {
    const socketPath = getTmuxSocketPath();
    spawnSyncMock.mockReturnValue({
      stdout: '',
      stderr: '',
      status: null,
      error: new Error('spawn tmux ENOENT'),
    });

    expect(() => cleanupTmuxSocketDir()).not.toThrow();
    expectKillServerCall();
    expect(getTmuxSocketPath()).toBe(socketPath);
    expect(fs.existsSync(path.dirname(socketPath))).toBe(true);
  });

  it('keeps the cached socket path when kill-server throws synchronously', () => {
    const socketPath = getTmuxSocketPath();
    spawnSyncMock.mockImplementation(() => {
      throw new Error('sync throw in kill-server');
    });

    expect(() => cleanupTmuxSocketDir()).not.toThrow();
    expectKillServerCall();
    expect(getTmuxSocketPath()).toBe(socketPath);
    expect(fs.existsSync(path.dirname(socketPath))).toBe(true);
  });
});

describe('issue #2469: lazy socket temp directory', () => {
  it('does not create a temp directory until getTmuxSocketPath is called', () => {
    // After cleanupTmuxSocketDir, the socket path is null. Simply importing
    // the module must not create any temp directory. Calling getTmuxSocketPath
    // lazily creates one.
    cleanupTmuxSocketDir();

    const socketPath = getTmuxSocketPath();
    const dir = path.dirname(socketPath);
    expect(dir).toMatch(/llxprt-tmux-harness-/);
    expect(fs.existsSync(dir)).toBe(true);

    cleanupTmuxSocketDir();
    expect(fs.existsSync(dir)).toBe(false);
  });
});

describe('issue #2469: tmux socket isolation', () => {
  it('exposes a stable private socket path in a unique temp directory', () => {
    const socketPath = getTmuxSocketPath();
    expect(typeof socketPath).toBe('string');
    expect(socketPath.length).toBeGreaterThan(0);
    // Must be a -S style socket path (a filesystem path), not a fixed -L name.
    expect(socketPath).toMatch(/llxprt-tmux-harness-[^/\\]+[/\\\\]tmux\.sock$/);
    expect(getTmuxSocketPath()).toBe(socketPath);
  });

  it('creates a new directory after cleanup and re-access', () => {
    const first = getTmuxSocketPath();
    const firstDir = path.dirname(first);

    cleanupTmuxSocketDir();

    const second = getTmuxSocketPath();
    const secondDir = path.dirname(second);
    expect(second).not.toBe(first);
    expect(fs.existsSync(firstDir)).toBe(false);
    expect(fs.existsSync(secondDir)).toBe(true);
  });

  it('prefixes tmux args with -S <private socket path>', () => {
    runTmux(['list-sessions']);
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    const [command, args] = spawnSyncMock.mock.calls[0];
    const socketPath = getTmuxSocketPath();
    expect(command).toBe('tmux');
    expect(args[0]).toBe('-S');
    expect(args[1]).toBe(socketPath);
    // The caller-provided args follow the socket flag.
    expect(args.slice(2)).toEqual(['list-sessions']);
  });

  it('uses the dedicated socket flag rather than a fixed -L name', () => {
    runTmux(['kill-session', '-t', 'foo']);
    const [, args] = spawnSyncMock.mock.calls[0];
    // -S (socket path) is the isolation mechanism, not -L (named local socket).
    expect(args[0]).toBe('-S');
    expect(args[1]).toBe(getTmuxSocketPath());
    expect(args).not.toContain('-L');
  });

  it('lazily creates the socket path on the first runTmux call', () => {
    cleanupTmuxSocketDir();

    runTmux(['list-sessions']);

    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    const [, args] = spawnSyncMock.mock.calls[0];
    expect(args[0]).toBe('-S');
    expect(args[1]).toMatch(/llxprt-tmux-harness-[^/\\]+[/\\\\]tmux\.sock$/);
    expect(fs.existsSync(path.dirname(args[1]))).toBe(true);
  });
});

describe('issue #2469: scrub inherited tmux client env vars', () => {
  it('does not pass TMUX/TMUX_PANE/TMUX_TMPDIR through even when set in process.env', () => {
    vi.stubEnv('TMUX', '/tmp/tmux-1000/default,1234,0');
    vi.stubEnv('TMUX_PANE', '%1');
    vi.stubEnv('TMUX_TMPDIR', '/tmp/tmux-1000');

    runTmux(['list-sessions']);

    const [, , options] = spawnSyncMock.mock.calls[0];
    for (const key of TMUX_ENV_KEYS) {
      expect(options.env).not.toHaveProperty(key);
    }
  });

  it('scrubs tmux env vars when caller passes options.env explicitly', () => {
    vi.stubEnv('MY_PROCESS_VAR', 'survives-merge');
    vi.stubEnv('TMUX', '/tmp/tmux-1000/default,9999,0');
    vi.stubEnv('TMUX_PANE', '%99');
    vi.stubEnv('TMUX_TMPDIR', '/tmp/tmux-1000');
    runTmux(['list-sessions'], {
      env: {
        TMUX: '/tmp/tmux-1000/default,1234,0',
        TMUX_PANE: '%2',
        TMUX_TMPDIR: '/tmp/tmux-1000',
        MY_VAR: 'keep-me',
      },
    });

    const [, , options] = spawnSyncMock.mock.calls[0];
    for (const key of TMUX_ENV_KEYS) {
      expect(options.env).not.toHaveProperty(key);
    }
    // The merge of process.env plus caller env is covered: a process.env var
    // survives alongside the caller-provided var.
    expect(options.env.MY_PROCESS_VAR).toBe('survives-merge');
    expect(options.env.MY_VAR).toBe('keep-me');
  });

  it('preserves non-tmux env vars from process.env', () => {
    vi.stubEnv('MY_PROCESS_VAR', 'process-value');
    runTmux(['list-sessions']);
    const [, , options] = spawnSyncMock.mock.calls[0];
    expect(options.env.MY_PROCESS_VAR).toBe('process-value');
  });

  it('preserves non-tmux env vars and other options from caller options.env', () => {
    runTmux(['list-sessions'], {
      cwd: '/some/cwd',
      env: {
        MY_VAR: 'keep-me',
        PATH: '/usr/bin:/bin',
      },
    });

    const [, , options] = spawnSyncMock.mock.calls[0];
    expect(options.env.MY_VAR).toBe('keep-me');
    expect(options.env.PATH).toBe('/usr/bin:/bin');
    expect(options.cwd).toBe('/some/cwd');
    // encoding default preserved.
    expect(options.encoding).toBe('utf8');
  });

  it('handles options without an env property gracefully', () => {
    vi.stubEnv('TMUX', '/tmp/tmux-1000/default,1234,0');
    runTmux(['list-sessions'], { cwd: '/some/cwd' });

    const [, , options] = spawnSyncMock.mock.calls[0];
    expect(options.cwd).toBe('/some/cwd');
    expect(options.encoding).toBe('utf8');
    for (const key of TMUX_ENV_KEYS) {
      expect(options.env).not.toHaveProperty(key);
    }
  });

  it('forces utf8 encoding even when caller attempts to override it', () => {
    runTmux(['list-sessions'], {
      encoding: 'buffer',
      env: {},
    });

    const [, , options] = spawnSyncMock.mock.calls[0];
    expect(options.encoding).toBe('utf8');
  });
});

describe('issue #2469: error messages include socket flag', () => {
  it('throws an error whose message includes the -S socket flag on failure', () => {
    spawnSyncMock.mockReturnValue({
      stdout: '',
      stderr: 'no server running',
      status: 1,
      error: undefined,
    });

    // Capture the thrown error so the message assertions are guaranteed to
    // run (a bare try/catch after a separate toThrow can be silently skipped).
    let thrown = null;
    try {
      runTmux(['list-sessions']);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).not.toBeNull();
    expect(thrown.message).toContain('-S');
    // Should include the private socket path verbatim.
    expect(thrown.message).toContain(getTmuxSocketPath());
  });

  it('tryTmux swallows failures from isolated tmux invocations', () => {
    spawnSyncMock.mockReturnValue({
      stdout: '',
      stderr: 'boom',
      status: 1,
      error: undefined,
    });
    // tryTmux must invoke tmux through the isolated socket even though it
    // swallows failures, so assert the spawn args start with -S <socket>.
    expect(tryTmux(['list-sessions'])).toBeNull();
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    const [, args] = spawnSyncMock.mock.calls[0];
    expect(args[0]).toBe('-S');
    expect(args[1]).toBe(getTmuxSocketPath());
  });

  it('tryTmux also scrubs inherited tmux env vars', () => {
    vi.stubEnv('TMUX', '/tmp/tmux-1000/default,1234,0');
    vi.stubEnv('TMUX_PANE', '%1');
    vi.stubEnv('TMUX_TMPDIR', '/tmp/tmux-1000');

    expect(tryTmux(['list-sessions'])).toBe('');
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    const [, , options] = spawnSyncMock.mock.calls[0];
    for (const key of TMUX_ENV_KEYS) {
      expect(options.env).not.toHaveProperty(key);
    }
  });

  it('tryTmux returns stdout content on success', () => {
    spawnSyncMock.mockReturnValue(okReturn('session1\nsession2'));

    expect(tryTmux(['list-sessions'])).toBe('session1\nsession2');
  });

  it('throws the raw spawn error when spawnSync returns an error property', () => {
    const spawnError = new Error('spawn tmux ENOENT');
    spawnSyncMock.mockReturnValue({
      stdout: '',
      stderr: '',
      status: null,
      error: spawnError,
    });

    expect(() => runTmux(['list-sessions'])).toThrow(spawnError);
  });

  it('propagates a synchronous spawn throw through runTmux', () => {
    const spawnError = new Error('sync throw');
    spawnSyncMock.mockImplementation(() => {
      throw spawnError;
    });

    expect(() => runTmux(['list-sessions'])).toThrow(spawnError);
  });

  it('swallows a synchronous spawn throw through tryTmux', () => {
    spawnSyncMock.mockImplementation(() => {
      throw new Error('sync throw');
    });

    expect(tryTmux(['list-sessions'])).toBeNull();
  });
});

describe('buildTmuxSocketArgs pure helper', () => {
  it('prepends -S <socket path> to the provided args', () => {
    const result = buildTmuxSocketArgs(['list-sessions']);
    expect(result[0]).toBe('-S');
    expect(result[1]).toBe(getTmuxSocketPath());
    expect(result.slice(2)).toEqual(['list-sessions']);
  });

  it('does not mutate the input array', () => {
    const input = ['list-sessions'];
    buildTmuxSocketArgs(input);
    expect(input).toEqual(['list-sessions']);
  });
});
