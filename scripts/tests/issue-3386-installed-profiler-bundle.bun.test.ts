/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSyncWithFileCapture } from './memory/sync-process.ts';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const cliPackageDir = join(repoRoot, 'packages', 'cli');
const cliBundleDir = join(cliPackageDir, 'bundle');
const runPackedSmoke = process.env.LLXPRT_RUN_BUNDLE_BUILD_TEST === '1';

const EXECUTABLE_BUNDLES = [
  'llxprt.js',
  'memprofile-launcher.js',
  'memprofile-preload.js',
  'memprofile-request.js',
  'memprofile-report.js',
  'memprofile-analyze.js',
] as const;

interface PackedFixture {
  readonly root: string;
  readonly packageDir: string;
  readonly callerDir: string;
  readonly dataRoot: string;
}

let fixture: PackedFixture | undefined;
let fixtureRoot: string | undefined;
let bundleBackupRoot: string | undefined;
let bundleReplacementStarted = false;
let restoreExistingBundle = false;

interface ProcessResult {
  readonly status: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly error?: Error;
  readonly stdout: string;
  readonly stderr: string;
}

function describeFailure(label: string, result: ProcessResult): string {
  return [
    `${label} failed (status=${result.status}, signal=${result.signal ?? 'none'})`,
    result.error === undefined ? '' : `spawn error: ${result.error.message}`,
    result.stdout.length === 0 ? '' : `stdout:\n${result.stdout}`,
    result.stderr.length === 0 ? '' : `stderr:\n${result.stderr}`,
  ]
    .filter((part) => part.length > 0)
    .join('\n');
}

function runOrThrow(
  label: string,
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly timeout?: number;
  },
): SpawnSyncReturns<string> {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    timeout: options.timeout ?? 180_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(describeFailure(label, result));
  }
  return result;
}

function npmInvocation(args: readonly string[]): {
  readonly command: string;
  readonly args: readonly string[];
} {
  if (process.platform !== 'win32') {
    return { command: 'npm', args };
  }
  return {
    command: process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', 'npm', ...args],
  };
}

function findPackedTarball(directory: string): string {
  const names = readdirSync(directory).filter((name) => name.endsWith('.tgz'));
  if (names.length !== 1) {
    throw new Error(
      `npm pack produced ${names.length} tarballs in ${directory}: ${names.join(', ')}`,
    );
  }
  return join(directory, names[0]);
}

function createPackedFixture(): PackedFixture {
  const root = mkdtempSync(join(tmpdir(), 'llxprt-3386-installed-'));
  fixtureRoot = root;
  const packDir = join(root, 'pack');
  const extractDir = join(root, 'extract');
  const callerDir = join(root, 'caller');
  const dataRoot = join(root, 'data');
  mkdirSync(packDir, { recursive: true });
  mkdirSync(extractDir, { recursive: true });
  mkdirSync(callerDir, { recursive: true });

  mkdirSync(cliBundleDir, { recursive: true });
  writeFileSync(join(cliBundleDir, 'stale-profiler.js'), 'stale\n');

  const npm = npmInvocation(['pack', '--pack-destination', packDir]);
  runOrThrow('npm pack', npm.command, npm.args, {
    cwd: cliPackageDir,
    timeout: 300_000,
    env: { ...process.env, CI: 'true' },
  });
  const tarball = findPackedTarball(packDir);
  runOrThrow('tar extract', 'tar', ['-xzf', tarball, '-C', extractDir], {
    cwd: callerDir,
  });

  const packageDir = join(extractDir, 'package');
  // Recreate the node_modules surface that a package manager installs. The
  // executable inputs still come only from the extracted tarball.
  symlinkSync(
    join(repoRoot, 'node_modules'),
    join(packageDir, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  return {
    root,
    packageDir,
    callerDir,
    dataRoot,
  };
}

function getFixture(): PackedFixture {
  if (fixture === undefined) {
    throw new Error('Packed CLI fixture was not initialized');
  }
  return fixture;
}

function installedEnv(current: PackedFixture): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CI: 'true',
    LLXPRT_DATA_HOME: current.dataRoot,
  };
}

function runInstalled(
  current: PackedFixture,
  args: readonly string[],
  extraEnv: NodeJS.ProcessEnv = {},
): ProcessResult {
  return spawnSyncWithFileCapture(
    current.root,
    'node',
    [join(current.packageDir, 'bin', 'llxprt.mjs'), ...args],
    {
      cwd: current.callerDir,
      env: { ...installedEnv(current), ...extraEnv },
      timeout: 25_000,
    },
  );
}

function sample(
  timestamp: string,
  tag: string,
  heapSize: number,
  objectCount: number,
): string {
  return JSON.stringify({
    t: timestamp,
    tag,
    pid: 3386,
    rss: heapSize * 2,
    heapSize,
    heapCapacity: heapSize,
    extraMemorySize: 0,
    objectCount,
    protectedObjectCount: 0,
    types: [['Object', objectCount]],
  });
}
function readRepoVersion(): string {
  const parsed: unknown = JSON.parse(
    readFileSync(join(repoRoot, 'package.json'), 'utf8'),
  );
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('version' in parsed) ||
    typeof parsed.version !== 'string'
  ) {
    throw new Error('Root package.json does not declare a string version');
  }
  return parsed.version;
}

describe.skipIf(!runPackedSmoke)(
  'issue #3386: packed installed profiler bundles',
  () => {
    beforeAll(() => {
      bundleBackupRoot = mkdtempSync(
        join(tmpdir(), 'llxprt-cli-bundle-backup-'),
      );
      if (existsSync(cliBundleDir)) {
        cpSync(cliBundleDir, join(bundleBackupRoot, 'bundle'), {
          recursive: true,
        });
        restoreExistingBundle = true;
      }
      bundleReplacementStarted = true;
      rmSync(cliBundleDir, { recursive: true, force: true });
      fixture = createPackedFixture();
    }, 360_000);

    afterAll(() => {
      if (fixtureRoot !== undefined) {
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
      if (bundleReplacementStarted) {
        rmSync(cliBundleDir, { recursive: true, force: true });
        if (restoreExistingBundle && bundleBackupRoot !== undefined) {
          cpSync(join(bundleBackupRoot, 'bundle'), cliBundleDir, {
            recursive: true,
          });
        }
      }
      if (bundleBackupRoot !== undefined) {
        rmSync(bundleBackupRoot, { recursive: true, force: true });
      }
    });

    it('emits and packs exactly the stable executable bundle set', () => {
      const current = getFixture();
      const emitted = readdirSync(join(current.packageDir, 'bundle'))
        .filter((entry) => entry.endsWith('.js'))
        .sort();

      expect(emitted).toEqual([...EXECUTABLE_BUNDLES].sort());
      expect(existsSync(join(current.packageDir, 'scripts', 'memory'))).toBe(
        false,
      );
      expect(
        existsSync(join(current.packageDir, 'bundle', 'stale-profiler.js')),
      ).toBe(false);
    });

    it('preserves ordinary installed launch behavior from an external cwd', () => {
      const current = getFixture();
      const expectedVersion = readRepoVersion();
      const result = runInstalled(current, ['--version']);

      expect(result.status, describeFailure('ordinary launch', result)).toBe(0);
      expect(result.stdout.trim()).toBe(expectedVersion);
    });

    it('records startup and periodic samples through the packed profiler', () => {
      const current = getFixture();
      const result = runInstalled(
        current,
        [
          '--memprofile=1',
          '--provider',
          'fake',
          '--model',
          'fake-model',
          'render one deterministic response',
        ],
        {
          LLXPRT_FAKE_RESPONSES: join(
            repoRoot,
            'scripts',
            'fixtures',
            'issue2208-newlines.responses.jsonl',
          ),
        },
      );

      expect(result.status, describeFailure('profiled prompt', result)).toBe(0);
      expect(result.stdout).toContain('memprofile: run dir');
      expect(result.stdout).toContain('LLXPRT2208_DONE');

      const latest = readFileSync(
        join(current.dataRoot, 'memprofile', 'latest'),
        'utf8',
      ).trim();
      const samples = readFileSync(join(latest, 'samples.jsonl'), 'utf8');
      expect(samples).toContain('"tag":"startup"');
      expect(samples).toContain('"tag":"tick"');
    }, 30_000);

    it('queues a request and renders a report against prepared installed runs', () => {
      const current = getFixture();
      const runDir = join(current.dataRoot, 'memprofile', 'prepared-run');
      mkdirSync(runDir, { recursive: true });
      writeFileSync(
        join(runDir, 'probe.lease'),
        JSON.stringify({
          owner: 'test-owner',
          pid: process.pid,
          heartbeatAt: Date.now(),
        }),
      );
      writeFileSync(join(current.dataRoot, 'memprofile', 'latest'), runDir);
      writeFileSync(
        join(runDir, 'samples.jsonl'),
        [
          sample('2026-08-27T10:00:00.000Z', 'startup', 1024, 10),
          sample('2026-08-27T10:01:00.000Z', 'manual', 2048, 20),
        ].join('\n') + '\n',
      );

      const request = runInstalled(current, ['memprofile', 'request']);
      expect(request.status, describeFailure('request utility', request)).toBe(
        0,
      );
      expect(request.stdout).toContain('Queued sample request');
      expect(
        readdirSync(join(runDir, 'requests')).some((name) =>
          name.endsWith('.json'),
        ),
      ).toBe(true);

      const report = runInstalled(current, ['memprofile', 'report', runDir]);
      expect(report.status, describeFailure('report utility', report)).toBe(0);
      expect(report.stdout).toContain('2 samples over');
      expect(report.stdout).toContain('Object');
    });

    it('launches analyzer usage validation and reports a missing artifact', () => {
      const current = getFixture();
      const usage = runInstalled(current, ['memprofile', 'analyze']);
      expect(usage.status).toBe(2);
      expect(usage.stderr).toContain(
        'Usage: llxprt memprofile analyze <file.heapsnapshot>',
      );

      const analyzer = join(
        current.packageDir,
        'bundle',
        'memprofile-analyze.js',
      );
      const hiddenAnalyzer = `${analyzer}.missing`;
      renameSync(analyzer, hiddenAnalyzer);
      try {
        const missing = runInstalled(current, ['memprofile', 'analyze']);
        expect(missing.status).toBe(43);
        expect(missing.stderr).toContain(
          'memory profiler entry point was not found',
        );
        expect(missing.stderr).toContain('memprofile-analyze.js');
      } finally {
        renameSync(hiddenAnalyzer, analyzer);
      }
    });
  },
);
