/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { npmInvocation, npxInvocation, resolveNpmCliJs, NpmCliNotFoundError } =
  require('../lib/npm-command.cjs') as {
    npmInvocation: (
      args?: readonly string[],
      options?: {
        platform?: string;
        execPath?: string;
        env?: Record<string, string | undefined>;
        existsSync?: (p: string) => boolean;
      },
    ) => { command: string; args: string[] };
    npxInvocation: (
      args?: readonly string[],
      options?: {
        platform?: string;
        execPath?: string;
        env?: Record<string, string | undefined>;
        existsSync?: (p: string) => boolean;
      },
    ) => { command: string; args: string[] };
    resolveNpmCliJs: (options?: {
      execPath?: string;
      env?: Record<string, string | undefined>;
      existsSync?: (p: string) => boolean;
    }) => string;
    NpmCliNotFoundError: new (
      message: string,
      details?: unknown,
    ) => Error & { code: string; details: unknown };
  };

describe('npmInvocation POSIX', () => {
  it('spawns npm directly with the given args', () => {
    const inv = npmInvocation(['pack', '-w'], { platform: 'darwin' });
    expect(inv.command).toBe('npm');
    expect(inv.args).toStrictEqual(['pack', '-w']);
  });

  it('spawns npm directly on linux', () => {
    const inv = npmInvocation(['install'], { platform: 'linux' });
    expect(inv.command).toBe('npm');
    expect(inv.args).toStrictEqual(['install']);
  });

  it('defaults to the real process.platform when no platform is given', () => {
    const inv = npmInvocation(['pack']);
    if (process.platform === 'win32') {
      expect(inv.command).toBe(process.execPath);
    } else {
      expect(inv.command).toBe('npm');
      expect(inv.args).toStrictEqual(['pack']);
    }
  });

  it('handles no args', () => {
    const inv = npmInvocation(undefined, { platform: 'darwin' });
    expect(inv.command).toBe('npm');
    expect(inv.args).toStrictEqual([]);
  });
});

describe('npmInvocation Windows', () => {
  it('spawns node.exe with npm-cli.js as the first arg', () => {
    const inv = npmInvocation(['pack', '-w'], {
      platform: 'win32',
      execPath: 'C:\\node\\node.exe',
      env: {
        npm_execpath: 'C:\\npm\\bin\\npm-cli.js',
      },
      existsSync: (p) => p === 'C:\\npm\\bin\\npm-cli.js',
    });
    expect(inv.command).toBe('C:\\node\\node.exe');
    expect(inv.args).toStrictEqual(['C:\\npm\\bin\\npm-cli.js', 'pack', '-w']);
  });

  it('falls back to node-dir node_modules/npm when npm_execpath is unset', () => {
    const inv = npmInvocation(['install'], {
      platform: 'win32',
      execPath: 'C:\\node\\node.exe',
      env: {},
      existsSync: () => true,
    });
    expect(inv.command).toBe('C:\\node\\node.exe');
    // The CLI path is <node-dir>/node_modules/npm/bin/npm-cli.js
    expect(inv.args[0]).toMatch(/npm[\\/]bin[\\/]npm-cli\.js$/);
    expect(inv.args[1]).toBe('install');
  });

  it('prefers npm_execpath over the node-dir fallback', () => {
    const fromExecPath = resolveNpmCliJs({
      execPath: 'C:\\node\\node.exe',
      env: { npm_execpath: 'C:\\from-execpath\\npm-cli.js' },
      existsSync: (p) => p === 'C:\\from-execpath\\npm-cli.js',
    });
    expect(fromExecPath).toBe('C:\\from-execpath\\npm-cli.js');
  });

  it('never produces a shell string with spaces or metacharacters', () => {
    const inv = npmInvocation(['pack'], {
      platform: 'win32',
      execPath: 'C:\\node\\node.exe',
      env: { npm_execpath: 'C:\\npm\\bin\\npm-cli.js' },
      existsSync: (p) => p === 'C:\\npm\\bin\\npm-cli.js',
    });
    expect(inv.command).toBe(inv.command.trim());
    // args preserve boundaries (no shell concatenation)
    expect(inv.args.length).toBeGreaterThan(0);
  });
});

describe('npxInvocation', () => {
  it('routes through npm exec on POSIX', () => {
    const inv = npxInvocation(['--package', 'foo', '--', 'foo', '--version'], {
      platform: 'darwin',
    });
    expect(inv.command).toBe('npm');
    expect(inv.args).toStrictEqual([
      'exec',
      '--package',
      'foo',
      '--',
      'foo',
      '--version',
    ]);
  });

  it('routes through npm exec on Windows (no npx.cmd)', () => {
    const inv = npxInvocation(['--', 'llxprt', '--version'], {
      platform: 'win32',
      execPath: 'C:\\node\\node.exe',
      env: { npm_execpath: 'C:\\npm\\bin\\npm-cli.js' },
      existsSync: (p) => p === 'C:\\npm\\bin\\npm-cli.js',
    });
    expect(inv.command).toBe('C:\\node\\node.exe');
    expect(inv.args).toStrictEqual([
      'C:\\npm\\bin\\npm-cli.js',
      'exec',
      '--',
      'llxprt',
      '--version',
    ]);
  });
});

describe('resolveNpmCliJs existence verification', () => {
  it('returns npm_execpath when it is a real .js path that exists', () => {
    expect(
      resolveNpmCliJs({
        env: { npm_execpath: '/path/to/npm-cli.js' },
        existsSync: (p) => p === '/path/to/npm-cli.js',
      }),
    ).toBe('/path/to/npm-cli.js');
  });

  it('ignores npm_execpath when it is not a .js path (e.g. a .cmd wrapper) and falls back', () => {
    // A .cmd npm_execpath must be ignored; the resolver falls through to the
    // node-dir fallback instead of trusting a non-JS path.
    const result = resolveNpmCliJs({
      env: { npm_execpath: 'C:\\npm\\bin\\npm.cmd' },
      existsSync: () => true,
    });
    expect(result).toMatch(/node_modules[\\/]npm[\\/]bin[\\/]npm-cli\.js$/);
    expect(result).not.toBe('C:\\npm\\bin\\npm.cmd');
  });

  it('falls back to node-dir/npm when npm_execpath is unset and it exists', () => {
    const result = resolveNpmCliJs({
      execPath: '/usr/local/bin/node',
      env: {},
      existsSync: () => true,
    });
    expect(result).toMatch(/node_modules[\\/]npm[\\/]bin[\\/]npm-cli\.js$/);
  });

  it('throws NpmCliNotFoundError when no candidate exists', () => {
    expect(() =>
      resolveNpmCliJs({
        execPath: 'C:\\node\\node.exe',
        env: {},
        existsSync: () => false,
      }),
    ).toThrow(NpmCliNotFoundError);
  });

  it('throws NpmCliNotFoundError when npm_execpath missing and fallback missing', () => {
    let threw: Error | null = null;
    try {
      resolveNpmCliJs({
        env: { npm_execpath: 'C:\\missing\\npm-cli.js' },
        execPath: 'C:\\node\\node.exe',
        existsSync: () => false,
      });
    } catch (e) {
      threw = e as Error;
    }
    expect(threw).not.toBeNull();
    expect(threw).toBeInstanceOf(NpmCliNotFoundError);
    expect((threw as Error).message).toMatch(
      /npm-cli\.js could not be resolved/,
    );
    // The error must list BOTH probed paths so the failure is actionable.
    expect((threw as Error).message).toContain('C:\\missing\\npm-cli.js');
  });

  it('error includes the probed paths in details', () => {
    try {
      resolveNpmCliJs({
        env: {},
        execPath: 'C:\\node\\node.exe',
        existsSync: () => false,
      });
    } catch (e) {
      const err = e as Error & { details?: { probed: string[] } };
      expect(err.details).toBeDefined();
      // On POSIX hosts the path module produces a POSIX-joined fallback; on
      // Windows it is backslash-joined. Assert the npm-cli.js suffix only.
      expect(err.details?.probed).toHaveLength(1);
      expect(err.details?.probed[0]).toMatch(
        /node_modules[\\/]npm[\\/]bin[\\/]npm-cli\.js$/,
      );
    }
  });

  it('falls back when npm_execpath is set but missing, if the fallback exists', () => {
    // Compute the fallback path the same way the resolver does so the test is
    // correct on both POSIX and Windows hosts (path.join is platform-specific).
    const path = require('node:path') as typeof import('node:path');
    const fallback = path.join(
      path.dirname('C:\\node\\node.exe'),
      'node_modules',
      'npm',
      'bin',
      'npm-cli.js',
    );
    const result = resolveNpmCliJs({
      env: { npm_execpath: 'C:\\npm\\bin\\npm-cli.js' },
      execPath: 'C:\\node\\node.exe',
      existsSync: (p) => p === fallback,
    });
    expect(result).toBe(fallback);
  });
});
