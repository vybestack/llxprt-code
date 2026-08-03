/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Bun-native regression tests for the issue-planner advisory-enrichment
// steps (umbrella #2984, criterion: "Optional enrichment failures cannot
// fail the run"). The `--extract-linked-references` and `--extract-feedback`
// helper invocations previously ran unguarded under `set -euo pipefail`, so a
// failure in either advisory step aborted the whole run. They are now wrapped
// in `if !` guards that degrade to empty output with a `::warning::`, matching
// the pattern established for the related-candidate step (#2972).
//
// These run under Bun's native runner (see scripts/bun-test-manifest.ts);
// vitest skips `*.bun.test.ts` files (see scripts/tests/vitest.config.ts).

import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  asString,
  findStep,
  parseWorkflowYaml,
  workflowJob,
} from './typed-test-helpers.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const WORKFLOW_PATH = '.github/workflows/issue-planner.yml';

function loadStepScript(stepName: string): string {
  const source = fs.readFileSync(path.join(ROOT, WORKFLOW_PATH), 'utf8');
  const workflow = parseWorkflowYaml(source);
  const planJob = workflowJob(workflow, 'plan');
  const step = findStep(planJob, stepName);
  if (!step?.run) {
    throw new Error(
      `Step "${stepName}" (or its run script) not found in ${WORKFLOW_PATH}; the step may have been renamed.`,
    );
  }
  return asString(step.run);
}

describe('issue-planner advisory-enrichment non-fatality (#2984)', () => {
  it('guards --extract-linked-references with an if-fallback (#2984)', () => {
    const script = loadStepScript(
      'Extract linked references and fetch linked issues',
    );
    // The helper invocation must be wrapped so a non-zero exit degrades to an
    // empty reference list instead of aborting under set -e.
    expect(script).toMatch(/if\s+!\s+bun[\s\S]*?--extract-linked-references/);
    expect(script).toContain('::warning::');
    expect(script).toContain("printf '' > planner/linked-references.txt");
  });

  it('guards --extract-feedback with an if-fallback (#2984)', () => {
    const script = loadStepScript('Extract /plan feedback');
    expect(script).toMatch(/if\s+!\s+bun[\s\S]*?--extract-feedback/);
    expect(script).toContain('::warning::');
    expect(script).toContain("printf '' > planner/feedback.txt");
  });

  it('does not weaken the related-candidate step guards (#2972 regression)', () => {
    const script = loadStepScript('Precompute related PRs/issues candidates');
    expect(script).toMatch(/if\s+!\s+bun[\s\S]*?--build-search-query/);
    expect(script).toMatch(/if\s+!\s+gh\s+search\s+prs/);
  });

  it('keeps essential steps fatal (no blanket suppression)', () => {
    const gather = loadStepScript('Gather issue metadata');
    expect(gather).not.toContain('|| true');
    expect(gather).not.toContain('2>/dev/null');
    const render = loadStepScript('Render planner context and instructions');
    expect(render).not.toContain('|| true');
  });
});
