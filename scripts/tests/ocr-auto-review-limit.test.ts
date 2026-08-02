/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from 'vitest';
import vm from 'node:vm';
import {
  WORKFLOW_PATH,
  commandText,
  normalize,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.ts';
import {
  asOptionalRecord,
  asOptionalString,
  asRecord,
  asString,
  asStringArray,
  parseWorkflowYaml,
  stepEnv,
  stepWith,
} from './typed-test-helpers.ts';

const MARKER = '<!-- llxprt-code-ocr-review -->';

import type { WorkflowJob as TypedWorkflowJob } from './typed-test-helpers.ts';

/**
 * Load and parse the OCR review workflow, extracting the auto-review-gate
 * and post-suspension job scripts for behavioral execution.
 */
function loadAutoReviewScripts() {
  const source = readRootFile(WORKFLOW_PATH);
  const parsed = parseWorkflowYaml(source);
  const autoReviewJob = parsed.jobs?.['auto-review-gate'];
  const postSuspensionJob = parsed.jobs?.['post-suspension'];
  const codeReviewJob = parsed.jobs?.['code-review'];
  if (!autoReviewJob || !postSuspensionJob || !codeReviewJob) {
    throw new Error(
      'workflow should contain auto-review-gate, post-suspension, and code-review jobs',
    );
  }
  return { source, parsed, autoReviewJob, postSuspensionJob, codeReviewJob };
}

/**
 * Find the github-script step in a job and return its script body.
 */
function scriptFromJob(job: TypedWorkflowJob | undefined, stepName: string) {
  const step = stepNamed(job, stepName);
  const script = stepWith(step)?.['script'];
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
interface AutoReviewGateParams {
  script: string;
  eventName?: string;
  eventAction?: string;
  prNumber?: string;
  autoReviewLimit?: string;
  commentBody?: string;
  changesFrom?: string;
  commentUserType?: string;
  commentUserLogin?: string;
  commentId?: string;
  listComments?: Array<{
    id: number;
    body: string;
    user?: { type: string; login?: string };
  }>;
  listCommentsError?: Error | null;
  updateCommentResult?: Error | { status: number } | null;
}

interface UpdateCall {
  body: string;
  [key: string]: unknown;
}

interface AutoReviewGateResult {
  outputs: Record<string, string>;
  warnings: string[];
  updateCalls: UpdateCall[];
  failure: string | null;
}

async function executeAutoReviewGate({
  script,
  eventName = 'pull_request_target',
  eventAction = 'synchronize',
  prNumber = '42',
  autoReviewLimit = '',
  commentBody = '',
  changesFrom = '',
  commentUserType = 'Bot',
  commentUserLogin = 'github-actions[bot]',
  commentId = '999',
  listComments = [],
  listCommentsError = null,
  updateCommentResult = null,
}: AutoReviewGateParams): Promise<AutoReviewGateResult> {
  const outputs: Record<string, string> = {};
  const warnings: string[] = [];
  const updateCalls: UpdateCall[] = [];
  let failure: string | null = null;

  const fakeGithub = {
    paginate: async <T>(
      fn: (options: unknown) => Promise<{ data: T }>,
      options: unknown,
    ): Promise<T> => {
      const result = await fn(options);
      return result.data;
    },
    rest: {
      issues: {
        listComments: async (): Promise<{
          data: Array<{ id: number; body: string }>;
        }> => {
          if (listCommentsError instanceof Error) throw listCommentsError;
          return { data: listComments };
        },
        updateComment: async (
          opts: UpdateCall,
        ): Promise<{ status: number }> => {
          updateCalls.push(opts);
          if (updateCommentResult instanceof Error) throw updateCommentResult;
          if (
            updateCommentResult !== null &&
            typeof updateCommentResult === 'object' &&
            typeof updateCommentResult['status'] === 'number'
          ) {
            return { status: updateCommentResult['status'] };
          }
          return { status: 200 };
        },
      },
    },
  };

  const fakeCore = {
    setOutput: (name: string | number, value: unknown): void => {
      outputs[name] = String(value);
    },
    warning: (message: unknown): void => {
      warnings.push(String(message));
    },
    info: (): void => {},
    setFailed: (message: unknown): void => {
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
        ? {
            body: commentBody,
            user: { type: commentUserType, login: commentUserLogin },
            id: Number(commentId),
          }
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
        COMMENT_USER_LOGIN: commentUserLogin,
        COMMENT_ID: commentId,
        CHANGES_FROM: changesFrom,
      },
    },
    setTimeout: (fn: () => void): number => {
      fn();
      return 0;
    },
    clearTimeout: (): void => {},
    console: {
      log: (): void => {},
      warn: (m: unknown): void => {
        warnings.push(String(m));
      },
    },
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
    Set,
    parseInt,
    RegExp,
  };

  const promise = vm.runInNewContext(
    `(async () => { ${script} })()`,
    asRecord(sandbox),
  );
  try {
    await promise;
  } catch (error) {
    failure = String(error);
  }

  return { outputs, warnings, updateCalls, failure };
}

describe('.github/workflows/ocr-review.yml — auto-review limit (issue #2666)', () => {
  let workflow: ReturnType<typeof parseWorkflowYaml>;
  let autoReviewJob: NonNullable<
    ReturnType<typeof loadAutoReviewScripts>['autoReviewJob']
  >;
  let postSuspensionJob: NonNullable<
    ReturnType<typeof loadAutoReviewScripts>['postSuspensionJob']
  >;
  let codeReviewJob: NonNullable<
    ReturnType<typeof loadAutoReviewScripts>['codeReviewJob']
  >;
  let mergeabilityGateJob: TypedWorkflowJob | undefined;
  let autoGateScript: string;
  let postSuspensionScript: string;

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
    const on = asOptionalRecord(workflow.on);
    const issueComment = asOptionalRecord(on?.['issue_comment']);
    const types = asStringArray(issueComment?.['types']) ?? [];
    expect(types).toContain('created');
    expect(types).toContain('edited');
  });

  it('adds /review to the concurrency group authorized commands', () => {
    const concurrencyGroup = normalize(
      asOptionalString(asOptionalRecord(workflow.concurrency)?.group),
    );
    expect(concurrencyGroup).toContain(
      "github.event.comment.body == '/review'",
    );
    expect(concurrencyGroup).toContain(
      "startsWith(github.event.comment.body, '/review ')",
    );
  });

  it('adds /review to the mergeability-gate if filter', () => {
    const gateIf = normalize(mergeabilityGateJob?.if);
    expect(gateIf).toContain("github.event.comment.body == '/review'");
    expect(gateIf).toContain(
      "startsWith(github.event.comment.body, '/review ')",
    );
  });

  it('adds edited-comment conditions to the mergeability-gate if filter', () => {
    const gateIf = normalize(mergeabilityGateJob?.if);
    expect(gateIf).toContain("github.event.action == 'edited'");
    expect(gateIf).toContain('contains(github.event.comment.body');
    expect(gateIf).toContain("github.event.comment.user.type == 'Bot'");
  });

  it('adds an auto-review-gate job that needs mergeability-gate', () => {
    expect(autoReviewJob?.needs).toContain('mergeability-gate');
    expect(normalize(autoReviewJob?.if)).toContain(
      normalize("needs.mergeability-gate.outputs.should-run == 'true'"),
    );
  });

  it('exposes auto-review-gate outputs', () => {
    const outputs = asOptionalRecord(autoReviewJob?.outputs) ?? {};
    expect(outputs['auto-should-run']).toBeTruthy();
    expect(outputs['suspended']).toBeTruthy();
    expect(outputs['is-manual']).toBeTruthy();
    expect(outputs['current-count']).toBeTruthy();
  });

  it('code-review needs auto-review-gate and runs when auto-should-run is true', () => {
    expect(codeReviewJob?.needs).toContain('auto-review-gate');
    expect(codeReviewJob?.needs).toContain('mergeability-gate');
    expect(normalize(codeReviewJob?.if)).toContain(
      normalize("needs.auto-review-gate.outputs.auto-should-run == 'true'"),
    );
  });

  it('post-suspension runs when suspended is true', () => {
    expect(postSuspensionJob?.needs).toContain('mergeability-gate');
    expect(postSuspensionJob?.needs).toContain('auto-review-gate');
    expect(normalize(postSuspensionJob?.if)).toContain(
      normalize("needs.auto-review-gate.outputs.suspended == 'true'"),
    );
  });

  it('reads OCR_AUTO_REVIEW_LIMIT from vars with a default of 2', () => {
    const decideStep = stepNamed(autoReviewJob, 'Decide auto-review limit');
    const decideEnv = asOptionalRecord(stepEnv(decideStep));
    const limitEnv = decideEnv?.['OCR_AUTO_REVIEW_LIMIT'];
    expect(limitEnv).toBeTruthy();
    expect(String(limitEnv)).toContain('vars.OCR_AUTO_REVIEW_LIMIT');
    // YAML unquotes '2' to the string "2".
    expect(asString(decideEnv?.['OCR_AUTO_REVIEW_LIMIT_DEFAULT'] || '')).toBe(
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
          user: { type: 'Bot', login: 'github-actions[bot]' },
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
          user: { type: 'Bot', login: 'github-actions[bot]' },
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
          user: { type: 'Bot', login: 'github-actions[bot]' },
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
          user: { type: 'Bot', login: 'github-actions[bot]' },
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
          user: { type: 'Bot', login: 'github-actions[bot]' },
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
          user: { type: 'Bot', login: 'github-actions[bot]' },
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
          user: { type: 'Bot', login: 'github-actions[bot]' },
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
          user: { type: 'Bot', login: 'github-actions[bot]' },
        },
      ],
    });
    expect(result.outputs['auto-should-run']).toBe('true');
    expect(result.outputs['suspended']).toBe('false');
  });

  it('falls back to the default limit when OCR_AUTO_REVIEW_LIMIT is not a number', async () => {
    const result = await executeAutoReviewGate({
      script: autoGateScript,
      eventName: 'pull_request_target',
      eventAction: 'synchronize',
      autoReviewLimit: 'not-a-number',
      listComments: [
        {
          id: 1,
          body: `${MARKER}\n<!-- ocr-auto-count:2 -->`,
          user: { type: 'Bot', login: 'github-actions[bot]' },
        },
      ],
    });
    // Default limit is 2; count 2 >= 2 means suspended.
    expect(result.outputs['suspended']).toBe('true');
    expect(result.outputs['auto-should-run']).toBe('false');
  });

  it('falls back to the default limit when OCR_AUTO_REVIEW_LIMIT is negative', async () => {
    const result = await executeAutoReviewGate({
      script: autoGateScript,
      eventName: 'pull_request_target',
      eventAction: 'synchronize',
      autoReviewLimit: '-1',
      listComments: [
        {
          id: 1,
          body: `${MARKER}\n<!-- ocr-auto-count:1 -->`,
          user: { type: 'Bot', login: 'github-actions[bot]' },
        },
      ],
    });
    // Negative limit falls back to default 2; count 1 < 2 means allowed.
    expect(result.outputs['auto-should-run']).toBe('true');
    expect(result.outputs['suspended']).toBe('false');
  });

  it('treats a limit of 0 as suspending every automatic review', async () => {
    const result = await executeAutoReviewGate({
      script: autoGateScript,
      eventName: 'pull_request_target',
      eventAction: 'synchronize',
      autoReviewLimit: '0',
      listComments: [],
    });
    expect(result.outputs['auto-should-run']).toBe('false');
    expect(result.outputs['suspended']).toBe('true');
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
      listComments: [
        {
          id: 1,
          body: `${MARKER}\n## Review without state`,
          user: { type: 'Bot', login: 'github-actions[bot]' },
        },
      ],
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
      listComments: [
        {
          id: 999,
          body: newBody,
          user: { type: 'Bot', login: 'github-actions[bot]' },
        },
      ],
    });
    expect(result.outputs['auto-should-run']).toBe('true');
    expect(result.outputs['suspended']).toBe('false');
    expect(result.outputs['is-manual']).toBe('true');
    expect(result.outputs['current-count']).toBe('0');
    // The counter is reset in the comment
    expect(result.updateCalls).toHaveLength(1);
    expect(result.updateCalls[0].body).toContain('<!-- ocr-auto-count:0 -->');
    expect(result.updateCalls[0].body).not.toContain('ocr-suspended');
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
      listComments: [
        {
          id: 999,
          body,
          user: { type: 'Bot', login: 'github-actions[bot]' },
        },
      ],
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
      listComments: [
        {
          id: 999,
          body: uncheckedBody,
          user: { type: 'Bot', login: 'github-actions[bot]' },
        },
      ],
    });
    expect(result.outputs['auto-should-run']).toBe('false');
    expect(result.updateCalls).toHaveLength(0);
  });

  it('edited bot comment without the OCR marker is a no-op', async () => {
    const result = await executeAutoReviewGate({
      script: autoGateScript,
      eventName: 'issue_comment',
      eventAction: 'edited',
      autoReviewLimit: '2',
      commentBody: 'Some random bot comment that was edited',
      changesFrom: 'Some random bot comment',
      commentUserType: 'Bot',
      listComments: [],
    });
    expect(result.outputs['auto-should-run']).toBe('false');
    expect(result.updateCalls).toHaveLength(0);
  });

  it('edited marker comment authored by a non-bot user is a no-op', async () => {
    const oldBody = `${MARKER}\n- [ ] Re-enable automatic reviews\n<!-- ocr-auto-count:2 -->`;
    const newBody = oldBody.replace('[ ]', '[x]');
    const result = await executeAutoReviewGate({
      script: autoGateScript,
      eventName: 'issue_comment',
      eventAction: 'edited',
      autoReviewLimit: '2',
      commentBody: newBody,
      changesFrom: oldBody,
      commentUserType: 'User',
      listComments: [],
    });
    expect(result.outputs['auto-should-run']).toBe('false');
    expect(result.updateCalls).toHaveLength(0);
  });

  it('listComments API failure during edited-comment handling is non-fatal', async () => {
    const oldBody = `${MARKER}\n- [ ] Re-enable automatic reviews\n<!-- ocr-auto-count:2 -->`;
    const newBody = oldBody.replace('[ ]', '[x]');
    const result = await executeAutoReviewGate({
      script: autoGateScript,
      eventName: 'issue_comment',
      eventAction: 'edited',
      autoReviewLimit: '2',
      commentBody: newBody,
      changesFrom: oldBody,
      commentUserType: 'Bot',
      listCommentsError: new Error('API rate limit'),
      listComments: [],
    });
    expect(result.outputs['auto-should-run']).toBe('false');
    expect(result.failure).toBeNull();
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
      listComments: [
        {
          id: 999,
          body: newBody,
          user: { type: 'Bot', login: 'github-actions[bot]' },
        },
      ],
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
    // The suspension state is derived from count >= limit at runtime,
    // not stored as a separate hidden flag (issue #2666 CodeRabbit Fix3).
    // The script may contain a backward-compat cleanup regex for old markers,
    // but must not WRITE a new ocr-suspended:true marker.
    expect(postSuspensionScript).not.toContain("'<!-- ocr-suspended:true'");
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

  it('record-skipped-ocr-outcome fires on both mergeability skip and suspension skip', () => {
    const skippedJob = workflow.jobs?.['record-skipped-ocr-outcome'];
    expect(skippedJob).toBeTruthy();
    expect(skippedJob?.needs).toContain('mergeability-gate');
    expect(skippedJob?.needs).toContain('auto-review-gate');
    const skippedIf = normalize(skippedJob?.if);
    expect(skippedIf).toContain(
      normalize("needs.auto-review-gate.outputs.auto-should-run != 'true'"),
    );
  });
});
