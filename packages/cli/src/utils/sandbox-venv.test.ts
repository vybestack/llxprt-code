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
import { useFakeEngine } from '../../test-utils/fake-dependency-engine-harness.js';
import { addPrivateDependencyMounts } from './sandbox-node-modules.js';
import {
  planSandboxVenvDestination,
  SANDBOX_VENV_DESTINATION_KIND,
} from './sandbox-venv.js';
import { getContainerPath } from './sandbox-env.js';

function makeWorktree(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'issue3462-ws-'));
}

function isolateCacheEnv(): () => void {
  const saved = process.env.LLXPRT_CACHE_HOME;
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'issue3462-cache-'));
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

/**
 * POSIX-only assertion: win32 stat modes never carry POSIX bits ('1777' surfaces
 * as '666'), so on win32 the chmod contract is asserted via the init-run
 * mounts: the init container mounts every volume, and the set-equality assertion
 * below pins it to exactly engine.volumeNames().
 */
function assertVolumeRootMode1777(root: string): void {
  if (process.platform !== 'win32') {
    expect(fs.statSync(root).mode & 0o1777).toBe(0o1777);
  }
}

function flagValues(argv: readonly string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length - 1; index++) {
    if (argv[index] === flag) values.push(argv[index + 1]);
  }
  return values;
}

function capturedError(action: () => void): Error {
  try {
    action();
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error('Expected action to throw an Error');
}

function mountField(spec: string, fieldName: string): string | undefined {
  const prefix = `${fieldName}=`;
  return spec
    .split(',')
    .find((field) => field.startsWith(prefix))
    ?.slice(prefix.length);
}

describe('#3462 in-workspace VIRTUAL_ENV destination planning', () => {
  let workdir = '';

  beforeEach(() => {
    workdir = makeWorktree();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (workdir !== '') fs.rmSync(workdir, { recursive: true, force: true });
  });

  it('returns no destination when VIRTUAL_ENV is unset, empty, or outside the workspace', () => {
    delete process.env.VIRTUAL_ENV;
    const unset = planSandboxVenvDestination(workdir);
    process.env.VIRTUAL_ENV = '';
    const empty = planSandboxVenvDestination(workdir);
    process.env.VIRTUAL_ENV = path.join(os.tmpdir(), 'outside-venv');
    const outside = planSandboxVenvDestination(workdir);
    expect([unset, empty, outside]).toStrictEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('plans the venv path as an additional protected destination inside the workspace', () => {
    const venv = path.join(workdir, '.venv');
    process.env.VIRTUAL_ENV = venv;

    expect(planSandboxVenvDestination(workdir)).toStrictEqual({
      kind: SANDBOX_VENV_DESTINATION_KIND,
      destination: venv,
    });
  });

  it('accepts an in-workspace venv regardless of case differences in the workdir', () => {
    const venv = path.join(workdir, '.venv');
    process.env.VIRTUAL_ENV = venv;
    // Case-insensitive prefix gate mirrors the legacy startswith check. The
    // mkdtemp prefix guarantees an alphabetic character inside the path on
    // every platform, so flipping it exercises the comparison for real (a
    // case-sensitive gate would reject the flipped workdir).
    const flipIndex = workdir
      .split('')
      .findIndex((c) => c.toLowerCase() !== c.toUpperCase());
    expect(flipIndex).toBeGreaterThanOrEqual(0);
    const original = workdir.charAt(flipIndex);
    const flippedChar =
      original === original.toLowerCase()
        ? original.toUpperCase()
        : original.toLowerCase();
    const mixedCaseWorkdir =
      workdir.slice(0, flipIndex) + flippedChar + workdir.slice(flipIndex + 1);
    expect(mixedCaseWorkdir).not.toBe(workdir);
    expect(planSandboxVenvDestination(mixedCaseWorkdir)?.destination).toBe(
      venv,
    );
  });

  it('gives different worktrees distinct venv destinations', () => {
    // AC2: two worktrees of the same repository never share the private
    // environment: each plan derives its destination from its own root.
    const venvOne = path.join(workdir, '.venv');
    process.env.VIRTUAL_ENV = venvOne;
    const first = planSandboxVenvDestination(workdir);
    const secondWorktree = makeWorktree();
    try {
      const venvTwo = path.join(secondWorktree, '.venv');
      process.env.VIRTUAL_ENV = venvTwo;
      const second = planSandboxVenvDestination(secondWorktree);
      expect(first?.destination).not.toBe(second?.destination);
      expect(first?.destination).toBe(venvOne);
      expect(second?.destination).toBe(venvTwo);
    } finally {
      fs.rmSync(secondWorktree, { recursive: true, force: true });
    }
  });

  it('keeps the venv destination outside the repository configuration directory', () => {
    // AC1/AC4: the planned destination is the venv path itself; nothing
    // resolves into <repo>/.llxprt any more.
    const venv = path.join(workdir, '.venv');
    process.env.VIRTUAL_ENV = venv;
    const planned = planSandboxVenvDestination(workdir);
    expect(planned?.destination.startsWith(path.join(workdir, '.llxprt'))).toBe(
      false,
    );
  });
});

describe('#3462 venv destination in the engine-owned dependency plan', () => {
  const engine = useFakeEngine();
  let workdir = '';
  let restoreCacheEnv: () => void;

  beforeEach(() => {
    workdir = makeWorktree();
    restoreCacheEnv = isolateCacheEnv();
    fs.mkdirSync(path.join(workdir, 'node_modules'), { recursive: true });
    fs.writeFileSync(
      path.join(workdir, 'node_modules', 'host-root-marker.txt'),
      'host-root-marker\n',
    );
    process.env.VIRTUAL_ENV = path.join(workdir, '.venv');
    // The host venv tree may exist with host content; it is never mounted.
    fs.mkdirSync(process.env.VIRTUAL_ENV, { recursive: true });
    fs.writeFileSync(
      path.join(process.env.VIRTUAL_ENV, 'host-venv-marker.txt'),
      'host-venv-marker\n',
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.NODE_ENV;
    if (workdir !== '') fs.rmSync(workdir, { recursive: true, force: true });
    restoreCacheEnv();
  });

  it('plans one extra engine volume for the venv and appends its mount after the workspace bind', () => {
    const args: string[] = ['--volume', `${workdir}:${workdir}`];
    const lifecycle = addPrivateDependencyMounts(engine.config, args, workdir);
    try {
      // Root node_modules plus the venv destination.
      expect(engine.volumeNames()).toHaveLength(2);
      const mounts = flagValues(args, '--mount');
      expect(mounts).toHaveLength(2);
      const venvMount = mounts.find(
        (spec) =>
          mountField(spec, 'dst') ===
          getContainerPath(process.env.VIRTUAL_ENV!),
      );
      if (venvMount === undefined) {
        throw new Error('venv destination was not mounted');
      }
      expect(mountField(venvMount, 'type')).toBe('volume');
      expect(
        engine.volumeNames().includes(mountField(venvMount, 'src') ?? ''),
      ).toBe(true);
      expect(args.indexOf('--mount')).toBeGreaterThan(1);
    } finally {
      lifecycle.release();
    }
    expect(engine.volumeNames()).toStrictEqual([]);
  });

  it('creates no host venv state under the repository .llxprt directory', () => {
    const args: string[] = [];
    const lifecycle = addPrivateDependencyMounts(engine.config, args, workdir);
    lifecycle.release();

    // AC4/AC5: the version-controlled settings directory is never touched.
    expect(fs.existsSync(path.join(workdir, '.llxprt'))).toBe(false);
    // The pre-existing host venv tree is preserved byte-for-byte.
    expect(
      fs.readFileSync(
        path.join(workdir, '.venv', 'host-venv-marker.txt'),
        'utf8',
      ),
    ).toBe('host-venv-marker\n');
    const venvEntries = fs.readdirSync(path.join(workdir, '.venv'));
    expect(venvEntries).toStrictEqual(['host-venv-marker.txt']);
  });

  it('isolates the venv and root dependencies for a source-checkout development launch', () => {
    fs.mkdirSync(path.join(workdir, 'packages', 'cli'), { recursive: true });
    fs.writeFileSync(
      path.join(workdir, 'packages', 'cli', 'index.ts'),
      '// checked-out CLI source entrypoint',
    );
    process.env.NODE_ENV = 'development';
    const args: string[] = ['--volume', `${workdir}:${workdir}`];
    const lifecycle = addPrivateDependencyMounts(engine.config, args, workdir);

    try {
      const mounts = flagValues(args, '--mount');
      const destinations = mounts.map((spec) => mountField(spec, 'dst'));
      expect(destinations).toContain(
        getContainerPath(path.join(workdir, 'node_modules')),
      );
      expect(destinations).toContain(
        getContainerPath(process.env.VIRTUAL_ENV!),
      );
      expect(
        fs.readFileSync(
          path.join(workdir, 'node_modules', 'host-root-marker.txt'),
          'utf8',
        ),
      ).toBe('host-root-marker\n');
      expect(
        fs.readFileSync(
          path.join(workdir, '.venv', 'host-venv-marker.txt'),
          'utf8',
        ),
      ).toBe('host-venv-marker\n');
    } finally {
      lifecycle.release();
    }
    expect(engine.volumeNames()).toStrictEqual([]);
  });

  it('initializes the venv volume in the same bounded uid-0 init container run', () => {
    const args: string[] = [];
    const lifecycle = addPrivateDependencyMounts(engine.config, args, workdir);
    try {
      const initRuns = engine
        .invocations()
        .filter((argv) => argv[0] === 'run' && argv.includes('--init'));
      expect(initRuns).toHaveLength(1);
      const volumeNames = engine.volumeNames();
      const initMountSrcs = flagValues(initRuns[0], '--mount')
        .map((spec) => mountField(spec, 'src') ?? '')
        .sort();
      expect(initMountSrcs).toStrictEqual([...volumeNames].sort());
    } finally {
      lifecycle.release();
    }
  });

  it('wipes a host venv marker from the container view: the volume is empty inside the engine', () => {
    // The engine volume is fresh and empty; the host venv tree must not have
    // been copied into it. This is what makes the sandbox view isolated.
    const args: string[] = [];
    const lifecycle = addPrivateDependencyMounts(engine.config, args, workdir);
    try {
      const venvMount = flagValues(args, '--mount').find(
        (spec) =>
          mountField(spec, 'dst') ===
          getContainerPath(process.env.VIRTUAL_ENV!),
      );
      const volumeName = mountField(venvMount ?? '', 'src') ?? '';
      expect(volumeName).not.toBe('');
      const volumeRoot = path.join(engine.stateRoot, 'volumes', volumeName);
      expect(fs.readdirSync(volumeRoot)).toStrictEqual([]);
    } finally {
      lifecycle.release();
    }
  });

  it('removes an engine-created empty venv mountpoint that was absent before launch', () => {
    // Absent venv destination: the engine materializes the mountpoint
    // through the workspace bind; release removes it again.
    fs.rmSync(process.env.VIRTUAL_ENV!, { recursive: true, force: true });
    const args: string[] = [];
    const lifecycle = addPrivateDependencyMounts(engine.config, args, workdir);
    fs.mkdirSync(process.env.VIRTUAL_ENV!, { recursive: true });
    lifecycle.release();
    expect(fs.existsSync(process.env.VIRTUAL_ENV!)).toBe(false);
  });

  it('releases the venv volume together with the whole run on an abort path', () => {
    // Fail the SECOND volume create (the venv's): the node_modules volume
    // already exists, so the shared failure path must release it.
    engine.setKnob('fail-volume-create-on', '2');
    const error = capturedError(() =>
      addPrivateDependencyMounts(engine.config, [], workdir),
    );
    expect(error).toBeInstanceOf(FatalSandboxError);
    expect(engine.volumeNames()).toStrictEqual([]);
  });
});

describe('#3462 venv volume is writable by the selected container uid', () => {
  const engine = useFakeEngine();

  it('the init container leaves the venv volume root mode 1777', () => {
    const workdir = makeWorktree();
    const restoreCacheEnv = isolateCacheEnv();
    process.env.VIRTUAL_ENV = path.join(workdir, '.venv');
    const lifecycle = addPrivateDependencyMounts(engine.config, [], workdir);
    try {
      const names = engine.volumeNames();
      expect(names).toHaveLength(2);
      // Every volume root, including the venv's, is world-writable with the
      // sticky bit, so any selected container uid can write into it. Windows
      // stat modes never carry POSIX bits, so there the helper asserts the
      // observable contract: the init container actually ran against it.
      for (const name of names) {
        assertVolumeRootMode1777(path.join(engine.stateRoot, 'volumes', name));
      }
      const initRun = engine
        .invocations()
        .find((argv) => argv[0] === 'run' && argv.includes('--init'));
      if (initRun === undefined)
        throw new Error('Init container run is missing');
      const mounts = initRun.join(' ');
      for (const name of names) {
        expect(mounts).toContain(`src=${name},`);
      }
    } finally {
      lifecycle.release();
      delete process.env.VIRTUAL_ENV;
      restoreCacheEnv();
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  });
});

describe('#3462 venv plan respects preflight semantics', () => {
  const engine = useFakeEngine();

  it('does not preflight the venv tree: a wrong-platform host binary there does not stop the launch', () => {
    const workdir = makeWorktree();
    const restoreCacheEnv = isolateCacheEnv();
    process.env.VIRTUAL_ENV = path.join(workdir, '.venv');
    fs.mkdirSync(path.join(workdir, '.venv', 'bin'), { recursive: true });
    // An ELF header would abort the launch if the venv tree were treated
    // like a mounted host node_modules tree. The venv is never mounted, so
    // host content is irrelevant to the container view.
    fs.writeFileSync(
      path.join(workdir, '.venv', 'bin', 'python'),
      Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]),
    );
    const lifecycle = addPrivateDependencyMounts(engine.config, [], workdir);
    try {
      expect(engine.volumeNames()).toHaveLength(2);
    } finally {
      lifecycle.release();
      delete process.env.VIRTUAL_ENV;
      restoreCacheEnv();
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  });
});
