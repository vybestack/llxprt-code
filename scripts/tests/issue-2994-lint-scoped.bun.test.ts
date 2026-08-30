/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the scoped-lint CLI (issue #2994).
 *
 * Everything here is behavioral: real exported functions called with real
 * argv, real composition through the REAL runner's `resolveTargets`,
 * `stripRunnerArgs` and `buildLintCommands`, real child processes in real
 * hermetic temporary git repositories, and the real failure classifier. No
 * stubbing of git, ESLint, or the runner.
 *
 * Runs under Bun's native runner (see scripts/bun-test-roots.ts); vitest
 * skips `*.bun.test.ts` files.
 */

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  buildRunnerArgs,
  buildRunnerEnv,
  formatFullRunPlan,
  formatScopedPlan,
  parseScopedArgs,
  UsageError,
  type ScopedLintOptions,
} from '../lint-scoped.ts';
import {
  buildLintCommands,
  classifyRunnerFailure,
  resolveTargets,
  stripRunnerArgs,
} from '../run-lint.ts';
import {
  createTempRepo,
  runGit,
  runScoped,
  TempDirRegistry,
  writeFile,
} from './issue-2994-lint-scoped-helpers.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');
const PACKAGE_JSON_PATH = join(ROOT, 'package.json');
const LINTING_DOC_PATH = join(ROOT, 'dev-docs', 'LINTING.md');

/** Asserts that fn throws a UsageError and returns it. */
function expectUsageError(fn: () => unknown): UsageError {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(UsageError);
  if (!(thrown instanceof UsageError)) {
    throw new Error('expected UsageError');
  }
  return thrown;
}

/**
 * Runs fn with process.env[name] temporarily set (value) or deleted
 * (undefined), restoring the prior value afterwards. Used so the real
 * `resolveTargets`/`buildRunnerEnv` observe a controlled environment.
 */
function withEnv(
  name: string,
  value: string | undefined,
  fn: () => void,
): void {
  const saved = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  try {
    fn();
  } finally {
    if (saved === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = saved;
    }
  }
}

/** Parses the `lint-scoped: scoped run — targets: a, b` line into [a, b]. */
function extractScopedTargets(stdout: string): readonly string[] {
  const prefix = 'lint-scoped: scoped run — targets: ';
  const line = stdout.split('\n').find((l) => l.startsWith(prefix));
  if (line === undefined) {
    throw new Error(`no scoped-run plan line in stdout:\n${stdout}`);
  }
  return line.slice(prefix.length).split(', ');
}

// ===========================================================================
// a. parseScopedArgs — every boundary row in the plan's table
// ===========================================================================

describe('issue-2994 parseScopedArgs', () => {
  it('accepts a single explicit target', () => {
    expect(parseScopedArgs(['packages/cli'])).toEqual<ScopedLintOptions>({
      changed: false,
      base: null,
      fix: false,
      cache: false,
      dryRun: false,
      help: false,
      targets: ['packages/cli'],
    });
  });

  it('normalizes trailing slashes on multiple targets', () => {
    const opts = parseScopedArgs(['packages/cli/', 'packages/core/']);
    expect(opts.targets).toEqual(['packages/cli', 'packages/core']);
  });

  it('normalizes trailing backslashes (Windows-style input)', () => {
    const opts = parseScopedArgs(['packages/cli\\']);
    expect(opts.targets).toEqual(['packages/cli']);
  });

  it('forwards --fix', () => {
    expect(parseScopedArgs(['packages/cli', '--fix']).fix).toBe(true);
  });

  it('forwards --cache', () => {
    expect(parseScopedArgs(['packages/cli', '--cache']).cache).toBe(true);
  });

  it('forwards --dry-run', () => {
    expect(parseScopedArgs(['packages/cli', '--dry-run']).dryRun).toBe(true);
  });

  it('accepts --changed with --base', () => {
    const opts = parseScopedArgs(['--changed', '--base', 'main']);
    expect(opts.changed).toBe(true);
    expect(opts.base).toBe('main');
  });

  it('returns help=true for --help, short-circuiting validation', () => {
    expect(parseScopedArgs(['--help']).help).toBe(true);
    expect(parseScopedArgs(['-h']).help).toBe(true);
  });

  it('throws UsageError with no args (neither --changed nor a target)', () => {
    expectUsageError(() => parseScopedArgs([]));
  });

  it('throws UsageError for an unknown flag', () => {
    const err = expectUsageError(() => parseScopedArgs(['--bogus']));
    expect(err.message).toContain('--bogus');
  });

  it('throws UsageError when --changed is combined with explicit targets', () => {
    expectUsageError(() => parseScopedArgs(['--changed', 'packages/cli']));
  });

  it('throws UsageError for --base without --changed', () => {
    expectUsageError(() => parseScopedArgs(['--base', 'main']));
  });

  it('throws UsageError for --base with a missing value', () => {
    expectUsageError(() => parseScopedArgs(['--changed', '--base']));
  });

  it('throws UsageError for --base with a flag-looking value', () => {
    expectUsageError(() => parseScopedArgs(['--changed', '--base', '--fix']));
  });

  it('throws UsageError for a target that is empty after normalization', () => {
    expectUsageError(() => parseScopedArgs(['/']));
  });
});

// ===========================================================================
// b. resolveTargets + env precedence (FINDING 4 + BLOCKER 1)
// ===========================================================================

describe('issue-2994 resolveTargets (real runner resolver, env precedence)', () => {
  // resolveTargets reads process.env; keep this suite free of an inherited
  // LLXPRT_LINT_TARGETS so the baseline cases are deterministic.
  beforeEach(() => withEnv('LLXPRT_LINT_TARGETS', undefined, () => undefined));

  it('parses --targets <json> into a string array', () => {
    expect(resolveTargets(['--targets', '["packages/cli"]'])).toEqual([
      'packages/cli',
    ]);
  });

  it('returns null (full run) when neither --targets nor the env var is set', () => {
    expect(resolveTargets(['--fix'])).toBeNull();
  });

  it('--targets on the argv takes precedence over LLXPRT_LINT_TARGETS', () => {
    withEnv('LLXPRT_LINT_TARGETS', '["packages/storage"]', () => {
      expect(resolveTargets(['--targets', '["packages/cli"]'])).toEqual([
        'packages/cli',
      ]);
    });
  });

  it('falls back to LLXPRT_LINT_TARGETS when --targets is absent', () => {
    withEnv('LLXPRT_LINT_TARGETS', '["packages/storage"]', () => {
      expect(resolveTargets(['--fix'])).toEqual(['packages/storage']);
    });
  });

  it('returns null for a malformed --targets value', () => {
    expect(resolveTargets(['--targets', 'not-json'])).toBeNull();
  });

  it('returns null for an empty --targets array', () => {
    expect(resolveTargets(['--targets', '[]'])).toBeNull();
  });
});

// ===========================================================================
// c. Runner-argv composition — buildRunnerArgs → REAL resolveTargets
//    → REAL stripRunnerArgs → REAL buildLintCommands (FINDING 4)
// ===========================================================================

describe('issue-2994 runner-argv composition (real resolveTargets + stripRunnerArgs + buildLintCommands)', () => {
  // The full pipeline the wrapper hands to the runner: build the argv,
  // resolve targets the way the runner does, strip runner-managed flags, then
  // build the concrete ESLint command. Asserts the EXACT argument array.
  /**
   * Issue #3387 partitions a scoped run into one ESLint process per target,
   * so this returns the argv of every command rather than just the first.
   */
  function composeAll(
    targets: readonly string[] | null,
    fix: boolean,
    cache: boolean,
  ): ReadonlyArray<readonly string[]> {
    const argv = buildRunnerArgs({ targets, fix, cache });
    const resolved = resolveTargets(argv);
    const forwardedArgs = stripRunnerArgs(argv);
    const commands = buildLintCommands({
      targets: resolved,
      forwardedArgs,
      cache,
    });
    return commands.map((command) => command.args);
  }

  function compose(
    targets: readonly string[] | null,
    fix: boolean,
    cache: boolean,
  ): readonly string[] {
    return composeAll(targets, fix, cache)[0];
  }

  beforeEach(() => withEnv('LLXPRT_LINT_TARGETS', undefined, () => undefined));

  it('a scoped plan yields one command each for integration-tests and packages/cli', () => {
    expect(composeAll(['packages/cli'], false, false)).toEqual([
      ['integration-tests'],
      ['packages/cli'],
    ]);
  });

  it('a scoped plan with --fix forwards --fix to every target command', () => {
    expect(composeAll(['packages/core'], true, false)).toEqual([
      ['integration-tests', '--fix'],
      ['packages/core', '--fix'],
    ]);
  });

  it('a scoped plan with --cache gives every target command the shared cache flags', () => {
    const cacheFlags = [
      '--cache',
      '--cache-strategy',
      'content',
      '--cache-location',
      'node_modules/.cache/eslint',
    ];
    expect(composeAll(['packages/core'], false, true)).toEqual([
      ['integration-tests', ...cacheFlags],
      ['packages/core', ...cacheFlags],
    ]);
  });

  it('a full plan (null targets) yields exactly the root "."', () => {
    expect(compose(null, false, false)).toEqual(['.']);
  });

  it('does not add --max-warnings 0 to a scoped run', () => {
    expect(compose(['packages/core'], false, false)).not.toContain(
      '--max-warnings',
    );
  });

  it('a full plan survives an inherited LLXPRT_LINT_TARGETS once the env is stripped (BLOCKER 1)', () => {
    // The wrapper's buildRunnerEnv() deletes LLXPRT_LINT_TARGETS before
    // spawning; with it deleted, a null-targets (full) plan resolves to a
    // full run rather than the inherited subset.
    withEnv('LLXPRT_LINT_TARGETS', '["packages/agents"]', () => {
      // Proof of the hazard: without stripping, the env scopes a no-targets
      // argv down to the inherited subset.
      expect(
        resolveTargets(
          buildRunnerArgs({ targets: null, fix: false, cache: false }),
        ),
      ).toEqual(['packages/agents']);
      // With stripping applied (what the runner observes), the full plan holds.
      withEnv('LLXPRT_LINT_TARGETS', undefined, () => {
        expect(compose(null, false, false)).toEqual(['.']);
      });
    });
  });
});

// ===========================================================================
// d. buildRunnerEnv — BLOCKER 1: the wrapper owns targets (env stripped)
// ===========================================================================

describe('issue-2994 buildRunnerEnv (BLOCKER 1)', () => {
  it('deletes LLXPRT_LINT_TARGETS so a fail-closed full run cannot be scoped', () => {
    withEnv('LLXPRT_LINT_TARGETS', '["packages/agents"]', () => {
      const env = buildRunnerEnv();
      expect(env['LLXPRT_LINT_TARGETS']).toBeUndefined();
    });
  });

  it('preserves LLXPRT_LINT_CACHE (the intentional, documented opt-in)', () => {
    withEnv('LLXPRT_LINT_CACHE', 'true', () => {
      const env = buildRunnerEnv();
      expect(env['LLXPRT_LINT_CACHE']).toBe('true');
    });
  });

  it('leaves unrelated environment variables intact', () => {
    withEnv('LLXPRT_LINT_TARGETS', '["packages/agents"]', () => {
      const env = buildRunnerEnv();
      expect(env['LLXPRT_LINT_TARGETS']).toBeUndefined();
      expect('PATH' in env).toBe(true);
    });
  });
});

// ===========================================================================
// e. Changed-files mode — real child processes in hermetic temp git repos
//    (FINDING 5 + FINDING 6 + BLOCKER 2 + BLOCKER 3)
// ===========================================================================

describe('issue-2994 changed-files mode (real hermetic temporary git repos)', () => {
  const tempDirs = new TempDirRegistry();

  afterAll(() => tempDirs.cleanupAll());

  it('scoped run for a package-source change with the EXACT resolved target list (owner + reverse closure + integration-tests)', () => {
    const repo = createTempRepo(tempDirs);
    writeFile(
      repo,
      'packages/core/src/existing.ts',
      'export const value = 2;\n',
    );
    const result = runScoped(repo, [
      '--changed',
      '--base',
      'main',
      '--dry-run',
    ]);
    expect(result.status).toBe(0);
    // reverseClosure('core') = {a2a-server, agents, cli, providers, zed-acp}
    expect(extractScopedTargets(result.stdout)).toEqual([
      'integration-tests',
      'packages/a2a-server',
      'packages/agents',
      'packages/cli',
      'packages/core',
      'packages/providers',
      'packages/zed-acp',
    ]);
  }, 120_000);

  it('full run with the selector fail-closed reason for a scripts/ change', () => {
    const repo = createTempRepo(tempDirs);
    writeFile(repo, 'scripts/harness.ts', 'export {};\n');
    const result = runScoped(repo, [
      '--changed',
      '--base',
      'main',
      '--dry-run',
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('lint-scoped: full run —');
    expect(result.stdout).toContain('scripts');
  }, 120_000);

  it('prints "nothing to lint" and exits 0 with no changes', () => {
    const repo = createTempRepo(tempDirs);
    const result = runScoped(repo, [
      '--changed',
      '--base',
      'main',
      '--dry-run',
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('nothing to lint');
  }, 120_000);

  it('includes a committed-only change on a branch ahead of the base', () => {
    const repo = createTempRepo(tempDirs);
    runGit(repo, ['checkout', '-b', 'feature']);
    writeFile(
      repo,
      'packages/core/src/existing.ts',
      'export const value = 9;\n',
    );
    runGit(repo, ['add', '-A']);
    runGit(repo, ['commit', '--quiet', '-m', 'change']);
    const result = runScoped(repo, [
      '--changed',
      '--base',
      'main',
      '--dry-run',
    ]);
    expect(result.status).toBe(0);
    expect(extractScopedTargets(result.stdout)).toContain('packages/core');
  }, 120_000);

  it('includes a staged (git add, uncommitted) new file under a package', () => {
    const repo = createTempRepo(tempDirs);
    writeFile(repo, 'packages/storage/src/new.ts', 'export const n = 1;\n');
    runGit(repo, ['add', '-A']);
    const result = runScoped(repo, [
      '--changed',
      '--base',
      'main',
      '--dry-run',
    ]);
    expect(result.status).toBe(0);
    expect(extractScopedTargets(result.stdout)).toContain('packages/storage');
  }, 120_000);

  it('classifies a tracked file deletion by its (now absent) package path', () => {
    const repo = createTempRepo(tempDirs);
    runGit(repo, ['rm', 'packages/core/src/existing.ts']);
    const result = runScoped(repo, [
      '--changed',
      '--base',
      'main',
      '--dry-run',
    ]);
    expect(result.status).toBe(0);
    expect(extractScopedTargets(result.stdout)).toContain('packages/core');
  }, 120_000);

  it('classifies a cross-scope rename (package -> docs) by BOTH endpoints (BLOCKER 2)', () => {
    const repo = createTempRepo(tempDirs);
    mkdirSync(join(repo, 'docs'), { recursive: true });
    runGit(repo, ['mv', 'packages/core/src/existing.ts', 'docs/moved.md']);
    runGit(repo, ['add', '-A']);
    const result = runScoped(repo, [
      '--changed',
      '--base',
      'main',
      '--dry-run',
    ]);
    expect(result.status).toBe(0);
    // With --no-renames, the deleted source path packages/core/src/existing.ts
    // is reported, so packages/core (owner + closure) is selected. Without
    // --no-renames only docs/moved.md would be seen (no package target).
    expect(extractScopedTargets(result.stdout)).toContain('packages/core');
  }, 120_000);

  it('classifies a package -> package rename by BOTH owners (BLOCKER 2)', () => {
    const repo = createTempRepo(tempDirs);
    mkdirSync(join(repo, 'packages', 'storage', 'src'), { recursive: true });
    runGit(repo, [
      'mv',
      'packages/core/src/existing.ts',
      'packages/storage/src/existing.ts',
    ]);
    runGit(repo, ['add', '-A']);
    const result = runScoped(repo, [
      '--changed',
      '--base',
      'main',
      '--dry-run',
    ]);
    expect(result.status).toBe(0);
    const targets = extractScopedTargets(result.stdout);
    expect(targets).toContain('packages/core');
    expect(targets).toContain('packages/storage');
  }, 120_000);

  it('does NOT select an untracked file ignored by .gitignore', () => {
    const repo = createTempRepo(tempDirs);
    writeFile(repo, '.gitignore', 'ignored.ts\n');
    runGit(repo, ['add', '-A']);
    runGit(repo, ['commit', '--quiet', '-m', 'add gitignore']);
    writeFile(repo, 'ignored.ts', 'export const ignored = true;\n');
    const result = runScoped(repo, [
      '--changed',
      '--base',
      'main',
      '--dry-run',
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('nothing to lint');
  }, 120_000);

  it('a leading-space filename is preserved and fails closed to a full run (BLOCKER 3)', () => {
    const repo = createTempRepo(tempDirs);
    // A path with a leading space. Without NUL-delimited output + no-trim, the
    // leading space is stripped and the path is misclassified.
    writeFile(repo, ' packages/core/src/x.ts', 'export const x = 1;\n');
    const result = runScoped(repo, [
      '--changed',
      '--base',
      'main',
      '--dry-run',
    ]);
    expect(result.status).toBe(0);
    // The literal " packages/..." is an unknown path → fail closed to full run.
    expect(result.stdout).toContain('lint-scoped: full run —');
    expect(result.stdout).toContain('unknown path');
  }, 120_000);

  it('automatic base resolution falls back to local main when origin/main is absent', () => {
    const repo = createTempRepo(tempDirs);
    writeFile(
      repo,
      'packages/core/src/existing.ts',
      'export const value = 3;\n',
    );
    // No --base, no origin/main -> resolveBaseRef probes origin/main (fails)
    // then main (succeeds).
    const result = runScoped(repo, ['--changed', '--dry-run']);
    expect(result.status).toBe(0);
    expect(extractScopedTargets(result.stdout)).toContain('packages/core');
  }, 120_000);

  it('automatic base resolution with no resolvable candidate exits 2', () => {
    const repo = createTempRepo(tempDirs);
    runGit(repo, ['checkout', '-b', 'feature']);
    runGit(repo, ['branch', '-D', 'main']);
    writeFile(
      repo,
      'packages/core/src/existing.ts',
      'export const value = 4;\n',
    );
    const result = runScoped(repo, ['--changed', '--dry-run']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('base ref');
  }, 120_000);

  it('a merge-base failure (orphan branch) exits 2 with a clear message', () => {
    const repo = createTempRepo(tempDirs);
    runGit(repo, ['checkout', '--orphan', 'orphan']);
    runGit(repo, ['rm', '-rf', '.']);
    writeFile(repo, 'README.md', '# orphan\n');
    runGit(repo, ['add', '-A']);
    runGit(repo, ['commit', '--quiet', '-m', 'orphan']);
    runGit(repo, ['checkout', 'main']);
    const result = runScoped(repo, [
      '--changed',
      '--base',
      'orphan',
      '--dry-run',
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('merge-base');
  }, 120_000);

  it('exits 2 with a ref-naming message for a nonexistent --base', () => {
    const repo = createTempRepo(tempDirs);
    const result = runScoped(repo, [
      '--changed',
      '--base',
      'does-not-exist',
      '--dry-run',
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('does-not-exist');
  }, 120_000);

  it('BLOCKER 1: a scripts/-change full plan holds with LLXPRT_LINT_TARGETS set in the child env', () => {
    const repo = createTempRepo(tempDirs);
    writeFile(repo, 'scripts/harness.ts', 'export {};\n');
    const result = runScoped(
      repo,
      ['--changed', '--base', 'main', '--dry-run'],
      { ...process.env, LLXPRT_LINT_TARGETS: '["packages/agents"]' },
    );
    expect(result.status).toBe(0);
    // The wrapper's plan is unaffected by the inherited env: still a full run.
    expect(result.stdout).toContain('lint-scoped: full run —');
    expect(result.stdout).toContain('scripts');
  }, 120_000);

  it('BLOCKER 1: a scoped plan uses only the wrapper targets with LLXPRT_LINT_TARGETS set', () => {
    const repo = createTempRepo(tempDirs);
    // lsp is a leaf (nothing imports it), so its closure excludes agents.
    writeFile(repo, 'packages/lsp/src/new.ts', 'export const n = 1;\n');
    const result = runScoped(
      repo,
      ['--changed', '--base', 'main', '--dry-run'],
      { ...process.env, LLXPRT_LINT_TARGETS: '["packages/agents"]' },
    );
    expect(result.status).toBe(0);
    const targets = extractScopedTargets(result.stdout);
    expect(targets).toContain('packages/lsp');
    expect(targets).not.toContain('packages/agents');
  }, 120_000);

  it('dry-run prints the resolved argv as an honest JSON vector (FINDING 9)', () => {
    const repo = createTempRepo(tempDirs);
    writeFile(repo, 'scripts/harness.ts', 'export {};\n');
    const result = runScoped(repo, [
      '--changed',
      '--base',
      'main',
      '--dry-run',
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('lint-scoped: dry-run — runner argv: [');
    // The argv must name the real executable, not a hardcoded "bun". It is
    // printed inside a JSON vector, so on Windows the separators arrive
    // escaped and the raw execPath never matches. Compare against the JSON
    // encoding of the path (quotes stripped), which is a no-op on POSIX.
    const encodedExecPath = JSON.stringify(process.execPath).slice(1, -1);
    expect(result.stdout).toContain(encodedExecPath);
  }, 120_000);
});

// ===========================================================================
// f. Process-level usage failures (FINDING 5)
// ===========================================================================

describe('issue-2994 process-level usage failures', () => {
  const tempDirs = new TempDirRegistry();
  afterAll(() => tempDirs.cleanupAll());

  it('no args exits 2 with usage text on stderr', () => {
    const repo = createTempRepo(tempDirs);
    const result = runScoped(repo, []);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage:');
  }, 120_000);

  it('an unknown flag exits 2 with usage text on stderr', () => {
    const repo = createTempRepo(tempDirs);
    const result = runScoped(repo, ['--bogus']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage:');
    expect(result.stderr).toContain('--bogus');
  }, 120_000);
});

// ===========================================================================
// g. classifyRunnerFailure — real error shapes
// ===========================================================================

describe('issue-2994 classifyRunnerFailure (loud interruption)', () => {
  it('returns the numeric exitCode with no message for an ordinary lint failure', () => {
    expect(classifyRunnerFailure({ exitCode: 1 })).toEqual({
      exitCode: 1,
    });
  });

  it('maps SIGKILL to exit 137 with an out-of-memory diagnostic', () => {
    const failure = classifyRunnerFailure({ signalCode: 'SIGKILL' });
    expect(failure.exitCode).toBe(137);
    expect(failure.message).toContain('SIGKILL');
    expect(failure.message).toContain('out-of-memory');
    expect(failure.message).toContain('interruption');
  });

  it('maps SIGTERM to exit 143 with an interruption message', () => {
    const failure = classifyRunnerFailure({ signalCode: 'SIGTERM' });
    expect(failure.exitCode).toBe(143);
    expect(failure.message).toContain('interruption');
  });

  it('falls back to exit 1 with the underlying message for a generic error', () => {
    const failure = classifyRunnerFailure(new Error('boom'));
    expect(failure.exitCode).toBe(1);
    expect(failure.message).toContain('boom');
  });
});

// ===========================================================================
// h. Wiring — package.json and dev-docs/LINTING.md
// ===========================================================================

describe('issue-2994 wiring', () => {
  it('package.json defines lint:scoped and lint:changed invoking lint-scoped.ts', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as {
      readonly scripts: Record<string, string>;
    };
    expect(pkg.scripts['lint:scoped']).toContain('bun scripts/lint-scoped.ts');
    expect(pkg.scripts['lint:changed']).toContain('bun scripts/lint-scoped.ts');
    expect(pkg.scripts['lint:changed']).toContain('--changed');
  });

  it('dev-docs/LINTING.md documents both commands, the 12 GB heap, and accurate fail-closed inputs (FINDING 8)', () => {
    const doc = readFileSync(LINTING_DOC_PATH, 'utf8');
    expect(doc).toContain('lint:scoped');
    expect(doc).toContain('lint:changed');
    expect(doc).toContain('12288');
    // The real shared-input list (from affected-test-shards.data.json).
    expect(doc).toContain('scripts/postinstall.cjs');
    expect(doc).toContain('.bun-version');
    // eslint.config.js is correctly described as an unknown-path fail-closed,
    // not a shared input.
    expect(doc).toContain('eslint.config.js');
    expect(doc).toContain('unknown-path');
  });

  it('formatScopedPlan and formatFullRunPlan produce the loud plan lines', () => {
    expect(formatScopedPlan(['packages/cli', 'integration-tests'])).toBe(
      'lint-scoped: scoped run — targets: packages/cli, integration-tests',
    );
    expect(formatFullRunPlan('scripts harness change')).toBe(
      'lint-scoped: full run — scripts harness change',
    );
  });
});
