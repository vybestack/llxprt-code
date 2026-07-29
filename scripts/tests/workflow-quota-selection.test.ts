/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  asRecord,
  asString,
  jobSteps,
  parseWorkflowYaml,
  workflowJobOptional,
} from './typed-test-helpers.ts';
import type {
  WorkflowDocument,
  WorkflowStep as TypedWorkflowStep,
} from './typed-test-helpers.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');

type Workflow = WorkflowDocument;

function readWorkflow(name: string): Workflow {
  return parseWorkflowYaml(
    fs.readFileSync(path.join(ROOT, '.github/workflows', name), 'utf-8'),
  );
}

function selectedKeyExpression(stepId: string): string {
  return `\${{ steps.${stepId}.outputs.selected_key == 'primary' && secrets[vars.KEY_VAR_NAME] || steps.${stepId}.outputs.selected_key == 'secondary' && secrets[vars.KEY_VAR_NAME_2] || '' }}`;
}

function hasSecret(value: unknown): boolean {
  return /\bsecrets(?:\.|\[)/.test(JSON.stringify(value));
}

function stepNamed(steps: WorkflowStep[], name: string): WorkflowStep {
  return (
    steps.find((step) => step.name === name) ??
    expect.fail(`missing step: ${name}`)
  );
}

type WorkflowStep = TypedWorkflowStep;

/**
 * Structurally verifies the trusted-ref and PR-code-checkout steps for a
 * single E2E job. The trusted checkout ref must cover BOTH pull_request
 * and pull_request_target. After quota selection, the PR code must be
 * checked out via two mutually-exclusive conditional steps — internal target
 * head for pull_request_target and merge ref for pull_request — each with
 * persist-credentials:false. Fork target heads must never be checked out.
 */
function assertJobCheckoutSecurity(
  steps: WorkflowStep[],
  quotaName: string,
  quotaId: string,
): void {
  const trustedCheckout = stepNamed(steps, 'Checkout trusted quota selector');
  const quota = stepNamed(steps, quotaName);
  const targetCheckout = stepNamed(steps, 'Checkout PR head (internal target)');
  const internalCheckout = stepNamed(steps, 'Checkout PR merge ref (internal)');

  expect(quota.id).toBe(quotaId);
  expect(quota.shell).toBe('bash');
  const quotaRun = asString(quota.run);
  expect(quotaRun).toContain('quota_selectors=(scripts/ci-quota-check.*)');
  expect(quotaRun).toContain('${#quota_selectors[@]} != 1');
  expect(quotaRun).toContain('[[ ! -f "${quota_selectors[0]}" ]]');
  expect(quotaRun).toContain('bun "${quota_selectors[0]}"');
  expect(quotaRun).not.toContain('ci-quota-check.js');
  expect(quotaRun).toContain('awk \'!/^OPENAI_API_KEY=/\' "$GITHUB_ENV"');
  expect(asString(quota.run)).toContain(
    'grep -Eq \'^selected_key=(primary|secondary)$\' "$GITHUB_OUTPUT"',
  );
  expect(asString(quota.run)).toContain(
    '[[ "${KEY_VAR_NAME:-}" == *SYNTHETIC* ]]',
  );
  expect(asString(quota.run)).toContain(
    'echo \'selected_key=primary\' >>"$GITHUB_OUTPUT"',
  );

  // Trusted checkout ref must use base.sha for BOTH PR event types.
  const trustedRef = asString(asRecord(trustedCheckout.with).ref);
  expect(trustedRef).toContain("github.event_name == 'pull_request'");
  expect(trustedRef).toContain("github.event_name == 'pull_request_target'");
  expect(trustedRef).toContain('github.event.pull_request.base.sha');
  // Non-PR events must fall back to dispatch input or github.ref.
  expect(trustedRef).toContain('github.event.inputs.branch_ref');
  expect(trustedRef).toContain('github.ref');

  expect(targetCheckout.if).toBe(
    "github.event_name == 'pull_request_target' && github.event.pull_request.head.repo.full_name == github.repository",
  );
  expect(asRecord(targetCheckout.with).ref).toBe(
    '${{ github.event.pull_request.head.sha }}',
  );
  expect(asRecord(targetCheckout.with).repository).toBe(
    '${{ github.repository }}',
  );
  expect(asRecord(targetCheckout.with)['persist-credentials']).toBe(false);

  // Internal PR merge-ref checkout: only for pull_request.
  expect(internalCheckout.if).toBe("github.event_name == 'pull_request'");
  expect(asRecord(internalCheckout.with).ref).toBe('${{ github.ref }}');
  expect(asRecord(internalCheckout.with)['persist-credentials']).toBe(false);
  expect(asRecord(internalCheckout.with).clean).toBe(false);

  // Ordering: trusted → quota → target/internal checkouts.
  const idxTrusted = steps.indexOf(trustedCheckout);
  const idxQuota = steps.indexOf(quota);
  const idxTarget = steps.indexOf(targetCheckout);
  const idxInternal = steps.indexOf(internalCheckout);

  expect(idxTrusted).toBeLessThan(idxQuota);
  expect(idxQuota).toBeLessThan(idxTarget);
  expect(idxQuota).toBeLessThan(idxInternal);
}

describe('quota-selected workflow credentials', () => {
  it('maps Linux and macOS E2E quota outputs into validation and test steps', () => {
    const workflow = readWorkflow('e2e.yml');
    expect(workflow.permissions).toEqual({
      actions: 'read',
      contents: 'read',
      'pull-requests': 'read',
    });
    const jobs = workflow.jobs;
    if (!jobs) throw new Error('e2e.yml must define jobs');
    const e2eLinux = jobs.e2e_linux;
    const e2eMac = jobs.e2e_mac;
    if (!e2eLinux || !e2eMac)
      throw new Error('e2e.yml must define e2e_linux and e2e_mac');
    expect(hasSecret(e2eLinux.env ?? {})).toBe(false);
    expect(hasSecret(e2eMac.env ?? {})).toBe(false);
    const cases: Array<{
      steps: WorkflowStep[];
      quotaName: string;
      quotaId: string;
      validationName: string;
      testName: string;
    }> = [
      {
        steps: jobSteps(workflowJobOptional(workflow, 'e2e_linux')),
        quotaName: 'Check API quota and select optimal key',
        quotaId: 'quota',
        validationName: 'Validate E2E provider environment (Linux)',
        testName: 'Run E2E tests',
      },
      {
        steps: jobSteps(workflowJobOptional(workflow, 'e2e_mac')),
        quotaName: 'Check API quota and select optimal key (macOS)',
        quotaId: 'quota_macos',
        validationName: 'Validate E2E provider environment (macOS)',
        testName: 'Run E2E tests (non-Windows)',
      },
    ];

    for (const testCase of cases) {
      assertJobCheckoutSecurity(
        testCase.steps,
        testCase.quotaName,
        testCase.quotaId,
      );

      const quota = stepNamed(testCase.steps, testCase.quotaName);
      const validation = stepNamed(testCase.steps, testCase.validationName);
      const tests = stepNamed(testCase.steps, testCase.testName);

      expect(asRecord(validation.env).OPENAI_API_KEY).toBe(
        selectedKeyExpression(testCase.quotaId),
      );
      expect(asRecord(tests.env).OPENAI_API_KEY).toBe(
        selectedKeyExpression(testCase.quotaId),
      );
      expect(asRecord(validation.env).OPENAI_API_KEY_2).toBeUndefined();
      expect(asRecord(tests.env).OPENAI_API_KEY_2).toBeUndefined();
      expect(testCase.steps.filter(hasSecret)).toEqual([
        quota,
        validation,
        tests,
      ]);

      // Quota must precede validation and test steps.
      expect(testCase.steps.indexOf(quota)).toBeLessThan(
        testCase.steps.indexOf(validation),
      );
      expect(testCase.steps.indexOf(quota)).toBeLessThan(
        testCase.steps.indexOf(tests),
      );
    }
  });

  it('maps only the selected PR-review key into the walkthrough invocation', () => {
    const workflow = readWorkflow('pr-review.yml');
    const jobs = workflow.jobs;
    if (!jobs) throw new Error('pr-review.yml must define jobs');
    const gate = jobs['mergeability-gate'];
    const job = jobs.review;
    if (!job) throw new Error('pr-review.yml must define review job');
    const jobStepsLocal = jobSteps(job);
    const quota = stepNamed(
      jobStepsLocal,
      'Check API quota and select optimal key',
    );
    const walkthrough = stepNamed(jobStepsLocal, 'Run walkthrough pipeline');

    expect(gate?.secrets).toBeUndefined();
    expect(hasSecret(gate ?? {})).toBe(false);
    expect(job.env ?? {}).not.toHaveProperty('OPENAI_API_KEY');
    expect(job.env ?? {}).not.toHaveProperty('OPENAI_API_KEY_2');
    expect(hasSecret(job.env ?? {})).toBe(false);
    expect(quota.id).toBe('quota');
    expect(quota.env).toEqual({
      KEY_VAR_NAME: '${{ vars.KEY_VAR_NAME }}',
      OPENAI_API_KEY: '${{ secrets[vars.KEY_VAR_NAME] }}',
      OPENAI_API_KEY_2: '${{ secrets[vars.KEY_VAR_NAME_2] }}',
    });
    expect(walkthrough.env).toEqual({
      OPENAI_API_KEY: selectedKeyExpression('quota'),
    });
    expect(jobStepsLocal.filter(hasSecret)).toEqual([quota, walkthrough]);
    expect(jobStepsLocal.indexOf(quota)).toBeLessThan(
      jobStepsLocal.indexOf(walkthrough),
    );
  });
});
