/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Windows installed-command workflow wiring tests (issue #3249).
 *
 * These read the REAL .github/workflows/windows-installed-command.yml and
 * .github/workflows/nightly.yml through the typed test helpers and lock in
 * the post-#3249 wiring contract:
 *
 *   - the Windows workflow no longer triggers on pull_request or push: the
 *     20-45 min windows-latest install smoke + benchmark sat on virtually
 *     every PR's critical path via the `packages/<name>/src` path glob.
 *     Re-adding either trigger MUST fail these tests.
 *   - it exposes workflow_call (nightly.yml invokes it as a reusable
 *     workflow) and workflow_dispatch (manual debugging of Windows-specific
 *     install failures), with a single unguarded Windows job — the #2693
 *     relevance gate only existed to protect the per-PR path and is gone.
 *   - the smoke steps themselves are preserved: Node from .nvmrc, Bun from
 *     .bun-version, PowerShell 7 path export, npm ci, the
 *     windows-installed-command-smoke.cjs behavioral smoke + benchmark, and
 *     the failure-path diagnostic artifact upload with pinned actions.
 *   - nightly.yml calls the reusable workflow and surfaces its result in
 *     the notify_failure failed-jobs aggregation.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseWorkflowYaml,
  workflowJob,
  workflowJobOptional,
  workflowOn,
  asNumber,
  asOptionalRecord,
  jobSteps,
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
const NIGHTLY_PATH = resolve(repoRoot, '.github', 'workflows', 'nightly.yml');

describe('windows-installed-command.yml: issue #3249 trigger wiring', () => {
  let workflow: WorkflowDocument;

  beforeAll(() => {
    workflow = parseWorkflowYaml(readFileSync(WORKFLOW_PATH, 'utf8'));
  });

  it('does NOT trigger on pull_request (regression guard for #3249)', () => {
    const on = workflowOn(workflow);
    expect(on['pull_request']).toBeUndefined();
  });

  it('does NOT trigger on push (regression guard for #3249)', () => {
    const on = workflowOn(workflow);
    expect(on['push']).toBeUndefined();
  });

  it('triggers on workflow_call so nightly can invoke it', () => {
    const on = workflowOn(workflow);
    expect(on['workflow_call']).toBeDefined();
  });

  it('defines EXACTLY the workflow_call and workflow_dispatch triggers', () => {
    // Exact-set guard: a supplementary event such as pull_request_target
    // would restore per-PR Windows allocation while satisfying the
    // individual no-pull_request/no-push assertions above.
    const on = workflowOn(workflow);
    expect(Object.keys(on).sort()).toEqual([
      'workflow_call',
      'workflow_dispatch',
    ]);
  });
});

describe('windows-installed-command.yml: single unguarded Windows job', () => {
  let workflow: WorkflowDocument;

  beforeAll(() => {
    workflow = parseWorkflowYaml(readFileSync(WORKFLOW_PATH, 'utf8'));
  });

  it('defines exactly one job (no windows_relevance gate remains)', () => {
    expect(Object.keys(workflow.jobs ?? {})).toEqual([
      'windows-installed-command',
    ]);
    expect(workflowJobOptional(workflow, 'windows_relevance')).toBeUndefined();
  });

  it('runs on windows-latest with no needs dependency', () => {
    const job = workflowJob(workflow, 'windows-installed-command');
    expect(job['runs-on']).toBe('windows-latest');
    expect(job.needs).toBeUndefined();
  });

  it('has a timeout at or below 60 minutes', () => {
    const job = workflowJob(workflow, 'windows-installed-command');
    const timeout = job['timeout-minutes'];
    expect(typeof timeout).toBe('number');
    expect(asNumber(timeout)).toBeLessThanOrEqual(60);
  });

  it('declares job-level contents: read permission', () => {
    const job = workflowJob(workflow, 'windows-installed-command');
    const permissions = asOptionalRecord(job['permissions']);
    expect(permissions?.['contents']).toBe('read');
  });
});

describe('windows-installed-command.yml: smoke steps survive the rewiring', () => {
  let workflow: WorkflowDocument;
  let workflowSource: string;

  beforeAll(() => {
    workflow = parseWorkflowYaml(readFileSync(WORKFLOW_PATH, 'utf8'));
    workflowSource = readFileSync(WORKFLOW_PATH, 'utf8');
  });

  it('runs the committed behavioral smoke + benchmark script', () => {
    const steps = jobSteps(workflowJob(workflow, 'windows-installed-command'));
    const smokeStep = steps.find((s) =>
      (s.run ?? '').includes(
        'node scripts/windows-installed-command-smoke.cjs',
      ),
    );
    expect(smokeStep).toBeDefined();
  });

  it('sets up Node and Bun from the committed version files', () => {
    const steps = jobSteps(workflowJob(workflow, 'windows-installed-command'));
    const nodeStep = steps.find(
      (s) =>
        typeof s.uses === 'string' && s.uses.startsWith('actions/setup-node'),
    );
    expect(nodeStep).toBeDefined();
    expect(String(nodeStep?.with?.['node-version-file'])).toBe('.nvmrc');
    const bunStep = steps.find(
      (s) =>
        typeof s.uses === 'string' && s.uses.startsWith('oven-sh/setup-bun'),
    );
    expect(bunStep).toBeDefined();
    expect(String(bunStep?.with?.['bun-version-file'])).toBe('.bun-version');
  });

  it('exports PowerShell 7 path and installs dependencies with npm ci', () => {
    const steps = jobSteps(workflowJob(workflow, 'windows-installed-command'));
    const pwshStep = steps.find(
      (s) => s.shell === 'pwsh' && /PWSH_PATH/.test(s.run ?? ''),
    );
    expect(pwshStep).toBeDefined();
    const npmCiStep = steps.find((s) => (s.run ?? '').trim() === 'npm ci');
    expect(npmCiStep).toBeDefined();
  });

  it('uploads a diagnostic artifact on failure', () => {
    const steps = jobSteps(workflowJob(workflow, 'windows-installed-command'));
    const artifactStep = steps.find(
      (s) => typeof s.uses === 'string' && s.uses.includes('upload-artifact'),
    );
    expect(artifactStep).toBeDefined();
    const condition = artifactStep?.if;
    expect(condition).toBeTruthy();
    expect(condition ?? '').toContain('failure()');
  });

  it('keeps every action pinned to a full SHA with a ratchet comment', () => {
    const steps = jobSteps(workflowJob(workflow, 'windows-installed-command'));
    const usesRefs = steps
      .map((s) => s.uses)
      .filter((u): u is string => typeof u === 'string');
    expect(usesRefs.length).toBeGreaterThan(0);
    for (const uses of usesRefs) {
      // Every uses: reference must be action@<40-hex-sha> (never a mutable
      // tag) and carry the ratchet comment that keeps it upgradeable.
      expect(uses).toMatch(/^[^@]+@[0-9a-f]{40}$/);
      const action = uses.split('@')[0];
      expect(workflowSource).toContain(`# ratchet:${action}@`);
    }
  });
});

describe('nightly.yml: windows_installed_command wiring (issue #3249)', () => {
  let nightly: WorkflowDocument;

  beforeAll(() => {
    nightly = parseWorkflowYaml(readFileSync(NIGHTLY_PATH, 'utf8'));
  });

  it('calls the reusable windows-installed-command workflow', () => {
    const job = workflowJob(nightly, 'windows_installed_command');
    expect(job.uses).toBe('./.github/workflows/windows-installed-command.yml');
  });

  it('notify_failure needs windows_installed_command', () => {
    const notify = workflowJob(nightly, 'notify_failure');
    const needs = notify.needs;
    const needsArr = Array.isArray(needs) ? needs : [needs];
    expect(needsArr).toContain('windows_installed_command');
  });

  it('notify_failure passes the job result through env', () => {
    const notify = workflowJob(nightly, 'notify_failure');
    const notifyStep = jobSteps(notify).find((s) =>
      (s.run ?? '').includes('FAILED_JOBS'),
    );
    const env = asOptionalRecord(notifyStep?.env);
    expect(env?.['WINDOWS_INSTALLED_COMMAND_RESULT']).toBe(
      '${{ needs.windows_installed_command.result }}',
    );
  });

  it('notify_failure aggregates windows_installed_command failures', () => {
    const notify = workflowJob(nightly, 'notify_failure');
    const script = jobSteps(notify)
      .map((s) => s.run ?? '')
      .join('\n');
    expect(script).toContain(
      'windows_installed_command=${WINDOWS_INSTALLED_COMMAND_RESULT}',
    );
  });
});
