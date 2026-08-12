/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the affected-test-shards drift checker
 * (`scripts/check-affected-test-shards.ts`), focusing on the canonical
 * directory-prefix contract for path-observer `pathPrefixes` (issue #3212).
 *
 * Two complementary test layers:
 *  - Direct unit tests of the exported `validatePathObservers` /
 *    `isValidCanonicalPrefix` functions: fast, precise, and do NOT scan the
 *    full repository.
 *  - Subprocess end-to-end tests: run the real checker binary to verify the
 *    full CLI pipeline (data loading → validation → error output → exit code),
 *    including fail-fast CLI parsing for missing `--data` / `--root` values.
 */

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validatePathObservers,
  buildCanonicalShardMap,
  isValidCanonicalPrefix,
  type GraphData,
  type PathObserverRule,
} from '../check-affected-test-shards.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CHECKER_PATH = join(
  REPO_ROOT,
  'scripts',
  'check-affected-test-shards.ts',
);
const DATA_PATH = join(REPO_ROOT, 'scripts', 'affected-test-shards.data.json');
const CANONICAL = buildCanonicalShardMap();
const CHECKER_TIMEOUT_MS = 30_000;

/**
 * A minimal GraphData fixture: only `pathObservers` is populated; all other
 * fields are empty. This is sufficient for `validatePathObservers` which only
 * reads `pathObservers` and `shardOrder` from the data object, plus disk
 * existence via `repoRoot`.
 */
function makeData(rule: PathObserverRule): GraphData {
  return {
    packageToShard: {},
    shardOrder: ['cli', 'agents', 'providers', 'core', 'rest', 'scripts'],
    shardTimingsSeconds: {},
    importEdges: {},
    testOnlyEdges: {},
    observers: {},
    pathObservers: [rule],
    sharedInputs: [],
  };
}

/**
 * Runs the checker as a subprocess with a bounded timeout. Throws with a clear
 * message on spawn failure or timeout (SIGTERM) so those failures are never
 * misreported as status-code assertion mismatches.
 */
function runChecker(args: readonly string[]): {
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
} {
  const run = spawnSync(process.execPath, [CHECKER_PATH, ...args], {
    timeout: CHECKER_TIMEOUT_MS,
  });
  if (run.error !== undefined) {
    throw new Error(`checker failed to spawn: ${run.error.message}`);
  }
  if (run.signal === 'SIGTERM') {
    throw new Error(
      `checker timed out after ${CHECKER_TIMEOUT_MS / 1000}s (killed by SIGTERM)`,
    );
  }
  return {
    status: run.status,
    stderr: run.stderr?.toString() ?? '',
    stdout: run.stdout?.toString() ?? '',
  };
}

/**
 * Writes a temp data file derived from the checked-in graph with its single
 * path observer's `pathPrefixes` replaced by the supplied value, returning the
 * temp file path. All other fields (edges, shard map, shared inputs) are kept
 * intact so only the prefix contract is under test.
 */
function writeDataWithPrefix(dir: string, prefix: string): string {
  const dataPath = join(dir, 'data.json');
  const raw = JSON.parse(readFileSync(DATA_PATH, 'utf8')) as Record<
    string,
    unknown
  >;
  raw.pathObservers = [
    {
      observingPackage: 'scripts',
      selectShard: 'scripts',
      reason: 'temp prefix for contract test',
      paths: ['packages/cli/src/config/settingsSchema.ts'],
      pathPrefixes: [prefix],
    },
  ];
  writeFileSync(dataPath, JSON.stringify(raw));
  return dataPath;
}

describe('check-affected-test-shards — isValidCanonicalPrefix (issue #3212)', () => {
  it('rejects a prefix missing its trailing slash', () => {
    expect(
      isValidCanonicalPrefix('packages/cli/src/config/settings-schema'),
    ).toBe(false);
  });

  it('accepts a well-formed prefix with a trailing slash', () => {
    expect(
      isValidCanonicalPrefix('packages/cli/src/config/settings-schema/'),
    ).toBe(true);
  });

  it('rejects an absolute prefix', () => {
    expect(isValidCanonicalPrefix('/packages/cli/')).toBe(false);
  });

  it('rejects a prefix with backslash separators', () => {
    expect(isValidCanonicalPrefix('packages\\cli\\')).toBe(false);
  });

  it('rejects a prefix with parent-directory traversal', () => {
    expect(isValidCanonicalPrefix('packages/../other/')).toBe(false);
  });

  it('rejects a drive-qualified forward-slash prefix (Windows drive)', () => {
    expect(isValidCanonicalPrefix('C:/packages/cli/')).toBe(false);
  });
});

describe('check-affected-test-shards — validatePathObservers prefix contract (issue #3212)', () => {
  it('reports a path-observer-prefix-invalid issue for a prefix missing its trailing slash', () => {
    const data = makeData({
      observingPackage: 'scripts',
      selectShard: 'scripts',
      reason: 'malformed prefix',
      paths: ['packages/cli/src/config/settingsSchema.ts'],
      pathPrefixes: ['packages/cli/src/config/settings-schema'],
    });
    const issues = validatePathObservers(data, CANONICAL, REPO_ROOT);
    const invalid = issues.filter(
      (i) => i.kind === 'path-observer-prefix-invalid',
    );
    expect(invalid.length).toBe(1);
    expect(invalid[0].detail).toContain("trailing '/'");
  });

  it('produces no issues for a well-formed prefix that exists on disk', () => {
    const data = makeData({
      observingPackage: 'scripts',
      selectShard: 'scripts',
      reason: 'well-formed prefix',
      paths: ['packages/cli/src/config/settingsSchema.ts'],
      pathPrefixes: ['packages/cli/src/config/settings-schema/'],
    });
    const issues = validatePathObservers(data, CANONICAL, REPO_ROOT);
    expect(issues).toEqual([]);
  });

  it('reports path-observer-prefix-not-dir for a prefix that does not exist on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'checker-nonexistent-'));
    try {
      const data = makeData({
        observingPackage: 'scripts',
        selectShard: 'scripts',
        reason: 'nonexistent prefix',
        paths: [],
        pathPrefixes: ['packages/cli/src/config/does-not-exist/'],
      });
      const issues = validatePathObservers(data, CANONICAL, dir);
      const notDir = issues.filter(
        (i) => i.kind === 'path-observer-prefix-not-dir',
      );
      expect(notDir.length).toBe(1);
      expect(notDir[0].detail).toContain('does-not-exist');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports path-observer-prefix-not-dir for a prefix pointing at an existing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'checker-nondir-'));
    try {
      writeFileSync(join(dir, 'afile'), 'x');
      const data = makeData({
        observingPackage: 'scripts',
        selectShard: 'scripts',
        reason: 'file prefix',
        paths: [],
        pathPrefixes: ['afile/'],
      });
      const issues = validatePathObservers(data, CANONICAL, dir);
      const notDir = issues.filter(
        (i) => i.kind === 'path-observer-prefix-not-dir',
      );
      expect(notDir.length).toBe(1);
      expect(notDir[0].detail).toContain('afile');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('check-affected-test-shards — end-to-end subprocess (issue #3212)', () => {
  it('rejects a pathPrefix missing its trailing slash via --data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'checker-prefix-contract-'));
    try {
      // The real directory exists on disk, so an existence-only check would
      // accept it; only the canonical-shape check catches the missing slash.
      const dataPath = writeDataWithPrefix(
        dir,
        'packages/cli/src/config/settings-schema',
      );
      const { status, stderr } = runChecker(['--data', dataPath]);
      expect(status).toBe(1);
      expect(stderr).toContain('path-observer-prefix-invalid');
      expect(stderr).toContain("trailing '/'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('check-affected-test-shards — fail-fast CLI parsing', () => {
  it('exits nonzero when --data has no following value', () => {
    const { status, stderr } = runChecker(['--data']);
    expect(status).toBe(1);
    expect(stderr).toContain('--data requires a value');
  });

  it('exits nonzero when --root has no following value', () => {
    const { status, stderr } = runChecker(['--root']);
    expect(status).toBe(1);
    expect(stderr).toContain('--root requires a value');
  });

  it('exits nonzero when --root value is another recognized option', () => {
    const { status, stderr } = runChecker(['--root', '--data', 'file.json']);
    expect(status).toBe(1);
    expect(stderr).toContain('--root requires a value');
  });

  it('exits nonzero when --data value is another recognized option', () => {
    const { status, stderr } = runChecker(['--data', '--root', 'repo']);
    expect(status).toBe(1);
    expect(stderr).toContain('--data requires a value');
  });
});
