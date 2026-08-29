/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the memprofile launcher (scripts/memory/launcher.ts):
 * fail-fast option parsing with the `--` passthrough boundary, the explicit
 * LLXPRT_MEM_SNAPSHOT disarming of inherited environments, atomic `latest`
 * pointer publishing, and env construction.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type LauncherOptions,
  LauncherParseError,
  buildLauncherEnv,
  parseLauncherArgs,
  publishLatestPointer,
  selectLauncherSignalPolicy,
} from '../../memory/launcher.ts';
import {
  DEFAULT_MAX_SNAPSHOT_HEAP_MB,
  MAX_INTERVAL_MS,
  MAX_SNAPSHOT_HEAP_MB_LIMIT,
} from '../../memory/probe.ts';
import { devLocalStorageFile } from '../../lib/node-options.ts';
import { spawnSyncWithFileCapture } from './sync-process.ts';
describe('launcher signal policy', () => {
  it('suppresses duplicate console SIGINT in a marked Windows supervisor', () => {
    expect(selectLauncherSignalPolicy('win32', true)).toEqual({
      forwardedSignals: ['SIGTERM', 'SIGHUP'],
      ignoredSignals: ['SIGINT'],
      stopOnSuspend: false,
    });
  });

  it('retains legacy forwarding in an unmarked source supervisor', () => {
    expect(selectLauncherSignalPolicy('win32', false)).toEqual({
      forwardedSignals: ['SIGINT', 'SIGTERM', 'SIGHUP'],
      ignoredSignals: [],
      stopOnSuspend: false,
    });
  });

  it('uses the isolated terminal signal bridge for a marked POSIX supervisor', () => {
    expect(selectLauncherSignalPolicy('darwin', true)).toEqual({
      forwardedSignals: [
        'SIGINT',
        'SIGTERM',
        'SIGHUP',
        'SIGQUIT',
        'SIGTSTP',
        'SIGCONT',
        'SIGWINCH',
      ],
      ignoredSignals: [],
      stopOnSuspend: true,
    });
  });
});

describe('parseLauncherArgs — defaults and recognized options', () => {
  it('applies documented defaults for an empty argv', () => {
    const options = parseLauncherArgs([], '/default/run');
    expect(options.snapshots).toBe(false);
    expect(options.intervalMs).toBe(15_000);
    expect(options.maxHeapMb).toBe(DEFAULT_MAX_SNAPSHOT_HEAP_MB);
    expect(options.runDir).toBe(resolve('/default/run'));
    expect(options.passthrough).toEqual([]);
    expect(options.help).toBe(false);
  });

  it('parses every recognized option', () => {
    const options = parseLauncherArgs(
      [
        '--snapshots',
        '--interval',
        '5000',
        '--max-heap-mb',
        '128',
        '--dir',
        '/r',
      ],
      '/default/run',
    );
    expect(options.snapshots).toBe(true);
    expect(options.intervalMs).toBe(5000);
    expect(options.maxHeapMb).toBe(128);
    expect(options.runDir).toBe(resolve('/r'));
  });

  it('accepts both -h and --help', () => {
    expect(parseLauncherArgs(['-h'], '/d').help).toBe(true);
    expect(parseLauncherArgs(['--help'], '/d').help).toBe(true);
  });
});

describe('parseLauncherArgs — -- passthrough boundary', () => {
  it('passes everything after -- to LLxprt untouched', () => {
    const options = parseLauncherArgs(
      [
        '--snapshots',
        '--',
        '--profile-load',
        'ollama',
        '--weird',
        'positional',
      ],
      '/d',
    );
    expect(options.snapshots).toBe(true);
    expect(options.passthrough).toEqual([
      '--profile-load',
      'ollama',
      '--weird',
      'positional',
    ]);
  });

  it('passes a lone -- through as empty passthrough', () => {
    const options = parseLauncherArgs(['--'], '/d');
    expect(options.passthrough).toEqual([]);
  });

  it('fails fast on an unknown option before --', () => {
    expect(() => parseLauncherArgs(['--unknown'], '/d')).toThrow(
      LauncherParseError,
    );
    expect(() => parseLauncherArgs(['--unknown'], '/d')).toThrow(
      /unknown option: --unknown/,
    );
  });

  it('fails fast on an unknown LLxprt-style option before --', () => {
    // The whole point of the boundary: forgetting -- must fail loudly instead
    // of silently forwarding a launcher-consumed flag to LLxprt.
    expect(() => parseLauncherArgs(['--profile-load', 'x'], '/d')).toThrow(
      /unknown option/,
    );
  });
});

describe('parseLauncherArgs — invalid values fail fast', () => {
  it('rejects a missing value for --interval', () => {
    expect(() => parseLauncherArgs(['--interval'], '/d')).toThrow(
      /missing value for --interval/,
    );
  });

  it('rejects a flag-shaped value for --interval', () => {
    expect(() =>
      parseLauncherArgs(['--interval', '--snapshots'], '/d'),
    ).toThrow(/invalid value for --interval/);
  });

  it('rejects a negative interval', () => {
    expect(() => parseLauncherArgs(['--interval', '-5'], '/d')).toThrow(
      /invalid value for --interval/,
    );
  });

  it('rejects a zero interval', () => {
    expect(() => parseLauncherArgs(['--interval', '0'], '/d')).toThrow(
      /invalid value for --interval/,
    );
  });

  it('rejects a non-integer interval', () => {
    expect(() => parseLauncherArgs(['--interval', '1.5'], '/d')).toThrow(
      /invalid value for --interval/,
    );
  });

  it('rejects a nonfinite interval', () => {
    expect(() => parseLauncherArgs(['--interval', 'Infinity'], '/d')).toThrow(
      /invalid value for --interval/,
    );
    expect(() => parseLauncherArgs(['--interval', 'NaN'], '/d')).toThrow(
      /invalid value for --interval/,
    );
  });

  it('rejects a non-numeric max-heap', () => {
    expect(() => parseLauncherArgs(['--max-heap-mb', 'big'], '/d')).toThrow(
      /invalid value for --max-heap-mb/,
    );
  });

  it('rejects a missing value for --dir', () => {
    expect(() => parseLauncherArgs(['--dir'], '/d')).toThrow(
      /missing value for --dir/,
    );
  });

  it('rejects a flag-shaped value for --dir', () => {
    expect(() => parseLauncherArgs(['--dir', '--snapshots'], '/d')).toThrow(
      /invalid value for --dir/,
    );
  });

  it('rejects an interval above the upper bound', () => {
    expect(() =>
      parseLauncherArgs(['--interval', String(MAX_INTERVAL_MS + 1)], '/d'),
    ).toThrow(/--interval/);
  });

  it('rejects a heap guard above the upper bound', () => {
    expect(() =>
      parseLauncherArgs(
        ['--max-heap-mb', String(MAX_SNAPSHOT_HEAP_MB_LIMIT + 1)],
        '/d',
      ),
    ).toThrow(/--max-heap-mb/);
  });

  it('accepts values exactly at the bounds', () => {
    expect(
      parseLauncherArgs(['--interval', String(MAX_INTERVAL_MS)], '/d')
        .intervalMs,
    ).toBe(MAX_INTERVAL_MS);
    expect(
      parseLauncherArgs(
        ['--max-heap-mb', String(MAX_SNAPSHOT_HEAP_MB_LIMIT)],
        '/d',
      ).maxHeapMb,
    ).toBe(MAX_SNAPSHOT_HEAP_MB_LIMIT);
  });

  it('points a forgotten boundary at the -- separator in the error hint', () => {
    try {
      parseLauncherArgs(['--profile-load', 'x'], '/d');
      throw new Error('unreachable');
    } catch (error) {
      expect(error).toBeInstanceOf(LauncherParseError);
      expect((error as LauncherParseError).message).toContain('after --');
    }
  });
});

describe('buildLauncherEnv — exactly one launcher-owned --localstorage-file', () => {
  const options: LauncherOptions = {
    snapshots: false,
    intervalMs: 15_000,
    maxHeapMb: 256,
    runDir: '/run',
    help: false,
    passthrough: [],
  };

  const occurrences = (env: NodeJS.ProcessEnv): number =>
    (env['NODE_OPTIONS'] ?? '').split('--localstorage-file=').length - 1;

  it('adds exactly one value when NODE_OPTIONS is empty or absent', () => {
    expect(occurrences(buildLauncherEnv({}, options, '1.0.0'))).toBe(1);
    expect(
      occurrences(buildLauncherEnv({ NODE_OPTIONS: '' }, options, '1.0.0')),
    ).toBe(1);
  });

  it('strips inherited --localstorage-file variants before adding its own', () => {
    const inherited = [
      '--localstorage-file=/tmp/old-a',
      '--localstorage-file=/tmp/old-b',
    ].join(' ');
    const env = buildLauncherEnv({ NODE_OPTIONS: inherited }, options, '1.0.0');
    expect(occurrences(env)).toBe(1);
    expect(env['NODE_OPTIONS']).toContain(
      `--localstorage-file=${devLocalStorageFile()}`,
    );
    expect(env['NODE_OPTIONS']).not.toContain('/tmp/old-a');
    expect(env['NODE_OPTIONS']).not.toContain('/tmp/old-b');
  });

  it('strips space-separated and =-attached inherited forms', () => {
    const inherited =
      '--localstorage-file /tmp/space-form --other-flag --localstorage-file=/tmp/eq-form';
    const env = buildLauncherEnv({ NODE_OPTIONS: inherited }, options, '1.0.0');
    expect(occurrences(env)).toBe(1);
    expect(env['NODE_OPTIONS']).not.toContain('/tmp/space-form');
    expect(env['NODE_OPTIONS']).not.toContain('/tmp/eq-form');
    expect(env['NODE_OPTIONS']).toContain('--other-flag');
  });

  it('preserves unrelated inherited NODE_OPTIONS content', () => {
    const env = buildLauncherEnv(
      { NODE_OPTIONS: '--experimental-wasm-interface-types' },
      options,
      '1.0.0',
    );
    expect(env['NODE_OPTIONS']).toContain(
      '--experimental-wasm-interface-types',
    );
    expect(occurrences(env)).toBe(1);
  });
});

describe('buildLauncherEnv — snapshot arming is immune to inheritance', () => {
  const baseOptions = (snapshots: boolean): LauncherOptions => ({
    snapshots,
    intervalMs: 15_000,
    maxHeapMb: 256,
    runDir: '/run',
    help: false,
    passthrough: [],
  });

  it('sets LLXPRT_MEM_SNAPSHOT=1 when armed', () => {
    const env = buildLauncherEnv({}, baseOptions(true), '1.0.0');
    expect(env['LLXPRT_MEM_SNAPSHOT']).toBe('1');
  });

  it('explicitly sets LLXPRT_MEM_SNAPSHOT=0 when unarmed, overriding an inherited 1', () => {
    // A parent that exported LLXPRT_MEM_SNAPSHOT=1 must not silently arm
    // snapshots in a child launched without --snapshots.
    const env = buildLauncherEnv(
      { LLXPRT_MEM_SNAPSHOT: '1' },
      baseOptions(false),
      '1.0.0',
    );
    expect(env['LLXPRT_MEM_SNAPSHOT']).toBe('0');
  });

  it('propagates run dir, interval, and guard', () => {
    const env = buildLauncherEnv({}, baseOptions(false), '1.0.0');
    expect(env['LLXPRT_MEM_DIR']).toBe('/run');
    expect(env['LLXPRT_MEM_INTERVAL_MS']).toBe('15000');
    expect(env['LLXPRT_MEM_MAX_HEAP_MB']).toBe('256');
    expect(env['DEV']).toBe('true');
    expect(env['CLI_VERSION']).toBe('1.0.0');
  });
});

describe('publishLatestPointer — atomic same-directory publish', () => {
  it('publishes the pointer and leaves no temp file behind', () => {
    const root = mkdtempSync(join(tmpdir(), 'memprofile-pub-'));
    try {
      publishLatestPointer(root, '/runs/run-a');
      expect(readFileSync(join(root, 'latest'), 'utf8')).toBe('/runs/run-a');
      const leftovers = readdirSync(root).filter((n) => n.endsWith('.tmp'));
      expect(leftovers).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('overwrites a previous pointer atomically', () => {
    const root = mkdtempSync(join(tmpdir(), 'memprofile-pub2-'));
    try {
      publishLatestPointer(root, '/runs/run-a');
      publishLatestPointer(root, '/runs/run-b');
      expect(readFileSync(join(root, 'latest'), 'utf8')).toBe('/runs/run-b');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

interface InstalledLauncherFixture {
  readonly root: string;
  readonly bundleDir: string;
  readonly launcher: string;
  readonly callerDir: string;
  readonly dataRoot: string;
}

interface InstalledChildOutput {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly version: string | null;
  readonly dev: string | null;
  readonly nodeOptions: string | null;
  readonly preloaded: string | null;
  readonly snapshots: string | null;
  readonly signalBridge: string | null;
  readonly fdInode: string | null;
  readonly supervisorClosedFd: boolean | null;
}

const testFile = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(testFile, '..', '..', '..', '..');
const installedLauncherSource = join(
  repositoryRoot,
  'scripts',
  'memory',
  'installed-launcher.ts',
);

function cleanInstalledEnv(
  additions: Readonly<Record<string, string>>,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries({ ...process.env, ...additions }).filter(
      ([name]) => name !== 'DEV' && name !== 'NODE_OPTIONS',
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseInstalledChildOutput(stdout: string): InstalledChildOutput {
  const prefix = 'LLXPRT_INSTALLED_LAUNCHER_TEST=';
  const line = stdout
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(prefix));
  if (line === undefined) {
    throw new Error(`Installed child output was missing from:\n${stdout}`);
  }
  const parsed: unknown = JSON.parse(line.slice(prefix.length));
  if (!isRecord(parsed)) {
    throw new Error('Installed child output was not an object');
  }
  const argv = parsed['argv'];
  if (
    !Array.isArray(argv) ||
    !argv.every((value) => typeof value === 'string') ||
    typeof parsed['cwd'] !== 'string'
  ) {
    throw new Error('Installed child output had an invalid shape');
  }
  const nullableString = (value: unknown): string | null => {
    if (value === null || typeof value === 'string') {
      return value;
    }
    throw new Error('Installed child output had an invalid string field');
  };
  const nullableBoolean = (value: unknown): boolean | null => {
    if (value === null || typeof value === 'boolean') {
      return value;
    }
    throw new Error('Installed child output had an invalid boolean field');
  };
  return {
    argv,
    cwd: parsed['cwd'],
    version: nullableString(parsed['version']),
    dev: nullableString(parsed['dev']),
    nodeOptions: nullableString(parsed['nodeOptions']),
    preloaded: nullableString(parsed['preloaded']),
    snapshots: nullableString(parsed['snapshots']),
    signalBridge: nullableString(parsed['signalBridge']),
    fdInode: nullableString(parsed['fdInode']),
    supervisorClosedFd: nullableBoolean(parsed['supervisorClosedFd']),
  };
}

function quoteForBash(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${path}`);
    }
    await Bun.sleep(20);
  }
}
async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill('SIGCONT');
  child.kill('SIGKILL');
  await Promise.race([once(child, 'exit'), Bun.sleep(1_000)]);
}

function killAfter(
  child: ChildProcess,
  timeoutMs = 10_000,
): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    child.kill('SIGCONT');
    child.kill('SIGKILL');
  }, timeoutMs);
}

describe('installed memprofile launcher runtime', () => {
  let fixture: InstalledLauncherFixture | undefined;

  beforeAll(async () => {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), 'memprofile-installed-launcher-')),
    );
    try {
      const bundleDir = join(root, 'bundle');
      const callerDir = join(root, 'caller');
      const dataRoot = join(root, 'user-data');
      mkdirSync(bundleDir, { recursive: true });
      mkdirSync(callerDir, { recursive: true });
      const build = await Bun.build({
        entrypoints: [installedLauncherSource],
        outdir: bundleDir,
        naming: 'memprofile-launcher.js',
        target: 'bun',
        define: { 'process.env.CLI_VERSION': JSON.stringify('9.9.9-test') },
      });
      if (!build.success) {
        throw new Error(build.logs.map((log) => log.message).join('\n'));
      }
      writeFileSync(
        join(bundleDir, 'memprofile-preload.js'),
        `process.env.LLXPRT_TEST_PRELOADED = 'yes';\n`,
      );
      writeFileSync(
        join(bundleDir, 'llxprt.js'),
        [
          `import { appendFileSync, closeSync, constants, fstatSync, openSync, writeFileSync } from 'node:fs';`,
          `const jobControlFile = process.env.LLXPRT_TEST_JOB_CONTROL_FILE;`,
          `const signalFile = process.env.LLXPRT_TEST_SIGNAL_FILE;`,
          `if (jobControlFile !== undefined) {`,
          `  process.on('SIGTSTP', () => writeFileSync(jobControlFile, 'SIGTSTP\\n'));`,
          `  process.on('SIGCONT', () => { appendFileSync(jobControlFile, 'SIGCONT\\n'); process.exit(77); });`,
          `  writeFileSync(jobControlFile + '.ready', String(process.pid));`,
          `  setTimeout(() => process.exit(124), 12000).unref();`,
          `  setInterval(() => {}, 1000);`,
          `} else if (signalFile !== undefined) {`,
          `  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT', 'SIGWINCH']) {`,
          `    process.on(signal, () => {`,
          `      writeFileSync(signalFile, signal);`,
          `      process.exit(77);`,
          `    });`,
          `  }`,
          `  writeFileSync(signalFile + '.ready', String(process.pid));`,
          `  setTimeout(() => process.exit(124), 12000).unref();`,
          `  setInterval(() => {}, 1000);`,
          `} else {`,
          `  let fdInode = null;`,
          `  let supervisorClosedFd = null;`,
          `  const fifo = process.env.LLXPRT_TEST_CAPABILITY_FIFO;`,
          `  if (process.env.LLXPRT_CAPABILITY_FD === '3' && fifo !== undefined) {`,
          `    fdInode = String(fstatSync(3).ino);`,
          `    closeSync(3);`,
          `    const deadline = Date.now() + 5000;`,
          `    while (Date.now() < deadline) {`,
          `      try {`,
          `        const writer = openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK);`,
          `        closeSync(writer);`,
          `        await Bun.sleep(10);`,
          `      } catch (error) {`,
          `        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENXIO') {`,
          `          supervisorClosedFd = true;`,
          `          break;`,
          `        }`,
          `        throw error;`,
          `      }`,
          `    }`,
          `    supervisorClosedFd ??= false;`,
          `  }`,
          `  const output = {`,
          `    argv: process.argv.slice(2),`,
          `    cwd: process.cwd(),`,
          `    version: process.env.CLI_VERSION ?? null,`,
          `    dev: process.env.DEV ?? null,`,
          `    nodeOptions: process.env.NODE_OPTIONS ?? null,`,
          `    preloaded: process.env.LLXPRT_TEST_PRELOADED ?? null,`,
          `    snapshots: process.env.LLXPRT_MEM_SNAPSHOT ?? null,`,
          `    signalBridge: process.env.LLXPRT_INTERNAL_MEMPROFILE_SIGNAL_BRIDGE ?? null,`,
          `    fdInode,`,
          `    supervisorClosedFd,`,
          `  };`,
          `  console.log('LLXPRT_INSTALLED_LAUNCHER_TEST=' + JSON.stringify(output));`,
          `}`,
        ].join('\n'),
      );
      fixture = {
        root,
        bundleDir,
        launcher: join(bundleDir, 'memprofile-launcher.js'),
        callerDir,
        dataRoot,
      };
    } catch (error) {
      rmSync(root, { recursive: true, force: true });
      throw error;
    }
  });

  afterAll(() => {
    if (fixture !== undefined) {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  function getFixture(): InstalledLauncherFixture {
    if (fixture === undefined) {
      throw new Error('Installed launcher fixture was not initialized');
    }
    return fixture;
  }

  it('uses sibling entries, caller cwd, installed data root, and production environment behavior', () => {
    const current = getFixture();
    const result = spawnSyncWithFileCapture(
      current.root,
      process.execPath,
      [current.launcher, '--', '--', '--profile-load', 'installed-profile'],
      {
        cwd: current.callerDir,
        env: cleanInstalledEnv({
          LLXPRT_DATA_HOME: current.dataRoot,
          LLXPRT_INTERNAL_MEMPROFILE_SIGNAL_BRIDGE: '1',
          LLXPRT_MEM_SNAPSHOT: '1',
        }),
      },
    );

    expect(result.status, result.stderr).toBe(0);
    const output = parseInstalledChildOutput(result.stdout);
    expect(output.argv).toEqual(['--profile-load', 'installed-profile']);
    expect(output.cwd).toBe(current.callerDir);
    expect(output.version).toBe('9.9.9-test');
    expect(output.dev).toBeNull();
    expect(output.nodeOptions).toBeNull();
    expect(output.preloaded).toBe('yes');
    expect(output.snapshots).toBe('0');
    expect(output.signalBridge).toBeNull();
    const installedRoot = join(current.dataRoot, 'memprofile');
    const latest = readFileSync(join(installedRoot, 'latest'), 'utf8');
    expect(latest.startsWith(installedRoot + sep)).toBe(true);
  });

  it('uses installed command labels while the source launcher keeps npm usage', () => {
    const current = getFixture();
    const installed = spawnSyncWithFileCapture(
      current.root,
      process.execPath,
      [current.launcher, '--help'],
      {
        cwd: current.callerDir,
        env: cleanInstalledEnv({ LLXPRT_DATA_HOME: current.dataRoot }),
      },
    );
    const source = spawnSyncWithFileCapture(
      current.root,
      process.execPath,
      [join(repositoryRoot, 'scripts/memory/launcher.ts'), '--help'],
      { cwd: repositoryRoot },
    );

    expect(installed.status, installed.stderr).toBe(0);
    expect(installed.stdout).toContain('Usage: llxprt --memprofile');
    expect(installed.stdout).toContain('llxprt memprofile request');
    expect(source.status, source.stderr).toBe(0);
    expect(source.stdout).toContain('Usage: npm run mem:profile --');
    expect(source.stdout).toContain('npm run mem:request');
  });

  it.skipIf(process.platform === 'win32')(
    'forwards fd 3 and closes the supervisor copy after the CLI inherits it',
    () => {
      const current = getFixture();
      const fifo = join(current.root, 'capability.fifo');
      const mkfifo = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
      expect(mkfifo.status, mkfifo.stderr).toBe(0);
      const runDir = join(current.root, 'fd3-run');
      const command =
        `exec 3<>${quoteForBash(fifo)}\n` +
        `LLXPRT_CAPABILITY_FD=3 exec ${quoteForBash(process.execPath)} ` +
        `${quoteForBash(current.launcher)} --dir ${quoteForBash(runDir)} --`;
      const result = spawnSyncWithFileCapture(
        current.root,
        'bash',
        ['--noprofile', '--norc', '-c', command],
        {
          cwd: current.callerDir,
          env: cleanInstalledEnv({
            LLXPRT_DATA_HOME: current.dataRoot,
            LLXPRT_TEST_CAPABILITY_FIFO: fifo,
          }),
        },
      );

      expect(result.status, result.stderr).toBe(0);
      const output = parseInstalledChildOutput(result.stdout);
      expect(output.fdInode).toBe(String(statSync(fifo).ino));
      expect(output.supervisorClosedFd).toBe(true);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'forwards SIGINT, SIGTERM, and SIGHUP targeted at the supervisor',
    async () => {
      const current = getFixture();
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
        const signalFile = join(current.root, `received-${signal}`);
        const runDir = join(current.root, `signal-run-${signal}`);
        const supervisor = spawn(
          process.execPath,
          [current.launcher, '--dir', runDir, '--'],
          {
            cwd: current.callerDir,
            stdio: 'ignore',
            env: cleanInstalledEnv({
              LLXPRT_DATA_HOME: current.dataRoot,
              LLXPRT_TEST_SIGNAL_FILE: signalFile,
            }),
          },
        );
        const safety = killAfter(supervisor);
        try {
          await waitForFile(`${signalFile}.ready`);
          supervisor.kill(signal);
          const [code] = await once(supervisor, 'exit');
          expect(code).toBe(77);
          expect(readFileSync(signalFile, 'utf8')).toBe(signal);
        } finally {
          clearTimeout(safety);
          await terminateChild(supervisor);
        }
      }
    },
    15_000,
  );

  it.skipIf(process.platform === 'win32')(
    'bridges terminal resize and quit signals from an isolated outer shim',
    async () => {
      const current = getFixture();
      for (const signal of ['SIGWINCH', 'SIGQUIT'] as const) {
        const signalFile = join(current.root, `received-bridged-${signal}`);
        const runDir = join(current.root, `signal-bridged-${signal}`);
        const supervisor = spawn(
          process.execPath,
          [current.launcher, '--dir', runDir, '--'],
          {
            cwd: current.callerDir,
            stdio: 'ignore',
            env: cleanInstalledEnv({
              LLXPRT_DATA_HOME: current.dataRoot,
              LLXPRT_INTERNAL_MEMPROFILE_SIGNAL_BRIDGE: '1',
              LLXPRT_TEST_SIGNAL_FILE: signalFile,
            }),
          },
        );
        const safety = killAfter(supervisor);
        try {
          await waitForFile(`${signalFile}.ready`);
          supervisor.kill(signal);
          const [code] = await once(supervisor, 'exit');
          expect(code).toBe(77);
          expect(readFileSync(signalFile, 'utf8')).toBe(signal);
        } finally {
          clearTimeout(safety);
          await terminateChild(supervisor);
        }
      }
    },
    15_000,
  );

  it.skipIf(process.platform === 'win32')(
    'suspends and resumes the isolated launcher and profiled application together',
    async () => {
      const current = getFixture();
      const jobControlFile = join(current.root, 'job-control-signals');
      const runDir = join(current.root, 'job-control-run');
      const supervisor = spawn(
        process.execPath,
        [current.launcher, '--dir', runDir, '--'],
        {
          cwd: current.callerDir,
          stdio: 'ignore',
          env: cleanInstalledEnv({
            LLXPRT_DATA_HOME: current.dataRoot,
            LLXPRT_INTERNAL_MEMPROFILE_SIGNAL_BRIDGE: '1',
            LLXPRT_TEST_JOB_CONTROL_FILE: jobControlFile,
          }),
        },
      );
      const safety = killAfter(supervisor);
      try {
        await waitForFile(`${jobControlFile}.ready`);
        supervisor.kill('SIGTSTP');
        await waitForFile(jobControlFile);
        supervisor.kill('SIGCONT');
        const [code] = await once(supervisor, 'exit');
        expect(code).toBe(77);
        expect(readFileSync(jobControlFile, 'utf8')).toBe('SIGTSTP\nSIGCONT\n');
      } finally {
        clearTimeout(safety);
        await terminateChild(supervisor);
      }
    },
    15_000,
  );

  it.skipIf(process.platform === 'win32')(
    'forwards a signal received while child pid publication is blocked',
    async () => {
      const current = getFixture();
      const signalFile = join(current.root, 'received-startup-SIGINT');
      const runDir = join(current.root, 'signal-startup-window');
      mkdirSync(runDir, { recursive: true });
      const pidFifo = join(runDir, 'pid');
      const mkfifo = spawnSync('mkfifo', [pidFifo], { encoding: 'utf8' });
      expect(mkfifo.status, mkfifo.stderr).toBe(0);

      const supervisor = spawn(
        process.execPath,
        [current.launcher, '--dir', runDir, '--'],
        {
          cwd: current.callerDir,
          stdio: 'ignore',
          env: cleanInstalledEnv({
            LLXPRT_DATA_HOME: current.dataRoot,
            LLXPRT_TEST_SIGNAL_FILE: signalFile,
          }),
        },
      );
      const safety = killAfter(supervisor);
      let fifoReader: ChildProcess | undefined;
      let childPid: number | undefined;
      try {
        await waitForFile(`${signalFile}.ready`);
        childPid = Number(readFileSync(`${signalFile}.ready`, 'utf8'));
        const exited = once(supervisor, 'exit');
        supervisor.kill('SIGINT');
        fifoReader = spawn('cat', [pidFifo], { stdio: 'ignore' });
        const [code] = await exited;

        expect(code).toBe(77);
        expect(readFileSync(signalFile, 'utf8')).toBe('SIGINT');
      } finally {
        clearTimeout(safety);
        if (fifoReader !== undefined) {
          await terminateChild(fifoReader);
        }
        await terminateChild(supervisor);
        if (childPid !== undefined) {
          try {
            process.kill(childPid, 'SIGTERM');
          } catch {
            // The correctly supervised child has already exited.
          }
        }
      }
    },
    15_000,
  );
});
