/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the canonical lint runner (issues #2710, #3387).
 *
 * These tests exercise the REAL command builder exported from
 * `scripts/run-lint.ts`. No mock theater: the builder is imported and invoked
 * with real argument lists and environment inputs, and the produced ESLint
 * invocations are asserted as concrete command/argument tuples. The package
 * discovery test reads the REAL `packages/` directory.
 *
 * Coverage:
 *  - lint/lint:fix/lint:ci delegate to the runner (package-script wiring)
 *  - lint:ci keeps --max-warnings 0 and hardcodes no heap, so it stays
 *    stricter than lint while the runner owns the per-child heap
 *  - A full run is partitioned one process per package plus one for the rest,
 *    and that partition covers every package on disk (#3387)
 *  - every command of a full run carries the 6144 heap (never the retired
 *    12288) and forwarded args such as --max-warnings 0 reach every command
 *  - The rest group complements the package groups via --ignore-pattern
 *  - Scoped runs are partitioned one process per target
 *  - Scoped run always includes integration-tests as a target
 *  - Argument forwarding (--max-warnings 0, --fix) is preserved
 *  - Cache is opt-in only (--cache requires explicit env/flag, not default)
 *  - Heap is normalized to 6GB (6144) and a stale inherited limit is replaced
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const RUNNER_PATH = join(REPO_ROOT, 'scripts', 'run-lint.ts');

/** A single ESLint invocation the runner would spawn. */
interface LintCommand {
  readonly cmd: string;
  readonly args: readonly string[];
  readonly nodeOptions: string;
  readonly label: string;
}

/** Parameters for the runner's command builder. */
interface BuildCommandsParams {
  readonly targets: readonly string[] | null;
  readonly forwardedArgs: readonly string[];
  readonly cache: boolean;
  readonly packageDirs?: readonly string[];
  readonly heapMb?: number;
  readonly nodeOptions?: string;
}

interface RunnerModule {
  buildLintCommands: (params: BuildCommandsParams) => readonly LintCommand[];
  stripRunnerArgs: (rawArgs: readonly string[]) => string[];
  readPackageDirs: (repoRoot: string) => readonly string[];
}

/** Imports the real runner module under test; nothing here is stubbed. */
async function loadRunner(): Promise<RunnerModule> {
  return await import(RUNNER_PATH);
}

/** Positional ESLint targets: the args before the first flag. */
function targetsOf(command: LintCommand): readonly string[] {
  const firstFlag = command.args.findIndex((arg) => arg.startsWith('-'));
  return firstFlag === -1 ? command.args : command.args.slice(0, firstFlag);
}

const TWO_PACKAGES = ['packages/cli', 'packages/core'];

describe('run-lint runner — a full run is partitioned per package (#3387)', () => {
  it('emits one command per package directory plus one for the rest', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      packageDirs: TWO_PACKAGES,
    });
    expect(commands.length).toBe(TWO_PACKAGES.length + 1);
  });

  it('gives each package directory its own dedicated invocation', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      packageDirs: TWO_PACKAGES,
    });
    expect(commands.slice(0, 2).map((c) => [...targetsOf(c)])).toEqual([
      ['packages/cli'],
      ['packages/core'],
    ]);
  });

  it('sorts package groups so the run order is deterministic', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      packageDirs: ['packages/tools', 'packages/agents', 'packages/cli'],
    });
    expect(commands.slice(0, 3).map((c) => c.label)).toEqual([
      'packages/agents',
      'packages/cli',
      'packages/tools',
    ]);
  });

  it('lints the rest of the tree with packages excluded, so the two halves complement', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      packageDirs: TWO_PACKAGES,
    });
    const rest = commands[commands.length - 1];
    expect([...targetsOf(rest)]).toEqual(['.']);
    const patternIndex = rest.args.indexOf('--ignore-pattern');
    expect(patternIndex).toBeGreaterThan(-1);
    // `packages/*/**`, not `packages/**`: the latter would also drop a file
    // sitting directly in packages/, which no package group covers. See
    // scripts/tests/run-lint-partition.test.ts for the end-to-end proof.
    expect(rest.args[patternIndex + 1]).toBe('packages/*/**');
  });

  it('does not exclude packages from the per-package groups', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      packageDirs: TWO_PACKAGES,
    });
    for (const command of commands.slice(0, 2)) {
      expect(command.args).not.toContain('--ignore-pattern');
    }
  });

  it('covers every package that actually exists on disk', async () => {
    const { buildLintCommands, readPackageDirs } = await loadRunner();
    const onDisk = readPackageDirs(REPO_ROOT);
    // Guards the test itself: a discovery bug that returned nothing would
    // otherwise make the coverage assertion vacuously true.
    expect(onDisk.length).toBeGreaterThan(1);
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      packageDirs: onDisk,
    });
    const covered = commands.flatMap((c) => [...targetsOf(c)]);
    for (const dir of onDisk) {
      expect(covered).toContain(dir);
    }
  });

  it('discovers real package directories and nothing outside packages/', async () => {
    const { readPackageDirs } = await loadRunner();
    const dirs = readPackageDirs(REPO_ROOT);
    expect(dirs).toContain('packages/cli');
    expect(dirs).toContain('packages/core');
    for (const dir of dirs) {
      expect(dir.startsWith('packages/')).toBe(true);
    }
  });

  it('stays a single root invocation when there is nothing to partition', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      packageDirs: [],
    });
    expect(commands.length).toBe(1);
    expect([...targetsOf(commands[0])]).toEqual(['.']);
    expect(commands[0].args).not.toContain('--ignore-pattern');
  });

  it('does NOT produce a separate integration-tests invocation for a full run', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      packageDirs: TWO_PACKAGES,
    });
    // The rest group already covers integration-tests; there must be no
    // standalone "integration-tests" command duplicating that traversal.
    const standaloneIntegration = commands.filter((c) =>
      c.args.includes('integration-tests'),
    );
    expect(standaloneIntegration.length).toBe(0);
  });

  it('tolerates package targets that match only ignored files, which packages/lsp does', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      packageDirs: TWO_PACKAGES,
    });
    for (const command of commands.slice(0, 2)) {
      expect(command.args).toContain('--no-error-on-unmatched-pattern');
    }
  });

  it('still fails loudly when the rest-of-tree group matches nothing', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      packageDirs: TWO_PACKAGES,
    });
    const rest = commands[commands.length - 1];
    expect(rest.args).not.toContain('--no-error-on-unmatched-pattern');
  });
});

describe('run-lint runner — scoped run is partitioned per target (A2, #3387)', () => {
  it('emits one command per explicit target', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: ['packages/core', 'integration-tests'],
      forwardedArgs: [],
      cache: false,
    });
    expect(commands.map((c) => [...targetsOf(c)])).toEqual([
      ['integration-tests'],
      ['packages/core'],
    ]);
  });

  it('treats an empty targets array as a scoped run with integration-tests only', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: [],
      forwardedArgs: [],
      cache: false,
    });
    expect(commands.length).toBe(1);
    expect(commands[0].args).toContain('integration-tests');
    expect(commands[0].args).not.toContain('.');
  });

  it('scoped run always includes integration-tests even if omitted from input', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: ['packages/cli'],
      forwardedArgs: [],
      cache: false,
    });
    expect(commands.flatMap((c) => [...targetsOf(c)])).toContain(
      'integration-tests',
    );
  });

  it('scoped run does not add a root "." target', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: ['packages/core'],
      forwardedArgs: [],
      cache: false,
    });
    expect(commands.flatMap((c) => [...c.args])).not.toContain('.');
  });

  it('scoped run deduplicates integration-tests if already present', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: ['packages/core', 'integration-tests'],
      forwardedArgs: [],
      cache: false,
    });
    const itCount = commands
      .flatMap((c) => [...targetsOf(c)])
      .filter((a) => a === 'integration-tests').length;
    expect(itCount).toBe(1);
  });

  it('ignores packageDirs for a scoped run', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: ['packages/core'],
      forwardedArgs: [],
      cache: false,
      packageDirs: ['packages/cli', 'packages/agents'],
    });
    expect(commands.flatMap((c) => [...targetsOf(c)])).toEqual([
      'integration-tests',
      'packages/core',
    ]);
  });
});

describe('run-lint runner — argument forwarding', () => {
  it('forwards --max-warnings 0 to the ESLint invocation', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: ['--max-warnings', '0'],
      cache: false,
    });
    expect(commands[0].args).toContain('--max-warnings');
    expect(commands[0].args).toContain('0');
  });

  it('forwards --fix to the ESLint invocation', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: ['--fix'],
      cache: false,
    });
    expect(commands[0].args).toContain('--fix');
  });
});

describe('run-lint runner — cache is opt-in only (A3)', () => {
  it('does NOT add cache flags by default (cache=false)', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
    });
    expect(commands[0].args).not.toContain('--cache');
    expect(commands[0].args).not.toContain('--cache-strategy');
    expect(commands[0].args).not.toContain('--cache-location');
  });

  it('adds --cache --cache-strategy content --cache-location when cache=true', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: true,
    });
    expect(commands[0].args).toContain('--cache');
    expect(commands[0].args).toContain('--cache-strategy');
    expect(commands[0].args).toContain('content');
    expect(commands[0].args).toContain('--cache-location');
    expect(commands[0].args.join(' ')).toContain('node_modules/.cache/eslint');
  });

  it('points every group at the one cache location CI saves and restores', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: true,
      packageDirs: TWO_PACKAGES,
    });
    const locations = commands.map(
      (c) => c.args[c.args.indexOf('--cache-location') + 1],
    );
    expect(locations.length).toBe(3);
    // .github/workflows/ci.yml caches this exact path. Per-group cache files
    // would silently fall outside it, and ESLint merges into an existing
    // cache rather than pruning, so sharing one file is safe.
    expect(locations).toEqual([
      'node_modules/.cache/eslint',
      'node_modules/.cache/eslint',
      'node_modules/.cache/eslint',
    ]);
  });
});

describe('run-lint runner — runner-managed arg stripping', () => {
  it('strips --cache so it is not forwarded (runner owns caching)', async () => {
    const { stripRunnerArgs } = await loadRunner();
    expect(stripRunnerArgs(['--max-warnings', '0', '--cache'])).toEqual([
      '--max-warnings',
      '0',
    ]);
  });

  it('strips --cache-strategy and its value', async () => {
    const { stripRunnerArgs } = await loadRunner();
    expect(
      stripRunnerArgs(['--max-warnings', '0', '--cache-strategy', 'content']),
    ).toEqual(['--max-warnings', '0']);
  });

  it('strips --cache-location and its value', async () => {
    const { stripRunnerArgs } = await loadRunner();
    expect(
      stripRunnerArgs([
        '--max-warnings',
        '0',
        '--cache-location',
        'node_modules/.cache/eslint',
      ]),
    ).toEqual(['--max-warnings', '0']);
  });

  it('strips --targets and its JSON value', async () => {
    const { stripRunnerArgs } = await loadRunner();
    expect(
      stripRunnerArgs([
        '--targets',
        '["packages/core"]',
        '--max-warnings',
        '0',
      ]),
    ).toEqual(['--max-warnings', '0']);
  });

  it('does not consume the next flag when --targets has no value (malformed)', async () => {
    const { stripRunnerArgs } = await loadRunner();
    // --targets followed by another flag must not eat --fix
    expect(
      stripRunnerArgs(['--targets', '--fix', '--max-warnings', '0']),
    ).toEqual(['--fix', '--max-warnings', '0']);
  });

  it('strips --targets alone when it is the last arg (no value)', async () => {
    const { stripRunnerArgs } = await loadRunner();
    expect(stripRunnerArgs(['--max-warnings', '0', '--targets'])).toEqual([
      '--max-warnings',
      '0',
    ]);
  });

  it('does not consume the next flag when a cache value flag has no value', async () => {
    const { stripRunnerArgs } = await loadRunner();
    expect(
      stripRunnerArgs(['--cache-location', '--fix', '--max-warnings', '0']),
    ).toEqual(['--fix', '--max-warnings', '0']);
  });

  it('preserves eslint args like --fix and --max-warnings', async () => {
    const { stripRunnerArgs } = await loadRunner();
    expect(stripRunnerArgs(['--fix', '--max-warnings', '0'])).toEqual([
      '--fix',
      '--max-warnings',
      '0',
    ]);
  });
});

describe('run-lint runner — heap normalization', () => {
  it('normalizes to 6GB (6144) by default', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
    });
    expect(commands[0].nodeOptions).toContain('--max-old-space-size=6144');
  });

  it('does not retain a stale --max-old-space-size from inherited NODE_OPTIONS', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      nodeOptions: '--max-old-space-size=4096 --enable-source-maps',
    });
    // The inherited 4096 must be replaced by the normalized 6144, but
    // unrelated options must survive.
    expect(commands[0].nodeOptions).not.toContain('4096');
    expect(commands[0].nodeOptions).toContain('--max-old-space-size=6144');
    expect(commands[0].nodeOptions).toContain('--enable-source-maps');
  });

  it('removes a space-separated --max-old-space-size and its numeric value', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      nodeOptions: '--max-old-space-size 4096 --enable-source-maps',
    });
    // The space-separated 4096 must be stripped (not left as a stray token)
    // and replaced by the normalized 6144.
    expect(commands[0].nodeOptions).not.toContain('4096');
    expect(commands[0].nodeOptions).toContain('--max-old-space-size=6144');
    expect(commands[0].nodeOptions).toContain('--enable-source-maps');
  });

  it('clamps a non-positive heap to the default so Node.js still starts', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      heapMb: 0,
    });
    expect(commands[0].nodeOptions).toContain('--max-old-space-size=6144');
  });

  it('clamps NaN heap to the default instead of producing --max-old-space-size=NaN', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      heapMb: Number.NaN,
    });
    expect(commands[0].nodeOptions).toContain('--max-old-space-size=6144');
    expect(commands[0].nodeOptions).not.toContain('NaN');
  });

  it('clamps Infinity heap to the default', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      heapMb: Number.POSITIVE_INFINITY,
    });
    expect(commands[0].nodeOptions).toContain('--max-old-space-size=6144');
    expect(commands[0].nodeOptions).not.toContain('Infinity');
  });
});

describe('run-lint runner — lint:ci delegates to the partitioned runner (#3387)', () => {
  it('package.json lint:ci invokes the runner and keeps --max-warnings 0', () => {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
    ) as { readonly scripts: Record<string, string> };
    expect(pkg.scripts['lint:ci']).toContain('bun scripts/run-lint.ts');
    expect(pkg.scripts['lint:ci']).toContain('--max-warnings 0');
  });

  it('package.json lint:ci hardcodes no heap and no monolithic eslint pass', () => {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
    ) as { readonly scripts: Record<string, string> };
    // The runner normalizes NODE_OPTIONS per ESLint child, so lint:ci must
    // not pin a heap itself; 12288 was the retired monolithic invocation's
    // ask, and a bare `eslint .` is exactly the single-process run #3387
    // removed.
    expect(pkg.scripts['lint:ci']).not.toContain('max-old-space-size');
    expect(pkg.scripts['lint:ci']).not.toContain('12288');
    expect(pkg.scripts['lint:ci']).not.toContain('eslint .');
  });

  it('a full run over the real package set is one command per package plus the root slice', async () => {
    const { buildLintCommands, readPackageDirs } = await loadRunner();
    const onDisk = readPackageDirs(REPO_ROOT);
    expect(onDisk.length).toBeGreaterThan(1);
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      packageDirs: onDisk,
    });
    expect(commands.length).toBe(onDisk.length + 1);
    expect(commands.slice(0, -1).map((c) => [...targetsOf(c)])).toEqual(
      onDisk.map((dir) => [dir]),
    );
    const rootSlice = commands[commands.length - 1];
    expect([...targetsOf(rootSlice)]).toEqual(['.']);
    expect(rootSlice.args).toContain('--ignore-pattern');
  });

  it('every command of a full run carries the 6144 heap, never the retired 12288', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      packageDirs: TWO_PACKAGES,
    });
    expect(commands.length).toBeGreaterThan(1);
    for (const command of commands) {
      expect(command.nodeOptions).toContain('--max-old-space-size=6144');
      expect(command.nodeOptions).not.toContain('12288');
    }
  });

  it('forwards --max-warnings 0 to every command of a full run', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: ['--max-warnings', '0'],
      cache: false,
      packageDirs: TWO_PACKAGES,
    });
    expect(commands.length).toBeGreaterThan(1);
    for (const command of commands) {
      const flagIndex = command.args.indexOf('--max-warnings');
      expect(flagIndex).toBeGreaterThan(-1);
      expect(command.args[flagIndex + 1]).toBe('0');
    }
  });
});
