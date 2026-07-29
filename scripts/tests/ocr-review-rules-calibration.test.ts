/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import {
  WORKFLOW_PATH,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.js';

describe('.github/workflows/ocr-review.yml — OCR rules calibration (issue #2678)', () => {
  let workflow;
  let codeReviewJob;
  let configureRulesStep;
  let parsedRules;
  let globalRule;

  beforeAll(() => {
    const workflowYml = readRootFile(WORKFLOW_PATH);
    workflow = yaml.load(workflowYml);
    codeReviewJob = workflow.jobs?.['code-review'];
    expect(
      codeReviewJob,
      'workflow should contain job: code-review',
    ).toBeTruthy();
    configureRulesStep = stepNamed(codeReviewJob, 'Configure OCR review rules');
    const jsonText = configureRulesStep.env?.OCR_RULES_JSON;
    expect(jsonText, 'OCR_RULES_JSON env should be defined').toBeTruthy();
    parsedRules = JSON.parse(jsonText);
    expect(
      parsedRules.rules?.[0]?.rule,
      'first rule should have a non-empty rule string',
    ).toBeTruthy();
    globalRule = parsedRules.rules.find(
      (r) => r.path === '**/*' || r.path === '**',
    );
    expect(globalRule, 'should have a global path rule').toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // Schema: rules array + preserved include/exclude
  // -----------------------------------------------------------------------

  it('contains a top-level "rules" array with calibration guidance', () => {
    expect(Array.isArray(parsedRules.rules)).toBe(true);
    expect(parsedRules.rules.length).toBeGreaterThanOrEqual(1);
    // The global path pattern (**/* or **) is part of the contract this
    // test enforces: calibration guidance must live in a global rule that
    // applies to all files.
    expect(typeof globalRule.rule).toBe('string');
    expect(globalRule.rule.length).toBeGreaterThan(500);
    // merge_system_rule: true ensures the calibration merges with OCR's
    // built-in system rule rather than replacing it.
    expect(globalRule.merge_system_rule).toBe(true);
  });

  it('preserves the include glob array for test-file re-inclusion', () => {
    expect(Array.isArray(parsedRules.include)).toBe(true);
    expect(parsedRules.include).toContain('**/*.test.{js,jsx,mjs,cjs,ts,tsx}');
    expect(parsedRules.include).toContain('**/*.spec.{js,jsx,mjs,cjs,ts,tsx}');
    expect(parsedRules.include).toContain('**/__tests__/**');
  });

  it('preserves the exclude glob array', () => {
    expect(Array.isArray(parsedRules.exclude)).toBe(true);
    expect(parsedRules.exclude).toContain('**/node_modules/**');
    expect(parsedRules.exclude).toContain('**/dist/**');
    expect(parsedRules.exclude).toContain('**/vendor/**');
  });

  // -----------------------------------------------------------------------
  // Baseline calibration (pre-existing guidance now committed)
  //
  // The exact phrases matched below (e.g. "senior-engineer review") are
  // contractual: if the rule text is rephrased, the test must be updated
  // in the same commit so the calibration intent is explicitly reviewed.
  // -----------------------------------------------------------------------

  it('includes senior-engineer review priority guidance', () => {
    const ruleText = globalRule.rule;
    expect(ruleText).toContain('senior-engineer review');
    expect(ruleText).toMatch(/Correctness\/logic bugs/i);
    expect(ruleText).toMatch(/Security/i);
  });

  it('suppresses JSDoc/documentation-only findings', () => {
    const ruleText = globalRule.rule;
    expect(ruleText).toMatch(/JSDoc\/comment\/documentation-only/i);
  });

  it('includes severity calibration', () => {
    const ruleText = globalRule.rule;
    expect(ruleText).toMatch(/Reserve.*high/i);
    expect(ruleText).toMatch(/medium/i);
  });

  it('prevents test-wishlist churn', () => {
    const ruleText = globalRule.rule;
    expect(ruleText).toMatch(/test-wishlist churn/i);
  });

  it('emphasizes resource-leak findings', () => {
    const ruleText = globalRule.rule;
    expect(ruleText).toMatch(/resource leaks/i);
    expect(ruleText).toMatch(/orphaned processes/i);
  });

  // -----------------------------------------------------------------------
  // New suppressions (issue #2678)
  // -----------------------------------------------------------------------

  it('suppresses hardcoded build/test-fixture constant findings', () => {
    const ruleText = globalRule.rule;
    expect(ruleText).toMatch(/Hardcoded constants/i);
    expect(ruleText).toMatch(/build-time|test-fixture/i);
  });

  it('suppresses diagnostic verbosity findings', () => {
    const ruleText = globalRule.rule;
    expect(ruleText).toMatch(
      /diagnostic verbosity|Error\/diagnostic verbosity/i,
    );
  });

  it('suppresses naming style findings', () => {
    const ruleText = globalRule.rule;
    expect(ruleText).toMatch(/Naming style/i);
    expect(ruleText).toMatch(/actively misleading/i);
  });

  it('suppresses extract-to-shared-file modularity refactors', () => {
    const ruleText = globalRule.rule;
    expect(ruleText).toMatch(/Modularity refactors/i);
    expect(ruleText).toMatch(/future reuse|active duplication/i);
  });

  it('tightens test-suggestion suppression', () => {
    const ruleText = globalRule.rule;
    expect(ruleText).toMatch(/Test-suggestion suppression/i);
    expect(ruleText).toMatch(/plausible defect/i);
  });

  // -----------------------------------------------------------------------
  // Signal preservation protective clause
  // -----------------------------------------------------------------------

  it('explicitly protects bug/correctness/security findings from suppression', () => {
    const ruleText = globalRule.rule;
    expect(ruleText).toMatch(/Signal preservation/i);
    expect(ruleText).toMatch(/Do NOT suppress bug, correctness, or security/i);
  });

  it('enforces lint/complexity guardrail invariance', () => {
    const ruleText = globalRule.rule;
    expect(ruleText).toMatch(/eslint-disable/i);
    expect(ruleText).toMatch(/complexity\/size threshold/i);
  });
});
