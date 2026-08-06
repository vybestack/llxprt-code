/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Every Bun-native test root must be executed by exactly one CI shard.
 *
 * The sharded matrix runs each workspace's own `test` script plus the root
 * `test:scripts`; that is the only thing that executes tests. A root nobody
 * runs would silently never execute, and a root two scripts run would burn CI
 * twice for no signal. This is the guarantee that lets the parity job stop
 * re-running the whole manifest.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  BUN_NATIVE_TEST_MANIFEST,
  type BunTestWorkspaceEntry,
} from '../bun-test-manifest.ts';
import { SCRIPTS_SHARD_ROOTS, scriptsRootCommand } from '../test.ts';

const repoRoot = resolve(import.meta.dir, '..', '..');

interface PackageJson {
  readonly workspaces?: readonly string[];
  readonly scripts?: Readonly<Record<string, string>>;
}

function readPackageJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageJson;
}

const rootPackage = readPackageJson(join(repoRoot, 'package.json'));

/**
 * Roots whose files are executed by a workspace's own bespoke Bun runner
 * rather than the shared manifest runner, so no `--workspace` token appears.
 * Each entry names the script that covers it.
 */
const COVERED_BY_BESPOKE_RUNNER: Readonly<Record<string, string>> = {
  // packages/core/run-bun-tests.ts scans src/ and test/, which includes the
  // single file the manifest lists for `core`.
  core: 'packages/core/run-bun-tests.ts',
  // packages/cli/run-bun-tests.ts discovers every test file in the workspace
  // (issue #2843), which subsumes the files the manifest used to list for
  // `cli`.
  cli: 'packages/cli/run-bun-tests.ts',
};

/**
 * Every command the sharded CI matrix actually executes.
 *
 * The scripts shard runs through `scripts/test.ts`, not the root
 * `test:scripts` script, so the roots come from the orchestrator's own list —
 * reading package.json here would have checked a command CI never runs.
 */
function executingScripts(): readonly string[] {
  const scripts: string[] = SCRIPTS_SHARD_ROOTS.map(scriptsRootCommand);
  for (const relativePath of rootPackage.workspaces ?? []) {
    const workspacePackage = readPackageJson(
      join(repoRoot, relativePath, 'package.json'),
    );
    const test = workspacePackage.scripts?.['test'];
    if (test !== undefined) {
      scripts.push(test);
    }
  }
  return scripts;
}

function scriptsRunning(root: string): readonly string[] {
  const pattern = new RegExp(`(?:--workspace|--root|-w)[= ]${root}(?:\\s|$)`);
  return executingScripts().filter(
    (script) => script.includes('run_bun_tests') && pattern.test(script),
  );
}

const offlineRoots: readonly BunTestWorkspaceEntry[] =
  BUN_NATIVE_TEST_MANIFEST.filter((entry) => entry.credentialed !== true);

describe('Bun-native manifest root ownership', () => {
  it('has at least one root to check', () => {
    expect(offlineRoots.length).toBeGreaterThan(0);
  });

  for (const entry of offlineRoots) {
    const bespoke = COVERED_BY_BESPOKE_RUNNER[entry.workspace];

    it(`runs the "${entry.workspace}" root exactly once`, () => {
      const runners = scriptsRunning(entry.workspace);
      if (bespoke !== undefined) {
        // A bespoke runner already covers these files; the shared runner must
        // not also run them, or they would execute twice in the same shard.
        expect(runners).toEqual([]);
        return;
      }
      expect(runners).toHaveLength(1);
    });
  }

  it('runs every credentialed root only on explicit request', () => {
    const credentialed = BUN_NATIVE_TEST_MANIFEST.filter(
      (entry) => entry.credentialed === true,
    );
    expect(credentialed.length).toBeGreaterThan(0);
    for (const entry of credentialed) {
      // Credentialed roots call a real provider, so no workspace `test` script
      // may pull them into the offline gate.
      expect(scriptsRunning(entry.workspace)).toEqual([]);
    }
  });
});
