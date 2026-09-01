/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import { Storage } from '@vybestack/llxprt-code-storage';
import {
  addPrivateDependencyMounts,
  resolveProtectedNodeModulesDestinations,
} from './sandbox-node-modules.js';

const DOCKER_CONFIG = { command: 'docker', image: 'test' } as const;
const PODMAN_CONFIG = { command: 'podman', image: 'test' } as const;
const RUN_ROOT_PREFIX = 'sandbox-node-modules-';

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'issue3450-ws-'));
}

/**
 * Points the production Storage resolver at a private temp cache root so
 * the tests never create or inspect run directories in the shared live
 * user cache (#3450 remediation F8).
 */
function isolateCacheEnv(): () => void {
  const saved = process.env.LLXPRT_CACHE_HOME;
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'issue3450-cache-'));
  process.env.LLXPRT_CACHE_HOME = isolated;
  return () => {
    if (saved === undefined) {
      delete process.env.LLXPRT_CACHE_HOME;
    } else {
      process.env.LLXPRT_CACHE_HOME = saved;
    }
    fs.rmSync(isolated, { recursive: true, force: true });
  };
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeBytes(filePath: string, bytes: Uint8Array): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
}

function elfBytes(): Uint8Array {
  return Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
}

function privateRunRoots(): string[] {
  const cacheDir = Storage.getGlobalCacheDir();
  return fs
    .readdirSync(cacheDir)
    .filter((entry) => entry.startsWith(RUN_ROOT_PREFIX))
    .map((entry) => path.join(cacheDir, entry));
}

interface TreeEntry {
  readonly kind: 'file' | 'dir' | 'symlink';
  readonly content?: string;
  readonly target?: string;
}

function snapshotTree(
  root: string,
): ReadonlyMap<string, TreeEntry> | undefined {
  if (!fs.existsSync(root)) return undefined;
  const snapshot = new Map<string, TreeEntry>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const rel = fullPath.slice(root.length + 1);
      if (entry.isSymbolicLink()) {
        snapshot.set(rel, {
          kind: 'symlink',
          target: fs.readlinkSync(fullPath),
        });
      } else if (entry.isDirectory()) {
        snapshot.set(rel, { kind: 'dir' });
        walk(fullPath);
      } else {
        snapshot.set(rel, {
          kind: 'file',
          content: fs.readFileSync(fullPath, 'utf8'),
        });
      }
    }
  };
  walk(root);
  return snapshot;
}

describe('#3450 protected node_modules destination resolution', () => {
  let workdir = '';

  beforeEach(() => {
    workdir = makeWorkspace();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (workdir !== '') fs.rmSync(workdir, { recursive: true, force: true });
  });

  it('protects only the root when no manifest exists', () => {
    expect(resolveProtectedNodeModulesDestinations(workdir)).toStrictEqual([
      path.join(workdir, 'node_modules'),
    ]);
  });

  it('protects only the root when the manifest is invalid JSON', () => {
    fs.writeFileSync(path.join(workdir, 'package.json'), '{ not json');
    expect(resolveProtectedNodeModulesDestinations(workdir)).toStrictEqual([
      path.join(workdir, 'node_modules'),
    ]);
  });

  it('protects the root and every literal declared nested package root', () => {
    writeJson(path.join(workdir, 'package.json'), {
      workspaces: ['packages/cli', 'packages/tools'],
    });
    expect(resolveProtectedNodeModulesDestinations(workdir)).toStrictEqual([
      path.join(workdir, 'node_modules'),
      path.join(workdir, 'packages', 'cli', 'node_modules'),
      path.join(workdir, 'packages', 'tools', 'node_modules'),
    ]);
  });

  it('does not invent nested roots from non-list workspace metadata', () => {
    // The object form (`workspaces.packages`) is package-manager-specific
    // metadata outside the ordinary workspace list this issue accepted;
    // it is deliberately not interpreted (#3450 remediation F9).
    writeJson(path.join(workdir, 'package.json'), {
      workspaces: { packages: ['packages/nested'] },
    });
    expect(resolveProtectedNodeModulesDestinations(workdir)).toStrictEqual([
      path.join(workdir, 'node_modules'),
    ]);
  });

  it('protects a declared root whose node_modules does not exist yet', () => {
    writeJson(path.join(workdir, 'package.json'), {
      workspaces: ['packages/absent'],
    });
    expect(resolveProtectedNodeModulesDestinations(workdir)).toStrictEqual([
      path.join(workdir, 'node_modules'),
      path.join(workdir, 'packages', 'absent', 'node_modules'),
    ]);
  });

  it('skips glob-style declarations instead of expanding them', () => {
    writeJson(path.join(workdir, 'package.json'), {
      workspaces: ['packages/*', 'tools/**', '!excluded', './literal'],
    });
    expect(resolveProtectedNodeModulesDestinations(workdir)).toStrictEqual([
      path.join(workdir, 'node_modules'),
      path.join(workdir, 'literal', 'node_modules'),
    ]);
  });

  it('ignores non-string declaration entries', () => {
    writeJson(path.join(workdir, 'package.json'), {
      workspaces: [42, null, 'packages/nested'],
    });
    expect(resolveProtectedNodeModulesDestinations(workdir)).toStrictEqual([
      path.join(workdir, 'node_modules'),
      path.join(workdir, 'packages', 'nested', 'node_modules'),
    ]);
  });

  it('normalizes and deduplicates declarations that resolve to one root', () => {
    writeJson(path.join(workdir, 'package.json'), {
      workspaces: [
        'packages/nested',
        './packages/nested',
        'packages/other/../nested',
      ],
    });
    expect(resolveProtectedNodeModulesDestinations(workdir)).toStrictEqual([
      path.join(workdir, 'node_modules'),
      path.join(workdir, 'packages', 'nested', 'node_modules'),
    ]);
  });

  it('fails before launch when a declaration escapes the workspace', () => {
    writeJson(path.join(workdir, 'package.json'), {
      workspaces: ['../outside'],
    });
    expect(() => resolveProtectedNodeModulesDestinations(workdir)).toThrowError(
      FatalSandboxError,
    );
    expect(() => resolveProtectedNodeModulesDestinations(workdir)).toThrowError(
      `'../outside'`,
    );
    expect(() => resolveProtectedNodeModulesDestinations(workdir)).toThrowError(
      'resolves outside the workspace',
    );
  });

  it('fails before launch when a declared root is a symlink out of the workspace', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'issue3450-out-'));
    try {
      writeJson(path.join(workdir, 'package.json'), {
        workspaces: ['linked'],
      });
      fs.symlinkSync(outside, path.join(workdir, 'linked'));
      expect(() =>
        resolveProtectedNodeModulesDestinations(workdir),
      ).toThrowError(FatalSandboxError);
      expect(() =>
        resolveProtectedNodeModulesDestinations(workdir),
      ).toThrowError(`'linked'`);
      expect(() =>
        resolveProtectedNodeModulesDestinations(workdir),
      ).toThrowError('resolves outside the workspace');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('deduplicates declarations that reach one directory through a symlink', () => {
    fs.mkdirSync(path.join(workdir, 'real-pkg'));
    fs.symlinkSync(
      path.join(workdir, 'real-pkg'),
      path.join(workdir, 'alias-pkg'),
    );
    writeJson(path.join(workdir, 'package.json'), {
      workspaces: ['real-pkg', 'alias-pkg'],
    });
    expect(resolveProtectedNodeModulesDestinations(workdir)).toStrictEqual([
      path.join(workdir, 'node_modules'),
      path.join(workdir, 'real-pkg', 'node_modules'),
    ]);
  });

  it('protects a contained declared root at its real location through a symlink', () => {
    fs.mkdirSync(path.join(workdir, 'real'));
    fs.symlinkSync(path.join(workdir, 'real'), path.join(workdir, 'linked'));
    writeJson(path.join(workdir, 'package.json'), {
      workspaces: ['linked'],
    });
    // The private bind must land on the directory the workspace bind
    // actually serves (the symlink's target), not on the alias path.
    expect(resolveProtectedNodeModulesDestinations(workdir)).toStrictEqual([
      path.join(workdir, 'node_modules'),
      path.join(workdir, 'real', 'node_modules'),
    ]);
  });

  it('fails before launch when the root node_modules itself is a symlink out of the workspace', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'issue3450-out-'));
    try {
      fs.symlinkSync(outside, path.join(workdir, 'node_modules'));
      expect(() =>
        resolveProtectedNodeModulesDestinations(workdir),
      ).toThrowError(FatalSandboxError);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('does not recursively discover undeclared orphan node_modules trees', () => {
    writeJson(path.join(workdir, 'package.json'), {
      workspaces: ['packages/declared'],
    });
    fs.mkdirSync(path.join(workdir, 'packages', 'orphan', 'node_modules'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(workdir, 'node_modules', 'deep', 'node_modules'), {
      recursive: true,
    });
    const destinations = resolveProtectedNodeModulesDestinations(workdir);
    expect(destinations).toStrictEqual([
      path.join(workdir, 'node_modules'),
      path.join(workdir, 'packages', 'declared', 'node_modules'),
    ]);
    expect(
      destinations.includes(
        path.join(workdir, 'packages', 'orphan', 'node_modules'),
      ),
    ).toBe(false);
  });
});

describe('#3450 private per-run dependency mounts', () => {
  let workdir = '';
  let restoreCacheEnv: () => void;

  beforeEach(() => {
    workdir = makeWorkspace();
    restoreCacheEnv = isolateCacheEnv();
    writeJson(path.join(workdir, 'package.json'), {
      workspaces: ['packages/nested', 'packages/absent'],
    });
    fs.mkdirSync(path.join(workdir, 'node_modules', 'host-pkg'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(workdir, 'node_modules', 'host-root-marker.txt'),
      'host-root-marker\n',
    );
    fs.mkdirSync(path.join(workdir, 'packages', 'nested', 'node_modules'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(
        workdir,
        'packages',
        'nested',
        'node_modules',
        'host-nested-marker.txt',
      ),
      'host-nested-marker\n',
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (workdir !== '') fs.rmSync(workdir, { recursive: true, force: true });
    restoreCacheEnv();
  });

  function volumeOperands(args: readonly string[]): string[] {
    const operands: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--volume' && i + 1 < args.length) {
        operands.push(args[i + 1]);
      }
    }
    return operands;
  }

  it('adds one nested bind per protected destination after the workspace bind', () => {
    const args: string[] = ['--volume', `${workdir}:${workdir}`];
    const cleanup = addPrivateDependencyMounts(DOCKER_CONFIG, args, workdir);
    try {
      const runRoot = privateRunRoots()[0];
      const operands = volumeOperands(args);
      expect(operands).toStrictEqual([
        `${workdir}:${workdir}`,
        `${path.join(runRoot, '0')}:${path.join(workdir, 'node_modules')}`,
        `${path.join(runRoot, '1')}:${path.join(workdir, 'packages', 'nested', 'node_modules')}`,
        `${path.join(runRoot, '2')}:${path.join(workdir, 'packages', 'absent', 'node_modules')}`,
      ]);
    } finally {
      cleanup();
    }
  });

  it('sources the private binds from a unique run directory under the LLxprt cache root', () => {
    const args: string[] = [];
    const cleanup = addPrivateDependencyMounts(DOCKER_CONFIG, args, workdir);
    try {
      const cacheDir = Storage.getGlobalCacheDir();
      const created = fs
        .readdirSync(cacheDir)
        .filter((entry) => entry.startsWith(RUN_ROOT_PREFIX));
      expect(created).toHaveLength(1);
      const runRoot = path.join(cacheDir, created[0]);
      // Each protected destination gets its own fresh child directory.
      for (const child of ['0', '1', '2']) {
        expect(fs.statSync(path.join(runRoot, child)).isDirectory()).toBe(true);
      }
    } finally {
      cleanup();
    }
  });

  it('makes each private directory writable by any container uid while the run parent stays host-private', () => {
    const args: string[] = [];
    const cleanup = addPrivateDependencyMounts(DOCKER_CONFIG, args, workdir);
    try {
      const runRoot = privateRunRoots()[0];
      // The engine may select a main-container user whose uid differs from
      // the host owner; a 0755 bind source would be unwritable there
      // (#3450 remediation F1). Each child is world-writable...
      for (const child of ['0', '1', '2']) {
        expect(fs.statSync(path.join(runRoot, child)).mode & 0o777).toBe(0o777);
      }
      // ...while the random run parent keeps its mkdtemp-private 0700.
      expect(fs.statSync(runRoot).mode & 0o777).toBe(0o700);
    } finally {
      cleanup();
    }
  });

  it('labels podman mounts for SELinux sharing and leaves docker mounts unlabeled', () => {
    const dockerArgs: string[] = [];
    const dockerCleanup = addPrivateDependencyMounts(
      DOCKER_CONFIG,
      dockerArgs,
      workdir,
    );
    const podmanArgs: string[] = [];
    const podmanCleanup = addPrivateDependencyMounts(
      PODMAN_CONFIG,
      podmanArgs,
      workdir,
    );
    try {
      const dockerPrivate = volumeOperands(dockerArgs)[0];
      const podmanPrivate = volumeOperands(podmanArgs)[0];
      expect(dockerPrivate.endsWith(':z')).toBe(false);
      expect(podmanPrivate.endsWith(':z')).toBe(true);
    } finally {
      dockerCleanup();
      podmanCleanup();
    }
  });

  it('leaves host dependency trees exactly as seeded and absent paths absent', () => {
    const absentDir = path.join(workdir, 'packages', 'absent', 'node_modules');
    const args: string[] = [];
    const cleanup = addPrivateDependencyMounts(DOCKER_CONFIG, args, workdir);
    cleanup();

    // The trees were seeded by this test with known literal content, so the
    // full expectation is written out literally: preparation must not add,
    // remove, or rewrite anything the host had.
    expect(snapshotTree(path.join(workdir, 'node_modules'))).toEqual(
      new Map<string, TreeEntry>([
        ['host-pkg', { kind: 'dir' }],
        [
          'host-root-marker.txt',
          { kind: 'file', content: 'host-root-marker\n' },
        ],
      ]),
    );
    expect(
      snapshotTree(path.join(workdir, 'packages', 'nested', 'node_modules')),
    ).toEqual(
      new Map<string, TreeEntry>([
        [
          'host-nested-marker.txt',
          { kind: 'file', content: 'host-nested-marker\n' },
        ],
      ]),
    );
    expect(fs.existsSync(absentDir)).toBe(false);
  });

  it('removes an engine-created empty mountpoint for a destination absent before launch', () => {
    const absentDir = path.join(workdir, 'packages', 'absent', 'node_modules');
    const args: string[] = [];
    const cleanup = addPrivateDependencyMounts(DOCKER_CONFIG, args, workdir);
    // The engine materializes the mountpoint through the workspace bind
    // when the destination did not exist; simulate that observed behavior.
    fs.mkdirSync(absentDir, { recursive: true });
    cleanup();
    expect(fs.existsSync(absentDir)).toBe(false);
  });

  it('never removes a destination that gained content', () => {
    const absentDir = path.join(workdir, 'packages', 'absent', 'node_modules');
    const args: string[] = [];
    const cleanup = addPrivateDependencyMounts(DOCKER_CONFIG, args, workdir);
    fs.mkdirSync(absentDir, { recursive: true });
    fs.writeFileSync(path.join(absentDir, 'kept.txt'), 'content\n');
    cleanup();
    expect(fs.existsSync(path.join(absentDir, 'kept.txt'))).toBe(true);
  });

  it('keeps development-mode launches unchanged: no preflight, no mounts, no storage', () => {
    // NODE_ENV=development selects the excluded source-entrypoint path
    // (#3455); it must keep the legacy single workspace bind, and even a
    // recognized wrong-platform host tree must not stop it (#3450 F7).
    const savedEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      writeBytes(
        path.join(workdir, 'node_modules', 'pkg', 'addon.node'),
        elfBytes(),
      );
      const args: string[] = ['--volume', `${workdir}:${workdir}`];
      const cleanup = addPrivateDependencyMounts(DOCKER_CONFIG, args, workdir);
      expect(args).toStrictEqual(['--volume', `${workdir}:${workdir}`]);
      expect(privateRunRoots()).toStrictEqual([]);
      expect(() => cleanup()).not.toThrow();
    } finally {
      if (savedEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = savedEnv;
      }
    }
  });

  it('fails deterministically when a protected destination exists as a non-directory', () => {
    // The absent declared root is the one destination nothing pre-created.
    fs.mkdirSync(path.join(workdir, 'packages', 'absent'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(workdir, 'packages', 'absent', 'node_modules'),
      'a regular file where a directory is required',
    );
    const args: string[] = [];
    expect(() =>
      addPrivateDependencyMounts(DOCKER_CONFIG, args, workdir),
    ).toThrowError(FatalSandboxError);
    expect(() =>
      addPrivateDependencyMounts(DOCKER_CONFIG, args, workdir),
    ).toThrowError('non-directory');
    expect(() =>
      addPrivateDependencyMounts(DOCKER_CONFIG, args, workdir),
    ).toThrowError(path.join(workdir, 'packages', 'absent', 'node_modules'));
    expect(privateRunRoots()).toStrictEqual([]);
  });

  it('removes the dedicated run subtree on cleanup', () => {
    const args: string[] = [];
    const cleanup = addPrivateDependencyMounts(DOCKER_CONFIG, args, workdir);
    expect(privateRunRoots()).not.toStrictEqual([]);
    cleanup();
    expect(privateRunRoots()).toStrictEqual([]);
    // A second cleanup (the lifecycle may fire it more than once) stays quiet.
    expect(() => cleanup()).not.toThrow();
  });

  it('reports the failing operation and path when cache storage cannot be created', () => {
    // Deterministic on privileged runners too: a chmod-based denial is
    // silently writable under root, but a regular file in the cache path
    // makes mkdtemp fail with ENOTDIR no matter who runs the test
    // (#3450 OCR F12).
    const cacheDir = Storage.getGlobalCacheDir();
    const denyFile = path.join(cacheDir, 'issue3450-deny-file');
    fs.writeFileSync(denyFile, 'a regular file where the cache root must be');
    const unusableCacheDir = path.join(denyFile, 'cache');
    const cacheSpy = vi
      .spyOn(Storage, 'getGlobalCacheDir')
      .mockReturnValue(unusableCacheDir);
    try {
      const args: string[] = [];
      expect(() =>
        addPrivateDependencyMounts(DOCKER_CONFIG, args, workdir),
      ).toThrowError(FatalSandboxError);
      expect(() =>
        addPrivateDependencyMounts(DOCKER_CONFIG, args, workdir),
      ).toThrowError(unusableCacheDir);
    } finally {
      cacheSpy.mockRestore();
      fs.rmSync(denyFile, { force: true });
    }
    expect(privateRunRoots()).toStrictEqual([]);
  });
});
