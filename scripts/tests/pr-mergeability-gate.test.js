/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from 'vitest';
import vm from 'vm';
import yaml from 'js-yaml';
import { readRootFile } from './ocr-review-workflow-helpers.js';

const GATE_WORKFLOW_PATH = '.github/workflows/_pr-mergeability-gate.yml';

/**
 * Read, parse, and extract the real github-script body from the reusable
 * gate workflow.  The test executes this exact production script with only
 * network (Octokit REST) and timer (setTimeout) infrastructure faked.
 */
function loadGateScript() {
  const source = readRootFile(GATE_WORKFLOW_PATH);
  const parsed = yaml.load(source);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${GATE_WORKFLOW_PATH} did not parse to a YAML mapping`);
  }
  const gateJob = parsed.jobs?.gate;
  if (!gateJob) {
    throw new Error(`${GATE_WORKFLOW_PATH} should contain a gate job`);
  }
  const steps = Array.isArray(gateJob.steps) ? gateJob.steps : [];
  const scriptStep = steps.find(
    (step) =>
      typeof step.uses === 'string' &&
      step.uses.startsWith('actions/github-script@'),
  );
  if (!scriptStep) {
    throw new Error(
      `${GATE_WORKFLOW_PATH} gate job should use actions/github-script`,
    );
  }
  const script = scriptStep.with?.script;
  if (typeof script !== 'string' || script.trim().length === 0) {
    throw new Error(
      `${GATE_WORKFLOW_PATH} github-script step should have a non-empty script`,
    );
  }
  return { source, parsed, gateJob, scriptStep, script };
}

/**
 * Execute the real gate script in an isolated VM sandbox with faked
 * infrastructure.  Only Octokit REST and setTimeout are faked — the actual
 * decision logic runs unchanged.
 *
 * @param {object} options
 * @param {string} options.script - The real github-script body.
 * @param {Record<string, string>} [options.env] - process.env values.
 * @param {Array<object | Error>} [options.pullsGetSequence]
 *   Sequence of mergeable responses or errors.
 * @returns {Promise<object>} Captured outputs, warnings, request options, and failure state.
 */
async function executeGateScript({ script, env = {}, pullsGetSequence = [] }) {
  const outputs = {};
  const warnings = [];
  const pullRequestOptions = [];
  let failure = null;
  let elapsedMs = 0;
  let nextTimerId = 1;

  const sequence = [...pullsGetSequence];
  const timers = new Map();

  const fakeGithub = {
    rest: {
      pulls: {
        get: async (options) => {
          pullRequestOptions.push(options);
          const next = sequence.shift();
          if (next === undefined) {
            throw new Error(
              'pulls.get was called more times than the fake sequence provided',
            );
          }
          if (next instanceof Error) {
            throw next;
          }
          return { data: next };
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
    payload: {},
  };

  const sandbox = {
    github: fakeGithub,
    core: fakeCore,
    context: fakeContext,
    process: { env: { ...env } },
    setTimeout: (fn, delay = 0) => {
      const timerId = nextTimerId;
      nextTimerId += 1;
      const timer = setTimeout(() => {
        timers.delete(timerId);
        elapsedMs += Number(delay);
        fn();
      }, 0);
      timers.set(timerId, timer);
      return timerId;
    },
    clearTimeout: (timerId) => {
      const timer = timers.get(timerId);
      if (timer !== undefined) {
        clearTimeout(timer);
        timers.delete(timerId);
      }
    },
    console: {
      log: () => {},
      warn: (message) => warnings.push(String(message)),
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
    parseInt,
  };

  const promise = vm.runInNewContext(`(async () => { ${script} })()`, sandbox);
  await promise;

  return { outputs, warnings, pullRequestOptions, failure, elapsedMs };
}

describe('.github/workflows/_pr-mergeability-gate.yml — gate behavior', () => {
  let gate;
  let workflowSource;
  let workflowParsed;

  beforeAll(() => {
    gate = loadGateScript();
    workflowSource = gate.source;
    workflowParsed = gate.parsed;
  });

  it('defines a reusable workflow_call contract with required inputs and outputs', () => {
    const wfCall = workflowParsed.on?.workflow_call ?? workflowParsed.true;
    expect(wfCall, 'should define workflow_call trigger').toBeTruthy();
    expect(wfCall.inputs?.['check-mergeability']?.type).toBe('boolean');
    expect(wfCall.inputs?.['check-mergeability']?.required).toBe(true);
    expect(wfCall.inputs?.['pull-request-number']?.type).toBe('string');
    expect(wfCall.inputs?.['pull-request-number']?.required).toBe(true);
    expect(wfCall.inputs?.['expected-head-sha']?.type).toBe('string');
    expect(wfCall.inputs?.['expected-head-sha']?.required).toBe(false);
    expect(wfCall.outputs?.['should-run']?.value).toContain(
      'jobs.gate.outputs.should-run',
    );
    expect(wfCall.outputs?.['reason']?.value).toContain(
      'jobs.gate.outputs.reason',
    );
  });

  it('uses the repository-pinned actions/github-script SHA', () => {
    expect(gate.scriptStep.uses).toBe(
      'actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b',
    );
    // The ratchet comment is stripped by YAML parsing; verify from raw source.
    expect(workflowSource).toContain(
      'actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b # ratchet:actions/github-script@v7',
    );
  });

  it('has exactly pull-requests: read permission and no other permissions', () => {
    const permissions = workflowParsed.permissions;
    expect(permissions).toEqual({ 'pull-requests': 'read' });
  });

  it('does not check out code, run shell steps, or receive secrets', () => {
    const wfCall = workflowParsed.on?.workflow_call ?? workflowParsed.true;
    expect(wfCall.secrets).toBeUndefined();
    const steps = gate.gateJob.steps ?? [];
    for (const step of steps) {
      expect(step.uses, 'no checkout step').not.toContain('actions/checkout');
      expect(step.run, 'no shell run step').toBeUndefined();
    }
    const scriptEnv = gate.scriptStep.env ?? {};
    const envKeys = Object.keys(scriptEnv);
    for (const key of envKeys) {
      expect(scriptEnv[key]).not.toContain('secrets.');
    }
  });

  it('bypass allows without requiring a PR number when check-mergeability is false', async () => {
    const result = await executeGateScript({
      script: gate.script,
      env: {
        CHECK_MERGEABILITY: 'false',
        PULL_REQUEST_NUMBER: '',
      },
      pullsGetSequence: [],
    });

    expect(result.failure).toBeNull();
    expect(result.outputs['should-run']).toBe('true');
    expect(result.outputs['reason']).toBe('bypass');
  });

  it('permits when REST mergeable is true', async () => {
    const result = await executeGateScript({
      script: gate.script,
      env: {
        CHECK_MERGEABILITY: 'true',
        PULL_REQUEST_NUMBER: '42',
      },
      pullsGetSequence: [{ mergeable: true, head: { sha: 'aaa111' } }],
    });

    expect(result.failure).toBeNull();
    expect(result.outputs['should-run']).toBe('true');
    expect(result.outputs['reason']).toBe('mergeable');
  });

  it('skips with conflict reason when REST mergeable is false', async () => {
    const result = await executeGateScript({
      script: gate.script,
      env: {
        CHECK_MERGEABILITY: 'true',
        PULL_REQUEST_NUMBER: '42',
      },
      pullsGetSequence: [{ mergeable: false, head: { sha: 'aaa111' } }],
    });

    expect(result.failure).toBeNull();
    expect(result.outputs['should-run']).toBe('false');
    expect(result.outputs['reason']).toBe('conflict');
  });

  it('permits when null is followed by true', async () => {
    const result = await executeGateScript({
      script: gate.script,
      env: {
        CHECK_MERGEABILITY: 'true',
        PULL_REQUEST_NUMBER: '42',
      },
      pullsGetSequence: [
        { mergeable: null, head: { sha: 'aaa111' } },
        { mergeable: true, head: { sha: 'aaa111' } },
      ],
    });

    expect(result.failure).toBeNull();
    expect(result.outputs['should-run']).toBe('true');
    expect(result.outputs['reason']).toBe('mergeable');
  });

  it('settles on the fifth poll after exactly four delays', async () => {
    const result = await executeGateScript({
      script: gate.script,
      env: {
        CHECK_MERGEABILITY: 'true',
        PULL_REQUEST_NUMBER: '42',
      },
      pullsGetSequence: [
        { mergeable: null, head: { sha: 'aaa111' } },
        { mergeable: null, head: { sha: 'aaa111' } },
        { mergeable: null, head: { sha: 'aaa111' } },
        { mergeable: null, head: { sha: 'aaa111' } },
        { mergeable: true, head: { sha: 'aaa111' } },
      ],
    });

    expect(result.failure).toBeNull();
    expect(result.outputs).toEqual({
      'should-run': 'true',
      reason: 'mergeable',
    });
    expect(result.elapsedMs).toBe(8000);
  });

  it('skips with conflict reason when null is followed by false', async () => {
    const result = await executeGateScript({
      script: gate.script,
      env: {
        CHECK_MERGEABILITY: 'true',
        PULL_REQUEST_NUMBER: '42',
      },
      pullsGetSequence: [
        { mergeable: null, head: { sha: 'aaa111' } },
        { mergeable: false, head: { sha: 'aaa111' } },
      ],
    });

    expect(result.failure).toBeNull();
    expect(result.outputs['should-run']).toBe('false');
    expect(result.outputs['reason']).toBe('conflict');
  });

  it('warns and fails open when mergeable remains null after bounded polling', async () => {
    const result = await executeGateScript({
      script: gate.script,
      env: {
        CHECK_MERGEABILITY: 'true',
        PULL_REQUEST_NUMBER: '42',
      },
      pullsGetSequence: Array.from({ length: 5 }, () => ({
        mergeable: null,
        head: { sha: 'aaa111' },
      })),
    });

    expect(result.failure).toBeNull();
    expect(result.outputs['should-run']).toBe('true');
    expect(result.outputs['reason']).toBe('uncertain');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.elapsedMs).toBe(8000);
  });

  it('passes a bounded timeout to every Octokit request and treats timeout as transient', async () => {
    const timeoutErrors = Array.from({ length: 5 }, () =>
      Object.assign(new Error('request timed out'), { code: 'ETIMEDOUT' }),
    );
    const result = await executeGateScript({
      script: gate.script,
      env: {
        CHECK_MERGEABILITY: 'true',
        PULL_REQUEST_NUMBER: '42',
      },
      pullsGetSequence: timeoutErrors,
    });

    expect(result.failure).toBeNull();
    expect(result.outputs).toEqual({
      'should-run': 'true',
      reason: 'uncertain',
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('transient API uncertainty');
    expect(result.pullRequestOptions).toHaveLength(5);
    for (const requestOptions of result.pullRequestOptions) {
      expect(requestOptions.request.signal).toBeDefined();
    }
    expect(result.elapsedMs).toBe(8000);
  });

  for (const status of [401, 403, 404, 422]) {
    it(`fails visibly without failing open for permanent REST ${status}`, async () => {
      const apiError = new Error(
        `request rejected with Authorization: Bearer super-secret-${status}`,
      );
      apiError.status = status;
      const result = await executeGateScript({
        script: gate.script,
        env: {
          CHECK_MERGEABILITY: 'true',
          PULL_REQUEST_NUMBER: '42',
        },
        pullsGetSequence: [apiError],
      });

      expect(result.failure).toBe(
        `GitHub REST API rejected the mergeability check for PR #42 with status ${status}.`,
      );
      expect(result.failure).not.toContain('super-secret');
      expect(result.outputs['should-run']).toBeUndefined();
      expect(result.outputs['reason']).toBeUndefined();
      expect(result.warnings).toEqual([]);
    });
  }

  for (const errorCase of [
    { name: 'REST 429', status: 429 },
    { name: 'REST 500', status: 500 },
    { name: 'REST 503', status: 503 },
  ]) {
    it(`warns and fails open after ${errorCase.name} uncertainty is exhausted`, async () => {
      const pullsGetSequence = Array.from({ length: 5 }, () => {
        const apiError = new Error(
          'request failed with x-api-key: super-secret-retry-token',
        );
        apiError.status = errorCase.status;
        return apiError;
      });
      const result = await executeGateScript({
        script: gate.script,
        env: {
          CHECK_MERGEABILITY: 'true',
          PULL_REQUEST_NUMBER: '42',
        },
        pullsGetSequence,
      });

      expect(result.failure).toBeNull();
      expect(result.outputs['should-run']).toBe('true');
      expect(result.outputs['reason']).toBe('uncertain');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).not.toContain('super-secret');
      expect(result.elapsedMs).toBe(8000);
    });
  }

  it('gives a permanent HTTP status precedence over a nested network code', async () => {
    const apiError = Object.assign(
      new Error('request rejected', {
        cause: Object.assign(new Error('socket reset'), {
          code: 'ECONNRESET',
        }),
      }),
      { status: 401 },
    );
    const result = await executeGateScript({
      script: gate.script,
      env: {
        CHECK_MERGEABILITY: 'true',
        PULL_REQUEST_NUMBER: '42',
      },
      pullsGetSequence: [apiError],
    });

    expect(result.failure).toBe(
      'GitHub REST API rejected the mergeability check for PR #42 with status 401.',
    );
    expect(result.outputs).toEqual({});
    expect(result.warnings).toEqual([]);
    expect(result.elapsedMs).toBe(0);
  });

  for (const errorCase of [
    {
      name: 'a direct ECONNRESET network failure',
      create: () =>
        Object.assign(new Error('socket disconnected with secret-token'), {
          code: 'ECONNRESET',
        }),
    },
    {
      name: 'an Undici connect timeout in a cause chain',
      create: () =>
        new TypeError('fetch failed with secret-token', {
          cause: Object.assign(new Error('connect timed out'), {
            code: 'UND_ERR_CONNECT_TIMEOUT',
          }),
        }),
    },
  ]) {
    it(`warns and fails open after ${errorCase.name} is exhausted`, async () => {
      const result = await executeGateScript({
        script: gate.script,
        env: {
          CHECK_MERGEABILITY: 'true',
          PULL_REQUEST_NUMBER: '42',
        },
        pullsGetSequence: Array.from({ length: 5 }, errorCase.create),
      });

      expect(result.failure).toBeNull();
      expect(result.outputs).toEqual({
        'should-run': 'true',
        reason: 'uncertain',
      });
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).not.toContain('secret-token');
      expect(result.elapsedMs).toBe(8000);
    });
  }

  for (const errorCase of [
    {
      name: 'an unknown TypeError',
      create: () =>
        new TypeError('invalid runtime configuration: secret-token'),
    },
    {
      name: 'an unknown statusless Error',
      create: () => new Error('invalid action configuration: secret-token'),
    },
  ]) {
    it(`fails visibly for ${errorCase.name}`, async () => {
      const result = await executeGateScript({
        script: gate.script,
        env: {
          CHECK_MERGEABILITY: 'true',
          PULL_REQUEST_NUMBER: '42',
        },
        pullsGetSequence: [errorCase.create()],
      });

      expect(result.failure).toBe(
        'GitHub REST API failed the mergeability check for PR #42 with an unrecognized error.',
      );
      expect(result.failure).not.toContain('secret-token');
      expect(result.outputs).toEqual({});
      expect(result.warnings).toEqual([]);
      expect(result.elapsedMs).toBe(0);
    });
  }

  it('skips stale event work when current API head differs from expected head', async () => {
    const result = await executeGateScript({
      script: gate.script,
      env: {
        CHECK_MERGEABILITY: 'true',
        PULL_REQUEST_NUMBER: '42',
        EXPECTED_HEAD_SHA: 'expected-sha-000',
      },
      pullsGetSequence: [{ mergeable: true, head: { sha: 'current-sha-999' } }],
    });

    expect(result.failure).toBeNull();
    expect(result.outputs['should-run']).toBe('false');
    expect(result.outputs['reason']).toBe('stale-head');
  });

  it('permits when expected head matches current API head and mergeable is true', async () => {
    const result = await executeGateScript({
      script: gate.script,
      env: {
        CHECK_MERGEABILITY: 'true',
        PULL_REQUEST_NUMBER: '42',
        EXPECTED_HEAD_SHA: 'matching-sha',
      },
      pullsGetSequence: [{ mergeable: true, head: { sha: 'matching-sha' } }],
    });

    expect(result.failure).toBeNull();
    expect(result.outputs['should-run']).toBe('true');
    expect(result.outputs['reason']).toBe('mergeable');
  });

  it('fails visibly when PR number is missing with checking enabled', async () => {
    const result = await executeGateScript({
      script: gate.script,
      env: {
        CHECK_MERGEABILITY: 'true',
        PULL_REQUEST_NUMBER: '',
      },
      pullsGetSequence: [],
    });

    expect(result.failure).toBeTruthy();
    expect(result.outputs['should-run']).toBeUndefined();
  });

  it('fails visibly when PR number is non-numeric with checking enabled', async () => {
    const result = await executeGateScript({
      script: gate.script,
      env: {
        CHECK_MERGEABILITY: 'true',
        PULL_REQUEST_NUMBER: 'not-a-number',
      },
      pullsGetSequence: [],
    });

    expect(result.failure).toBeTruthy();
    expect(result.outputs['should-run']).toBeUndefined();
  });

  it('does not consume event-payload mergeable or mergeable_state', () => {
    const scriptText = gate.script;
    expect(scriptText).not.toContain('mergeable_state');
    expect(scriptText).not.toContain('context.payload.pull_request.mergeable');
    expect(scriptText).not.toContain('payload.mergeable');
  });

  it('passes the PR number to pulls.get using the validated numeric value', () => {
    const scriptText = gate.script;
    expect(scriptText).toContain('github.rest.pulls.get');
    expect(scriptText).toContain('pull_number');
    expect(scriptText).toContain('context.repo.owner');
    expect(scriptText).toContain('context.repo.repo');
  });
});
