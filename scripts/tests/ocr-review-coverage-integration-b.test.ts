/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
  asNumberRecord,
  asRecord,
  asString,
  asVmFunction,
} from './typed-test-helpers.ts';
import { commandText, stepNamed } from './ocr-review-workflow-helpers.ts';
import {
  makeLoadFunctionsTogether,
  useWorkflowFixture,
} from './ocr-manifest-test-helpers.ts';

function sandboxFn(
  sandbox: Record<string, unknown>,
  name: string,
): (...args: unknown[]) => unknown {
  const fn = sandbox[name];
  if (typeof fn !== 'function') {
    throw new Error(`${name} is not a function in sandbox`);
  }
  return asVmFunction(fn);
}

describe('.github/workflows/ocr-review.yml — coverage integration & lifecycle (issue #2675)', () => {
  const ctx = useWorkflowFixture();
  const loadFunctionsTogether = makeLoadFunctionsTogether(ctx);

  function initializeArtifacts(directory: string) {
    const initStep = stepNamed(
      ctx.codeReviewJob,
      'Initialize OCR artifact files',
    );
    execFileSync('bash', ['-c', commandText(initStep)], {
      cwd: directory,
      encoding: 'utf8',
    });
  }

  function prepareMainTelemetryArtifacts(directory: string) {
    fs.writeFileSync(
      path.join(directory, 'ocr-telemetry.json'),
      '{"schema":1}\n',
    );
    fs.writeFileSync(
      path.join(directory, 'ocr-reviewed-range-manifest.json'),
      '{"artifact_hashes":{}}\n',
    );
  }

  describe('credential-like filename redaction integrity (issue #2675 finding 1)', () => {
    // A valid filename that resembles a credential pattern must NOT corrupt
    // the JSON structure when redacted. The regex `[^\s,;]+` consumes
    // structural JSON characters after stringify, breaking the artifact.
    const CREDENTIAL_LIKE_FILENAME =
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz.ts';

    function loadSerializer(token = '', url = '') {
      return loadFunctionsTogether(
        ['escapeRegExp', 'redactSecretDiagnostics', 'serializeCoverageReport'],
        {
          REDACTION: '[REDACTED]',
          ocrTokenForRedaction: token,
          ocrUrlForRedaction: url,
        },
      );
    }

    it('serializeCoverageReport keeps valid JSON with a credential-like filename', () => {
      const serialize = sandboxFn(loadSerializer(), 'serializeCoverageReport');
      const report = {
        schema_version: '1.0.0',
        preview_files: [CREDENTIAL_LIKE_FILENAME],
        covered_files: [CREDENTIAL_LIKE_FILENAME],
      };
      const serialized = asString(serialize(report));
      expect(() => JSON.parse(serialized)).not.toThrow();
    });

    it('serializeCoverageReport preserves JSON structure integrity for credential-like filename', () => {
      const serialize = sandboxFn(loadSerializer(), 'serializeCoverageReport');
      const report = { preview_files: [CREDENTIAL_LIKE_FILENAME] };
      const serialized = asString(serialize(report));
      expect(() => JSON.parse(serialized)).not.toThrow();
      // The serialized output must be valid JSON with the preview_files array
      // intact (the value may be redacted, but the JSON structure must not
      // be corrupted by raw regex over the serialized string).
      const parsed = asRecord(JSON.parse(serialized));
      expect(Array.isArray(parsed['preview_files'])).toBe(true);
      expect(parsed['preview_files']).toHaveLength(1);
    });

    it('full lifecycle: serialize → validate → redact → hash stays consistent', () => {
      const sub = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-cred-life-'));
      try {
        initializeArtifacts(sub);
        prepareMainTelemetryArtifacts(sub);
        const serializeCoverageReport = sandboxFn(
          loadSerializer(),
          'serializeCoverageReport',
        );
        const report = {
          schema_version: '1.0.0',
          counts: { preview: 1, covered: 1 },
          coverage: { ratio: 1, percentage: 100 },
          preview_files: [CREDENTIAL_LIKE_FILENAME],
          covered_files: [CREDENTIAL_LIKE_FILENAME],
        };
        const serialized = String(serializeCoverageReport(report));
        expect(() => JSON.parse(serialized)).not.toThrow();
        fs.writeFileSync(
          path.join(sub, 'ocr-coverage-report.json'),
          serialized,
        );

        // Run the real "Ensure valid OCR coverage report" step
        const ensureStep = stepNamed(
          ctx.codeReviewJob,
          'Ensure valid OCR coverage report',
        );
        execFileSync('bash', ['-c', commandText(ensureStep)], {
          cwd: sub,
          encoding: 'utf8',
        });

        // Run the real "Redact OCR diagnostic artifacts" step on the report
        const redactStep = stepNamed(
          ctx.codeReviewJob,
          'Redact OCR diagnostic artifacts',
        );
        const redactScript = commandText(redactStep);
        // Write only the coverage report, then execute the redact node script
        const redactWrapper = ['set -euo pipefail', redactScript].join('\n');
        execFileSync('bash', ['-c', redactWrapper], {
          cwd: sub,
          encoding: 'utf8',
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            OCR_LLM_TOKEN: '',
            OCR_LLM_URL: '',
          },
        });

        // Run the real "Compute reviewed-range manifest hashes" step
        const hashStep = stepNamed(
          ctx.codeReviewJob,
          'Compute reviewed-range manifest hashes',
        );
        execFileSync('bash', ['-c', commandText(hashStep)], {
          cwd: sub,
          encoding: 'utf8',
          env: {
            ...process.env,
            GITHUB_OUTPUT: path.join(sub, 'github-output.txt'),
          },
        });

        // The final report must be valid JSON after redaction
        const finalBytes = fs.readFileSync(
          path.join(sub, 'ocr-coverage-report.json'),
          'utf8',
        );
        expect(() => JSON.parse(finalBytes)).not.toThrow();

        // The hash must match the final (post-redaction) bytes
        const hashes = JSON.parse(
          fs.readFileSync(path.join(sub, 'ocr-manifest-hashes.json'), 'utf8'),
        );
        const expectedHash = crypto
          .createHash('sha256')
          .update(finalBytes)
          .digest('hex');
        expect(hashes['ocr-coverage-report.json']).toBe(
          `sha256:${expectedHash}`,
        );
      } finally {
        fs.rmSync(sub, { recursive: true, force: true });
      }
    });

    it('standalone redaction step parses JSON values instead of raw regex on the serialized string', () => {
      const redactStep = stepNamed(
        ctx.codeReviewJob,
        'Redact OCR diagnostic artifacts',
      );
      const redactScript = commandText(redactStep);
      // The redact step must handle .json files by parsing/redacting values,
      // not by running raw regex over the serialized JSON string.
      expect(redactScript).toMatch(/endsWith\(['"]\.json['"]\)/);
      // Must contain JSON-aware redaction (parse → redact values → reserialize)
      expect(redactScript).toMatch(/JSON\.parse/);
    });
  });

  describe('no-op coverage report (issue #2675 finding 3)', () => {
    function loadNoopPipeline() {
      return loadFunctionsTogether(
        [
          'normalizeFilePaths',
          'resolveCoverageThreshold',
          'computeFileCoverage',
          'buildCoverageReport',
        ],
        {
          REDACTION: '[REDACTED]',
          ocrTokenForRedaction: '',
          ocrUrlForRedaction: '',
        },
      );
    }

    it('no-op report marks evidence unavailable and review not run', () => {
      const sandbox = loadNoopPipeline();
      const buildCoverageReport = sandboxFn(sandbox, 'buildCoverageReport');
      const report = asRecord(
        buildCoverageReport({
          previewFiles: [],
          evidencedFiles: [],
          readFailureFiles: [],
          thresholdPercentage: 90,
          evidenceAvailable: false,
        }),
      );
      expect(report['evidence_available']).toBe(false);
    });

    it('the post script sets evidence_available false for noop', () => {
      const start = ctx.postScript.indexOf(
        'const isNoop = process.env.RANGE_MODE',
      );
      expect(start, 'post script should define isNoop').toBeGreaterThanOrEqual(
        0,
      );
      const noopBlockEnd = ctx.postScript.indexOf('} else {', start);
      expect(noopBlockEnd, 'noop block should end before else').toBeGreaterThan(
        start,
      );
      const noopBlock = ctx.postScript.slice(start, noopBlockEnd);
      expect(noopBlock).toMatch(/evidenceAvailable:\s*false/);
      expect(noopBlock).toMatch(/review_ran/);
      expect(noopBlock).toMatch(/coverageReport\.range_mode/);
    });
  });

  describe('threshold warning orchestration (issue #2675 finding 4)', () => {
    function loadOrchestrationPipeline() {
      return loadFunctionsTogether(
        [
          'normalizeFilePaths',
          'resolveCoverageThreshold',
          'computeFileCoverage',
          'buildCoverageReport',
          'coverageWarningText',
        ],
        {
          REDACTION: '[REDACTED]',
          ocrTokenForRedaction: '',
          ocrUrlForRedaction: '',
        },
      );
    }

    it('does not state "100% is below 90%" for a read/review failure at 100%', () => {
      const sandbox = loadOrchestrationPipeline();
      const buildCoverageReport = sandboxFn(sandbox, 'buildCoverageReport');
      const coverageWarningText = sandboxFn(sandbox, 'coverageWarningText');
      const report = asRecord(
        buildCoverageReport({
          previewFiles: ['a.ts', 'b.ts'],
          evidencedFiles: ['a.ts', 'b.ts'],
          readFailureFiles: ['outside.ts'],
          thresholdPercentage: 90,
        }),
      );
      const coverage = asNumberRecord(report['coverage']);
      expect(coverage['percentage']).toBe(100);
      expect(report['ratio_below_threshold']).toBe(false);
      expect(report['has_review_failures']).toBe(true);
      const text = asString(coverageWarningText(report));
      expect(text).not.toMatch(/100%.*is below the.*90%/);
      expect(text).toMatch(/read\/review failure/i);
    });

    it('states "is below the 90% threshold" for 89.5% ratio', () => {
      const sandbox = loadOrchestrationPipeline();
      const buildCoverageReport = sandboxFn(sandbox, 'buildCoverageReport');
      const coverageWarningText = sandboxFn(sandbox, 'coverageWarningText');
      const preview = Array.from({ length: 200 }, (_, i) => `f${i}.ts`);
      const covered = preview.slice(0, 179);
      const report = asRecord(
        buildCoverageReport({
          previewFiles: preview,
          evidencedFiles: covered,
          readFailureFiles: [],
          thresholdPercentage: 90,
        }),
      );
      expect(report['ratio_below_threshold']).toBe(true);
      expect(report['has_review_failures']).toBe(false);
      const text = asString(coverageWarningText(report));
      expect(text).toContain('below the');
      expect(text).toContain('90%');
    });

    it('emits a separate generic review/read failure warning outside preview', () => {
      const sandbox = loadOrchestrationPipeline();
      const buildCoverageReport = sandboxFn(sandbox, 'buildCoverageReport');
      const coverageWarningText = sandboxFn(sandbox, 'coverageWarningText');
      const report = asRecord(
        buildCoverageReport({
          previewFiles: ['a.ts'],
          evidencedFiles: ['a.ts'],
          readFailureFiles: ['not-in-preview.ts'],
          thresholdPercentage: 90,
        }),
      );
      const text = asString(coverageWarningText(report));
      expect(text).toMatch(/read\/review failure/i);
      expect(text).not.toMatch(/100%.*below/);
    });

    it('the post script gates the threshold warning on ratio_below_threshold', () => {
      // The orchestration in the post step must not emit the "below threshold"
      // warning based on the combined below_threshold flag; it must gate on
      // ratio_below_threshold separately so a read-failure-only scenario at
      // 100% coverage does not falsely state "100% is below 90%".
      expect(ctx.postScript).toMatch(/coverageReport\.ratio_below_threshold/);
      const scriptGate = ctx.postScript.indexOf(
        'if (coverageReport.ratio_below_threshold)',
      );
      const warningCall = ctx.postScript.indexOf(
        'core.warning(`Changed-file coverage',
        scriptGate,
      );
      const nextFailureGate = ctx.postScript.indexOf(
        'if (coverageReport.has_review_failures)',
        scriptGate,
      );
      expect(scriptGate).toBeGreaterThanOrEqual(0);
      expect(warningCall).toBeGreaterThan(scriptGate);
      expect(nextFailureGate).toBeGreaterThan(warningCall);
      expect(ctx.postScript.slice(warningCall, nextFailureGate)).toContain(
        'below the ${coverageReport.threshold_percentage}% threshold.',
      );
    });

    it('keeps the auto-review metadata comment after the coverage warning', () => {
      const warningPush = ctx.postScript.indexOf(
        'body.push(`- ${coverageWarning}`)',
      );
      const autoCountPush = ctx.postScript.indexOf(
        'body.push(`\\n<!-- ocr-auto-count:${autoReviewCount} -->`)',
        warningPush,
      );
      expect(warningPush).toBeGreaterThanOrEqual(0);
      expect(autoCountPush).toBeGreaterThan(warningPush);
    });
  });

  describe('core.setFailed absence test (non-vacuous, issue #2675 finding 6)', () => {
    it('never calls core.setFailed for low coverage or read failures', () => {
      // Anchor on the function declaration start and the next top-level
      // const after the coverage block so the slice is well-defined.
      const startMarker = 'coverageThreshold = resolveCoverageThreshold';
      const start = ctx.postScript.indexOf(startMarker);
      expect(
        start,
        `post script should contain "${startMarker}"`,
      ).toBeGreaterThanOrEqual(0);
      const endMarker = 'const summary = body.join';
      const end = ctx.postScript.indexOf(endMarker, start);
      expect(
        end,
        `post script should contain "${endMarker}" after the coverage block`,
      ).toBeGreaterThan(start);
      const coverageBlock = ctx.postScript.slice(start, end);
      expect(coverageBlock).not.toContain('core.setFailed');
    });
  });
});
