/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for boundary-safe path-observer prefix matching in the
 * affected-test-shard selector (issue #3212).
 *
 * `pathObserverMatches` must not overmatch sibling directories whose names
 * merely share a textual prefix, even when a `pathPrefixes` entry is malformed
 * (missing its trailing slash). These tests drive the REAL selector with a
 * temp copy of the checked-in graph whose prefix lacks the trailing slash, so
 * the boundary-safe matching — not the (checker-enforced) data shape — is the
 * property under test.
 */

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

interface SelectorModule {
  selectAffectedShards: (params: {
    readonly event: string;
    readonly changedPaths: readonly string[];
    readonly dataPath?: string;
  }) => SelectionResult;
}

async function loadSelector(): Promise<SelectorModule> {
  return await import(SELECTOR_PATH);
}

const PR_EVENT = 'pull_request';

/**
 * Writes a temp graph derived from the checked-in data whose single
 * path-observer prefix is malformed (missing its trailing slash), returning the
 * temp file path. All other fields are kept intact so only prefix matching is
 * under test.
 */
function writeMalformedPrefixData(dir: string): string {
  const dataPath = join(dir, 'data.json');
  const raw = JSON.parse(readFileSync(DATA_PATH, 'utf8')) as Record<
    string,
    unknown
  >;
  raw.pathObservers = [
    {
      observingPackage: 'scripts',
      selectShard: 'scripts',
      reason: 'malformed no-slash prefix',
      paths: ['packages/cli/src/config/settingsSchema.ts'],
      pathPrefixes: ['packages/cli/src/config/settings-schema'],
    },
  ];
  writeFileSync(dataPath, JSON.stringify(raw));
  return dataPath;
}

describe('affected-test-shards selector — path-observer prefix boundary safety (issue #3212)', () => {
  it('does not overmatch a sibling directory for a no-slash prefix', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'affected-shards-prefix-'));
    try {
      const dataPath = writeMalformedPrefixData(dir);
      const { selectAffectedShards } = await loadSelector();
      const result = selectAffectedShards({
        event: PR_EVENT,
        changedPaths: ['packages/cli/src/config/settings-schema-other/x.ts'],
        dataPath,
      });
      expect(result.selectedShards).toContain('cli');
      expect(result.selectedShards).not.toContain('scripts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still matches a real descendant for a no-slash prefix', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'affected-shards-prefix-'));
    try {
      const dataPath = writeMalformedPrefixData(dir);
      const { selectAffectedShards } = await loadSelector();
      const result = selectAffectedShards({
        event: PR_EVENT,
        changedPaths: [
          'packages/cli/src/config/settings-schema/schema-core.ts',
        ],
        dataPath,
      });
      expect(result.selectedShards).toContain('cli');
      expect(result.selectedShards).toContain('scripts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
