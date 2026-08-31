/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for host-only capability env-file placement, reclamation,
 * permissions, and failure cleanup.
 *
 * @plan project-plans/issue-3440-capability-env-reclamation.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createHostOnlyCapabilityEnvFile,
  reclaimOrphanCapabilityDirs,
  type HostOnlyCapabilityResult,
} from './sandbox-capability.js';

const VALID_TOKEN = 'a'.repeat(64);

function useTempDir(
  registerBefore: (fn: () => void) => void,
  registerAfter: (fn: () => void) => void,
): () => string {
  let tmpDir = '';
  registerBefore(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scap-'));
  });
  registerAfter(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  return () => tmpDir;
}

function requireCapabilityResult(
  result: HostOnlyCapabilityResult | undefined,
): HostOnlyCapabilityResult {
  expect(result).toBeDefined();
  if (result === undefined) {
    throw new Error('Expected capability env-file result');
  }
  return result;
}

const realOsTmpdir: () => string = os.tmpdir;

/**
 * Overrides os.tmpdir for the code under test. Bun exposes os.tmpdir as an
 * accessor property, which vi.spyOn cannot wrap, and once TMPDIR is deleted
 * after being set, os.tmpdir keeps returning the stale value for the rest of
 * the process. Redefining the property avoids both pitfalls.
 */
function overrideOsTmpdir(value: string): void {
  Object.defineProperty(os, 'tmpdir', {
    value: () => value,
    configurable: true,
  });
}

function restoreOsTmpdir(): void {
  Object.defineProperty(os, 'tmpdir', {
    value: realOsTmpdir,
    configurable: true,
  });
}

describe('host-only capability env-file (AC1, F4)', () => {
  const getTmpDir = useTempDir(beforeEach, afterEach);
  let environmentSnapshot: NodeJS.ProcessEnv;
  let runtimeRoot = '';
  let isolatedHome = '';
  let sessionMount = '';

  beforeEach(() => {
    environmentSnapshot = { ...process.env };
    runtimeRoot = path.join(getTmpDir(), 'runtime');
    isolatedHome = path.join(getTmpDir(), 'home');
    fs.mkdirSync(runtimeRoot);
    fs.mkdirSync(isolatedHome);
    sessionMount = fs.mkdtempSync(path.join(runtimeRoot, 'llxprt-sandbox-'));
    process.env.LLXPRT_CAPABILITY_TOKEN = VALID_TOKEN;
    delete process.env.XDG_RUNTIME_DIR;
    overrideOsTmpdir(runtimeRoot);
    vi.spyOn(os, 'homedir').mockReturnValue(isolatedHome);
  });

  afterEach(() => {
    process.env = environmentSnapshot;
    restoreOsTmpdir();
    vi.restoreAllMocks();
  });

  it.skipIf(process.platform === 'win32')(
    'writes under the runtime root outside HOME and the session mount with mode 0700 dir / 0600 file; raw token not in argv',
    () => {
      const result = requireCapabilityResult(
        createHostOnlyCapabilityEnvFile(VALID_TOKEN),
      );
      const hostDir = path.dirname(result.envFilePath);

      try {
        expect(path.dirname(hostDir)).toBe(runtimeRoot);
        expect(hostDir.startsWith(`${isolatedHome}${path.sep}`)).toBe(false);
        expect(hostDir.startsWith(`${sessionMount}${path.sep}`)).toBe(false);
        expect(fs.statSync(hostDir).mode & 0o777).toBe(0o700);
        expect(fs.statSync(result.envFilePath).mode & 0o777).toBe(0o600);
        expect(fs.readFileSync(result.envFilePath, 'utf8')).toContain(
          VALID_TOKEN,
        );
        for (const arg of result.args) expect(arg).not.toContain(VALID_TOKEN);
        expect(result.args[result.args.indexOf('--env-file') + 1]).toBe(
          result.envFilePath,
        );
      } finally {
        result.cleanup();
      }
    },
  );

  it('places Linux capability files under XDG_RUNTIME_DIR when it is non-empty', () => {
    const xdgRuntimeRoot = path.join(getTmpDir(), 'xdg-runtime');
    fs.mkdirSync(xdgRuntimeRoot);
    process.env.XDG_RUNTIME_DIR = xdgRuntimeRoot;
    vi.spyOn(os, 'platform').mockReturnValue('linux');

    const result = requireCapabilityResult(
      createHostOnlyCapabilityEnvFile(VALID_TOKEN),
    );
    try {
      expect(path.dirname(path.dirname(result.envFilePath))).toBe(
        process.env.XDG_RUNTIME_DIR,
      );
    } finally {
      result.cleanup();
    }
  });

  it('places Linux capability files under os.tmpdir when XDG_RUNTIME_DIR is absent', () => {
    vi.spyOn(os, 'platform').mockReturnValue('linux');

    const result = requireCapabilityResult(
      createHostOnlyCapabilityEnvFile(VALID_TOKEN),
    );
    try {
      expect(path.dirname(path.dirname(result.envFilePath))).toBe(runtimeRoot);
    } finally {
      result.cleanup();
    }
  });

  it('places Linux capability files under os.tmpdir when XDG_RUNTIME_DIR is blank', () => {
    process.env.XDG_RUNTIME_DIR = '   ';
    vi.spyOn(os, 'platform').mockReturnValue('linux');

    const result = requireCapabilityResult(
      createHostOnlyCapabilityEnvFile(VALID_TOKEN),
    );
    try {
      expect(path.dirname(path.dirname(result.envFilePath))).toBe(runtimeRoot);
    } finally {
      result.cleanup();
    }
  });

  it('places Windows capability files under LOCALAPPDATA/llxprt-code', () => {
    const localAppData = path.join(getTmpDir(), 'local-app-data');
    process.env.LOCALAPPDATA = localAppData;
    vi.spyOn(os, 'platform').mockReturnValue('win32');

    const result = requireCapabilityResult(
      createHostOnlyCapabilityEnvFile(VALID_TOKEN),
    );
    try {
      expect(path.dirname(path.dirname(result.envFilePath))).toBe(
        path.join(localAppData, 'llxprt-code'),
      );
    } finally {
      result.cleanup();
    }
  });

  it('places Darwin capability files under os.tmpdir', () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin');

    const result = requireCapabilityResult(
      createHostOnlyCapabilityEnvFile(VALID_TOKEN),
    );
    try {
      expect(path.dirname(path.dirname(result.envFilePath))).toBe(runtimeRoot);
    } finally {
      result.cleanup();
    }
  });

  it('returns undefined when no capability token (tokenless path)', () => {
    expect(createHostOnlyCapabilityEnvFile(undefined)).toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')(
    'cleanup removes file+dir and is idempotent',
    () => {
      const result = requireCapabilityResult(
        createHostOnlyCapabilityEnvFile(VALID_TOKEN),
      );
      expect(fs.existsSync(result.envFilePath)).toBe(true);
      result.cleanup();
      expect(fs.existsSync(result.envFilePath)).toBe(false);
      expect(fs.existsSync(path.dirname(result.envFilePath))).toBe(false);
      expect(() => result.cleanup()).not.toThrow();
    },
  );

  it('a concurrent attacker cannot discover the host-only file via the narrowed session mount', () => {
    const result = requireCapabilityResult(
      createHostOnlyCapabilityEnvFile(VALID_TOKEN),
    );
    const hostDir = path.dirname(result.envFilePath);

    try {
      const probeEntries = fs.readdirSync(sessionMount);
      expect(hostDir.startsWith(`${sessionMount}${path.sep}`)).toBe(false);
      expect(
        probeEntries.some(
          (entry) => entry.includes('capability') || entry.includes('env'),
        ),
      ).toBe(false);
    } finally {
      result.cleanup();
    }
  });

  it('fails before creating a capability directory when the runtime root is inside a workdir-like mount', () => {
    const mountedWorkdir = path.join(getTmpDir(), 'workdir');
    const mountedRuntimeRoot = path.join(mountedWorkdir, 'runtime');
    fs.mkdirSync(mountedRuntimeRoot, { recursive: true });
    process.env.XDG_RUNTIME_DIR = mountedRuntimeRoot;
    vi.spyOn(os, 'platform').mockReturnValue('linux');

    expect(() =>
      createHostOnlyCapabilityEnvFile(VALID_TOKEN, [mountedWorkdir]),
    ).toThrow(/XDG_RUNTIME_DIR.*mount source/i);
    expect(
      fs
        .readdirSync(mountedRuntimeRoot)
        .filter((entry) => entry.startsWith('llxprt-code-cap-')),
    ).toStrictEqual([]);
  });

  it('fails before creating a capability directory when the runtime root symlinks into a mounted tree', () => {
    const mountedWorkdir = path.join(getTmpDir(), 'workdir');
    const mountedRuntimeRoot = path.join(mountedWorkdir, 'runtime');
    const runtimeRootSymlink = path.join(getTmpDir(), 'runtime-link');
    fs.mkdirSync(mountedRuntimeRoot, { recursive: true });
    fs.symlinkSync(mountedRuntimeRoot, runtimeRootSymlink);
    process.env.XDG_RUNTIME_DIR = runtimeRootSymlink;
    vi.spyOn(os, 'platform').mockReturnValue('linux');

    expect(() =>
      createHostOnlyCapabilityEnvFile(VALID_TOKEN, [mountedWorkdir]),
    ).toThrow(/XDG_RUNTIME_DIR.*mount source/i);
    expect(
      fs
        .readdirSync(mountedRuntimeRoot)
        .filter((entry) => entry.startsWith('llxprt-code-cap-')),
    ).toStrictEqual([]);
  });

  it('creates the capability directory beside mounts and skips nonexistent mount sources', () => {
    const siblingMount = path.join(getTmpDir(), 'workdir');
    const nonexistentMount = path.join(getTmpDir(), 'missing-mount');
    fs.mkdirSync(siblingMount);
    process.env.XDG_RUNTIME_DIR = runtimeRoot;
    vi.spyOn(os, 'platform').mockReturnValue('linux');

    const result = requireCapabilityResult(
      createHostOnlyCapabilityEnvFile(VALID_TOKEN, [
        siblingMount,
        nonexistentMount,
      ]),
    );

    try {
      expect(path.dirname(path.dirname(result.envFilePath))).toBe(runtimeRoot);
      expect(
        path
          .dirname(result.envFilePath)
          .startsWith(`${siblingMount}${path.sep}`),
      ).toBe(false);
    } finally {
      result.cleanup();
    }
  });

  it('reclaims stale runtime and legacy HOME directories while preserving fresh directories', () => {
    const staleRuntimeDir = path.join(runtimeRoot, 'llxprt-code-cap-stale');
    const freshRuntimeDir = path.join(runtimeRoot, 'llxprt-code-cap-live');
    const staleLegacyDir = path.join(isolatedHome, '.llxprt-code-cap-123-abc');
    fs.mkdirSync(staleRuntimeDir);
    fs.writeFileSync(path.join(staleRuntimeDir, 'junk'), 'stale');
    fs.mkdirSync(freshRuntimeDir);
    fs.mkdirSync(staleLegacyDir);
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    fs.utimesSync(staleRuntimeDir, twoDaysAgo, twoDaysAgo);
    fs.utimesSync(staleLegacyDir, twoDaysAgo, twoDaysAgo);

    const result = requireCapabilityResult(
      createHostOnlyCapabilityEnvFile(VALID_TOKEN),
    );
    try {
      expect(fs.existsSync(staleRuntimeDir)).toBe(false);
      expect(fs.existsSync(staleLegacyDir)).toBe(false);
      expect(fs.existsSync(freshRuntimeDir)).toBe(true);
      expect(fs.existsSync(path.dirname(result.envFilePath))).toBe(true);
    } finally {
      result.cleanup();
    }
  });

  it('reclaims directories at a custom age threshold without following symlinks', () => {
    const staleRuntimeDir = path.join(
      runtimeRoot,
      'llxprt-code-cap-custom-stale',
    );
    const freshRuntimeDir = path.join(
      runtimeRoot,
      'llxprt-code-cap-custom-fresh',
    );
    const symlinkTarget = path.join(getTmpDir(), 'symlink-target');
    const symlinkPath = path.join(runtimeRoot, 'llxprt-code-cap-symlink');
    fs.mkdirSync(staleRuntimeDir);
    fs.mkdirSync(freshRuntimeDir);
    fs.mkdirSync(symlinkTarget);
    fs.symlinkSync(symlinkTarget, symlinkPath);
    const twoSecondsAgo = new Date(Date.now() - 2_000);
    fs.utimesSync(staleRuntimeDir, twoSecondsAgo, twoSecondsAgo);

    reclaimOrphanCapabilityDirs(1_000);

    expect(fs.existsSync(staleRuntimeDir)).toBe(false);
    expect(fs.existsSync(freshRuntimeDir)).toBe(true);
    expect(fs.lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(symlinkTarget)).toBe(true);
  });

  it('fail-fast: runtime-root directory-creation failure surfaces', () => {
    const blockedRuntimeRoot = path.join(getTmpDir(), 'not-a-directory');
    fs.writeFileSync(
      blockedRuntimeRoot,
      'file blocks capability directory creation',
    );
    // Pin the platform so the redirected runtime root applies on every OS.
    vi.spyOn(os, 'platform').mockReturnValue('linux');
    overrideOsTmpdir(blockedRuntimeRoot);

    expect(() => createHostOnlyCapabilityEnvFile(VALID_TOKEN)).toThrow(
      /host-only directory/i,
    );
  });
});

describe('createHostOnlyDir: cleans up directory on setup failure (AC10)', () => {
  const getTmpDir = useTempDir(beforeEach, afterEach);
  let environmentSnapshot: NodeJS.ProcessEnv;
  let runtimeRoot = '';
  let isolatedHome = '';

  beforeEach(() => {
    environmentSnapshot = { ...process.env };
    runtimeRoot = path.join(getTmpDir(), 'runtime');
    isolatedHome = path.join(getTmpDir(), 'home');
    fs.mkdirSync(runtimeRoot);
    fs.mkdirSync(isolatedHome);
    delete process.env.XDG_RUNTIME_DIR;
    overrideOsTmpdir(runtimeRoot);
    vi.spyOn(os, 'homedir').mockReturnValue(isolatedHome);
  });

  afterEach(() => {
    process.env = environmentSnapshot;
    restoreOsTmpdir();
    vi.restoreAllMocks();
  });

  it('wraps mkdtemp failure and leaves no capability directory', () => {
    vi.spyOn(fs, 'mkdtempSync').mockImplementationOnce(() => {
      throw new Error('simulated mkdtemp failure');
    });

    expect(() => createHostOnlyCapabilityEnvFile(VALID_TOKEN)).toThrow(
      /host-only directory.*mkdtemp failure/i,
    );
    expect(
      fs
        .readdirSync(runtimeRoot)
        .filter((entry) => entry.startsWith('llxprt-code-cap-')),
    ).toStrictEqual([]);
  });

  it('aggregates env-file write and directory cleanup failures', () => {
    vi.spyOn(fs, 'openSync').mockImplementation(() => {
      throw new Error('simulated env-file write failure');
    });
    vi.spyOn(fs, 'rmdirSync').mockImplementation(() => {
      throw new Error('simulated rmdir failure');
    });

    let thrown: unknown;
    try {
      createHostOnlyCapabilityEnvFile(VALID_TOKEN);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    if (!(thrown instanceof AggregateError)) {
      throw new Error('Expected AggregateError');
    }
    const messages = thrown.errors.map((error) =>
      error instanceof Error ? error.message : String(error),
    );
    expect(
      messages.some((message) => /env-file write failure/i.test(message)),
    ).toBe(true);
    expect(messages.some((message) => /rmdir failure/i.test(message))).toBe(
      true,
    );
  });
});
