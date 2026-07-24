/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from 'vitest';
import vm from 'vm';
import yaml from 'js-yaml';
import {
  WORKFLOW_PATH,
  commandText,
  normalize,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.js';

const MARKER = '<!-- llxprt-code-ocr-review -->';

/**
 * Load and parse the OCR review workflow, extracting the auto-review-gate
 * and post-suspension job scripts for behavioral execution.
 */
function loadAutoReviewScripts() {
  const source = readRootFile(WORKFLOW_PATH);
  const parsed = yaml.load(source);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${WORKFLOW_PATH} did not parse to a YAML mapping`);
  }
  const autoReviewJob = parsed.jobs?.['auto-review-gate'];
  const postSuspensionJob = parsed.jobs?.['post-suspension'];
  const codeReviewJob = parsed.jobs?.['code-review'];
  return { source, parsed, autoReviewJob, postSuspensionJob, codeReviewJob };
}

/**
 * Find the github-script step in a job and return its script body.
 */
function scriptFromJob(job, stepName) {
  const step = stepNamed(job, stepName);
  const script = step.with?.script;
  if (typeof script !== 'string' || script.trim().length === 0) {
    throw new Error(`${stepName} should have a non-empty github-script body`);
  }
  return { step, script };
}

/**
 * Execute the real auto-review-gate script in an isolated VM sandbox with
 * faked GitHub infrastructure. Only Octokit REST and context are faked —
 * the actual decision logic runs unchanged.
 */
async function executeAutoReviewGate({
  script,
  eventName = 'pull_request_target',
  eventAction = 'synchronize',
  prNumber = '42',
  autoReviewLimit = '',
  commentBody = '',
  changesFrom = '',
  commentUserType = 'Bot',
  listComments = [],
  updateCommentResult = null,
}) {
  const outputs = {};
  const warnings = [];
  const updateCalls = [];
  let failure = null;

  const fakeGithub = {
    paginate: async (fn, options) => {
      const result = await fn(options);
      return result.data;
    },
    rest: {
      issues: {
        listComments: async () => ({ data: listComments }),
        updateComment: async (opts) => {
          updateCalls.push(opts);
          if (updateCommentResult instanceof Error) throw updateCommentResult;
          return updateCommentResult || { status: 200 };
        },
      },
    },
  };

  const fakeCore = {
    setOutput: (name, value) => {
      outputs[name] = String(value);
    },
    warning: (message) => {
      warnings.push(String(message));
    },
    info: () => {},
    setFailed: (message) => {
      failure = String(message);
    },
  };

  const fakeContext = {
    repo: { owner: 'test-owner', repo: 'test-repo' },
    eventName,
    payload: {
      action: eventAction,
      issue: { number: Number(prNumber), pull_request: {} },
      comment: commentBody
        ? { body: commentBody, user: { type: commentUserType }, id: 999 }
        : undefined,
      changes: changesFrom ? { body: { from: changesFrom } } : undefined,
    },
  };

  const sandbox = {
    github: fakeGithub,
    core: fakeCore,
    context: fakeContext,
    process: {
      env: {
        PR_NUMBER: prNumber,
        OCR_AUTO_REVIEW_LIMIT: autoReviewLimit,
        OCR_AUTO_REVIEW_LIMIT_DEFAULT: '2',
        EVENT_NAME: eventName,
        EVENT_ACTION: eventAction,
        COMMENT_BODY: commentBody,
        COMMENT_USER_TYPE: commentUserType,
        CHANGES_FROM: changesFrom,
      },
    },
    setTimeout: (fn) => {
      fn();
      return 0;
    },
    clearTimeout: () => {},
    console: { log: () => {}, warn: (m) => warnings.push(String(m)) },
    AbortSignal,
    Number,
    String,
    Boolean,
    Math,
    JSON,
    Error,
    Promise,
    Date,
    Array,
    Object,
    parseInt,
    RegExp,
  };

  const promise = vm.runInNewContext(`(async () => { ${script} })()`, sandbox);
  await promise;

  return { outputs, warnings, updateCalls, failure };
}

describe('.github/workflows/ocr-review.yml — auto-review limit (issue #2666)', () => {
  let workflow;
  let autoReviewJob;
  let postSuspensionJob;
  let codeReviewJob;
  let mergeabilityGateJob;
  let autoGateScript;
  let postSuspensionScript;

  beforeAll(() => {
    const loaded = loadAutoReviewScripts();
    workflow = loaded.parsed;
    autoReviewJob = loaded.autoReviewJob;
    postSuspensionJob = loaded.postSuspensionJob;
    codeReviewJob = loaded.codeReviewJob;
    mergeabilityGateJob = workflow.jobs?.['mergeability-gate'];

    expect(
      autoReviewJob,
      'workflow should contain an auto-review-gate job',
    ).toBeTruthy();
    expect(
      postSuspensionJob,
      'workflow should contain a post-suspension job',
    ).toBeTruthy();

    const autoGate = scriptFromJob(autoReviewJob, 'Decide auto-review limit');
    autoGateScript = autoGate.script;
    const postSusp = scriptFromJob(
      postSuspensionJob,
      'Post OCR suspension message',
    );
    postSuspensionScript = postSusp.script;
  });

  // ---- YAML structural tests ----

  it('adds issue_comment.edited to the trigger types', () => {
    const types = workflow.on?.issue_comment?.types ?? [];
    expect(types).toContain('created');
    expect(types).toContain('edited');
  });

  it('adds /review to the concurrency group authorized commands', () => {
    const concurrencyGroup = normalize(workflow.concurrency?.group);
    expect(concurrencyGroup).toContain(
      "github.event.comment.body == '/review'",
    );
    expect(concurrencyGroup).toContain(
      "startsWith(github.event.comment.body, '/review ')",
    );
  });

  it('adds /review to the mergeability-gate if filter', () => {
    const gateIf = normalize(mergeabilityGateJob.if);
    expect(gateIf).toContain("github.event.comment.body == '/review'");
    expect(gateIf).toContain(
      "startsWith(github.event.comment.body, '/review ')",
    );
  });

  it('adds edited-comment conditions to the mergeability-gate if filter', () => {
    const gateIf = normalize(mergeabilityGateJob.if);
    expect(gateIf).toContain("github.event.action == 'edited'");
    expect(gateIf).toContain('contains(github.event.comment.body');
    expect(gateIf).toContain("github.event.comment.user.type == 'Bot'");
  });

  it('adds an auto-review-gate job that needs mergeability-gate', () => {
    expect(autoReviewJob.needs).toContain('mergeability-gate');
    expect(normalize(autoReviewJob.if)).toContain(
      normalize("needs.mergeability-gate.outputs.should-run == 'true'"),
    );
  });

  it('exposes auto-review-gate outputs', () => {
    const outputs = autoReviewJob.outputs || {};
    expect(outputs['auto-should-run']).toBeTruthy();
    expect(outputs['suspended']).toBeTruthy();
    expect(outputs['is-manual']).toBeTruthy();
    expect(outputs['current-count']).toBeTruthy();
  });

  it('code-review needs auto-review-gate and runs when auto-should-run is true', () => {
    expect(codeReviewJob.needs).toContain('auto-review-gate');
    expect(codeReviewJob.needs).toContain('mergeability-gate');
    expect(normalize(codeReviewJob.if)).toContain(
      normalize("needs.auto-review-gate.outputs.auto-should-run == 'true'"),
    );
  });

  it('post-suspension runs when suspended is true', () => {
    expect(postSuspensionJob.needs).toContain('mergeability-gate');
    expect(postSuspensionJob.needs).toContain('auto-review-gate');
    expect(normalize(postSuspensionJob.if)).toContain(
      normalize("needs.auto-review-gate.outputs.suspended == 'true'"),
    );
  });

  it('reads OCR_AUTO_REVIEW_LIMIT from vars with a default of 2', () => {
    const decideStep = stepNamed(autoReviewJob, 'Decide auto-review limit');
    const limitEnv = decideStep.env?.OCR_AUTO_REVIEW_LIMIT;
    expect(limitEnv).toBeTruthy();
    expect(String(limitEnv)).toContain('vars.OCR_AUTO_REVIEW_LIMIT');
    // YAML unquotes '2' to the string "2".
    expect(String(decideStep.env?.OCR_AUTO_REVIEW_LIMIT_DEFAULT || '')).toBe(
      '2',
    );
  });

  // ---- Behavioral tests: auto-review-gate decision logic ----

  it('permits automatic review when count is below the limit (AC 1, 8)', async () => {
    const result = await executeAutoReviewGate({
      script: autoGateScript,
      eventName: 'pull_request_target',
      eventAction: 'synchronize',
      prNumber: '42',
      autoReviewLimit: '2',
      listComments: [
        {
          id: 1,
          body: `${MARKER}\n## OpenCodeReview\n<!-- ocr-auto-count:0 --><!-- ocr-suspended:false -->`,
        },
      ],
    });
    expect(result.outputs['auto-should-run']).toBe('true');
    expect(result.outputs['suspended']).toBe('false');
    expect(result.outputs['is-manual']).toBe('false');
    expect(result.outputs['current-count']).toBe('0');
  });

  it('permits automatic review when count is 1 and limit is 2', async () => {
    const result = await executeAutoReviewGate({
      script: autoGateScript,
      eventName: 'pull_request_target',
      eventAction: 'synchronize',
      autoReviewLimit: '2',
      listComments: [
        {
          id: 1,
          body: `${MARKER}\n<!-- ocr-auto-count:1 --><!-- ocr-suspended:false -->`,
        },
      ],
    });
    expect(result.outputs['auto-should-run']).toBe('true');
    expect(result.outputs['suspended']).toBe('false');
    expect(result.outputs['current-count']).toBe('1');
  });

  it('suspends when count reaches the limit on automatic trigger (AC 1)', async () => {
    const result = await executeAutoReviewGate({
      script: autoGateScript,
      eventName: 'pull_request_target',
      eventAction: 'synchronize',
      autoReviewLimit: '2',
      listComments: [
        {
          id: 1,
          body: `${MARKER}\n<!-- ocr-auto-count:2 --><!-- ocr-suspended:false -->`,
        },
      ],
    });
    expect(result.outputs['auto-should-run']).toBe('false');
    expect(result.outputs['suspended']).toBe('true');
    expect(result.outputs['is-manual']).toBe('false');
    expect(result.outputs['current-count']).toBe('2');
  });

  it('suspends when count exceeds the limit', async () => {
    const result = await executeAutoReviewGate({
      script: autoGateScript,
      eventName: 'pull_request_target',
      eventAction: 'synchronize',
      autoReviewLimit: '2',
      listComments: [
        {
          id: 1,
          body: `${MARKER}\n<!-- ocr-auto-count:5 --><!-- ocr-suspended:true -->`,
        },
      ],
    });
    expect(result.outputs['auto-should-run']).toBe('false');
    expect(result.outputs['suspended']).toBe('true');
  });

  it('manual /review command always permits regardless of suspension (AC 5, 6)', async () => {
    const result = await executeAutoReviewGate({
      script: autoGateScript,
      eventName: 'issue_comment',
      eventAction: 'created',
      commentBody: '/review',
      autoReviewLimit: '2',
      listComments: [
        {
          id: 1,
          body: `${MARKER}\n<!-- ocr-auto-count:2 --><!-- ocr-suspended:true -->`,
        },
      ],
    });
    expect(result.outputs['auto-should-run']).toBe('true');
    expect(result.outputs['suspended']).toBe('false');
    expect(result.outputs['is-manual']).toBe('true');
  });

  it('workflow_dispatch always permits regardless of suspension (AC 5)', async () => {
    const result = await executeAutoReviewGate({
      script: autoGateScript,
      eventName: 'workflow_dispatch',
      eventAction: '',
      autoReviewLimit: '2',
      listComments: [
        {
          id: 1,
          body: `${MARKER}\n<!-- ocr-auto-count:2 --><!-- ocr-suspended:true -->`,
        },
      ],
    });
    expect(result.outputs['auto-should-run']).toBe('true');
    expect(result.outputs['suspended']).toBe('false');
    expect(result.outputs['is-manual']).toBe('true');
  });

  it('defaults to limit 2 when OCR_AUTO_REVIEW_LIMIT is unset (AC 7)', async () => {
    const result = await executeAutoReviewGate({
      script: autoGateScript,
      eventName: 'pull_request_target',
      eventAction: 'synchronize',
      autoReviewLimit: '',
      listComments: [
        {
          id: 1,
          body: `${MARKER}\n<!-- ocr-auto-count:2 --><!-- ocr-suspended:false -->`,
        },
      ],
    });
    expect(result.outputs['auto-should-run']).toBe('false');
    expect(result.outputs['suspended']).toBe('true');
  });

  it('respects a custom OCR_AUTO_REVIEW_LIMIT of 3 (AC 7)', async () => {
    const result = await executeAutoReviewGate({
      script: autoGateScript,
      eventName: 'pull_request_target',
      eventAction: 'synchronize',
      autoReviewLimit: '3',
      listComments: [
        {
          id: 1,
          body: `${MARKER}\n<!-- ocr-auto-count:2 --><!-- ocr-suspended:false -->`,
        },
      ],
    });
    expect(result.outputs['auto-should-run']).toBe('true');
    expect(result.outputs['suspended']).toBe('false');
  });

  it('defaults to count 0 and suspended false when no sticky comment exists (AC 8)', async () => {
    const result = await executeAutoReviewGate({
      script: autoGateScript,
      eventName: 'pull_request_target',
      eventAction: 'synchronize',
      autoReviewLimit: '2',
      listComments: [],
    });
    expect(result.outputs['auto-should-run']).toBe('true');
    expect(result.outputs['suspended']).toBe('false');
    expect(result.outputs['current-count']).toBe('0');
  });

  it('defaults to count 0 when sticky comment lacks hidden state', async () => {
    const result = await executeAutoReviewGate({
      script: autoGateScript,
      eventName: 'pull_request_target',
      eventAction: 'synchronize',
      autoReviewLimit: '2',
      listComments: [{ id: 1, body: `${MARKER}\n## Review without state` }],
    });
    expect(result.outputs['current-count']).toBe('0');
    expect(result.outputs['auto-should-run']).toBe('true');
  });

  // ---- Behavioral tests: checkbox reset ----

  it('checkbox edit from unchecked to checked resets counter to 0 (AC 3, 4)', async () => {
    const oldBody = `${MARKER}\n## Suspended\n- [ ] Re-enable automatic reviews\n<!-- ocr-auto-count:2 --><!-- ocr-suspended:true -->`;
    const newBody = oldBody.replace('[ ]', '[x]');
    const result = await executeAutoReviewGate({
      script: autoGateScript,
      eventName: 'issue_comment',
      eventAction: 'edited',
      autoReviewLimit: '2',
      commentBody: newBody,
      changesFrom: oldBody,
      commentUserType: 'Bot',
      listComments: [{ id: 999, body: newBody }],
    });
    expect(result.outputs['auto-should-run']).toBe('true');
    expect(result.outputs['suspended']).toBe('false');
    expect(result.outputs['is-manual']).toBe('true');
    expect(result.outputs['current-count']).toBe('0');
    // The counter is reset in the comment
    expect(result.updateCalls).toHaveLength(1);
    expect(result.updateCalls[0].body).toContain('<!-- ocr-auto-count:0 -->');
    expect(result.updateCalls[0].body).toContain(
      '<!-- ocr-suspended:false -->',
    );
  });

  it('checkbox edit without change does not reset counter', async () => {
    const body = `${MARKER}\n## Suspended\n- [ ] Re-enable automatic reviews\n<!-- ocr-auto-count:2 --><!-- ocr-suspended:true -->`;
    const result = await executeAutoReviewGate({
      script: autoGateScript,
      eventName: 'issue_comment',
      eventAction: 'edited',
      autoReviewLimit: '2',
      commentBody: body,
      changesFrom: body,
      commentUserType: 'Bot',
      listComments: [{ id: 999, body }],
    });
    expect(result.outputs['auto-should-run']).toBe('false');
    expect(result.outputs['suspended']).toBe('false');
    expect(result.updateCalls).toHaveLength(0);
  });

  it('unchecking the box does not reset counter', async () => {
    const checkedBody = `${MARKER}\n## Suspended\n- [x] Re-enable automatic reviews\n<!-- ocr-auto-count:2 --><!-- ocr-suspended:true -->`;
    const uncheckedBody = checkedBody.replace('[x]', '[ ]');
    const result = await executeAutoReviewGate({
      script: autoGateScript,
      eventName: 'issue_comment',
      eventAction: 'edited',
      autoReviewLimit: '2',
      commentBody: uncheckedBody,
      changesFrom: checkedBody,
      commentUserType: 'Bot',
      listComments: [{ id: 999, body: uncheckedBody }],
    });
    expect(result.outputs['auto-should-run']).toBe('false');
    expect(result.updateCalls).toHaveLength(0);
  });

  it('edited comment without OCR marker is a no-op', async () => {
    const result = await executeAutoReviewGate({
      script: autoGateScript,
      eventName: 'issue_comment',
      eventAction: 'edited',
      autoReviewLimit: '2',
      commentBody: 'Some random comment that was edited',
      changesFrom: 'Some random comment',
      commentUserType: 'User',
      listComments: [],
    });
    expect(result.outputs['auto-should-run']).toBe('false');
    expect(result.updateCalls).toHaveLength(0);
  });

  it('checkbox reset that fails to write does not proceed with stale count', async () => {
    const oldBody = `${MARKER}
## Suspended
- [ ] Re-enable automatic reviews
<!-- ocr-auto-count:2 --><!-- ocr-suspended:true -->`;
    const newBody = oldBody.replace('[ ]', '[x]');
    const writeError = new Error('API rate limit');
    const result = await executeAutoReviewGate({
      script: autoGateScript,
      eventName: 'issue_comment',
      eventAction: 'edited',
      autoReviewLimit: '2',
      commentBody: newBody,
      changesFrom: oldBody,
      commentUserType: 'Bot',
      listComments: [{ id: 999, body: newBody }],
      updateCommentResult: writeError,
    });
    expect(result.outputs['auto-should-run']).toBe('false');
    expect(result.outputs['suspended']).toBe('false');
    expect(result.outputs['is-manual']).toBe('false');
  });

  // ---- Behavioral tests: suspension message rendering ----

  it('renders a suspension message with header, count/limit, checkbox, and instructions (AC 2, 9)', () => {
    expect(postSuspensionScript).toContain('suspended');
    expect(postSuspensionScript).toContain('Re-enable automatic reviews');
    expect(postSuspensionScript).toContain('- [ ]');
    expect(postSuspensionScript).toContain('/review');
    expect(postSuspensionScript).toContain('/ocr');
    expect(postSuspensionScript).toContain(MARKER);
    expect(postSuspensionScript).toContain('<!-- ocr-auto-count:');
    expect(postSuspensionScript).toContain('<!-- ocr-suspended:true');
  });

  it('post-suspension writes the count and limit into the message', () => {
    expect(postSuspensionScript).toContain('OCR_AUTO_REVIEW_LIMIT');
    expect(postSuspensionScript).toContain('CURRENT_COUNT');
  });

  // ---- Behavioral tests: counter increment in Post OCR results ----

  it('Post OCR results increments the counter for automatic triggers (AC 6)', () => {
    const postStep = stepNamed(codeReviewJob, 'Post OCR results');
    const postScript = commandText(postStep);
    expect(postScript).toContain('ocr-auto-count');
    expect(postScript).toContain('IS_AUTOMATIC');
  });

  it('manual reviews do not increment the counter (AC 6)', () => {
    const postStep = stepNamed(codeReviewJob, 'Post OCR results');
    const postScript = commandText(postStep);
    // The increment should be conditional on the automatic flag
    expect(postScript).toContain('isAutomatic');
  });

  // ---- Wiring tests: skip/outcome recording ----

  it('record-skipped-ocr-outcome accommodates suspension skips', () => {
    const skippedJob = workflow.jobs?.['record-skipped-ocr-outcome'];
    expect(skippedJob).toBeTruthy();
    expect(skippedJob.needs).toContain('mergeability-gate');
  });
});
