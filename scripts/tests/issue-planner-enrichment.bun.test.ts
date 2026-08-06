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
// These run under Bun's native runner via the scripts-tests root (see
// scripts/bun-test-manifest.ts).

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

/**
 * Assert that a command is wrapped in an `if !` guard whose condition
 * terminates at "; then". Uses plain string indices (not a regex spanning
 * newlines), so the assertion ties the flag to its specific guard and fails
 * if the flag is relocated to a different command. When `flag` is empty, only
 * the guard prefix and its "; then" terminator are checked.
 */
function expectFlagWithinGuard(
  script: string,
  guardPrefix: string,
  flag = '',
): void {
  const guardStart = script.indexOf(guardPrefix);
  expect(guardStart).toBeGreaterThanOrEqual(0);
  const thenIdx = script.indexOf('; then', guardStart);
  expect(thenIdx).toBeGreaterThanOrEqual(0);
  if (flag !== '') {
    const flagIdx = script.indexOf(flag, guardStart);
    expect(flagIdx).toBeGreaterThan(guardStart);
    expect(flagIdx).toBeLessThan(thenIdx);
  }
}

describe('issue-planner advisory-enrichment non-fatality (#2984)', () => {
  it('guards --extract-linked-references with an if-fallback (#2984)', () => {
    const script = loadStepScript(
      'Extract linked references and fetch linked issues',
    );
    // The helper invocation must be wrapped so a non-zero exit degrades to an
    // empty reference list instead of aborting under set -e. Anchoring the
    // flag between "if ! bun" and "; then" proves it belongs to the guarded
    // command and cannot pass if the flag is relocated elsewhere.
    expectFlagWithinGuard(script, 'if ! bun', '--extract-linked-references');
    expect(script).toContain('::warning::');
    expect(script).toContain("printf '' > planner/linked-references.txt");
  });

  it('guards --extract-feedback with an if-fallback (#2984)', () => {
    const script = loadStepScript('Extract /plan feedback');
    expectFlagWithinGuard(script, 'if ! bun', '--extract-feedback');
    expect(script).toContain('::warning::');
    expect(script).toContain("printf '' > planner/feedback.txt");
  });

  it('does not weaken the related-candidate step guards (#2972 regression)', () => {
    const script = loadStepScript('Precompute related PRs/issues candidates');
    expectFlagWithinGuard(script, 'if ! bun', '--build-search-query');
    expectFlagWithinGuard(script, 'if ! gh search prs');
    expectFlagWithinGuard(script, 'if ! gh search issues');
  });

  it('keeps essential steps fatal (no blanket suppression)', () => {
    const gather = loadStepScript('Gather issue metadata');
    expect(gather).not.toContain('|| true');
    expect(gather).not.toContain('2>/dev/null');
    // Essential steps must not be wrapped in the same `if !` guard that makes
    // advisory enrichment non-fatal — that would silently swallow their errors.
    expect(gather).not.toMatch(/if\s+!/);
    const render = loadStepScript('Render planner context and instructions');
    expect(render).not.toContain('|| true');
    expect(render).not.toContain('2>/dev/null');
    expect(render).not.toMatch(/if\s+!/);
  });
});
