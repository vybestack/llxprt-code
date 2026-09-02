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
import type { SandboxPathFilesystem } from './sandbox-path-canonicalization.js';
import { useFakeEngine } from '../../test-utils/fake-dependency-engine-harness.js';
import { getContainerPath } from './sandbox-env.js';
import {
  addPrivateDependencyMounts,
  planPrivateDependencyMounts,
  resolveProtectedNodeModulesDestinations,
} from './sandbox-node-modules.js';

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
  const engine = useFakeEngine();
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

  it('adds one engine volume mount per protected destination after the workspace bind', () => {
    const args: string[] = ['--volume', `${workdir}:${workdir}`];
    const lifecycle = addPrivateDependencyMounts(engine.config, args, workdir);
    try {
      const mountValues = args.filter(
        (token, index) => index > 0 && args[index - 1] === '--mount',
      );
      expect(mountValues).toHaveLength(3);
      // Mounts come after the shared workspace bind; later mounts win, so
      // each protected destination is hidden by its empty volume mount.
      expect(args.indexOf('--mount')).toBeGreaterThan(1);
      expect(
        mountValues.every((value) => value.startsWith('type=volume,src=')),
      ).toBe(true);
    } finally {
      lifecycle.release();
    }
  });

  it('creates no host-backed dependency storage', () => {
    const lifecycle = addPrivateDependencyMounts(engine.config, [], workdir);
    try {
      // The per-run storage is engine-owned named volumes; nothing may
      // appear under the LLxprt cache root.
      expect(privateRunRoots()).toStrictEqual([]);
      expect(engine.volumeNames()).toHaveLength(3);
    } finally {
      lifecycle.release();
    }
  });

  it('leaves host dependency trees exactly as seeded and absent paths absent', () => {
    const absentDir = path.join(workdir, 'packages', 'absent', 'node_modules');
    const args: string[] = [];
    const lifecycle = addPrivateDependencyMounts(engine.config, args, workdir);
    lifecycle.release();

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
    const lifecycle = addPrivateDependencyMounts(engine.config, args, workdir);
    // The engine materializes the mountpoint through the workspace bind
    // when the destination did not exist; simulate that observed behavior.
    fs.mkdirSync(absentDir, { recursive: true });
    lifecycle.release();
    expect(fs.existsSync(absentDir)).toBe(false);
  });

  it('never removes a destination that gained content', () => {
    const absentDir = path.join(workdir, 'packages', 'absent', 'node_modules');
    const args: string[] = [];
    const lifecycle = addPrivateDependencyMounts(engine.config, args, workdir);
    fs.mkdirSync(absentDir, { recursive: true });
    fs.writeFileSync(path.join(absentDir, 'kept.txt'), 'content\n');
    lifecycle.release();
    expect(fs.existsSync(path.join(absentDir, 'kept.txt'))).toBe(true);
  });

  it('keeps source-development launches unchanged: no preflight, no mounts, no storage, no engine calls', () => {
    // NODE_ENV=development in a positively identified llxprt-code source
    // checkout selects the excluded source-entrypoint path (#3455); it must
    // keep the legacy single workspace bind, and even a recognized
    // wrong-platform host tree must not stop it (#3450 F7).
    fs.mkdirSync(path.join(workdir, 'packages', 'cli'), { recursive: true });
    fs.writeFileSync(
      path.join(workdir, 'packages', 'cli', 'index.ts'),
      '// checked-out CLI source entrypoint\n',
    );
    const savedEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      writeBytes(
        path.join(workdir, 'node_modules', 'pkg', 'addon.node'),
        elfBytes(),
      );
      const args: string[] = ['--volume', `${workdir}:${workdir}`];
      const lifecycle = addPrivateDependencyMounts(
        engine.config,
        args,
        workdir,
      );
      expect(args).toStrictEqual(['--volume', `${workdir}:${workdir}`]);
      expect(privateRunRoots()).toStrictEqual([]);
      expect(engine.snapshot().invocations).toStrictEqual([]);
      expect(() => lifecycle.recordMainContainerName('any')).not.toThrow();
      expect(() => lifecycle.release()).not.toThrow();
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
    let thrown: unknown;
    try {
      addPrivateDependencyMounts(engine.config, args, workdir);
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof FatalSandboxError)) {
      throw new Error('Expected a FatalSandboxError');
    }
    expect(thrown.message).toContain('non-directory');
    expect(thrown.message).toContain(
      path.join(workdir, 'packages', 'absent', 'node_modules'),
    );
    expect(privateRunRoots()).toStrictEqual([]);
    // The failure happens before any engine resource is created.
    expect(engine.snapshot().invocations).toStrictEqual([]);
  });
});

describe('#3475 sandbox path canonicalization failures', () => {
  let workdir = '';
  let savedNodeEnv: string | undefined;

  beforeEach(() => {
    workdir = makeWorkspace();
    // The planner short-circuits to the development path before any
    // canonicalization when NODE_ENV=development; keep it unset so the
    // canonicalization behavior is what runs.
    savedNodeEnv = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = savedNodeEnv;
    }
    if (workdir !== '') fs.rmSync(workdir, { recursive: true, force: true });
  });

  it('fails with a classified preparation error when the workspace root is a symlink cycle', () => {
    const cyclic = path.join(workdir, 'cycle');
    fs.symlinkSync(cyclic, cyclic);
    let thrown: unknown;
    try {
      planPrivateDependencyMounts(cyclic);
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof FatalSandboxError)) {
      throw new Error('Expected a FatalSandboxError');
    }
    expect(thrown.message).toContain(cyclic);
    expect(thrown.message).toContain('resolve the sandbox workspace root');
  });

  it('does not weaken workspace containment when a declared root reaches a cycle', () => {
    // A cyclic symlink is unresolvable, so it can never smuggle a
    // destination out of the workspace: the walk treats it as a
    // not-yet-existing tail and the protected destination stays contained.
    const cyclic = path.join(workdir, 'cyclic-root');
    fs.symlinkSync(cyclic, cyclic);
    writeJson(path.join(workdir, 'package.json'), {
      workspaces: ['cyclic-root'],
    });
    expect(resolveProtectedNodeModulesDestinations(workdir)).toStrictEqual([
      path.join(workdir, 'node_modules'),
      path.join(workdir, 'cyclic-root', 'node_modules'),
    ]);
  });

  it('reports a classified preparation error when the workspace root is removed between discovery and resolution', () => {
    const filesystem: SandboxPathFilesystem = {
      existsSync: (targetPath) => fs.existsSync(targetPath),
      realpathSync: (targetPath) => {
        if (targetPath === workdir) {
          throw Object.assign(
            new Error(
              `ENOENT: no such file or directory, realpathSync '${workdir}'`,
            ),
            { code: 'ENOENT' },
          );
        }
        return fs.realpathSync(targetPath);
      },
    };
    let thrown: unknown;
    try {
      resolveProtectedNodeModulesDestinations(workdir, filesystem);
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof FatalSandboxError)) {
      throw new Error('Expected a FatalSandboxError');
    }
    expect(thrown.message).toContain(workdir);
    expect(thrown.message).toContain('resolve the sandbox workspace root');
    expect(thrown.message).toContain('ENOENT');
  });

  it('reports a classified preparation error when a protected destination is removed between discovery and resolution', () => {
    const destination = path.join(workdir, 'node_modules');
    fs.mkdirSync(destination);
    const filesystem: SandboxPathFilesystem = {
      existsSync: (targetPath) => fs.existsSync(targetPath),
      realpathSync: (targetPath) => {
        if (targetPath === destination) {
          throw Object.assign(
            new Error(
              `ENOENT: no such file or directory, realpathSync '${destination}'`,
            ),
            { code: 'ENOENT' },
          );
        }
        return fs.realpathSync(targetPath);
      },
    };
    let thrown: unknown;
    try {
      resolveProtectedNodeModulesDestinations(workdir, filesystem);
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof FatalSandboxError)) {
      throw new Error('Expected a FatalSandboxError');
    }
    expect(thrown.message).toContain(destination);
    expect(thrown.message).toContain(
      'resolve the protected sandbox dependency destination',
    );
    expect(thrown.message).toContain('ENOENT');
  });

  it('reports a classified preparation error when a declared destination root is replaced between discovery and resolution', () => {
    const declaredRoot = path.join(workdir, 'packages', 'nested');
    fs.mkdirSync(declaredRoot, { recursive: true });
    writeJson(path.join(workdir, 'package.json'), {
      workspaces: ['packages/nested'],
    });
    const filesystem: SandboxPathFilesystem = {
      existsSync: (targetPath) => fs.existsSync(targetPath),
      realpathSync: (targetPath) => {
        if (targetPath === declaredRoot) {
          throw Object.assign(
            new Error(
              `ELOOP: too many levels of symbolic links, realpathSync '${declaredRoot}'`,
            ),
            { code: 'ELOOP' },
          );
        }
        return fs.realpathSync(targetPath);
      },
    };
    let thrown: unknown;
    try {
      resolveProtectedNodeModulesDestinations(workdir, filesystem);
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof FatalSandboxError)) {
      throw new Error('Expected a FatalSandboxError');
    }
    expect(thrown.message).toContain(declaredRoot);
    expect(thrown.message).toContain(
      'resolve the protected sandbox dependency destination',
    );
    expect(thrown.message).toContain('ELOOP');
  });
});

describe('#3463 multi-root private dependency mounts', () => {
  const engine = useFakeEngine();
  let fixtureRoot = '';
  let primaryRoot = '';
  let includeRoot = '';
  let restoreCacheEnv: () => void;

  beforeEach(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issue3463-deps-'));
    primaryRoot = path.join(fixtureRoot, 'primary');
    includeRoot = path.join(fixtureRoot, 'included');
    fs.mkdirSync(primaryRoot);
    fs.mkdirSync(includeRoot);
    restoreCacheEnv = isolateCacheEnv();
    writeJson(path.join(primaryRoot, 'package.json'), {
      workspaces: ['packages/primary-nested'],
    });
    writeJson(path.join(includeRoot, 'package.json'), {
      workspaces: ['packages/included-nested'],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    restoreCacheEnv();
  });

  it('plans the root and declared nested dependency trees for every accepted workspace root', () => {
    const plan = planPrivateDependencyMounts([primaryRoot, includeRoot]);

    if (!plan.enabled) throw new Error('Expected dependency isolation plan');
    expect(plan.destinations).toStrictEqual([
      path.join(primaryRoot, 'node_modules'),
      path.join(primaryRoot, 'packages', 'primary-nested', 'node_modules'),
      path.join(includeRoot, 'node_modules'),
      path.join(includeRoot, 'packages', 'included-nested', 'node_modules'),
    ]);
  });

  it('preflights an included root before any engine resource is created', () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin');
    writeBytes(
      path.join(includeRoot, 'node_modules', 'host-pkg', 'addon.node'),
      elfBytes(),
    );

    expect(() =>
      addPrivateDependencyMounts(engine.config, [], [primaryRoot, includeRoot]),
    ).toThrowError('Sandbox dependency preflight failed');
    expect(engine.snapshot().invocations).toStrictEqual([]);
  });

  it('mounts private volumes over every root and removes absent mountpoints from both roots', () => {
    const destinations = [
      path.join(primaryRoot, 'node_modules'),
      path.join(primaryRoot, 'packages', 'primary-nested', 'node_modules'),
      path.join(includeRoot, 'node_modules'),
      path.join(includeRoot, 'packages', 'included-nested', 'node_modules'),
    ];
    const args: string[] = [
      '--volume',
      `${primaryRoot}:${primaryRoot}`,
      '--volume',
      `${includeRoot}:${includeRoot}`,
    ];
    const lifecycle = addPrivateDependencyMounts(engine.config, args, [
      primaryRoot,
      includeRoot,
    ]);
    for (const destination of destinations) {
      fs.mkdirSync(destination, { recursive: true });
    }

    lifecycle.release();

    const mountValues = args.filter(
      (token, index) => index > 0 && args[index - 1] === '--mount',
    );
    expect(mountValues).toHaveLength(destinations.length);
    expect(
      destinations.every((destination) =>
        mountValues.some((mount) =>
          mount.includes(`dst=${getContainerPath(destination)}`),
        ),
      ),
    ).toBe(true);
    expect(
      destinations.every((destination) => !fs.existsSync(destination)),
    ).toBe(true);
    expect(engine.volumeNames()).toStrictEqual([]);
    expect(engine.containerNames()).toStrictEqual([]);
  });
});
