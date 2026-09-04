/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SandboxConfig } from '@vybestack/llxprt-code-core';
import { psExecutableSource } from '../../test-utils/ps-executable-fixture.js';
import {
  FIXTURE_TIMEOUT_MS,
  removeFixtureDirectory,
  removeNewRootBunBuildIntermediates,
  rootBunBuildIntermediatePaths,
  writePortableExecutable,
} from '../../test-utils/sandbox-fixture-compiler.js';
import { assignContainerName } from './sandbox-containers.js';
import { runContainerSandbox } from './sandbox-exec.js';

const MANAGED_LABEL = 'com.vybestack.llxprt.sandbox-managed=true';
const TEST_IMAGE = 'llxprt-code-sandbox';
const TIMEZONE_REGRESSION_CHILD = 'LLXPRT_TEST_TIMEZONE_REGRESSION_CHILD';
const ENGINE_ENV_KEYS = [
  'LLXPRT_TEST_DOCKER_STATE',
  'LLXPRT_TEST_PODMAN_STATE',
  'LLXPRT_TEST_ENGINE_LOG',
  'LLXPRT_TEST_LIST_FAILURE',
  'LLXPRT_TEST_REMOVE_FAILURE_ID',
  'LLXPRT_TEST_LIST_HANG',
  'LLXPRT_TEST_REMOVE_HANG_ID',
  'LLXPRT_TEST_PROCESS_STARTS',
  'LLXPRT_TEST_PS_HANG',
  'LLXPRT_TEST_PS_OUTPUT',
] satisfies readonly string[];

interface OwnerMetadata {
  readonly version: 1;
  readonly hostname: string;
  readonly pid: number;
  readonly startTimeMs: number;
  readonly startTimeSource: 'observed' | 'estimated';
}

function requirePid(child: ChildProcess): number {
  if (child.pid === undefined) {
    throw new Error('Test child did not start');
  }
  return child.pid;
}

function processStartsPath(): string {
  const startsPath = process.env.LLXPRT_TEST_PROCESS_STARTS;
  if (startsPath === undefined) {
    throw new Error('Test process-start state path was not configured');
  }
  return startsPath;
}

function recordProcessStart(child: ChildProcess): number {
  const pid = requirePid(child);
  const startTimeMs = Math.floor(Date.now() / 1000) * 1000;
  fs.appendFileSync(processStartsPath(), `${pid}\t${startTimeMs}\n`);
  return startTimeMs;
}

function ownerFor(
  child: ChildProcess,
  startTimeSource: OwnerMetadata['startTimeSource'] = 'observed',
): OwnerMetadata {
  return {
    version: 1,
    hostname: os.hostname(),
    pid: requirePid(child),
    startTimeMs: recordProcessStart(child),
    startTimeSource,
  };
}

function row(containerId: string, owner: OwnerMetadata | string): string {
  const payload = typeof owner === 'string' ? owner : JSON.stringify(owner);
  return `${containerId}\t${payload}`;
}

function engineStatePath(command: 'docker' | 'podman'): string {
  const key =
    command === 'docker'
      ? 'LLXPRT_TEST_DOCKER_STATE'
      : 'LLXPRT_TEST_PODMAN_STATE';
  const statePath = process.env[key];
  if (statePath === undefined) {
    throw new Error(`Test engine state path ${key} was not configured`);
  }
  return statePath;
}

function engineLogPath(): string {
  const logPath = process.env.LLXPRT_TEST_ENGINE_LOG;
  if (logPath === undefined) {
    throw new Error('Test engine log path was not configured');
  }
  return logPath;
}

function engineExecutableSource(command: SandboxConfig['command']): string {
  return `#!/usr/bin/env bun
import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const engine = ${JSON.stringify(command)};
const stateKey = engine === 'docker'
  ? 'LLXPRT_TEST_DOCKER_STATE'
  : 'LLXPRT_TEST_PODMAN_STATE';
const statePath = process.env[stateKey];
const logPath = process.env.LLXPRT_TEST_ENGINE_LOG;
if (statePath === undefined || logPath === undefined) process.exit(46);

const args = process.argv.slice(2);
appendFileSync(logPath, engine + ':' + args.join(' ') + '\\n');
if (args[0] === 'ps') {
  if (process.env.LLXPRT_TEST_LIST_HANG === '1') {
    await new Promise((resolve) => setTimeout(resolve, 7000));
  }
  if (process.env.LLXPRT_TEST_LIST_FAILURE === '1') process.exit(42);
  if (args.includes('--filter') &&
      !args.includes(${JSON.stringify(`label=${MANAGED_LABEL}`)})) process.exit(43);
  const rows = readFileSync(statePath, 'utf8')
    .split('\\n')
    .filter((line) => line !== '');
  const formatIndex = args.indexOf('--format');
  const format = formatIndex < 0 ? '' : args[formatIndex + 1];
  if (format === '{{.ID}}') {
    const ids = rows.map((line) => line.split('\\t')[0]);
    if (ids.length > 0) process.stdout.write(ids.join('\\n') + '\\n');
  } else {
    process.stdout.write(readFileSync(statePath, 'utf8'));
  }
  process.exit(0);
}
if (args[0] === 'inspect') {
  const containerId = args[1];
  const row = readFileSync(statePath, 'utf8')
    .split('\\n')
    .find((line) => line.startsWith(containerId + '\\t'));
  if (row === undefined) process.exit(45);
  const owner = row.slice(row.indexOf('\\t') + 1);
  process.stdout.write(JSON.stringify([{
    Id: containerId,
    Config: { Labels: {
      'com.vybestack.llxprt.sandbox-managed': 'true',
      'com.vybestack.llxprt.sandbox-owner': owner,
    } },
    State: { Running: true },
  }]) + '\\n');
  process.exit(0);
}
if (args[0] === 'volume' && args[1] === 'ls') process.exit(0);
if (args[0] === 'rm' && args[1] === '-f') {
  const containerId = args[2];
  if (containerId === undefined) process.exit(45);
  if (process.env.LLXPRT_TEST_REMOVE_HANG_ID === containerId) {
    await new Promise((resolve) => setTimeout(resolve, 7000));
  }
  if (process.env.LLXPRT_TEST_REMOVE_FAILURE_ID === containerId) process.exit(44);
  const remainingRows = readFileSync(statePath, 'utf8')
    .split('\\n')
    .filter((line) => line !== '' && line.split('\\t')[0] !== containerId);
  const nextStatePath = statePath + '.next';
  writeFileSync(
    nextStatePath,
    remainingRows.length === 0 ? '' : remainingRows.join('\\n') + '\\n',
  );
  renameSync(nextStatePath, statePath);
  process.exit(0);
}
if (args[0] === 'images' && args[1] === '-q') process.exit(0);
process.exit(45);
`;
}

function warmProcessStartExecutable(fixtureDir: string): void {
  const executableName = process.platform === 'win32' ? 'ps.exe' : 'ps';
  const executablePath = path.join(fixtureDir, executableName);
  const startsPath = path.join(fixtureDir, 'ps-warmup.state');
  fs.writeFileSync(startsPath, `${process.pid}\t${Date.now()}\n`);
  try {
    const warmup = spawnSync(
      executablePath,
      ['-o', 'lstart=', '-p', String(process.pid)],
      {
        encoding: 'utf8',
        env: { ...process.env, LLXPRT_TEST_PROCESS_STARTS: startsPath },
        timeout: FIXTURE_TIMEOUT_MS,
        windowsHide: true,
      },
    );
    if (warmup.error !== undefined) throw warmup.error;
    if (warmup.status !== 0) {
      throw new Error(
        `Failed to warm ${executableName}: ${warmup.stderr.trim()}`,
      );
    }
  } finally {
    fs.rmSync(startsPath, { force: true });
  }
}

async function runRecoveryStartup(
  command: SandboxConfig['command'],
): Promise<string> {
  const config: SandboxConfig = { command, image: TEST_IMAGE };
  try {
    await runContainerSandbox(config, []);
    return 'startup unexpectedly completed';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function stopChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once('close', () => resolve());
    child.kill('SIGKILL');
  });
}

function rerunInNonUtcTimezone(testName: string): void {
  const testPath = path.join(
    import.meta.dirname,
    'sandbox-orphan-reaping.bun.test.ts',
  );
  const child = spawnSync(
    process.execPath,
    [
      'test',
      '--timeout',
      String(FIXTURE_TIMEOUT_MS),
      testPath,
      '--test-name-pattern',
      testName,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        TZ: 'America/New_York',
        [TIMEZONE_REGRESSION_CHILD]: '1',
      },
      timeout: FIXTURE_TIMEOUT_MS,
      windowsHide: true,
    },
  );
  if (child.error !== undefined) {
    throw child.error;
  }
  if (child.status !== 0) {
    throw new Error(
      [
        'Non-UTC timezone regression child failed.',
        child.stdout.trim(),
        child.stderr.trim(),
      ].join('\n'),
    );
  }
}

describe('sandbox orphan recovery startup', () => {
  let environmentSnapshot: NodeJS.ProcessEnv;
  let fixtureDir = '';
  let liveChildren: ChildProcess[] = [];
  let rootBuildIntermediatesBeforeSuite: ReadonlySet<string> = new Set();

  beforeAll(() => {
    rootBuildIntermediatesBeforeSuite = rootBunBuildIntermediatePaths();
    const fixtureRoot = path.resolve('tmp');
    fs.mkdirSync(fixtureRoot, { recursive: true });
    fixtureDir = fs.mkdtempSync(
      path.join(fixtureRoot, 'issue3449-orphan-reaping-'),
    );
    try {
      writePortableExecutable(
        'docker',
        engineExecutableSource('docker'),
        fixtureDir,
      );
      writePortableExecutable(
        'podman',
        engineExecutableSource('podman'),
        fixtureDir,
      );
      writePortableExecutable(
        'sandbox-exec',
        engineExecutableSource('sandbox-exec'),
        fixtureDir,
      );
      writePortableExecutable('ps', psExecutableSource(), fixtureDir);
      warmProcessStartExecutable(fixtureDir);
    } catch (error) {
      removeFixtureDirectory(fixtureDir);
      removeNewRootBunBuildIntermediates(rootBuildIntermediatesBeforeSuite);
      throw error;
    }
  });

  beforeEach(() => {
    environmentSnapshot = { ...process.env };
    const dockerState = path.join(fixtureDir, 'docker.state');
    const podmanState = path.join(fixtureDir, 'podman.state');
    const engineLog = path.join(fixtureDir, 'engine.log');
    const processStarts = path.join(fixtureDir, 'process-starts.state');
    for (const key of ENGINE_ENV_KEYS.slice(3)) delete process.env[key];
    fs.writeFileSync(dockerState, '');
    fs.writeFileSync(podmanState, '');
    fs.writeFileSync(engineLog, '');
    fs.writeFileSync(processStarts, '');
    process.env.PATH = `${fixtureDir}${path.delimiter}${process.env.PATH ?? ''}`;
    process.env.LLXPRT_TEST_DOCKER_STATE = dockerState;
    process.env.LLXPRT_TEST_PODMAN_STATE = podmanState;
    process.env.LLXPRT_TEST_ENGINE_LOG = engineLog;
    process.env.LLXPRT_TEST_PROCESS_STARTS = processStarts;
    process.env.SANDBOX_SET_UID_GID = 'false';
    process.env.LLXPRT_SANDBOX_SSH_AGENT = 'off';
    process.env.NODE_ENV = 'development';
    liveChildren = [];
  });

  afterEach(async () => {
    await Promise.all(liveChildren.map(stopChild));
    process.env = environmentSnapshot;
    vi.restoreAllMocks();
  });

  afterAll(() => {
    try {
      removeFixtureDirectory(fixtureDir);
    } finally {
      removeNewRootBunBuildIntermediates(rootBuildIntermediatesBeforeSuite);
    }
  });

  it('records and retains matching owners under a non-UTC host timezone', async () => {
    const testName =
      'records and retains matching owners under a non-UTC host timezone';
    if (process.env[TIMEZONE_REGRESSION_CHILD] !== '1') {
      rerunInNonUtcTimezone(testName);
      return;
    }

    process.env.LLXPRT_TEST_PS_OUTPUT = 'Wed Jul 15 12:34:56 2026';
    const observedStartTimeMs = Date.UTC(2026, 6, 15, 12, 34, 56);
    const args: string[] = [];
    assignContainerName(
      args,
      { command: 'docker', image: TEST_IMAGE },
      TEST_IMAGE,
    );
    const ownerLabel = args.find((arg) =>
      arg.startsWith('com.vybestack.llxprt.sandbox-owner='),
    );
    if (ownerLabel === undefined) {
      throw new Error('Sandbox owner label was not emitted');
    }
    const recordedOwner: unknown = JSON.parse(
      ownerLabel.slice(ownerLabel.indexOf('=') + 1),
    );
    const expectedOwner: OwnerMetadata = {
      version: 1,
      hostname: os.hostname(),
      pid: process.pid,
      startTimeMs: observedStartTimeMs,
      startTimeSource: 'observed',
    };
    expect(recordedOwner).toEqual(expectedOwner);

    const statePath = engineStatePath('docker');
    const logPath = engineLogPath();
    const originalState = `${row('live-container', expectedOwner)}\n`;
    fs.writeFileSync(statePath, originalState);

    const startupResult = await runRecoveryStartup('docker');

    expect({
      startupResult,
      state: fs.readFileSync(statePath, 'utf8'),
      queried: fs
        .readFileSync(logPath, 'utf8')
        .includes(`docker:ps -a --filter label=${MANAGED_LABEL}`),
    }).toEqual({
      startupResult: expect.stringContaining(
        `Sandbox image '${TEST_IMAGE}' is missing`,
      ),
      state: originalState,
      queried: true,
    });
  }, 30_000);

  it.each([
    ['an impossible calendar day', 'Mon Feb 30 12:34:56 2026'],
    ['a mismatched weekday', 'Thu Jul 15 12:34:56 2026'],
    ['an out-of-range hour', 'Wed Jul 15 24:00:00 2026'],
  ])('falls back when process start output has %s', (_caseName, output) => {
    process.env.LLXPRT_TEST_PS_OUTPUT = output;
    const args: string[] = [];

    assignContainerName(
      args,
      { command: 'docker', image: TEST_IMAGE },
      TEST_IMAGE,
    );

    const ownerLabel = args.find((arg) =>
      arg.startsWith('com.vybestack.llxprt.sandbox-owner='),
    );
    if (ownerLabel === undefined) {
      throw new Error('Sandbox owner label was not emitted');
    }
    const owner: unknown = JSON.parse(
      ownerLabel.slice(ownerLabel.indexOf('=') + 1),
    );
    expect(owner).toEqual(
      expect.objectContaining({ startTimeSource: 'estimated' }),
    );
  });

  it.each([
    ['an impossible calendar day', 'Mon Feb 30 12:34:56 2026'],
    ['a mismatched weekday', 'Thu Jul 15 12:34:56 2026'],
    ['an out-of-range hour', 'Wed Jul 15 24:00:00 2026'],
  ])(
    'retains a live owner when process start output has %s',
    async (_caseName, output) => {
      const owner = spawn(process.execPath, [
        '-e',
        'setInterval(() => {}, 1000)',
      ]);
      liveChildren = [owner];
      const statePath = engineStatePath('docker');
      const originalState = `${row('unverifiable-date', ownerFor(owner))}\n`;
      fs.writeFileSync(statePath, originalState);
      process.env.LLXPRT_TEST_PS_OUTPUT = output;

      const startupResult = await runRecoveryStartup('docker');

      expect({
        startupResult,
        state: fs.readFileSync(statePath, 'utf8'),
      }).toEqual({
        startupResult: expect.stringContaining(
          `Sandbox image '${TEST_IMAGE}' is missing`,
        ),
        state: originalState,
      });
    },
  );

  it('does not run container recovery for sandbox-exec preparation', async () => {
    const startupResult = await runRecoveryStartup('sandbox-exec');
    const engineLog = fs.readFileSync(engineLogPath(), 'utf8');

    expect({ startupResult, engineLog }).toEqual({
      startupResult: expect.stringContaining(
        `Sandbox image '${TEST_IMAGE}' is missing`,
      ),
      engineLog: expect.not.stringContaining('sandbox-exec:ps --filter'),
    });
  });

  it('removes a marked container after its owner exits', async () => {
    const owner = spawn(process.execPath, [
      '-e',
      'setInterval(() => {}, 1000)',
    ]);
    const metadata = ownerFor(owner);
    await stopChild(owner);
    const statePath = engineStatePath('docker');
    fs.writeFileSync(statePath, `${row('dead-container', metadata)}\n`);

    const startupResult = await runRecoveryStartup('docker');

    expect({
      startupResult,
      state: fs.readFileSync(statePath, 'utf8'),
    }).toEqual({
      startupResult: expect.stringContaining(
        `Sandbox image '${TEST_IMAGE}' is missing`,
      ),
      state: '',
    });
  });

  it('removes a marked dead container from CRLF engine output', async () => {
    const owner = spawn(process.execPath, [
      '-e',
      'setInterval(() => {}, 1000)',
    ]);
    const metadata = ownerFor(owner);
    await stopChild(owner);
    const statePath = engineStatePath('docker');
    fs.writeFileSync(statePath, `${row('crlf-dead-container', metadata)}\r\n`);

    const startupResult = await runRecoveryStartup('docker');

    expect({
      startupResult,
      state: fs.readFileSync(statePath, 'utf8'),
    }).toEqual({
      startupResult: expect.stringContaining(
        `Sandbox image '${TEST_IMAGE}' is missing`,
      ),
      state: '',
    });
  });

  it('removes a reused-PID container without terminating the live process', async () => {
    const owner = spawn(process.execPath, [
      '-e',
      'setInterval(() => {}, 1000)',
    ]);
    liveChildren = [owner];
    const metadata = ownerFor(owner);
    const reusedPidMetadata: OwnerMetadata = {
      ...metadata,
      startTimeMs: metadata.startTimeMs - 10_000,
    };
    const statePath = engineStatePath('docker');
    fs.writeFileSync(
      statePath,
      `${row('reused-pid-container', reusedPidMetadata)}\n`,
    );

    // Windows cold-start of the compiled ps fixture (Defender scanning the
    // first spawn) can exceed the production 250ms readProcessStartTime
    // budget and burn the owner probe; warm the executable once with the
    // live owner pid already recorded so the probe is answered promptly.
    const prewarm = spawnSync(
      path.join(fixtureDir, process.platform === 'win32' ? 'ps.exe' : 'ps'),
      ['-o', 'lstart=', '-p', String(metadata.pid)],
      {
        encoding: 'utf8',
        env: process.env,
        timeout: FIXTURE_TIMEOUT_MS,
        windowsHide: true,
      },
    );
    if (prewarm.error !== undefined) {
      throw prewarm.error;
    }

    await runRecoveryStartup('docker');

    expect(fs.readFileSync(statePath, 'utf8')).toBe('');
    expect(() => process.kill(metadata.pid, 0)).not.toThrow();
  });

  it('retains estimated, malformed, and foreign-host owners', async () => {
    const owner = spawn(process.execPath, [
      '-e',
      'setInterval(() => {}, 1000)',
    ]);
    liveChildren = [owner];
    const observedMetadata = ownerFor(owner);
    const estimatedMetadata: OwnerMetadata = {
      ...observedMetadata,
      startTimeSource: 'estimated',
    };
    const foreignMetadata: OwnerMetadata = {
      ...observedMetadata,
      hostname: `${observedMetadata.hostname}-foreign`,
    };
    const originalState = [
      row('estimated-container', estimatedMetadata),
      row('malformed-container', '{not-json'),
      row('foreign-container', foreignMetadata),
      '',
    ].join('\n');
    const statePath = engineStatePath('docker');
    fs.writeFileSync(statePath, originalState);

    await runRecoveryStartup('docker');
    expect(fs.readFileSync(statePath, 'utf8')).toBe(originalState);
  });

  it('retains a container and continues startup when hostname lookup fails', async () => {
    const owner = spawn(process.execPath, [
      '-e',
      'setInterval(() => {}, 1000)',
    ]);
    liveChildren = [owner];
    const statePath = engineStatePath('docker');
    const originalState = `${row('hostname-unverifiable', ownerFor(owner))}\n`;
    fs.writeFileSync(statePath, originalState);
    vi.spyOn(os, 'hostname').mockImplementation(() => {
      throw new Error('hostname lookup failed');
    });

    const startupResult = await runRecoveryStartup('docker');

    expect({
      startupResult,
      state: fs.readFileSync(statePath, 'utf8'),
    }).toEqual({
      startupResult: expect.stringContaining(
        `Sandbox image '${TEST_IMAGE}' is missing`,
      ),
      state: originalState,
    });
  });

  it('applies the same dead-owner recovery through Podman', async () => {
    const owner = spawn(process.execPath, [
      '-e',
      'setInterval(() => {}, 1000)',
    ]);
    const metadata = ownerFor(owner);
    await stopChild(owner);
    const statePath = engineStatePath('podman');
    fs.writeFileSync(statePath, `${row('podman-orphan', metadata)}\n`);

    const startupResult = await runRecoveryStartup('podman');

    expect({
      startupResult,
      state: fs.readFileSync(statePath, 'utf8'),
    }).toEqual({
      startupResult: expect.stringContaining(
        `Sandbox image '${TEST_IMAGE}' is missing`,
      ),
      state: '',
    });
  });

  it('sweeps only the selected engine', async () => {
    const owner = spawn(process.execPath, [
      '-e',
      'setInterval(() => {}, 1000)',
    ]);
    const metadata = ownerFor(owner);
    await stopChild(owner);
    const dockerStatePath = engineStatePath('docker');
    const podmanStatePath = engineStatePath('podman');
    const dockerState = `${row('docker-orphan', metadata)}\n`;
    const podmanState = `${row('podman-orphan', metadata)}\n`;
    fs.writeFileSync(dockerStatePath, dockerState);
    fs.writeFileSync(podmanStatePath, podmanState);

    await runRecoveryStartup('docker');

    expect({
      docker: fs.readFileSync(dockerStatePath, 'utf8'),
      podman: fs.readFileSync(podmanStatePath, 'utf8'),
      podmanInvoked: fs
        .readFileSync(engineLogPath(), 'utf8')
        .includes('podman:'),
    }).toEqual({ docker: '', podman: podmanState, podmanInvoked: false });
  });

  it('continues startup when the selected-engine listing fails', async () => {
    process.env.LLXPRT_TEST_LIST_FAILURE = '1';
    const statePath = engineStatePath('docker');
    fs.writeFileSync(statePath, 'unread-container\tignored\n');

    const startupResult = await runRecoveryStartup('docker');

    expect({
      startupResult,
      state: fs.readFileSync(statePath, 'utf8'),
    }).toEqual({
      startupResult: expect.stringContaining(
        `Sandbox image '${TEST_IMAGE}' is missing`,
      ),
      state: 'unread-container\tignored\n',
    });
  });

  it('continues after one removal fails and still removes another orphan', async () => {
    const owner = spawn(process.execPath, [
      '-e',
      'setInterval(() => {}, 1000)',
    ]);
    const metadata = ownerFor(owner);
    await stopChild(owner);
    process.env.LLXPRT_TEST_REMOVE_FAILURE_ID = 'failed-removal';
    const statePath = engineStatePath('docker');
    const failedRow = row('failed-removal', metadata);
    fs.writeFileSync(
      statePath,
      [failedRow, row('successful-removal', metadata), ''].join('\n'),
    );

    const startupResult = await runRecoveryStartup('docker');

    expect({
      startupResult,
      state: fs.readFileSync(statePath, 'utf8'),
    }).toEqual({
      startupResult: expect.stringContaining(
        `Sandbox image '${TEST_IMAGE}' is missing`,
      ),
      state: `${failedRow}\n`,
    });
  });

  it('retains unsupported and missing owner metadata while processing other rows', async () => {
    const owner = spawn(process.execPath, [
      '-e',
      'setInterval(() => {}, 1000)',
    ]);
    const metadata = ownerFor(owner);
    await stopChild(owner);
    const unsupported = JSON.stringify({ ...metadata, version: 2 });
    const originalState = [
      row('unsupported-owner', unsupported),
      'missing-owner\t',
      '',
    ].join('\n');
    const statePath = engineStatePath('docker');
    fs.writeFileSync(statePath, originalState);

    await runRecoveryStartup('docker');

    expect(fs.readFileSync(statePath, 'utf8')).toBe(originalState);
  });

  it('bounds a hung engine listing and continues startup', async () => {
    process.env.LLXPRT_TEST_LIST_HANG = '1';
    const statePath = engineStatePath('docker');
    fs.writeFileSync(statePath, 'unread-container\tignored\n');
    const startedAt = Date.now();

    const startupResult = await runRecoveryStartup('docker');

    const elapsedMs = Date.now() - startedAt;
    expect({
      startupResult,
      state: fs.readFileSync(statePath, 'utf8'),
    }).toEqual({
      startupResult: expect.stringContaining(
        `Sandbox image '${TEST_IMAGE}' is missing`,
      ),
      state: 'unread-container\tignored\n',
    });
    expect(elapsedMs).toBeLessThan(6_500);
  }, 10_000);

  it('bounds a hung removal and continues processing other orphans', async () => {
    const owner = spawn(process.execPath, [
      '-e',
      'setInterval(() => {}, 1000)',
    ]);
    const metadata = ownerFor(owner);
    await stopChild(owner);
    process.env.LLXPRT_TEST_REMOVE_HANG_ID = 'hung-removal';
    const statePath = engineStatePath('docker');
    const hungRow = row('hung-removal', metadata);
    fs.writeFileSync(
      statePath,
      [hungRow, row('later-removal', metadata), ''].join('\n'),
    );
    const startedAt = Date.now();

    const startupResult = await runRecoveryStartup('docker');

    const elapsedMs = Date.now() - startedAt;
    expect({
      startupResult,
      state: fs.readFileSync(statePath, 'utf8'),
    }).toEqual({
      startupResult: expect.stringContaining(
        `Sandbox image '${TEST_IMAGE}' is missing`,
      ),
      state: `${hungRow}\n`,
    });
    expect(elapsedMs).toBeLessThan(6_500);
  }, 10_000);

  it('retains a live owner when the process start probe exceeds 250 ms', async () => {
    const owner = spawn(process.execPath, [
      '-e',
      'setInterval(() => {}, 1000)',
    ]);
    liveChildren = [owner];
    const metadata = ownerFor(owner);
    process.env.LLXPRT_TEST_PS_HANG = '1';
    const statePath = engineStatePath('docker');
    const originalState = `${row('unverifiable-live-owner', metadata)}\n`;
    fs.writeFileSync(statePath, originalState);
    const startedAt = Date.now();

    await runRecoveryStartup('docker');

    expect(fs.readFileSync(statePath, 'utf8')).toBe(originalState);
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  }, 15_000);

  it('retains an observed owner whose process start differs by 2,000 ms or less', async () => {
    const owner = spawn(process.execPath, [
      '-e',
      'setInterval(() => {}, 1000)',
    ]);
    liveChildren = [owner];
    const metadata = ownerFor(owner);
    const withinTolerance: OwnerMetadata = {
      ...metadata,
      startTimeMs: metadata.startTimeMs - 2_000,
    };
    const statePath = engineStatePath('docker');
    const originalState = `${row('within-tolerance', withinTolerance)}\n`;
    fs.writeFileSync(statePath, originalState);

    await runRecoveryStartup('docker');

    expect(fs.readFileSync(statePath, 'utf8')).toBe(originalState);
  });

  it('retains owner metadata with a non-positive process start time', async () => {
    const owner = spawn(process.execPath, [
      '-e',
      'setInterval(() => {}, 1000)',
    ]);
    const metadata = ownerFor(owner);
    await stopChild(owner);
    const invalidMetadata: OwnerMetadata = { ...metadata, startTimeMs: 0 };
    const statePath = engineStatePath('docker');
    const originalState = `${row('invalid-start-time', invalidMetadata)}\n`;
    fs.writeFileSync(statePath, originalState);

    await runRecoveryStartup('docker');

    expect(fs.readFileSync(statePath, 'utf8')).toBe(originalState);
  });
});
