/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the affected-lint-targets selector (issue #2710).
 *
 * These tests exercise the REAL selector (`scripts/affected-lint-targets.ts`)
 * and the REAL checked-in graph (`scripts/affected-test-shards.data.json`).
 * No mock theater: the selector is imported and invoked with real path lists.
 *
 * The type-aware soundness test creates a real two-package fixture, selects
 * targets through the real selector + a fixture graph, and runs the real
 * ESLint binary to prove a Promise<void> API change is caught in an untouched
 * dependent package (A5).
 */

import { describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SELECTOR_PATH = join(REPO_ROOT, 'scripts', 'affected-lint-targets.ts');
const DATA_PATH = join(REPO_ROOT, 'scripts', 'affected-test-shards.data.json');
const ESLINT_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'eslint');

interface LintPathReason {
  readonly path: string;
  readonly reason: string;
  readonly targets: readonly string[];
}

interface LintTargetSelection {
  readonly targets: readonly string[];
  readonly fullRun: boolean;
  readonly fullRunReason: string | null;
  readonly pathReasons: readonly LintPathReason[];
}

interface SelectorModule {
  selectLintTargets: (params: {
    readonly event: string;
    readonly changedPaths: readonly string[];
    readonly dataPath?: string;
  }) => LintTargetSelection;
}

async function loadSelector(): Promise<SelectorModule> {
  return await import(SELECTOR_PATH);
}

const PR_EVENT = 'pull_request';

describe('affected-lint-targets selector — package closure', () => {
  it('selects owner + reverse closure for a core production change', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: PR_EVENT,
      changedPaths: ['packages/core/src/config/configConstructor.ts'],
    });
    expect(result.fullRun).toBe(false);
    expect(result.targets).toContain('packages/core');
    // core is imported by agents, cli, providers, and a2a-server
    expect(result.targets).toContain('packages/agents');
    expect(result.targets).toContain('packages/cli');
    expect(result.targets).toContain('packages/providers');
    expect(result.targets).toContain('packages/a2a-server');
    // integration-tests is always an explicit scoped target
    expect(result.targets).toContain('integration-tests');
  });

  it('selects owner + reverse closure for a storage production change', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: PR_EVENT,
      changedPaths: ['packages/storage/src/index.ts'],
    });
    expect(result.fullRun).toBe(false);
    expect(result.targets).toContain('packages/storage');
    expect(result.targets).toContain('packages/cli');
    expect(result.targets).toContain('packages/core');
  });

  it('selects only the owner for a cli production change (cli is a leaf)', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: PR_EVENT,
      changedPaths: ['packages/cli/src/commands/chat.ts'],
    });
    expect(result.fullRun).toBe(false);
    expect(result.targets).toContain('packages/cli');
    expect(result.targets).toContain('integration-tests');
  });

  it('selects dependents when telemetry production changes', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: PR_EVENT,
      changedPaths: ['packages/telemetry/src/telemetry/sdk.ts'],
    });
    expect(result.fullRun).toBe(false);
    expect(result.targets).toContain('packages/telemetry');
    // providers imports telemetry
    expect(result.targets).toContain('packages/providers');
  });
});

describe('affected-lint-targets selector — package-local test changes', () => {
  it('selects only the owner package dir for a package-local test change', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: PR_EVENT,
      changedPaths: ['packages/providers/src/BaseProvider.test.ts'],
    });
    expect(result.fullRun).toBe(false);
    expect(result.targets).toEqual(['integration-tests', 'packages/providers']);
  });

  it('selects only the owner package dir for a core test change', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: PR_EVENT,
      changedPaths: ['packages/core/src/__tests__/config.test.ts'],
    });
    expect(result.fullRun).toBe(false);
    expect(result.targets).toEqual(['integration-tests', 'packages/core']);
  });
});

describe('affected-lint-targets selector — docs and metadata', () => {
  it('selects only integration-tests for a docs-only change', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: PR_EVENT,
      changedPaths: ['docs/getting-started.md'],
    });
    expect(result.fullRun).toBe(false);
    expect(result.targets).toEqual(['integration-tests']);
  });

  it('selects only integration-tests for a README change', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: PR_EVENT,
      changedPaths: ['README.md'],
    });
    expect(result.targets).toEqual(['integration-tests']);
  });

  it('selects only integration-tests for a project-plan change', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: PR_EVENT,
      changedPaths: ['project-plans/some-plan.md'],
    });
    expect(result.targets).toEqual(['integration-tests']);
  });
});

describe('affected-lint-targets selector — fail closed to full', () => {
  it('selects full (.) for a shared package.json change', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: PR_EVENT,
      changedPaths: ['package.json'],
    });
    expect(result.fullRun).toBe(true);
    expect(result.targets).toEqual(['.']);
    expect(result.fullRunReason).toBeTruthy();
  });

  it('selects full (.) for a tsconfig.json change', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: PR_EVENT,
      changedPaths: ['tsconfig.json'],
    });
    expect(result.fullRun).toBe(true);
    expect(result.targets).toEqual(['.']);
  });

  it('selects full (.) for a bun.lock change', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: PR_EVENT,
      changedPaths: ['bun.lock'],
    });
    expect(result.fullRun).toBe(true);
    expect(result.targets).toEqual(['.']);
  });

  it('selects full (.) for an eslint.config.js change', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: PR_EVENT,
      changedPaths: ['eslint.config.js'],
    });
    expect(result.fullRun).toBe(true);
    expect(result.targets).toEqual(['.']);
  });

  it('selects full (.) for an integration-tests path', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: PR_EVENT,
      changedPaths: ['integration-tests/file-system.test.ts'],
    });
    expect(result.fullRun).toBe(true);
    expect(result.targets).toEqual(['.']);
    expect(result.fullRunReason).toContain('integration-tests');
  });

  it('selects full (.) for an unknown path', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: PR_EVENT,
      changedPaths: ['some/random/unknown/file.xyz'],
    });
    expect(result.fullRun).toBe(true);
    expect(result.targets).toEqual(['.']);
  });

  it('selects full (.) for an empty changed-paths list in a PR', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: PR_EVENT,
      changedPaths: [],
    });
    expect(result.fullRun).toBe(true);
    expect(result.targets).toEqual(['.']);
  });
});

describe('affected-lint-targets selector — non-PR events', () => {
  it('selects full (.) for a push event', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: 'push',
      changedPaths: ['packages/cli/src/index.ts'],
    });
    expect(result.fullRun).toBe(true);
    expect(result.targets).toEqual(['.']);
  });

  it('selects full (.) for a merge_group event', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: 'merge_group',
      changedPaths: ['docs/foo.md'],
    });
    expect(result.fullRun).toBe(true);
    expect(result.targets).toEqual(['.']);
  });

  it('selects full (.) for a workflow_dispatch event', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: 'workflow_dispatch',
      changedPaths: [],
    });
    expect(result.fullRun).toBe(true);
    expect(result.targets).toEqual(['.']);
  });
});

describe('affected-lint-targets selector — integration-tests always included', () => {
  it('includes integration-tests in every non-full scoped selection', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: PR_EVENT,
      changedPaths: ['packages/cli/src/commands/chat.ts'],
    });
    expect(result.fullRun).toBe(false);
    expect(result.targets).toContain('integration-tests');
  });

  it('does not list integration-tests separately when full run is selected', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: PR_EVENT,
      changedPaths: ['package.json'],
    });
    expect(result.fullRun).toBe(true);
    expect(result.targets).toEqual(['.']);
  });
});

describe('affected-lint-targets selector — deterministic output', () => {
  it('produces stable targets for the same input', async () => {
    const { selectLintTargets } = await loadSelector();
    const params = {
      event: PR_EVENT,
      changedPaths: ['packages/core/src/config.ts'],
    };
    const r1 = selectLintTargets(params);
    const r2 = selectLintTargets(params);
    expect(r1.targets).toEqual(r2.targets);
    expect(r1.pathReasons).toEqual(r2.pathReasons);
  });

  it('produces per-path reasons', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: PR_EVENT,
      changedPaths: [
        'packages/cli/src/index.ts',
        'packages/core/src/config.ts',
      ],
    });
    expect(result.pathReasons.length).toBe(2);
    for (const pr of result.pathReasons) {
      expect(pr.path).toBeTruthy();
      expect(pr.reason).toBeTruthy();
    }
  });
});

describe('affected-lint-targets selector — data graph reuse', () => {
  it('uses the same checked-in graph as affected-test-shards', () => {
    // The lint selector must not duplicate the graph; it loads the same data.
    const data = JSON.parse(readFileSync(DATA_PATH, 'utf8')) as {
      importEdges: Record<string, readonly string[]>;
    };
    expect(data.importEdges['providers']).toContain('telemetry');
  });
});

describe('affected-lint-targets selector — audit trail on full-run fallback', () => {
  it('records all changed paths in pathReasons even when one triggers a full run', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: PR_EVENT,
      changedPaths: [
        'packages/cli/src/index.ts',
        'package.json',
        'packages/core/src/config.ts',
      ],
    });
    // package.json triggers a full run; the remaining core path must still
    // appear in the audit trail (not be silently omitted).
    expect(result.fullRun).toBe(true);
    expect(result.targets).toEqual(['.']);
    expect(result.pathReasons.length).toBe(3);
    const paths = result.pathReasons.map((r) => r.path);
    expect(paths).toContain('packages/cli/src/index.ts');
    expect(paths).toContain('package.json');
    expect(paths).toContain('packages/core/src/config.ts');
  });

  it('marks not-yet-classified paths as not classified after the triggering path', async () => {
    const { selectLintTargets } = await loadSelector();
    const result = selectLintTargets({
      event: PR_EVENT,
      changedPaths: ['package.json', 'packages/core/src/config.ts'],
    });
    expect(result.fullRun).toBe(true);
    const coreReason = result.pathReasons.find(
      (r) => r.path === 'packages/core/src/config.ts',
    );
    expect(coreReason, 'core path must appear in audit trail').toBeTruthy();
    expect(coreReason?.reason).toContain('not classified');
  });
});

describe('affected-lint-targets selector — type-aware soundness (A5)', () => {
  /**
   * Mandatory soundness proof: package A changes an exported return from void
   * to Promise<void>, package B's call site remains untouched, the selector
   * includes B in the target list, and real ESLint reports
   * @typescript-eslint/no-floating-promises in B.
   *
   * This test fails if B is omitted from selection or if ESLint does not report
   * the floating-promise violation in the untouched dependent.
   */
  it.skipIf(!existsSync(ESLINT_BIN))(
    'catches a Promise<void> API change in an untouched dependent package',
    async () => {
      const { selectLintTargets } = await loadSelector();
      const fixtureRoot = mkdtempSync(join(tmpdir(), 'lint-soundness-'));
      try {
        // --- Fixture layout ---
        symlinkSync(
          join(REPO_ROOT, 'node_modules'),
          join(fixtureRoot, 'node_modules'),
          'dir',
        );

        writeFileSync(
          join(fixtureRoot, 'package.json'),
          JSON.stringify({
            name: 'lint-soundness-fixture',
            version: '0.0.0',
            private: true,
            type: 'module',
          }),
        );

        writeFileSync(
          join(fixtureRoot, 'tsconfig.json'),
          JSON.stringify({
            compilerOptions: {
              target: 'ES2022',
              module: 'ESNext',
              moduleResolution: 'bundler',
              strict: true,
              noEmit: true,
              skipLibCheck: true,
              esModuleInterop: true,
              allowImportingTsExtensions: true,
            },
            include: ['packages/*/src/**/*.ts'],
          }),
        );

        writeFileSync(
          join(fixtureRoot, 'eslint.config.js'),
          [
            "import tseslint from 'typescript-eslint';",
            'export default tseslint.config(',
            '  ...tseslint.configs.recommended,',
            '  {',
            "    files: ['packages/*/src/**/*.ts'],",
            '    languageOptions: {',
            '      parserOptions: {',
            '        projectService: {',
            "          defaultProject: './tsconfig.json',",
            '        },',
            '        tsconfigRootDir: import.meta.dirname,',
            '      },',
            '    },',
            '    rules: {',
            "      '@typescript-eslint/no-floating-promises': 'error',",
            '    },',
            '  },',
            ');',
          ].join('\n'),
        );

        // Package alpha: the changed producer (void -> Promise<void>).
        mkdirSync(join(fixtureRoot, 'packages', 'alpha', 'src'), {
          recursive: true,
        });
        writeFileSync(
          join(fixtureRoot, 'packages', 'alpha', 'src', 'index.ts'),
          'export async function run(): Promise<void> {\n  /* mutated api */\n}\n',
        );
        writeFileSync(
          join(fixtureRoot, 'packages', 'alpha', 'package.json'),
          JSON.stringify({
            name: 'alpha',
            version: '0.0.0',
            private: true,
            type: 'module',
          }),
        );

        // Package beta: the untouched consumer with a now-floating call.
        mkdirSync(join(fixtureRoot, 'packages', 'beta', 'src'), {
          recursive: true,
        });
        writeFileSync(
          join(fixtureRoot, 'packages', 'beta', 'src', 'index.ts'),
          "import { run } from '../../alpha/src/index.js';\nrun();\n",
        );
        writeFileSync(
          join(fixtureRoot, 'packages', 'beta', 'package.json'),
          JSON.stringify({
            name: 'beta',
            version: '0.0.0',
            private: true,
            type: 'module',
          }),
        );

        mkdirSync(join(fixtureRoot, 'integration-tests'), { recursive: true });
        writeFileSync(
          join(fixtureRoot, 'integration-tests', 'placeholder.ts'),
          'export {};\n',
        );

        // Fixture graph: beta imports alpha (production edge).
        writeFileSync(
          join(fixtureRoot, 'graph.json'),
          JSON.stringify({
            version: 1,
            packagePrefix: '@fixture/',
            packageToShard: { alpha: 'rest', beta: 'rest' },
            shardOrder: [
              'cli',
              'agents',
              'providers',
              'core',
              'rest',
              'scripts',
            ],
            shardTimingsSeconds: {
              cli: 1,
              agents: 1,
              providers: 1,
              core: 1,
              rest: 1,
              scripts: 1,
            },
            importEdges: { alpha: [], beta: ['alpha'] },
            testOnlyEdges: {},
            observers: {},
            sharedInputs: [],
          }),
        );

        // --- Selection: changed alpha production source ---
        const selection = selectLintTargets({
          event: PR_EVENT,
          changedPaths: ['packages/alpha/src/index.ts'],
          dataPath: join(fixtureRoot, 'graph.json'),
        });

        // A5: selection must include the untouched dependent (beta).
        expect(selection.fullRun).toBe(false);
        expect(selection.targets).toContain('packages/alpha');
        expect(selection.targets).toContain('packages/beta');
        expect(selection.targets).toContain('integration-tests');

        // --- Real ESLint against the selected beta target ---
        const betaTarget = 'packages/beta';
        const eslintRun = spawnSync(
          ESLINT_BIN,
          [betaTarget, '--format', 'json'],
          {
            cwd: fixtureRoot,
            encoding: 'utf8',
            timeout: 90_000,
          },
        );

        // Surface infrastructure failures (spawn error, timeout, or empty
        // stdout) as a clear assertion instead of a confusing JSON.parse throw.
        if (eslintRun.error !== undefined) {
          throw new Error(
            `ESLint spawn failed: ${String(eslintRun.error.message)}`,
          );
        }
        if (eslintRun.stdout === undefined || eslintRun.stdout.length === 0) {
          throw new Error(
            `ESLint produced no stdout (status=${eslintRun.status}). ` +
              `stderr: ${eslintRun.stderr ?? '<empty>'}`,
          );
        }

        // ESLint exits non-zero when it reports errors; that is expected here.
        const reports = JSON.parse(eslintRun.stdout) as Array<{
          readonly filePath: string;
          readonly messages: ReadonlyArray<{
            readonly ruleId: string | null;
            readonly message: string;
            readonly severity: number;
          }>;
        }>;

        // ESLint reports filePath with native separators, so a forward-slash
        // substring never matches on Windows. Normalise before comparing.
        const betaReport = reports.find((r) =>
          r.filePath
            .replaceAll('\\', '/')
            .includes('packages/beta/src/index.ts'),
        );
        expect(
          betaReport,
          'ESLint must lint the selected beta target',
        ).toBeTruthy();
        const floating = (betaReport?.messages ?? []).filter(
          (m) => m.ruleId === '@typescript-eslint/no-floating-promises',
        );
        expect(
          floating.length,
          'real ESLint must report no-floating-promises in the untouched dependent',
        ).toBeGreaterThan(0);
      } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
