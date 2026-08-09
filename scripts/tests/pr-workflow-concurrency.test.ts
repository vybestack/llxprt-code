/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  asOptionalRecord,
  asOptionalString,
  parseWorkflowYaml,
  workflowJob,
} from './typed-test-helpers.ts';
import { normalize, readRootFile } from './ocr-review-workflow-helpers.ts';

type ExpressionValue = string | number | boolean | null | undefined;

const GITHUB_FALSY_VALUES: readonly ExpressionValue[] = [
  '',
  null,
  undefined,
  false,
  0,
];

type WorkflowInputs = {
  branch_ref?: ExpressionValue;
  ref?: ExpressionValue;
  tag?: ExpressionValue;
};

type ResolverContext = {
  github: {
    workflow?: ExpressionValue;
    event_name?: ExpressionValue;
    ref?: ExpressionValue;
    sha?: ExpressionValue;
    event?: {
      pull_request?: {
        number?: ExpressionValue;
      };
      label?: {
        name?: ExpressionValue;
      };
      inputs?: WorkflowInputs;
    };
  };
  inputs?: WorkflowInputs;
  matrix?: {
    sandbox?: ExpressionValue;
  };
};

function loadWorkflow(path: string) {
  const source = readRootFile(path);
  try {
    const parsed = parseWorkflowYaml(source);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`${path} did not parse to a YAML object`);
    }
    return parsed;
  } catch (error: unknown) {
    throw new Error(
      `Failed to parse ${path}: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
}

function expectGroupsEqual(actual: string, expected: string): void {
  expect(actual.toLowerCase()).toBe(expected.toLowerCase());
}

function expectGroupsDifferent(left: string, right: string): void {
  expect(left.toLowerCase()).not.toBe(right.toLowerCase());
}

function expectConcurrencyGroup(
  concurrency: Record<string, unknown> | undefined,
  expectedFragments: string[],
  cancelInProgress = true,
): void {
  expect(concurrency?.['cancel-in-progress']).toBe(cancelInProgress);
  const group = normalize(
    asOptionalString(concurrency?.['group']),
  ).toLowerCase();
  for (const fragment of expectedFragments) {
    expect(group).toContain(normalize(fragment).toLowerCase());
  }
}

function concurrencyGroup(path: string): string {
  const workflow = loadWorkflow(path);
  const concurrency = asOptionalRecord(workflow['concurrency']);
  const group = asOptionalString(concurrency?.['group']);
  if (group === undefined) {
    throw new Error(`${path} should declare a concurrency.group string`);
  }
  return group;
}

function jobConcurrencyGroup(path: string, jobName: string): string {
  const workflow = loadWorkflow(path);
  const concurrency = asOptionalRecord(
    workflowJob(workflow, jobName)['concurrency'],
  );
  const group = asOptionalString(concurrency?.['group']);
  if (group === undefined) {
    throw new Error(
      `${path} job ${jobName} should declare a concurrency.group string`,
    );
  }
  return group;
}

function lookupContextPath(
  path: string,
  context: ResolverContext,
): ExpressionValue {
  switch (path) {
    case 'github.workflow':
      return context.github.workflow;
    case 'github.event_name':
      return context.github.event_name;
    case 'github.ref':
      return context.github.ref;
    case 'github.event.pull_request.number':
      return context.github.event?.pull_request?.number;
    case 'github.event.label.name':
      return context.github.event?.label?.name;
    case 'github.event.inputs.branch_ref':
      return context.github.event?.inputs?.branch_ref;
    case 'github.event.inputs.ref':
      return context.github.event?.inputs?.ref;
    case 'github.event.inputs.tag':
      return context.github.event?.inputs?.tag;
    case 'inputs.branch_ref':
      return context.inputs?.branch_ref;
    case 'matrix.sandbox':
      return context.matrix?.sandbox;
    default:
      throw new Error(`Unsupported GitHub expression context path: ${path}`);
  }
}

function resolveOperand(
  operand: string,
  context: ResolverContext,
): ExpressionValue {
  // Either quote alone means a literal was intended, so a malformed one is
  // reported as a bad literal rather than as an unknown context path.
  if (operand.startsWith("'") || operand.endsWith("'")) {
    if (!/^'[^']*'$/.test(operand)) {
      throw new Error(`Unsupported single-quoted string literal: ${operand}`);
    }
    return operand.slice(1, -1);
  }
  return lookupContextPath(operand, context);
}

function isGithubTruthy(value: ExpressionValue): boolean {
  return !GITHUB_FALSY_VALUES.includes(value);
}

function resolveExpression(
  expression: string,
  context: ResolverContext,
): string {
  const operands = expression.split('||').map((operand) => operand.trim());
  if (operands.some((operand) => operand.length === 0)) {
    throw new Error(`Unsupported GitHub expression: ${expression.trim()}`);
  }
  for (const operand of operands) {
    const value = resolveOperand(operand, context);
    if (isGithubTruthy(value)) return String(value);
  }
  return '';
}

function resolveConcurrencyGroup(
  template: string,
  context: ResolverContext,
): string {
  const expressionPattern = /\$\{\{([\s\S]*?)\}\}/g;
  const resolved = template
    .trim()
    .replace(expressionPattern, (_match, expression: string) =>
      resolveExpression(expression, context),
    );
  if (resolved.includes('${{') || resolved.includes('}}')) {
    throw new Error(`Unsupported GitHub expression template: ${template}`);
  }
  return resolved;
}

function context(
  workflow: string,
  eventName: string,
  ref: string,
  event?: ResolverContext['github']['event'],
  inputs?: WorkflowInputs,
): ResolverContext {
  return {
    github: {
      workflow,
      event_name: eventName,
      ref,
      event,
    },
    inputs,
  };
}

function e2ePullRequestContext(
  eventName: string,
  number: number,
  label?: string,
): ResolverContext {
  const pullRequest = { pull_request: { number } };
  const event =
    label === undefined
      ? pullRequest
      : { ...pullRequest, label: { name: label } };
  return context(
    'Testing: E2E',
    eventName,
    eventName === 'pull_request'
      ? `refs/pull/${number}/merge`
      : 'refs/heads/main',
    event,
  );
}

function e2eDispatchContext(branchRef: string): ResolverContext {
  const inputs = { branch_ref: branchRef };
  return context(
    'Testing: E2E',
    'workflow_dispatch',
    'refs/heads/main',
    { inputs },
    inputs,
  );
}

function withSandbox(
  resolverContext: ResolverContext,
  sandbox: string,
): ResolverContext {
  return { ...resolverContext, matrix: { sandbox } };
}

describe('PR workflow concurrency cancellation', () => {
  it('scopes CI cancellation by workflow and PR number or ref', () => {
    const workflow = loadWorkflow('.github/workflows/ci.yml');
    const ciConcurrency = asOptionalRecord(workflow['concurrency']);

    expectConcurrencyGroup(ciConcurrency, [
      '${{ github.workflow }}',
      'github.event.pull_request.number || github.ref',
    ]);
    expectGroupsEqual(
      normalize(asOptionalString(ciConcurrency?.['group'])),
      '${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}',
    );
  });

  it('uses the exact E2E workflow and job-level concurrency groups', () => {
    const workflow = loadWorkflow('.github/workflows/e2e.yml');
    const workflowConcurrency = asOptionalRecord(workflow['concurrency']);
    const linuxConcurrency = asOptionalRecord(
      workflowJob(workflow, 'e2e_linux')['concurrency'],
    );

    expectConcurrencyGroup(workflowConcurrency, [
      '${{ github.workflow }}',
      '${{ github.event_name }}',
      'github.event.pull_request.number || github.event.inputs.branch_ref || github.ref',
      '${{ github.event.label.name }}',
    ]);
    expectGroupsEqual(
      normalize(asOptionalString(workflowConcurrency?.['group'])),
      '${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || github.event.inputs.branch_ref || github.ref }}-${{ github.event.label.name }}',
    );
    expectConcurrencyGroup(linuxConcurrency, [
      '${{ github.workflow }}',
      '${{ github.event_name }}',
      'github.event.pull_request.number || inputs.branch_ref || github.ref',
      '${{ github.event.label.name }}',
      '${{ matrix.sandbox }}',
    ]);
    expectGroupsEqual(
      normalize(asOptionalString(linuxConcurrency?.['group'])),
      '${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || inputs.branch_ref || github.ref }}-${{ github.event.label.name }}-${{ matrix.sandbox }}',
    );
    expect(workflowJob(workflow, 'skip_check').concurrency).toBeUndefined();
    expect(
      workflowJob(workflow, 'e2e_doc_change_filter').concurrency,
    ).toBeUndefined();
  });

  it('declares the intended workflow-level cancellation policies', () => {
    expectConcurrencyGroup(
      asOptionalRecord(
        loadWorkflow('.github/workflows/interactive-ui.yml')['concurrency'],
      ),
      ['github.workflow', 'github.event.pull_request.number || github.ref'],
    );
    expectConcurrencyGroup(
      asOptionalRecord(
        loadWorkflow('.github/workflows/smoke-test.yml')['concurrency'],
      ),
      [
        'github.workflow',
        'github.event_name',
        'github.event.inputs.ref || github.ref',
      ],
    );
    expectConcurrencyGroup(
      asOptionalRecord(
        loadWorkflow('.github/workflows/build-sandbox.yml')['concurrency'],
      ),
      ['github.workflow', 'github.ref', "github.event.inputs.tag || 'latest'"],
    );
    const releaseConcurrency = asOptionalRecord(
      loadWorkflow('.github/workflows/release.yml')['concurrency'],
    );
    expectConcurrencyGroup(
      releaseConcurrency,
      ['${{ github.workflow }}'],
      false,
    );
    expectGroupsEqual(
      normalize(asOptionalString(releaseConcurrency?.['group'])),
      '${{ github.workflow }}',
    );
  });

  it('groups superseding E2E PR runs while preserving matrix leg isolation', () => {
    const workflowGroup = concurrencyGroup('.github/workflows/e2e.yml');
    const firstPr = e2ePullRequestContext('pull_request', 123);
    const secondPr = {
      ...firstPr,
      github: { ...firstPr.github, sha: 'second-head-sha' },
    };

    expectGroupsEqual(
      resolveConcurrencyGroup(workflowGroup, firstPr),
      resolveConcurrencyGroup(workflowGroup, secondPr),
    );

    const linuxGroup = jobConcurrencyGroup(
      '.github/workflows/e2e.yml',
      'e2e_linux',
    );
    expectGroupsDifferent(
      resolveConcurrencyGroup(linuxGroup, withSandbox(firstPr, 'sandbox:none')),
      resolveConcurrencyGroup(
        linuxGroup,
        withSandbox(firstPr, 'sandbox:docker'),
      ),
    );
  });

  it('keeps different E2E PR numbers independent', () => {
    const group = concurrencyGroup('.github/workflows/e2e.yml');

    expectGroupsDifferent(
      resolveConcurrencyGroup(
        group,
        e2ePullRequestContext('pull_request', 123),
      ),
      resolveConcurrencyGroup(
        group,
        e2ePullRequestContext('pull_request', 124),
      ),
    );
  });

  it('isolates E2E merge-queue and push runs from PR runs', () => {
    const group = concurrencyGroup('.github/workflows/e2e.yml');
    const pullRequest = e2ePullRequestContext('pull_request', 123);
    const mergeGroup = context(
      'Testing: E2E',
      'merge_group',
      'refs/heads/gh-readonly-queue/main/pr-123-abc123',
    );
    const push = context('Testing: E2E', 'push', 'refs/heads/main');

    expectGroupsDifferent(
      resolveConcurrencyGroup(group, mergeGroup),
      resolveConcurrencyGroup(group, pullRequest),
    );
    expectGroupsDifferent(
      resolveConcurrencyGroup(group, push),
      resolveConcurrencyGroup(group, pullRequest),
    );
  });

  it('isolates different pull_request_target labels for the same E2E PR', () => {
    const group = concurrencyGroup('.github/workflows/e2e.yml');
    const approved = e2ePullRequestContext(
      'pull_request_target',
      123,
      'maintainer:e2e:ok',
    );
    const unrelated = e2ePullRequestContext(
      'pull_request_target',
      123,
      'ci/cd',
    );

    expectGroupsDifferent(
      resolveConcurrencyGroup(group, approved),
      resolveConcurrencyGroup(group, unrelated),
    );
  });

  it('groups repeated approved-label E2E target runs for the same PR', () => {
    const group = concurrencyGroup('.github/workflows/e2e.yml');
    const first = e2ePullRequestContext(
      'pull_request_target',
      123,
      'maintainer:e2e:ok',
    );
    const second = {
      ...first,
      github: { ...first.github, sha: 'reapplied-label-sha' },
    };

    expectGroupsEqual(
      resolveConcurrencyGroup(group, first),
      resolveConcurrencyGroup(group, second),
    );
  });

  it('isolates pull_request_target and pull_request E2E runs', () => {
    const group = concurrencyGroup('.github/workflows/e2e.yml');

    expectGroupsDifferent(
      resolveConcurrencyGroup(
        group,
        e2ePullRequestContext('pull_request_target', 123, 'ci/cd'),
      ),
      resolveConcurrencyGroup(
        group,
        e2ePullRequestContext('pull_request', 123),
      ),
    );
  });

  it('keeps E2E dispatches for different branch inputs independent', () => {
    const group = concurrencyGroup('.github/workflows/e2e.yml');

    expectGroupsDifferent(
      resolveConcurrencyGroup(group, e2eDispatchContext('main')),
      resolveConcurrencyGroup(group, e2eDispatchContext('release/1.x')),
    );
  });

  it('isolates e2e_linux pull_request and target job groups', () => {
    const group = jobConcurrencyGroup('.github/workflows/e2e.yml', 'e2e_linux');

    expectGroupsDifferent(
      resolveConcurrencyGroup(
        group,
        withSandbox(e2ePullRequestContext('pull_request', 123), 'sandbox:none'),
      ),
      resolveConcurrencyGroup(
        group,
        withSandbox(
          e2ePullRequestContext(
            'pull_request_target',
            123,
            'maintainer:e2e:ok',
          ),
          'sandbox:none',
        ),
      ),
    );
  });

  it('isolates E2E job groups by pull_request_target label', () => {
    const group = jobConcurrencyGroup('.github/workflows/e2e.yml', 'e2e_linux');
    const approved = withSandbox(
      e2ePullRequestContext('pull_request_target', 123, 'maintainer:e2e:ok'),
      'sandbox:none',
    );
    const unrelated = withSandbox(
      e2ePullRequestContext('pull_request_target', 123, 'ci/cd'),
      'sandbox:none',
    );

    expectGroupsDifferent(
      resolveConcurrencyGroup(group, approved),
      resolveConcurrencyGroup(group, unrelated),
    );
  });

  it('isolates an E2E PR number from the same dispatch branch_ref', () => {
    const group = jobConcurrencyGroup('.github/workflows/e2e.yml', 'e2e_linux');

    expectGroupsDifferent(
      resolveConcurrencyGroup(
        group,
        withSandbox(e2ePullRequestContext('pull_request', 123), 'sandbox:none'),
      ),
      resolveConcurrencyGroup(
        group,
        withSandbox(e2eDispatchContext('123'), 'sandbox:none'),
      ),
    );
  });

  it('groups interactive UI runs by PR or ref', () => {
    const group = concurrencyGroup('.github/workflows/interactive-ui.yml');
    const firstPr = context(
      'Interactive UI Tests',
      'pull_request',
      'refs/pull/42/merge',
      { pull_request: { number: 42 } },
    );
    const repeatedPr = {
      ...firstPr,
      github: { ...firstPr.github, sha: 'new-head-sha' },
    };
    const differentPr = context(
      'Interactive UI Tests',
      'pull_request',
      'refs/pull/43/merge',
      { pull_request: { number: 43 } },
    );
    const push = context('Interactive UI Tests', 'push', 'refs/heads/main');

    expectGroupsEqual(
      resolveConcurrencyGroup(group, firstPr),
      resolveConcurrencyGroup(group, repeatedPr),
    );
    expectGroupsDifferent(
      resolveConcurrencyGroup(group, firstPr),
      resolveConcurrencyGroup(group, differentPr),
    );
    expectGroupsDifferent(
      resolveConcurrencyGroup(group, firstPr),
      resolveConcurrencyGroup(group, push),
    );
  });

  it('groups only same-trigger smoke tests for the same ref', () => {
    const group = concurrencyGroup('.github/workflows/smoke-test.yml');
    const mainDispatch = context(
      'On Merge Smoke Test',
      'workflow_dispatch',
      'refs/heads/main',
      { inputs: { ref: 'main' } },
    );
    const releaseDispatch = context(
      'On Merge Smoke Test',
      'workflow_dispatch',
      'refs/heads/main',
      { inputs: { ref: 'release/1.x' } },
    );
    const firstPush = context('On Merge Smoke Test', 'push', 'refs/heads/main');
    const secondPush = {
      ...firstPush,
      github: { ...firstPush.github, sha: 'new-main-sha' },
    };

    expectGroupsDifferent(
      resolveConcurrencyGroup(group, mainDispatch),
      resolveConcurrencyGroup(group, releaseDispatch),
    );
    expectGroupsEqual(
      resolveConcurrencyGroup(group, firstPush),
      resolveConcurrencyGroup(group, secondPush),
    );
  });

  it('isolates manual and push smoke tests with the same literal ref', () => {
    const group = concurrencyGroup('.github/workflows/smoke-test.yml');
    const manual = context(
      'On Merge Smoke Test',
      'workflow_dispatch',
      'refs/heads/main',
      { inputs: { ref: 'refs/heads/main' } },
    );
    const push = context('On Merge Smoke Test', 'push', 'refs/heads/main');

    expectGroupsDifferent(
      resolveConcurrencyGroup(group, manual),
      resolveConcurrencyGroup(group, push),
    );
  });

  it('serializes release dispatches globally without cancellation', () => {
    const workflow = loadWorkflow('.github/workflows/release.yml');
    const concurrency = asOptionalRecord(workflow['concurrency']);
    const group = asOptionalString(concurrency?.['group']);
    if (group === undefined) {
      throw new Error('release.yml should declare a concurrency.group string');
    }
    const main = context('Release', 'workflow_dispatch', 'refs/heads/main');
    const tag = context('Release', 'workflow_dispatch', 'refs/tags/v1.2.3');

    expectGroupsEqual(
      resolveConcurrencyGroup(group, main),
      resolveConcurrencyGroup(group, tag),
    );
    expect(concurrency?.['cancel-in-progress']).toBe(false);
  });

  it('isolates different sandbox image tags on the same ref', () => {
    const group = concurrencyGroup('.github/workflows/build-sandbox.yml');
    const stable = context(
      'Build and Push Sandbox Image',
      'workflow_dispatch',
      'refs/heads/main',
      { inputs: { tag: 'stable' } },
    );
    const canary = context(
      'Build and Push Sandbox Image',
      'workflow_dispatch',
      'refs/heads/main',
      { inputs: { tag: 'canary' } },
    );

    expectGroupsDifferent(
      resolveConcurrencyGroup(group, stable),
      resolveConcurrencyGroup(group, canary),
    );
  });

  it('groups repeated sandbox image tags on the same ref', () => {
    const group = concurrencyGroup('.github/workflows/build-sandbox.yml');
    const first = context(
      'Build and Push Sandbox Image',
      'workflow_dispatch',
      'refs/heads/main',
      { inputs: { tag: 'stable' } },
    );
    const second = {
      ...first,
      github: { ...first.github, sha: 'new-main-sha' },
    };

    expectGroupsEqual(
      resolveConcurrencyGroup(group, first),
      resolveConcurrencyGroup(group, second),
    );
  });

  it("defaults a missing sandbox image tag to the 'latest' literal", () => {
    const group = concurrencyGroup('.github/workflows/build-sandbox.yml');
    const missingTag = context(
      'Build and Push Sandbox Image',
      'workflow_dispatch',
      'refs/heads/main',
    );
    const explicitLatest = context(
      'Build and Push Sandbox Image',
      'workflow_dispatch',
      'refs/heads/main',
      { inputs: { tag: 'latest' } },
    );

    expectGroupsEqual(
      resolveConcurrencyGroup(group, missingTag),
      resolveConcurrencyGroup(group, explicitLatest),
    );
    expectGroupsEqual(
      resolveConcurrencyGroup(group, missingTag),
      'Build and Push Sandbox Image-refs/heads/main-latest',
    );
  });
});
