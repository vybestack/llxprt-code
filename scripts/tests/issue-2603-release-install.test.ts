/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  chmodSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { afterEach } from 'bun:test';
import {
  assertReleaseGraph,
  installReleaseArtifacts,
  packReleaseArtifacts,
  prepareNodeOnlyRuntime,
  readReleaseManifest,
  verifyInstalledGraph,
} from './release-bound-artifact-helpers.ts';
import {
  deriveNpmReleasePackages,
  getWorkspaceInfo,
  rewriteDeps,
} from '../bind-release-deps.ts';

// Track smoke handles that need disposal after each test. Under Vitest,
// ctx.onTestFinished provides per-test cleanup; Bun does not pass a test
// context to callbacks, so we use afterEach as a cross-runner fallback.
const pendingDisposals: Array<() => void> = [];

afterEach(() => {
  for (const dispose of pendingDisposals.splice(0)) {
    try {
      dispose();
    } catch {
      // best effort cleanup
    }
  }
});

const {
  npmInvocation,
}: {
  npmInvocation: (
    args: readonly string[],
    options: { execPath: string },
  ) => { command: string; args: string[] };
} = createRequire(import.meta.url)('../lib/npm-command.cjs');

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(thisFile, '..', '..', '..');
const smokeScript = join(
  repoRoot,
  'scripts',
  'tests',
  'issue-2603-release-install-smoke.cjs',
);
const releasePackHelper = join(
  repoRoot,
  'scripts',
  'tests',
  'issue-2603-release-pack.cjs',
);

/**
 * Spawns the standalone smoke script through a detached Node wrapper with a
 * hard timeout. The wrapper opens ordinary files for output before it starts
 * the nested npm/Bun process tree. This avoids Bun forwarding a high-numbered
 * test-runner pipe descriptor that macOS posix_spawn cannot reliably capture.
 *
 * Using async `spawn` keeps the event loop responsive to test-runner RPC. The
 * detached process group lets dispose() reap npm, tar, and Bun grandchildren
 * through kill(-pid) on POSIX or taskkill /T on Windows. All listeners and the
 * capture directory are scoped to the returned handle. No process-global
 * signal or exit listeners are registered.
 */
/**
 * Env-overridable timeout constants with a comfortable margin. The smoke
 * timeout must be strictly less than the test timeout so the kill+dispose
 * completes before the test timeout fires.
 *
 * The defaults track the outer pack-phase budget: the pack phase runs BEFORE the
 * npm steps and is not covered by the smoke's 690s global deadline, and the
 * inner bind-release-deps spawn now allows one ETIMEDOUT retry at 600s per
 * attempt. The 2_100s smoke kill (2_160s test timeout) leaves room for
 * the enlarged pack phase plus the later 690s npm/deadline-bounded steps.
 *
 * Override via env for per-CI tuning:
 *   LLXPRT_SMOKE_TIMEOUT_MS — the hard kill timer for the smoke child.
 *   LLXPRT_SMOKE_TEST_TIMEOUT_MS — the Vitest test timeout (must exceed the
 *     smoke timeout by a safe margin).
 */
const SMOKE_TIMEOUT_MS =
  Number(process.env.LLXPRT_SMOKE_TIMEOUT_MS) || 2_100_000;
const SMOKE_TEST_TIMEOUT_MS =
  Number(process.env.LLXPRT_SMOKE_TEST_TIMEOUT_MS) || 2_160_000;

interface SmokeHandle {
  promise: Promise<{
    status: number | null;
    stdout: string;
    stderr: string;
  }>;
  /** Kill the child if still alive and clear all timers/listeners. Idempotent. */
  dispose: () => void;
}

const captureSmokeOutput = [
  'const { closeSync, openSync, writeSync } = require("node:fs");',
  'const { spawn } = require("node:child_process");',
  'const [stdoutPath, stderrPath, script, root] = process.argv.slice(1);',
  'const stdoutFd = openSync(stdoutPath, "w");',
  'const stderrFd = openSync(stderrPath, "w");',
  'let settled = false;',
  'const finish = (status, error) => {',
  '  if (settled) return;',
  '  settled = true;',
  '  if (error) writeSync(stderrFd, `${error.stack || error}\\n`);',
  '  closeSync(stdoutFd);',
  '  closeSync(stderrFd);',
  '  process.exit(status);',
  '};',
  'const smoke = spawn(process.execPath, [script, root], {',
  '  cwd: root,',
  '  env: process.env,',
  '  stdio: ["ignore", stdoutFd, stderrFd],',
  '});',
  'smoke.on("error", (error) => finish(1, error));',
  'smoke.on("close", (status) => finish(status ?? 1));',
].join('\n');

function runSmokeAsync(): SmokeHandle {
  const captureDir = mkdtempSync(join(tmpdir(), 'llxprt-release-smoke-'));
  const stdoutPath = join(captureDir, 'stdout.log');
  const stderrPath = join(captureDir, 'stderr.log');
  writeFileSync(stdoutPath, '');
  writeFileSync(stderrPath, '');

  const runningChild = spawn(
    'node',
    ['-e', captureSmokeOutput, stdoutPath, stderrPath, smokeScript, repoRoot],
    {
      cwd: repoRoot,
      env: { ...process.env },
      stdio: 'ignore',
      // Spawn detached on POSIX so we can kill the entire process group
      // (grandchildren: npm, tar, bun, etc. inside the smoke script). On
      // Windows, detached creates a new process group that taskkill /T can reap.
      detached: true,
    },
  );
  let child: ChildProcess | null = runningChild;
  let settled = false;
  let timer: NodeJS.Timeout | null = null;
  let disposed = false;
  let listenerTeardown: (() => void) | null = null;

  const promise = new Promise<{
    status: number | null;
    stdout: string;
    stderr: string;
  }>((resolvePromise, reject) => {
    function finish(
      outcome:
        | { ok: true; status: number | null }
        | { ok: false; error: unknown },
    ): void {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (outcome.ok) {
        resolvePromise({
          status: outcome.status,
          stdout: readFileSync(stdoutPath, 'utf8'),
          stderr: readFileSync(stderrPath, 'utf8'),
        });
      } else {
        reject(outcome.error);
      }
    }

    timer = setTimeout(() => {
      finish({
        ok: false,
        error: new Error(
          `smoke script exceeded ${SMOKE_TIMEOUT_MS}ms and was killed to prevent a hang/leak`,
        ),
      });
      dispose();
    }, SMOKE_TIMEOUT_MS);

    function onError(error: Error): void {
      finish({ ok: false, error });
    }
    function onClose(status: number | null): void {
      finish({ ok: true, status });
    }

    runningChild.on('error', onError);
    runningChild.on('close', onClose);
    listenerTeardown = () => {
      runningChild.removeListener('error', onError);
      runningChild.removeListener('close', onClose);
    };
  });

  // POSIX process-group kill: attempt kill(-pid) and ignore ESRCH (group
  // already exited). Falls back to child.kill for other errors. Extracted to
  // keep dispose() under the nested-control-flow limit.
  function killPosixGroup(proc: ChildProcess): void {
    if (!proc.pid) return;
    try {
      process.kill(-proc.pid, 'SIGKILL');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      // ESRCH = no such process/group; expected when everything already exited.
      if (code !== 'ESRCH') {
        try {
          proc.kill('SIGKILL');
        } catch {
          // best effort; child may have exited concurrently
        }
      }
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    // Kill the entire process tree so grandchildren (npm, tar, bun spawned
    // inside the smoke script) are reaped and do not leak as orphans.
    // We attempt the group kill REGARDLESS of whether the direct child is
    // still alive: if the direct child exited but descendants survived, the
    // process group is still addressable via kill(-pid).
    if (child && child.pid) {
      try {
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            timeout: 10_000,
          });
        } else {
          killPosixGroup(child);
        }
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          // best effort; child may have exited concurrently
        }
      }
    }
    if (child) {
      try {
        child.unref();
      } catch {
        // best effort
      }
    }
    listenerTeardown?.();
    listenerTeardown = null;
    child = null;
    try {
      rmSync(captureDir, { recursive: true, force: true });
    } catch {
      // Best effort because Windows may still hold a descendant's log open.
    }
  }

  return { promise, dispose };
}

describe('release-like CLI pack/install smoke (issue #2603)', () => {
  it('the standalone smoke script exists and is invocable via npm script', () => {
    expect(existsSync(smokeScript)).toBe(true);
  });

  it('the release-pack helper exports packReleaseLikeCli', async () => {
    const mod = await import(releasePackHelper);
    expect(typeof mod.packReleaseLikeCli).toBe('function');
  }, 15_000);

  // The smoke script packs and unpacks with the real tar binary. The GNU tar
  // that ships in the Windows runner's PATH reads the drive letter of an
  // absolute path as a remote host spec and fails with
  // "tar (child): Cannot connect to C: resolve failed". That is a limitation
  // of the POSIX packaging tooling, not of the published Windows package,
  // whose cmd and ps1 launchers are covered by install-native-launchers and
  // .github/workflows/windows-installed-command.yml. The two structural cases
  // above still run on Windows.
  it.skipIf(process.platform === 'win32')(
    'release-like global + local install runs --version and exits 0, release manifest has exact versions',
    async () => {
      const smoke = runSmokeAsync();
      // Register cleanup for both runners: afterEach (cross-runner) and
      // try/finally (immediate on success/failure). Under Vitest the original
      // code also used ctx.onTestFinished; the afterEach fallback covers Bun.
      pendingDisposals.push(() => smoke.dispose());
      let result: { status: number | null; stdout: string; stderr: string };
      try {
        result = await smoke.promise;
      } finally {
        smoke.dispose();
      }
      const { status, stdout, stderr } = result;
      // Truncate output to the last 80 lines so verbose npm/tar output does not
      // create huge error objects in CI logs.
      const tail = (s: string, maxLines = 80): string => {
        const lines = s.split('\n');
        if (lines.length <= maxLines) return s;
        return `... (${lines.length - maxLines} earlier lines truncated) ...\n${lines.slice(-maxLines).join('\n')}`;
      };
      expect(
        status,
        `smoke exited ${status}\n--- stdout (tail) ---\n${tail(stdout)}\n--- stderr (tail) ---\n${tail(stderr)}`,
      ).toBe(0);
      // stderr may contain benign safeCleanup warnings; only FAIL: lines indicate
      // a real test failure. The status===0 and success marker prove success.
      expect(
        stderr,
        `stderr contained FAIL: lines\n--- stdout (tail) ---\n${tail(stdout)}\n--- stderr (tail) ---\n${tail(stderr)}`,
      ).not.toContain('FAIL:');
      expect(stdout).toContain('global-install-version');
      expect(stdout).toContain('local-install-version');
      expect(stdout).toContain('npm-exec-ephemeral');
      expect(stdout).toContain('release-manifest-integrity');
      expect(stdout).toContain('All release-install smoke assertions passed.');
    },
    SMOKE_TEST_TIMEOUT_MS,
  );
});

describe('rewriteOnePkgDeps does not rewrite peerDependencies', () => {
  const nodeRequire = createRequire(import.meta.url);

  // Runtime guard: verify the dynamically required helper export exists before
  // calling it, so a refactor that removes or renames rewriteOnePkgDeps
  // produces a clear assertion failure instead of a cryptic TypeError.
  function loadReleasePackHelper(): {
    rewriteOnePkgDeps: (p: string, m: Map<string, string>) => void;
  } {
    const mod = nodeRequire(releasePackHelper) as Record<string, unknown>;
    expect(
      typeof mod.rewriteOnePkgDeps,
      'release-pack helper must export rewriteOnePkgDeps as a function',
    ).toBe('function');
    return mod as {
      rewriteOnePkgDeps: (p: string, m: Map<string, string>) => void;
    };
  }

  it('rewrites dependencies, devDependencies, and optionalDependencies to file: tarballs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rewrite-deps-'));
    try {
      const pkgPath = join(dir, 'package.json');
      writeFileSync(
        pkgPath,
        JSON.stringify(
          {
            name: 'test-pkg',
            dependencies: { '@vybestack/llxprt-code-core': '^1.0.0' },
            devDependencies: { '@vybestack/llxprt-code-agents': '^1.0.0' },
            optionalDependencies: { '@vybestack/llxprt-code-policy': '^1.0.0' },
          },
          null,
          2,
        ),
      );
      const tarballMap = new Map([
        ['@vybestack/llxprt-code-core', '/cache/core-1.0.0.tgz'],
        ['@vybestack/llxprt-code-agents', '/cache/agents-1.0.0.tgz'],
        ['@vybestack/llxprt-code-policy', '/cache/policy-1.0.0.tgz'],
      ]);
      const mod = loadReleasePackHelper();
      mod.rewriteOnePkgDeps(pkgPath, tarballMap);
      const result = JSON.parse(readFileSync(pkgPath, 'utf8'));
      expect(result.dependencies['@vybestack/llxprt-code-core']).toBe(
        'file:/cache/core-1.0.0.tgz',
      );
      expect(result.devDependencies['@vybestack/llxprt-code-agents']).toBe(
        'file:/cache/agents-1.0.0.tgz',
      );
      expect(result.optionalDependencies['@vybestack/llxprt-code-policy']).toBe(
        'file:/cache/policy-1.0.0.tgz',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does NOT rewrite peerDependencies (peers are consumer-provided)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rewrite-peers-'));
    try {
      const pkgPath = join(dir, 'package.json');
      const originalPeerSpec = '^1.0.0';
      writeFileSync(
        pkgPath,
        JSON.stringify(
          {
            name: 'test-pkg',
            dependencies: { '@vybestack/llxprt-code-core': '^1.0.0' },
            peerDependencies: {
              '@vybestack/llxprt-code-core': originalPeerSpec,
            },
          },
          null,
          2,
        ),
      );
      const tarballMap = new Map([
        ['@vybestack/llxprt-code-core', '/cache/core-1.0.0.tgz'],
      ]);
      const mod = loadReleasePackHelper();
      mod.rewriteOnePkgDeps(pkgPath, tarballMap);
      const result = JSON.parse(readFileSync(pkgPath, 'utf8'));
      // dependencies ARE rewritten.
      expect(result.dependencies['@vybestack/llxprt-code-core']).toBe(
        'file:/cache/core-1.0.0.tgz',
      );
      // peerDependencies are NOT rewritten — the original spec is preserved.
      expect(result.peerDependencies['@vybestack/llxprt-code-core']).toBe(
        originalPeerSpec,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('release-bound artifact graph (issue #3771)', () => {
  it('runs the native Node runtime with Bun absent from the isolated PATH', () => {
    const directory = mkdtempSync(join(tmpdir(), 'llxprt-node-only-'));
    pendingDisposals.push(() =>
      rmSync(directory, { recursive: true, force: true }),
    );
    const host = spawnSync('node', ['-p', 'process.execPath'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(host.status).toBe(0);
    const hostVersion = spawnSync(host.stdout.trim(), ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(hostVersion.status).toBe(0);
    prepareNodeOnlyRuntime(directory);
    const env = {
      ...process.env,
      PATH:
        process.platform === 'win32'
          ? `${directory};${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`
          : directory,
    };
    const version = spawnSync('node', ['--version'], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(version.stderr).toBe('');
    expect(version.status).toBe(0);
    expect(version.stdout).toBe(hostVersion.stdout);
    const identity = spawnSync('node', ['-p', 'process.execPath'], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(identity.status).toBe(0);
    expect(realpathSync(identity.stdout.trim())).toBe(
      realpathSync(
        process.platform === 'win32'
          ? join(directory, 'node.exe')
          : host.stdout.trim(),
      ),
    );
    const native = spawnSync('node', ['-p', 'Boolean(process.versions.bun)'], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(native.status).toBe(0);
    expect(native.stdout.trim()).toBe('false');
    const bun = spawnSync('bun', ['--version'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(bun.error).toMatchObject({ code: 'ENOENT' });
  });

  it.skipIf(process.platform !== 'darwin')(
    'exposes native sysctl without restoring host PATH or changing Node identity',
    () => {
      const directory = mkdtempSync(join(tmpdir(), 'llxprt-sysctl-only-'));
      pendingDisposals.push(() =>
        rmSync(directory, { recursive: true, force: true }),
      );
      const host = spawnSync('node', ['-p', 'process.execPath'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      expect(host.status).toBe(0);
      const machine = spawnSync('/usr/sbin/sysctl', ['-n', 'hw.machine'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      expect(machine.status).toBe(0);
      expect(machine.stdout.trim().length).toBeGreaterThan(0);
      prepareNodeOnlyRuntime(directory);
      const env = { ...process.env, PATH: directory };
      const identity = spawnSync('node', ['-p', 'process.execPath'], {
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      expect(identity.status).toBe(0);
      expect(realpathSync(identity.stdout.trim())).toBe(
        realpathSync(host.stdout.trim()),
      );
      const bun = spawnSync('bun', ['--version'], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      expect(bun.error).toMatchObject({ code: 'ENOENT' });
      const probe = spawnSync(
        'node',
        [
          '-e',
          "process.stdout.write(require('node:child_process').execFileSync('sysctl', ['-n', 'hw.machine'], {stdio: ['ignore', 'pipe', 'pipe']}))",
        ],
        { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      expect(probe.status, probe.stderr).toBe(0);
      expect(probe.stdout).toBe(machine.stdout);
      expect(realpathSync(join(directory, 'sysctl'))).toBe(
        realpathSync('/usr/sbin/sysctl'),
      );
      expect(readdirSync(directory).sort()).toEqual(['node', 'sysctl']);
    },
  );

  const workspaceInfo = getWorkspaceInfo();
  const published = new Set(deriveNpmReleasePackages());
  const manifests = [...workspaceInfo.values()].map((pkg) =>
    readReleaseManifest(pkg.pkgJsonPath),
  );
  const workspaceNames = new Set(workspaceInfo.keys());

  it('rejects dependency metadata retaining local workspace paths', () => {
    expect(() => assertReleaseGraph(manifests, workspaceNames)).toThrow(
      'expected release version',
    );
  });

  it('accepts the actual workspace runtime graph after official release binding', () => {
    const bound = manifests
      .filter((pkg) => published.has(pkg.name))
      .map((pkg) => {
        const dependencies = { ...pkg.dependencies };
        const optionalDependencies = { ...pkg.optionalDependencies };
        const peerDependencies = { ...pkg.peerDependencies };
        for (const deps of [
          dependencies,
          optionalDependencies,
          peerDependencies,
        ]) {
          rewriteDeps(deps, workspaceInfo, published);
        }
        return { ...pkg, dependencies, optionalDependencies, peerDependencies };
      });
    expect(() => assertReleaseGraph(bound, workspaceNames)).not.toThrow();
  });

  it('packs release artifacts when npm emits workspace warnings on stderr', async () => {
    const root = mkdtempSync(join(tmpdir(), 'llxprt-pack-warning-'));
    try {
      const built = join(root, 'built');
      const evidence = join(root, 'evidence');
      const workspace = join(built, 'packages/probe');
      mkdirSync(workspace, { recursive: true });
      mkdirSync(join(built, 'scripts/utils'), { recursive: true });
      mkdirSync(evidence);
      writeFileSync(
        join(built, 'package.json'),
        JSON.stringify({
          name: 'release-proof-fixture',
          version: '1.0.0',
          private: true,
          workspaces: ['packages/probe'],
        }),
      );
      writeFileSync(join(built, 'package-lock.json'), '{}');
      writeFileSync(
        join(workspace, 'package.json'),
        JSON.stringify({
          name: 'release-proof-warning-fixture',
          version: '1.0.0',
        }),
      );
      writeFileSync(join(workspace, '.npmrc'), 'audit=false\n');
      const artifacts = await packReleaseArtifacts(built, repoRoot, evidence);
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]?.manifest.name).toBe('release-proof-warning-fixture');
      expect(existsSync(artifacts[0]?.tarball ?? '')).toBe(true);
      expect(
        readFileSync(
          join(evidence, 'pack-release-proof-warning-fixture.log'),
          'utf8',
        ),
      ).toContain('ignoring workspace config');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  for (const outside of [false, true]) {
    it(
      outside
        ? 'rejects an installed package escaping a symlinked consumer root'
        : 'verifies an installed graph through a symlinked consumer root',
      async () => {
        const temporary = mkdtempSync(join(tmpdir(), 'llxprt-graph-alias-'));
        const root = realpathSync(temporary);
        try {
          const consumer = join(root, 'consumer');
          const alias = join(root, 'consumer-alias');
          const evidence = join(root, 'evidence');
          const scope = join(consumer, 'node_modules', '@vybestack');
          mkdirSync(scope, { recursive: true });
          mkdirSync(evidence);
          symlinkSync(consumer, alias, 'junction');
          const installed = join(scope, 'llxprt-code');
          const directory = outside ? join(root, 'outside') : installed;
          mkdirSync(directory);
          if (outside) symlinkSync(directory, installed, 'junction');
          const manifest = {
            name: '@vybestack/llxprt-code',
            version: '0.0.0-graph-alias',
          };
          writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify(manifest),
          );
          const verification = verifyInstalledGraph(
            [{ directory, tarball: join(root, 'unused.tgz'), manifest }],
            alias,
            evidence,
            process.env,
          );
          if (outside) {
            await expect(verification).rejects.toThrow(
              `Package escaped consumer: ${join(alias, 'node_modules', manifest.name, 'package.json')}`,
            );
            expect(existsSync(join(evidence, 'installed-graph.json'))).toBe(
              false,
            );
          } else {
            await verification;
            expect(
              JSON.parse(
                readFileSync(join(evidence, 'installed-graph.json'), 'utf8'),
              ),
            ).toEqual([
              {
                name: manifest.name,
                version: manifest.version,
                dependencies: {},
              },
            ]);
          }
        } finally {
          rmSync(temporary, { recursive: true, force: true });
        }
      },
    );
  }

  it('never executes consumer lifecycle scripts in local or global release proof installs', async () => {
    const evidence = mkdtempSync(join(tmpdir(), 'llxprt-lifecycle-proof-'));
    try {
      const manifest = {
        name: '@vybestack/llxprt-code',
        version: '0.0.0-lifecycle-proof',
        bin: { llxprt: 'probe' },
        scripts: {
          postinstall: 'node -e "throw new Error(\'consumer hook executed\')"',
        },
      };
      writeFileSync(join(evidence, 'package.json'), JSON.stringify(manifest));
      writeFileSync(
        join(evidence, 'probe'),
        '#!/usr/bin/env node\nconsole.log(process.argv.includes("--version") ? "0.0.0-lifecycle-proof" : "llxprt [promptWords...] --help");\n',
      );
      chmodSync(join(evidence, 'probe'), 0o755);
      const node = Bun.which('node');
      if (node === null) throw new Error('Node is required for npm fixtures');
      const invocation = npmInvocation(['pack', '--ignore-scripts', '--json'], {
        execPath: node,
      });
      const result = spawnSync(invocation.command, invocation.args, {
        cwd: evidence,
        encoding: 'utf8',
        timeout: 30_000,
      });
      expect(result.status, result.stderr).toBe(0);
      const tarball = join(
        evidence,
        'vybestack-llxprt-code-0.0.0-lifecycle-proof.tgz',
      );

      const help = await installReleaseArtifacts(
        [{ directory: evidence, tarball, manifest }],
        evidence,
      );

      expect(help).toContain('llxprt [promptWords...]');
      for (const mode of ['local', 'global']) {
        expect(
          readFileSync(
            join(evidence, mode, 'installed-version.log'),
            'utf8',
          ).trim(),
        ).toBe(manifest.version);
      }
    } finally {
      rmSync(evidence, { recursive: true, force: true });
    }
  }, 120_000);

  it.skipIf(!process.env.LLXPRT_RELEASE_BUILT_ROOT)(
    'installs release-bound tarballs with scripts disabled locally and globally and runs installed version/help',
    async () => {
      const builtRoot = process.env.LLXPRT_RELEASE_BUILT_ROOT;
      if (!builtRoot) throw new Error('LLXPRT_RELEASE_BUILT_ROOT is required');
      const evidence = process.env.LLXPRT_RELEASE_PROOF_DIR;
      if (!evidence) throw new Error('LLXPRT_RELEASE_PROOF_DIR is required');
      const artifacts = await packReleaseArtifacts(
        builtRoot,
        repoRoot,
        evidence,
      );
      const help = await installReleaseArtifacts(artifacts, evidence);
      expect(help).toContain('llxprt [promptWords...]');
      expect(help).toContain('--help');
      for (const mode of ['local', 'global']) {
        expect(
          readFileSync(join(evidence, mode, 'installed-version.log'), 'utf8'),
        ).toContain(artifacts[0]?.manifest.version ?? 'missing version');
        expect(
          readFileSync(join(evidence, mode, 'installed-help.log'), 'utf8'),
        ).toContain('--help');
      }
    },
    1_200_000,
  );
});
