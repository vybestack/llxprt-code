/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeAll, describe, expect, it } from 'vitest';
import vm from 'vm';
import {
  asBoolean,
  asOptionalRecord,
  asOptionalString,
  asRecord,
  asRecordArray,
  asString,
  asStringArray,
  parseWorkflowYaml,
} from './typed-test-helpers.ts';
import { readRootFile, normalize } from './ocr-review-workflow-helpers.ts';

function loadWorkflow(workflowPath: string) {
  const raw = readRootFile(workflowPath);
  const parsed = parseWorkflowYaml(raw);
  const jobs = asOptionalRecord(parsed.jobs);
  return { raw, parsed, jobs };
}

const E2E_GATE_PREDICATE = `
  \${{ needs.skip_check.result == 'success' &&
      needs.skip_check.outputs.should_skip != 'true' &&
      github.event_name == 'pull_request_target' &&
      github.event.action == 'labeled' &&
      github.event.label.name == 'maintainer:e2e:ok' &&
      github.event.pull_request.head.repo.full_name == github.repository }}
`;

const E2E_DOC_FILTER_PREDICATE = `
  \${{ needs.skip_check.result == 'success' &&
      needs.skip_check.outputs.should_skip != 'true' &&
      (github.event_name != 'pull_request_target' ||
       (github.event.action == 'labeled' &&
        github.event.label.name == 'maintainer:e2e:ok' &&
        github.event.pull_request.head.repo.full_name == github.repository)) }}
`;

function evaluateE2ECondition(
  condition: string,
  context: Record<string, unknown>,
) {
  const expression = condition
    .replaceAll('needs.mergeability-gate', "needs['mergeability-gate']")
    .replaceAll('.outputs.should-run', ".outputs['should-run']")
    .trim();
  return vm.runInNewContext(expression, {
    ...context,
    cancelled: () => asBoolean(context.cancelled) ?? false,
  });
}

interface E2eContextParams {
  eventName: string;
  action?: string;
  label?: string;
  headRepository?: string;
  repository?: string;
  skipResult?: string;
  shouldSkip?: string;
  docResult?: string;
  docsOnly?: string;
  gateResult?: string;
  shouldRun?: string;
  cancelled?: boolean;
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
}: E2eContextParams) {
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

describe('E2E mergeability gate wiring (.github/workflows/e2e.yml)', () => {
  let parsed: Record<string, unknown>;
  let linuxJob: Record<string, unknown> | undefined;
  let macJob: Record<string, unknown> | undefined;
  let gateJob: Record<string, unknown> | undefined;
  let docFilterJob: Record<string, unknown> | undefined;

  beforeAll(() => {
    const wf = loadWorkflow('.github/workflows/e2e.yml');
    parsed = wf.parsed;
    const jobs = wf.jobs;
    linuxJob = asRecord(jobs?.e2e_linux ?? undefined);
    macJob = asRecord(jobs?.e2e_mac ?? undefined);
    gateJob = asRecord(jobs?.['mergeability-gate'] ?? undefined);
    docFilterJob = asRecord(jobs?.e2e_doc_change_filter ?? undefined);
  });

  it('retains existing push, pull_request, merge_group, workflow_dispatch triggers', () => {
    const on = asOptionalRecord(parsed.on);
    expect(on?.push).toBeTruthy();
    expect(on?.pull_request).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(on, 'merge_group')).toBe(true);
    expect(on?.workflow_dispatch).toBeTruthy();
  });

  it('permits only labeled pull_request_target triggers', () => {
    const on = asOptionalRecord(parsed.on);
    const prt = asOptionalRecord(on?.pull_request_target);
    expect(prt?.types).toEqual(['labeled']);
  });

  it('limits mergeability gate and target setup to the exact approved label event', () => {
    expect(normalize(asOptionalString(gateJob?.if))).toBe(
      normalize(E2E_GATE_PREDICATE),
    );
    expect(normalize(asOptionalString(docFilterJob?.if))).toBe(
      normalize(E2E_DOC_FILTER_PREDICATE),
    );
  });

  it('passes no secrets contract to the target mergeability gate', () => {
    expect(gateJob?.secrets).toBeUndefined();
  });

  it('formats the event PR number as the reusable string input', () => {
    const withInputs = asRecord(gateJob?.with);
    expect(withInputs['pull-request-number']).toBe(
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
      name: 'approved fork target event remains blocked after a successful gate',
      eventName: 'pull_request_target',
      headRepository: 'fork/repo',
      action: 'labeled',
      label: 'maintainer:e2e:ok',
      gateResult: 'success',
      shouldRun: 'true',
      linux: false,
      mac: false,
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

      expect(
        Boolean(evaluateE2ECondition(asString(linuxJob?.if), context)),
      ).toBe(scenario.linux);
      expect(Boolean(evaluateE2ECondition(asString(macJob?.if), context))).toBe(
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
    const requiredFragments = [
      "needs.skip_check.result == 'success'",
      "needs.e2e_doc_change_filter.result == 'success'",
      "needs.mergeability-gate.result == 'success'",
      "needs.mergeability-gate.outputs.should-run == 'true'",
      'github.event.pull_request.head.repo.full_name == github.repository',
      "needs.mergeability-gate.result == 'skipped'",
    ];
    for (const job of [linuxJob, macJob]) {
      const needs = asStringArray(job?.needs);
      expect(needs).toEqual([
        'e2e_doc_change_filter',
        'skip_check',
        'mergeability-gate',
      ]);
      const predicate = normalize(asOptionalString(job?.if));
      for (const fragment of requiredFragments) {
        expect(predicate).toContain(normalize(fragment));
      }
      expect(predicate).not.toContain(
        normalize("needs.mergeability-gate.outputs.should-run != 'false'"),
      );
    }
  });

  it('bounds Linux/macOS jobs while preserving concurrency, matrix, and continue-on-error', () => {
    expect(linuxJob?.['timeout-minutes']).toBe(60);
    expect(macJob?.['timeout-minutes']).toBe(60);
    const linuxConcurrency = asOptionalRecord(linuxJob?.concurrency);
    const macConcurrency = asOptionalRecord(macJob?.concurrency);
    expect(linuxConcurrency?.['cancel-in-progress']).toBe(true);
    expect(macConcurrency?.['cancel-in-progress']).toBe(true);
    expect(linuxConcurrency?.group).toContain('${{ matrix.sandbox }}');
    expect(macJob?.continue_on_error ?? macJob?.['continue-on-error']).toBe(
      true,
    );
    const linuxStrategy = asOptionalRecord(linuxJob?.strategy);
    const linuxMatrix = asOptionalRecord(linuxStrategy?.matrix);
    expect(linuxMatrix?.sandbox).toContain('sandbox:none');
    expect(linuxMatrix?.sandbox).toContain('sandbox:docker');
  });

  it('retains the duplicate-check action', () => {
    const jobs = asOptionalRecord(parsed.jobs);
    const skipCheck = asRecord(jobs?.skip_check ?? undefined);
    const skipSteps = asRecordArray(skipCheck.steps);
    const skipStep = skipSteps?.find((step) => step.id === 'skip_check');
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
