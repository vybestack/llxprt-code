/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import {
  isChildSuccess,
  formatFailureDiagnostic,
  isMainModule,
  resolveTsconfigOverride,
  runBunTests,
  type BunTestRunnerDependencies,
  type BunTestSpawnOptions,
  type ChildExitInfo,
} from '../run_bun_tests.js';

const repoRoot = resolve(__dirname, '..', '..');

describe('isChildSuccess', () => {
  it('returns true for exit code 0 with null signal', () => {
    const child: ChildExitInfo = { exitCode: 0, signalCode: null };
    expect(isChildSuccess(child)).toBe(true);
  });

  it('returns true for exit code 0 with undefined signal', () => {
    const child: ChildExitInfo = { exitCode: 0, signalCode: undefined };
    expect(isChildSuccess(child)).toBe(true);
  });

  it('returns false for a nonzero exit code', () => {
    const child: ChildExitInfo = { exitCode: 1, signalCode: null };
    expect(isChildSuccess(child)).toBe(false);
  });

  it('returns false when signalCode is SIGTERM', () => {
    const child: ChildExitInfo = { exitCode: 0, signalCode: 'SIGTERM' };
    expect(isChildSuccess(child)).toBe(false);
  });

  it('returns false when exitCode is null (killed by signal)', () => {
    const child: ChildExitInfo = { exitCode: null, signalCode: 'SIGTERM' };
    expect(isChildSuccess(child)).toBe(false);
  });

  it('returns false when exitCode is null and signalCode is null', () => {
    const child: ChildExitInfo = { exitCode: null, signalCode: null };
    expect(isChildSuccess(child)).toBe(false);
  });
});

describe('formatFailureDiagnostic', () => {
  it('reports the signal name when a signal is present', () => {
    const child: ChildExitInfo = {
      exitCode: 0,
      signalCode: 'SIGTERM',
    };
    expect(formatFailureDiagnostic(child)).toBe(' (signal: SIGTERM)');
  });

  it('reports the numeric exit code for an ordinary nonzero exit', () => {
    const child: ChildExitInfo = { exitCode: 1, signalCode: null };
    expect(formatFailureDiagnostic(child)).toBe(' (exit code: 1)');
  });

  it('reports the numeric exit code when signalCode is undefined', () => {
    const child: ChildExitInfo = { exitCode: 42, signalCode: undefined };
    expect(formatFailureDiagnostic(child)).toBe(' (exit code: 42)');
  });

  it('reports the signal name even when exitCode is null', () => {
    const child: ChildExitInfo = { exitCode: null, signalCode: 'SIGKILL' };
    expect(formatFailureDiagnostic(child)).toBe(' (signal: SIGKILL)');
  });

  it('reports null exit code diagnostic when killed by signal with no signalCode', () => {
    const child: ChildExitInfo = { exitCode: null, signalCode: null };
    expect(formatFailureDiagnostic(child)).toBe(' (exit code: null)');
  });

  it('returns an empty string for a successful child', () => {
    const child: ChildExitInfo = { exitCode: 0, signalCode: null };
    expect(formatFailureDiagnostic(child)).toBe('');
  });
});

describe('isMainModule', () => {
  it('returns true when argv1 resolves to the module URL', () => {
    const modulePath = '/some/path/script.ts';
    const moduleUrl = pathToFileURL(modulePath).href;
    expect(isMainModule(modulePath, moduleUrl)).toBe(true);
  });

  it('returns true when the path contains spaces', () => {
    const modulePath = '/some path/with spaces/script.ts';
    const moduleUrl = pathToFileURL(modulePath).href;
    expect(isMainModule(modulePath, moduleUrl)).toBe(true);
  });

  it('returns false when argv1 is a different path', () => {
    const moduleUrl = pathToFileURL('/some/path/script.ts').href;
    expect(isMainModule('/other/path.ts', moduleUrl)).toBe(false);
  });

  it('returns false when argv1 is undefined', () => {
    const moduleUrl = pathToFileURL('/some/path/script.ts').href;
    expect(isMainModule(undefined, moduleUrl)).toBe(false);
  });
});

describe('resolveTsconfigOverride', () => {
  let fixtureDir: string;

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'bun-runner-tsconfig-'));
  });

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('returns an absolute path resolved from the invocation directory', () => {
    const relativePath = 'configs/tsconfig.bun.json';
    mkdirSync(join(fixtureDir, 'configs'));
    writeFileSync(join(fixtureDir, relativePath), '{}\n');

    expect(resolveTsconfigOverride(relativePath, fixtureDir)).toBe(
      join(fixtureDir, relativePath),
    );
  });

  it('rejects a missing override before child processes are started', () => {
    expect(() =>
      resolveTsconfigOverride('missing-tsconfig.json', fixtureDir),
    ).toThrow('Tsconfig override is not a file');
  });

  it('rejects a directory passed as an override', () => {
    expect(() => resolveTsconfigOverride('.', fixtureDir)).toThrow(
      'Tsconfig override is not a file',
    );
  });
});

describe('runBunTests', () => {
  it('executes every entry with exact argv, cwd, and env and reports all failure modes', () => {
    const environment = { RUNNER_TEST: '1' };
    const entries = [
      { cwd: '/repo/packages/one', file: '/repo/packages/one/one.test.ts' },
      { cwd: '/repo/packages/two', file: '/repo/packages/two/two.test.ts' },
      {
        cwd: '/repo/packages/three',
        file: '/repo/packages/three/three.test.ts',
      },
    ];
    const results: ChildExitInfo[] = [
      { exitCode: 0, signalCode: null },
      { exitCode: 7, signalCode: null },
      { exitCode: null, signalCode: 'SIGTERM' },
    ];
    const calls: Array<{
      command: readonly string[];
      options: BunTestSpawnOptions;
    }> = [];
    const stdout: string[] = [];
    const stderr: string[] = [];
    let resolvedWorkspace: string | undefined;
    const dependencies: BunTestRunnerDependencies = {
      repoRoot: '/repo',
      invocationDirectory: '/invoke',
      executable: '/bin/bun',
      environment,
      resolveFiles: (_root, workspace) => {
        resolvedWorkspace = workspace;
        return entries;
      },
      resolveTsconfig: () => '/invoke/config/tsconfig.json',
      spawn: (command, options) => {
        calls.push({ command, options });
        const result = results[calls.length - 1];
        if (!result) {
          throw new Error('Unexpected spawn');
        }
        return result;
      },
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    };

    const status = runBunTests(
      [
        '--workspace',
        'selected',
        '--tsconfig',
        'config/tsconfig.json',
        '--timeout',
        '1234',
      ],
      dependencies,
    );

    expect(resolvedWorkspace).toBe('selected');
    expect(calls).toEqual(
      entries.map((entry) => ({
        command: [
          '/bin/bun',
          'test',
          '--tsconfig-override',
          '/invoke/config/tsconfig.json',
          '--max-concurrency',
          '1',
          '--timeout',
          '1234',
          entry.file,
        ],
        options: {
          cwd: entry.cwd,
          env: environment,
          stdin: 'inherit',
          stdout: 'inherit',
          stderr: 'inherit',
        },
      })),
    );
    expect(stderr).toEqual([
      'Native Bun test failed: /repo/packages/two/two.test.ts (exit code: 7)',
      'Native Bun test failed: /repo/packages/three/three.test.ts (signal: SIGTERM)',
    ]);
    expect(stdout.at(-1)).toBe(
      'Passed 1/3 isolated native Bun test files (2 failed)',
    );
    expect(status).toBe(1);
  });

  it('reports a spawn exception for its file and continues with later entries', () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let spawnCount = 0;
    const dependencies: BunTestRunnerDependencies = {
      repoRoot: '/repo',
      invocationDirectory: '/invoke',
      executable: '/bin/bun',
      environment: {},
      resolveFiles: () => [
        { cwd: '/repo/one', file: '/repo/one/throws.test.ts' },
        { cwd: '/repo/two', file: '/repo/two/passes.test.ts' },
      ],
      resolveTsconfig: resolveTsconfigOverride,
      spawn: () => {
        spawnCount++;
        if (spawnCount === 1) {
          const error = new Error('spawn EACCES');
          error.name = 'SpawnError';
          throw error;
        }
        return { exitCode: 0, signalCode: null };
      },
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    };

    const status = runBunTests([], dependencies);

    expect(spawnCount).toBe(2);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain(
      'Native Bun test failed: /repo/one/throws.test.ts',
    );
    expect(stderr[0]).toContain('SpawnError: spawn EACCES');
    expect(stdout.at(-1)).toBe(
      'Passed 1/2 isolated native Bun test files (1 failed)',
    );
    expect(status).toBe(1);
  });

  it('returns success and reports the complete passing summary', () => {
    const stdout: string[] = [];
    const dependencies: BunTestRunnerDependencies = {
      repoRoot: '/repo',
      invocationDirectory: '/invoke',
      executable: '/bin/bun',
      environment: {},
      resolveFiles: () => [{ cwd: '/repo/core', file: '/repo/core/test.ts' }],
      resolveTsconfig: resolveTsconfigOverride,
      spawn: () => ({ exitCode: 0, signalCode: null }),
      stdout: (line) => stdout.push(line),
      stderr: () => {},
    };

    const status = runBunTests([], dependencies);

    expect(stdout.at(-1)).toBe('Passed 1/1 isolated native Bun test files');
    expect(status).toBe(0);
  });
});

describe('actual child process signal shape', () => {
  // Signal semantics differ between platforms: on POSIX systems, a child
  // killed by a signal reports exitCode=null and signal='SIGTERM'. On
  // Windows, process.kill with a signal name may translate to exit code 1
  // rather than producing a signal. These tests are POSIX-specific.
  const isPosix = platform() !== 'win32';

  it.runIf(isPosix)(
    'produces exitCode null and a string signalCode when a child is killed by a signal',
    () => {
      // The child kills itself with SIGTERM. spawnSync blocks until the child
      // has terminated, so we cannot kill it from the parent after the call
      // returns; the child must signal itself. Node's spawnSync has the same
      // exit/signal semantics as Bun's spawnSync.
      const child = spawnSync(process.execPath, [
        '-e',
        'process.kill(process.pid, "SIGTERM")',
      ]);

      // After a signal kill, status is null and signal is the signal name
      const signalChild: ChildExitInfo = {
        exitCode: child.status,
        signalCode: child.signal,
      };

      expect(signalChild.exitCode).toBe(null);
      expect(signalChild.signalCode).toBe('SIGTERM');
      expect(isChildSuccess(signalChild)).toBe(false);
      expect(formatFailureDiagnostic(signalChild)).toBe(' (signal: SIGTERM)');
    },
  );

  it('produces exitCode 0 and null signalCode when a child exits normally', () => {
    const child = spawnSync(process.execPath, ['-e', 'process.exit(0)']);

    const successChild: ChildExitInfo = {
      exitCode: child.status,
      signalCode: child.signal,
    };

    expect(successChild.exitCode).toBe(0);
    expect(successChild.signalCode).toBe(null);
    expect(isChildSuccess(successChild)).toBe(true);
    expect(formatFailureDiagnostic(successChild)).toBe('');
  });

  it('produces a nonzero exitCode and null signalCode when a child exits with failure', () => {
    const child = spawnSync(process.execPath, ['-e', 'process.exit(3)']);

    const failChild: ChildExitInfo = {
      exitCode: child.status,
      signalCode: child.signal,
    };

    expect(failChild.exitCode).toBe(3);
    expect(failChild.signalCode).toBe(null);
    expect(isChildSuccess(failChild)).toBe(false);
    expect(formatFailureDiagnostic(failChild)).toBe(' (exit code: 3)');
  });
});

// ---------------------------------------------------------------------------
// Integration: real Bun subprocess execution with a script path containing spaces
// ---------------------------------------------------------------------------
// These tests isolate the generic main-guard pattern by spawning a copied
// fixture whose path contains spaces. They do not execute or validate the
// production runner; the dry-run subprocess test below provides that coverage.
//
// The production runner (run_bun_tests.ts) requires Bun. When these tests
// run under Bun's own test runner, process.execPath is Bun. When they run
// under Vitest (Node), process.execPath is Node, which cannot execute the
// ESM fixture correctly (top-level await, import.meta.url differences). We
// resolve the actual Bun binary by checking the BUN_EXEC env var, then
// node_modules/.bin/bun relative to the repo root, then PATH lookup. The
// fixture is always ESM (.mjs) using `import` syntax, imported via
// pathToFileURL for cross-platform path handling.

/**
 * Finds the Bun binary needed for subprocess tests. Resolution order:
 * 1. process.execPath if it is Bun itself (when the test runs under Bun)
 * 2. BUN_EXEC environment variable
 * 3. node_modules/.bin/bun relative to the repo root (npm/bun-installed)
 * 4. "bun" from PATH (cross-platform spawnSync lookup)
 *
 * Returns null if Bun cannot be found, in which case the Bun-only
 * integration tests are skipped via it.skipIf.
 */
function resolveBunBinary(): string | null {
  // Under Bun, process.execPath is the Bun binary — no lookup needed.
  if (typeof Bun !== 'undefined') {
    return process.execPath;
  }

  // Under Node (Vitest), find Bun elsewhere.
  const fromEnv = process.env['BUN_EXEC'];
  if (fromEnv && existsSync(fromEnv)) {
    return fromEnv;
  }

  const localBin = join(repoRoot, 'node_modules', '.bin', 'bun');
  if (existsSync(localBin)) {
    return localBin;
  }

  // Cross-platform PATH lookup (no dependency on POSIX `which`).
  const cmd = platform() === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, ['bun'], { encoding: 'utf8' });
  if (result.status === 0) {
    const found = result.stdout.trim().split('\n')[0];
    if (found && existsSync(found)) {
      return found;
    }
  }

  return null;
}

/**
 * The resolved Bun binary path, or null if Bun was not found.
 */
const bunBinary = resolveBunBinary();

describe('production Bun native test runner', () => {
  it.skipIf(!bunBinary)(
    'executes the real runner in dry-run mode from a different cwd',
    () => {
      const child = spawnSync(
        bunBinary!,
        [
          resolve(repoRoot, 'scripts/run_bun_tests.ts'),
          '--workspace',
          'core',
          '--dry-run',
        ],
        {
          cwd: tmpdir(),
          encoding: 'utf8',
          env: process.env,
        },
      );

      expect(child.status, child.stderr).toBe(0);
      expect(child.stdout).toContain('Dry run: 1 files would be executed:');
      expect(child.stdout).toContain('packages/core/src/utils/errors.test.ts');
    },
  );

  it.skipIf(!bunBinary)(
    'forwards an invocation-relative tsconfig to a real isolated Bun test',
    () => {
      const child = spawnSync(
        bunBinary!,
        [
          resolve(repoRoot, 'scripts/run_bun_tests.ts'),
          '--workspace',
          'core',
          '--tsconfig',
          resolve(repoRoot, 'tsconfig.json'),
        ],
        {
          cwd: tmpdir(),
          encoding: 'utf8',
          env: process.env,
        },
      );

      expect(child.status, child.stderr).toBe(0);
      expect(child.stdout).toContain(
        'Passed 1/1 isolated native Bun test files',
      );
    },
  );
});

/**
 * ESM fixture source. Uses `import { pathToFileURL } from 'node:url'` and
 * `import.meta.url` — the same main-guard pattern used by run_bun_tests.ts.
 * Prints "MAIN_RAN" only when executed as the main module.
 */
function buildFixtureSource(): string {
  return `import { pathToFileURL } from 'node:url';

function main() {
  console.log('MAIN_RAN');
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main();
}
`;
}

describe('Bun subprocess main-guard integration (path with spaces)', () => {
  let fixtureDir: string;

  function createFixtureDirWithSpaces(): string {
    const tempBase = mkdtempSync(join(tmpdir(), 'bun-main-guard-'));
    // Create a subdirectory with spaces in the name.
    const dirWithSpaces = join(tempBase, 'path with spaces');
    mkdirSync(dirWithSpaces, { recursive: true });
    return dirWithSpaces;
  }

  function writeFixtureScript(dir: string): string {
    const scriptPath = join(dir, 'main-guard-script.mjs');
    writeFileSync(scriptPath, buildFixtureSource(), 'utf8');
    return scriptPath;
  }

  beforeEach((): void => {
    fixtureDir = createFixtureDirWithSpaces();
  });

  afterEach((): void => {
    if (fixtureDir && existsSync(fixtureDir)) {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  // These tests require the actual Bun binary. When Bun is not available
  // (e.g. CI with only Node), they are skipped rather than failing.
  it.skipIf(!bunBinary)('executes main when the script is run directly', () => {
    const binary = bunBinary!;
    const scriptPath = writeFixtureScript(fixtureDir);
    const child = spawnSync(binary, [scriptPath], {
      encoding: 'utf8',
      env: process.env,
    });

    const result: ChildExitInfo = {
      exitCode: child.status,
      signalCode: child.signal,
    };

    expect(isChildSuccess(result)).toBe(true);
    expect(child.stdout).toContain('MAIN_RAN');
  });

  it.skipIf(!bunBinary)(
    'does not execute main when the script is imported (not run directly)',
    () => {
      const binary = bunBinary!;
      const scriptPath = writeFixtureScript(fixtureDir);
      // Create an importer script that imports the fixture via pathToFileURL,
      // ensuring cross-platform path handling for paths with spaces.
      const importerPath = join(fixtureDir, 'importer.mjs');
      const importUrl = pathToFileURL(scriptPath).href;
      writeFileSync(
        importerPath,
        `await import('${importUrl}');\nconsole.log('IMPORTER_DONE');\n`,
        'utf8',
      );

      const child = spawnSync(binary, [importerPath], {
        encoding: 'utf8',
        env: process.env,
      });

      const result: ChildExitInfo = {
        exitCode: child.status,
        signalCode: child.signal,
      };

      expect(isChildSuccess(result)).toBe(true);
      expect(child.stdout).toContain('IMPORTER_DONE');
      // The fixture's main() must NOT have run during import.
      expect(child.stdout).not.toContain('MAIN_RAN');
    },
  );
});
