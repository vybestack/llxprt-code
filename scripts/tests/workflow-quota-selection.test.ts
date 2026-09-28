/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
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
    raiseMissing(`missing step: ${name}`)
  );
}

type WorkflowStep = TypedWorkflowStep;

/** Verify checkout refs without giving PR code a persistent checkout credential. */
function assertJobCheckoutSecurity(steps: WorkflowStep[]): void {
  const checkout = stepNamed(steps, 'Checkout');
  const target = stepNamed(steps, 'Checkout PR head (internal target)');
  const merge = stepNamed(steps, 'Checkout PR merge ref (internal)');
  expect(checkout.if).toBe(
    "github.event_name != 'pull_request_target' && github.event_name != 'pull_request'",
  );
  const ref = asString(asRecord(checkout.with).ref);
  expect(ref).toBe(
    "${{ github.event_name == 'workflow_dispatch' && inputs.branch_ref || github.ref }}",
  );
  expect(asRecord(checkout.with)['persist-credentials']).toBe(false);
  expect(target.if).toBe(
    "github.event_name == 'pull_request_target' && github.event.pull_request.head.repo.full_name == github.repository",
  );
  expect(asRecord(target.with).ref).toBe(
    '${{ github.event.pull_request.head.sha }}',
  );
  expect(asRecord(target.with).repository).toBe('${{ github.repository }}');
  expect(asRecord(target.with)['persist-credentials']).toBe(false);
  expect(merge.if).toBe("github.event_name == 'pull_request'");
  expect(asRecord(merge.with).ref).toBe('${{ github.ref }}');
  expect(asRecord(merge.with)['persist-credentials']).toBe(false);
  expect(asRecord(merge.with).clean).toBe(false);
  expect(steps.indexOf(target)).toBeLessThan(
    steps.indexOf(stepNamed(steps, 'Build project')),
  );
  expect(steps.indexOf(merge)).toBeLessThan(
    steps.indexOf(stepNamed(steps, 'Build project')),
  );
}

/** Bun's `expect` has no `fail`; throw so the expression stays `never`. */
function raiseMissing(message: string): never {
  throw new Error(message);
}

describe('quota-selected workflow credentials', () => {
  it('runs regular Linux E2E with only a local model and no provider credentials', () => {
    const workflow = readWorkflow('e2e.yml');
    expect(workflow.permissions).toEqual({
      actions: 'read',
      contents: 'read',
      'pull-requests': 'read',
    });
    const job = workflowJobOptional(workflow, 'e2e_linux');
    const steps = jobSteps(job);
    assertJobCheckoutSecurity(steps);
    expect(hasSecret(job)).toBe(false);
    expect(JSON.stringify(job)).not.toContain('vars.');
    expect(JSON.stringify(job)).not.toContain('ci-quota-check');
    expect(steps.map((step) => step.name)).not.toContain(
      'Check API quota and select optimal key',
    );
    const tests = stepNamed(steps, 'Run E2E tests');
    expect(asRecord(tests.env).OPENAI_API_KEY).toBe('ollama-local-only');
    expect(asRecord(tests.env).OPENAI_BASE_URL).toBe(
      'http://127.0.0.1:12644/v1',
    );
    expect(asRecord(tests.env).LLXPRT_DEFAULT_MODEL).toBe('gemma4:e2b-it-qat');
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
