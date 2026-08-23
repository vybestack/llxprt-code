/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression guard for issue #3278.
 *
 * Two sources of truth decide whether a Bun test process has its storage roots
 * redirected: each workspace `bunfig.toml` (used by a raw `bun test` and by the
 * per-workspace runners) and the `BUN_TEST_ROOTS` table (used by
 * `scripts/run_bun_tests.ts`, which passes the preloads as `--preload` args).
 * They drifted apart, and the workspaces missing from both resolved the
 * developer's live configuration directory.
 *
 * Both halves are proved by spawning a probe rather than by matching strings.
 * The bunfig half runs `bun test` from the workspace directory; the
 * `BUN_TEST_ROOTS` half runs it from a directory with no bunfig, passing the
 * table's resolved preloads explicitly. A root added without a working preload
 * fails here, as the negative control demonstrates.
 */

import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUN_TEST_ROOTS, resolveRoot } from '../bun-test-roots.js';
import { LLXPRT_PLATFORM_PATHS } from '../../packages/storage/src/config/path-resolver.js';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(thisFile, '..', '..', '..');
const SUBPROCESS_TIMEOUT_MS = 120_000;
/**
 * Strictly larger than the spawn budget, so a hung child is reported by
 * `expectIsolated` with the captured output rather than by the runner's
 * generic timeout.
 */
const TEST_TIMEOUT_MS = SUBPROCESS_TIMEOUT_MS + 30_000;

interface RootPackageJson {
  readonly workspaces: string[];
}

const rootPackageJson = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8'),
) as RootPackageJson;
const WORKSPACE_PATHS = [...rootPackageJson.workspaces].sort();

/**
 * Credentialed roots (`evals`, `integration-tests`) drive the real CLI against
 * real accounts and set the storage roots in their own `globalSetup`. The
 * runner already excludes them from an unfiltered run, so the same predicate is
 * used here rather than a second hardcoded list that could disagree with it.
 */
const auditedRoots = BUN_TEST_ROOTS.filter(
  (root) => root.credentialed !== true,
);

interface ProbeResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: string;
}

const PROBE_SOURCE = `import { test, expect } from 'bun:test';

test('storage roots are redirected away from the real user directory', () => {
  expect(process.env.LLXPRT_TEST_STORAGE_ISOLATED).toBe('1');
  expect(process.env.LLXPRT_CONFIG_HOME).toBeDefined();
  expect(process.env.LLXPRT_CONFIG_HOME).not.toBe(
    ${JSON.stringify(LLXPRT_PLATFORM_PATHS.config)},
  );
  expect(process.env.LLXPRT_DATA_HOME).not.toBe(
    ${JSON.stringify(LLXPRT_PLATFORM_PATHS.data)},
  );
});
`;

/**
 * Runs the probe with `bun test` from `cwd`, optionally with explicit
 * preloads. Every `LLXPRT_*` variable is stripped from the child environment,
 * so the child can only be isolated by the configuration under test — never by
 * inheritance from this already-isolated process.
 */
function probeStorageIsolation(
  cwd: string,
  preloads: readonly string[] = [],
): ProbeResult {
  const tempDir = mkdtempSync(
    join(tmpdir(), 'llxprt-storage-isolation-probe-'),
  );
  const probeFile = join(tempDir, 'storage-isolation-probe.test.ts');
  writeFileSync(probeFile, PROBE_SOURCE, 'utf8');

  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('LLXPRT_')) {
      environment[key] = value;
    }
  }

  const preloadArgs = preloads.flatMap((preload) => ['--preload', preload]);

  try {
    const result = spawnSync(
      process.execPath,
      ['test', '--timeout', '30000', ...preloadArgs, probeFile],
      {
        cwd,
        encoding: 'utf8',
        env: environment,
        timeout: SUBPROCESS_TIMEOUT_MS,
      },
    );
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      error: result.error?.message,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function expectIsolated(result: ProbeResult): void {
  expect(
    result.status,
    `error: ${result.error ?? 'none'}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  ).toBe(0);
}

/** A directory with no bunfig, so only explicit preloads can isolate a child. */
function withBareDirectory<T>(body: (directory: string) => T): T {
  const bare = mkdtempSync(join(tmpdir(), 'llxprt-storage-isolation-bare-'));
  try {
    return body(bare);
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
}

describe('BUN_TEST_ROOTS storage isolation', () => {
  it('exempts exactly the credentialed roots', () => {
    expect(auditedRoots.length).toBeGreaterThan(0);
    // Pins the exemption set, so adding a credentialed root is a conscious act
    // rather than a silent hole in the audit below.
    const exempt = BUN_TEST_ROOTS.filter(
      (root) => root.credentialed === true,
    ).map((root) => root.root);
    expect([...exempt].sort()).toStrictEqual(['evals', 'integration-tests']);
  });

  it.each(auditedRoots.map((root) => root.root))(
    "%s's declared preloads redirect the storage roots",
    (rootName: string) => {
      const root = BUN_TEST_ROOTS.find((entry) => entry.root === rootName);
      expect(root).toBeDefined();
      if (root === undefined) {
        return;
      }
      const [firstFile] = resolveRoot(root, repoRoot);
      expect(firstFile).toBeDefined();

      withBareDirectory((bare) => {
        expectIsolated(probeStorageIsolation(bare, firstFile.preloads));
      });
    },
    TEST_TIMEOUT_MS,
  );
});

describe('workspace bunfig storage isolation', () => {
  it.each(WORKSPACE_PATHS)(
    '%s isolates storage roots for a raw bun test',
    (workspacePath: string) => {
      expectIsolated(probeStorageIsolation(join(repoRoot, workspacePath)));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'the repository root isolates storage roots for a raw bun test',
    () => {
      expectIsolated(probeStorageIsolation(repoRoot));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'a directory with no bunfig and no preload fails the probe',
    () => {
      withBareDirectory((bare) => {
        const result = probeStorageIsolation(bare);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('LLXPRT_TEST_STORAGE_ISOLATED');
      });
    },
    TEST_TIMEOUT_MS,
  );
});
