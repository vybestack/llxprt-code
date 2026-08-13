/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the affected-test-shards drift checker
 * (`scripts/check-affected-test-shards.ts`), focusing on the path-observer
 * directory-prefix and exact-path contracts (issue #3212).
 *
 * Two complementary test layers:
 *  - Direct unit tests of the exported `validatePathObservers` /
 *    `isValidDirectoryPrefix` / `isValidExactPath` functions: fast, precise,
 *    and do NOT scan the full repository.
 *  - Subprocess end-to-end tests: run the real checker binary to verify the
 *    full CLI pipeline (data loading → validation → error output → exit code),
 *    including fail-fast CLI parsing for missing `--data` / `--root` values.
 */

import { describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validatePathObservers,
  buildCanonicalShardMap,
  isValidDirectoryPrefix,
  isValidExactPath,
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

/**
 * Writes a temp data file derived from the checked-in graph with its single
 * path observer's `paths` replaced by the supplied value (and no prefixes),
 * returning the temp file path. All other fields are kept intact so only the
 * exact-path contract is under test.
 */
function writeDataWithExactPath(dir: string, exactPath: string): string {
  const dataPath = join(dir, 'data.json');
  const raw = JSON.parse(readFileSync(DATA_PATH, 'utf8')) as Record<
    string,
    unknown
  >;
  raw.pathObservers = [
    {
      observingPackage: 'scripts',
      selectShard: 'scripts',
      reason: 'temp exact path for contract test',
      paths: [exactPath],
      pathPrefixes: [],
    },
  ];
  writeFileSync(dataPath, JSON.stringify(raw));
  return dataPath;
}

describe('check-affected-test-shards — isValidDirectoryPrefix (issue #3212)', () => {
  it('rejects a prefix missing its trailing slash', () => {
    expect(
      isValidDirectoryPrefix('packages/cli/src/config/settings-schema'),
    ).toBe(false);
  });

  it('accepts a well-formed prefix with a trailing slash', () => {
    expect(
      isValidDirectoryPrefix('packages/cli/src/config/settings-schema/'),
    ).toBe(true);
  });

  it('rejects an absolute prefix', () => {
    expect(isValidDirectoryPrefix('/packages/cli/')).toBe(false);
  });

  it('rejects a prefix with backslash separators', () => {
    expect(isValidDirectoryPrefix('packages\\cli\\')).toBe(false);
  });

  it('rejects a prefix with duplicate separators', () => {
    expect(isValidDirectoryPrefix('packages//cli/')).toBe(false);
  });

  it('rejects a prefix with parent-directory traversal', () => {
    expect(isValidDirectoryPrefix('packages/../other/')).toBe(false);
  });

  it('rejects a drive-qualified forward-slash prefix (Windows drive)', () => {
    expect(isValidDirectoryPrefix('C:/packages/cli/')).toBe(false);
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

describe('check-affected-test-shards — isValidExactPath (issue #3212)', () => {
  it('accepts a well-formed repo-relative file path', () => {
    expect(isValidExactPath('packages/cli/src/config/settingsSchema.ts')).toBe(
      true,
    );
  });

  it('accepts a short file path with one segment', () => {
    expect(isValidExactPath('package.json')).toBe(true);
  });

  it('accepts a nested file path', () => {
    expect(isValidExactPath('a/b/c/d.ts')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isValidExactPath('')).toBe(false);
  });

  it('rejects a trailing slash (exact path is a file)', () => {
    expect(isValidExactPath('packages/cli/')).toBe(false);
  });

  it('rejects an absolute path', () => {
    expect(isValidExactPath('/packages/cli/x.ts')).toBe(false);
  });

  it('rejects a Windows drive prefix', () => {
    expect(isValidExactPath('C:/packages/cli/x.ts')).toBe(false);
  });

  it('rejects backslash separators', () => {
    expect(isValidExactPath('packages\\cli\\x.ts')).toBe(false);
  });

  it('rejects duplicate separators', () => {
    expect(isValidExactPath('packages//cli/x.ts')).toBe(false);
  });

  it('rejects parent-directory traversal', () => {
    expect(isValidExactPath('packages/../other/x.ts')).toBe(false);
  });

  it('rejects a current-directory segment', () => {
    expect(isValidExactPath('./packages/x.ts')).toBe(false);
  });
});

describe('check-affected-test-shards — validatePathObservers exact-path contract (issue #3212)', () => {
  it('produces no issues for a valid exact path that exists as a file', () => {
    const data = makeData({
      observingPackage: 'scripts',
      selectShard: 'scripts',
      reason: 'valid exact path',
      paths: ['packages/cli/src/config/settingsSchema.ts'],
      pathPrefixes: [],
    });
    const issues = validatePathObservers(data, CANONICAL, REPO_ROOT);
    expect(issues).toEqual([]);
  });

  it('produces no issues for an actual file in a temp root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'checker-exact-realfile-'));
    try {
      writeFileSync(join(dir, 'realfile.ts'), 'x');
      const data = makeData({
        observingPackage: 'scripts',
        selectShard: 'scripts',
        reason: 'real file',
        paths: ['realfile.ts'],
        pathPrefixes: [],
      });
      const issues = validatePathObservers(data, CANONICAL, dir);
      expect(issues).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports path-observer-path-invalid for an absolute exact path', () => {
    const data = makeData({
      observingPackage: 'scripts',
      selectShard: 'scripts',
      reason: 'absolute exact path',
      paths: ['/etc/passwd'],
      pathPrefixes: [],
    });
    const issues = validatePathObservers(data, CANONICAL, REPO_ROOT);
    const invalid = issues.filter(
      (i) => i.kind === 'path-observer-path-invalid',
    );
    expect(invalid.length).toBe(1);
  });

  it('reports path-observer-path-invalid for a trailing-slash exact path', () => {
    const data = makeData({
      observingPackage: 'scripts',
      selectShard: 'scripts',
      reason: 'trailing slash exact path',
      paths: ['packages/cli/'],
      pathPrefixes: [],
    });
    const issues = validatePathObservers(data, CANONICAL, REPO_ROOT);
    const invalid = issues.filter(
      (i) => i.kind === 'path-observer-path-invalid',
    );
    expect(invalid.length).toBe(1);
  });

  it('reports path-observer-path-invalid for a backslash exact path', () => {
    const data = makeData({
      observingPackage: 'scripts',
      selectShard: 'scripts',
      reason: 'backslash exact path',
      paths: ['packages\\cli\\x.ts'],
      pathPrefixes: [],
    });
    const issues = validatePathObservers(data, CANONICAL, REPO_ROOT);
    const invalid = issues.filter(
      (i) => i.kind === 'path-observer-path-invalid',
    );
    expect(invalid.length).toBe(1);
  });

  it('reports path-observer-path-invalid for a traversal exact path', () => {
    const data = makeData({
      observingPackage: 'scripts',
      selectShard: 'scripts',
      reason: 'traversal exact path',
      paths: ['packages/../other/x.ts'],
      pathPrefixes: [],
    });
    const issues = validatePathObservers(data, CANONICAL, REPO_ROOT);
    const invalid = issues.filter(
      (i) => i.kind === 'path-observer-path-invalid',
    );
    expect(invalid.length).toBe(1);
  });

  it('reports path-observer-path-not-file for a valid exact path that is a directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'checker-exact-isdir-'));
    try {
      mkdirSync(join(dir, 'subdir'), { recursive: true });
      const data = makeData({
        observingPackage: 'scripts',
        selectShard: 'scripts',
        reason: 'exact path is a directory',
        paths: ['subdir'],
        pathPrefixes: [],
      });
      const issues = validatePathObservers(data, CANONICAL, dir);
      const notFile = issues.filter(
        (i) => i.kind === 'path-observer-path-not-file',
      );
      expect(notFile.length).toBe(1);
      expect(notFile[0].detail).toContain('subdir');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports path-observer-path-not-file for a valid exact path that is missing', () => {
    const data = makeData({
      observingPackage: 'scripts',
      selectShard: 'scripts',
      reason: 'missing exact path',
      paths: ['does/not/exist.ts'],
      pathPrefixes: [],
    });
    const issues = validatePathObservers(data, CANONICAL, REPO_ROOT);
    const notFile = issues.filter(
      (i) => i.kind === 'path-observer-path-not-file',
    );
    expect(notFile.length).toBe(1);
    expect(notFile[0].detail).toContain('does/not/exist.ts');
  });

  it('does not access the filesystem for an invalid exact path shape', () => {
    // A malformed path must be reported as invalid shape without any
    // filesystem check, so the issue kind is path-observer-path-invalid
    // (never path-observer-path-not-file).
    const data = makeData({
      observingPackage: 'scripts',
      selectShard: 'scripts',
      reason: 'malformed path',
      paths: ['/absolute.ts', 'packages/../x.ts'],
      pathPrefixes: [],
    });
    const issues = validatePathObservers(data, CANONICAL, REPO_ROOT);
    const invalid = issues.filter(
      (i) => i.kind === 'path-observer-path-invalid',
    );
    const notFile = issues.filter(
      (i) => i.kind === 'path-observer-path-not-file',
    );
    expect(invalid.length).toBe(2);
    expect(notFile.length).toBe(0);
  });
});

describe('check-affected-test-shards — end-to-end subprocess (issue #3212)', () => {
  it('rejects a pathPrefix missing its trailing slash via --data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'checker-prefix-contract-'));
    try {
      // The real directory exists on disk, so an existence-only check would
      // accept it; only the directory-prefix shape check catches the missing
      // slash.
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

  it('rejects a malformed exact path (absolute) via --data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'checker-exactpath-contract-'));
    try {
      const dataPath = writeDataWithExactPath(dir, '/absolute/path.ts');
      const { status, stderr } = runChecker(['--data', dataPath]);
      expect(status).toBe(1);
      expect(stderr).toContain('path-observer-path-invalid');
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
