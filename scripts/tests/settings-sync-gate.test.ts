/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test for the settings docs/schema synchronization correctness
 * gate (issue #3212).
 *
 * The settings-sync gate runs the real `generate-settings-doc.ts` in `--check`
 * mode so that any drift between the checked-in settings source/schema and the
 * generated docs/schema fails CI unconditionally — independent of shard
 * selection. Path observers remain an optimization for *skipping* shards; they
 * must never be the sole correctness guard.
 *
 * This test reads the REAL package.json and ci.yml and asserts:
 *  1. package.json exposes `lint:settings-sync` executing
 *     `bun ./scripts/generate-settings-doc.ts --check`.
 *  2. The `lint_javascript` job runs `lint:settings-sync` as an unconditional
 *     step (no path-filtering `if`) BEFORE the declaration-only build.
 *
 * YAML is parsed with the established `parseWorkflowYaml` convention rather
 * than fragile raw-substring ordering.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseWorkflowYaml,
  jobSteps,
  type WorkflowDocument,
  type WorkflowStep,
} from './typed-test-helpers.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf-8');
}

function rootScripts(): Record<string, string> {
  const pkg = JSON.parse(readRepoFile('package.json')) as {
    scripts?: Record<string, string>;
  };
  return pkg.scripts ?? {};
}

function ciDocument(): WorkflowDocument {
  return parseWorkflowYaml(readRepoFile('.github/workflows/ci.yml'));
}

function lintJavascriptSteps(): WorkflowStep[] {
  const doc = ciDocument();
  const job = doc.jobs?.['lint_javascript'];
  if (job === undefined) {
    throw new Error('ci.yml must contain a lint_javascript job');
  }
  return jobSteps(job);
}

describe('issue #3212 — settings-sync correctness gate', () => {
  it('exposes lint:settings-sync running the generator in check mode', () => {
    const scripts = rootScripts();
    const sync = scripts['lint:settings-sync'];
    expect(
      sync,
      'package.json must define a lint:settings-sync script',
    ).toBeDefined();
    expect(sync).toBe('bun ./scripts/generate-settings-doc.ts --check');
  });

  it('runs lint:settings-sync inside the lint_javascript job', () => {
    const steps = lintJavascriptSteps();
    const syncSteps = steps.filter((step) =>
      String(step.run ?? '').includes('npm run lint:settings-sync'),
    );
    expect(
      syncSteps.length,
      'lint_javascript must invoke npm run lint:settings-sync',
    ).toBe(1);
  });

  it('runs lint:settings-sync before the declaration-only build step', () => {
    const steps = lintJavascriptSteps();
    const buildIndex = steps.findIndex((step) =>
      String(step.run ?? '').includes('npm run build:types'),
    );
    expect(
      buildIndex,
      'lint_javascript must contain an npm run build:types step',
    ).toBeGreaterThanOrEqual(0);

    const syncIndex = steps.findIndex((step) =>
      String(step.run ?? '').includes('npm run lint:settings-sync'),
    );
    expect(
      syncIndex,
      'lint_javascript must contain an npm run lint:settings-sync step',
    ).toBeGreaterThanOrEqual(0);

    expect(
      syncIndex,
      'lint:settings-sync must run before build:types replaces runtime output with declarations',
    ).toBeLessThan(buildIndex);
  });

  it('runs lint:settings-sync unconditionally (no path-filtering gate)', () => {
    const steps = lintJavascriptSteps();
    const syncStep = steps.find((step) =>
      String(step.run ?? '').includes('npm run lint:settings-sync'),
    );
    expect(syncStep, 'lint:settings-sync step must exist').toBeDefined();
    // An unconditional step has no `if:` condition that could gate it on
    // changed paths or shard selection.
    expect(syncStep?.if).toBeUndefined();
  });
});
