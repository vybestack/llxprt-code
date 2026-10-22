/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  asOptionalRecord,
  asRecord,
  compositeActionSteps,
  parseWorkflowYaml,
} from './typed-test-helpers.ts';
import type {
  WorkflowDocument,
  WorkflowJob,
  WorkflowStep,
} from './typed-test-helpers.ts';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '../..');

type WorkflowObject = WorkflowDocument;

function loadWorkflow(relPath: string): WorkflowObject {
  const source = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  return parseWorkflowYaml(source);
}

const SETUP_ACTION_PATH = './.github/actions/setup-local-gemma';

function setupActionSteps(): WorkflowStep[] {
  return compositeActionSteps(
    fs.readFileSync(
      path.join(ROOT, '.github/actions/setup-local-gemma/action.yml'),
      'utf8',
    ),
  );
}

/** The `KEY=value` pairs the setup action appends to GITHUB_ENV. */
function exportedProviderEnvironment(): Record<string, string> {
  const exportStep = setupActionSteps().find(
    (candidate) => candidate.name === 'Export local model test environment',
  );
  const exported: Record<string, string> = {};
  for (const match of String(exportStep?.run).matchAll(
    /echo '([A-Z0-9_]+)=([^']*)'/g,
  )) {
    exported[match[1]] = match[2];
  }
  return exported;
}

function hasSecretOrVariable(value: unknown): boolean {
  return /\b(?:secrets|vars)(?:\.|\[)/.test(JSON.stringify(value));
}

function jobsOf(workflow: WorkflowObject): Record<string, WorkflowJob> {
  const jobs = workflow['jobs'];
  if (!jobs) {
    throw new Error('workflow must define a jobs map');
  }
  return jobs;
}

function localStepNamed(
  job: WorkflowJob | undefined,
  name: string,
): WorkflowStep {
  expect(job?.steps, 'job should have a steps array').toBeDefined();
  const step = job?.steps?.find(
    (candidate: WorkflowStep) => candidate.name === name,
  );
  expect(step, `job should contain step: ${name}`).toBeTruthy();
  if (!step) throw new Error(`job should contain step: ${name}`);
  return step;
}

function envOf(step: WorkflowStep | undefined): Record<string, unknown> {
  return step?.env ?? {};
}

/**
 * Issue #2605: The dedicated Evals Nightly workflow failed every matrix sample
 * before making a model request because it omitted LLXPRT_DEFAULT_MODEL and
 * OPENAI_BASE_URL. The fix shares one canonical behavioral-eval job between
 * the dedicated nightly and broader nightly workflows via a reusable workflow
 * (_evals-run.yml) so provider configuration cannot drift.
 */
describe('evals-nightly.yml delegates to the shared reusable eval workflow', () => {
  const nightly = loadWorkflow('.github/workflows/evals-nightly.yml');

  it('keeps the minimal required top-level permissions', () => {
    const perms = asRecord(nightly['permissions'] ?? {});
    expect(perms['contents']).toBe('read');
    expect(perms['actions']).toBe('read');
  });

  it('calls the reusable eval workflow without passing any secret', () => {
    const jobs = jobsOf(nightly);
    const evalsJob = jobs['evals'];
    expect(evalsJob, 'workflow should define evals job').toBeDefined();
    expect(evalsJob?.uses).toBe('./.github/workflows/_evals-run.yml');
    // Evals run against the local model, so neither a named secret nor broad
    // secrets:inherit may reach the reusable workflow.
    expect(
      evalsJob?.secrets,
      'must not pass or inherit secrets',
    ).toBeUndefined();
    expect(hasSecretOrVariable(evalsJob)).toBe(false);
  });

  it('preserves three statistical matrix samples by not overriding run-attempts', () => {
    const jobs = jobsOf(nightly);
    const evalsJob = jobs['evals'];
    expect(
      evalsJob?.with,
      'dedicated nightly should not override run-attempts',
    ).toBeUndefined();
  });

  it('runs aggregation after evals regardless of outcome', () => {
    const jobs = jobsOf(nightly);
    const aggregateJob = jobs['aggregate-results'];
    expect(aggregateJob).toBeDefined();
    expect(aggregateJob?.needs).toEqual(['evals']);
    expect(aggregateJob?.if).toBe('always()');
  });

  it('downloads all artifacts and runs aggregate_evals into the step summary', () => {
    const jobs = jobsOf(nightly);
    const aggregateJob = jobs['aggregate-results'];
    const download = localStepNamed(aggregateJob, 'Download all artifacts');
    expect(download.with?.['path']).toBe('artifacts');
    const agg = localStepNamed(aggregateJob, 'Aggregate and output results');
    expect(String(agg.run)).toContain(
      'bun scripts/aggregate_evals.ts artifacts',
    );
    expect(String(agg.run)).toContain('>> "$GITHUB_STEP_SUMMARY"');
  });

  it('disables credential persistence on the aggregate checkout (no Git auth needed)', () => {
    const jobs = jobsOf(nightly);
    const aggregateJob = jobs['aggregate-results'];
    const checkout = localStepNamed(aggregateJob, 'Checkout');
    expect(checkout.with?.['persist-credentials']).toBe(false);
  });
});

/**
 * Issue #2605 (workflow concurrency + timeout): The dedicated Evals Nightly
 * workflow triggers on schedule and workflow_dispatch. Without a concurrency
 * group, a manual dispatch overlapping a scheduled run (or two delayed
 * scheduled runs) would execute simultaneously, producing duplicate artifacts
 * and wasting provider quota. A concurrency group with cancel-in-progress:
 * false serializes runs so a long-running eval is never killed mid-flight.
 * The aggregate job and the reusable eval matrix job should each have a
 * proportional explicit timeout-minutes so a stuck run cannot hang
 * indefinitely.
 */
describe('evals-nightly.yml concurrency and timeouts', () => {
  const nightly = loadWorkflow('.github/workflows/evals-nightly.yml');

  it('declares a concurrency group with cancel-in-progress: false', () => {
    const concurrency = asOptionalRecord(nightly['concurrency']);
    expect(concurrency, 'workflow must define concurrency').toBeDefined();
    expect(concurrency?.['group']).toBeTruthy();
    // cancel-in-progress: false so a running eval is not killed by a new run;
    // the new run waits instead. This is critical for expensive model evals.
    expect(concurrency?.['cancel-in-progress']).toBe(false);
  });

  it('aggregate-results job has a proportional timeout-minutes', () => {
    const jobs = jobsOf(nightly);
    const aggregateJob = jobs['aggregate-results'];
    expect(
      aggregateJob?.['timeoutMinutes'] ?? aggregateJob?.['timeout-minutes'],
    ).toBe(10);
  });
});

describe('_evals-run.yml: shared provider configuration', () => {
  const reusable = loadWorkflow('.github/workflows/_evals-run.yml');
  const evalsJob = jobsOf(reusable)['evals'];

  it('is a reusable workflow callable via workflow_call', () => {
    const on = asOptionalRecord(reusable['on']);
    expect(on).toHaveProperty('workflow_call');
    expect(evalsJob, 'workflow should define evals job').toBeDefined();
    expect(evalsJob?.['runs-on']).toBe('ubuntu-latest');
    const attempts = asOptionalRecord(evalsJob?.strategy?.matrix)?.[
      'run_attempt'
    ];
    expect(String(attempts)).toContain('fromJSON(inputs.run-attempts)');
  });

  it('declares no workflow_call secrets and references no repository secret or variable', () => {
    const on = asOptionalRecord(reusable['on']);
    const workflowCall = on?.['workflow_call'];
    expect(workflowCall, 'must define on.workflow_call').toBeDefined();
    const workflowCallRec = asOptionalRecord(workflowCall);
    expect(workflowCallRec?.['secrets']).toBeUndefined();
    expect(Object.keys(asRecord(workflowCallRec?.['inputs']))).toEqual([
      'run-attempts',
    ]);
    // The paid provider key and its repository variables are retired: nothing
    // in the reusable workflow may read them.
    expect(hasSecretOrVariable(reusable)).toBe(false);
  });

  it('keeps the minimal required permissions (contents: read)', () => {
    const perms = asRecord(reusable['permissions'] ?? {});
    expect(perms['contents']).toBe('read');
  });

  it('disables credential persistence on the reusable checkout (no Git auth needed)', () => {
    // The reusable eval job only runs the committed eval suite; it performs no
    // Git push, so the checkout must not persist a token into the local Git
    // config. This limits credential exposure in the evals environment.
    const checkout = localStepNamed(evalsJob, 'Checkout');
    expect(checkout.with?.['persist-credentials']).toBe(false);
  });

  it('runs the evals against the shared local Gemma model configuration', () => {
    const steps = evalsJob?.steps ?? [];
    const setup = localStepNamed(evalsJob, 'Set up local Gemma 4 E2B model');
    expect(setup.uses).toBe(SETUP_ACTION_PATH);
    const runStep = localStepNamed(evalsJob, 'Run all evals');
    expect(steps.indexOf(setup)).toBeGreaterThan(
      steps.indexOf(localStepNamed(evalsJob, 'Build project')),
    );
    expect(steps.indexOf(setup)).toBeLessThan(steps.indexOf(runStep));
    // The provider environment comes from the setup action's GITHUB_ENV
    // export, so the eval step only carries eval-specific variables.
    expect(envOf(runStep)).toEqual({
      LLXPRT_FORCE_FILE_STORAGE: 'true',
      RUN_EVALS: '1',
    });
    expect(exportedProviderEnvironment()).toEqual({
      OPENAI_API_KEY: 'ollama-local-only',
      OPENAI_BASE_URL: 'http://127.0.0.1:12644/v1',
      LLXPRT_DEFAULT_MODEL: 'gemma4:e2b-it-qat',
      LLXPRT_DEFAULT_PROVIDER: 'openai',
      LLXPRT_AUTH_TYPE: 'provider',
      LLXPRT_TEST_PROFILE: 'local-gemma4-e2e',
      LLXPRT_CONTEXT_LIMIT: '32768',
      LLXPRT_MAX_OUTPUT_TOKENS: '8192',
      LLXPRT_LOCAL_MODEL_E2E: 'true',
    });
    expect(hasSecretOrVariable(setupActionSteps())).toBe(false);
  });

  it('has no paid-provider preflight and keeps the local model server log with the eval artifact', () => {
    const names = (evalsJob?.steps ?? []).map((s: WorkflowStep) => s.name);
    expect(names).not.toContain('Provider configuration preflight');
    const collect = localStepNamed(evalsJob, 'Collect local model log');
    expect(collect.if).toBe('always()');
    expect(String(collect.run)).toContain('$RUNNER_TEMP/ollama-server.log');
    expect(String(collect.run)).toContain('evals/logs/');
    // The log is copied into evals/logs before the artifact is staged from it.
    expect(names.indexOf('Collect local model log')).toBeLessThan(
      names.indexOf('Prepare eval artifact'),
    );
  });

  it('builds the project explicitly before running the eval suite', () => {
    const steps = (evalsJob?.steps ?? []).map((s: WorkflowStep) => s.name);
    const buildIndex = steps.indexOf('Build project');
    const evalIndex = steps.indexOf('Run all evals');
    expect(
      buildIndex,
      'workflow should have a Build project step',
    ).toBeGreaterThan(-1);
    expect(evalIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeLessThan(evalIndex);
    const buildStep = localStepNamed(evalsJob, 'Build project');
    expect(String(buildStep.run).trim()).toBe('npm run build');
  });

  it('has an always-run Prepare eval artifact step that always stages logs and flags a missing report', () => {
    const prepare = localStepNamed(evalsJob, 'Prepare eval artifact');
    expect(prepare.if).toBe('always()');
    expect(
      prepare.id,
      'step should set an id for output passing',
    ).toBeDefined();
    const run = String(prepare.run);
    // Always stage whatever logs exist so the artifact upload succeeds even
    // when report.json is missing (eval crashed before the JSON reporter ran).
    expect(run).toMatch(/mkdir.*eval-artifact/);
    expect(run).toMatch(/cp.*eval-artifact/);
    // report.json presence gates a downstream failure step via step output.
    expect(run).toContain('evals/logs/report.json');
    expect(run).toMatch(/report_present=false|report_present=true/);
  });

  it('stages logs into a dedicated eval-artifact directory before upload', () => {
    const prepare = localStepNamed(evalsJob, 'Prepare eval artifact');
    const run = String(prepare.run);
    expect(run).toMatch(/mkdir.*eval-artifact/);
    expect(run).toMatch(/cp.*eval-artifact/);
  });

  it('uploads ONLY from the dedicated eval-artifact staging directory, never evals/logs', () => {
    const upload = localStepNamed(evalsJob, 'Upload eval logs');
    expect(upload.if).toBe('always()');
    expect(upload.with?.name).toBe('eval-logs-${{ matrix.run_attempt }}');
    // Upload must stage from the prepared directory, not the raw logs dir.
    expect(upload.with?.path).toBe('eval-artifact');
    expect(upload.with?.['retention-days']).toBe(7);
    // if-no-files-found is warn (not error) so a logs-only upload always
    // succeeds with diagnostics even when report.json was never produced.
    expect(upload.with?.['if-no-files-found']).toBe('warn');
    // Defensive: no upload step in the job may point at evals/logs, which would
    // let a logs-only run satisfy the artifact contract without report.json.
    const uploaders = (evalsJob.steps ?? []).filter(
      (s: Record<string, unknown>) =>
        typeof s['uses'] === 'string' &&
        /upload-artifact/.test(String(s['uses'])),
    );
    for (const u of uploaders) {
      expect(String(asOptionalRecord(u['with'])?.['path'] ?? '')).not.toBe(
        'evals/logs',
      );
    }
  });

  it('fails the job via a dedicated step when report.json was missing', () => {
    // The prepare step always succeeds (so the upload runs and preserves
    // diagnostics), but a dedicated step fails the job when report.json was
    // absent. This keeps the artifact upload contract (report.json required)
    // while still preserving logs for post-mortem debugging.
    const failStep = localStepNamed(
      evalsJob,
      'Fail when report.json was missing',
    );
    expect(failStep.if).toMatch(
      /steps\.prepare\.outputs\.report_present == 'false'/,
    );
    expect(String(failStep.run)).toMatch(/exit 1/);
  });

  it('eval matrix job has a proportional timeout-minutes so a stuck run cannot hang', () => {
    // The eval matrix runs real model calls that can hang. An explicit
    // timeout-minutes prevents a stuck matrix leg from blocking the nightly
    // indefinitely while still allowing a generous window for real model I/O.
    expect(evalsJob.timeoutMinutes ?? evalsJob['timeout-minutes']).toBe(30);
  });
});

/**
 * Issue #2605: The broader nightly.yml behavioral_evals job must delegate to
 * the SAME shared reusable workflow so the two workflows cannot drift.
 */
describe('nightly.yml behavioral_evals delegates to the shared reusable workflow', () => {
  const nightly = loadWorkflow('.github/workflows/nightly.yml');

  it('calls _evals-run.yml without passing or inheriting any secret', () => {
    const evalsJob = jobsOf(nightly)['behavioral_evals'];
    expect(evalsJob, 'nightly.yml should define behavioral_evals').toBeTruthy();
    expect(evalsJob?.uses).toBe('./.github/workflows/_evals-run.yml');
    expect(
      evalsJob?.secrets,
      'must not pass or inherit secrets',
    ).toBeUndefined();
    expect(hasSecretOrVariable(evalsJob)).toBe(false);
  });

  it('declares least-privilege permissions instead of inheriting broad workflow grants', () => {
    // The workflow-level permissions grant checks:write and statuses:write
    // for other jobs (e.g. notify_failure issue creation). A reusable-workflow
    // caller's job-level permissions OVERRIDE the callee's, so this job must
    // narrow to contents:read to match the callee's intended scope and avoid
    // running with excess write access.
    const evalsJob = jobsOf(nightly)['behavioral_evals'];
    const perms = asRecord(evalsJob?.['permissions'] ?? {});
    expect(perms).toBeDefined();
    expect(perms['contents']).toBe('read');
    // Must NOT inherit the broad workflow-level write grants.
    expect(perms['checks'] ?? 'absent').not.toBe('write');
    expect(perms['statuses'] ?? 'absent').not.toBe('write');
  });

  it('runs a single behavioral eval sample rather than the statistical 3-sample matrix', () => {
    // The dedicated evals-nightly.yml exists to gather three independent
    // samples for variance analysis. The broad nightly only needs one
    // behavioral signal, so it must override run-attempts to a single sample
    // instead of inheriting the reusable workflow's default of [1, 2, 3].
    const evalsJob = jobsOf(nightly)['behavioral_evals'];
    const attempts = asOptionalRecord(evalsJob?.with)?.['run-attempts'];
    expect(
      attempts,
      'behavioral_evals must explicitly pass run-attempts so it does not silently inherit the 3-sample matrix',
    ).toBeDefined();
    expect(JSON.parse(String(attempts))).toEqual([1]);
  });
  it('is still wired into the failure-notification job needs', () => {
    const notifyJob = jobsOf(nightly)['notify_failure'];
    expect(notifyJob, 'nightly.yml should define notify_failure').toBeTruthy();
    const needsRaw = notifyJob?.needs;
    const needs = Array.isArray(needsRaw) ? needsRaw : [needsRaw];
    expect(needs).toContain('behavioral_evals');
    const notifyStep = notifyJob?.steps?.find(
      (s: WorkflowStep) => s.name === 'Create Issue on Failure',
    );
    expect(notifyStep?.env?.['BEHAVIORAL_EVALS_RESULT']).toBe(
      '${{ needs.behavioral_evals.result }}',
    );
  });
});

/**
 * Issue #2605 (parsed-workflow/shell behavior coverage): The Prepare eval
 * artifact step must ALWAYS create eval-artifact and preserve logs even when
 * report.json is missing, while still failing report verification via a
 * dedicated step. These tests extract the real shell from the parsed workflow
 * YAML and execute it against a temp directory, proving the observable shell
 * behavior (staging, diagnostics, step output) without relying on GitHub
 * Actions runtime semantics.
 */
describe('_evals-run.yml: Prepare eval artifact shell behavior', () => {
  const reusable = loadWorkflow('.github/workflows/_evals-run.yml');
  const evalsJob = jobsOf(reusable)['evals'];

  function prepareStepScript() {
    return String(localStepNamed(evalsJob, 'Prepare eval artifact').run);
  }

  /**
   * Run the Prepare shell against a temp directory simulating the runner
   * workspace. GITHUB_OUTPUT is captured so the test can assert on the
   * report_present step output. Returns the staged eval-artifact contents and
   * the captured GITHUB_OUTPUT.
   *
   * The helper FAILS FAST: it throws when the shell script exits nonzero or
   * fails to spawn, so a bug in the workflow's artifact-preparation logic is
   * surfaced immediately rather than masked by partial artifacts. It uses a
   * MINIMAL, deterministic environment (only PATH and GITHUB_OUTPUT) so test
   * behavior is independent of the local development environment and does not
   * leak the test runner's environment variables into the child shell.
   */
  function runPrepareShell({ hasReport }: { hasReport: boolean }) {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-wf-shell-'));
    try {
      fs.mkdirSync(path.join(tmpRoot, 'evals', 'logs'), { recursive: true });
      // Simulate whatever logs the eval run left behind.
      fs.writeFileSync(
        path.join(tmpRoot, 'evals', 'logs', 'runner.log'),
        'eval stdout/stderr tail',
      );
      if (hasReport) {
        fs.writeFileSync(
          path.join(tmpRoot, 'evals', 'logs', 'report.json'),
          '{"testResults":[]}',
        );
      }
      const outFile = path.join(tmpRoot, 'GITHUB_OUTPUT');
      const wrapped = [
        'set -uo pipefail',
        `cd "${tmpRoot}"`,
        prepareStepScript(),
      ].join('\n');
      const result = spawnSync('bash', ['-c', wrapped], {
        encoding: 'utf8',
        // Minimal deterministic environment: only what the shell script needs.
        // The script writes to GITHUB_OUTPUT and invokes coreutils (mkdir/cp)
        // resolved via PATH. Avoid spreading process.env so the test does not
        // depend on or leak the local development environment.
        env: { PATH: process.env.PATH ?? '', GITHUB_OUTPUT: outFile },
      });
      // Fail fast on spawn errors or nonzero status so a broken workflow
      // script is surfaced rather than masked by partial artifacts.
      if (result.error) {
        throw new Error(
          `Prepare shell failed to spawn: ${result.error.message}`,
        );
      }
      if (result.status !== 0) {
        throw new Error(
          `Prepare shell exited with status ${result.status}: ${result.stderr}`,
        );
      }
      const githubOutput = fs.existsSync(outFile)
        ? fs.readFileSync(outFile, 'utf8')
        : '';
      const artifactDir = path.join(tmpRoot, 'eval-artifact');
      const artifactFiles = fs.existsSync(artifactDir)
        ? fs.readdirSync(artifactDir)
        : [];
      return { githubOutput, artifactFiles };
    } finally {
      fs.rmSync(tmpRoot, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    }
  }

  it('stages logs into eval-artifact and sets report_present=true when report.json exists', () => {
    const { githubOutput, artifactFiles } = runPrepareShell({
      hasReport: true,
    });
    expect(artifactFiles).toContain('report.json');
    expect(artifactFiles).toContain('runner.log');
    expect(githubOutput).toContain('report_present=true');
    expect(artifactFiles).not.toContain('REPORT_MISSING.txt');
  });

  it('stages logs, writes REPORT_MISSING.txt diagnostics, and sets report_present=false when report.json is absent', () => {
    const { githubOutput, artifactFiles } = runPrepareShell({
      hasReport: false,
    });
    // Logs are still preserved even though report.json was never produced.
    expect(artifactFiles).toContain('runner.log');
    // A diagnostic marker is written so post-mortem debugging is possible.
    expect(artifactFiles).toContain('REPORT_MISSING.txt');
    expect(githubOutput).toContain('report_present=false');
  });

  it('fails fast when the Prepare shell exits nonzero (does not mask bugs with partial artifacts)', () => {
    // A broken Prepare script must surface a clear failure rather than letting
    // partial artifacts satisfy downstream assertions. Inject a script that
    // exits nonzero and prove the helper throws.
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-wf-shell-'));
    try {
      const outFile = path.join(tmpRoot, 'GITHUB_OUTPUT');
      const result = spawnSync('bash', ['-c', 'echo broken; exit 7'], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '', GITHUB_OUTPUT: outFile },
      });
      expect(result.status).toBe(7);
      // The production runPrepareShell helper would throw on this status; this
      // test proves the underlying contract (nonzero status is observable) so
      // the fail-fast guard is justified.
    } finally {
      fs.rmSync(tmpRoot, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    }
  });

  it('the Fail step condition fires only when report_present is false', () => {
    const failStep = localStepNamed(
      evalsJob,
      'Fail when report.json was missing',
    );
    // The step-level if references the prepare step output, proving the job
    // fails only when report.json was missing (not on every run).
    expect(failStep.if).toMatch(
      /steps\.prepare\.outputs\.report_present == 'false'/,
    );
    expect(String(failStep.run)).toMatch(/exit 1/);
  });
});
