/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-to-end demo of the real-home sentinel guard (issue #3622): spawn the
 * shared runner over the deliberately leaking fixture and assert the run
 * fails while naming that file, then a control run over the same (unarmed)
 * fixture passes.
 *
 * The spawned runner gets a FAKE real home: HOME points inside a temp dir
 * (with .llxprt and .agents/skills pre-created so the guard has watched
 * baselines). Ambient storage/XDG overrides are stripped, then config/log
 * targets are explicitly provisioned inside the fake home. Nothing here
 * touches the developer's actual directories.
 */

import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface RunnerOutcome {
  readonly exitCode: number | null;
  readonly stderr: string;
}

const KEYS_TO_STRIP = [
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'LLXPRT_CONFIG_HOME',
  'LLXPRT_DATA_HOME',
  'LLXPRT_CACHE_HOME',
  'LLXPRT_LOG_HOME',
  'LLXPRT_AGENTS_HOME',
  'LLXPRT_TEST_STORAGE_ISOLATED',
  'LLXPRT_TEST_DISABLE_OS_KEYRING',
  'LLXPRT_TEST_LEGACY_HOME',
  'LLXPRT_TEST_SESSION_ROOT',
  'LLXPRT_TEST_SENTINEL_GUARD',
  'LLXPRT_SENTINEL_DEMO',
  'LLXPRT_SENTINEL_DEMO_TARGET',
  'LLXPRT_SENTINEL_SIGNAL_READY',
  'LLXPRT_SESSION_PROBE_RECEIPT',
] as const;

function buildFakeRealEnv(fakeRealHome: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of KEYS_TO_STRIP) {
    delete env[key];
  }
  env.HOME = fakeRealHome;
  env.TMPDIR = join(fakeRealHome, 'tmp');
  mkdirSync(env.TMPDIR, { recursive: true });
  env.LLXPRT_CONFIG_HOME = join(fakeRealHome, 'platform-config');
  env.LLXPRT_LOG_HOME = join(fakeRealHome, 'platform-log');
  env.LLXPRT_TEST_SENTINEL_GUARD = '1';
  return env;
}

function runSharedRunner(
  repoRoot: string,
  env: NodeJS.ProcessEnv,
  filter = 'fixtures/sentinel-leak-fixture',
): Promise<RunnerOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        join(repoRoot, 'scripts', 'run_bun_tests.ts'),
        '--workspace',
        'scripts-tests',
        filter,
      ],
      {
        cwd: repoRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stderr = '';
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ exitCode: code, stderr }));
  });
}

describe('real-home sentinel guard end-to-end demo (issue #3622)', () => {
  it('fails the run naming the leaking file, and passes when unarmed', async () => {
    const repoRoot = join(import.meta.dir, '..', '..');
    const demoRoot = mkdtempSync(join(tmpdir(), 'llxprt-sentinel-demo-'));
    const fakeRealHome = join(demoRoot, 'real-home');
    const legacyDir = join(fakeRealHome, '.llxprt');
    try {
      mkdirSync(legacyDir, { recursive: true });
      mkdirSync(join(fakeRealHome, '.agents', 'skills'), { recursive: true });
      mkdirSync(join(fakeRealHome, 'platform-config'));
      mkdirSync(join(fakeRealHome, 'platform-log'));

      // Leaking run: arm the fixture to write into the fake ~/.llxprt.
      const leakEnv = buildFakeRealEnv(fakeRealHome);
      leakEnv.LLXPRT_SENTINEL_DEMO = '1';
      leakEnv.LLXPRT_SENTINEL_DEMO_TARGET = legacyDir;
      const leak = await runSharedRunner(repoRoot, leakEnv);
      expect(leak.exitCode).toBe(1);
      expect(leak.stderr).toContain('Real-home sentinel violation');
      expect(leak.stderr).toContain('fixtures/sentinel-leak-fixture.test.ts');
      const leakSentinels = sentinelFiles(legacyDir);

      // Control: same runner over the same file, fixture unarmed.
      const control = await runSharedRunner(
        repoRoot,
        buildFakeRealEnv(fakeRealHome),
      );
      expect(control.exitCode).toBe(0);
      expect({
        leak: leakSentinels,
        control: sentinelFiles(legacyDir),
      }).toEqual({
        leak: [],
        control: [],
      });

      const probe = await runSharedRunner(
        repoRoot,
        buildFakeRealEnv(fakeRealHome),
        'test-session-probe.test.ts',
      );
      expect(probe.exitCode).toBe(0);
      expect(probe.stderr).toContain('1 pass');
      expect(probe.stderr).not.toContain('1 skip');
      for (const directory of [
        legacyDir,
        join(fakeRealHome, '.agents', 'skills'),
        join(fakeRealHome, 'platform-config'),
        join(fakeRealHome, 'platform-log'),
      ]) {
        expect(sentinelFiles(directory)).toEqual([]);
      }
    } finally {
      rmSync(demoRoot, { recursive: true, force: true });
    }
  }, 180_000);
});

function sentinelFiles(directory: string): readonly string[] {
  return readdirSync(directory).filter((name) =>
    name.startsWith('.llxprt-sentinel-'),
  );
}

describe('every runner entrypoint forwards the session environment', () => {
  for (const workspace of ['shared', 'cli', 'core', 'agents', 'auth']) {
    it(`${workspace} passes the session probe without skipping it`, async () => {
      const repoRoot = join(import.meta.dir, '..', '..');
      const root = mkdtempSync(join(tmpdir(), 'runner-session-probe-'));
      const home = join(root, 'home');
      const receipt = join(root, 'probe-passed');
      try {
        mkdirSync(join(home, '.llxprt'), { recursive: true });
        let cwd = repoRoot;
        let command = [
          join(repoRoot, 'scripts/run_bun_tests.ts'),
          '--workspace',
          'scripts-tests',
          'test-session-probe.test.ts',
        ];
        if (workspace !== 'shared') {
          cwd = join(root, 'packages', workspace);
          mkdirSync(join(cwd, 'src'), { recursive: true });
          mkdirSync(join(cwd, 'test'));
          symlinkSync(
            join(repoRoot, 'scripts'),
            join(root, 'scripts'),
            process.platform === 'win32' ? 'junction' : 'dir',
          );
          copyFileSync(
            join(repoRoot, 'packages', workspace, 'run-bun-tests.ts'),
            join(cwd, 'run-bun-tests.ts'),
          );
          copyFileSync(
            join(repoRoot, 'scripts/tests/test-session-probe.test.ts'),
            join(cwd, 'src/probe.test.ts'),
          );
          // No storage preload can rescue a missing spawn-time environment.
          writeFileSync(join(cwd, 'bun-preload.ts'), '');
          command = [join(cwd, 'run-bun-tests.ts')];
        }
        const child = Bun.spawn([process.execPath, ...command], {
          cwd,
          env: {
            ...buildFakeRealEnv(home),
            LLXPRT_SESSION_PROBE_RECEIPT: receipt,
          },
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(code, stdout + stderr).toBe(0);
        // CLI suppresses passing Bun output, so the receipt proves the test
        // body completed its assertions rather than being discovered and skipped.
        expect(existsSync(receipt), stdout + stderr).toBe(true);
        expect(
          readFileSync(receipt, 'utf8').startsWith(
            join(home, 'tmp', 'llxprt-tests'),
          ),
        ).toBe(true);
        expect(stdout + stderr).not.toMatch(/\b[1-9]\d* skip\b/);
        expect(sentinelFiles(join(home, '.llxprt'))).toEqual([]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

describe('bespoke runner report failure cleanup', () => {
  for (const workspace of ['cli', 'core', 'agents', 'auth']) {
    it(`${workspace} removes sentinels when report writing fails`, async () => {
      const repoRoot = join(import.meta.dir, '..', '..');
      const root = mkdtempSync(join(tmpdir(), 'bespoke-report-failure-'));
      const runnerRoot = join(root, 'packages', workspace);
      const home = join(root, 'home');
      const legacy = join(home, '.llxprt');
      try {
        mkdirSync(join(runnerRoot, 'src'), { recursive: true });
        mkdirSync(join(runnerRoot, 'test'));
        mkdirSync(join(runnerRoot, 'junit.xml'));
        mkdirSync(legacy, { recursive: true });
        symlinkSync(
          join(repoRoot, 'scripts'),
          join(root, 'scripts'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
        copyFileSync(
          join(repoRoot, 'packages', workspace, 'run-bun-tests.ts'),
          join(runnerRoot, 'run-bun-tests.ts'),
        );
        writeFileSync(join(runnerRoot, 'bun-preload.ts'), '');
        writeFileSync(
          join(runnerRoot, 'src', 'probe.test.ts'),
          `import { test, expect } from 'bun:test';
import { readdirSync } from 'node:fs';
test('guard was armed', () => expect(readdirSync(process.env.LLXPRT_SENTINEL_DEMO_TARGET).some(name => name.startsWith('.llxprt-sentinel-'))).toBe(true));`,
        );
        const child = Bun.spawn(
          [process.execPath, join(runnerRoot, 'run-bun-tests.ts')],
          {
            cwd: runnerRoot,
            env: {
              ...buildFakeRealEnv(home),
              LLXPRT_SENTINEL_DEMO_TARGET: legacy,
            },
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(code).toBe(1);
        expect(stdout).toContain('Passed 1/1');
        expect(stderr).toContain('junit.xml');
        expect(sentinelFiles(legacy)).toEqual([]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

async function waitUntil(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!check()) {
    if (Date.now() >= deadline)
      throw new Error('Timed out waiting for signal fixture');
    await Bun.sleep(25);
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
      return false;
    throw error;
  }
}

function killProcessGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
      return;
    }
    throw error;
  }
}

describe('runner SIGTERM cleanup', () => {
  for (const workspace of ['shared', 'cli', 'core', 'agents', 'auth']) {
    it.skipIf(process.platform === 'win32')(
      `${workspace} reaps the test tree and removes sentinels on SIGTERM`,
      async () => {
        const repoRoot = join(import.meta.dir, '..', '..');
        const root = mkdtempSync(join(tmpdir(), 'runner-signal-'));
        const home = join(root, 'home');
        const watched = [
          '.llxprt',
          '.agents/skills',
          'platform-config',
          'platform-log',
        ].map((path) => join(home, path));
        const ready = join(root, 'ready');
        const fixture = join(
          repoRoot,
          'scripts/tests/fixtures/sentinel-leak-fixture.test.ts',
        );
        let runnerRoot = repoRoot;
        let command = [
          join(repoRoot, 'scripts/run_bun_tests.ts'),
          '--workspace',
          'scripts-tests',
          'fixtures/sentinel-leak-fixture',
        ];
        for (const path of watched) mkdirSync(path, { recursive: true });
        if (workspace !== 'shared') {
          runnerRoot = join(root, 'packages', workspace);
          mkdirSync(join(runnerRoot, 'src'), { recursive: true });
          mkdirSync(join(runnerRoot, 'test'));
          symlinkSync(
            join(repoRoot, 'scripts'),
            join(root, 'scripts'),
            process.platform === 'win32' ? 'junction' : 'dir',
          );
          copyFileSync(
            join(repoRoot, 'packages', workspace, 'run-bun-tests.ts'),
            join(runnerRoot, 'run-bun-tests.ts'),
          );
          copyFileSync(fixture, join(runnerRoot, 'src/probe.test.ts'));
          writeFileSync(join(runnerRoot, 'bun-preload.ts'), '');
          command = [join(runnerRoot, 'run-bun-tests.ts')];
        }
        const child = spawn(process.execPath, command, {
          cwd: runnerRoot,
          env: {
            ...buildFakeRealEnv(home),
            LLXPRT_SENTINEL_SIGNAL_READY: ready,
          },
          detached: process.platform !== 'win32',
          stdio: 'ignore',
        });
        const closed = new Promise<number | null>((resolve, reject) => {
          child.once('close', resolve);
          child.once('error', reject);
        });
        let descendant: number | undefined;
        try {
          await waitUntil(() => existsSync(ready));
          descendant = Number(readFileSync(ready, 'utf8'));
          expect(
            watched.every((path) => sentinelFiles(path).length === 1),
          ).toBe(true);
          child.kill('SIGTERM');
          await waitUntil(
            () => child.exitCode !== null || child.signalCode !== null,
          );
          expect(await closed).toBe(143);
          for (const path of watched) expect(sentinelFiles(path)).toEqual([]);
          await waitUntil(
            () => descendant !== undefined && !processExists(descendant),
          );
        } finally {
          killProcessGroup(child.pid);
          if (descendant !== undefined && processExists(descendant))
            process.kill(descendant, 'SIGKILL');
          await closed;
          rmSync(root, { recursive: true, force: true });
        }
      },
      20_000,
    );
  }
});
