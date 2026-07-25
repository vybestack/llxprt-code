/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { normalize, readRootFile } from './ocr-review-workflow-helpers.js';

const WORKFLOW_PATH = '.github/workflows/pr-review.yml';

function loadWorkflow(relPath) {
  const source = readRootFile(relPath);
  const parsed = yaml.load(source);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${relPath} did not parse to a YAML mapping`);
  }
  return parsed;
}

function findStepByName(job, name) {
  return job.steps.find((step) => step.name === name);
}

function stepRunText(job, name) {
  const step = findStepByName(job, name);
  return step ? String(step.run ?? step.with?.script ?? '') : '';
}

function allStepNames(job) {
  return job.steps.map((step) => step.name);
}

function allRunText(job) {
  return job.steps
    .map((step) => String(step.run ?? step.with?.script ?? ''))
    .join('\n');
}

describe('.github/workflows/pr-review.yml — repurposed walkthrough pipeline', () => {
  let workflow;
  let reviewJob;

  beforeAll(() => {
    workflow = loadWorkflow(WORKFLOW_PATH);
    reviewJob = workflow.jobs?.review;
    expect(reviewJob, 'workflow should contain a review job').toBeTruthy();
  });

  describe('triggers and concurrency (unchanged)', () => {
    it('retains all 5 pull_request_target trigger types', () => {
      const types = workflow.on?.pull_request_target?.types;
      expect(types).toEqual(
        expect.arrayContaining([
          'opened',
          'reopened',
          'synchronize',
          'ready_for_review',
          'edited',
        ]),
      );
      expect(types).toHaveLength(5);
    });

    it('keeps the per-PR concurrency group with cancel-in-progress', () => {
      const group = normalize(workflow.concurrency?.group);
      expect(group).toContain('llxprt-pr-review-');
      expect(group).toContain('github.event.pull_request.number');
      expect(workflow.concurrency?.['cancel-in-progress']).toBe(true);
    });
  });

  describe('permissions (unchanged)', () => {
    it('preserves contents: read, pull-requests: write, issues: read, actions: read', () => {
      expect(workflow.permissions?.contents).toBe('read');
      expect(workflow.permissions?.['pull-requests']).toBe('write');
      expect(workflow.permissions?.issues).toBe('read');
      expect(workflow.permissions?.actions).toBe('read');
    });
  });

  describe('env vars (unchanged)', () => {
    it('preserves KEY_VAR_NAME and REPO at workflow level', () => {
      const env = workflow.env ?? {};
      expect(env.KEY_VAR_NAME).toBeTruthy();
      expect(env.REPO).toBeTruthy();
    });

    it('preserves provider env vars in the review job', () => {
      const env = reviewJob.env ?? {};
      expect(env.OPENAI_BASE_URL).toBeTruthy();
      expect(env.LLXPRT_DEFAULT_MODEL).toBeTruthy();
      expect(env.LLXPRT_DEFAULT_PROVIDER).toBeTruthy();
      expect(env.LLXPRT_CONTEXT_LIMIT).toBeTruthy();
      expect(env.DEBUG_OUTPUT).toBeTruthy();
    });
  });

  describe('comment tag (changed to llxprt-walkthrough)', () => {
    it('uses llxprt-walkthrough as the comment-tag in the post step', () => {
      const postStep = reviewJob.steps.find((step) =>
        step.uses?.includes('actions-comment-pull-request'),
      );
      expect(postStep, 'should have a comment-post step').toBeTruthy();
      expect(postStep.with?.['comment-tag']).toBe('llxprt-walkthrough');
    });

    it('does not use the old llxprt-pr-review comment tag in the post step', () => {
      const postStep = reviewJob.steps.find((step) =>
        step.uses?.includes('actions-comment-pull-request'),
      );
      expect(postStep.with?.['comment-tag']).not.toBe('llxprt-pr-review');
    });

    it('the issue_gate blocked comment uses the new tag', () => {
      const gateRun = stepRunText(
        reviewJob,
        'Collect PR metadata and ensure linked issue',
      );
      expect(gateRun).toContain('<!-- llxprt-walkthrough -->');
    });
  });

  describe('bug-finding steps removed', () => {
    const removedSteps = [
      'Build review instructions',
      'Run LLxprt review',
      'Evaluate LLxprt verdict',
      'Apply review actions',
      'Record LLxprt verdict outcome',
      'Report missing issue reference',
    ];

    for (const stepName of removedSteps) {
      it(`removes the "${stepName}" step`, () => {
        const names = allStepNames(reviewJob);
        expect(names).not.toContain(stepName);
      });
    }

    it('does not reference Ready/Needs-Work verdict logic', () => {
      const combined = allRunText(reviewJob);
      const normalized = normalize(combined);
      expect(normalized).not.toMatch(/verdict\s*==\s*.?needs_work/);
      expect(normalized).not.toContain('needs_work');
    });

    it('does not reference the luther remediate label logic', () => {
      const combined = allRunText(reviewJob);
      expect(normalize(combined)).not.toContain('luther remediate');
    });

    it('removes the 500-char truncation of issue bodies', () => {
      const contextRun = stepRunText(reviewJob, 'Build review context');
      expect(contextRun).not.toContain('clean(issue.body || "", 500)');
    });
  });

  describe('walkthrough pipeline step added', () => {
    it('has a step that runs node scripts/pr-review-walkthrough.mjs', () => {
      const step = reviewJob.steps.find(
        (s) =>
          typeof s.run === 'string' &&
          s.run.includes('scripts/pr-review-walkthrough.mjs'),
      );
      expect(step, 'should run the walkthrough orchestrator').toBeTruthy();
      expect(step.run).toMatch(/node\s+scripts\/pr-review-walkthrough\.mjs/);
    });

    it('the walkthrough step name is "Run walkthrough pipeline"', () => {
      const step = reviewJob.steps.find(
        (s) =>
          typeof s.run === 'string' &&
          s.run.includes('scripts/pr-review-walkthrough.mjs'),
      );
      expect(step.name).toBe('Run walkthrough pipeline');
    });
  });

  describe('gather steps retained', () => {
    const retainedSteps = [
      'Checkout base revision',
      'Prepare review workspace',
      'Fetch pull request head',
      'Collect PR metadata and ensure linked issue',
      'Detect documentation-only change',
      'Install LLxprt CLI nightly',
      'Check API quota and select optimal key',
      'Capture LLxprt Code CI status',
      'Capture coverage summary comment',
      'Generate diff artifacts',
      'Build review context',
    ];

    for (const stepName of retainedSteps) {
      it(`retains the "${stepName}" step`, () => {
        const names = allStepNames(reviewJob);
        expect(names).toContain(stepName);
      });
    }

    it('ci-quota-check.js is still called in the quota check step', () => {
      const quotaRun = stepRunText(
        reviewJob,
        'Check API quota and select optimal key',
      );
      expect(quotaRun).toContain('ci-quota-check.js');
    });

    it('issue_gate still outputs should_review', () => {
      const gateRun = stepRunText(
        reviewJob,
        'Collect PR metadata and ensure linked issue',
      );
      expect(gateRun).toContain('should_review=');
    });
  });

  describe('idempotent comment posting', () => {
    it('uses the thollander comment action with edit-in-place tag', () => {
      const postStep = reviewJob.steps.find((step) =>
        step.uses?.includes('actions-comment-pull-request'),
      );
      expect(postStep.uses, 'should use the pinned comment action').toContain(
        'thollander/actions-comment-pull-request',
      );
    });
  });

  describe('diff manifest generation (HIGH 3)', () => {
    it('the Generate diff artifacts step writes a diff-manifest.txt', () => {
      const run = stepRunText(reviewJob, 'Generate diff artifacts');
      expect(run).toContain('diff-manifest.txt');
    });

    it('the manifest maps sanitized names to original paths via tab separator', () => {
      const run = stepRunText(reviewJob, 'Generate diff artifacts');
      expect(run).toContain('safe_name');
      expect(run).toContain('.diff');
    });
  });

  describe('walkthrough pipeline failure handling (CRITICAL 1)', () => {
    it('the Run walkthrough pipeline step does NOT capture stderr into comment.md', () => {
      const run = stepRunText(reviewJob, 'Run walkthrough pipeline');
      expect(run).not.toContain('error_detail');
      expect(run).not.toContain('head -c 2000');
      expect(run).not.toContain('WARNING: LLxprt walkthrough pipeline failure');
    });

    it('the Run walkthrough pipeline step redirects stderr to a log artifact only', () => {
      const run = stepRunText(reviewJob, 'Run walkthrough pipeline');
      expect(run).toContain('walkthrough-error.log');
    });
  });

  describe('ensure fallback comment (MEDIUM 10)', () => {
    it('has an Ensure fallback comment step with if: always()', () => {
      const step = findStepByName(reviewJob, 'Ensure fallback comment');
      expect(step.if).toBe('always()');
    });

    it('the fallback step writes a generic comment when comment.md is empty', () => {
      const run = stepRunText(reviewJob, 'Ensure fallback comment');
      expect(run).toContain('! -s review/comment.md');
      expect(run).toContain('<!-- llxprt-walkthrough -->');
      expect(run).toContain('LLxprt PR Review unavailable');
    });

    it('the fallback step runs before the post-comment step', () => {
      const fallbackIdx = reviewJob.steps.findIndex(
        (s) => s.name === 'Ensure fallback comment',
      );
      const postIdx = reviewJob.steps.findIndex((s) =>
        s.uses?.includes('actions-comment-pull-request'),
      );
      expect(fallbackIdx).toBeGreaterThanOrEqual(0);
      expect(postIdx).toBeGreaterThan(fallbackIdx);
    });

    it('walkthrough pipeline runs before the fallback comment (OCR Finding 6)', () => {
      const walkthroughIdx = reviewJob.steps.findIndex(
        (s) => s.name === 'Run walkthrough pipeline',
      );
      const fallbackIdx = reviewJob.steps.findIndex(
        (s) => s.name === 'Ensure fallback comment',
      );
      expect(walkthroughIdx).toBeGreaterThanOrEqual(0);
      expect(fallbackIdx).toBeGreaterThanOrEqual(0);
      expect(walkthroughIdx).toBeLessThan(fallbackIdx);
    });
  });

  describe('post-comment step always runs', () => {
    it('the post-comment step uses if: always()', () => {
      const postStep = reviewJob.steps.find((step) =>
        step.uses?.includes('actions-comment-pull-request'),
      );
      expect(postStep.if).toBe('always()');
    });
  });
});
