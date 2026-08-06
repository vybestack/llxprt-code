/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2983 — the build serves type resolution and nothing else.
 *
 * Two behaviors are pinned here:
 *
 *  1. The type-resolution build emits declarations and no JavaScript, while
 *     the release build still emits JavaScript. Both are exercised against the
 *     repository's real TypeScript compiler, not a description of it.
 *  2. CI builds only where the output is actually consumed: the test shards no
 *     longer build (except the two legs that run the agents API-surface guard,
 *     which needs a built workspace until issue #2618 repoints those tsconfig
 *     mappings at source), and the type-aware lint job builds declarations
 *     only.
 *
 * Those two legs must run the FULL build. Bun applies tsconfig `paths` at
 * runtime, so a declaration-only `dist` resolves cross-package imports to a
 * `.d.ts` with no JavaScript behind it and every importing test dies. A
 * complete `dist` or no `dist` both work; a partial one does not.
 */

import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DECLARATIONS_ONLY_ENV,
  buildTscArgs,
  isDeclarationsOnly,
  resolveTsconfigName,
} from '../build_package.ts';
import { parseWorkflowYaml } from './typed-test-helpers.ts';
import type { WorkflowJob, WorkflowStep } from './typed-test-helpers.ts';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const TSC_CLI = createRequire(import.meta.url).resolve('typescript/bin/tsc');

function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf-8');
}

function rootPackageScripts(): Record<string, string> {
  const pkg = JSON.parse(readRepoFile('package.json')) as {
    scripts?: Record<string, string>;
  };
  return pkg.scripts ?? {};
}

function jobSteps(job: WorkflowJob | undefined): WorkflowStep[] {
  return job?.steps ?? [];
}

function ciJobs(): Record<string, WorkflowJob> {
  return parseWorkflowYaml(readRepoFile('.github/workflows/ci.yml')).jobs ?? {};
}

/**
 * Builds a self-contained TypeScript project and returns its `dist` contents.
 * Deliberately standalone (it does not extend the repo tsconfig) so the
 * assertion is about the compiler flag, not about repository configuration.
 */
function compileFixture(declarationsOnly: boolean): {
  hasDeclaration: boolean;
  hasJavaScript: boolean;
  stderr: string;
  status: number | null;
} {
  const projectDir = mkdtempSync(join(tmpdir(), 'issue-2983-emit-'));
  try {
    mkdirSync(join(projectDir, 'src'));
    writeFileSync(
      join(projectDir, 'src', 'index.ts'),
      'export const answer: number = 42;\n',
    );
    writeFileSync(
      join(projectDir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'es2022',
            module: 'NodeNext',
            moduleResolution: 'nodenext',
            rootDir: 'src',
            outDir: 'dist',
            declaration: true,
            composite: true,
            strict: true,
            types: [],
          },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      ),
    );

    const result = spawnSync(
      process.execPath,
      [TSC_CLI, ...buildTscArgs('tsconfig.json', declarationsOnly)],
      { cwd: projectDir, encoding: 'utf8', timeout: 120_000 },
    );

    return {
      hasDeclaration: existsSync(join(projectDir, 'dist', 'index.d.ts')),
      hasJavaScript: existsSync(join(projectDir, 'dist', 'index.js')),
      stderr: `${result.stdout ?? ''}${result.stderr ?? ''}`,
      status: result.status,
    };
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

describe('issue #2983 — declaration-only emit', () => {
  it('emits declarations and no JavaScript when declaration-only', () => {
    const result = compileFixture(true);
    expect(result.status, result.stderr).toBe(0);
    expect(result.hasDeclaration).toBe(true);
    expect(result.hasJavaScript).toBe(false);
  }, 180_000);

  it('still emits JavaScript for the default (release) build', () => {
    const result = compileFixture(false);
    expect(result.status, result.stderr).toBe(0);
    expect(result.hasDeclaration).toBe(true);
    expect(result.hasJavaScript).toBe(true);
  }, 180_000);

  it('adds --emitDeclarationOnly only in declaration-only mode', () => {
    expect(buildTscArgs('tsconfig.json', true)).toEqual([
      '--build',
      '--emitDeclarationOnly',
      'tsconfig.json',
    ]);
    expect(buildTscArgs('tsconfig.json', false)).toEqual([
      '--build',
      'tsconfig.json',
    ]);
  });

  it('enables declaration-only emit only for the exact opt-in value', () => {
    expect(isDeclarationsOnly({})).toBe(false);
    expect(isDeclarationsOnly({ [DECLARATIONS_ONLY_ENV]: '' })).toBe(false);
    expect(isDeclarationsOnly({ [DECLARATIONS_ONLY_ENV]: '0' })).toBe(false);
    expect(isDeclarationsOnly({ [DECLARATIONS_ONLY_ENV]: 'true' })).toBe(false);
    expect(isDeclarationsOnly({ [DECLARATIONS_ONLY_ENV]: '1' })).toBe(true);
  });

  it('prefers an explicit build tsconfig over the default one', () => {
    expect(resolveTsconfigName(true)).toBe('tsconfig.build.json');
    expect(resolveTsconfigName(false)).toBe('tsconfig.json');
  });
});

describe('issue #2983 — build scripts', () => {
  it('exposes build:types as the declaration-only variant of build', () => {
    const scripts = rootPackageScripts();
    expect(scripts['build:types']).toContain(`${DECLARATIONS_ONLY_ENV}=1`);
    expect(scripts['build:types']).toContain('npm run build');
  });

  it('leaves the release build on full JavaScript emit', () => {
    const scripts = rootPackageScripts();
    expect(scripts['build']).not.toContain(DECLARATIONS_ONLY_ENV);
    expect(scripts['build:packages']).not.toContain(DECLARATIONS_ONLY_ENV);
    expect(readRepoFile('.github/workflows/release.yml')).toContain(
      'npm run build:packages',
    );
  });

  it('keeps the publish-time CLI bundle out of the declaration build', () => {
    // The bundle (issues #2999/#3013) is produced by the CLI package prepack
    // through scripts/bun-build.config.ts. Coupling it to build_package.ts
    // would put a publish artifact on the PR path and expose it to
    // `tsc --build --clean`.
    expect(readRepoFile('scripts/build_package.ts')).not.toContain(
      'bun-build.config',
    );
    expect(readRepoFile('scripts/copy_files.ts')).not.toContain(
      'bun-build.config',
    );
    const cliPkg = JSON.parse(readRepoFile('packages/cli/package.json')) as {
      scripts?: Record<string, string>;
    };
    expect(cliPkg.scripts?.['prepack']).toContain('bun-build.config.ts');
    expect(cliPkg.scripts?.['build']).not.toContain('bun-build.config.ts');
  });
});

describe('issue #2983 — chmod_executable declaration-only contract', () => {
  const script = join(REPO_ROOT, 'scripts', 'chmod_executable.ts');
  const isWindows = process.platform === 'win32';

  function runChmod(
    target: string,
    declarationsOnly: boolean,
  ): { status: number | null; stderr: string } {
    const env = { ...process.env };
    if (declarationsOnly) {
      env[DECLARATIONS_ONLY_ENV] = '1';
    } else {
      delete env[DECLARATIONS_ONLY_ENV];
    }
    const result = spawnSync(process.execPath, [script, target], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
      timeout: 60_000,
    });
    return { status: result.status, stderr: result.stderr ?? '' };
  }

  it.skipIf(isWindows)(
    'treats a missing target as a no-op in declaration-only mode',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'issue-2983-chmod-'));
      try {
        expect(runChmod(join(dir, 'absent.js'), true).status).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(isWindows)(
    'still fails on a missing target in a full build',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'issue-2983-chmod-'));
      try {
        expect(runChmod(join(dir, 'absent.js'), false).status).not.toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(isWindows)('marks an existing target executable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'issue-2983-chmod-'));
    const target = join(dir, 'present.js');
    try {
      writeFileSync(target, 'console.log(1);\n', { mode: 0o644 });
      expect(runChmod(target, false).status).toBe(0);
      expect(statSync(target).mode & 0o777).toBe(0o755);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('issue #2983 — CI keeps the build off the test path', () => {
  const GUARD_SHARDS = ['agents', 'scripts'] as const;

  it('keeps at most one build step in the test shards', () => {
    const buildSteps = jobSteps(ciJobs()['test_shard']).filter((step) =>
      String(step.run ?? '').includes('npm run build'),
    );
    expect(buildSteps).toHaveLength(1);
  });

  it('restricts the shard build to the guard-running legs', () => {
    const buildSteps = jobSteps(ciJobs()['test_shard']).filter((step) =>
      String(step.run ?? '').includes('npm run build'),
    );
    const condition = String(buildSteps[0].if ?? '');
    for (const shard of GUARD_SHARDS) {
      expect(condition).toContain(`matrix.shard == '${shard}'`);
    }
  });

  it('never leaves a shard with a declaration-only workspace', () => {
    // Bun applies tsconfig `paths` at runtime, so a partially built `dist`
    // resolves cross-package imports to a `.d.ts` with no JavaScript behind
    // it. Shards need a complete `dist` or none at all.
    const buildSteps = jobSteps(ciJobs()['test_shard']).filter((step) =>
      String(step.run ?? '').includes('npm run build'),
    );
    for (const step of buildSteps) {
      expect(String(step.run)).not.toContain('npm run build:types');
    }
  });

  it('drops the redundant per-shard agents API-surface guard step', () => {
    const guardSteps = jobSteps(ciJobs()['test_shard']).filter((step) =>
      String(step.run ?? '').includes('lint:agents-api-surface'),
    );
    expect(guardSteps).toEqual([]);
  });

  it('builds declarations before the type-aware lint', () => {
    const lintSteps = jobSteps(ciJobs()['lint_javascript']);
    const buildIndex = lintSteps.findIndex((step) =>
      String(step.run ?? '').includes('npm run build:types'),
    );
    const guardIndex = lintSteps.findIndex((step) =>
      String(step.run ?? '').includes('lint:agents-api-surface'),
    );
    expect(buildIndex).toBeGreaterThanOrEqual(0);
    expect(guardIndex).toBeGreaterThan(buildIndex);
    expect(
      lintSteps.filter(
        (step) =>
          String(step.run ?? '').includes('npm run build') &&
          !String(step.run).includes('npm run build:types'),
      ),
    ).toEqual([]);
  });

  it('names the real declaration dependents in the lint build comment', () => {
    const ci = readRepoFile('.github/workflows/ci.yml');
    const comment = ci.slice(
      ci.indexOf('# Build must run BEFORE the type-aware lint'),
      ci.indexOf("- name: 'Build declarations for type-aware lint'"),
    );
    expect(comment).toContain('cli -> tools');
    expect(comment).toContain('core -> mcp');
    expect(comment).toContain('a2a-server -> settings/storage/tools');
  });
});
