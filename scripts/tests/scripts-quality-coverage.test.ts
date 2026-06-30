/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Issue #2282: Behavioral regression test for scripts code-quality coverage.
 *
 * Before #2282, the scripts tree received only the base ESLint recommended
 * layer and missed the strict SonarJS maintainability, regex-correctness, and
 * size/complexity guardrails that protect the packages source tree. These
 * tests inspect the *effective* ESLint configuration for representative scripts
 * files and assert the intended quality rules are active (and that the documented
 * carve-outs are in place), so the coverage cannot silently regress.
 *
 * Severity values in --print-config are numeric: 2 = error, 1 = warn, 0 = off.
 */
function severity(rule: unknown): number | undefined {
  if (typeof rule === 'number') {
    return rule;
  }
  if (typeof rule === 'string') {
    return { error: 2, warn: 1, off: 0 }[rule];
  }
  if (Array.isArray(rule)) {
    return severity(rule[0]);
  }
  return undefined;
}

function effectiveRulesFor(relativePath: string): Record<string, unknown> {
  const repoRoot = resolve(__dirname, '..', '..');
  const out = execFileSync(
    process.execPath,
    ['node_modules/eslint/bin/eslint.js', '--print-config', relativePath],
    { encoding: 'utf8', cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 },
  );
  return JSON.parse(out).rules ?? {};
}

describe('Issue #2282: scripts strict code-quality coverage', () => {
  it('applies maintainability/complexity rules to a .js script', () => {
    const rules = effectiveRulesFor('scripts/start.js');
    expect(severity(rules['complexity'])).toBe(2);
    expect(severity(rules['max-lines'])).toBe(2);
    expect(severity(rules['max-lines-per-function'])).toBe(2);
    expect(severity(rules['sonarjs/cognitive-complexity'])).toBe(2);
    expect(severity(rules['sonarjs/no-collapsible-if'])).toBe(2);
    expect(severity(rules['sonarjs/nested-control-flow'])).toBe(2);
    expect(severity(rules['sonarjs/slow-regex'])).toBe(2);
    expect(severity(rules['sonarjs/todo-tag'])).toBe(2);
    expect(severity(rules['eqeqeq'])).toBe(2);
    expect(severity(rules['prefer-const'])).toBe(2);
  });

  it('applies the same quality rules to a .cjs script', () => {
    const rules = effectiveRulesFor('scripts/detect-installer.cjs');
    expect(severity(rules['sonarjs/cognitive-complexity'])).toBe(2);
    expect(severity(rules['complexity'])).toBe(2);
    expect(severity(rules['sonarjs/slow-regex'])).toBe(2);
  });

  it('applies the same quality rules to a .mjs script', () => {
    const rules = effectiveRulesFor('scripts/verify-bun-workspace-links.mjs');
    expect(severity(rules['sonarjs/no-collapsible-if'])).toBe(2);
    expect(severity(rules['max-lines-per-function'])).toBe(2);
  });

  it('applies the same quality rules to a .ts script', () => {
    const rules = effectiveRulesFor('scripts/generate-settings-doc.ts');
    expect(severity(rules['sonarjs/cognitive-complexity'])).toBe(2);
    expect(severity(rules['@typescript-eslint/no-explicit-any'])).toBe(2);
  });

  it('does not enable no-console for scripts (legitimate build/dev output)', () => {
    const rules = effectiveRulesFor('scripts/start.js');
    // no-console is deliberately not promoted to error for scripts because
    // build/dev tooling legitimately writes to stdout/stderr.
    expect(severity(rules['no-console'])).not.toBe(2);
  });

  it('turns off max-lines-per-function for scripts tests (parity with packages)', () => {
    const rules = effectiveRulesFor('scripts/tests/publish-integrity.test.ts');
    expect(severity(rules['max-lines-per-function'])).toBe(0);
    // Non-size quality rules still apply to test files, including the
    // motivating rule from issue #2282's context (a review had suggested
    // suppressing it because scripts were not covered by the quality layer).
    expect(severity(rules['sonarjs/too-many-break-or-continue-in-loop'])).toBe(
      2,
    );
    expect(severity(rules['sonarjs/slow-regex'])).toBe(2);
    expect(severity(rules['sonarjs/no-collapsible-if'])).toBe(2);
  });

  it('does not apply type-aware rules (scripts have no tsconfig project)', () => {
    const rules = effectiveRulesFor('scripts/start.js');
    // Type-aware rules require a tsconfig project (projectService), which the
    // scripts tree lacks. This is a documented, intentional limitation, not a
    // suppression. These rules must not be promoted to error for scripts.
    expect(severity(rules['@typescript-eslint/no-floating-promises'])).not.toBe(
      2,
    );
    expect(
      severity(rules['@typescript-eslint/strict-boolean-expressions']),
    ).not.toBe(2);
  });

  it('carves out structural complexity rules for the guard parser', () => {
    const rules = effectiveRulesFor('scripts/check-eslint-guard.js');
    // Structural/nesting/size rules are carved out for the documented
    // ~5000-line hand-written state-machine parser.
    expect(severity(rules['complexity'])).toBe(0);
    expect(severity(rules['max-lines'])).toBe(0);
    expect(severity(rules['max-lines-per-function'])).toBe(0);
    expect(severity(rules['sonarjs/cognitive-complexity'])).toBe(0);
    expect(severity(rules['sonarjs/nested-control-flow'])).toBe(0);
    expect(severity(rules['sonarjs/expression-complexity'])).toBe(0);
    // Non-structural quality rules still apply.
    expect(severity(rules['sonarjs/no-collapsible-if'])).toBe(2);
    expect(severity(rules['prefer-const'])).toBe(2);
    expect(severity(rules['@typescript-eslint/no-unused-vars'])).toBe(2);
  });

  it('carves out max-lines for the exhaustive guard test fixture', () => {
    const rules = effectiveRulesFor('scripts/tests/eslint-guard.test.js');
    expect(severity(rules['max-lines'])).toBe(0);
    // Other quality rules still apply.
    expect(severity(rules['sonarjs/no-identical-functions'])).toBe(2);
  });
});
