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
import type { SandboxPathFilesystem } from './sandbox-path-canonicalization.js';
import { useFakeEngine } from '../../test-utils/fake-dependency-engine-harness.js';
import { getContainerPath } from './sandbox-env.js';
import {
  addPrivateDependencyMounts,
  planPrivateDependencyMounts,
  resolveProtectedNodeModulesDestinations,
} from './sandbox-node-modules.js';

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
