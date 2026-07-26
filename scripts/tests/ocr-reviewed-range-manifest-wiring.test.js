/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BASE_MANIFEST_PARAMS,
  makeLoadFunction,
  makeLoadFunctionsTogether,
  useWorkflowFixture,
} from './ocr-manifest-test-helpers.js';
import { commandText, stepNamed } from './ocr-review-workflow-helpers.js';

describe('.github/workflows/ocr-review.yml — manifest artifacts & YAML wiring (issue #2575)', () => {
  const ctx = useWorkflowFixture();
  const loadFunction = makeLoadFunction(ctx);
  const loadFunctionsTogether = makeLoadFunctionsTogether(ctx);

  // -----------------------------------------------------------------------
  // computeArtifactHashes
  // -----------------------------------------------------------------------
  describe('computeArtifactHashes behavior', () => {
    function makeFakeFs(files) {
      return {
        readFileSync: (name) => {
          if (!(name in files)) {
            const err = new Error(`ENOENT: ${name}`);
            err.code = 'ENOENT';
            throw err;
          }
          return files[name];
        },
      };
    }

    it('computes SHA-256 hashes for each artifact file (AC #8)', () => {
      const content = 'hello world';
      const expectedHash = `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
      const fakeFs = makeFakeFs({ 'ocr-result.json': content });
      const fn = loadFunction('computeArtifactHashes', {
        require: (mod) => {
          if (mod === 'crypto') return crypto;
          if (mod === 'fs') return fakeFs;
          throw new Error(`unknown module: ${mod}`);
        },
        fs: fakeFs,
      });
      const hashes = fn(['ocr-result.json']);
      expect(hashes['ocr-result.json']).toBe(expectedHash);
    });

    it('prefixes each hash with sha256:', () => {
      const fakeFs = makeFakeFs({ 'ocr-stdout.raw': 'data' });
      const fn = loadFunction('computeArtifactHashes', {
        require: (mod) => {
          if (mod === 'crypto') return crypto;
          if (mod === 'fs') return fakeFs;
          throw new Error(`unknown module: ${mod}`);
        },
        fs: fakeFs,
      });
      const hashes = fn(['ocr-stdout.raw']);
      expect(hashes['ocr-stdout.raw']).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it('returns null for a missing file instead of throwing', () => {
      const fakeFs = makeFakeFs({});
      const fn = loadFunction('computeArtifactHashes', {
        require: (mod) => {
          if (mod === 'crypto') return crypto;
          if (mod === 'fs') return fakeFs;
          throw new Error(`unknown module: ${mod}`);
        },
        fs: fakeFs,
      });
      const hashes = fn(['nonexistent.txt']);
      expect(hashes['nonexistent.txt']).toBeNull();
    });

    it('returns null when a file cannot be read', () => {
      const fakeFs = {
        readFileSync: () => {
          const error = new Error('EACCES: denied');
          error.code = 'EACCES';
          throw error;
        },
      };
      const fn = loadFunction('computeArtifactHashes', {
        require: (mod) => {
          if (mod === 'crypto') return crypto;
          if (mod === 'fs') return fakeFs;
          throw new Error(`unknown module: ${mod}`);
        },
        fs: fakeFs,
      });
      const hashes = fn(['restricted.txt']);
      expect(hashes['restricted.txt']).toBeNull();
    });

    it('hashes multiple files independently', () => {
      const fakeFs = makeFakeFs({
        'a.txt': 'content-a',
        'b.txt': 'content-b',
      });
      const fn = loadFunction('computeArtifactHashes', {
        require: (mod) => {
          if (mod === 'crypto') return crypto;
          if (mod === 'fs') return fakeFs;
          throw new Error(`unknown module: ${mod}`);
        },
        fs: fakeFs,
      });
      const hashes = fn(['a.txt', 'b.txt']);
      expect(hashes['a.txt']).not.toBe(hashes['b.txt']);
    });
  });

  // -----------------------------------------------------------------------
  // serializeManifest (redaction)
  // -----------------------------------------------------------------------
  describe('serializeManifest behavior', () => {
    function loadSerializer(token = '', url = '') {
      const sandbox = loadFunctionsTogether(
        ['escapeRegExp', 'redactSecretDiagnostics', 'serializeManifest'],
        {
          REDACTION: '[REDACTED]',
          ocrTokenForRedaction: token,
          ocrUrlForRedaction: url,
        },
      );
      return sandbox.serializeManifest;
    }

    it('produces valid JSON that round-trips', () => {
      const serialize = loadSerializer();
      const manifest = { schema_version: '1', completeness: 'complete' };
      const result = serialize(manifest);
      expect(JSON.parse(result)).toEqual(manifest);
    });

    it('redacts a secret token that appears in the manifest (AC #8)', () => {
      const secret = 'super-secret-token-1234567890';
      const serialize = loadSerializer(secret);
      const manifest = { provider_model: `model-${secret}` };
      const result = serialize(manifest);
      expect(result).not.toContain(secret);
      expect(result).toContain('[REDACTED]');
    });

    it('redacts a secret URL that appears in the manifest (AC #8)', () => {
      const url = 'https://internal-provider.example.com/v1/chat';
      const serialize = loadSerializer('', url);
      const manifest = { notes: `endpoint: ${url}` };
      const result = serialize(manifest);
      expect(result).not.toContain(url);
      expect(result).toContain('[REDACTED]');
    });

    it('preserves hash values through redaction', () => {
      const serialize = loadSerializer('secret123');
      const hash = 'sha256:abcdef0123456789';
      const manifest = { artifact_hashes: { 'ocr-result.json': hash } };
      const result = serialize(manifest);
      expect(result).toContain(hash);
    });
  });

  // -----------------------------------------------------------------------
  // buildStatusLine
  // -----------------------------------------------------------------------
  describe('buildStatusLine behavior', () => {
    function loadStatusLine() {
      return loadFunction('buildStatusLine');
    }

    it('emits "No findings." for a complete run with zero findings', () => {
      const fn = loadStatusLine();
      const result = fn({
        ran: true,
        findingsCount: 0,
        postedInline: 0,
        completeness: 'complete',
        coverage: { completed: 5, selected: 5 },
        failedFiles: [],
        policyFailure: '',
      });
      expect(result).toBe('No findings.');
    });

    it('emits a finding count for a complete run with findings', () => {
      const fn = loadStatusLine();
      const result = fn({
        ran: true,
        findingsCount: 3,
        postedInline: 2,
        completeness: 'complete',
        coverage: { completed: 5, selected: 5 },
        failedFiles: [],
        policyFailure: '',
      });
      expect(result).toContain('3 finding(s)');
    });

    it('does NOT emit "No findings." for a partial run with zero findings (AC #7)', () => {
      const fn = loadStatusLine();
      const result = fn({
        ran: true,
        findingsCount: 0,
        postedInline: 0,
        completeness: 'partial',
        coverage: { completed: 5, selected: 10 },
        failedFiles: ['c.ts', 'd.ts'],
        policyFailure: '',
      });
      expect(result).not.toBe('No findings.');
      expect(result).toContain('Partial review');
    });

    it('does NOT emit a plain finding count for a partial run with findings (AC #7)', () => {
      const fn = loadStatusLine();
      const result = fn({
        ran: true,
        findingsCount: 3,
        postedInline: 2,
        completeness: 'partial',
        coverage: { completed: 5, selected: 10 },
        failedFiles: ['c.ts'],
        policyFailure: '',
      });
      expect(result).not.toMatch(/^\d+ finding\(s\)\./);
      expect(result).toContain('Partial review');
    });

    it('includes coverage info (completed/selected) in partial status (AC #5)', () => {
      const fn = loadStatusLine();
      const result = fn({
        ran: true,
        findingsCount: 0,
        postedInline: 0,
        completeness: 'partial',
        coverage: { completed: 5, selected: 10 },
        failedFiles: ['c.ts', 'd.ts', 'e.ts'],
        policyFailure: '',
      });
      expect(result).toContain('5');
      expect(result).toContain('10');
    });

    it('safely identifies failed files count in partial status (AC #5)', () => {
      const fn = loadStatusLine();
      const result = fn({
        ran: true,
        findingsCount: 0,
        postedInline: 0,
        completeness: 'partial',
        coverage: { completed: 5, selected: 10 },
        failedFiles: ['c.ts', 'd.ts', 'e.ts'],
        policyFailure: '',
      });
      expect(result).toContain('3');
      expect(result.toLowerCase()).toContain('fail');
    });

    it('emits policy failure message when ran is false and policyFailure is set', () => {
      const fn = loadStatusLine();
      const result = fn({
        ran: false,
        findingsCount: 0,
        postedInline: 0,
        completeness: 'failed',
        coverage: { completed: 0, selected: 0 },
        failedFiles: [],
        policyFailure: 'changed test files were missing',
      });
      expect(result).toContain('OCR policy failure');
    });

    it('emits failure message when ran is false without policy failure', () => {
      const fn = loadStatusLine();
      const result = fn({
        ran: false,
        findingsCount: 0,
        postedInline: 0,
        completeness: 'failed',
        coverage: { completed: 0, selected: 0 },
        failedFiles: [],
        policyFailure: '',
      });
      expect(result).toContain('failed');
    });
  });

  // -----------------------------------------------------------------------
  // YAML wiring
  // -----------------------------------------------------------------------
  describe('YAML wiring', () => {
    it('writes the manifest to ocr-reviewed-range-manifest.json', () => {
      expect(ctx.postScript).toContain('ocr-reviewed-range-manifest.json');
    });

    it('initializes ocr-reviewed-range-manifest.json in the Initialize step', () => {
      const initStep = stepNamed(
        ctx.codeReviewJob,
        'Initialize OCR artifact files',
      );
      const initRun = commandText(initStep);
      expect(initRun).toContain(': > ocr-reviewed-range-manifest.json');
    });

    it('adds ocr-reviewed-range-manifest.json to the Redact step artifacts', () => {
      const redactStep = stepNamed(
        ctx.codeReviewJob,
        'Redact OCR diagnostic artifacts',
      );
      const redactRun = commandText(redactStep);
      expect(redactRun).toContain("'ocr-reviewed-range-manifest.json'");
    });

    it('adds ocr-reviewed-range-manifest.json to the Ensure placeholders step', () => {
      const ensureStep = stepNamed(
        ctx.codeReviewJob,
        'Ensure OCR artifact placeholders exist',
      );
      const ensureRun = commandText(ensureStep);
      expect(ensureRun).toContain('ocr-reviewed-range-manifest.json');
    });

    it('adds ocr-reviewed-range-manifest.json to the Upload artifacts step', () => {
      const uploadStep = stepNamed(ctx.codeReviewJob, 'Upload OCR artifacts');
      expect(uploadStep.with?.path).toContain(
        'ocr-reviewed-range-manifest.json',
      );
    });

    it('captures the OCR JSON status field in the Run OpenCodeReview step', () => {
      const reviewStep = stepNamed(ctx.codeReviewJob, 'Run OpenCodeReview');
      const reviewRun = commandText(reviewStep);
      expect(reviewRun).toMatch(/ocr-status|OCR_STATUS|status.*json/i);
    });

    it('writes selected files to ocr-selected-files.txt in the preview step', () => {
      const previewStep = stepNamed(
        ctx.codeReviewJob,
        'Verify review scope includes changed tests',
      );
      const previewRun = commandText(previewStep);
      expect(previewRun).toContain('ocr-selected-files.txt');
    });

    // --- C2: completedFiles inference for completed_with_errors ---
    it('does NOT set completedFiles to all selected files when ocrStatus is completed_with_errors (C2)', () => {
      const { buildReviewedRangeManifest } = loadFunctionsTogether(
        [
          'buildReviewedRangeManifest',
          'resolveCompleteness',
          'computeCoverage',
        ],
        {},
      );
      const manifest = buildReviewedRangeManifest({
        ...BASE_MANIFEST_PARAMS,
        selectedFiles: ['a.ts', 'b.ts'],
        completedFiles: ['a.ts', 'b.ts'],
        failedFiles: [],
        ocrExitCode: 0,
        ocrStatus: 'completed_with_errors',
        skipped: false,
      });
      expect(manifest.completed_files).toEqual([]);
    });

    // --- C7: isSkipped heuristic removed ---
    it('does NOT infer skipped from missing evidence (C7)', () => {
      expect(ctx.postScript).not.toContain('const isSkipped');
      expect(ctx.postScript).not.toContain('skipped: isSkipped');
    });

    // --- C4: hash computation step runs AFTER redaction ---
    it('has a "Compute reviewed-range manifest hashes" step after Redact and before Ensure placeholders (C4)', () => {
      const stepNames = ctx.codeReviewJob.steps.map((s) => s.name);
      const redactIndex = stepNames.indexOf('Redact OCR diagnostic artifacts');
      const hashIndex = stepNames.indexOf(
        'Compute reviewed-range manifest hashes',
      );
      const ensureIndex = stepNames.indexOf(
        'Ensure OCR artifact placeholders exist',
      );
      expect(redactIndex, 'Redact step should exist').toBeGreaterThanOrEqual(0);
      expect(
        hashIndex,
        'Compute reviewed-range manifest hashes step should exist',
      ).toBeGreaterThanOrEqual(0);
      expect(
        ensureIndex,
        'Ensure placeholders step should exist',
      ).toBeGreaterThanOrEqual(0);
      expect(
        hashIndex,
        'hash step must come after redact step',
      ).toBeGreaterThan(redactIndex);
      expect(
        hashIndex,
        'hash step must come before ensure placeholders step',
      ).toBeLessThan(ensureIndex);
    });

    it('the hash computation step computes SHA-256 for post-redaction artifacts (C4)', () => {
      const hashStep = stepNamed(
        ctx.codeReviewJob,
        'Compute reviewed-range manifest hashes',
      );
      const hashRun = commandText(hashStep);
      expect(hashRun).toMatch(/sha256|createHash/i);
      expect(hashRun).toContain('ocr-manifest-hashes.json');
    });

    // --- C5: ocr-status.txt in hash list ---
    it('the hash computation includes ocr-status.txt (C5)', () => {
      const hashStep = stepNamed(
        ctx.codeReviewJob,
        'Compute reviewed-range manifest hashes',
      );
      const hashRun = commandText(hashStep);
      expect(hashRun).toContain('ocr-status.txt');
    });

    // --- C6: ocr-infrastructure-failure.txt and ocr-policy-failure.txt in hash list ---
    it('the hash computation includes ocr-infrastructure-failure.txt (C6)', () => {
      const hashStep = stepNamed(
        ctx.codeReviewJob,
        'Compute reviewed-range manifest hashes',
      );
      const hashRun = commandText(hashStep);
      expect(hashRun).toContain('ocr-infrastructure-failure.txt');
    });

    it('the hash computation includes ocr-policy-failure.txt (C6)', () => {
      const hashStep = stepNamed(
        ctx.codeReviewJob,
        'Compute reviewed-range manifest hashes',
      );
      const hashRun = commandText(hashStep);
      expect(hashRun).toContain('ocr-policy-failure.txt');
    });

    // --- C8: completeness output + partial outcome branch ---
    it('exposes completeness as a job output from the classification step (C8)', () => {
      const classifyStep = stepNamed(
        ctx.codeReviewJob,
        'Resolve OCR failure classification',
      );
      const classifyRun = commandText(classifyStep);
      expect(classifyRun).toContain('completeness');
    });

    it('exposes completeness in the code-review job outputs (C8)', () => {
      expect(ctx.codeReviewJob.outputs?.completeness).toBeDefined();
    });

    it('has a "Record OCR outcome: partial" step in record-ocr-outcome (C8)', () => {
      const recordJob = ctx.workflow.jobs?.['record-ocr-outcome'];
      expect(recordJob, 'record-ocr-outcome job should exist').toBeTruthy();
      const partialStep = recordJob.steps.find(
        (s) => s.name === 'Record OCR outcome: partial',
      );
      expect(partialStep, 'should have a partial outcome step').toBeTruthy();
    });

    it('the partial outcome step runs when completeness is partial or failed (C8)', () => {
      const recordJob = ctx.workflow.jobs?.['record-ocr-outcome'];
      const partialStep = recordJob.steps.find(
        (s) => s.name === 'Record OCR outcome: partial',
      );
      const condition = String(partialStep?.if || '');
      expect(condition).toContain('partial');
      expect(condition).toContain('failed');
      expect(condition).not.toContain("completeness == 'complete'");
    });

    it('the success outcome step excludes partial/failed completeness (C8)', () => {
      const recordJob = ctx.workflow.jobs?.['record-ocr-outcome'];
      const successStep = recordJob.steps.find(
        (s) => s.name === 'Record OCR outcome: success',
      );
      const condition = String(successStep?.if || '');
      expect(condition).toContain("completeness != 'partial'");
      expect(condition).toContain("completeness != 'failed'");
    });

    // --- C9: manifest write failure → infrastructure failure ---
    it('writes to ocr-infrastructure-failure.txt when manifest write fails (C9)', () => {
      expect(ctx.postScript).toMatch(
        /manifest.*infrastructure|infrastructure.*manifest|markInfrastructureFailure.*manifest|manifest.*persistence/i,
      );
    });

    it('the hash computation step writes a detached manifest hash to ocr-manifest-sha256.txt (C4)', () => {
      const hashStep = stepNamed(
        ctx.codeReviewJob,
        'Compute reviewed-range manifest hashes',
      );
      const hashRun = commandText(hashStep);
      expect(hashRun).toContain('ocr-manifest-sha256.txt');
    });

    it('uploads ocr-manifest-hashes.json and ocr-manifest-sha256.txt (C4)', () => {
      const uploadStep = stepNamed(ctx.codeReviewJob, 'Upload OCR artifacts');
      const uploadPath = String(uploadStep.with?.path || '');
      expect(uploadPath).toContain('ocr-manifest-hashes.json');
      expect(uploadPath).toContain('ocr-manifest-sha256.txt');
    });
  });
});
