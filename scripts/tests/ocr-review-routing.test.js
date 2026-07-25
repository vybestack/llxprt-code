/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import {
  WORKFLOW_PATH,
  commandText,
  extractFunctionSource,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.js';

// Security note: The vm.runInNewContext calls in this suite execute JavaScript
// extracted from the trusted, version-controlled ocr-review.yml workflow via
// extractFunctionSource. This is trusted repository content (not user/PR input)
// and the workflow helper is read from the checked-out HEAD. The vm sandbox is
// used to evaluate the real production function in isolation (with an empty
// global scope), proving actual runtime behavior without mocking the function
// itself.

/**
 * Names of the helper functions that must exist in the post step before
 * extraction. Asserting these up front gives a precise error pointing at the
 * missing function rather than a buried stack trace inside the VM loader.
 */
const REQUIRED_FUNCTION_NAMES = [
  'effectiveCategory',
  'effectiveSeverity',
  'routeFinding',
  'categorySeverityLabel',
];

describe('.github/workflows/ocr-review.yml — severity-based routing (#2672)', () => {
  let workflow;
  let codeReviewJob;
  let postStep;
  let postScript;

  beforeAll(() => {
    const workflowYml = readRootFile(WORKFLOW_PATH);
    workflow = yaml.load(workflowYml);
    if (!workflow || typeof workflow !== 'object') {
      throw new Error(`${WORKFLOW_PATH} did not parse to a YAML mapping`);
    }
    codeReviewJob = workflow.jobs?.['code-review'];
    expect(
      codeReviewJob,
      'workflow should contain job: code-review',
    ).toBeTruthy();
    postStep = stepNamed(codeReviewJob, 'Post OCR results');
    postScript = commandText(postStep);
  });

  function assertFunctionsPresent(script) {
    for (const name of REQUIRED_FUNCTION_NAMES) {
      expect(
        script.includes(`function ${name}(`),
        `post step should define function ${name}`,
      ).toBe(true);
    }
  }

  /**
   * Extract the routing functions from the committed workflow YAML, validate
   * they are present, and load them into a single shared VM sandbox. The
   * results are cached because the workflow source is immutable during the
   * test run.
   */
  let cachedRouteFinding = null;
  let cachedCategorySeverityLabel = null;

  function loadWorkflowFunctions() {
    if (cachedRouteFinding && cachedCategorySeverityLabel) {
      return {
        routeFinding: cachedRouteFinding,
        categorySeverityLabel: cachedCategorySeverityLabel,
      };
    }
    assertFunctionsPresent(postScript);
    const helpers = [
      extractFunctionSource(postScript, 'effectiveCategory'),
      extractFunctionSource(postScript, 'effectiveSeverity'),
    ];
    const routeSrc = extractFunctionSource(postScript, 'routeFinding');
    const labelSrc = extractFunctionSource(postScript, 'categorySeverityLabel');
    const routeSandbox = {};
    vm.createContext(routeSandbox);
    vm.runInContext([...helpers, routeSrc].join('\n'), routeSandbox);
    expect(typeof routeSandbox.routeFinding).toBe('function');
    const labelSandbox = {};
    vm.createContext(labelSandbox);
    vm.runInContext([...helpers, labelSrc].join('\n'), labelSandbox);
    expect(typeof labelSandbox.categorySeverityLabel).toBe('function');
    cachedRouteFinding = routeSandbox.routeFinding;
    cachedCategorySeverityLabel = labelSandbox.categorySeverityLabel;
    return {
      routeFinding: cachedRouteFinding,
      categorySeverityLabel: cachedCategorySeverityLabel,
    };
  }

  function loadRouteFinding() {
    return loadWorkflowFunctions().routeFinding;
  }

  function loadCategorySeverityLabel() {
    return loadWorkflowFunctions().categorySeverityLabel;
  }

  // -------------------------------------------------------------------------
  // routeFinding behavioral tests — protected categories (always inline)
  // -------------------------------------------------------------------------
  describe('routeFinding behavior — protected categories', () => {
    it('routes bug/high to inline', () => {
      const routeFinding = loadRouteFinding();
      const { destination, reason } = routeFinding({
        category: 'bug',
        severity: 'high',
      });
      expect(destination).toBe('inline');
      expect(reason).toContain('bug');
    });

    it('routes bug/low to inline (bug always inline regardless of severity)', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'bug',
        severity: 'low',
      });
      expect(destination).toBe('inline');
    });

    it('routes bug/info to inline (protected category takes priority over info)', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'bug',
        severity: 'info',
      });
      expect(destination).toBe('inline');
    });

    it('routes security/medium to inline', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'security',
        severity: 'medium',
      });
      expect(destination).toBe('inline');
    });

    it('routes security/low to inline', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'security',
        severity: 'low',
      });
      expect(destination).toBe('inline');
    });

    it('routes security/info to inline (protected category priority)', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'security',
        severity: 'info',
      });
      expect(destination).toBe('inline');
    });

    it('routes correctness (via originalCategory) to inline regardless of severity', () => {
      // Metadata validation (#2671) normalizes 'correctness' to 'unknown' in
      // category, preserving originalCategory. Routing must recognize
      // originalCategory='correctness' and keep it inline.
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'unknown',
        severity: 'unknown',
        originalCategory: 'correctness',
        originalSeverity: 'info',
      });
      expect(destination).toBe('inline');
    });

    it('routes correctness/low (direct category) to inline', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'correctness',
        severity: 'low',
      });
      expect(destination).toBe('inline');
    });
  });

  // -------------------------------------------------------------------------
  // routeFinding behavioral tests — high/medium severity (always inline)
  // -------------------------------------------------------------------------
  describe('routeFinding behavior — high/medium severity', () => {
    it('routes maintainability/high to inline', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'maintainability',
        severity: 'high',
      });
      expect(destination).toBe('inline');
    });

    it('routes maintainability/medium to inline', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'maintainability',
        severity: 'medium',
      });
      expect(destination).toBe('inline');
    });

    it('routes test/high to inline', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'test',
        severity: 'high',
      });
      expect(destination).toBe('inline');
    });

    it('routes test/medium to inline', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'test',
        severity: 'medium',
      });
      expect(destination).toBe('inline');
    });

    it('routes style/high to inline', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'style',
        severity: 'high',
      });
      expect(destination).toBe('inline');
    });

    it('routes style/medium to inline', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'style',
        severity: 'medium',
      });
      expect(destination).toBe('inline');
    });

    it('routes high severity to inline even with conflicting originalSeverity info', () => {
      // A finding with severity='high' but originalSeverity='info' must
      // remain inline because high takes priority over info.
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'maintainability',
        severity: 'high',
        originalSeverity: 'info',
      });
      expect(destination).toBe('inline');
    });

    it('routes medium severity to inline even with conflicting originalSeverity info', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'test',
        severity: 'medium',
        originalSeverity: 'info',
      });
      expect(destination).toBe('inline');
    });
  });

  // -------------------------------------------------------------------------
  // routeFinding behavioral tests — summary routing (low and info)
  // -------------------------------------------------------------------------
  describe('routeFinding behavior — summary routing', () => {
    it('routes maintainability/low to summary', () => {
      const routeFinding = loadRouteFinding();
      const { destination, reason } = routeFinding({
        category: 'maintainability',
        severity: 'low',
      });
      expect(destination).toBe('summary');
      expect(reason).toContain('maintainability');
      expect(reason).toContain('low');
    });

    it('routes test/low to summary', () => {
      const routeFinding = loadRouteFinding();
      const { destination, reason } = routeFinding({
        category: 'test',
        severity: 'low',
      });
      expect(destination).toBe('summary');
      expect(reason).toContain('test');
    });

    it('routes style/low to summary', () => {
      const routeFinding = loadRouteFinding();
      const { destination, reason } = routeFinding({
        category: 'style',
        severity: 'low',
      });
      expect(destination).toBe('summary');
      expect(reason).toContain('style');
    });

    it('routes maintainability/info to summary', () => {
      const routeFinding = loadRouteFinding();
      const { destination, reason } = routeFinding({
        category: 'maintainability',
        severity: 'info',
      });
      expect(destination).toBe('summary');
      expect(reason).toContain('info');
    });

    it('routes test/info to summary', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'test',
        severity: 'info',
      });
      expect(destination).toBe('summary');
    });

    it('routes other/low to summary (other is treated as summary-eligible)', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'other',
        severity: 'low',
      });
      expect(destination).toBe('summary');
    });

    it('routes other/info to summary', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'other',
        severity: 'info',
      });
      expect(destination).toBe('summary');
    });

    it('routes maintainability with originalSeverity info to summary (when severity is unknown)', () => {
      // Metadata validation normalizes 'info' to 'unknown' in severity,
      // preserving originalSeverity. effectiveSeverity recovers it.
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'maintainability',
        severity: 'unknown',
        originalSeverity: 'info',
      });
      expect(destination).toBe('summary');
    });

    it('routes test with originalSeverity info to summary (when severity is unknown)', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'test',
        severity: 'unknown',
        originalSeverity: 'info',
      });
      expect(destination).toBe('summary');
    });
  });

  // -------------------------------------------------------------------------
  // routeFinding behavioral tests — fail-safe (unknown → inline)
  // -------------------------------------------------------------------------
  describe('routeFinding behavior — fail-safe', () => {
    it('routes unknown/high to inline', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'unknown',
        severity: 'high',
      });
      expect(destination).toBe('inline');
    });

    it('routes unknown/low to inline (unknown category fail-safe)', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'unknown',
        severity: 'low',
      });
      expect(destination).toBe('inline');
    });

    it('routes unknown category with originalSeverity info to inline (fail-safe)', () => {
      // Unknown category + info severity must NOT route to summary.
      // The fail-safe for unknown categories takes priority.
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'unknown',
        severity: 'unknown',
        originalSeverity: 'info',
      });
      expect(destination).toBe('inline');
    });

    it('routes missing category with originalSeverity info to inline (fail-safe)', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        originalSeverity: 'info',
      });
      expect(destination).toBe('inline');
    });

    it('routes null finding to inline', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding(null);
      expect(destination).toBe('inline');
    });

    it('routes non-object finding (string) to inline', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding('some string');
      expect(destination).toBe('inline');
    });

    it('routes array finding to inline', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding(['stray', 'array']);
      expect(destination).toBe('inline');
    });

    it('routes maintainability/unknown to inline (unknown severity fail-safe)', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'maintainability',
        severity: 'unknown',
      });
      expect(destination).toBe('inline');
    });

    it('routes missing category and severity to inline', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({});
      expect(destination).toBe('inline');
    });

    it('routes security with originalSeverity info to inline (protected category)', () => {
      const routeFinding = loadRouteFinding();
      const { destination } = routeFinding({
        category: 'security',
        severity: 'unknown',
        originalSeverity: 'info',
      });
      expect(destination).toBe('inline');
    });
  });

  // -------------------------------------------------------------------------
  // categorySeverityLabel behavioral tests
  // -------------------------------------------------------------------------
  describe('categorySeverityLabel behavior', () => {
    it('renders valid category and severity', () => {
      const categorySeverityLabel = loadCategorySeverityLabel();
      const label = categorySeverityLabel({
        category: 'bug',
        severity: 'high',
      });
      expect(label).toBe('**[bug/high]** ');
    });

    it('defaults missing category and severity to unknown', () => {
      const categorySeverityLabel = loadCategorySeverityLabel();
      const label = categorySeverityLabel({});
      expect(label).toBe('**[unknown/unknown]** ');
    });

    it('recovers effective category from originalCategory', () => {
      const categorySeverityLabel = loadCategorySeverityLabel();
      const label = categorySeverityLabel({
        category: 'unknown',
        originalCategory: 'correctness',
      });
      expect(label).toBe('**[correctness/unknown]** ');
    });

    it('recovers effective severity from originalSeverity', () => {
      const categorySeverityLabel = loadCategorySeverityLabel();
      const label = categorySeverityLabel({
        category: 'maintainability',
        severity: 'unknown',
        originalSeverity: 'info',
      });
      expect(label).toBe('**[maintainability/info]** ');
    });

    it('returns empty string for non-object finding', () => {
      const categorySeverityLabel = loadCategorySeverityLabel();
      const label = categorySeverityLabel('string');
      expect(label).toBe('');
    });

    it('returns empty string for null finding', () => {
      const categorySeverityLabel = loadCategorySeverityLabel();
      const label = categorySeverityLabel(null);
      expect(label).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // YAML wiring / structural tests
  // -------------------------------------------------------------------------
  describe('YAML wiring', () => {
    it('defines routeFinding(finding) in the post step', () => {
      expect(postScript).toContain('function routeFinding(finding)');
    });

    it('defines effectiveCategory(finding) helper', () => {
      expect(postScript).toContain('function effectiveCategory(finding)');
    });

    it('defines effectiveSeverity(finding) helper', () => {
      expect(postScript).toContain('function effectiveSeverity(finding)');
    });

    it('defines categorySeverityLabel(finding) in the post step', () => {
      expect(postScript).toContain('function categorySeverityLabel(finding)');
    });

    it('wires OCR_ROUTING_SHADOW_MODE env variable', () => {
      expect(postStep.env?.OCR_ROUTING_SHADOW_MODE).toBe(
        '${{ vars.OCR_ROUTING_SHADOW_MODE }}',
      );
    });

    it('defaults routingShadowMode to true via !== false pattern', () => {
      expect(postScript).toContain(
        "process.env.OCR_ROUTING_SHADOW_MODE !== 'false'",
      );
    });

    it('sets comments_routed_summary output via core.setOutput', () => {
      expect(postScript).toContain("core.setOutput('comments_routed_summary'");
    });

    it('declares summaryRouted array in the split loop', () => {
      expect(postScript).toContain('const summaryRouted = [];');
    });

    it('renders category/severity labels inside blockquote in inline bodies', () => {
      // The label must be placed INSIDE the blockquote (> label text), not
      // before it (label > text), so the blockquote format is preserved.
      expect(postScript).toContain('labeledText');
      expect(postScript).toContain('replace(/^> /, `> ${label}`)');
    });

    it('renders labels for lineless findings', () => {
      // Lineless findings must also get category/severity labels.
      const linelessIndex = postScript.indexOf(
        'Findings without a resolvable position',
      );
      expect(linelessIndex).toBeGreaterThan(-1);
      const afterLineless = postScript.substring(
        linelessIndex,
        linelessIndex + 500,
      );
      expect(afterLineless).toContain('categorySeverityLabel');
    });

    it('includes shadow-mode routing preview section in summary', () => {
      expect(postScript).toContain('Shadow-mode routing preview');
    });

    it('includes summary-routed findings section without misleading heading', () => {
      // The heading must NOT say "low severity" since info findings are
      // also routed there.
      expect(postScript).toContain("'### Findings routed to summary'");
      expect(postScript).not.toContain(
        "'### Findings routed to summary (low severity)'",
      );
    });

    it('writes ocr-routing-decisions.json artifact with ALL decisions', () => {
      expect(postScript).toContain(
        "fs.writeFileSync('ocr-routing-decisions.json'",
      );
      expect(postScript).toContain('allRoutingDecisions');
    });

    it('exposes comments_routed_summary in job outputs', () => {
      expect(codeReviewJob.outputs?.comments_routed_summary).toBe(
        '${{ steps.post-ocr-results.outputs.comments_routed_summary }}',
      );
    });

    it('includes ocr-routing-decisions.json in Initialize step', () => {
      const initStep = stepNamed(
        codeReviewJob,
        'Initialize OCR artifact files',
      );
      const initRun = commandText(initStep);
      expect(initRun).toContain(': > ocr-routing-decisions.json');
    });

    it('includes ocr-routing-decisions.json in Redact step', () => {
      const redactStep = stepNamed(
        codeReviewJob,
        'Redact OCR diagnostic artifacts',
      );
      const redactRun = commandText(redactStep);
      expect(redactRun).toContain("'ocr-routing-decisions.json'");
    });

    it('includes ocr-routing-decisions.json in Ensure placeholders step', () => {
      const ensureStep = stepNamed(
        codeReviewJob,
        'Ensure OCR artifact placeholders exist',
      );
      const ensureRun = commandText(ensureStep);
      expect(ensureRun).toContain('ocr-routing-decisions.json');
    });

    it('includes ocr-routing-decisions.json in Upload artifacts step', () => {
      const uploadStep = stepNamed(codeReviewJob, 'Upload OCR artifacts');
      expect(uploadStep.with?.path).toContain('ocr-routing-decisions.json');
    });
  });

  // -------------------------------------------------------------------------
  // Pipeline ordering test — routing decisions
  // -------------------------------------------------------------------------
  describe('pipeline ordering', () => {
    it('computes allRoutingDecisions before dedup so suppressed findings still get artifact records', () => {
      // allRoutingDecisions must be computed BEFORE deduplication so every
      // finding — including duplicates that dedup later suppresses — gets a
      // routing decision record in the artifact.
      const validateIndex = postScript.indexOf(
        'findings.map(validateFindingMetadata)',
      );
      const allRoutingIndex = postScript.indexOf('allRoutingDecisions');
      const dedupIndex = postScript.indexOf(
        'const dedupedFindings = deduplicateFindings(findings);',
      );

      expect(validateIndex).toBeGreaterThan(-1);
      expect(allRoutingIndex).toBeGreaterThan(validateIndex);
      expect(dedupIndex).toBeGreaterThan(allRoutingIndex);
    });

    it('computes routingDecisions for deduped set after dedup (not sliced from pre-dedup)', () => {
      // routingDecisions (used for shadow-mode preview counts) must be
      // recomputed for the deduped set, not sliced from allRoutingDecisions,
      // because dedup can remove findings from anywhere in the array.
      const dedupAssignIndex = postScript.indexOf(
        'findings = dedupedFindings.deduped;',
      );
      const routingDecisionsIndex = postScript.indexOf(
        'const routingDecisions = findings.map',
      );
      const splitIndex = postScript.indexOf('const summaryRouted = [];');

      expect(dedupAssignIndex).toBeGreaterThan(-1);
      expect(routingDecisionsIndex).toBeGreaterThan(dedupAssignIndex);
      expect(splitIndex).toBeGreaterThan(routingDecisionsIndex);
      // Must not use the incorrect slice pattern.
      expect(postScript).not.toContain(
        'allRoutingDecisions.slice(0, findings.length)',
      );
    });

    it('writes routing artifact before the summary is posted', () => {
      const writeIndex = postScript.indexOf(
        "fs.writeFileSync('ocr-routing-decisions.json'",
      );
      const postIndex = postScript.indexOf('createOrUpdateMarkerComment');
      expect(writeIndex).toBeGreaterThan(-1);
      expect(postIndex).toBeGreaterThan(writeIndex);
    });
  });

  // -------------------------------------------------------------------------
  // Shadow-mode vs go-live integration tests
  // -------------------------------------------------------------------------
  describe('shadow-mode and go-live integration', () => {
    it('routes to summaryRouted only when not in shadow mode', () => {
      expect(postScript).toContain(
        "!routingShadowMode && decision.destination === 'summary'",
      );
    });

    it('uses categorySeverityLabel for summary-routed findings', () => {
      const routedSectionIndex = postScript.indexOf(
        'Findings routed to summary',
      );
      expect(routedSectionIndex).toBeGreaterThan(-1);
      const afterRouted = postScript.substring(
        routedSectionIndex,
        routedSectionIndex + 600,
      );
      expect(afterRouted).toContain('categorySeverityLabel');
    });

    it('tracks wouldRouteToSummary count filtering to line-addressable findings only', () => {
      // wouldRouteToSummary must filter to findings with valid path/line
      // numbers (hasPosition) so lineless findings — which always go to
      // the summary — do not inflate the shadow-mode preview count.
      expect(postScript).toContain('hasPosition');
      expect(postScript).toContain("d.destination === 'summary'");
      expect(postScript).toContain('wouldRouteToSummary');
    });

    it('breaks down shadow-mode preview by category/severity', () => {
      const previewIndex = postScript.indexOf('Shadow-mode routing preview');
      expect(previewIndex).toBeGreaterThan(-1);
      const afterPreview = postScript.substring(
        previewIndex,
        previewIndex + 800,
      );
      expect(afterPreview).toContain('summaryByCategory');
      expect(afterPreview).toContain('d.category');
      expect(afterPreview).toContain('d.severity');
    });
  });
});
