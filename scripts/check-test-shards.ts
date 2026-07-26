#!/usr/bin/env bun
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Completeness guard for CI test sharding (issue #2707).
 *
 * Fails CI if any workspace declared in package.json is not assigned to a
 * shard in `scripts/test-shards.ts`. Without this guard, adding a package
 * would silently go untested because the shard map would not include it.
 *
 * Modeled on the existing `scripts/check-*.ts` guards. Reads the root
 * package.json `workspaces` array, resolves each entry's last path segment
 * (the workspace id used by the shard map), and validates coverage via
 * `validateShardCoverage`.
 *
 * Usage:
 *   bun scripts/check-test-shards.ts
 *
 * Exits 0 on success, 1 on any coverage issue.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TEST_SHARDS,
  validateShardCoverage,
  type ShardCoverageIssue,
} from './test-shards.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

interface RootPackageJson {
  workspaces?: string[];
}

function readDeclaredWorkspaceIds(rootDir: string): readonly string[] {
  const pkgPath = join(rootDir, 'package.json');
  let raw: string;
  try {
    raw = readFileSync(pkgPath, 'utf8');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`Failed to read ${pkgPath}: ${msg}`);
    process.exit(1);
  }
  let pkg: RootPackageJson;
  try {
    pkg = JSON.parse(raw) as RootPackageJson;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`Failed to parse ${pkgPath} (invalid JSON): ${msg}`);
    process.exit(1);
  }
  const globs = pkg.workspaces ?? [];

  // Only count workspaces that exist on disk, matching the discovery behavior
  // of scripts/test.ts (it skips entries without a package.json). This avoids
  // false "missing-workspace" failures for placeholders.
  return globs
    .map((g) => {
      const pkgJsonPath = join(rootDir, g, 'package.json');
      if (!existsSync(pkgJsonPath)) {
        return undefined;
      }
      return g.split('/').pop() ?? g;
    })
    .filter((id): id is string => id !== undefined);
}

function formatIssue(issue: ShardCoverageIssue): string {
  return `  - [${issue.kind}] ${issue.detail}`;
}

function main(): void {
  const declaredIds = readDeclaredWorkspaceIds(REPO_ROOT);
  console.log(
    `test-shards guard: ${declaredIds.length} workspaces declared, ` +
      `${TEST_SHARDS.length} shards configured.`,
  );

  const { issues, ok } = validateShardCoverage(TEST_SHARDS, declaredIds);

  if (!ok) {
    console.error('\ntest-shards guard FAILED:');
    for (const issue of issues) {
      console.error(formatIssue(issue));
    }
    console.error(
      '\nFix: update the shard map in scripts/test-shards.ts so every ' +
        'workspace is assigned to exactly one shard.',
    );
    process.exit(1);
  }

  console.log('test-shards guard PASSED: every workspace is sharded.');
  process.exit(0);
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
