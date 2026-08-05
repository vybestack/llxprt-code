/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #342: skip heavy CI jobs on docs-only changes.
 *
 * The heavy build/packaging/smoke tier gains a `docs_only` gate, and the
 * required `Test` and `Lint` aggregators stay honest (green on docs-only,
 * red on code PRs). These tests pin both the static workflow wiring and the
 * real aggregator bash by extracting the committed `run:` script and feeding
 * it substituted `needs` values via positional parameters (the same harness
 * as ci-acplint-workflow.test.ts), so the logic under test is the actual
 * workflow code, not a re-implementation.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { describe, it, expect, beforeAll } from 'bun:test';
import type { WorkflowDocument, WorkflowJob } from './typed-test-helpers.ts';
import { parseWorkflowYaml } from './typed-test-helpers.ts';
import {
  readRootFile,
  stepNamed,
  normalize,
} from './ocr-review-workflow-helpers.ts';

const HEAVY_JOBS = [
  'bun_install_smoke',
  'bun_native_modules_smoke',
  'node_consumer_smoke',
  'bun_test_orchestrator_smoke',
  'bun_native_test_parity',
  'acp_conformance',
] as const;

// The exact `if:` condition every heavy job must declare (normalized). The
// full string is asserted, not just a substring, so a stray extra/missing
// clause fails loudly (issue #342).
const EXPECTED_HEAVY_IF =
  "${{ needs.doc_change_filter.outputs.docs_only != 'true' && needs.skip_check.outputs.should_skip != 'true' }}";

// Cheap jobs that must keep running even on docs-only PRs (docs are still
// linted and workflow YAML is still actionlint'ed).
const UNGATED_JOBS = [
  'lint_github_actions',
  'lint_javascript',
  'lint_shell',
  'lint_yaml',
  'shard_selector',
  'codeql',
] as const;

function loadCiWorkflow(): WorkflowDocument {
  const source = readRootFile('.github/workflows/ci.yml');
  return parseWorkflowYaml(source);
}

function jobNeeds(job: WorkflowJob | undefined): string[] {
  const needs = job?.needs;
  if (needs === undefined) return [];
  return Array.isArray(needs) ? [...needs] : [needs];
}

/**
 * Runs a real aggregator `run:` script with each `'${{ needs.* }}'` literal
 * replaced by a positional parameter, then passes the values as bash args so
 * shell metacharacters in a job result can never be evaluated.
 *
 * `expressions` and `values` are positional: `expressions[i]` is replaced by
 * `"$(i+1)"` and receives `values[i]`.
 */
function runAggregateScript(
  runText: string,
  expressions: readonly string[],
  values: readonly string[],
): SpawnSyncReturns<string> {
  let script = runText;
  expressions.forEach((expression, index) => {
    script = script.replaceAll(expression, `"$${index + 1}"`);
  });
  return spawnSync('bash', ['-c', script, '--', ...values], {
    encoding: 'utf8',
  });
}

interface TestAggregateResults {
  shouldSkip: string;
  docsOnly: string;
  selector: string;
  hasTests: string;
  shards: string;
  nodeConsumerSmoke: string;
  acp: string;
}

const TEST_AGGREGATE_EXPRESSIONS = [
  "'${{ needs.skip_check.outputs.should_skip }}'",
  "'${{ needs.doc_change_filter.outputs.docs_only }}'",
  "'${{ needs.shard_selector.result }}'",
  "'${{ needs.shard_selector.outputs.has_tests }}'",
  "'${{ needs.test_shard.result }}'",
  "'${{ needs.node_consumer_smoke.result }}'",
  "'${{ needs.acp_conformance.result }}'",
] as const;

/** Runs the real `test` aggregator "Check shard results" script. */
function runTestAggregate(
  runText: string,
  results: TestAggregateResults,
): SpawnSyncReturns<string> {
  return runAggregateScript(runText, TEST_AGGREGATE_EXPRESSIONS, [
    results.shouldSkip,
    results.docsOnly,
    results.selector,
    results.hasTests,
    results.shards,
    results.nodeConsumerSmoke,
    results.acp,
  ]);
}

interface LintAggregateResults {
  shouldSkip: string;
  docsOnly: string;
  lintGithubActions: string;
  lintJavascript: string;
  lintShell: string;
  lintYaml: string;
  nodeConsumerSmoke: string;
}

const LINT_AGGREGATE_EXPRESSIONS = [
  "'${{ needs.skip_check.outputs.should_skip }}'",
  "'${{ needs.doc_change_filter.outputs.docs_only }}'",
  "'${{ needs.lint_github_actions.result }}'",
  "'${{ needs.lint_javascript.result }}'",
  "'${{ needs.lint_shell.result }}'",
  "'${{ needs.lint_yaml.result }}'",
  "'${{ needs.node_consumer_smoke.result }}'",
] as const;

/** Runs the real `lint` aggregator "Check lint results" script. */
function runLintAggregate(
  runText: string,
  results: LintAggregateResults,
): SpawnSyncReturns<string> {
  return runAggregateScript(runText, LINT_AGGREGATE_EXPRESSIONS, [
    results.shouldSkip,
    results.docsOnly,
    results.lintGithubActions,
    results.lintJavascript,
    results.lintShell,
    results.lintYaml,
    results.nodeConsumerSmoke,
  ]);
}

describe('Issue #342: skip heavy CI jobs on docs-only changes', () => {
  let jobs: Record<string, WorkflowJob>;

  beforeAll(() => {
    const workflow = loadCiWorkflow();
    jobs = workflow['jobs']!;
  });

  describe('static workflow wiring', () => {
    it('each heavy job needs doc_change_filter', () => {
      for (const jobName of HEAVY_JOBS) {
        const needs = jobNeeds(jobs[jobName]);
        expect(needs, `${jobName} should need doc_change_filter`).toContain(
          'doc_change_filter',
        );
      }
    });

    it('each heavy job declares the exact docs_only + should_skip if condition', () => {
      for (const jobName of HEAVY_JOBS) {
        const condition = normalize(jobs[jobName]?.if);
        expect(
          condition,
          `${jobName} if should equal the shared docs_only + should_skip condition`,
        ).toBe(EXPECTED_HEAVY_IF);
      }
    });

    it('cheap jobs (linters, shard_selector, codeql) gain no docs_only gate', () => {
      for (const jobName of UNGATED_JOBS) {
        const condition = jobs[jobName]?.if ?? '';
        expect(
          condition,
          `${jobName} must not gain a docs_only gate`,
        ).not.toContain('doc_change_filter.outputs.docs_only');
      }
    });

    it('doc_change_filter invokes the committed scripts/docs-only-filter.ts', () => {
      const detect = stepNamed(
        jobs['doc_change_filter'],
        'Determine documentation-only PR',
      );
      expect(detect.run ?? '').toContain('scripts/docs-only-filter.ts');
    });

    it('doc_change_filter emits docs_only=false on non-PR events', () => {
      const detect = stepNamed(
        jobs['doc_change_filter'],
        'Determine documentation-only PR',
      );
      const script = detect.run ?? '';
      // The PR_NUMBER-empty branch is the non-PR fallback (push, merge_group,
      // workflow_dispatch) and must emit docs_only=false so heavy jobs run.
      expect(script).toContain('-z "${PR_NUMBER:-}"');
      expect(script).toContain('docs_only=false');
    });

    it('lint aggregator declares if: always()', () => {
      expect(jobs['lint']?.if).toContain('always()');
    });
  });

  describe('Test aggregator behaviour (real bash)', () => {
    let testCheckRun: string;

    beforeAll(() => {
      testCheckRun = stepNamed(jobs['test'], 'Check shard results').run ?? '';
    });

    it('docs-only PR is green when selector succeeds, has_tests=false, and the docs-only-skippable jobs are skipped', () => {
      // There is no unconditional docs-only early return (issue #342): the
      // selector still must succeed, and the two docs-only-skippable jobs
      // (node_consumer_smoke, acp_conformance) accept a `skipped` result only
      // because docs_only == 'true'.
      const result = runTestAggregate(testCheckRun, {
        shouldSkip: 'false',
        docsOnly: 'true',
        selector: 'success',
        hasTests: 'false',
        shards: 'skipped',
        nodeConsumerSmoke: 'skipped',
        acp: 'skipped',
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        'node_consumer_smoke intentionally skipped',
      );
      expect(result.stdout).toContain('acp_conformance intentionally skipped');
    });

    it('docs-only PR is red when the selector reports tests but test_shard is skipped (selector still gates)', () => {
      // Proves docs_only == 'true' does NOT bypass the shard selector: when
      // the selector says has_tests=true, a skipped test_shard is still red.
      const result = runTestAggregate(testCheckRun, {
        shouldSkip: 'false',
        docsOnly: 'true',
        selector: 'success',
        hasTests: 'true',
        shards: 'skipped',
        nodeConsumerSmoke: 'skipped',
        acp: 'skipped',
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        'Test shards did not all succeed (result: skipped)',
      );
    });

    it('docs-only PR is red when node_consumer_smoke fails (not just skipped)', () => {
      // The exemption only accepts `skipped`; an actual failure is still red.
      const result = runTestAggregate(testCheckRun, {
        shouldSkip: 'false',
        docsOnly: 'true',
        selector: 'success',
        hasTests: 'false',
        shards: 'skipped',
        nodeConsumerSmoke: 'failure',
        acp: 'skipped',
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        'Node Consumer Smoke did not succeed (result: failure)',
      );
    });

    it('code PR with node_consumer_smoke=failure is red', () => {
      const result = runTestAggregate(testCheckRun, {
        shouldSkip: 'false',
        docsOnly: 'false',
        selector: 'success',
        hasTests: 'true',
        shards: 'success',
        nodeConsumerSmoke: 'failure',
        acp: 'success',
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        'Node Consumer Smoke did not succeed (result: failure)',
      );
    });

    it('code PR with acp_conformance=failure is red', () => {
      const result = runTestAggregate(testCheckRun, {
        shouldSkip: 'false',
        docsOnly: 'false',
        selector: 'success',
        hasTests: 'true',
        shards: 'success',
        nodeConsumerSmoke: 'success',
        acp: 'failure',
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        'ACP conformance job did not succeed (result: failure)',
      );
    });

    it('code PR with test_shard=skipped and has_tests=true is red', () => {
      const result = runTestAggregate(testCheckRun, {
        shouldSkip: 'false',
        docsOnly: 'false',
        selector: 'success',
        hasTests: 'true',
        shards: 'skipped',
        nodeConsumerSmoke: 'success',
        acp: 'success',
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        'Test shards did not all succeed (result: skipped)',
      );
    });

    it('does not evaluate shell syntax injected via a result value', () => {
      const sentinel = 'TEST_AGGREGATE_SHELL_INJECTION';
      const nodeConsumerSmoke = `failure'; printf '${sentinel}' >&2; #`;
      const result = runTestAggregate(testCheckRun, {
        shouldSkip: 'false',
        docsOnly: 'false',
        selector: 'success',
        hasTests: 'false',
        shards: 'skipped',
        nodeConsumerSmoke,
        acp: 'success',
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        `Node Consumer Smoke did not succeed (result: ${nodeConsumerSmoke})`,
      );
      expect(result.stderr).not.toContain(sentinel);
    });
  });

  describe('Lint aggregator behaviour (real bash)', () => {
    let lintCheckRun: string;

    beforeAll(() => {
      lintCheckRun = stepNamed(jobs['lint'], 'Check lint results').run ?? '';
    });

    it('docs-only run accepts a skipped node_consumer_smoke', () => {
      const result = runLintAggregate(lintCheckRun, {
        shouldSkip: 'false',
        docsOnly: 'true',
        lintGithubActions: 'success',
        lintJavascript: 'success',
        lintShell: 'success',
        lintYaml: 'success',
        nodeConsumerSmoke: 'skipped',
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('All linters finished!');
    });

    it('code PR rejects a skipped node_consumer_smoke', () => {
      const result = runLintAggregate(lintCheckRun, {
        shouldSkip: 'false',
        docsOnly: 'false',
        lintGithubActions: 'success',
        lintJavascript: 'success',
        lintShell: 'success',
        lintYaml: 'success',
        nodeConsumerSmoke: 'skipped',
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        'Node Consumer Smoke did not succeed (result: skipped)',
      );
    });

    it('a failing linter is red even on a docs-only PR', () => {
      const result = runLintAggregate(lintCheckRun, {
        shouldSkip: 'false',
        docsOnly: 'true',
        lintGithubActions: 'success',
        lintJavascript: 'failure',
        lintShell: 'success',
        lintYaml: 'success',
        nodeConsumerSmoke: 'skipped',
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        'JavaScript lint did not succeed (result: failure)',
      );
    });

    it('should_skip=true is green by design', () => {
      const result = runLintAggregate(lintCheckRun, {
        shouldSkip: 'true',
        docsOnly: 'false',
        lintGithubActions: 'skipped',
        lintJavascript: 'skipped',
        lintShell: 'skipped',
        lintYaml: 'skipped',
        nodeConsumerSmoke: 'skipped',
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('green by design');
    });

    it('does not evaluate shell syntax injected via a result value', () => {
      const sentinel = 'LINT_AGGREGATE_SHELL_INJECTION';
      const lintJavascript = `failure'; printf '${sentinel}' >&2; #`;
      const result = runLintAggregate(lintCheckRun, {
        shouldSkip: 'false',
        docsOnly: 'false',
        lintGithubActions: 'success',
        lintJavascript,
        lintShell: 'success',
        lintYaml: 'success',
        nodeConsumerSmoke: 'success',
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        `JavaScript lint did not succeed (result: ${lintJavascript})`,
      );
      expect(result.stderr).not.toContain(sentinel);
    });
  });
});
