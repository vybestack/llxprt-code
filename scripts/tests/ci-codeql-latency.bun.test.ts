/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3187: bound CodeQL latency on the PR feedback path.
 *
 * A behavioral workflow contract against the real parsed
 * `.github/workflows/ci.yml` (not a mock). Pins the CodeQL job's event-aware
 * timeout (9 minutes for pull_request, 360 for all other events) and
 * credential-free checkout while proving the job's runner, duplicate-only
 * gate, least-privilege permissions, pinned SHA actions, default-query
 * JavaScript configuration, and event coverage remain unchanged.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import type {
  WorkflowDocument,
  WorkflowJob,
  WorkflowStep,
} from './typed-test-helpers.ts';
import {
  parseWorkflowYaml,
  workflowJob,
  workflowOn,
  jobSteps,
  stepWith,
  asBoolean,
  asString,
  asStringArray,
  asRecord,
} from './typed-test-helpers.ts';
import { readRootFile, stepNamed } from './ocr-review-workflow-helpers.ts';

/** Full Git commit SHA: 40 lowercase hex characters. */
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

/** Normalizes a job `needs` field (string or array) into a string array. */
function jobNeedsArray(needs: string | string[] | undefined): string[] {
  if (needs === undefined) return [];
  return Array.isArray(needs) ? [...needs] : [needs];
}

/** Extracts the commit SHA (text after the last @) from a `uses` reference. */
function extractCommitSha(usesReference: string): string {
  const atIndex = usesReference.lastIndexOf('@');
  if (atIndex < 0) {
    throw new Error(`uses reference should contain @: ${usesReference}`);
  }
  return usesReference.slice(atIndex + 1);
}

/**
 * Asserts the raw workflow source retains a `# ratchet:` comment on the line
 * holding the `uses` reference. Parsed YAML strips comments, so this check
 * operates on the verbatim source text to prove the pin is ratchet-managed.
 */
function expectRatchetCommentInSource(
  source: string,
  usesReference: string,
): void {
  const escaped = usesReference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}['"]?\\s*#\\s*ratchet:`);
  if (!pattern.test(source)) {
    throw new Error(
      `workflow source should retain a ratchet comment for: ${usesReference}`,
    );
  }
}

describe('Issue #3187: bound CodeQL latency on the PR feedback path', () => {
  let workflowSource: string;
  let workflow: WorkflowDocument;
  let on: Record<string, unknown>;
  let codeql: WorkflowJob;
  let steps: WorkflowStep[];
  let checkoutStep: WorkflowStep;
  let initStep: WorkflowStep;
  let analyzeStep: WorkflowStep;

  beforeAll(() => {
    workflowSource = readRootFile('.github/workflows/ci.yml');
    workflow = parseWorkflowYaml(workflowSource);
    on = workflowOn(workflow);
    codeql = workflowJob(workflow, 'codeql');
    steps = jobSteps(codeql);
    checkoutStep = stepNamed(codeql, 'Checkout');
    initStep = stepNamed(codeql, 'Initialize CodeQL');
    analyzeStep = stepNamed(codeql, 'Perform CodeQL Analysis');
  });

  describe('event-aware latency bound (timeout-minutes)', () => {
    it('caps pull_request at 9 and all other events at 360', () => {
      expect(asString(codeql['timeout-minutes'])).toBe(
        "${{ github.event_name == 'pull_request' && 9 || 360 }}",
      );
    });
  });

  describe('credential-free checkout', () => {
    it('CodeQL checkout does not persist credentials', () => {
      const withInputs = stepWith(checkoutStep);
      expect(asBoolean(withInputs['persist-credentials'])).toBe(false);
    });
  });

  describe('unchanged runner and gating', () => {
    it('runs-on remains ubuntu-latest', () => {
      expect(asString(codeql['runs-on'])).toBe('ubuntu-latest');
    });

    it('needs remains exactly skip_check', () => {
      expect(jobNeedsArray(codeql.needs)).toEqual(['skip_check']);
    });

    it('if remains the duplicate-only condition with no docs-only gate', () => {
      const condition = asString(codeql.if);
      expect(condition).toBe(
        "${{ needs.skip_check.outputs.should_skip != 'true' }}",
      );
      expect(condition).not.toContain('doc_change_filter');
    });
  });

  describe('no success-masking mechanism', () => {
    it('codeql job declares no continue-on-error', () => {
      expect(codeql['continue-on-error']).toBeUndefined();
    });

    it('no codeql step uses continue-on-error', () => {
      for (const step of steps) {
        expect(step['continue-on-error']).toBeUndefined();
      }
    });
  });

  describe('least-privilege permissions', () => {
    it('permissions are exactly actions: read, contents: read, security-events: write', () => {
      expect(codeql.permissions).toEqual({
        actions: 'read',
        contents: 'read',
        'security-events': 'write',
      });
    });
  });

  describe('pinned SHA actions with ratchet comments', () => {
    it('checkout, init, and analyze are pinned to full 40-hex commit SHAs', () => {
      const references = [
        asString(checkoutStep['uses']),
        asString(initStep['uses']),
        asString(analyzeStep['uses']),
      ];
      for (const uses of references) {
        expect(extractCommitSha(uses)).toMatch(COMMIT_SHA_PATTERN);
      }
    });

    it('each action retains a ratchet comment in the workflow source', () => {
      expectRatchetCommentInSource(
        workflowSource,
        asString(checkoutStep['uses']),
      );
      expectRatchetCommentInSource(workflowSource, asString(initStep['uses']));
      expectRatchetCommentInSource(
        workflowSource,
        asString(analyzeStep['uses']),
      );
    });

    it('init and analyze use the same CodeQL action revision', () => {
      const initSha = extractCommitSha(asString(initStep['uses']));
      const analyzeSha = extractCommitSha(asString(analyzeStep['uses']));
      expect(initSha).toBe(analyzeSha);
    });
  });

  describe('init configuration (default queries, full coverage)', () => {
    it('init with-inputs are exactly languages: javascript', () => {
      expect(stepWith(initStep)).toEqual({ languages: 'javascript' });
    });

    it('init declares no queries, config-file, or path exclusions', () => {
      const initWith = stepWith(initStep);
      const forbiddenKeys = [
        'queries',
        'config-file',
        'paths',
        'paths-ignore',
        'packs',
      ];
      for (const key of forbiddenKeys) {
        expect(initWith[key]).toBeUndefined();
      }
    });
  });

  describe('analyze step present', () => {
    it('Perform CodeQL Analysis step runs the CodeQL analyze action', () => {
      expect(asString(analyzeStep['uses'])).toContain(
        'github/codeql-action/analyze',
      );
    });
  });

  describe('event coverage unchanged', () => {
    it('push retains branches main and release/**', () => {
      const pushConfig = asRecord(on['push']);
      expect(asStringArray(pushConfig['branches'])).toEqual([
        'main',
        'release/**',
      ]);
    });

    it('pull_request retains branches main and release/**', () => {
      const prConfig = asRecord(on['pull_request']);
      expect(asStringArray(prConfig['branches'])).toEqual([
        'main',
        'release/**',
      ]);
    });

    it('merge_group remains present', () => {
      expect(on['merge_group']).toBeDefined();
    });

    it('workflow_dispatch remains present', () => {
      expect(on['workflow_dispatch']).toBeDefined();
    });
  });
});
