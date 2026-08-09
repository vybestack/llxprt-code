/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * E2E workflow docs-only gating wiring tests (issue #2693).
 *
 * These read the REAL .github/workflows/e2e.yml through existing typed test
 * helpers and assert that the e2e_doc_change_filter job invokes the committed
 * scripts/docs-only-filter.ts policy (with structured file entries and the
 * authoritative changed-file count) instead of maintaining an inline
 * extension allowlist.
 *
 * Per REQ-2693-005:
 * - runtime/package Markdown or text, expected-output text fixtures,
 *   .github/**, scripts/**, unknown paths, truncated results, and
 *   code-to-doc renames run E2E
 * - genuine docs-only changes skip only heavyweight E2E jobs
 * - non-PR events continue to run E2E
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseWorkflowYaml,
  workflowJob,
  asOptionalRecord,
  type WorkflowDocument,
  type WorkflowStep,
} from './typed-test-helpers.ts';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const WORKFLOW_PATH = resolve(repoRoot, '.github', 'workflows', 'e2e.yml');

function loadWorkflow(): WorkflowDocument {
  return parseWorkflowYaml(readFileSync(WORKFLOW_PATH, 'utf8'));
}

function detectStep(workflow: WorkflowDocument): WorkflowStep {
  const job = workflowJob(workflow, 'e2e_doc_change_filter');
  const steps = job.steps ?? [];
  const step = steps.find((s) => s.id === 'detect');
  if (step === undefined) {
    throw new Error('e2e_doc_change_filter should have a step with id: detect');
  }
  return step;
}

describe('e2e.yml: e2e_doc_change_filter invokes shared docs-only classifier', () => {
  let workflow: WorkflowDocument;
  let stepRun: string;

  beforeAll(() => {
    workflow = loadWorkflow();
    stepRun = detectStep(workflow).run ?? '';
  });

  it('invokes scripts/docs-only-filter.ts (not an inline extension classifier)', () => {
    expect(stepRun).toContain('scripts/docs-only-filter.ts');
  });

  it('passes structured file entries (NDJSON, not filenames-only)', () => {
    // The shared classifier requires structured entries (status,
    // previous_filename, patch) for rename and .gitignore handling.
    // The workflow must fetch '.[]' (full entries), not '.[].filename'.
    expect(stepRun).toContain('--jq');
    expect(stepRun).toMatch(/'\.\[\]'/);
  });

  it('passes the authoritative changed_files count', () => {
    expect(stepRun).toContain('--changed-files');
  });

  it('uses github-actions output mode', () => {
    expect(stepRun).toContain('--output github-actions');
  });

  it('does NOT use an inline case-based extension classifier', () => {
    // The old inline policy used a case statement matching extensions.
    // It must be removed in favor of the shared classifier.
    expect(stepRun).not.toMatch(/case\s+"\$file"/);
    expect(stepRun).not.toContain('*.mdx|*.rst|*.txt|*.adoc');
  });
});

describe('e2e.yml: non-PR events run full E2E', () => {
  let stepRun: string;

  beforeAll(() => {
    stepRun = detectStep(loadWorkflow()).run ?? '';
  });

  it('the detect step emits docs_only=false for non-PR events', () => {
    expect(stepRun).toContain('docs_only=false');
  });
});

describe('e2e.yml: heavy jobs gate on docs_only', () => {
  let workflow: WorkflowDocument;

  beforeAll(() => {
    workflow = loadWorkflow();
  });

  it('e2e_linux uses docs_only in the skip condition', () => {
    const job = workflowJob(workflow, 'e2e_linux');
    const condition = job.if ?? '';
    expect(condition).toContain('docs_only');
  });

  it('e2e_mac uses docs_only in the skip condition', () => {
    const job = workflowJob(workflow, 'e2e_mac');
    const condition = job.if ?? '';
    expect(condition).toContain('docs_only');
  });

  it('e2e_doc_change_filter outputs docs_only', () => {
    const job = workflowJob(workflow, 'e2e_doc_change_filter');
    const outputs = asOptionalRecord(job['outputs']);
    expect(outputs?.['docs_only']).toBeDefined();
  });
});

describe('e2e.yml: e2e_doc_change_filter has a short timeout', () => {
  let workflow: WorkflowDocument;

  beforeAll(() => {
    workflow = loadWorkflow();
  });

  it('e2e_doc_change_filter has timeout-minutes: 5', () => {
    const job = workflowJob(workflow, 'e2e_doc_change_filter');
    const timeout = job['timeout-minutes'];
    expect(typeof timeout).toBe('number');
    expect(timeout as number).toBe(5);
  });
});

/**
 * Truth-table behavioral wiring test for the E2E docs-only skip gate
 * (Finding 3).
 *
 * The heavy E2E jobs must run in ALL of these cases:
 *  - detector success + docs_only=false
 *  - detector failure (non-success result)
 *  - detector skipped
 *  - detector missing docs_only output
 * The heavy E2E jobs must SKIP only when:
 *  - detector success + docs_only exactly 'true'
 *  - cancelled
 *  - duplicate suppression (should_skip=true)
 *
 * We verify this by checking the logical structure of the if: condition:
 * the negated conjunction `!(result == 'success' && docs_only == 'true')`
 * means a detector failure does NOT block the rest of the condition.
 */
describe('e2e.yml: docs-only is the ONLY detector-based skip (fail-closed gate)', () => {
  let linuxCondition: string;
  let macCondition: string;

  beforeAll(() => {
    const workflow = loadWorkflow();
    linuxCondition = workflowJob(workflow, 'e2e_linux').if ?? '';
    macCondition = workflowJob(workflow, 'e2e_mac').if ?? '';
  });

  it('e2e_linux uses negated conjunction (not standalone result == success gate)', () => {
    // The OLD broken pattern required `result == 'success'` as a standalone
    // AND clause: `... result == 'success' && docs_only != 'true' ...`.
    // The FIX negates the conjunction: `!(... result == 'success' && ... == 'true')`.
    // This single structural regex proves BOTH conditions live inside ONE
    // `!(...)` grouping joined by `&&` — independent regexes would also pass
    // if the conditions were split into separate top-level clauses.
    expect(linuxCondition).toMatch(
      /!\(\s*needs\.e2e_doc_change_filter\.result\s*==\s*'success'\s*&&\s*needs\.e2e_doc_change_filter\.outputs\.docs_only\s*==\s*'true'\s*\)/,
    );
  });

  it('e2e_mac uses negated conjunction (not standalone result == success gate)', () => {
    expect(macCondition).toMatch(
      /!\(\s*needs\.e2e_doc_change_filter\.result\s*==\s*'success'\s*&&\s*needs\.e2e_doc_change_filter\.outputs\.docs_only\s*==\s*'true'\s*\)/,
    );
  });

  it('e2e_linux preserves !cancelled()', () => {
    expect(linuxCondition).toMatch(/!cancelled\(\)/);
  });

  it('e2e_mac preserves !cancelled()', () => {
    expect(macCondition).toMatch(/!cancelled\(\)/);
  });

  it('e2e_linux preserves should_skip != true (duplicate suppression)', () => {
    expect(linuxCondition).toMatch(/should_skip\s*!=\s*'true'/);
  });

  it('e2e_mac preserves should_skip != true (duplicate suppression)', () => {
    expect(macCondition).toMatch(/should_skip\s*!=\s*'true'/);
  });

  it('e2e_linux preserves skip_check result == success', () => {
    expect(linuxCondition).toMatch(
      /needs\.skip_check\.result\s*==\s*'success'/,
    );
  });

  it('e2e_mac preserves skip_check result == success', () => {
    expect(macCondition).toMatch(/needs\.skip_check\.result\s*==\s*'success'/);
  });

  /**
   * Evaluate a simplified version of the gate for the truth table. This models
   * the external-facing behavior: given detector result, docs_only output,
   * cancellation, and should_skip, does the condition resolve to RUN or SKIP?
   *
   * The negated conjunction `!(detectorSuccess && docsOnlyTrue)` means:
   *  - If the detector fails (not success), the inner conjunction is false,
   *    negation is true → proceed to the rest of the condition.
   *  - If the detector succeeded but docs_only != 'true', the inner
   *    conjunction is false, negation is true → proceed.
   *  - Only when detector succeeded AND docs_only == 'true' is the negation
   *    false → SKIP.
   */
  function evaluateGate(
    detectorResult: string,
    docsOnly: string | undefined,
    cancelled: boolean,
    shouldSkip: string,
    skipCheckResult: string,
    authorized: boolean,
  ): boolean {
    // !cancelled() — cancellation always skips
    if (cancelled) return false;
    // needs.skip_check.result == 'success'
    if (skipCheckResult !== 'success') return false;
    // !(needs.e2e_doc_change_filter.result == 'success' &&
    //   needs.e2e_doc_change_filter.outputs.docs_only == 'true')
    const docsOnlySkip = detectorResult === 'success' && docsOnly === 'true';
    if (docsOnlySkip) return false;
    // needs.skip_check.outputs.should_skip != 'true'
    if (shouldSkip === 'true') return false;
    // PR authorization (simplified)
    return authorized;
  }

  it('truth table: detector success + docs_only=true → SKIP', () => {
    expect(
      evaluateGate('success', 'true', false, 'false', 'success', true),
    ).toBe(false);
  });

  it('truth table: detector success + docs_only=false → RUN', () => {
    expect(
      evaluateGate('success', 'false', false, 'false', 'success', true),
    ).toBe(true);
  });

  it('truth table: detector failure → RUN (fail-closed)', () => {
    expect(
      evaluateGate('failure', undefined, false, 'false', 'success', true),
    ).toBe(true);
  });

  it('truth table: detector skipped → RUN', () => {
    expect(
      evaluateGate('skipped', undefined, false, 'false', 'success', true),
    ).toBe(true);
  });

  it('truth table: detector missing output → RUN', () => {
    expect(
      evaluateGate('success', undefined, false, 'false', 'success', true),
    ).toBe(true);
  });

  it('truth table: cancelled → SKIP', () => {
    expect(
      evaluateGate('success', 'false', true, 'false', 'success', true),
    ).toBe(false);
  });

  it('truth table: should_skip=true → SKIP (duplicate suppression)', () => {
    expect(
      evaluateGate('success', 'false', false, 'true', 'success', true),
    ).toBe(false);
  });

  it('truth table: skip_check failed → SKIP', () => {
    expect(
      evaluateGate('success', 'false', false, 'false', 'failure', true),
    ).toBe(false);
  });

  it('truth table: unauthorized → SKIP', () => {
    expect(
      evaluateGate('success', 'false', false, 'false', 'success', false),
    ).toBe(false);
  });

  it('truth table: detector timeout → RUN (fail-closed)', () => {
    expect(
      evaluateGate('cancelled', undefined, false, 'false', 'success', true),
    ).toBe(true);
  });
});
