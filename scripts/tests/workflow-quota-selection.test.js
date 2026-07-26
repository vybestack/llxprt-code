/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';

const ROOT = path.resolve(import.meta.dirname, '../..');

function readWorkflow(name) {
  return yaml.load(
    fs.readFileSync(path.join(ROOT, '.github/workflows', name), 'utf-8'),
  );
}

function selectedKeyExpression(stepId) {
  return `\${{ steps.${stepId}.outputs.selected_key == 'primary' && secrets[vars.KEY_VAR_NAME] || steps.${stepId}.outputs.selected_key == 'secondary' && secrets[vars.KEY_VAR_NAME_2] || '' }}`;
}

function hasSecret(value) {
  return /\bsecrets(?:\.|\[)/.test(JSON.stringify(value));
}

function stepNamed(steps, name) {
  return (
    steps.find((step) => step.name === name) ??
    expect.fail(`missing step: ${name}`)
  );
}

/**
 * Structurally verifies the trusted-ref and PR-code-checkout steps for a
 * single E2E job. The trusted checkout ref must cover BOTH pull_request
 * and pull_request_target. After quota selection, the PR code must be
 * checked out via two mutually-exclusive conditional steps — internal target
 * head for pull_request_target and merge ref for pull_request — each with
 * persist-credentials:false. Fork target heads must never be checked out.
 */
function assertJobCheckoutSecurity(steps, quotaName, quotaId) {
  const trustedCheckout = stepNamed(steps, 'Checkout trusted quota selector');
  const quota = stepNamed(steps, quotaName);
  const targetCheckout = stepNamed(steps, 'Checkout PR head (internal target)');
  const internalCheckout = stepNamed(steps, 'Checkout PR merge ref (internal)');

  expect(quota.id).toBe(quotaId);
  expect(quota.shell).toBe('bash');
  expect(quota.run).toContain('node scripts/ci-quota-check.js');
  expect(quota.run).toContain('awk \'!/^OPENAI_API_KEY=/\' "$GITHUB_ENV"');
  expect(quota.run).toContain(
    'grep -Eq \'^selected_key=(primary|secondary)$\' "$GITHUB_OUTPUT"',
  );
  expect(quota.run).toContain('[[ "${KEY_VAR_NAME:-}" == *SYNTHETIC* ]]');
  expect(quota.run).toContain(
    'echo \'selected_key=primary\' >>"$GITHUB_OUTPUT"',
  );

  // Trusted checkout ref must use base.sha for BOTH PR event types.
  const trustedRef = trustedCheckout.with.ref;
  expect(trustedRef).toContain("github.event_name == 'pull_request'");
  expect(trustedRef).toContain("github.event_name == 'pull_request_target'");
  expect(trustedRef).toContain('github.event.pull_request.base.sha');
  // Non-PR events must fall back to dispatch input or github.ref.
  expect(trustedRef).toContain('github.event.inputs.branch_ref');
  expect(trustedRef).toContain('github.ref');

  expect(targetCheckout.if).toBe(
    "github.event_name == 'pull_request_target' && github.event.pull_request.head.repo.full_name == github.repository",
  );
  expect(targetCheckout.with.ref).toBe(
    '${{ github.event.pull_request.head.sha }}',
  );
  expect(targetCheckout.with.repository).toBe('${{ github.repository }}');
  expect(targetCheckout.with['persist-credentials']).toBe(false);

  // Internal PR merge-ref checkout: only for pull_request.
  expect(internalCheckout.if).toBe("github.event_name == 'pull_request'");
  expect(internalCheckout.with.ref).toBe('${{ github.ref }}');
  expect(internalCheckout.with['persist-credentials']).toBe(false);
  expect(internalCheckout.with.clean).toBe(false);

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
    expect(hasSecret(workflow.jobs.e2e_linux.env)).toBe(false);
    expect(hasSecret(workflow.jobs.e2e_mac.env)).toBe(false);
    const cases = [
      {
        steps: workflow.jobs.e2e_linux.steps,
        quotaName: 'Check API quota and select optimal key',
        quotaId: 'quota',
        validationName: 'Validate E2E provider environment (Linux)',
        testName: 'Run E2E tests',
      },
      {
        steps: workflow.jobs.e2e_mac.steps,
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

      expect(validation.env.OPENAI_API_KEY).toBe(
        selectedKeyExpression(testCase.quotaId),
      );
      expect(tests.env.OPENAI_API_KEY).toBe(
        selectedKeyExpression(testCase.quotaId),
      );
      expect(validation.env.OPENAI_API_KEY_2).toBeUndefined();
      expect(tests.env.OPENAI_API_KEY_2).toBeUndefined();
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
    const gate = workflow.jobs['mergeability-gate'];
    const job = workflow.jobs.review;
    const quota = stepNamed(
      job.steps,
      'Check API quota and select optimal key',
    );
    const walkthrough = stepNamed(job.steps, 'Run walkthrough pipeline');

    expect(gate.secrets).toBeUndefined();
    expect(hasSecret(gate)).toBe(false);
    expect(job.env.OPENAI_API_KEY).toBeUndefined();
    expect(job.env.OPENAI_API_KEY_2).toBeUndefined();
    expect(hasSecret(job.env)).toBe(false);
    expect(quota.id).toBe('quota');
    expect(quota.env).toEqual({
      KEY_VAR_NAME: '${{ vars.KEY_VAR_NAME }}',
      OPENAI_API_KEY: '${{ secrets[vars.KEY_VAR_NAME] }}',
      OPENAI_API_KEY_2: '${{ secrets[vars.KEY_VAR_NAME_2] }}',
    });
    expect(walkthrough.env).toEqual({
      OPENAI_API_KEY: selectedKeyExpression('quota'),
    });
    expect(job.steps.filter(hasSecret)).toEqual([quota, walkthrough]);
    expect(job.steps.indexOf(quota)).toBeLessThan(
      job.steps.indexOf(walkthrough),
    );
  });
});
