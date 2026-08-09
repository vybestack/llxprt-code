/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Windows installed-command workflow wiring tests (issue #2693).
 *
 * These read the REAL .github/workflows/windows-installed-command.yml through
 * existing typed test helpers and assert:
 *   - a cheap Ubuntu relevance job exists and gates only the Windows runner
 *   - the relevance job invokes the committed classifier script
 *   - the Windows job skips ONLY on an explicit successful
 *     windows_relevant=false, and runs on relevance-job failure / missing /
 *     invalid output (fail-closed)
 *   - PR and push path filters are symmetric
 *   - all confirmed relevant paths are present (release helpers, packed
 *     assets, install config)
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseWorkflowYaml,
  workflowJob,
  workflowOn,
  asOptionalRecord,
  type WorkflowDocument,
} from './typed-test-helpers.ts';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const WORKFLOW_PATH = resolve(
  repoRoot,
  '.github',
  'workflows',
  'windows-installed-command.yml',
);

function loadWorkflow(): WorkflowDocument {
  return parseWorkflowYaml(readFileSync(WORKFLOW_PATH, 'utf8'));
}

/** Collects all path strings from a pull_request or push trigger. */
function triggerPaths(on: Record<string, unknown>, key: string): string[] {
  const trigger = on[key];
  if (trigger === undefined || trigger === null) return [];
  if (typeof trigger === 'object' && !Array.isArray(trigger)) {
    const rec = trigger as Record<string, unknown>;
    const paths = rec['paths'];
    if (Array.isArray(paths)) {
      return paths.filter((p): p is string => typeof p === 'string');
    }
  }
  return [];
}

describe('windows-installed-command.yml: relevance job wiring', () => {
  let workflow: WorkflowDocument;

  beforeAll(() => {
    workflow = loadWorkflow();
  });

  it('has a windows_relevance job on ubuntu-latest', () => {
    const job = workflowJob(workflow, 'windows_relevance');
    expect(job['runs-on']).toBe('ubuntu-latest');
  });

  it('the windows_relevance job invokes the committed classifier script', () => {
    const job = workflowJob(workflow, 'windows_relevance');
    const steps = job.steps ?? [];
    const classifyStep = steps.find((s) =>
      (s.run ?? '').includes('windows-installed-command-relevance.ts'),
    );
    expect(classifyStep).toBeDefined();
    expect(classifyStep?.id).toBe('classify');
  });

  it('the windows_relevance job outputs windows_relevant', () => {
    const job = workflowJob(workflow, 'windows_relevance');
    const outputs = asOptionalRecord(job['outputs']);
    expect(outputs?.['windows_relevant']).toBeDefined();
  });

  it('the windows_relevance job has a short timeout (cheap)', () => {
    const job = workflowJob(workflow, 'windows_relevance');
    const timeout = job['timeout-minutes'];
    expect(typeof timeout).toBe('number');
    expect(timeout as number).toBeLessThanOrEqual(10);
  });

  it('the windows-installed-command job needs windows_relevance', () => {
    const job = workflowJob(workflow, 'windows-installed-command');
    const needs = job.needs;
    const needsArr = Array.isArray(needs) ? needs : [needs];
    expect(needsArr).toContain('windows_relevance');
  });

  it('the windows-installed-command job still runs on windows-latest', () => {
    const job = workflowJob(workflow, 'windows-installed-command');
    expect(job['runs-on']).toBe('windows-latest');
  });
});

describe('windows-installed-command.yml: fail-closed gate (skip ONLY on success+false)', () => {
  // The Windows job must run whenever the relevance gate is uncertain:
  // relevance-job failure, missing output, or invalid output all select RUN.
  // The ONLY skip is an explicit successful windows_relevant=false.
  //
  // A condition like `outputs.windows_relevant == 'true'` is WRONG because it
  // skips (empty != 'true') when the relevance job fails or emits no output.
  // The correct condition runs unless relevance succeeded AND said 'false'.
  let condition: string;

  beforeAll(() => {
    const job = workflowJob(loadWorkflow(), 'windows-installed-command');
    condition = job.if ?? '';
  });

  it('the if: condition is defined', () => {
    expect(condition.length).toBeGreaterThan(0);
  });

  it('does NOT use the fail-open == true pattern', () => {
    // `== 'true'` skips on empty output (relevance failure), which is a
    // false-negative. The gate must invert: skip only on explicit false.
    expect(condition).not.toMatch(/==\s*'true'/);
  });

  it('references the relevance job result (so failure can select run)', () => {
    // To override the implicit success() default and run on a dependency
    // failure, the condition must reference needs.<job>.result.
    expect(condition).toMatch(/needs\.windows_relevance\.result/);
  });

  it('skips only when relevance succeeded AND output is false', () => {
    // The skip path requires BOTH result == 'success' AND output == 'false'.
    expect(condition).toMatch(/result\s*==\s*'success'/);
    expect(condition).toMatch(/windows_relevant\s*==\s*'false'/);
  });

  it('guards against cancellation (!cancelled)', () => {
    expect(condition).toMatch(/!cancelled\(\)/);
  });
});

describe('windows-installed-command.yml: PR and push path filters', () => {
  let workflow: WorkflowDocument;

  beforeAll(() => {
    workflow = loadWorkflow();
  });

  it('PR and push triggers both define paths', () => {
    const on = workflowOn(workflow);
    expect(triggerPaths(on, 'pull_request').length).toBeGreaterThan(0);
    expect(triggerPaths(on, 'push').length).toBeGreaterThan(0);
  });

  it('PR and push path filters are symmetric', () => {
    const on = workflowOn(workflow);
    const prPaths = triggerPaths(on, 'pull_request').sort();
    const pushPaths = triggerPaths(on, 'push').sort();
    expect(prPaths).toEqual(pushPaths);
  });

  it('root package.json remains a coarse candidate (semantic gate, not removal)', () => {
    const on = workflowOn(workflow);
    const prPaths = triggerPaths(on, 'pull_request');
    expect(prPaths).toContain('package.json');
  });

  it('package-lock.json is always relevant', () => {
    const on = workflowOn(workflow);
    const prPaths = triggerPaths(on, 'pull_request');
    expect(prPaths).toContain('package-lock.json');
  });

  it('.nvmrc is a verified relevant input (Node version file)', () => {
    const on = workflowOn(workflow);
    const prPaths = triggerPaths(on, 'pull_request');
    expect(prPaths).toContain('.nvmrc');
  });

  it('.bun-version is a verified relevant input (Bun version file)', () => {
    const on = workflowOn(workflow);
    const prPaths = triggerPaths(on, 'pull_request');
    expect(prPaths).toContain('.bun-version');
  });

  it('.npmrc is a verified relevant input (install/pack config)', () => {
    const on = workflowOn(workflow);
    const prPaths = triggerPaths(on, 'pull_request');
    expect(prPaths).toContain('.npmrc');
  });

  it('README.md is a candidate (deletion of packed asset must run)', () => {
    const on = workflowOn(workflow);
    const prPaths = triggerPaths(on, 'pull_request');
    expect(prPaths).toContain('README.md');
  });

  it('LICENSE is a candidate (deletion of packed asset must run)', () => {
    const on = workflowOn(workflow);
    const prPaths = triggerPaths(on, 'pull_request');
    expect(prPaths).toContain('LICENSE');
  });

  it('release helper scripts/lib/npm-command.cjs is a candidate', () => {
    const on = workflowOn(workflow);
    const prPaths = triggerPaths(on, 'pull_request');
    expect(prPaths).toContain('scripts/lib/npm-command.cjs');
  });

  it('release helper scripts/lib/tar-command.cjs is a candidate', () => {
    const on = workflowOn(workflow);
    const prPaths = triggerPaths(on, 'pull_request');
    expect(prPaths).toContain('scripts/lib/tar-command.cjs');
  });

  it('release helper scripts/utils/release-packages.ts is a candidate', () => {
    const on = workflowOn(workflow);
    const prPaths = triggerPaths(on, 'pull_request');
    expect(prPaths).toContain('scripts/utils/release-packages.ts');
  });

  it('release helper scripts/utils/error-guards.ts is a candidate', () => {
    const on = workflowOn(workflow);
    const prPaths = triggerPaths(on, 'pull_request');
    expect(prPaths).toContain('scripts/utils/error-guards.ts');
  });

  it('publishable package runtime source (packages/*/src/**) is a candidate', () => {
    const on = workflowOn(workflow);
    const prPaths = triggerPaths(on, 'pull_request');
    expect(prPaths).toContain('packages/*/src/**');
  });

  it('publishable package entry points (packages/*/index.ts) are candidates', () => {
    const on = workflowOn(workflow);
    const prPaths = triggerPaths(on, 'pull_request');
    expect(prPaths).toContain('packages/*/index.ts');
  });

  it('CLI bundle (packages/cli/bundle/**) is a candidate', () => {
    const on = workflowOn(workflow);
    const prPaths = triggerPaths(on, 'pull_request');
    expect(prPaths).toContain('packages/cli/bundle/**');
  });

  it('workflow_dispatch is a trigger', () => {
    const on = workflowOn(workflow);
    expect(on['workflow_dispatch']).toBeDefined();
  });
});

describe('windows-installed-command.yml: relevance job is fail-safe', () => {
  let workflowSource: string;

  beforeAll(() => {
    workflowSource = readFileSync(WORKFLOW_PATH, 'utf8');
  });

  it('the relevance step invokes the classifier with github-actions output', () => {
    expect(workflowSource).toContain('windows-installed-command-relevance.ts');
    expect(workflowSource).toContain('--output github-actions');
  });

  it('the relevance job has read permissions for contents and pull-requests', () => {
    const job = workflowJob(loadWorkflow(), 'windows_relevance');
    const perms = asOptionalRecord(job['permissions']);
    expect(perms?.['contents']).toBe('read');
    expect(perms?.['pull-requests']).toBe('read');
  });
});
