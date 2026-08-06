/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import { describe, expect, it } from 'bun:test';
import {
  asOptionalRecord,
  asRecord,
  asString,
  asVmFunction,
  jobSteps,
  workflowJobOptional,
} from './typed-test-helpers.ts';
import type { WorkflowDocument } from './typed-test-helpers.ts';
import { commandText, stepNamed } from './ocr-review-workflow-helpers.ts';
import {
  BASE_MANIFEST_PARAMS,
  makeLoadFunction,
  makeLoadFunctionsTogether,
  useWorkflowFixture,
} from './ocr-manifest-test-helpers.ts';

describe('.github/workflows/ocr-review.yml — manifest artifacts & YAML wiring (issue #2575)', () => {
  const ctx = useWorkflowFixture();
  const loadFunction = makeLoadFunction(ctx);
  const loadFunctionsTogether = makeLoadFunctionsTogether(ctx);

  // -----------------------------------------------------------------------
  // computeArtifactHashes
  // -----------------------------------------------------------------------
  describe('computeArtifactHashes behavior', () => {
    function makeFakeFs(files: Record<string, string>) {
      return {
        readFileSync: (name: string): string => {
          if (!(name in files)) {
            const err = Object.assign(new Error(`ENOENT: ${name}`), {
              code: 'ENOENT',
            });
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
        require: (mod: string) => {
          if (mod === 'crypto') return crypto;
          if (mod === 'fs') return fakeFs;
          throw new Error(`unknown module: ${mod}`);
        },
        fs: fakeFs,
      });
      const hashes = asRecord(fn(['ocr-result.json']));
      expect(hashes['ocr-result.json']).toBe(expectedHash);
    });

    it('prefixes each hash with sha256:', () => {
      const fakeFs = makeFakeFs({ 'ocr-stdout.raw': 'data' });
      const fn = loadFunction('computeArtifactHashes', {
        require: (mod: string) => {
          if (mod === 'crypto') return crypto;
          if (mod === 'fs') return fakeFs;
          throw new Error(`unknown module: ${mod}`);
        },
        fs: fakeFs,
      });
      const hashes = asRecord(fn(['ocr-stdout.raw']));
      expect(hashes['ocr-stdout.raw']).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it('returns null for a missing file instead of throwing', () => {
      const fakeFs = makeFakeFs({});
      const fn = loadFunction('computeArtifactHashes', {
        require: (mod: string) => {
          if (mod === 'crypto') return crypto;
          if (mod === 'fs') return fakeFs;
          throw new Error(`unknown module: ${mod}`);
        },
        fs: fakeFs,
      });
      const hashes = asRecord(fn(['nonexistent.txt']));
      expect(hashes['nonexistent.txt']).toBeNull();
    });

    it('returns null when a file cannot be read', () => {
      const fakeFs = {
        readFileSync: (): string => {
          const error = Object.assign(new Error('EACCES: denied'), {
            code: 'EACCES',
          });
          throw error;
        },
      };
      const fn = loadFunction('computeArtifactHashes', {
        require: (mod: string) => {
          if (mod === 'crypto') return crypto;
          if (mod === 'fs') return fakeFs;
          throw new Error(`unknown module: ${mod}`);
        },
        fs: fakeFs,
      });
      const hashes = asRecord(fn(['restricted.txt']));
      expect(hashes['restricted.txt']).toBeNull();
    });

    it('hashes multiple files independently', () => {
      const fakeFs = makeFakeFs({
        'a.txt': 'content-a',
        'b.txt': 'content-b',
      });
      const fn = loadFunction('computeArtifactHashes', {
        require: (mod: string) => {
          if (mod === 'crypto') return crypto;
          if (mod === 'fs') return fakeFs;
          throw new Error(`unknown module: ${mod}`);
        },
        fs: fakeFs,
      });
      const hashes = asRecord(fn(['a.txt', 'b.txt']));
      expect(hashes['a.txt']).not.toBe(hashes['b.txt']);
    });
  });

  describe('OCR result coverage metadata', () => {
    it('parses an object envelope without changing array fallback behavior', () => {
      const fn = loadFunction('resultEnvelopeFromRaw');
      expect(fn('{"status":"success","comments":[]}')).toEqual({
        status: 'success',
        comments: [],
      });
    });

    it('returns null for output that is not a JSON object envelope', () => {
      const fn = loadFunction('resultEnvelopeFromRaw');
      expect(fn('progress\n[]')).toBeNull();
    });

    it('extracts unique failed paths from OCR subtask errors', () => {
      const fn = loadFunction('failedFilesFromResult');
      const result = fn({
        warnings: [
          { type: 'subtask_error', file: 'src/a.ts', message: 'timeout' },
          { type: 'warning', file: 'src/b.ts', message: 'large file' },
          { type: 'subtask_error', file: 'src/a.ts', message: 'retry failed' },
          { type: 'subtask_error', file: ' src/c.ts ', message: 'error' },
        ],
      });
      expect(result).toEqual(['src/a.ts', 'src/c.ts']);
    });

    it('returns no failed paths when the OCR envelope has no warnings', () => {
      const fn = loadFunction('failedFilesFromResult');
      expect(fn(null)).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Issue #2929: terminal-status regression coverage for the 1.8.x envelope.
  // Pins the fail-closed contract against the new additive fields and
  // terminal states introduced upstream (budget_exceeded, summary.budget_exceeded,
  // subtask_error warnings on completed_with_errors).
  // -----------------------------------------------------------------------
  describe('OCR 1.8.x terminal-status fail-closed contract', () => {
    it('budget_exceeded status yields an empty eligible completed set and partial completeness', () => {
      const eligible = loadFunction('eligibleCompletedFilesForReview');
      const selected = ['src/a.ts', 'src/b.ts'];
      const result = eligible({
        ran: true,
        exitCode: 0,
        previewValidated: true,
        ocrStatus: 'budget_exceeded',
        eligibleFiles: selected,
        completedFiles: selected.length,
        completedFilesValid: true,
      });
      expect(result).toEqual([]);

      const completeness = loadFunction('resolveCompleteness');
      expect(
        completeness({
          ocrExitCode: 0,
          ocrStatus: 'budget_exceeded',
          selectedFiles: selected,
          completedFiles: selected,
          failedFiles: [],
          reusedFiles: [],
          waivedFiles: [],
          skipped: false,
        }),
      ).toBe('partial');
    });

    it('completed_with_errors with a subtask_error warning reports that file as failed and is not complete', () => {
      // This is the exact real 1.8.4 envelope captured in EVIDENCE.md.
      const envelope = {
        status: 'completed_with_errors',
        message: 'Some files could not be reviewed due to errors.',
        summary: {
          files_reviewed: 2,
          comments: 0,
          total_tokens: 92295,
          input_tokens: 90747,
          output_tokens: 1548,
          cache_read_tokens: 73792,
          elapsed: '1m36s',
        },
        comments: [],
        warnings: [
          {
            type: 'subtask_error',
            file: 'packages/cli/src/ui/utils/commandUtils.ts',
            message: 'main_task did not complete before stopping',
          },
        ],
        session_id: 'ff715c9b-38c6-4510-9042-ebda3ce05931',
      };
      const failedFiles = loadFunction('failedFilesFromResult');
      expect(failedFiles(envelope)).toEqual([
        'packages/cli/src/ui/utils/commandUtils.ts',
      ]);

      const completeness = loadFunction('resolveCompleteness');
      expect(
        completeness({
          ocrExitCode: 0,
          ocrStatus: 'completed_with_errors',
          selectedFiles: [
            'packages/cli/src/ui/utils/commandUtils.ts',
            'packages/cli/src/other.ts',
          ],
          completedFiles: ['packages/cli/src/other.ts'],
          failedFiles: ['packages/cli/src/ui/utils/commandUtils.ts'],
          reusedFiles: [],
          waivedFiles: [],
          skipped: false,
        }),
      ).toBe('partial');
    });

    it('an additive summary.budget_exceeded field does not invalidate the summary projection', () => {
      const sandbox = loadFunctionsTogether([
        'completionStateForResult',
        'ocrObservabilityFromResult',
      ]);
      const observability = asVmFunction(sandbox.ocrObservabilityFromResult);
      const result = asRecord(
        observability({
          status: 'success',
          summary: {
            files_reviewed: 3,
            comments: 1,
            total_tokens: 5000,
            input_tokens: 4500,
            output_tokens: 500,
            cache_read_tokens: 1000,
            cache_write_tokens: 200,
            elapsed: '12s',
            budget_exceeded: true,
          },
          comments: [{ path: 'src/a.ts' }],
          session_id: 'abc-123',
        }),
      );
      // The unknown extra field must not invalidate the summary counters.
      expect(result['completed_files']).toBe(3);
      expect(result['completed_files_valid']).toBe(true);
      const tokens = asRecord(result['tokens']);
      expect(tokens['total']).toBe(5000);
      expect(tokens['input']).toBe(4500);
      expect(tokens['output']).toBe(500);
      expect(tokens['cache_read']).toBe(1000);
      expect(tokens['cache_write']).toBe(200);
      expect(result['elapsed']).toBe('12s');
    });
  });

  // -----------------------------------------------------------------------
  // serializeManifest (redaction)
  // -----------------------------------------------------------------------
  describe('serializeManifest behavior', () => {
    function loadSerializer(token = '', url = ''): (input: unknown) => string {
      const sandbox = loadFunctionsTogether(
        ['escapeRegExp', 'redactSecretDiagnostics', 'serializeManifest'],
        {
          REDACTION: '[REDACTED]',
          ocrTokenForRedaction: token,
          ocrUrlForRedaction: url,
        },
      );
      const fn = asVmFunction(sandbox.serializeManifest);
      return (input: unknown): string => asString(fn(input));
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
      const result = asString(
        fn({
          ran: true,
          findingsCount: 0,
          postedInline: 0,
          completeness: 'complete',
          coverage: { completed: 5, selected: 5 },
          failedFiles: [],
          policyFailure: '',
        }),
      );
      expect(result).toBe('No findings.');
    });

    it('emits a finding count for a complete run with findings', () => {
      const fn = loadStatusLine();
      const result = asString(
        fn({
          ran: true,
          findingsCount: 3,
          postedInline: 2,
          completeness: 'complete',
          coverage: { completed: 5, selected: 5 },
          failedFiles: [],
          policyFailure: '',
        }),
      );
      expect(result).toContain('3 finding(s)');
    });

    it('does NOT emit "No findings." for a partial run with zero findings (AC #7)', () => {
      const fn = loadStatusLine();
      const result = asString(
        fn({
          ran: true,
          findingsCount: 0,
          postedInline: 0,
          completeness: 'partial',
          coverage: { completed: 5, selected: 10 },
          failedFiles: ['c.ts', 'd.ts'],
          policyFailure: '',
        }),
      );
      expect(result).not.toBe('No findings.');
      expect(result).toContain('Partial review');
    });

    it('does NOT emit a plain finding count for a partial run with findings (AC #7)', () => {
      const fn = loadStatusLine();
      const result = asString(
        fn({
          ran: true,
          findingsCount: 3,
          postedInline: 2,
          completeness: 'partial',
          coverage: { completed: 5, selected: 10 },
          failedFiles: ['c.ts'],
          policyFailure: '',
        }),
      );
      expect(result).not.toMatch(/^\d+ finding\(s\)\./);
      expect(result).toContain('Partial review');
    });

    it('includes coverage info (completed/selected) in partial status (AC #5)', () => {
      const fn = loadStatusLine();
      const result = asString(
        fn({
          ran: true,
          findingsCount: 0,
          postedInline: 0,
          completeness: 'partial',
          coverage: { completed: 5, selected: 10 },
          failedFiles: ['c.ts', 'd.ts', 'e.ts'],
          policyFailure: '',
        }),
      );
      expect(result).toContain('5');
      expect(result).toContain('10');
    });

    it('safely identifies failed files count in partial status (AC #5)', () => {
      const fn = loadStatusLine();
      const result = asString(
        fn({
          ran: true,
          findingsCount: 0,
          postedInline: 0,
          completeness: 'partial',
          coverage: { completed: 5, selected: 10 },
          failedFiles: ['c.ts', 'd.ts', 'e.ts'],
          policyFailure: '',
        }),
      );
      expect(result).toContain('3');
      expect(result.toLowerCase()).toContain('fail');
    });

    it('emits policy failure message when ran is false and policyFailure is set', () => {
      const fn = loadStatusLine();
      const result = asString(
        fn({
          ran: false,
          findingsCount: 0,
          postedInline: 0,
          completeness: 'failed',
          coverage: { completed: 0, selected: 0 },
          failedFiles: [],
          policyFailure: 'changed test files were missing',
        }),
      );
      expect(result).toContain('OCR policy failure');
    });

    it('emits failure message when ran is false without policy failure', () => {
      const fn = loadStatusLine();
      const result = asString(
        fn({
          ran: false,
          findingsCount: 0,
          postedInline: 0,
          completeness: 'failed',
          coverage: { completed: 0, selected: 0 },
          failedFiles: [],
          policyFailure: '',
        }),
      );
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
      expect(asOptionalRecord(uploadStep.with)?.path).toContain(
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
      const sandbox = loadFunctionsTogether(
        [
          'buildReviewedRangeManifest',
          'resolveCompleteness',
          'computeCoverage',
        ],
        {},
      );
      const buildReviewedRangeManifest = asVmFunction(
        sandbox.buildReviewedRangeManifest,
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
      expect(asRecord(manifest).completed_files).toEqual([]);
    });

    // --- C7: isSkipped heuristic removed ---
    it('does NOT infer skipped from missing evidence (C7)', () => {
      expect(ctx.postScript).not.toContain('const isSkipped');
      expect(ctx.postScript).not.toContain('skipped: isSkipped');
    });

    // --- C4: hash computation step runs AFTER redaction ---
    it('has a "Compute reviewed-range manifest hashes" step after Redact and before Ensure placeholders (C4)', () => {
      const steps = jobSteps(ctx.codeReviewJob);
      const stepNames = steps.map((s) => asString(s.name));
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
        ensureIndex,
        'placeholder recovery must precede telemetry and final hashing',
      ).toBeLessThan(hashIndex);
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
      expect(
        asOptionalRecord(ctx.codeReviewJob['outputs'])?.['completeness'],
      ).toBeDefined();
    });

    it('has a "Record OCR outcome: partial" step in record-ocr-outcome (C8)', () => {
      const workflow = ctx.workflow satisfies WorkflowDocument;
      const recordJob = workflowJobOptional(workflow, 'record-ocr-outcome');
      expect(recordJob, 'record-ocr-outcome job should exist').toBeTruthy();
      if (!recordJob) throw new Error('record-ocr-outcome job should exist');
      const steps = jobSteps(recordJob);
      const partialStep = steps.find(
        (s) => s.name === 'Record OCR outcome: partial',
      );
      expect(partialStep, 'should have a partial outcome step').toBeTruthy();
    });

    it('the partial outcome step runs when completeness is partial or failed (C8)', () => {
      const workflow = ctx.workflow satisfies WorkflowDocument;
      const recordJob = workflowJobOptional(workflow, 'record-ocr-outcome');
      const steps = jobSteps(recordJob);
      const partialStep = steps.find(
        (s) => s.name === 'Record OCR outcome: partial',
      );
      const condition = String(partialStep?.if || '');
      expect(condition).toContain('partial');
      expect(condition).toContain('failed');
      expect(condition).not.toContain("completeness == 'complete'");
    });

    it('the success outcome step excludes partial/failed completeness (C8)', () => {
      const workflow = ctx.workflow satisfies WorkflowDocument;
      const recordJob = workflowJobOptional(workflow, 'record-ocr-outcome');
      const steps = jobSteps(recordJob);
      const successStep = steps.find(
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
      const uploadPath = String(asOptionalRecord(uploadStep.with)?.path || '');
      expect(uploadPath).toContain('ocr-manifest-hashes.json');
      expect(uploadPath).toContain('ocr-manifest-sha256.txt');
    });

    it('gates artifact upload on source redaction and valid hashes', () => {
      const uploadStep = stepNamed(ctx.codeReviewJob, 'Upload OCR artifacts');
      const condition = String(uploadStep.if);
      expect(condition).toContain(
        "steps.redact-ocr-artifacts.outcome == 'success'",
      );
      expect(condition).toContain(
        "steps.ocr-manifest-hashes.outputs.valid == 'true'",
      );
    });
  });

  describe('checkpoint evidence wiring (issue #2861)', () => {
    it('wires the immutable eligible set through manifest, coverage, decision, and persistence', () => {
      const decisionIndex = ctx.postScript.indexOf(
        'const checkpointDecision = {',
      );
      const decisionBlock = ctx.postScript.slice(
        decisionIndex,
        decisionIndex + 800,
      );

      expect(decisionBlock).toContain(
        'completedFiles: eligibleCompletedFiles.length',
      );
      expect(decisionBlock).toContain('manifestCompleteness');
      expect(decisionBlock).toContain('completedFilesValid');
      expect(decisionBlock).toContain('ocrCompletedFiles');
      expect(decisionBlock).toContain('previewValidated');
    });

    it('re-reads infrastructure failure immediately before checkpoint evaluation', () => {
      const decisionIndex = ctx.postScript.indexOf(
        'const checkpointDecision = {',
      );
      const rereadIndex = ctx.postScript.lastIndexOf(
        "readTrimmed(INFRA_FAILURE_FILE, '')",
        decisionIndex,
      );
      const manifestWriteIndex = ctx.postScript.indexOf(
        "fs.writeFileSync('ocr-reviewed-range-manifest.json'",
      );

      expect(rereadIndex).toBeGreaterThan(manifestWriteIndex);
      expect(ctx.postScript.slice(rereadIndex, decisionIndex)).not.toContain(
        'const manifest =',
      );
    });
  });
});
