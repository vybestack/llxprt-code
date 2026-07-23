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
    // Hostile argv: spaces, Unicode, and Windows shell metacharacters. A
    // concatenating (shell-string) implementation would fail these assertions.
    const args = [
      'exec',
      '--',
      'name with spaces',
      'Δ',
      'a&b',
      'x|y',
      'per%cent',
      'bang!',
      'semi;colon',
      'lt<gt',
      'paren(thesis)',
      'caret^hat',
      'quote"s',
    ];
    const inv = npmInvocation(args, {
      platform: 'win32',
      execPath: 'C:\\node\\node.exe',
      env: { npm_execpath: 'C:\\npm\\bin\\npm-cli.js' },
      existsSync: (p) => p === 'C:\\npm\\bin\\npm-cli.js',
    });
    expect(inv.command).toBe('C:\\node\\node.exe');
    // The first arg is the resolved npm-cli.js; the remaining args must be
    // preserved exactly as boundaries — no shell concatenation.
    expect(inv.args).toStrictEqual(['C:\\npm\\bin\\npm-cli.js', ...args]);
  });

  it('default Windows args structure is [npm-cli.js, ...userArgs] with no shell flag', () => {
    // Default (no env injection) must still resolve via the node-dir fallback
    // and produce a node command with npm-cli.js as args[0].
    const inv = npmInvocation(['pack'], {
      platform: 'win32',
      execPath: 'C:\\node\\node.exe',
      env: {},
      existsSync: () => true,
    });
    expect(inv.command).toBe('C:\\node\\node.exe');
    expect(inv.args[0]).toMatch(/npm-cli\.js$/);
    expect(inv.args.slice(1)).toStrictEqual(['pack']);
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

  it('rejects a relative npm_execpath (must be absolute)', () => {
    // A relative npm_execpath could be hijacked by a CWD-dependent path; the
    // resolver must require an absolute path so the resolved CLI is stable.
    const result = resolveNpmCliJs({
      env: { npm_execpath: 'relative/npm-cli.js' },
      existsSync: () => true,
    });
    expect(result).not.toBe('relative/npm-cli.js');
    // Falls through to the node-dir fallback.
    expect(result).toMatch(/node_modules[/]npm[/]bin[/]npm-cli\.js$/);
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

  it('throws NpmCliNotFoundError when npm_execpath is set but invalid and fallback is missing', () => {
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
    // The error must list BOTH the invalid npm_execpath candidate AND the
    // node-dir fallback path so the failure is actionable.
    expect((threw as Error).message).toContain('C:\\missing\\npm-cli.js');
    expect((threw as Error).message).toMatch(/node_modules[\\/]npm/);
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

  describe('resolveNpmCliJs rejects pnpm/yarn npm_execpath (security)', () => {
    // pnpm and Yarn also set npm_execpath during lifecycle scripts. The resolver
    // must only trust npm-cli.js (basename check) so the wrong package manager
    // CLI is never spawned.
    it('rejects a pnpm npm_execpath and falls through to the node-dir fallback', () => {
      const result = resolveNpmCliJs({
        env: { npm_execpath: 'C:\\pnpm\\pnpm-cli.js' },
        execPath: 'C:\\node\\node.exe',
        existsSync: () => true,
      });
      expect(result).not.toBe('C:\\pnpm\\pnpm-cli.js');
      expect(result).toMatch(/node_modules[\\/]npm[\\/]bin[\\/]npm-cli\.js$/);
    });

    it('rejects a yarn npm_execpath and falls through to the node-dir fallback', () => {
      const result = resolveNpmCliJs({
        env: { npm_execpath: 'C:\\yarn\\yarn-cli.js' },
        execPath: 'C:\\node\\node.exe',
        existsSync: () => true,
      });
      expect(result).not.toBe('C:\\yarn\\yarn-cli.js');
      expect(result).toMatch(/node_modules[\\/]npm[\\/]bin[\\/]npm-cli\.js$/);
    });
  });

  describe('resolveNpmCliJs NPM_CONFIG_PREFIX fallback', () => {
    it('resolves npm-cli.js from NPM_CONFIG_PREFIX when node-dir fallback is absent', () => {
      // Simulate nvm-windows / Volta where npm is NOT alongside node.exe.
      // path.join on POSIX uses forward slashes for the appended segments;
      // the Windows prefix may contain backslashes. The existsSync stub matches
      // the exact joined path.
      const prefixPath = 'C:\\Users\\dev\\AppData\\Roaming\\npm';
      const result = resolveNpmCliJs({
        env: { NPM_CONFIG_PREFIX: prefixPath },
        execPath: 'C:\\node\\node.exe',
        existsSync: (p) => p.endsWith('npm-cli.js') && p.includes(prefixPath),
      });
      expect(result).toContain('npm-cli.js');
      expect(result).toContain(prefixPath);
    });

    it('resolves from APPDATA when NPM_CONFIG_PREFIX is absent', () => {
      // nvm-windows global npm roaming install location.
      const appdataPath = 'C:\\Users\\dev\\AppData\\Roaming';
      const result = resolveNpmCliJs({
        env: { APPDATA: appdataPath },
        execPath: 'C:\\node\\node.exe',
        existsSync: (p) =>
          p.endsWith('npm-cli.js') &&
          p.includes(appdataPath) &&
          p.includes('npm'),
      });
      expect(result).toContain('npm-cli.js');
      expect(result).toContain(appdataPath);
    });

    it('throws NpmCliNotFoundError when neither prefix fallback exists', () => {
      expect(() =>
        resolveNpmCliJs({
          env: {
            NPM_CONFIG_PREFIX: 'C:\\prefix',
            APPDATA: 'C:\\appdata',
          },
          execPath: 'C:\\node\\node.exe',
          existsSync: () => false,
        }),
      ).toThrow(NpmCliNotFoundError);
    });

    it('includes prefix probed paths in the error details when all fail', () => {
      try {
        resolveNpmCliJs({
          env: {
            NPM_CONFIG_PREFIX: 'C:\\prefix',
            APPDATA: 'C:\\appdata',
          },
          execPath: 'C:\\node\\node.exe',
          existsSync: () => false,
        });
      } catch (e) {
        const err = e as Error & { details?: { probed: string[] } };
        expect(err.details).toBeDefined();
        // probed should include the NPM_CONFIG_PREFIX and APPDATA candidates.
        const probedStr = JSON.stringify(err.details?.probed);
        expect(probedStr).toContain('C:\\\\prefix');
        expect(probedStr).toContain('C:\\\\appdata');
      }
    });
  });
});
