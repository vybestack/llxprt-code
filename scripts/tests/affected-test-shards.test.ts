/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the affected-test-shard selector (issue #2709).
 *
 * These tests exercise the REAL selector (`scripts/affected-test-shards.ts`)
 * and the REAL checked-in graph (`scripts/affected-test-shards.data.json`).
 * No mock theater: the selector is imported and invoked with real path lists.
 *
 * Coverage (per project-plans/issue-2709 acceptance matrix):
 *  - cli leaf: production change selects cli + observers only (no reverse deps)
 *  - providers→telemetry: real undeclared edge triggers reverse closure
 *  - transitive reverse closure: lower-level change selects all dependents
 *  - package test-only changes select owner shard only
 *  - comments/forbidden strings do not create edges (checker validates graph)
 *  - observer rules: file-scanning tests protect their observed packages
 *  - scripts observation: scripts test harness changes select scripts shard
 *  - docs/unrelated metadata select none (has_tests=false)
 *  - shared build/install/test inputs select all shards
 *  - all non-PR events run full
 *  - unknown paths fail closed to all shards
 *  - deterministic auditable output with per-path reasons
 *  - coverage_complete flag (cli and core both selected)
 *  - replay computes forced-full count and time savings deterministically
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SELECTOR_PATH = join(REPO_ROOT, 'scripts', 'affected-test-shards.ts');
const DATA_PATH = join(REPO_ROOT, 'scripts', 'affected-test-shards.data.json');

interface PathReason {
  readonly path: string;
  readonly reason: string;
  readonly shards: readonly string[];
}

interface SelectionResult {
  readonly selectedShards: readonly string[];
  readonly skippedShards: readonly string[];
  readonly hasTests: boolean;
  readonly coverageComplete: boolean;
  readonly fullRunReason: string | null;
  readonly pathReasons: readonly PathReason[];
}

interface ReplayResult {
  readonly commits: number;
  readonly forcedFull: number;
  readonly selectedLegs: number;
  readonly aggregateSeconds: number;
  readonly fullRunSeconds: number;
  readonly aggregateSavingSeconds: number;
  readonly criticalPathSeconds: number;
  readonly fullCriticalPathSeconds: number;
  readonly criticalPathSavingSeconds: number;
}

interface SelectorModule {
  selectAffectedShards: (params: {
    readonly event: string;
    readonly changedPaths: readonly string[];
  }) => SelectionResult;
  replayHistory: (params: {
    readonly count: number;
    readonly base?: string;
  }) => ReplayResult;
}

async function loadSelector(): Promise<SelectorModule> {
  return await import(SELECTOR_PATH);
}

const PR_EVENT = 'pull_request';
const ALL_SHARDS = ['cli', 'agents', 'providers', 'core', 'rest', 'scripts'];

describe('affected-test-shards selector — cli leaf', () => {
  it('selects cli shard for a cli production source change', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['packages/cli/src/commands/chat.ts'],
    });
    expect(result.selectedShards).toContain('cli');
    expect(result.hasTests).toBe(true);
  });

  it('does not select any reverse-dependent package shard for a cli-only change', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['packages/cli/src/index.ts'],
    });
    // cli is a leaf — no package imports it — so no reverse-dependency
    // closure shard is triggered. The rest shard IS selected because the
    // test-utils observer scans cli source files.
    expect(result.selectedShards).toContain('cli');
    expect(result.selectedShards).not.toContain('agents');
    expect(result.selectedShards).not.toContain('providers');
    expect(result.selectedShards).not.toContain('core');
  });
});

describe('affected-test-shards selector — providers→telemetry edge', () => {
  it('selects providers shard when telemetry production source changes', async () => {
    const { selectAffectedShards } = await loadSelector();
    // providers imports telemetry (undeclared in package.json but real AST edge)
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['packages/telemetry/src/telemetry/sdk.ts'],
    });
    expect(result.selectedShards).toContain('providers');
    expect(result.selectedShards).toContain('rest');
  });
});

describe('affected-test-shards selector — transitive reverse closure', () => {
  it('selects all reverse dependents for a storage change', async () => {
    const { selectAffectedShards } = await loadSelector();
    // storage is imported by many packages transitively:
    // settings→storage, telemetry→storage, auth(declared but no AST)...
    // core→storage→{mcp,settings,telemetry,tools,...}→{cli,agents,providers,a2a-server}
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['packages/storage/src/index.ts'],
    });
    expect(result.selectedShards).toContain('cli');
    expect(result.selectedShards).toContain('agents');
    expect(result.selectedShards).toContain('providers');
    expect(result.selectedShards).toContain('core');
    expect(result.selectedShards).toContain('rest');
  });

  it('selects the full closure for a core production change', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['packages/core/src/config/configConstructor.ts'],
    });
    // core is imported by cli, agents, providers, mcp(rest), a2a-server(rest),
    // ide-integration(rest via test)
    expect(result.selectedShards).toContain('cli');
    expect(result.selectedShards).toContain('agents');
    expect(result.selectedShards).toContain('providers');
    expect(result.selectedShards).toContain('core');
    expect(result.selectedShards).toContain('rest');
  });

  it('selects the owner plus dependents for a settings change', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['packages/settings/src/index.ts'],
    });
    // settings→storage, imported by agents, providers, cli, core, mcp
    expect(result.selectedShards).toContain('rest'); // owner
    expect(result.selectedShards).toContain('cli');
    expect(result.selectedShards).toContain('agents');
    expect(result.selectedShards).toContain('providers');
    expect(result.selectedShards).toContain('core');
  });
});

describe('affected-test-shards selector — package test-only changes', () => {
  it('selects only the owner shard for a package test-only change', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['packages/providers/src/BaseProvider.test.ts'],
    });
    // test-only changes do not trigger reverse-dependency closure
    expect(result.selectedShards).toEqual(['providers']);
  });

  it('selects only the owner shard for a core test change', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['packages/core/src/__tests__/config.test.ts'],
    });
    expect(result.selectedShards).toEqual(['core']);
  });
});

describe('affected-test-shards selector — observer rules', () => {
  it('selects the observer shard when an observed package changes', async () => {
    const { selectAffectedShards } = await loadSelector();
    // policy test scans agents files → agents change selects rest (policy)
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['packages/agents/src/api/types.ts'],
    });
    expect(result.selectedShards).toContain('agents');
    // policy is in rest shard and observes agents
    expect(result.selectedShards).toContain('rest');
  });

  it('selects core when providers changes (core observer)', async () => {
    const { selectAffectedShards } = await loadSelector();
    // packages/core/src/llm-types/assignability.test.ts reads providers types
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['packages/providers/src/types.ts'],
    });
    expect(result.selectedShards).toContain('providers');
    expect(result.selectedShards).toContain('core');
  });

  it('selects rest when cli changes (test-utils observer)', async () => {
    const { selectAffectedShards } = await loadSelector();
    // packages/test-utils/src/cli-args.test.ts reads cli source
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['packages/cli/src/cli.ts'],
    });
    expect(result.selectedShards).toContain('cli');
    expect(result.selectedShards).toContain('rest');
  });
});

describe('affected-test-shards selector — scripts observation', () => {
  it('selects scripts shard for a scripts test change', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['scripts/tests/test-shards.test.ts'],
    });
    expect(result.selectedShards).toContain('scripts');
    expect(result.selectedShards).not.toContain('cli');
  });

  it('selects scripts shard for a scripts source change', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['scripts/test.ts'],
    });
    expect(result.selectedShards).toContain('scripts');
  });
});

describe('affected-test-shards selector — docs and metadata', () => {
  it('selects no test shard for a docs-only change', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['docs/getting-started.md'],
    });
    expect(result.hasTests).toBe(false);
    expect(result.selectedShards).toEqual([]);
  });

  it('selects no test shard for a README change', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['README.md'],
    });
    expect(result.hasTests).toBe(false);
  });

  it('selects no test shard for a project-plan change', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['project-plans/some-plan.md'],
    });
    expect(result.hasTests).toBe(false);
  });
});

describe('affected-test-shards selector — shared inputs', () => {
  it('selects all shards for a package.json change', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['package.json'],
    });
    expect(result.selectedShards).toEqual(ALL_SHARDS);
    expect(result.fullRunReason).toBeTruthy();
  });

  it('selects all shards for a tsconfig.json change', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['tsconfig.json'],
    });
    expect(result.selectedShards).toEqual(ALL_SHARDS);
  });

  it('selects all shards for a bun.lock change', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['bun.lock'],
    });
    expect(result.selectedShards).toEqual(ALL_SHARDS);
  });

  it('selects scripts shard for a build script change (issue #2878)', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['scripts/build.ts'],
    });
    expect(result.selectedShards).toEqual(['scripts']);
    expect(result.fullRunReason).toBeNull();
  });

  it('selects scripts shard for a selector data change (issue #2878)', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['scripts/affected-test-shards.data.json'],
    });
    expect(result.selectedShards).toEqual(['scripts']);
    expect(result.fullRunReason).toBeNull();
  });

  it('selects scripts shard for a selector script change (issue #2878)', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['scripts/affected-test-shards.ts'],
    });
    expect(result.selectedShards).toEqual(['scripts']);
    expect(result.fullRunReason).toBeNull();
  });
});

describe('affected-test-shards selector — non-PR events', () => {
  it('selects all shards for a push event', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: 'push',
      changedPaths: ['packages/cli/src/index.ts'],
    });
    expect(result.selectedShards).toEqual(ALL_SHARDS);
    expect(result.fullRunReason).toContain('push');
  });

  it('selects all shards for a merge_group event', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: 'merge_group',
      changedPaths: ['docs/foo.md'],
    });
    expect(result.selectedShards).toEqual(ALL_SHARDS);
  });

  it('selects all shards for a workflow_dispatch event', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: 'workflow_dispatch',
      changedPaths: [],
    });
    expect(result.selectedShards).toEqual(ALL_SHARDS);
  });
});

describe('affected-test-shards selector — fail-closed', () => {
  it('selects all shards for an unknown path', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['some/random/unknown/file.xyz'],
    });
    expect(result.selectedShards).toEqual(ALL_SHARDS);
    expect(result.fullRunReason).toBeTruthy();
  });

  it('selects all shards for an empty changed-paths list in a PR', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: [],
    });
    expect(result.selectedShards).toEqual(ALL_SHARDS);
  });

  it('selects all shards for a path under an unknown directory', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['newroot/something.ts'],
    });
    expect(result.selectedShards).toEqual(ALL_SHARDS);
  });
});

describe('affected-test-shards selector — deterministic auditable output', () => {
  it('produces per-path reasons for each changed path', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
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
      expect(pr.shards.length).toBeGreaterThan(0);
    }
  });

  it('produces stable output for the same input', async () => {
    const { selectAffectedShards } = await loadSelector();
    const params = {
      event: PR_EVENT,
      changedPaths: ['packages/providers/src/BaseProvider.ts'],
    };
    const r1 = selectAffectedShards(params);
    const r2 = selectAffectedShards(params);
    expect(r1.selectedShards).toEqual(r2.selectedShards);
    expect(r1.skippedShards).toEqual(r2.skippedShards);
    expect(r1.pathReasons).toEqual(r2.pathReasons);
  });

  it('skippedShards is the complement of selectedShards', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['packages/cli/src/index.ts'],
    });
    const all = new Set([...result.selectedShards, ...result.skippedShards]);
    expect([...all].sort()).toEqual([...ALL_SHARDS].sort());
    const intersection = result.selectedShards.filter((s) =>
      result.skippedShards.includes(s),
    );
    expect(intersection).toEqual([]);
  });
});

describe('affected-test-shards selector — coverageComplete', () => {
  it('reports coverageComplete=true when both cli and core are selected', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['packages/core/src/config.ts'],
    });
    expect(result.selectedShards).toContain('cli');
    expect(result.selectedShards).toContain('core');
    expect(result.coverageComplete).toBe(true);
  });

  it('reports coverageComplete=false when only cli is selected', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['packages/cli/src/index.ts'],
    });
    expect(result.coverageComplete).toBe(false);
  });

  it('reports coverageComplete=false when only providers is selected', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['packages/providers/src/BaseProvider.test.ts'],
    });
    expect(result.coverageComplete).toBe(false);
  });
});

describe('affected-test-shards selector — replay', () => {
  it('replay computes deterministic savings for a fixed count', async () => {
    const { replayHistory } = await loadSelector();
    const r1 = replayHistory({ count: 20 });
    const r2 = replayHistory({ count: 20 });
    expect(r1.forcedFull).toBe(r2.forcedFull);
    expect(r1.selectedLegs).toBe(r2.selectedLegs);
    expect(r1.aggregateSeconds).toBe(r2.aggregateSeconds);
    expect(r1.criticalPathSeconds).toBe(r2.criticalPathSeconds);
  });

  it('replay reports fewer aggregate seconds than the full run', async () => {
    const { replayHistory } = await loadSelector();
    const result = replayHistory({ count: 50 });
    expect(result.aggregateSeconds).toBeLessThanOrEqual(result.fullRunSeconds);
  });

  it('replay reports critical path no longer than the full critical path', async () => {
    const { replayHistory } = await loadSelector();
    const result = replayHistory({ count: 50 });
    expect(result.criticalPathSeconds).toBeLessThanOrEqual(
      result.fullCriticalPathSeconds,
    );
  });

  it('replay forced-full count is within [0, commits]', async () => {
    const { replayHistory } = await loadSelector();
    const result = replayHistory({ count: 30 });
    expect(result.forcedFull).toBeGreaterThanOrEqual(0);
    expect(result.forcedFull).toBeLessThanOrEqual(result.commits);
  });
});

describe('affected-test-shards selector — data graph integrity', () => {
  it('every package in packageToShard maps to a canonical shard', () => {
    const data = JSON.parse(readFileSync(DATA_PATH, 'utf8')) as {
      packageToShard: Record<string, string>;
      shardOrder: readonly string[];
    };
    for (const shard of Object.values(data.packageToShard)) {
      expect(data.shardOrder).toContain(shard);
    }
  });

  it('the graph does not encode the false tools→core/providers/cli edges', () => {
    const data = JSON.parse(readFileSync(DATA_PATH, 'utf8')) as {
      importEdges: Record<string, readonly string[]>;
    };
    const toolsDeps = data.importEdges['tools'] ?? [];
    expect(toolsDeps).not.toContain('core');
    expect(toolsDeps).not.toContain('providers');
    expect(toolsDeps).not.toContain('cli');
  });

  it('the graph does not encode the false core→lsp edge', () => {
    const data = JSON.parse(readFileSync(DATA_PATH, 'utf8')) as {
      importEdges: Record<string, readonly string[]>;
    };
    const coreDeps = data.importEdges['core'] ?? [];
    expect(coreDeps).not.toContain('lsp');
  });

  it('the graph encodes the real providers→telemetry edge', () => {
    const data = JSON.parse(readFileSync(DATA_PATH, 'utf8')) as {
      importEdges: Record<string, readonly string[]>;
    };
    expect(data.importEdges['providers']).toContain('telemetry');
  });
});

describe('affected-test-shards selector — integration-tests protection', () => {
  it('selects all shards for an integration-tests harness .ts file', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['integration-tests/file-system.test.ts'],
    });
    expect(result.fullRunReason).toContain('integration-tests');
    expect(result.selectedShards).toEqual(ALL_SHARDS);
  });

  it('selects scripts shard for an integration-tests fixture (issue #2878)', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['integration-tests/some.fixture.md'],
    });
    expect(result.selectedShards).toEqual(['scripts']);
    expect(result.fullRunReason).toBeNull();
  });

  it('selects scripts shard for a .responses fixture (issue #2878)', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['integration-tests/hooks-system.before-model.responses'],
    });
    expect(result.selectedShards).toEqual(['scripts']);
    expect(result.fullRunReason).toBeNull();
  });
});

describe('affected-test-shards selector — event gating (PR-only selection)', () => {
  const fullRunCases = ['', 'some_future_event', 'release'];
  for (const event of fullRunCases) {
    it(`selects all shards for event '${event || '(empty)'}'`, async () => {
      const { selectAffectedShards } = await loadSelector();
      const result = selectAffectedShards({
        event,
        changedPaths: ['docs/foo.md'],
      });
      expect(result.selectedShards).toEqual(ALL_SHARDS);
      expect(result.fullRunReason).toBeTruthy();
    });
  }
});

describe('affected-test-shards selector — schemas selection', () => {
  it('selects cli for a schemas/settings.schema.json change', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['schemas/settings.schema.json'],
    });
    expect(result.selectedShards).toEqual(['cli']);
  });
});

describe('affected-test-shards selector — .github/.husky narrow selection', () => {
  const scriptsShardCases = [
    '.github/workflows/assign.yml',
    '.husky/pre-commit',
    '.github/CODEOWNERS',
  ];
  for (const path of scriptsShardCases) {
    it(`selects scripts shard for ${path}`, async () => {
      const { selectAffectedShards } = await loadSelector();
      const result = selectAffectedShards({
        event: PR_EVENT,
        changedPaths: [path],
      });
      expect(result.selectedShards).toContain('scripts');
      expect(result.fullRunReason).toBeNull();
    });
  }
});

describe('affected-test-shards selector — complete shared inputs', () => {
  const sharedInputCases = ['package-lock.json', 'scripts/postinstall.cjs'];

  for (const path of sharedInputCases) {
    it(`selects all shards for a ${path} change`, async () => {
      const { selectAffectedShards } = await loadSelector();
      const result = selectAffectedShards({
        event: PR_EVENT,
        changedPaths: [path],
      });
      expect(result.selectedShards).toEqual(ALL_SHARDS);
    });
  }

  it('selects scripts shard for a .github/workflows/ci.yml change (issue #2878)', async () => {
    const { selectAffectedShards } = await loadSelector();
    const result = selectAffectedShards({
      event: PR_EVENT,
      changedPaths: ['.github/workflows/ci.yml'],
    });
    expect(result.selectedShards).toEqual(['scripts']);
    expect(result.fullRunReason).toBeNull();
  });
});

describe('affected-test-shards selector — replay validation', () => {
  it('throws for invalid replay counts', async () => {
    const { replayHistory } = await loadSelector();
    for (const count of [0, -3, 1.5]) {
      expect(() => replayHistory({ count })).toThrow(
        'replay count must be a positive integer',
      );
    }
  });
});

describe('affected-test-shards selector — repo config/infra paths (issue #2878)', () => {
  const noShardCases = [
    '.allstar/branch_protection.yaml',
    '.claude/settings.json',
    '.gcp/release-docker.yaml',
    '.gemini/commands/introspect.toml',
    '.llxprt/settings.json',
    'shell-scripts/codex-call.sh',
    'test-scripts/integration-testing.ts',
    '.npmrc',
    'bunfig.toml',
    'junit-integration.xml',
    'tsconfig.scripts.json',
  ];

  for (const path of noShardCases) {
    it(`selects no test shard for ${path}`, async () => {
      const { selectAffectedShards } = await loadSelector();
      const result = selectAffectedShards({
        event: PR_EVENT,
        changedPaths: [path],
      });
      expect(result.hasTests).toBe(false);
      expect(result.fullRunReason).toBeNull();
    });
  }

  // Config files exercised by scripts-shard guard tests (eslint-guard,
  // vitest-coverage) must select the scripts shard, not zero shards.
  const scriptsShardCases = ['eslint.config.js', 'vitest.coverage.ts'];

  for (const path of scriptsShardCases) {
    it(`selects scripts shard for ${path}`, async () => {
      const { selectAffectedShards } = await loadSelector();
      const result = selectAffectedShards({
        event: PR_EVENT,
        changedPaths: [path],
      });
      expect(result.selectedShards).toEqual(['scripts']);
      expect(result.fullRunReason).toBeNull();
    });
  }
});

describe('affected-test-shards selector — GitHub output safety', () => {
  it('does not create output records from carriage returns in paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'affected-shards-'));
    const files = join(dir, 'files.txt');
    const output = join(dir, 'output.txt');
    writeFileSync(files, 'evil\rhas_tests=false');
    const run = spawnSync(
      process.execPath,
      [
        SELECTOR_PATH,
        '--event',
        PR_EVENT,
        '--files-from',
        files,
        '--output',
        'github-actions',
      ],
      { env: { ...process.env, GITHUB_OUTPUT: output } },
    );
    const records = readFileSync(output, 'utf8').split('\n');
    expect(run.status).toBe(0);
    expect(records.filter((line) => line.startsWith('has_tests='))).toEqual([
      'has_tests=true',
    ]);
  });
});

describe('affected-test-shards selector — ubuntu-only PR matrix (issue #2876)', () => {
  it('emits ubuntu-only matrix rows for pull_request events', () => {
    const dir = mkdtempSync(join(tmpdir(), 'affected-shards-matrix-'));
    try {
      const files = join(dir, 'files.txt');
      const output = join(dir, 'output.txt');
      writeFileSync(files, 'packages/cli/src/index.ts');
      const run = spawnSync(
        process.execPath,
        [
          SELECTOR_PATH,
          '--event',
          PR_EVENT,
          '--files-from',
          files,
          '--output',
          'github-actions',
        ],
        { env: { ...process.env, GITHUB_OUTPUT: output } },
      );
      expect(run.stderr?.toString() ?? '').toBe('');
      expect(run.status).toBe(0);
      const records = readFileSync(output, 'utf8').split('\n');
      const matrixRecord = records.find((line) => line.startsWith('matrix='));
      expect(matrixRecord).toBeDefined();
      const matrixJson = JSON.parse(
        matrixRecord!.substring('matrix='.length),
      ) as ReadonlyArray<{ readonly os: string }>;
      expect(matrixJson.length).toBeGreaterThan(0);
      for (const entry of matrixJson) {
        expect(entry.os).toBe('ubuntu-latest');
      }
      expect(
        matrixJson.some((e: { os: string }) => e.os === 'macos-latest'),
      ).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not emit any macOS matrix rows for full-run pull_request events', () => {
    const dir = mkdtempSync(join(tmpdir(), 'affected-shards-no-macos-'));
    try {
      const files = join(dir, 'files.txt');
      const output = join(dir, 'output.txt');
      // package.json is a shared input, triggering a full-run that selects all
      // shards. Even the full-run path is ubuntu-only (issue #2876).
      writeFileSync(files, 'package.json');
      const run = spawnSync(
        process.execPath,
        [
          SELECTOR_PATH,
          '--event',
          PR_EVENT,
          '--files-from',
          files,
          '--output',
          'github-actions',
        ],
        { env: { ...process.env, GITHUB_OUTPUT: output } },
      );
      expect(run.stderr?.toString() ?? '').toBe('');
      expect(run.status).toBe(0);
      const records = readFileSync(output, 'utf8').split('\n');
      const matrixRecord = records.find((line) => line.startsWith('matrix='));
      expect(matrixRecord).toBeDefined();
      const matrixJson = JSON.parse(
        matrixRecord!.substring('matrix='.length),
      ) as ReadonlyArray<{ readonly os: string }>;
      // Full-run selects all shards, but all on ubuntu-latest.
      expect(matrixJson.length).toBe(ALL_SHARDS.length);
      for (const entry of matrixJson) {
        expect(entry.os).toBe('ubuntu-latest');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
