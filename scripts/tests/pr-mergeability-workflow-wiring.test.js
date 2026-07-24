/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from 'vitest';
import vm from 'vm';
import yaml from 'js-yaml';
import { normalize, readRootFile } from './ocr-review-workflow-helpers.js';
import { runFetchHeadStepWithRealRepository } from './pr-mergeability-workflow-test-helpers.js';

function loadWorkflow(path) {
  const source = readRootFile(path);
  try {
    const parsed = yaml.load(source);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`${path} did not parse to a YAML mapping`);
    }
    return { source, parsed };
  } catch (error) {
    throw new Error(`Failed to parse ${path}: ${error.message}`, {
      cause: error,
    });
  }
}

const OCR_AUTHORIZATION_PREDICATE = `
  github.event_name == 'workflow_dispatch' ||
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
    startsWith(toJSON(github.event.comment.body), '"/open-code-review\\t')))
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
       startsWith(toJSON(github.event.comment.body), '"/open-code-review\\t')))) &&
    format('{0}-pr-{1}', github.workflow,
      github.event.pull_request.number || github.event.issue.number || inputs.pr_number) ||
    format('{0}-run-{1}', github.workflow, github.run_id)
  }}
`;

function evaluateOcrConcurrencyGroup(group, { github, inputs = {} }) {
  const expression = group.trim().slice(3, -2).trim();
  return vm.runInNewContext(expression, {
    github,
    inputs,
    startsWith: (value, prefix) => String(value).startsWith(prefix),
    toJSON: (value) => JSON.stringify(value),
    format: (template, ...values) =>
      template.replace(/{(\d+)}/g, (_match, index) => values[Number(index)]),
  });
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
}) {
  return {
    github: {
      workflow: 'OCR Review',
      run_id: runId,
      event_name: eventName,
      event: {
        pull_request: { number: pullRequestNumber },
        issue: {
          number: issueNumber,
          pull_request: issueIsPullRequest ? {} : null,
        },
        comment: {
          author_association: association,
          body,
        },
      },
    },
    inputs: { pr_number: inputPrNumber },
  };
}

const E2E_GATE_PREDICATE = `
  \${{ needs.skip_check.result == 'success' &&
      needs.skip_check.outputs.should_skip != 'true' &&
      github.event_name == 'pull_request_target' &&
      github.event.action == 'labeled' &&
      github.event.label.name == 'maintainer:e2e:ok' }}
`;

const E2E_DOC_FILTER_PREDICATE = `
  \${{ needs.skip_check.result == 'success' &&
      needs.skip_check.outputs.should_skip != 'true' &&
      (github.event_name != 'pull_request_target' ||
       (github.event.action == 'labeled' &&
        github.event.label.name == 'maintainer:e2e:ok')) }}
`;

function evaluateE2ECondition(condition, context) {
  const expression = condition
    .replaceAll('needs.mergeability-gate', "needs['mergeability-gate']")
    .replaceAll('.outputs.should-run', ".outputs['should-run']")
    .trim();
  return vm.runInNewContext(expression, {
    ...context,
    cancelled: () => context.cancelled ?? false,
  });
}

function e2eContext({
  eventName,
  action = '',
  label = '',
  headRepository = 'vybestack/llxprt-code',
  repository = 'vybestack/llxprt-code',
  skipResult = 'success',
  shouldSkip = 'false',
  docResult = 'success',
  docsOnly = 'false',
  gateResult = 'skipped',
  shouldRun,
  cancelled = false,
}) {
  return {
    cancelled,
    github: {
      event_name: eventName,
      event: {
        action,
        label: { name: label },
        pull_request: { head: { repo: { full_name: headRepository } } },
      },
      repository,
    },
    needs: {
      skip_check: { result: skipResult, outputs: { should_skip: shouldSkip } },
      e2e_doc_change_filter: {
        result: docResult,
        outputs: { docs_only: docsOnly },
      },
      'mergeability-gate': {
        result: gateResult,
        outputs: { 'should-run': shouldRun },
      },
    },
  };
}

describe('OCR mergeability gate wiring (.github/workflows/ocr-review.yml)', () => {
  let parsed;
  let notifierParsed;
  let gateJob;
  let codeReviewJob;
  let classifyJob;
  let notifyJob;

  beforeAll(() => {
    const wf = loadWorkflow('.github/workflows/ocr-review.yml');
    const notifier = loadWorkflow(
      '.github/workflows/ocr-infrastructure-notifier.yml',
    );
    parsed = wf.parsed;
    notifierParsed = notifier.parsed;
    gateJob = parsed.jobs?.['mergeability-gate'];
    codeReviewJob = parsed.jobs?.['code-review'];
    classifyJob = notifierParsed.jobs?.['classify-ocr-run'];
    notifyJob = notifierParsed.jobs?.['notify-ocr-infrastructure-failure'];
  });

  it('adds a mergeability-gate job that calls the reusable gate', () => {
    expect(gateJob, 'should contain mergeability-gate job').toBeTruthy();
    const uses = gateJob.uses;
    expect(uses).toBe('./.github/workflows/_pr-mergeability-gate.yml');
  });

  it('gate job carries the exact authorized event/comment predicate', () => {
    expect(normalize(gateJob.if)).toBe(normalize(OCR_AUTHORIZATION_PREDICATE));
  });

  it('gate job passes check-mergeability=false for workflow_dispatch bypass', () => {
    const withInputs = gateJob.with;
    // workflow_dispatch bypasses: check-mergeability is false for dispatch
    // and true for all other authorized events.
    expect(withInputs['check-mergeability']).toBe(
      "${{ github.event_name != 'workflow_dispatch' }}",
    );
  });

  it('formats the event/input PR number as the reusable string input', () => {
    expect(gateJob.with['pull-request-number']).toBe(
      "${{ format('{0}', github.event.pull_request.number || github.event.issue.number || inputs.pr_number) }}",
    );
  });

  it('passes the event head only for automatic pull_request_target work', () => {
    expect(gateJob.with['expected-head-sha']).toBe(
      "${{ github.event_name == 'pull_request_target' && github.event.pull_request.head.sha || '' }}",
    );
  });

  it('does not pass a secrets contract to the reusable workflow', () => {
    expect(gateJob.secrets).toBeUndefined();
  });

  it('uses the exact authorization-aware workflow concurrency group', () => {
    expect(normalize(parsed.concurrency?.group)).toBe(
      normalize(OCR_CONCURRENCY_GROUP),
    );
    expect(parsed.concurrency?.['cancel-in-progress']).toBe(true);
  });

  it('keeps the sequential gate and review inside one workflow concurrency owner', () => {
    expect(gateJob.concurrency).toBeUndefined();
    expect(codeReviewJob.concurrency).toBeUndefined();
    expect(codeReviewJob.needs).toEqual(['mergeability-gate']);
    expect(parsed.jobs?.['notify-ocr-infrastructure-failure']).toBeUndefined();
  });

  it('isolates the notifier in a completed-workflow run that newer reviews cannot cancel', () => {
    const workflowRun =
      notifierParsed.on?.workflow_run ?? notifierParsed.true?.workflow_run;

    expect(workflowRun.workflows).toEqual(['OCR Review']);
    expect(workflowRun.types).toEqual(['completed']);
    expect(notifierParsed.concurrency).toBeUndefined();
    expect(classifyJob.concurrency).toBeUndefined();
    expect(notifyJob.concurrency?.group).toBe(
      'ocr-review-infrastructure-issue',
    );
    expect(notifyJob.concurrency?.['cancel-in-progress']).toBe(false);
    expect(normalize(classifyJob.if)).toBe(
      normalize(
        "${{ github.event.workflow_run.conclusion == 'success' || github.event.workflow_run.conclusion == 'failure' }}",
      ),
    );
    expect(normalize(notifyJob.if)).toContain(
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
      expect(
        evaluateOcrConcurrencyGroup(parsed.concurrency.group, scenario),
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
      expect(
        evaluateOcrConcurrencyGroup(parsed.concurrency.group, scenario.context),
      ).toBe(scenario.expected);
    });
  }

  it('code-review needs mergeability-gate and runs only when should-run is true', () => {
    expect(codeReviewJob.needs).toContain('mergeability-gate');
    const jobIf = normalize(codeReviewJob.if);
    expect(jobIf).toContain(
      normalize("needs.mergeability-gate.outputs.should-run == 'true'"),
    );
  });

  it('unprivileged classification reads the completed OCR artifact before notification', () => {
    const downloadStep = classifyJob.steps.find(
      (step) => step.name === 'Download OCR artifacts',
    );

    expect(classifyJob.permissions).toEqual({ actions: 'read' });
    expect(notifyJob.needs).toBe('classify-ocr-run');
    expect(notifyJob.permissions).toEqual({ issues: 'write' });
    expect(downloadStep.with['run-id']).toBe(
      '${{ github.event.workflow_run.id }}',
    );
    expect(downloadStep.with['github-token']).toBe('${{ github.token }}');
    expect(downloadStep.with.repository).toBe('${{ github.repository }}');
    expect(
      notifyJob.steps.some((step) => step.name === 'Download OCR artifacts'),
    ).toBe(false);
  });

  it('preserves existing fork-safety, checkout, permissions, and command syntax', () => {
    // The review job runs only when the gate permits; its own if is the
    // should-run gate output, and the authorized predicate lives on the gate.
    const codeReviewIf = normalize(codeReviewJob.if);
    expect(codeReviewIf).toContain(
      normalize("needs.mergeability-gate.outputs.should-run == 'true'"),
    );
    // Permissions unchanged
    expect(parsed.permissions?.contents).toBe('read');
    expect(parsed.permissions?.['pull-requests']).toBe('write');
    expect(parsed.permissions?.issues).toBe('write');
    // code-review still has the Resolve PR context step
    expect(
      codeReviewJob.steps.some((s) => s.name === 'Resolve PR context'),
    ).toBe(true);
    expect(codeReviewJob['timeout-minutes']).toBe(60);
  });

  it('the gate job has no checkout, no secrets, and no code execution', () => {
    const steps = gateJob.steps ?? [];
    expect(steps.length).toBe(0);
    const withInputs = gateJob.with ?? {};
    for (const value of Object.values(withInputs)) {
      expect(String(value)).not.toContain('secrets.');
    }
    expect(gateJob.uses).not.toContain('actions/checkout');
  });
});

describe('PR Review mergeability gate wiring (.github/workflows/pr-review.yml)', () => {
  let parsed;
  let gateJob;
  let reviewJob;

  beforeAll(() => {
    const wf = loadWorkflow('.github/workflows/pr-review.yml');
    parsed = wf.parsed;
    gateJob = parsed.jobs?.['mergeability-gate'];
    reviewJob = parsed.jobs?.review;
  });

  it('retains existing trigger types and workflow-level concurrency', () => {
    const prt = parsed.on?.pull_request_target;
    expect(prt.types).toContain('opened');
    expect(prt.types).toContain('reopened');
    expect(prt.types).toContain('synchronize');
    expect(prt.types).toContain('ready_for_review');
    expect(prt.types).toContain('edited');
    expect(parsed.concurrency?.group).toContain(
      'llxprt-pr-review-${{ github.event.pull_request.number }}',
    );
    expect(parsed.concurrency?.['cancel-in-progress']).toBe(true);
  });

  it('adds a read-only reusable gate before the expensive review', () => {
    expect(gateJob, 'should contain mergeability-gate job').toBeTruthy();
    expect(gateJob.uses).toBe('./.github/workflows/_pr-mergeability-gate.yml');
  });

  it('gate receives the string-formatted event PR number and head SHA', () => {
    const withInputs = gateJob.with;
    expect(withInputs['check-mergeability']).toBe(true);
    expect(withInputs['pull-request-number']).toBe(
      "${{ format('{0}', github.event.pull_request.number) }}",
    );
    expect(withInputs['expected-head-sha']).toBe(
      '${{ github.event.pull_request.head.sha }}',
    );
  });

  it('proceeds with a matching immutable head and exports real git results', () => {
    const fetchStep = reviewJob.steps.find(
      (step) => step.name === 'Fetch pull request head',
    );
    const result = runFetchHeadStepWithRealRepository(fetchStep);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('aborting');
    expect(result.fetchedHeadSha).toBe(result.headSha);
    expect(result.exportedEnvironment).toBe(
      `PR_HEAD_REF=refs/pr/42\nPR_HEAD_SHA=${result.headSha}\nBASE_SHA=${result.baseSha}\nMERGE_BASE=${result.baseSha}\n`,
    );
    expect(result.exportedOutputs).toBe(
      `head_sha=${result.headSha}\nbase_sha=${result.baseSha}\nmerge_base=${result.baseSha}\n`,
    );
  });

  it('rejects a fetched branch tip that no longer matches the event head', () => {
    const fetchStep = reviewJob.steps.find(
      (step) => step.name === 'Fetch pull request head',
    );

    expect(fetchStep.env.EXPECTED_HEAD_SHA).toBe(
      '${{ github.event.pull_request.head.sha }}',
    );

    const result = runFetchHeadStepWithRealRepository(fetchStep, {
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
    expect(gateJob.secrets).toBeUndefined();
  });

  it('review job needs the gate and runs only when permitted', () => {
    expect(reviewJob.needs).toContain('mergeability-gate');
    const reviewIf = normalize(reviewJob.if);
    expect(reviewIf).toContain(
      normalize("needs.mergeability-gate.outputs.should-run == 'true'"),
    );
  });

  it('gate job does not receive provider secrets; only the review job does', () => {
    const gateEnv = gateJob.env ?? {};
    const gateWith = gateJob.with ?? {};
    const gateSource = normalize(
      JSON.stringify({ env: gateEnv, with: gateWith }),
    );
    expect(gateSource).not.toContain('OPENAI_API_KEY');
    expect(gateSource).not.toContain('KEY_VAR_NAME');

    // Review job should still have provider secrets
    const reviewEnv = reviewJob.env ?? {};
    const reviewEnvStr = JSON.stringify(reviewEnv);
    expect(reviewEnvStr).toContain('OPENAI_API_KEY');
  });
});

describe('E2E mergeability gate wiring (.github/workflows/e2e.yml)', () => {
  let parsed;
  let linuxJob;
  let macJob;
  let gateJob;
  let docFilterJob;

  beforeAll(() => {
    const wf = loadWorkflow('.github/workflows/e2e.yml');
    parsed = wf.parsed;
    linuxJob = parsed.jobs?.e2e_linux;
    macJob = parsed.jobs?.e2e_mac;
    gateJob = parsed.jobs?.['mergeability-gate'];
    docFilterJob = parsed.jobs?.e2e_doc_change_filter;
  });

  it('retains existing push, pull_request, merge_group, workflow_dispatch triggers', () => {
    expect(parsed.on?.push).toBeTruthy();
    expect(parsed.on?.pull_request).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(parsed.on, 'merge_group')).toBe(
      true,
    );
    expect(parsed.on?.workflow_dispatch).toBeTruthy();
  });

  it('permits only labeled pull_request_target triggers', () => {
    expect(parsed.on?.pull_request_target?.types).toEqual(['labeled']);
  });

  it('limits mergeability gate and target setup to the exact approved label event', () => {
    expect(normalize(gateJob.if)).toBe(normalize(E2E_GATE_PREDICATE));
    expect(normalize(docFilterJob.if)).toBe(
      normalize(E2E_DOC_FILTER_PREDICATE),
    );
  });

  it('passes no secrets contract to the target mergeability gate', () => {
    expect(gateJob.secrets).toBeUndefined();
  });

  it('formats the event PR number as the reusable string input', () => {
    expect(gateJob.with['pull-request-number']).toBe(
      "${{ format('{0}', github.event.pull_request.number) }}",
    );
  });

  const truthTable = [
    {
      name: 'push with intentionally skipped gate',
      eventName: 'push',
      linux: true,
      mac: false,
    },
    {
      name: 'merge group with intentionally skipped gate',
      eventName: 'merge_group',
      linux: true,
      mac: true,
    },
    {
      name: 'manual dispatch with intentionally skipped gate',
      eventName: 'workflow_dispatch',
      linux: true,
      mac: true,
    },
    {
      name: 'internal pull request with intentionally skipped gate',
      eventName: 'pull_request',
      linux: true,
      mac: true,
    },
    {
      name: 'fork pull request in native context',
      eventName: 'pull_request',
      headRepository: 'fork/repo',
      linux: false,
      mac: false,
    },
    {
      name: 'approved target event with successful true gate',
      eventName: 'pull_request_target',
      headRepository: 'fork/repo',
      action: 'labeled',
      label: 'maintainer:e2e:ok',
      gateResult: 'success',
      shouldRun: 'true',
      linux: true,
      mac: true,
    },
    {
      name: 'approved internal target event',
      eventName: 'pull_request_target',
      headRepository: 'vybestack/llxprt-code',
      action: 'labeled',
      label: 'maintainer:e2e:ok',
      gateResult: 'success',
      shouldRun: 'true',
      linux: true,
      mac: true,
    },
    {
      name: 'approved target event with false gate',
      eventName: 'pull_request_target',
      headRepository: 'fork/repo',
      action: 'labeled',
      label: 'maintainer:e2e:ok',
      gateResult: 'success',
      shouldRun: 'false',
      linux: false,
      mac: false,
    },
    {
      name: 'approved target event with failed gate',
      eventName: 'pull_request_target',
      headRepository: 'fork/repo',
      action: 'labeled',
      label: 'maintainer:e2e:ok',
      gateResult: 'failure',
      shouldRun: 'true',
      linux: false,
      mac: false,
    },
    {
      name: 'approved target event with skipped gate',
      eventName: 'pull_request_target',
      headRepository: 'fork/repo',
      action: 'labeled',
      label: 'maintainer:e2e:ok',
      gateResult: 'skipped',
      linux: false,
      mac: false,
    },
    {
      name: 'unapproved target label',
      eventName: 'pull_request_target',
      headRepository: 'fork/repo',
      action: 'labeled',
      label: 'other',
      gateResult: 'skipped',
      linux: false,
      mac: false,
    },
    {
      name: 'fork synchronize cannot reuse a persistent approval label',
      eventName: 'pull_request_target',
      headRepository: 'fork/repo',
      action: 'synchronize',
      gateResult: 'skipped',
      linux: false,
      mac: false,
    },
    {
      name: 'failed duplicate check',
      eventName: 'merge_group',
      skipResult: 'failure',
      linux: false,
      mac: false,
    },
    {
      name: 'duplicate content',
      eventName: 'merge_group',
      shouldSkip: 'true',
      linux: false,
      mac: false,
    },
    {
      name: 'failed doc filter',
      eventName: 'merge_group',
      docResult: 'failure',
      linux: false,
      mac: false,
    },
    {
      name: 'documentation-only change',
      eventName: 'merge_group',
      docsOnly: 'true',
      linux: false,
      mac: false,
    },
    {
      name: 'native event with failed gate',
      eventName: 'merge_group',
      gateResult: 'failure',
      linux: false,
      mac: false,
    },
    {
      name: 'cancelled workflow',
      eventName: 'merge_group',
      cancelled: true,
      linux: false,
      mac: false,
    },
  ];

  for (const scenario of truthTable) {
    it(`enforces dependency and authorization truth table: ${scenario.name}`, () => {
      const context = e2eContext(scenario);

      expect(Boolean(evaluateE2ECondition(linuxJob.if, context))).toBe(
        scenario.linux,
      );
      expect(Boolean(evaluateE2ECondition(macJob.if, context))).toBe(
        scenario.mac,
      );
    });
  }

  it('models every target event with an explicit fork head plus preserved internal behavior', () => {
    const targetScenarios = truthTable.filter(
      (scenario) => scenario.eventName === 'pull_request_target',
    );
    const internalScenario = targetScenarios.find(
      (scenario) => scenario.name === 'approved internal target event',
    );

    expect(internalScenario).toMatchObject({
      headRepository: 'vybestack/llxprt-code',
      linux: true,
      mac: true,
    });
    for (const scenario of targetScenarios) {
      expect(
        Object.prototype.hasOwnProperty.call(scenario, 'headRepository'),
        `${scenario.name} must declare its head repository`,
      ).toBe(true);
      if (scenario !== internalScenario) {
        expect(scenario.headRepository).toBe('fork/repo');
      }
    }
  });
  it('requires the exact dependency conjunctions for both E2E jobs', () => {
    for (const job of [linuxJob, macJob]) {
      expect(job.needs).toEqual([
        'e2e_doc_change_filter',
        'skip_check',
        'mergeability-gate',
      ]);
      const predicate = normalize(job.if);
      expect(predicate).toContain(
        normalize("needs.skip_check.result == 'success'"),
      );
      expect(predicate).toContain(
        normalize("needs.e2e_doc_change_filter.result == 'success'"),
      );
      expect(predicate).toContain(
        normalize("needs.mergeability-gate.result == 'success'"),
      );
      expect(predicate).toContain(
        normalize("needs.mergeability-gate.outputs.should-run == 'true'"),
      );
      expect(predicate).toContain(
        normalize("needs.mergeability-gate.result == 'skipped'"),
      );
      expect(predicate).not.toContain(
        normalize("needs.mergeability-gate.outputs.should-run != 'false'"),
      );
    }
  });

  it('preserves Linux/macOS concurrency, docs-only skip, matrix, continue-on-error', () => {
    expect(linuxJob.concurrency?.['cancel-in-progress']).toBe(true);
    expect(macJob.concurrency?.['cancel-in-progress']).toBe(true);
    expect(linuxJob.concurrency.group).toContain('${{ matrix.sandbox }}');
    expect(macJob.continue_on_error ?? macJob['continue-on-error']).toBe(true);
    expect(linuxJob.strategy?.matrix?.sandbox).toContain('sandbox:none');
    expect(linuxJob.strategy?.matrix?.sandbox).toContain('sandbox:docker');
  });

  it('retains the duplicate-check action', () => {
    const skipStep = parsed.jobs?.skip_check?.steps?.find(
      (step) => step.id === 'skip_check',
    );
    expect(skipStep?.uses).toContain('skip-duplicate-actions');
  });
});

describe('Intentionally unchanged native workflows', () => {
  it('ci.yml does not reference the mergeability gate', () => {
    const ci = readRootFile('.github/workflows/ci.yml');
    expect(ci).not.toContain('_pr-mergeability-gate');
    expect(ci).not.toContain('mergeability-gate');
  });

  it('interactive-ui.yml does not reference the mergeability gate', () => {
    const ui = readRootFile('.github/workflows/interactive-ui.yml');
    expect(ui).not.toContain('_pr-mergeability-gate');
    expect(ui).not.toContain('mergeability-gate');
  });

  it('windows-installed-command.yml does not reference the mergeability gate', () => {
    const win = readRootFile('.github/workflows/windows-installed-command.yml');
    expect(win).not.toContain('_pr-mergeability-gate');
    expect(win).not.toContain('mergeability-gate');
  });

  it('auto-label-trusted-contributors.yml does not reference the mergeability gate', () => {
    const al = readRootFile(
      '.github/workflows/auto-label-trusted-contributors.yml',
    );
    expect(al).not.toContain('_pr-mergeability-gate');
    expect(al).not.toContain('mergeability-gate');
  });

  it('.coderabbit.yaml does not reference the mergeability gate', () => {
    const cr = readRootFile('.coderabbit.yaml');
    expect(cr).not.toContain('_pr-mergeability-gate');
    expect(cr).not.toContain('mergeability-gate');
  });
});

describe('Issue 2587 documented platform limitations', () => {
  it('does not claim GITHUB_TOKEN auto-label writes trigger E2E recursively', () => {
    const plan = readRootFile('project-plans/issue2587.md');
    expect(plan).toContain(
      'Events created by the repository `GITHUB_TOKEN` do not recursively start `labeled` workflows',
    );
    expect(plan).toContain(
      'remove and re-add `maintainer:e2e:ok` after the head changes',
    );
    expect(plan).toContain('manual `workflow_dispatch`');
    expect(plan).not.toContain(
      'its `synchronize` behavior can apply the label that emits an authorized `labeled` event',
    );
    expect(plan).not.toContain('Approved fork E2E reevaluates mergeability');
  });
});
