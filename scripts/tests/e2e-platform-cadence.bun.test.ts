/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * E2E platform cadence wiring tests (issue #3189).
 *
 * e2e.yml is now Linux-only. Its e2e_linux job serves the PR/target/merge
 * cadence (pull_request, pull_request_target, merge_group), push to main, and
 * manual workflow_dispatch. macOS has moved off that workflow; push was
 * already Linux-only. macOS and Windows E2E are served exclusively by the
 * nightly cadence in nightly.yml's e2e_full matrix, which also re-runs both
 * Linux sandbox legs.
 *
 * These read the REAL committed workflow files through the established typed
 * YAML helpers and assert the approved split:
 *
 * - e2e.yml defines no e2e_mac job and allocates no E2E job to a macOS or
 *   Windows runner. The Linux PR matrix retains exactly sandbox:none and
 *   sandbox:docker, with a single exclusion that drops sandbox:docker only on
 *   push to main.
 * - nightly.yml retains the e2e_full rows for Ubuntu none, Ubuntu Docker,
 *   macOS none, and Windows none; both schedule and workflow_dispatch
 *   triggers exercise the matrix; the matrix is non-fail-fast; E2E failures
 *   remain blocking (no continue-on-error tolerance) and report through the
 *   nightly aggregator; and nightly E2E commands run the complete suites
 *   without test narrowing.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  asArray,
  asOptionalRecord,
  asOptionalString,
  asRecord,
  asString,
  asStringArray,
  parseWorkflowYaml,
  workflowJob,
  workflowJobOptional,
  workflowOn,
  type WorkflowDocument,
  type WorkflowJob,
} from './typed-test-helpers.ts';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const E2E_WORKFLOW_PATH = resolve(repoRoot, '.github', 'workflows', 'e2e.yml');
const NIGHTLY_WORKFLOW_PATH = resolve(
  repoRoot,
  '.github',
  'workflows',
  'nightly.yml',
);

function loadE2eWorkflow(): WorkflowDocument {
  return parseWorkflowYaml(readFileSync(E2E_WORKFLOW_PATH, 'utf8'));
}

function loadNightlyWorkflow(): WorkflowDocument {
  return parseWorkflowYaml(readFileSync(NIGHTLY_WORKFLOW_PATH, 'utf8'));
}

function jobRunsOn(job: WorkflowJob): string | undefined {
  const runsOn = job['runs-on'];
  if (runsOn === undefined) return undefined;
  if (typeof runsOn === 'string') return runsOn;
  if (Array.isArray(runsOn)) return asStringArray(runsOn).join(',');
  throw new Error('job runs-on should be a string or array');
}

describe('e2e.yml: macOS E2E is off the PR feedback path (issue #3189)', () => {
  let workflow: WorkflowDocument;

  beforeAll(() => {
    workflow = loadE2eWorkflow();
  });

  it('does not define an e2e_mac job', () => {
    expect(workflowJobOptional(workflow, 'e2e_mac')).toBeUndefined();
  });

  it('allocates every runner-backed E2E workflow job to Ubuntu', () => {
    const jobs = workflow.jobs;
    if (!jobs) throw new Error('e2e.yml should define jobs');
    for (const [name, job] of Object.entries(jobs)) {
      const runsOn = jobRunsOn(job);
      if (runsOn === undefined) continue;
      expect(runsOn, `e2e.yml job ${name} must run explicitly on Ubuntu`).toBe(
        'ubuntu-latest',
      );
    }
  });

  it('retains the Linux E2E job with exactly sandbox:none and sandbox:docker', () => {
    const linux = workflowJob(workflow, 'e2e_linux');
    expect(jobRunsOn(linux)).toBe('ubuntu-latest');
    const strategy = asOptionalRecord(linux.strategy);
    const matrix = asOptionalRecord(strategy?.matrix);
    const sandbox = asStringArray(matrix?.sandbox);
    expect(sandbox).toEqual(['sandbox:none', 'sandbox:docker']);
  });

  it('excludes only sandbox:docker on push, leaving both legs for all other events', () => {
    const linux = workflowJob(workflow, 'e2e_linux');
    const strategy = asOptionalRecord(linux.strategy);
    const matrix = asOptionalRecord(strategy?.matrix);
    const exclude = asArray(matrix?.exclude).map((row) => {
      const rec = asRecord(row);
      return { sandbox: asString(rec.sandbox) };
    });
    // Exactly one exclusion: drop sandbox:docker only when the event is push.
    // pull_request, approved pull_request_target, merge_group, and
    // workflow_dispatch all receive both Linux sandbox legs.
    expect(exclude).toEqual([
      {
        sandbox:
          "${{ github.event_name == 'push' && 'sandbox:docker' || 'NEVER_MATCH' }}",
      },
    ]);
  });

  it('wires the Linux E2E real-model budget ledger and enforcement step', () => {
    const linux = workflowJob(workflow, 'e2e_linux');
    const steps = linux.steps ?? [];

    const runStep = steps.find((s) => s.name === 'Run E2E tests');
    expect(runStep, 'e2e_linux should have a Run E2E tests step').toBeTruthy();
    const runEnv = asOptionalRecord(runStep?.env);
    expect(runEnv?.LLXPRT_E2E_MODEL_LEDGER).toBe(
      '${{ runner.temp }}/e2e-model-ledger.jsonl',
    );

    const budgetStep = steps.find(
      (s) => s.name === 'Check E2E real-model budget (issue #2278)',
    );
    expect(
      budgetStep,
      'e2e_linux should retain the budget check step',
    ).toBeTruthy();
    expect(budgetStep?.if).toBe('success()');
    const budgetEnv = asOptionalRecord(budgetStep?.env);
    expect(budgetEnv?.LLXPRT_E2E_MODEL_LEDGER).toBe(
      '${{ runner.temp }}/e2e-model-ledger.jsonl',
    );
    expect(asString(budgetStep?.run).trim()).toBe(
      'bun scripts/check-e2e-model-budget.ts --ledger "$LLXPRT_E2E_MODEL_LEDGER"',
    );
  });
});

describe('nightly.yml: macOS and Windows E2E remain on the nightly cadence (issue #3189)', () => {
  let workflow: WorkflowDocument;

  beforeAll(() => {
    workflow = loadNightlyWorkflow();
  });

  it('retains both the exact nightly schedule and workflow_dispatch trigger', () => {
    const on = workflowOn(workflow);
    const schedule = asArray(on.schedule).map((entry) => {
      const record = asRecord(entry);
      return { cron: asString(record.cron) };
    });
    expect(schedule).toEqual([{ cron: '0 6 * * *' }]);
    expect(
      Object.prototype.hasOwnProperty.call(on, 'workflow_dispatch'),
      'nightly.yml should define a workflow_dispatch trigger',
    ).toBe(true);
  });

  it('defines e2e_full and allocates each row through matrix.os', () => {
    const e2eFull = workflowJob(workflow, 'e2e_full');
    expect(e2eFull['runs-on']).toBe('${{ matrix.os }}');
  });

  it('retains the exact platform/sandbox matrix rows', () => {
    const e2eFull = workflowJob(workflow, 'e2e_full');
    const strategy = asOptionalRecord(e2eFull.strategy);
    const matrix = asOptionalRecord(strategy?.matrix);
    const include = asArray(matrix?.include).map((row) => {
      const rec = asRecord(row);
      return {
        os: asString(rec.os),
        sandbox: asString(rec.sandbox),
        'node-version': asString(rec['node-version']),
      };
    });
    expect(include).toEqual([
      {
        os: 'ubuntu-latest',
        sandbox: 'sandbox:none',
        'node-version': '24.x',
      },
      {
        os: 'ubuntu-latest',
        sandbox: 'sandbox:docker',
        'node-version': '24.x',
      },
      {
        os: 'macos-latest',
        sandbox: 'sandbox:none',
        'node-version': '24.x',
      },
      {
        os: 'windows-latest',
        sandbox: 'sandbox:none',
        'node-version': '24.x',
      },
    ]);
  });

  it('keeps the e2e_full matrix non-fail-fast so one platform does not mask another', () => {
    const e2eFull = workflowJob(workflow, 'e2e_full');
    const strategy = asOptionalRecord(e2eFull.strategy);
    expect(strategy?.['fail-fast']).toBe(false);
  });

  it('retains both non-Windows and Windows E2E execution paths', () => {
    const e2eFull = workflowJob(workflow, 'e2e_full');
    const steps = e2eFull.steps ?? [];
    const stepNames = steps.map((s) => s.name);
    expect(stepNames).toContain('Run E2E tests');
    expect(stepNames).toContain('Run E2E tests (Windows)');
  });

  it('gates the non-Windows path on runner.os != Windows', () => {
    const e2eFull = workflowJob(workflow, 'e2e_full');
    const steps = e2eFull.steps ?? [];
    const nonWindows = steps.find((s) => s.name === 'Run E2E tests');
    expect(nonWindows?.if).toBe("runner.os != 'Windows'");
  });

  it('gates the Windows path on runner.os == Windows', () => {
    const e2eFull = workflowJob(workflow, 'e2e_full');
    const steps = e2eFull.steps ?? [];
    const windows = steps.find((s) => s.name === 'Run E2E tests (Windows)');
    expect(windows?.if).toBe("runner.os == 'Windows'");
  });

  it('e2e_full has no event condition that excludes schedule or workflow_dispatch', () => {
    const e2eFull = workflowJob(workflow, 'e2e_full');
    const condition = asOptionalString(e2eFull.if);
    expect(
      condition,
      'e2e_full should not be gated by an event condition',
    ).toBeUndefined();
  });

  it('non-Windows E2E selects the complete suite for the matrix sandbox', () => {
    const e2eFull = workflowJob(workflow, 'e2e_full');
    const nonWindows = (e2eFull.steps ?? []).find(
      (s) => s.name === 'Run E2E tests',
    );
    const run = asString(nonWindows?.run).trim();
    expect(run).toBe(
      [
        'if [[ "${{ matrix.sandbox }}" == "sandbox:docker" ]]; then',
        '  npm run test:integration:sandbox:docker',
        'else',
        '  npm run test:integration:sandbox:none',
        'fi',
      ].join('\n'),
    );
  });

  it('Windows E2E selects the complete suite for the matrix sandbox', () => {
    const e2eFull = workflowJob(workflow, 'e2e_full');
    const windows = (e2eFull.steps ?? []).find(
      (s) => s.name === 'Run E2E tests (Windows)',
    );
    const env = asOptionalRecord(windows?.env);
    expect(env?.SANDBOX).toBe('${{ matrix.sandbox }}');
    const run = asString(windows?.run).trim();
    expect(run).toBe(
      [
        "if ($env:SANDBOX -eq 'sandbox:docker') {",
        '  npm run test:integration:sandbox:docker',
        '} else {',
        '  npm run test:integration:sandbox:none',
        '}',
      ].join('\n'),
    );
  });
});

describe('nightly.yml: macOS and Windows E2E failures remain blocking and visible (issue #3189)', () => {
  let workflow: WorkflowDocument;

  beforeAll(() => {
    workflow = loadNightlyWorkflow();
  });

  it('the failure aggregator depends on e2e_full', () => {
    const notify = workflowJob(workflow, 'notify_failure');
    const needs = notify.needs;
    expect(needs, 'notify_failure should declare needs').toBeDefined();
    const needsArray = Array.isArray(needs)
      ? asStringArray(needs)
      : [asString(needs)];
    expect(needsArray).toContain('e2e_full');
  });

  it('the aggregator reports through needs.e2e_full.result', () => {
    const notify = workflowJob(workflow, 'notify_failure');
    const step = (notify.steps ?? []).find(
      (s) => s.name === 'Create Issue on Failure',
    );
    expect(
      step,
      'notify_failure should have Create Issue on Failure step',
    ).toBeTruthy();
    const env = asOptionalRecord(step?.env);
    expect(env?.E2E_FULL_RESULT).toBe('${{ needs.e2e_full.result }}');
  });

  it('the aggregator runs on failure or cancellation', () => {
    const notify = workflowJob(workflow, 'notify_failure');
    const condition = asString(notify.if);
    expect(condition).toContain('always()');
    expect(condition).toContain("contains(needs.*.result, 'failure')");
    expect(condition).toContain("contains(needs.*.result, 'cancelled')");
  });

  it('e2e_full has no job-level continue-on-error tolerance', () => {
    const e2eFull = workflowJob(workflow, 'e2e_full');
    expect(
      e2eFull['continue-on-error'],
      'e2e_full must not enable continue-on-error at the job level',
    ).toBeFalsy();
  });

  it('no E2E execution step enables continue-on-error', () => {
    const e2eFull = workflowJob(workflow, 'e2e_full');
    const steps = e2eFull.steps ?? [];
    const e2eRunSteps = steps.filter(
      (s) => s.name === 'Run E2E tests' || s.name === 'Run E2E tests (Windows)',
    );
    expect(e2eRunSteps).toHaveLength(2);
    for (const step of e2eRunSteps) {
      expect(
        step['continue-on-error'],
        `step "${step.name}" must not enable continue-on-error`,
      ).toBeFalsy();
    }
  });

  it('no e2e_full matrix row enables continue-on-error', () => {
    const e2eFull = workflowJob(workflow, 'e2e_full');
    const strategy = asOptionalRecord(e2eFull.strategy);
    const matrix = asOptionalRecord(strategy?.matrix);
    const include = asArray(matrix?.include);
    for (const row of include) {
      const rec = asRecord(row);
      expect(
        rec['continue-on-error'],
        'no matrix row may enable continue-on-error',
      ).toBeFalsy();
    }
  });
});
