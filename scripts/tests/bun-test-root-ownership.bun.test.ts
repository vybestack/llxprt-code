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
 * twice for no signal.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BUN_TEST_ROOTS, type BunTestRoot } from '../bun-test-roots.js';
import { TEST_EXECUTORS } from '../check-test-file-coverage.js';
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

const offlineRoots: readonly BunTestRoot[] = BUN_TEST_ROOTS.filter(
  (root) => root.credentialed !== true,
);

describe('Bun-native test root ownership', () => {
  it('has at least one root to check', () => {
    expect(offlineRoots.length).toBeGreaterThan(0);
  });

  for (const entry of offlineRoots) {
    it(`runs the "${entry.root}" root exactly once`, () => {
      const runners = scriptsRunning(entry.root);
      expect(runners).toHaveLength(1);
    });
  }

  it('runs every credentialed root only on explicit request', () => {
    const credentialed = BUN_TEST_ROOTS.filter(
      (entry) => entry.credentialed === true,
    );
    expect(credentialed.length).toBeGreaterThan(0);
    for (const entry of credentialed) {
      // Credentialed roots call a real provider, so no workspace `test` script
      // may pull them into the offline gate.
      expect(scriptsRunning(entry.root)).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Bespoke-runner executors must still be wired in their workspace test scripts
// ---------------------------------------------------------------------------

/**
 * Extracts the workspace name from a bespoke-runner executor name of the form
 * `packages/<workspace> test script (run-bun-tests.ts)`. Returns undefined for
 * executors that do not name a bespoke runner.
 */
function workspaceFromBespokeExecutor(name: string): string | undefined {
  const match =
    /^packages\/([a-z0-9-]+) test script \(run-bun-tests\.ts\)$/.exec(name);
  return match?.[1];
}

interface BespokeWorkspace {
  readonly name: string;
  readonly workspace: string;
}

const bespokeRunnerWorkspaces: readonly BespokeWorkspace[] = TEST_EXECUTORS.map(
  (executor) => ({
    name: executor.name,
    workspace: workspaceFromBespokeExecutor(executor.name),
  }),
).filter((entry): entry is BespokeWorkspace => entry.workspace !== undefined);

describe('bespoke-runner executors are wired by their workspace test script', () => {
  it('has at least one bespoke runner executor to check', () => {
    expect(bespokeRunnerWorkspaces.length).toBeGreaterThan(0);
  });

  for (const { name, workspace } of bespokeRunnerWorkspaces) {
    it(`asserts packages/${workspace} test script invokes run-bun-tests.ts`, () => {
      const pkg = readPackageJson(
        join(repoRoot, 'packages', workspace, 'package.json'),
      );
      const testScript = pkg.scripts?.['test'] ?? '';
      expect(
        testScript,
        `${name}: packages/${workspace} test script must invoke run-bun-tests.ts`,
      ).toContain('run-bun-tests');
    });
  }
});
