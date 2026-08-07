/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from 'bun:test';
import vm from 'vm';
import { normalize, readRootFile } from './ocr-review-workflow-helpers.ts';
import {
  asOptionalRecord,
  asOptionalString,
  asRecord,
  asRecordArray,
  asString,
  asStringArray,
  parseWorkflowYaml,
} from './typed-test-helpers.ts';
import { runFetchHeadStepWithRealRepository } from './pr-mergeability-workflow-test-helpers.ts';

function loadWorkflow(path: string) {
  const source = readRootFile(path);
  try {
    const parsed = parseWorkflowYaml(source);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`${path} did not parse to a YAML mapping`);
    }
    return { source, parsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${path}: ${message}`, {
      cause: error,
    });
  }
}

const hasSecret = (value: unknown): boolean =>
  /\bsecrets(?:\.|\[)/.test(JSON.stringify(value));

const OCR_AUTHORIZATION_PREDICATE = `
  github.event_name == 'workflow_dispatch' ||
  github.event_name == 'pull_request_target' ||
  (github.event_name == 'issue_comment' &&
   github.event.action == 'created' &&
   github.event.issue.pull_request != null &&
   (github.event.comment.author_association == 'OWNER' ||
    github.event.comment.author_association == 'MEMBER' ||
    github.event.comment.author_association == 'COLLABORATOR') &&
   (github.event.comment.body == '/ocr' ||
    startsWith(github.event.comment.body, '/ocr ') ||
    startsWith(toJSON(github.event.comment.body), '"/ocr\\n') ||
    startsWith(toJSON(github.event.comment.body), '"/ocr\\r\\n') ||
    startsWith(toJSON(github.event.comment.body), '"/ocr\\t') ||
    github.event.comment.body == '/open-code-review' ||
    startsWith(github.event.comment.body, '/open-code-review ') ||
    startsWith(toJSON(github.event.comment.body), '"/open-code-review\\n') ||
    startsWith(toJSON(github.event.comment.body), '"/open-code-review\\r\\n') ||
    startsWith(toJSON(github.event.comment.body), '"/open-code-review\\t') ||
    github.event.comment.body == '/review' ||
    startsWith(github.event.comment.body, '/review ') ||
    startsWith(toJSON(github.event.comment.body), '"/review\\n') ||
    startsWith(toJSON(github.event.comment.body), '"/review\\r\\n') ||
    startsWith(toJSON(github.event.comment.body), '"/review\\t'))) ||
  (github.event_name == 'issue_comment' &&
   github.event.action == 'edited' &&
   github.event.issue.pull_request != null &&
   github.event.comment.user.type == 'Bot' &&
   contains(github.event.comment.body, '<!-- llxprt-code-ocr-review -->'))
`;

const OCR_CONCURRENCY_GROUP = `
  \${{
    (github.event_name == 'workflow_dispatch' ||
     github.event_name == 'pull_request_target' ||
     (github.event_name == 'issue_comment' &&
      github.event.issue.pull_request != null &&
      (github.event.comment.author_association == 'OWNER' ||
       github.event.comment.author_association == 'MEMBER' ||
       github.event.comment.author_association == 'COLLABORATOR') &&
      (github.event.comment.body == '/ocr' ||
       startsWith(github.event.comment.body, '/ocr ') ||
       startsWith(toJSON(github.event.comment.body), '"/ocr\\n') ||
       startsWith(toJSON(github.event.comment.body), '"/ocr\\r\\n') ||
       startsWith(toJSON(github.event.comment.body), '"/ocr\\t') ||
       github.event.comment.body == '/open-code-review' ||
       startsWith(github.event.comment.body, '/open-code-review ') ||
       startsWith(toJSON(github.event.comment.body), '"/open-code-review\\n') ||
       startsWith(toJSON(github.event.comment.body), '"/open-code-review\\r\\n') ||
       startsWith(toJSON(github.event.comment.body), '"/open-code-review\\t') ||
       github.event.comment.body == '/review' ||
       startsWith(github.event.comment.body, '/review ') ||
       startsWith(toJSON(github.event.comment.body), '"/review\\n') ||
       startsWith(toJSON(github.event.comment.body), '"/review\\r\\n') ||
       startsWith(toJSON(github.event.comment.body), '"/review\\t'))) ||
     (github.event_name == 'issue_comment' &&
      github.event.action == 'edited' &&
      github.event.issue.pull_request != null &&
      github.event.comment.user.type == 'Bot' &&
      contains(github.event.comment.body, '<!-- llxprt-code-ocr-review -->'))) &&
    format('{0}-pr-{1}', github.workflow,
      github.event.pull_request.number || github.event.issue.number || inputs.pr_number) ||
    format('{0}-run-{1}', github.workflow, github.run_id)
  }}
`;

function evaluateOcrConcurrencyGroup(
  group: string,
  {
    github,
    inputs = {},
  }: { github: Record<string, unknown>; inputs?: Record<string, unknown> },
) {
  const expression = group.trim().slice(3, -2).trim();
  return vm.runInNewContext(expression, {
    github,
    inputs,
    startsWith: (value: unknown, prefix: string) =>
      String(value).startsWith(prefix),
    contains: (value: unknown, fragment: unknown) =>
      String(value).includes(String(fragment)),
    toJSON: (value: unknown) => JSON.stringify(value),
    format: (template: string, ...values: unknown[]) =>
      template.replace(/{(\d+)}/g, (_match: string, index: string) =>
        String(values[Number(index)]),
      ),
  });
}

interface OcrConcurrencyContextParams {
  eventName: string;
  runId: number;
  pullRequestNumber?: number | null;
  issueNumber?: number | null;
  issueIsPullRequest?: boolean;
  association?: string;
  body?: string;
  inputPrNumber?: string;
  action?: string;
  commentUserType?: string;
}

function ocrConcurrencyContext({
  eventName,
  runId,
  pullRequestNumber = null,
  issueNumber = null,
  issueIsPullRequest = false,
  association = 'NONE',
  body = '',
  inputPrNumber = '',
  action = 'created',
  commentUserType = 'User',
}: OcrConcurrencyContextParams) {
  return {
    github: {
      workflow: 'OCR Review',
      run_id: runId,
      event_name: eventName,
      event: {
        action,
        pull_request: { number: pullRequestNumber },
        issue: {
          number: issueNumber,
          pull_request: issueIsPullRequest ? {} : null,
        },
        comment: {
          author_association: association,
          body,
          user: { type: commentUserType },
        },
      },
    },
    inputs: { pr_number: inputPrNumber },
  };
}

describe('OCR mergeability gate wiring (.github/workflows/ocr-review.yml)', () => {
  let parsed: Record<string, unknown>;
  let notifierParsed: Record<string, unknown>;
  let gateJob: Record<string, unknown> | undefined;
  let codeReviewJob: Record<string, unknown> | undefined;
  let classifyJob: Record<string, unknown> | undefined;
  let notifyJob: Record<string, unknown> | undefined;

  beforeAll(() => {
    const wf = loadWorkflow('.github/workflows/ocr-review.yml');
    const notifier = loadWorkflow(
      '.github/workflows/ocr-infrastructure-notifier.yml',
    );
    parsed = wf.parsed;
    notifierParsed = notifier.parsed;
    const jobs = asOptionalRecord(parsed.jobs);
    gateJob = asOptionalRecord(jobs?.['mergeability-gate']);
    codeReviewJob = asOptionalRecord(jobs?.['code-review']);
    const notifierJobs = asOptionalRecord(notifierParsed.jobs);
    classifyJob = asOptionalRecord(notifierJobs?.['classify-ocr-run']);
    notifyJob = asOptionalRecord(
      notifierJobs?.['notify-ocr-infrastructure-failure'],
    );
  });

  it('adds a mergeability-gate job that calls the reusable gate', () => {
    expect(gateJob, 'should contain mergeability-gate job').toBeTruthy();
    const uses = gateJob?.uses;
    expect(uses).toBe('./.github/workflows/_pr-mergeability-gate.yml');
  });

  it('gate job carries the exact authorized event/comment predicate', () => {
    expect(normalize(asOptionalString(gateJob?.if))).toBe(
      normalize(OCR_AUTHORIZATION_PREDICATE),
    );
  });

  it('gate job passes check-mergeability=false for workflow_dispatch bypass', () => {
    const withInputs = asRecord(gateJob?.with);
    // workflow_dispatch bypasses: check-mergeability is false for dispatch
    // and true for all other authorized events.
    expect(withInputs['check-mergeability']).toBe(
      "${{ github.event_name != 'workflow_dispatch' }}",
    );
  });

  it('formats the event/input PR number as the reusable string input', () => {
    const withInputs = asRecord(gateJob?.with);
    expect(withInputs['pull-request-number']).toBe(
      "${{ format('{0}', github.event.pull_request.number || github.event.issue.number || inputs.pr_number) }}",
    );
  });

  it('passes the event head only for automatic pull_request_target work', () => {
    const withInputs = asRecord(gateJob?.with);
    expect(withInputs['expected-head-sha']).toBe(
      "${{ github.event_name == 'pull_request_target' && github.event.pull_request.head.sha || '' }}",
    );
  });

  it('does not pass a secrets contract to the reusable workflow', () => {
    expect(gateJob?.secrets).toBeUndefined();
  });

  it('uses the exact authorization-aware workflow concurrency group', () => {
    const concurrency = asOptionalRecord(parsed.concurrency);
    expect(normalize(asOptionalString(concurrency?.group))).toBe(
      normalize(OCR_CONCURRENCY_GROUP),
    );
    expect(concurrency?.['cancel-in-progress']).toBe(true);
  });

  it('keeps the sequential gate and review inside one workflow concurrency owner', () => {
    expect(gateJob?.concurrency).toBeUndefined();
    expect(codeReviewJob?.concurrency).toBeUndefined();
    // code-review now depends on both the mergeability gate and the OCR
    // auto-review limit gate (issue #2666). Assert membership and length
    // independently rather than pinning YAML ordering, which Actions treats
    // as a set.
    const needs = asStringArray(codeReviewJob?.needs);
    expect(needs).toHaveLength(2);
    expect(needs).toContain('mergeability-gate');
    expect(needs).toContain('auto-review-gate');
    const jobs = asOptionalRecord(parsed.jobs);
    expect(jobs?.['notify-ocr-infrastructure-failure']).toBeUndefined();
  });

  it('isolates the notifier in a completed-workflow run that newer reviews cannot cancel', () => {
    const on = asOptionalRecord(notifierParsed.on);
    const workflowRun = asOptionalRecord(
      on?.workflow_run ?? asOptionalRecord(notifierParsed.true)?.workflow_run,
    );
    expect(asStringArray(workflowRun?.workflows)).toEqual(['OCR Review']);
    expect(workflowRun?.types).toEqual(['completed']);
    expect(notifierParsed.concurrency).toBeUndefined();
    expect(classifyJob?.concurrency).toBeUndefined();
    const notifyConcurrency = asOptionalRecord(notifyJob?.concurrency);
    expect(notifyConcurrency?.group).toBe('ocr-review-infrastructure-issue');
    expect(notifyConcurrency?.['cancel-in-progress']).toBe(false);
    expect(normalize(asOptionalString(classifyJob?.if))).toBe(
      normalize(
        "${{ github.event.workflow_run.conclusion == 'success' || github.event.workflow_run.conclusion == 'failure' }}",
      ),
    );
    expect(normalize(asOptionalString(notifyJob?.if))).toContain(
      normalize("needs.classify-ocr-run.result == 'success'"),
    );
  });

  const authorizedScenarios = [
    ocrConcurrencyContext({
      eventName: 'pull_request_target',
      runId: 101,
      pullRequestNumber: 42,
    }),
    ocrConcurrencyContext({
      eventName: 'issue_comment',
      runId: 102,
      issueNumber: 42,
      issueIsPullRequest: true,
      association: 'OWNER',
      body: '/ocr',
    }),
    ocrConcurrencyContext({
      eventName: 'issue_comment',
      runId: 103,
      issueNumber: 42,
      issueIsPullRequest: true,
      association: 'COLLABORATOR',
      body: '/open-code-review details',
    }),
    ocrConcurrencyContext({
      eventName: 'workflow_dispatch',
      runId: 104,
      inputPrNumber: '42',
    }),
  ];

  for (const [index, scenario] of authorizedScenarios.entries()) {
    it(`maps authorized PR trigger ${index + 1} to the shared per-PR group`, () => {
      const concurrency = asOptionalRecord(parsed.concurrency);
      expect(
        evaluateOcrConcurrencyGroup(asString(concurrency?.group), scenario),
      ).toBe('OCR Review-pr-42');
    });
  }

  const isolatedScenarios = [
    {
      context: ocrConcurrencyContext({
        eventName: 'issue_comment',
        runId: 201,
        issueNumber: 42,
        issueIsPullRequest: true,
        association: 'NONE',
        body: '/ocr',
      }),
      expected: 'OCR Review-run-201',
    },
    {
      context: ocrConcurrencyContext({
        eventName: 'issue_comment',
        runId: 202,
        issueNumber: 42,
        issueIsPullRequest: true,
        association: 'MEMBER',
        body: 'please review',
      }),
      expected: 'OCR Review-run-202',
    },
    {
      context: ocrConcurrencyContext({
        eventName: 'issue_comment',
        runId: 203,
        issueNumber: 42,
        association: 'OWNER',
        body: '/ocr',
      }),
      expected: 'OCR Review-run-203',
    },
  ];

  for (const scenario of isolatedScenarios) {
    it(`isolates unauthorized or non-PR comments as ${scenario.expected}`, () => {
      const concurrency = asOptionalRecord(parsed.concurrency);
      expect(
        evaluateOcrConcurrencyGroup(
          asString(concurrency?.group),
          scenario.context,
        ),
      ).toBe(scenario.expected);
    });
  }

  it('code-review needs mergeability-gate and runs only when should-run is true', () => {
    const needs = asStringArray(codeReviewJob?.needs);
    expect(needs).toContain('mergeability-gate');
    const jobIf = normalize(asOptionalString(codeReviewJob?.if));
    expect(jobIf).toContain(
      normalize("needs.mergeability-gate.outputs.should-run == 'true'"),
    );
  });

  it('unprivileged classification reads the completed OCR artifact before notification', () => {
    const classifySteps = asRecordArray(classifyJob?.steps);
    const downloadStep = classifySteps.find(
      (step) => step.name === 'Download OCR artifacts',
    );

    expect(classifyJob?.permissions).toEqual({ actions: 'read' });
    expect(notifyJob?.needs).toBe('classify-ocr-run');
    expect(notifyJob?.permissions).toEqual({ issues: 'write' });
    const downloadWith = asOptionalRecord(downloadStep?.with);
    expect(downloadWith?.['run-id']).toBe(
      '${{ github.event.workflow_run.id }}',
    );
    expect(downloadWith?.['github-token']).toBe('${{ github.token }}');
    expect(asString(downloadWith?.repository)).toBe('${{ github.repository }}');
    const notifySteps = asRecordArray(notifyJob?.steps);
    expect(
      notifySteps?.some((step) => step.name === 'Download OCR artifacts'),
    ).toBe(false);
  });

  it('preserves existing fork-safety, checkout, permissions, and command syntax', () => {
    // The review job runs only when the gate permits; its own if is the
    // should-run gate output, and the authorized predicate lives on the gate.
    const codeReviewIf = normalize(asOptionalString(codeReviewJob?.if));
    expect(codeReviewIf).toContain(
      normalize("needs.mergeability-gate.outputs.should-run == 'true'"),
    );
    // Permissions unchanged
    const permissions = asOptionalRecord(parsed.permissions);
    expect(permissions?.contents).toBe('read');
    expect(permissions?.['pull-requests']).toBe('write');
    expect(permissions?.issues).toBe('write');
    // code-review still has the Resolve PR context step
    const codeReviewSteps = asRecordArray(codeReviewJob?.steps);
    expect(codeReviewSteps?.some((s) => s.name === 'Resolve PR context')).toBe(
      true,
    );
    expect(codeReviewJob?.['timeout-minutes']).toBe(120);
  });

  it('the gate job has no checkout, no secrets, and no code execution', () => {
    const steps = asStringArray(gateJob?.steps ?? []);
    expect(steps.length).toBe(0);
    const withInputs = asRecord(gateJob?.with ?? {});
    for (const value of Object.values(withInputs)) {
      expect(String(value)).not.toContain('secrets.');
    }
    expect(gateJob?.uses).not.toContain('actions/checkout');
  });
});

describe('PR Review mergeability gate wiring (.github/workflows/pr-review.yml)', () => {
  let parsed: Record<string, unknown>;
  let gateJob: Record<string, unknown> | undefined;
  let reviewJob: Record<string, unknown> | undefined;

  beforeAll(() => {
    const wf = loadWorkflow('.github/workflows/pr-review.yml');
    parsed = wf.parsed;
    const jobs = asOptionalRecord(parsed.jobs);
    gateJob = asOptionalRecord(jobs?.['mergeability-gate']);
    reviewJob = asOptionalRecord(jobs?.review);
  });

  it('retains existing trigger types and workflow-level concurrency', () => {
    const on = asOptionalRecord(parsed.on);
    const prt = asOptionalRecord(on?.pull_request_target);
    expect(asStringArray(prt?.types)).toContain('opened');
    expect(asStringArray(prt?.types)).toContain('reopened');
    expect(asStringArray(prt?.types)).toContain('synchronize');
    expect(asStringArray(prt?.types)).toContain('ready_for_review');
    expect(asStringArray(prt?.types)).toContain('edited');
    const concurrency = asOptionalRecord(parsed.concurrency);
    expect(concurrency?.group).toContain(
      'llxprt-pr-review-${{ github.event.pull_request.number }}',
    );
    expect(concurrency?.['cancel-in-progress']).toBe(true);
  });

  it('adds a read-only reusable gate before the expensive review', () => {
    expect(gateJob, 'should contain mergeability-gate job').toBeTruthy();
    expect(gateJob?.uses).toBe('./.github/workflows/_pr-mergeability-gate.yml');
  });

  it('gate receives the string-formatted event PR number and head SHA', () => {
    const withInputs = asRecord(gateJob?.with);
    expect(withInputs['check-mergeability']).toBe(true);
    expect(withInputs['pull-request-number']).toBe(
      "${{ format('{0}', github.event.pull_request.number) }}",
    );
    expect(withInputs['expected-head-sha']).toBe(
      '${{ github.event.pull_request.head.sha }}',
    );
  });

  it('proceeds with a matching immutable head and exports real git results', () => {
    const reviewSteps = asRecordArray(reviewJob?.steps);
    const fetchStep = reviewSteps.find(
      (step) => step.name === 'Fetch pull request head',
    );
    const result = runFetchHeadStepWithRealRepository(asRecord(fetchStep));

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('aborting');
    expect(result.fetchedHeadSha).toBe(result.headSha);
    expect(result.exportedEnvironment).toBe(
      `PR_HEAD_REF=refs/pr/42
PR_HEAD_SHA=${result.headSha}
BASE_SHA=${result.baseSha}
MERGE_BASE=${result.baseSha}
`,
    );
    expect(result.exportedOutputs).toBe(
      `head_sha=${result.headSha}
base_sha=${result.baseSha}
merge_base=${result.baseSha}
`,
    );
  });

  it('rejects a fetched branch tip that no longer matches the event head', () => {
    const reviewSteps = asRecordArray(reviewJob?.steps);
    const fetchStep = reviewSteps.find(
      (step) => step.name === 'Fetch pull request head',
    );

    expect(asRecord(fetchStep?.env)?.EXPECTED_HEAD_SHA).toBe(
      '${{ github.event.pull_request.head.sha }}',
    );

    const result = runFetchHeadStepWithRealRepository(asRecord(fetchStep), {
      expectedHeadSha: 'event-head-sha',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      `Fetched PR head changed from event SHA event-head-sha to ${result.headSha}; aborting.`,
    );
    expect(result.exportedEnvironment).toBe('');
    expect(result.exportedOutputs).toBe('');
  });

  it('does not pass a secrets contract to the reusable workflow', () => {
    expect(gateJob?.secrets).toBeUndefined();
  });

  it('review job needs the gate and runs only when permitted', () => {
    const needs = asStringArray(reviewJob?.needs);
    expect(needs).toContain('mergeability-gate');
    const reviewIf = normalize(asOptionalString(reviewJob?.if));
    expect(reviewIf).toContain(
      normalize("needs.mergeability-gate.outputs.should-run == 'true'"),
    );
  });

  it('keeps provider secrets out of the gate and scopes them to the quota and walkthrough steps', () => {
    const reviewSteps = asRecordArray(reviewJob?.steps);
    const quotaStep = reviewSteps.find(({ id }) => id === 'quota');
    const step = reviewSteps.find(
      ({ name }) => name === 'Run walkthrough pipeline',
    );
    if (quotaStep === undefined || step === undefined) {
      throw new Error('expected quota and walkthrough steps to exist');
    }

    expect(hasSecret(gateJob)).toBe(false);
    expect(hasSecret(reviewJob?.env)).toBe(false);
    expect(quotaStep?.env).toEqual({
      KEY_VAR_NAME: '${{ vars.KEY_VAR_NAME }}',
      OPENAI_API_KEY: '${{ secrets[vars.KEY_VAR_NAME] }}',
      OPENAI_API_KEY_2: '${{ secrets[vars.KEY_VAR_NAME_2] }}',
    });
    expect(step?.env).toEqual({
      OPENAI_API_KEY:
        "${{ steps.quota.outputs.selected_key == 'primary' && secrets[vars.KEY_VAR_NAME] || steps.quota.outputs.selected_key == 'secondary' && secrets[vars.KEY_VAR_NAME_2] || '' }}",
    });
    expect(reviewSteps.filter(hasSecret)).toEqual([quotaStep, step]);
  });
});
