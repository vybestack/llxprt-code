/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { describe, it, expect, beforeAll } from 'vitest';
import type { WorkflowDocument, WorkflowJob } from './typed-test-helpers.ts';
import { parseWorkflowYaml, asOptionalRecord } from './typed-test-helpers.ts';
import { readRootFile, stepNamed } from './ocr-review-workflow-helpers.ts';

const ACPLINT_PIN =
  'acplint @ git+https://github.com/rinadelph/acplint.git@e2f4e49b3ba825869a4ecab7e10076d4460f4dcd';

const CHECKOUT_SHA =
  'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
const SETUP_NODE_SHA =
  'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020';
const SETUP_BUN_SHA =
  'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6';
const SETUP_PYTHON_SHA =
  'actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97';
const UPLOAD_ARTIFACT_SHA =
  'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';

function loadCiWorkflow(): WorkflowDocument {
  const source = readRootFile('.github/workflows/ci.yml');
  return parseWorkflowYaml(source);
}

function jobNeeds(job: WorkflowJob | undefined): string[] {
  const needs = job?.needs;
  if (needs === undefined) return [];
  return Array.isArray(needs) ? [...needs] : [needs];
}

function workflowJob(
  jobs: Record<string, WorkflowJob>,
  jobName: string,
): WorkflowJob {
  const job = jobs[jobName];
  if (job === undefined) {
    throw new Error(`Unknown workflow job referenced by needs: ${jobName}`);
  }
  return job;
}

function transitiveNeeds(
  jobs: Record<string, WorkflowJob>,
  jobName: string,
): Set<string> {
  let closure = new Set(jobNeeds(workflowJob(jobs, jobName)));
  while (true) {
    const expanded = new Set([
      ...closure,
      ...[...closure].flatMap((dependency) =>
        jobNeeds(workflowJob(jobs, dependency)),
      ),
    ]);
    if (expanded.size === closure.size) return expanded;
    closure = expanded;
  }
}

interface TestAggregateResults {
  shouldSkip: string;
  selector: string;
  hasTests: string;
  shards: string;
  nodeConsumerSmoke: string;
  acp: string;
}

function runTestAggregate(
  runText: string,
  results: TestAggregateResults,
): SpawnSyncReturns<string> {
  const expressions = new Map([
    ['${{ needs.skip_check.outputs.should_skip }}', results.shouldSkip],
    ['${{ needs.shard_selector.result }}', results.selector],
    ['${{ needs.shard_selector.outputs.has_tests }}', results.hasTests],
    ['${{ needs.test_shard.result }}', results.shards],
    ['${{ needs.node_consumer_smoke.result }}', results.nodeConsumerSmoke],
    ['${{ needs.acp_conformance.result }}', results.acp],
  ]);
  let script = runText;
  for (const [expression, value] of expressions) {
    script = script.replaceAll(expression, value);
  }
  return spawnSync('bash', ['-c', script], { encoding: 'utf8' });
}

describe('Issue #2564: acp_conformance CI job', () => {
  let workflow: WorkflowDocument;
  let jobs: Record<string, WorkflowJob>;
  let acpJob: WorkflowJob | undefined;
  let testJob: WorkflowJob | undefined;

  beforeAll(() => {
    workflow = loadCiWorkflow();
    jobs = workflow['jobs']!;
    acpJob = jobs['acp_conformance'];
    testJob = jobs['test'];
  });

  it('defines an acp_conformance job', () => {
    expect(acpJob, 'ci.yml must contain an acp_conformance job').toBeTruthy();
  });

  it('runs on ubuntu-latest', () => {
    expect(acpJob?.['runs-on']).toBe('ubuntu-latest');
  });

  it('has a bounded timeout', () => {
    expect(acpJob?.['timeout-minutes']).toBeGreaterThan(0);
    expect(acpJob?.['timeout-minutes']).toBeLessThanOrEqual(30);
  });

  it('uses least-privilege contents:read permissions', () => {
    expect(acpJob?.permissions).toEqual({ contents: 'read' });
  });

  it('preserves the duplicate-PR skip behavior via skip_check dependency', () => {
    expect(acpJob?.needs).toContain('skip_check');
  });

  it('only runs when skip_check is not true', () => {
    expect(acpJob?.if).toContain("should_skip != 'true'");
  });

  it('uses the exact immutable checkout SHA', () => {
    const checkout = stepNamed(acpJob, 'Checkout');
    expect(checkout.uses).toBe(CHECKOUT_SHA);
    expect(checkout.with?.['persist-credentials']).toBe(false);
  });

  it('uses the exact immutable setup-node SHA', () => {
    const setupNode = stepNamed(acpJob, 'Set up Node.js');
    expect(setupNode.uses).toBe(SETUP_NODE_SHA);
    expect(setupNode.with?.['node-version-file']).toBe('.nvmrc');
  });

  it('uses the exact immutable setup-bun SHA', () => {
    const setupBun = stepNamed(acpJob, 'Setup Bun');
    expect(setupBun.uses).toBe(SETUP_BUN_SHA);
    expect(setupBun.with?.['bun-version-file']).toBe('.bun-version');
  });

  it('uses the exact immutable setup-python SHA', () => {
    const setupPython = stepNamed(acpJob, 'Set up Python');
    expect(setupPython.uses).toBe(SETUP_PYTHON_SHA);
    const version = String(setupPython.with?.['python-version'] ?? '');
    const major = Number.parseInt(version.split('.')[0]!, 10);
    expect(major).toBeGreaterThanOrEqual(3);
    const minor = Number.parseInt(version.split('.')[1] ?? '0', 10);
    if (major === 3) {
      expect(minor).toBeGreaterThanOrEqual(11);
    }
  });

  it('uses the exact immutable upload-artifact SHA', () => {
    const uploadStep = stepNamed(acpJob, 'Upload acplint diagnostics');
    expect(uploadStep.uses).toBe(UPLOAD_ARTIFACT_SHA);
  });

  it('installs with plain bun install (never --frozen-lockfile, no lockfile masking)', () => {
    const installStep = stepNamed(acpJob, 'Install dependencies');
    expect(installStep.run).toContain('bun install');
    expect(installStep.run).not.toContain('--frozen-lockfile');
    expect(installStep.run).not.toContain('git checkout -- bun.lock');
  });

  it('pins acplint to the immutable source commit', () => {
    const pipStep = stepNamed(acpJob, 'Install acplint');
    expect(pipStep.run).toContain('python -m pip install');
    const hasBarePip = String(pipStep.run)
      .split(String.fromCharCode(10))
      .some((line) => line.trim().startsWith('pip install'));
    expect(hasBarePip).toBe(false);
    expect(pipStep.run).toContain(ACPLINT_PIN);
  });

  it('verifies acplint version by exact equality', () => {
    const verifyStep = stepNamed(acpJob, 'Verify acplint version');
    expect(verifyStep.run).toContain('"acplint 0.2.0"');
  });

  it('builds the project before running acplint', () => {
    const buildStep = stepNamed(acpJob, 'Build project');
    expect(buildStep.run).toContain('npm run build');
  });

  it('does not use invalid job-level runner context expressions', () => {
    expect(acpJob?.env).toBeUndefined();
  });

  it('initializes diagnostics and LLXPRT homes via $RUNNER_TEMP in the first step', () => {
    const steps = acpJob?.steps ?? [];
    const initStep = steps[0];
    expect(initStep?.name).toBe('Initialize diagnostics and LLXPRT homes');
    const script = String(initStep?.run ?? '');
    expect(script).toContain('RUNNER_TEMP');
    expect(script).toContain('ACPLINT_DIAG_DIR=');
    expect(script).toContain('LLXPRT_CONFIG_HOME=');
    expect(script).toContain('LLXPRT_DATA_HOME=');
    expect(script).toContain('LLXPRT_LOG_HOME=');
    expect(script).toContain('GITHUB_ENV');
  });

  it('isolates diagnostics and LLXPRT homes under the runner temp directory', () => {
    const steps = acpJob?.steps ?? [];
    const initStep = steps[0];
    const script = String(initStep?.run ?? '');
    expect(script).toContain('RUNNER_TEMP}/acplint/diagnostics');
    expect(script).toContain('RUNNER_TEMP}/acplint/llxprt-config');
    expect(script).toContain('RUNNER_TEMP}/acplint/llxprt-data');
    expect(script).toContain('diag_dir="${RUNNER_TEMP}/acplint/diagnostics"');
    expect(script).toContain('log_dir="${diag_dir}/llxprt-logs"');
  });

  it('writes LLXPRT logs nested under the diagnostics artifact', () => {
    const steps = acpJob?.steps ?? [];
    const initStep = steps[0];
    const script = String(initStep?.run ?? '');
    expect(script).toContain('diag_dir="${RUNNER_TEMP}/acplint/diagnostics"');
    expect(script).toContain('log_dir="${diag_dir}/llxprt-logs"');
    expect(script).not.toContain('LLXPRT_STATE_HOME');
  });

  it('runs diagnostics initialization before checkout', () => {
    const steps = acpJob?.steps ?? [];
    const initStep = steps[0];
    expect(initStep?.name).toBe('Initialize diagnostics and LLXPRT homes');
    const checkoutIdx = steps.findIndex((s) => s.name === 'Checkout');
    expect(checkoutIdx).toBeGreaterThan(0);
  });

  it('invokes acplint with the real launcher and exact placeholder args', () => {
    const runStep = stepNamed(acpJob, 'Run acplint');
    expect(runStep.run).toContain('./packages/cli/bin/llxprt');
    expect(runStep.run).toContain('--experimental-acp');
    expect(runStep.run).toContain('--provider openai');
    expect(runStep.run).toContain('--model gpt-4o');
    expect(runStep.run).toContain('--key acplint-ci');
  });

  it('invokes acplint with explicit --cwd matching the workspace', () => {
    const runStep = stepNamed(acpJob, 'Run acplint');
    expect(runStep.run).toContain('--cwd "${GITHUB_WORKSPACE}"');
  });

  it('selects exactly initialization, session_lifecycle, schema_validation', () => {
    const runStep = stepNamed(acpJob, 'Run acplint');
    const categoriesLine = (runStep.run ?? '')
      .split('\n')
      .find((line) => line.includes('--categories'));
    if (categoriesLine === undefined) {
      throw new Error('Run acplint step is missing --categories');
    }
    const categoriesPart = categoriesLine
      .split('--categories')
      .at(1)
      ?.trim()
      .replace(/\\$/, '')
      .trim();
    expect(categoriesPart).toBe(
      'initialization session_lifecycle schema_validation',
    );
  });

  it('captures the raw acplint exit status before validation', () => {
    const runStep = stepNamed(acpJob, 'Run acplint');
    expect(runStep.run).toContain('EXIT_CODE');
    expect(runStep.run).toContain('status.txt');
  });

  it('prints the acplint log tail when the raw status is nonzero', () => {
    const runStep = stepNamed(acpJob, 'Run acplint');
    expect(runStep.run).toContain('if [ "$EXIT_CODE" -ne 0 ]; then');
    expect(runStep.run).toContain('tail');
    expect(runStep.run).toContain('acplint.log');
  });

  it('captures the acplint JSON output via --output-file', () => {
    const runStep = stepNamed(acpJob, 'Run acplint');
    expect(runStep.run).toContain('--output json');
    expect(runStep.run).toContain('--output-file');
    expect(runStep.run).toContain('report.json');
  });

  it('runs the committed report validator', () => {
    const validateStep = stepNamed(acpJob, 'Validate acplint report');
    expect(validateStep.run).toContain('scripts/validate-acplint-report.ts');
  });

  it('creates a truthful pre-run status before checkout and setup', () => {
    const preRunStep = stepNamed(
      acpJob,
      'Initialize diagnostics and LLXPRT homes',
    );
    expect(preRunStep.run).toContain('mkdir');
    expect(preRunStep.run).toContain('status.txt');
    expect(preRunStep.run).toContain('not-run');
    const steps = acpJob?.steps ?? [];
    expect(steps.indexOf(preRunStep)).toBeLessThan(
      steps.indexOf(stepNamed(acpJob, 'Checkout')),
    );
  });

  it('uploads artifacts with always() condition', () => {
    const uploadStep = stepNamed(acpJob, 'Upload acplint diagnostics');
    expect(uploadStep.if).toContain('always()');
  });

  it('artifact upload uses if-no-files-found: error', () => {
    const uploadStep = stepNamed(acpJob, 'Upload acplint diagnostics');
    expect(uploadStep.with?.['if-no-files-found']).toBe('error');
  });

  it('uploads the diagnostics directory via a valid runner.temp path', () => {
    const uploadStep = stepNamed(acpJob, 'Upload acplint diagnostics');
    expect(uploadStep.with?.['path']).toBe(
      '${{ runner.temp }}/acplint/diagnostics/',
    );
  });

  it('is wired into the Test aggregator', () => {
    expect(testJob?.needs).toContain('acp_conformance');
  });

  it('Test aggregator fails when acp_conformance does not succeed', () => {
    const checkStep = stepNamed(testJob, 'Check shard results');
    const runText = checkStep.run ?? '';
    expect(runText).toContain('acp_result');
    expect(runText).toContain('needs.acp_conformance.result');
    expect(runText).toContain('ACP conformance job did not succeed');
    expect(runText).toContain('exit 1');
  });

  it('does not contain the invalid setup-node SHA anywhere in the job', () => {
    const steps = acpJob?.steps ?? [];
    for (const step of steps) {
      const uses = step.uses ?? '';
      expect(uses).not.toContain('8207627863c7cc4c66a329aec7e433d2d1c52a9');
    }
  });
});

describe('Issue #2877: test matrix scheduling', () => {
  let workflow: WorkflowDocument;
  let jobs: Record<string, WorkflowJob>;
  let testShardJob: WorkflowJob | undefined;
  let lintJob: WorkflowJob | undefined;
  let testJob: WorkflowJob | undefined;
  let nodeConsumerSmokeJob: WorkflowJob | undefined;
  let secureStoreJob: WorkflowJob | undefined;

  beforeAll(() => {
    workflow = loadCiWorkflow();
    jobs = workflow['jobs']!;
    testShardJob = jobs['test_shard'];
    lintJob = jobs['lint'];
    testJob = jobs['test'];
    nodeConsumerSmokeJob = jobs['node_consumer_smoke'];
    secureStoreJob = jobs['secure_store_backend'];
  });

  it('test_shard depends directly on exactly node_consumer_smoke, doc_change_filter, shard_selector, and skip_check', () => {
    const needs = jobNeeds(testShardJob);
    expect(needs).toEqual([
      'node_consumer_smoke',
      'doc_change_filter',
      'shard_selector',
      'skip_check',
    ]);
  });

  it('test_shard does not directly need lint or any lint_* job', () => {
    const needs = jobNeeds(testShardJob);
    expect(needs).not.toContain('lint');
    const lintDeps = needs.filter((n) => n.startsWith('lint_'));
    expect(lintDeps, `unexpected lint_* deps: ${lintDeps.join(', ')}`).toEqual(
      [],
    );
  });

  it('test_shard has no transitive dependency on lint or any lint_* job', () => {
    const closure = transitiveNeeds(jobs, 'test_shard');
    expect(closure.has('lint')).toBe(false);
    const lintInClosure = [...closure].filter((n) => n.startsWith('lint'));
    expect(
      lintInClosure,
      `transitive lint dependency found: ${lintInClosure.join(', ')}`,
    ).toEqual([]);
  });

  it('lint aggregator needs exactly the four linters plus node_consumer_smoke', () => {
    const needs = jobNeeds(lintJob);
    expect(needs).toEqual([
      'lint_github_actions',
      'lint_javascript',
      'lint_shell',
      'lint_yaml',
      'node_consumer_smoke',
    ]);
  });

  it('node_consumer_smoke needs only skip_check', () => {
    const needs = jobNeeds(nodeConsumerSmokeJob);
    expect(needs).toEqual(['skip_check']);
  });

  it('node_consumer_smoke preserves its skip condition', () => {
    expect(nodeConsumerSmokeJob?.if).toContain("should_skip != 'true'");
  });

  it('preserves the Lint aggregator name', () => {
    expect(lintJob?.name).toBe('Lint');
  });

  it('preserves the Test aggregator name', () => {
    expect(testJob?.name).toBe('Test');
  });

  it('preserves the Test aggregator failure check for skipped test shards', () => {
    const checkStep = stepNamed(testJob, 'Check shard results');
    const runText = checkStep.run ?? '';
    expect(testJob?.if).toContain('always()');
    expect(jobNeeds(testJob)).toEqual([
      'test_shard',
      'shard_selector',
      'skip_check',
      'node_consumer_smoke',
      'acp_conformance',
    ]);
    expect(runText).toContain("shard_result='${{ needs.test_shard.result }}'");
    expect(runText).toContain(`if [ "$shard_result" != "success" ]; then
    echo "::error::Test shards did not all succeed (result: $shard_result)"
    exit 1
  fi`);
  });

  it('fails the no-tests path when node_consumer_smoke fails', () => {
    const checkStep = stepNamed(testJob, 'Check shard results');
    const result = runTestAggregate(checkStep.run ?? '', {
      shouldSkip: 'false',
      selector: 'success',
      hasTests: 'false',
      shards: 'skipped',
      nodeConsumerSmoke: 'failure',
      acp: 'success',
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      'Node Consumer Smoke did not succeed (result: failure)',
    );
  });

  it('preserves the exact test_shard condition', () => {
    expect(testShardJob?.if).toBe(
      "${{ needs.doc_change_filter.outputs.docs_only != 'true' && needs.skip_check.outputs.should_skip != 'true' && needs.shard_selector.result == 'success' && needs.shard_selector.outputs.has_tests == 'true' }}",
    );
  });

  it('preserves test_shard matrix scheduling from shard_selector', () => {
    const strategy = asOptionalRecord(testShardJob?.strategy);
    expect(strategy?.['fail-fast']).toBe(false);
    expect(asOptionalRecord(strategy?.['matrix'])).toEqual({
      include: '${{ fromJSON(needs.shard_selector.outputs.matrix) }}',
    });
  });

  it('secure_store_backend still needs lint', () => {
    const needs = jobNeeds(secureStoreJob);
    expect(needs).toContain('lint');
  });
});
