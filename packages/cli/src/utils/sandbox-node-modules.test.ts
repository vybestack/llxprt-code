/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import { Storage } from '@vybestack/llxprt-code-storage';
import { useFakeEngine } from '../../test-utils/fake-dependency-engine-harness.js';
import {
  addPrivateDependencyMounts,
  resolveProtectedNodeModulesDestinations,
} from './sandbox-node-modules.js';
import { planWorkspacePackageDiscovery } from './sandbox-workspace-discovery.js';

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

describe('#3468 workspace package discovery planning', () => {
  it('plans supported literals, globs, and exclusions from an array', () => {
    expect(
      planWorkspacePackageDiscovery([
        'packages/literal',
        'packages/*',
        'tools/**',
        '!packages/excluded',
        42,
        '',
      ]),
    ).toStrictEqual({
      inclusions: [
        {
          source: 'packages/literal',
          pattern: 'packages/literal',
          kind: 'literal',
        },
        {
          source: 'packages/*',
          pattern: 'packages/*',
          kind: 'glob',
        },
        { source: 'tools/**', pattern: 'tools/**', kind: 'glob' },
      ],
      exclusions: [
        {
          source: '!packages/excluded',
          pattern: 'packages/excluded',
          kind: 'literal',
        },
      ],
    });
  });

  it('supports the established workspaces.packages object form', () => {
    expect(
      planWorkspacePackageDiscovery({
        packages: ['./packages/literal', 'packages/*', '!packages/private'],
        nohoist: ['**/fixture'],
      }),
    ).toStrictEqual({
      inclusions: [
        {
          source: './packages/literal',
          pattern: 'packages/literal',
          kind: 'literal',
        },
        {
          source: 'packages/*',
          pattern: 'packages/*',
          kind: 'glob',
        },
      ],
      exclusions: [
        {
          source: '!packages/private',
          pattern: 'packages/private',
          kind: 'literal',
        },
      ],
    });
  });

  it('preserves literal punctuation that is not a glob operator', () => {
    expect(
      planWorkspacePackageDiscovery([
        'packages/c++',
        'packages/email@scope',
        'packages/group(name)',
        'packages/bang!name',
        'packages/pipe|name',
      ]),
    ).toStrictEqual({
      inclusions: [
        { source: 'packages/c++', pattern: 'packages/c++', kind: 'literal' },
        {
          source: 'packages/email@scope',
          pattern: 'packages/email@scope',
          kind: 'literal',
        },
        {
          source: 'packages/group(name)',
          pattern: 'packages/group(name)',
          kind: 'literal',
        },
        {
          source: 'packages/bang!name',
          pattern: 'packages/bang!name',
          kind: 'literal',
        },
        {
          source: 'packages/pipe|name',
          pattern: 'packages/pipe|name',
          kind: 'literal',
        },
      ],
      exclusions: [],
    });
  });

  it('rejects unsupported glob syntax with the declaration and supported forms', () => {
    for (const declaration of [
      'packages/pkg-*',
      'packages/**/nested',
      'packages/pkg?',
      'packages/[ab]',
      'packages/{a,b}',
      'packages/?(a|b)',
      'packages/*(a|b)',
      'packages/+(a|b)',
      'packages/@(a|b)',
      'packages/!(a|b)',
      'packages/*/../hidden',
      '!!packages/private',
      '**',
      './**',
      './*/**',
      '/absolute/*',
      'C:/absolute/*',
    ]) {
      expect(() => planWorkspacePackageDiscovery([declaration])).toThrowError(
        declaration,
      );
      expect(() => planWorkspacePackageDiscovery([declaration])).toThrowError(
        "'*' as a complete segment",
      );
    }
  });
});

describe('#3450/#3468 protected node_modules destination resolution', () => {
  let workdir = '';

  beforeEach(() => {
    workdir = makeWorkspace();
  });

  afterEach(() => {
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

  it('protects literal roots from the workspaces.packages object form', () => {
    writeJson(path.join(workdir, 'package.json'), {
      workspaces: { packages: ['packages/nested'] },
    });
    expect(resolveProtectedNodeModulesDestinations(workdir)).toStrictEqual([
      path.join(workdir, 'node_modules'),
      path.join(workdir, 'packages', 'nested', 'node_modules'),
    ]);
  });

  it('discovers and excludes package roots from the workspaces.packages object form', () => {
    for (const name of ['included', 'excluded']) {
      writeJson(path.join(workdir, 'packages', name, 'package.json'), { name });
    }
    writeJson(path.join(workdir, 'package.json'), {
      workspaces: {
        packages: ['packages/*', '!packages/excluded/**'],
      },
    });

    expect(resolveProtectedNodeModulesDestinations(workdir)).toStrictEqual([
      path.join(workdir, 'node_modules'),
      path.join(workdir, 'packages', 'included', 'node_modules'),
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

  it('discovers package roots from one-segment and recursive globs', () => {
    writeJson(path.join(workdir, 'packages', 'alpha', 'package.json'), {
      name: 'alpha',
    });
    fs.mkdirSync(path.join(workdir, 'packages', 'not-a-package'), {
      recursive: true,
    });
    writeJson(path.join(workdir, 'tools', 'package.json'), {
      name: 'tools-root',
    });
    writeJson(path.join(workdir, 'tools', 'group', 'deep', 'package.json'), {
      name: 'deep-tool',
    });
    writeJson(
      path.join(workdir, 'tools', 'node_modules', 'ignored', 'package.json'),
      { name: 'ignored-dependency' },
    );
    writeJson(path.join(workdir, 'tools', '.git', 'ignored', 'package.json'), {
      name: 'ignored-metadata',
    });
    writeJson(path.join(workdir, 'package.json'), {
      workspaces: ['packages/*', 'tools/**', './literal'],
    });

    expect(resolveProtectedNodeModulesDestinations(workdir)).toStrictEqual([
      path.join(workdir, 'node_modules'),
      path.join(workdir, 'packages', 'alpha', 'node_modules'),
      path.join(workdir, 'tools', 'node_modules'),
      path.join(workdir, 'tools', 'group', 'deep', 'node_modules'),
      path.join(workdir, 'literal', 'node_modules'),
    ]);
  });

  it('applies exclusions after positive glob discovery', () => {
    for (const name of ['included', 'excluded']) {
      writeJson(path.join(workdir, 'packages', name, 'package.json'), { name });
    }
    writeJson(path.join(workdir, 'package.json'), {
      workspaces: ['!packages/excluded', '!packages/not-present', 'packages/*'],
    });

    expect(resolveProtectedNodeModulesDestinations(workdir)).toStrictEqual([
      path.join(workdir, 'node_modules'),
      path.join(workdir, 'packages', 'included', 'node_modules'),
    ]);
  });

  it('fails actionably when a positive glob matches no package roots', () => {
    fs.mkdirSync(path.join(workdir, 'packages', 'not-a-package'), {
      recursive: true,
    });
    writeJson(path.join(workdir, 'package.json'), {
      workspaces: ['packages/*'],
    });

    expect(() => resolveProtectedNodeModulesDestinations(workdir)).toThrowError(
      "Workspace glob 'packages/*' matched no package roots",
    );
    expect(() => resolveProtectedNodeModulesDestinations(workdir)).toThrowError(
      'use a literal workspace path',
    );
  });

  it('rejects a glob match that resolves through a symlink outside the workspace', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'issue3468-out-'));
    try {
      writeJson(path.join(outside, 'package.json'), { name: 'escaped' });
      fs.mkdirSync(path.join(workdir, 'packages'), { recursive: true });
      fs.symlinkSync(outside, path.join(workdir, 'packages', 'escaped'));
      writeJson(path.join(workdir, 'package.json'), {
        workspaces: ['packages/*', '!packages/escaped'],
      });

      expect(() =>
        resolveProtectedNodeModulesDestinations(workdir),
      ).toThrowError(FatalSandboxError);
      expect(() =>
        resolveProtectedNodeModulesDestinations(workdir),
      ).toThrowError("'packages/*'");
      expect(() =>
        resolveProtectedNodeModulesDestinations(workdir),
      ).toThrowError('resolves outside the workspace');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
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

describe('#3450/#3468 private per-run dependency mounts', () => {
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
      lifecycle.recordMainContainerName('development-container');
      lifecycle.release();

      expect(args).toStrictEqual(['--volume', `${workdir}:${workdir}`]);
      expect(privateRunRoots()).toStrictEqual([]);
      expect(engine.volumeNames()).toStrictEqual([]);
      expect(engine.containerNames()).toStrictEqual([]);
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
    expect(engine.volumeNames()).toStrictEqual([]);
    expect(engine.containerNames()).toStrictEqual([]);
    expect(args).toStrictEqual([]);
  });

  it('rejects unsupported workspace syntax before engine or host side effects', () => {
    const hostMarker = path.join(
      workdir,
      'node_modules',
      'host-root-marker.txt',
    );
    writeJson(path.join(workdir, 'package.json'), {
      workspaces: ['packages/{one,two}'],
    });

    expect(() =>
      addPrivateDependencyMounts(engine.config, [], workdir),
    ).toThrowError("'packages/{one,two}'");
    expect(engine.volumeNames()).toStrictEqual([]);
    expect(engine.containerNames()).toStrictEqual([]);
    expect(snapshotTree(path.join(workdir, 'node_modules'))).toStrictEqual(
      new Map<string, TreeEntry>([
        ['host-pkg', { kind: 'dir' }],
        [
          'host-root-marker.txt',
          { kind: 'file', content: 'host-root-marker\n' },
        ],
      ]),
    );
    expect(fs.readFileSync(hostMarker, 'utf8')).toBe('host-root-marker\n');
  });

  it('rejects a no-match glob before creating an engine volume', () => {
    const args: string[] = [];
    writeJson(path.join(workdir, 'package.json'), {
      workspaces: ['packages/*'],
    });

    expect(() =>
      addPrivateDependencyMounts(engine.config, args, workdir),
    ).toThrowError("Workspace glob 'packages/*' matched no package roots");
    expect(engine.volumeNames()).toStrictEqual([]);
    expect(engine.containerNames()).toStrictEqual([]);
    expect(args).toStrictEqual([]);
  });
});
