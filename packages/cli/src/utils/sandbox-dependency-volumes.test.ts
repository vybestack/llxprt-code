/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import { Storage } from '@vybestack/llxprt-code-storage';
import { useFakeEngine } from '../../test-utils/fake-dependency-engine-harness.js';
import {
  DEPENDENCY_VOLUME_NAME_PREFIX,
  SANDBOX_DEPENDENCY_RUN_LABEL,
  buildDependencyInitScript,
} from './sandbox-dependency-volumes.js';
import { addPrivateDependencyMounts } from './sandbox-node-modules.js';
import { getContainerPath } from './sandbox-env.js';

const RUN_ROOT_PREFIX = 'sandbox-node-modules-';

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'issue3450-ws-'));
}

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

function privateRunRoots(): string[] {
  const cacheDir = Storage.getGlobalCacheDir();
  return fs
    .readdirSync(cacheDir)
    .filter((entry) => entry.startsWith(RUN_ROOT_PREFIX))
    .map((entry) => path.join(cacheDir, entry));
}

function flagValues(argv: readonly string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length - 1; index++) {
    if (argv[index] === flag) values.push(argv[index + 1]);
  }
  return values;
}

function labelValue(argv: readonly string[], labelName: string): string {
  const prefix = `${labelName}=`;
  const value = flagValues(argv, '--label').find((label) =>
    label.startsWith(prefix),
  );
  if (value === undefined) throw new Error(`Missing label '${labelName}'`);
  return value.slice(prefix.length);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseOwnerLabel(payload: string | undefined): {
  readonly version: unknown;
  readonly hostname: unknown;
  readonly pid: unknown;
} {
  if (payload === undefined) throw new Error('Owner label is missing');
  const parsed: unknown = JSON.parse(payload);
  if (!isUnknownRecord(parsed)) throw new Error('Owner label is not an object');
  return {
    version: parsed.version,
    hostname: parsed.hostname,
    pid: parsed.pid,
  };
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

describe('#3450 engine-owned dependency volumes', () => {
  const engine = useFakeEngine();
  let workdir = '';
  let restoreCacheEnv: () => void;

  beforeEach(() => {
    workdir = makeWorkspace();
    restoreCacheEnv = isolateCacheEnv();
    writeJson(path.join(workdir, 'package.json'), {
      workspaces: ['packages/nested', 'packages/absent'],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (workdir !== '') fs.rmSync(workdir, { recursive: true, force: true });
    restoreCacheEnv();
  });

  it('creates one uniquely named, ownership-labeled volume per protected destination and no host storage', () => {
    const lifecycle = addPrivateDependencyMounts(engine.config, [], workdir);
    try {
      const names = engine.volumeNames();
      expect(names).toHaveLength(3);
      for (const name of names) {
        expect(name.startsWith(DEPENDENCY_VOLUME_NAME_PREFIX)).toBe(true);
      }
      expect(new Set(names).size).toBe(3);
      const state = engine.snapshot();
      for (const name of names) {
        const labels = state.volumes[name].labels;
        expect(labels['com.vybestack.llxprt.sandbox-managed']).toBe('true');
        const owner = parseOwnerLabel(
          labels['com.vybestack.llxprt.sandbox-owner'],
        );
        expect(owner.version).toBe(1);
        expect(owner.hostname).toBe(os.hostname());
        expect(owner.pid).toBe(process.pid);
      }
      // The storage is engine-owned: nothing is created on the host.
      expect(privateRunRoots()).toStrictEqual([]);
    } finally {
      lifecycle.release();
    }
    expect(engine.volumeNames()).toStrictEqual([]);
  });

  it('shares one explicit run ID across volumes, init container, and main container state', () => {
    const mainArgs: string[] = [];
    const lifecycle = addPrivateDependencyMounts(
      engine.config,
      mainArgs,
      workdir,
    );
    const volumeNames = engine.volumeNames();
    const volumeRunIds = volumeNames.map(
      (name) =>
        engine.snapshot().volumes[name].labels[SANDBOX_DEPENDENCY_RUN_LABEL],
    );
    const runId = volumeRunIds[0];
    expect(runId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(volumeRunIds).toStrictEqual(volumeNames.map(() => runId));

    const initRun = engine
      .invocations()
      .find((argv) => argv[0] === 'run' && argv.includes('--init'));
    if (initRun === undefined) throw new Error('Init container run is missing');
    expect(labelValue(initRun, SANDBOX_DEPENDENCY_RUN_LABEL)).toBe(runId);
    expect(labelValue(mainArgs, SANDBOX_DEPENDENCY_RUN_LABEL)).toBe(runId);

    const mainContainerName = 'issue3450-labeled-main';
    lifecycle.recordMainContainerName(mainContainerName);
    const launched = spawnSync(
      engine.command,
      ['run', '--name', mainContainerName, ...mainArgs, engine.config.image],
      { encoding: 'utf8', env: process.env },
    );
    expect(launched.status).toBe(0);
    expect(
      engine.snapshot().containers[mainContainerName].labels[
        SANDBOX_DEPENDENCY_RUN_LABEL
      ],
    ).toBe(runId);

    lifecycle.release();
    expect(engine.containerNames()).toStrictEqual([]);
    expect(engine.volumeNames()).toStrictEqual([]);
  });

  it('uses a distinct run ID for each dependency lifecycle', () => {
    const firstArgs: string[] = [];
    const first = addPrivateDependencyMounts(engine.config, firstArgs, workdir);
    const firstRunId = labelValue(firstArgs, SANDBOX_DEPENDENCY_RUN_LABEL);
    first.release();

    const secondArgs: string[] = [];
    const second = addPrivateDependencyMounts(
      engine.config,
      secondArgs,
      workdir,
    );
    const secondRunId = labelValue(secondArgs, SANDBOX_DEPENDENCY_RUN_LABEL);
    expect(secondRunId).not.toBe(firstRunId);
    second.release();
    expect(engine.volumeNames()).toStrictEqual([]);
  });

  it('initializes every volume through one bounded uid-0 init container that mounts no host path', () => {
    process.env.SANDBOX_FLAGS =
      '--cap-add=SYS_ADMIN --volume /host-source:/host-destination';
    const lifecycle = addPrivateDependencyMounts(engine.config, [], workdir);
    try {
      const initRuns = engine.invocations().filter((argv) => argv[0] === 'run');
      expect(initRuns).toHaveLength(1);
      const argv = initRuns[0];
      expect(flagValues(argv, '--user')).toStrictEqual(['0:0']);
      expect(flagValues(argv, '--network')).toStrictEqual(['none']);
      expect(flagValues(argv, '--security-opt')).toStrictEqual([
        'no-new-privileges',
      ]);
      expect(argv).toContain('--cap-drop=ALL');
      expect(argv).toContain('--rm');
      expect(argv).toContain('--init');
      expect(argv).toContain('--pull=never');
      expect(flagValues(argv, '--pull')).toStrictEqual([]);
      expect(argv).toContain(engine.config.image);
      // SANDBOX_FLAGS never reach the init container.
      expect(argv.some((token) => token.startsWith('--cap-add'))).toBe(false);

      // The only mounts are the freshly created named volumes.
      const volumeNames = engine.volumeNames();
      const mounts = flagValues(argv, '--mount');
      expect(mounts).toHaveLength(3);
      for (const mount of mounts) {
        const source = /^type=volume,src=([^,]+),dst=/.exec(mount)?.[1];
        expect(volumeNames.includes(source ?? '')).toBe(true);
      }
      // Init destinations are neutral image paths, never host paths.
      const absoluteTokens = argv.filter((token) => token.startsWith('/'));
      for (const token of absoluteTokens) {
        expect(/^\/tmp\/llxprt-deps-\d+$/.test(token)).toBe(true);
      }
      // The real init script ran inside the engine: each volume root is now
      // mode 1777 (world-writable with the sticky bit).
      for (const name of volumeNames) {
        const root = path.join(engine.stateRoot, 'volumes', name);
        expect(fs.statSync(root).mode & 0o1777).toBe(0o1777);
      }
    } finally {
      lifecycle.release();
    }
  });

  it('appends one volume mount per destination after the shared workspace bind, identically for docker and podman', () => {
    const dockerArgs: string[] = ['--volume', `${workdir}:${workdir}`];
    const dockerLifecycle = addPrivateDependencyMounts(
      engine.config,
      dockerArgs,
      workdir,
    );
    const podmanArgs: string[] = ['--volume', `${workdir}:${workdir}`];
    const podmanLifecycle = addPrivateDependencyMounts(
      { command: 'podman', image: engine.config.image },
      podmanArgs,
      workdir,
    );
    try {
      const dockerMounts = flagValues(dockerArgs, '--mount');
      const podmanMounts = flagValues(podmanArgs, '--mount');
      expect(dockerMounts).toHaveLength(3);
      expect(podmanMounts).toHaveLength(3);
      // Mounts come after the shared workspace bind (nested mounts win).
      expect(dockerArgs.indexOf('--mount')).toBeGreaterThan(1);
      expect(podmanArgs.indexOf('--mount')).toBeGreaterThan(1);
      const destinations = [
        path.join(workdir, 'node_modules'),
        path.join(workdir, 'packages', 'nested', 'node_modules'),
        path.join(workdir, 'packages', 'absent', 'node_modules'),
      ].map(getContainerPath);
      for (const mounts of [dockerMounts, podmanMounts]) {
        const sources: string[] = [];
        const mountedDestinations: string[] = [];
        for (const mount of mounts) {
          expect(mountField(mount, 'type')).toBe('volume');
          sources.push(mountField(mount, 'src') ?? '');
          mountedDestinations.push(mountField(mount, 'dst') ?? '');
          // Volume mounts carry no bind-mount SELinux label: engine volumes
          // are shared the same way on docker and rootless podman.
          expect(mount.endsWith(':z')).toBe(false);
        }
        expect(mountedDestinations).toStrictEqual(destinations);
        expect(
          sources.every((source) => engine.volumeNames().includes(source)),
        ).toBe(true);
      }
      expect(flagValues(dockerArgs, '--volume').slice(1)).toStrictEqual([]);
    } finally {
      dockerLifecycle.release();
      podmanLifecycle.release();
    }
  });

  it('releases the volumes it already created and fails fast with engine stderr when a volume create fails', () => {
    // Fail the SECOND create: the first volume already exists, so the
    // failure path must release it instead of leaking it.
    engine.setKnob('fail-volume-create-on', '2');
    const args: string[] = ['--volume', `${workdir}:${workdir}`];
    const error = capturedError(() =>
      addPrivateDependencyMounts(engine.config, args, workdir),
    );
    expect(error).toBeInstanceOf(FatalSandboxError);
    expect(error.message).toContain(
      'Failed to create the private sandbox dependency volume',
    );
    expect(error.message).toContain(
      'fake engine: volume create failed by request',
    );
    // The already-created volume was released through the engine.
    expect(engine.volumeNames()).toStrictEqual([]);
    expect(
      engine
        .invocations()
        .some((argv) => argv[0] === 'volume' && argv[1] === 'rm'),
    ).toBe(true);
    // No mounts were appended for a failed preparation.
    expect(args).toStrictEqual(['--volume', `${workdir}:${workdir}`]);
    expect(privateRunRoots()).toStrictEqual([]);
  });

  it('releases the volumes and the attached init container when initialization fails', () => {
    engine.setKnob('fail-run-once');
    const args: string[] = [];
    const error = capturedError(() =>
      addPrivateDependencyMounts(engine.config, args, workdir),
    );
    expect(error).toBeInstanceOf(FatalSandboxError);
    expect(error.message).toContain(
      'Failed to initialize the private sandbox dependency volumes',
    );
    expect(error.message).toContain('fake engine: run failed by request');
    // The failed init run stays recorded as an attached container; release
    // removed it BEFORE the volumes, so the volumes could actually go.
    expect(engine.containerNames()).toStrictEqual([]);
    expect(engine.volumeNames()).toStrictEqual([]);
    expect(privateRunRoots()).toStrictEqual([]);
  });

  it('removes a recorded main container before its volumes on release', () => {
    const lifecycle = addPrivateDependencyMounts(engine.config, [], workdir);
    const volumeNames = engine.volumeNames();
    expect(volumeNames).toHaveLength(3);
    lifecycle.recordMainContainerName('issue3450-main-container');
    // Simulate the main sandbox holding the volumes: a container without
    // --rm keeps them attached in the engine.
    const attachArgs: string[] = ['run', '--name', 'issue3450-main-container'];
    volumeNames.forEach((name, index) => {
      attachArgs.push(
        '--mount',
        `type=volume,src=${name},dst=/attach-${index}`,
      );
    });
    attachArgs.push(engine.config.image, 'true');
    const attached = spawnSync(engine.command, attachArgs, {
      encoding: 'utf8',
      env: process.env,
    });
    expect(attached.status).toBe(0);
    expect(engine.containerNames()).toStrictEqual(['issue3450-main-container']);

    lifecycle.release();

    // Ordering proven through final state: had the volumes been removed
    // while the container still held them, every removal would have failed
    // and the volumes would still exist.
    expect(engine.containerNames()).toStrictEqual([]);
    expect(engine.volumeNames()).toStrictEqual([]);
  });

  it('stops a recognized wrong-platform host tree before any engine side effect', () => {
    fs.mkdirSync(path.join(workdir, 'node_modules', 'host-pkg'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(workdir, 'node_modules', 'host-pkg', 'addon.node'),
      Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]),
    );

    expect(() =>
      addPrivateDependencyMounts(engine.config, [], workdir),
    ).toThrowError('Sandbox dependency preflight failed');
    // Not a single engine invocation happened: no volumes, no containers,
    // no state file at all.
    expect(engine.snapshot().invocations).toStrictEqual([]);
    expect(engine.volumeNames()).toStrictEqual([]);
    expect(privateRunRoots()).toStrictEqual([]);
  });
});

describe('#3450 dependency init script', () => {
  it('chmods an empty root to 1777 and fails on a root that is not empty', () => {
    const script = buildDependencyInitScript();
    const emptyRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'issue3450-init-empty-'),
    );
    const emptyRun = spawnSync('sh', [
      '-c',
      script,
      'llxprt-dependency-init',
      emptyRoot,
    ]);
    expect(emptyRun.status).toBe(0);
    expect(fs.statSync(emptyRoot).mode & 0o1777).toBe(0o1777);

    const seededRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'issue3450-init-seeded-'),
    );
    fs.writeFileSync(path.join(seededRoot, 'stale.txt'), 'stale\n');
    const seededRun = spawnSync('sh', [
      '-c',
      script,
      'llxprt-dependency-init',
      seededRoot,
    ]);
    expect(seededRun.status).not.toBe(0);
    expect(String(seededRun.stderr)).toContain('is not empty');
    expect(fs.existsSync(path.join(seededRoot, 'stale.txt'))).toBe(true);
  });
});
