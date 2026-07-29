/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { normalize, readRootFile } from './ocr-review-workflow-helpers.js';

const WORKFLOW_PATH = '.github/workflows/pr-review.yml';

interface WorkflowStep {
  name?: string;
  id?: string;
  if?: string;
  run?: string;
  uses?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
  'continue-on-error'?: boolean | string;
  continue_on_error?: boolean | string;
}

interface WorkflowJob {
  steps: WorkflowStep[];
  needs?: string[];
  env?: Record<string, string>;
  'timeout-minutes'?: number;
  'runs-on'?: string;
}

interface WorkflowFile {
  on?: Record<string, { types?: string[] }> & {
    pull_request_target?: { types?: string[] };
  };
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  jobs?: Record<string, WorkflowJob>;
}

type StepOutcome = 'success' | 'failure' | 'skipped' | 'cancelled';

interface StepOutcomes {
  outcomes: Record<string, StepOutcome>;
  outputs?: Record<string, Record<string, string>>;
}

function loadWorkflow(relPath: string): WorkflowFile {
  const source = readRootFile(relPath);
  const parsed = yaml.load(source);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${relPath} did not parse to a YAML mapping`);
  }
  return parsed as WorkflowFile;
}

function findStepByName(
  job: WorkflowJob,
  name: string,
): WorkflowStep | undefined {
  return job.steps.find((step) => step.name === name);
}

function requireStepByName(job: WorkflowJob, name: string): WorkflowStep {
  const step = job.steps.find((s) => s.name === name);
  expect(step, `review job should have a step named "${name}"`).toBeTruthy();
  return step as WorkflowStep;
}

function requireStepById(job: WorkflowJob, id: string): WorkflowStep {
  const step = job.steps.find((s) => s.id === id);
  expect(step, `review job should have a step with id "${id}"`).toBeTruthy();
  return step as WorkflowStep;
}

function stepRunText(job: WorkflowJob, name: string): string {
  const step = findStepByName(job, name);
  return step ? String(step.run ?? step.with?.['script'] ?? '') : '';
}

function allStepNames(job: WorkflowJob): string[] {
  return job.steps.map((step) => step.name ?? '');
}

function allStepText(job: WorkflowJob): string {
  return JSON.stringify(job.steps);
}

function continueOnError(step: WorkflowStep | undefined): boolean {
  if (!step) {
    return false;
  }
  const value = step['continue-on-error'] ?? step.continue_on_error;
  return value === true || value === '${{ true }}';
}

/**
 * Evaluate a GitHub Actions `if:` expression against a map of step outcomes.
 * Supports the limited subset used by pr-review.yml: step.outcome equality,
 * &&, ||, !cancelled(), always(), failure(), success().
 */
function evalStepIf(
  expr: string | undefined,
  stepOutcomes: StepOutcomes = { outcomes: {} },
): boolean {
  if (expr === undefined || expr === null) {
    return true;
  }
  let normalized = String(expr).trim();
  if (normalized.startsWith('${{') && normalized.endsWith('}}')) {
    normalized = normalized.slice(3, -2).trim();
  }
  if (normalized === '') {
    return true;
  }
  normalized = normalized.replace(/\s+/g, ' ');
  normalized = normalized.replace(
    /steps\.([a-zA-Z0-9_-]+)\.outcome\s*==\s*'([^']*)'/g,
    (_match, id: string, value: string) => {
      const outcome = stepOutcomes.outcomes[id] ?? 'skipped';
      return outcome === value ? 'TRUE' : 'FALSE';
    },
  );
  const outputs = stepOutcomes.outputs ?? {};
  normalized = normalized.replace(
    /steps\.([a-zA-Z0-9_-]+)\.outputs\.([a-zA-Z0-9_-]+)\s*==\s*'([^']*)'/g,
    (_match, stepId: string, outputName: string, expected: string) => {
      const actual = outputs[stepId]?.[outputName];
      // Missing outputs default to TRUE so that install/quota gating
      // expressions can be tested in isolation without modeling every
      // upstream gate. Critical outputs (should_review, selected_key)
      // are always provided by tests that exercise those paths.
      if (actual === undefined) {
        return 'TRUE';
      }
      return actual === expected ? 'TRUE' : 'FALSE';
    },
  );
  const outcomeValues = Object.values(stepOutcomes.outcomes);
  const anyFailure = outcomeValues.some((o) => o === 'failure');
  const anyCancelled = outcomeValues.some((o) => o === 'cancelled');
  normalized = normalized.replace(/\balways\(\)/g, 'TRUE');
  // success() is true only when no prior step failed and the job is not cancelled.
  normalized = normalized.replace(
    /\bsuccess\(\)/g,
    anyFailure || anyCancelled ? 'FALSE' : 'TRUE',
  );
  normalized = normalized.replace(
    /\bfailure\(\)/g,
    anyFailure ? 'TRUE' : 'FALSE',
  );
  normalized = normalized.replace(
    /!cancelled\(\)/g,
    anyCancelled ? 'FALSE' : 'TRUE',
  );
  return evalBoolean(normalized);
}

function evalBoolean(expr: string): boolean {
  let pos = 0;
  function skipSpaces(): void {
    while (pos < expr.length && expr[pos] === ' ') {
      pos += 1;
    }
  }
  function parsePrimary(): boolean {
    skipSpaces();
    if (expr.startsWith('TRUE', pos)) {
      pos += 4;
      return true;
    }
    if (expr.startsWith('FALSE', pos)) {
      pos += 5;
      return false;
    }
    if (expr[pos] === '(') {
      pos += 1;
      const value = parseOr();
      skipSpaces();
      if (expr[pos] !== ')') {
        throw new Error(
          `Invalid boolean expression: expected ')' at ${pos} in "${expr}"`,
        );
      }
      pos += 1;
      return value;
    }
    if (expr[pos] === '!') {
      pos += 1;
      skipSpaces();
      return !parsePrimary();
    }
    throw new Error(
      `Invalid boolean expression: unexpected token at ${pos} in "${expr}"`,
    );
  }
  function parseAnd(): boolean {
    let value = parsePrimary();
    skipSpaces();
    while (expr.startsWith('&&', pos)) {
      pos += 2;
      const right = parsePrimary();
      value = value && right;
      skipSpaces();
    }
    return value;
  }
  function parseOr(): boolean {
    let value = parseAnd();
    skipSpaces();
    while (expr.startsWith('||', pos)) {
      pos += 2;
      const right = parseAnd();
      value = value || right;
      skipSpaces();
    }
    return value;
  }
  const result = parseOr();
  skipSpaces();
  if (pos !== expr.length) {
    throw new Error(
      `Invalid boolean expression: trailing input at ${pos} in "${expr}"`,
    );
  }
  return result;
}

describe('.github/workflows/pr-review.yml — repurposed walkthrough pipeline', () => {
  let workflow: WorkflowFile;
  let reviewJob: WorkflowJob;

  beforeAll(() => {
    workflow = loadWorkflow(WORKFLOW_PATH);
    reviewJob = workflow.jobs?.['review'] as WorkflowJob;
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
      expect(workflow.permissions?.['contents']).toBe('read');
      expect(workflow.permissions?.['pull-requests']).toBe('write');
      expect(workflow.permissions?.['issues']).toBe('read');
      expect(workflow.permissions?.['actions']).toBe('read');
    });
  });

  describe('env vars (unchanged)', () => {
    it('preserves KEY_VAR_NAME and REPO at workflow level', () => {
      const env = workflow.env ?? {};
      expect(env['KEY_VAR_NAME']).toBeTruthy();
      expect(env['REPO']).toBeTruthy();
    });

    it('preserves provider env vars in the review job', () => {
      const env = reviewJob.env ?? {};
      expect(env['OPENAI_BASE_URL']).toBeTruthy();
      expect(env['LLXPRT_DEFAULT_MODEL']).toBeTruthy();
      expect(env['LLXPRT_DEFAULT_PROVIDER']).toBeTruthy();
      expect(env['LLXPRT_CONTEXT_LIMIT']).toBeTruthy();
      expect(env['DEBUG_OUTPUT']).toBeTruthy();
    });

    it('wires the strong model tier from repository variables', () => {
      const env = reviewJob.env ?? {};
      expect(env['LLXPRT_STRONG_MODEL']).toContain('vars.LLXPRT_STRONG_MODEL');
      expect(env['LLXPRT_STRONG_MODEL']).toContain('vars.LLXPRT_DEFAULT_MODEL');
    });
  });

  describe('comment tag (changed to llxprt-walkthrough)', () => {
    it('uses llxprt-walkthrough as the comment-tag in the post step', () => {
      const postStep = reviewJob.steps.find((step) =>
        step.uses?.includes('actions-comment-pull-request'),
      );
      expect(postStep, 'should have a comment-post step').toBeTruthy();
      expect(postStep?.with?.['comment-tag']).toBe('llxprt-walkthrough');
    });

    it('does not use the old llxprt-pr-review comment tag in the post step', () => {
      const postStep = reviewJob.steps.find((step) =>
        step.uses?.includes('actions-comment-pull-request'),
      );
      expect(postStep?.with?.['comment-tag']).not.toBe('llxprt-pr-review');
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
      const combined = allStepText(reviewJob);
      const normalizedText = normalize(combined);
      expect(normalizedText).not.toMatch(/verdict\s*==\s*.?needs_work/);
      expect(normalizedText).not.toContain('needs_work');
    });

    it('does not reference the luther remediate label logic', () => {
      const combined = allStepText(reviewJob);
      expect(normalize(combined)).not.toContain('luther remediate');
    });

    it('removes the 500-char truncation of issue bodies', () => {
      const contextRun = stepRunText(reviewJob, 'Build review context');
      expect(contextRun).not.toContain('clean(issue.body || "", 500)');
    });
  });

  it('does not write a dead issues-full.md artifact', () => {
    const contextRun = stepRunText(reviewJob, 'Build review context');
    expect(contextRun).not.toContain('review/issues-full.md');
  });

  describe('walkthrough pipeline step added', () => {
    it('has a step that runs node scripts/pr-review-walkthrough.mjs', () => {
      const step = reviewJob.steps.find(
        (s) =>
          typeof s.run === 'string' &&
          s.run.includes('scripts/pr-review-walkthrough.mjs'),
      );
      expect(step, 'should run the walkthrough orchestrator').toBeTruthy();
      expect(step?.run).toMatch(/node\s+scripts\/pr-review-walkthrough\.mjs/);
    });

    it('the walkthrough step name is "Run walkthrough pipeline"', () => {
      const step = reviewJob.steps.find(
        (s) =>
          typeof s.run === 'string' &&
          s.run.includes('scripts/pr-review-walkthrough.mjs'),
      );
      expect(step?.name).toBe('Run walkthrough pipeline');
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
      expect(postStep?.uses, 'should use the pinned comment action').toContain(
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

    it('disables rename detection and writes the manifest in the diff loop', () => {
      const run = stepRunText(reviewJob, 'Generate diff artifacts');
      expect(run).toContain('git diff --name-status --no-renames');
      expect(run.match(/diff-manifest\.txt/g)).toHaveLength(2);
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
      expect(step?.if).toBe('always()');
    });

    it('the fallback step writes a generic comment when comment.md is empty', () => {
      const run = stepRunText(reviewJob, 'Ensure fallback comment');
      expect(run).toContain('! -s review/comment.md');
      expect(run).toContain('<!-- llxprt-walkthrough -->');
      expect(run).toContain('LLxprt PR Review unavailable');
    });

    it('tees stderr to both the diagnostics artifact and Actions log', () => {
      const run = stepRunText(reviewJob, 'Run walkthrough pipeline');
      expect(run).toContain('tee review/walkthrough-error.log');
      expect(run).toContain('2> >(tee');
    });

    it('uploads the private diagnostics log for post-mortem inspection', () => {
      const step = findStepByName(reviewJob, 'Upload walkthrough diagnostics');
      expect(step, 'should upload the diagnostics log').toBeTruthy();
      // Issue #2778: upload runs under always() so parse artifacts from
      // gracefully degraded zero-exit runs are captured alongside failure logs.
      expect(step?.if).toBe('always()');
      expect(step?.uses).toContain('actions/upload-artifact@');
      // Issue #2742: the artifact now includes parse-failure diagnostics
      // (raw LLM responses + metadata) alongside the error log.
      const artifactPath = step?.with?.['path'] ?? '';
      expect(artifactPath).toContain('review/walkthrough-error.log');
      expect(artifactPath).toContain('review/parse-failure-raw-*.txt');
      expect(artifactPath).toContain('review/parse-failure-info-*.json');
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
      expect(postStep?.if).toBe('always()');
    });
  });

  // =========================================================================
  // Issue #2778: Non-blocking advisory review boundaries
  // =========================================================================

  describe('non-blocking review job (Issue #2778)', () => {
    function stepById(id: string): WorkflowStep {
      return requireStepById(reviewJob, id);
    }

    function stepByName(name: string): WorkflowStep {
      return requireStepByName(reviewJob, name);
    }

    // --- A1: Every advisory step has continue-on-error: true ---

    it('Install LLxprt CLI nightly has id "install" and continue-on-error', () => {
      const step = stepByName('Install LLxprt CLI nightly');
      expect(step.id).toBe('install');
      expect(continueOnError(step)).toBe(true);
    });

    it('Check API quota and select optimal key has id "quota" and continue-on-error', () => {
      const step = stepByName('Check API quota and select optimal key');
      expect(step.id).toBe('quota');
      expect(continueOnError(step)).toBe(true);
    });

    it('Run walkthrough pipeline has id "walkthrough" and continue-on-error', () => {
      const step = stepByName('Run walkthrough pipeline');
      expect(step.id).toBe('walkthrough');
      expect(continueOnError(step)).toBe(true);
    });

    it('Upload walkthrough diagnostics has continue-on-error', () => {
      const step = stepByName('Upload walkthrough diagnostics');
      expect(continueOnError(step)).toBe(true);
    });

    it('Ensure fallback comment has continue-on-error', () => {
      const step = stepByName('Ensure fallback comment');
      expect(continueOnError(step)).toBe(true);
    });

    it('Post walkthrough comment has continue-on-error', () => {
      const step = reviewJob.steps.find((s) =>
        s.uses?.includes('actions-comment-pull-request'),
      );
      expect(continueOnError(step)).toBe(true);
    });

    // --- A2/A3: Install/quota failure is visible and skips walkthrough ---

    it('walkthrough step is skipped when install fails', () => {
      const walkthrough = stepById('walkthrough');
      expect(
        evalStepIf(walkthrough.if, {
          outcomes: { install: 'failure', quota: 'success' },
          outputs: { issue_gate: { should_review: 'true' } },
        }),
      ).toBe(false);
    });

    it('walkthrough step is skipped when quota fails', () => {
      const walkthrough = stepById('walkthrough');
      expect(
        evalStepIf(walkthrough.if, {
          outcomes: { install: 'success', quota: 'failure' },
          outputs: { issue_gate: { should_review: 'true' } },
        }),
      ).toBe(false);
    });

    it('walkthrough step runs when both install and quota succeed', () => {
      const walkthrough = stepById('walkthrough');
      expect(
        evalStepIf(walkthrough.if, {
          outcomes: { install: 'success', quota: 'success' },
          outputs: { issue_gate: { should_review: 'true' } },
        }),
      ).toBe(true);
    });

    it('walkthrough step does not run when issue_gate says false', () => {
      const walkthrough = stepById('walkthrough');
      expect(
        evalStepIf(walkthrough.if, {
          outcomes: { install: 'success', quota: 'success' },
          outputs: { issue_gate: { should_review: 'false' } },
        }),
      ).toBe(false);
    });

    // --- A5: Diagnostics upload under always(), capturing zero-exit parse artifacts ---

    it('diagnostics upload step uses if: always()', () => {
      const upload = stepByName('Upload walkthrough diagnostics');
      expect(upload.if).toBe('always()');
    });

    it('diagnostics upload runs even when walkthrough succeeds (zero-exit parse artifacts)', () => {
      const upload = stepByName('Upload walkthrough diagnostics');
      expect(
        evalStepIf(upload.if, { outcomes: { walkthrough: 'success' } }),
      ).toBe(true);
    });

    it('diagnostics upload runs when walkthrough fails', () => {
      const upload = stepByName('Upload walkthrough diagnostics');
      expect(
        evalStepIf(upload.if, { outcomes: { walkthrough: 'failure' } }),
      ).toBe(true);
    });

    // --- A7: Fallback and posting always attempted, non-blocking ---

    it('Ensure fallback comment runs under always()', () => {
      const fallback = stepByName('Ensure fallback comment');
      expect(
        evalStepIf(fallback.if, { outcomes: { walkthrough: 'failure' } }),
      ).toBe(true);
      expect(
        evalStepIf(fallback.if, { outcomes: { walkthrough: 'success' } }),
      ).toBe(true);
    });

    it('Post walkthrough comment runs under always()', () => {
      const post = reviewJob.steps.find((s) =>
        s.uses?.includes('actions-comment-pull-request'),
      );
      expect(
        evalStepIf(post?.if, { outcomes: { walkthrough: 'failure' } }),
      ).toBe(true);
      expect(
        evalStepIf(post?.if, { outcomes: { walkthrough: 'success' } }),
      ).toBe(true);
    });

    // --- A8: Cancellation is not disguised as success ---
    //
    // When the workflow run is cancelled, GitHub Actions marks the job
    // conclusion as 'cancelled'. Steps with `if: always()` may execute, but
    // the job conclusion is not changed to success by that. The invariant
    // here: no step in the review job sets `continue-on-error` to a value
    // that would force the *job* to succeed on cancellation, and no step
    // uses an expression that references cancelled() == false to fabricate
    // success. We verify the advisory steps use `continue-on-error: true`
    // (which only masks step failures, not cancellation).

    it('no advisory step uses an expression that fabricates success on cancellation', () => {
      for (const step of reviewJob.steps) {
        const ifExpr = String(step.if ?? '');
        // No step should negate cancelled() to claim success.
        expect(ifExpr).not.toMatch(/cancelled\s*\(\s*\)\s*==\s*'?false'?/);
      }
    });

    it('issue gate and fetch steps (pre-advisory) do not use continue-on-error', () => {
      const gate = stepByName('Collect PR metadata and ensure linked issue');
      const fetch = stepByName('Fetch pull request head');
      // These structural steps must not be masked — their failure is real.
      expect(continueOnError(gate)).toBe(false);
      expect(continueOnError(fetch)).toBe(false);
    });

    // --- A9: Linked-issue gate and mergeability gate unchanged ---

    it('the issue_gate step does NOT have continue-on-error', () => {
      const gate = stepByName('Collect PR metadata and ensure linked issue');
      expect(continueOnError(gate)).toBe(false);
    });

    it('the issue_gate step is NOT id-gated by install/quota', () => {
      const gate = stepByName('Collect PR metadata and ensure linked issue');
      // The gate runs before install/quota, so its if should not reference them
      const gateIf = String(gate.if ?? '');
      expect(gateIf).not.toContain('steps.install');
      expect(gateIf).not.toContain('steps.quota');
    });

    it('mergeability-gate job is unchanged and still required', () => {
      expect(reviewJob.needs).toContain('mergeability-gate');
    });
  });

  describe('injected-failure scenario coverage (Issue #2778)', () => {
    // These tests use optional find (returning WorkflowStep | undefined)
    // because they pass results to continueOnError(), which handles
    // undefined by returning false. This is intentionally different from the
    // non-blocking block's requireStepByName/requireStepById which assert
    // step existence.
    function stepByName(name: string): WorkflowStep | undefined {
      return reviewJob.steps.find((s) => s.name === name);
    }

    function stepById(id: string): WorkflowStep | undefined {
      return reviewJob.steps.find((s) => s.id === id);
    }

    // Simulate each injected-failure scenario and verify:
    // 1. The failing step's outcome remains visible (continue-on-error preserves outcome)
    // 2. Downstream finalization still runs
    // 3. The job does not block merge (all advisory steps are continue-on-error)

    it('install failure: walkthrough skipped, fallback+post still run', () => {
      const scenarios: StepOutcomes = {
        outcomes: {
          install: 'failure',
          quota: 'skipped',
          walkthrough: 'skipped',
        },
      };
      const fallback = stepByName('Ensure fallback comment');
      const post = reviewJob.steps.find((s) =>
        s.uses?.includes('actions-comment-pull-request'),
      );
      expect(evalStepIf(fallback?.if, scenarios)).toBe(true);
      expect(evalStepIf(post?.if, scenarios)).toBe(true);
      expect(continueOnError(stepByName('Install LLxprt CLI nightly'))).toBe(
        true,
      );
    });

    it('quota failure: walkthrough skipped, fallback+post still run', () => {
      const scenarios: StepOutcomes = {
        outcomes: {
          install: 'success',
          quota: 'failure',
          walkthrough: 'skipped',
        },
      };
      const fallback = stepByName('Ensure fallback comment');
      const post = reviewJob.steps.find((s) =>
        s.uses?.includes('actions-comment-pull-request'),
      );
      expect(evalStepIf(fallback?.if, scenarios)).toBe(true);
      expect(evalStepIf(post?.if, scenarios)).toBe(true);
      expect(
        continueOnError(stepByName('Check API quota and select optimal key')),
      ).toBe(true);
    });

    it('walkthrough failure: diagnostics uploaded, fallback+post still run', () => {
      const scenarios: StepOutcomes = {
        outcomes: {
          install: 'success',
          quota: 'success',
          walkthrough: 'failure',
        },
      };
      const upload = stepByName('Upload walkthrough diagnostics');
      const fallback = stepByName('Ensure fallback comment');
      const post = reviewJob.steps.find((s) =>
        s.uses?.includes('actions-comment-pull-request'),
      );
      expect(evalStepIf(upload?.if, scenarios)).toBe(true);
      expect(evalStepIf(fallback?.if, scenarios)).toBe(true);
      expect(evalStepIf(post?.if, scenarios)).toBe(true);
      expect(continueOnError(stepById('walkthrough'))).toBe(true);
    });

    it('JSON parse failure on zero-exit: parse artifacts uploaded via always()', () => {
      // A gracefully degraded pipeline may exit 0 while producing parse-failure
      // artifacts. The upload must run under always() to capture them.
      const scenarios: StepOutcomes = {
        outcomes: {
          install: 'success',
          quota: 'success',
          walkthrough: 'success',
        },
      };
      const upload = stepByName('Upload walkthrough diagnostics');
      expect(evalStepIf(upload?.if, scenarios)).toBe(true);
      const artifactPath = upload?.with?.['path'] ?? '';
      expect(artifactPath).toContain('review/parse-failure-raw-*.txt');
      expect(artifactPath).toContain('review/parse-failure-info-*.json');
    });

    it('upload failure is non-blocking (continue-on-error on upload)', () => {
      const upload = stepByName('Upload walkthrough diagnostics');
      expect(continueOnError(upload)).toBe(true);
    });

    it('comment-posting failure is non-blocking (continue-on-error on post)', () => {
      const post = reviewJob.steps.find((s) =>
        s.uses?.includes('actions-comment-pull-request'),
      );
      expect(continueOnError(post)).toBe(true);
    });

    it('fallback comment failure is non-blocking (continue-on-error)', () => {
      const fallback = stepByName('Ensure fallback comment');
      expect(continueOnError(fallback)).toBe(true);
    });
  });

  describe('secrets never leaked into public comments (Issue #2778 non-goal)', () => {
    it('walkthrough stderr is never appended to comment.md', () => {
      const walkthrough = reviewJob.steps.find(
        (s) => s.name === 'Run walkthrough pipeline',
      );
      // Strip shell comments so we only inspect actual commands, not
      // explanatory comments that reference the file name.
      const run = String(walkthrough?.run ?? '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'))
        .join('\n');
      expect(run).not.toMatch(/review\/comment\.md/);
    });

    it('fallback comment is generic and contains no diagnostic content', () => {
      const fallback = reviewJob.steps.find(
        (s) => s.name === 'Ensure fallback comment',
      );
      const run = String(fallback?.run ?? '');
      expect(run).not.toContain('walkthrough-error.log');
      expect(run).not.toContain('parse-failure');
    });

    it('upload artifact path excludes comment.md', () => {
      const upload = reviewJob.steps.find(
        (s) => s.name === 'Upload walkthrough diagnostics',
      );
      const artifactPath = String(upload?.with?.['path'] ?? '');
      expect(artifactPath).not.toContain('comment.md');
    });
  });
});
