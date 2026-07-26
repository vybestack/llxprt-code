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
import vm from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  makeLoadFunctionsTogether,
  useWorkflowFixture,
} from './ocr-manifest-test-helpers.js';
import {
  commandText,
  extractFunctionSource,
  stepNamed,
} from './ocr-review-workflow-helpers.js';

const VM_TIMEOUT_MS = 2000;
const SANDBOX_GLOBALS = {
  Number,
  Math,
  JSON,
  String,
  Object,
  Array,
  Boolean,
  Error,
  Set,
  Map,
};

let tmpDir;
beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-cov-int-'));
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('.github/workflows/ocr-review.yml — coverage integration & lifecycle (issue #2675)', () => {
  const ctx = useWorkflowFixture();
  const loadFunctionsTogether = makeLoadFunctionsTogether(ctx);

  function initializeArtifacts(directory) {
    const initStep = stepNamed(
      ctx.codeReviewJob,
      'Initialize OCR artifact files',
    );
    execFileSync('bash', ['-c', commandText(initStep)], {
      cwd: directory,
      encoding: 'utf8',
    });
  }

  function prepareMainTelemetryArtifacts(directory) {
    fs.writeFileSync(
      path.join(directory, 'ocr-telemetry.json'),
      '{"schema":1}\n',
    );
    fs.writeFileSync(
      path.join(directory, 'ocr-reviewed-range-manifest.json'),
      '{"artifact_hashes":{}}\n',
    );
  }

  describe('YAML wiring', () => {
    it('wires RANGE_MODE into the preview step env', () => {
      const previewStep = stepNamed(
        ctx.codeReviewJob,
        'Verify review scope includes changed tests',
      );
      expect(previewStep.env?.RANGE_MODE).toContain(
        'steps.resolve-range.outputs.RANGE_MODE',
      );
    });

    it('wires OCR_COVERAGE_THRESHOLD into the Post OCR results env', () => {
      expect(ctx.postStep.env?.OCR_COVERAGE_THRESHOLD).toContain(
        'vars.OCR_COVERAGE_THRESHOLD',
      );
    });

    it('adds ocr-coverage-report.json to the Redact step artifacts', () => {
      const redactStep = stepNamed(
        ctx.codeReviewJob,
        'Redact OCR diagnostic artifacts',
      );
      expect(commandText(redactStep)).toContain("'ocr-coverage-report.json'");
    });

    it('adds ocr-coverage-report.json to the hash computation step', () => {
      const hashStep = stepNamed(
        ctx.codeReviewJob,
        'Compute reviewed-range manifest hashes',
      );
      expect(commandText(hashStep)).toContain('ocr-coverage-report.json');
    });

    it('adds ocr-coverage-report.json to the Upload artifacts step', () => {
      const uploadStep = stepNamed(ctx.codeReviewJob, 'Upload OCR artifacts');
      expect(uploadStep.with?.path).toContain('ocr-coverage-report.json');
    });

    it('writes and logs the coverage report in the Post OCR results step', () => {
      expect(ctx.postScript).toContain('ocr-coverage-report.json');
      expect(ctx.postScript).toContain('buildCoverageReport');
      expect(ctx.postScript).toContain('coverageWarningText');
    });

    it('reads OCR_COVERAGE_THRESHOLD with a default of 90 in the post script', () => {
      expect(ctx.postScript).toContain('OCR_COVERAGE_THRESHOLD');
      expect(ctx.postScript).toContain('resolveCoverageThreshold');
    });

    it('unions subtask_error failures with stderr read failures in the post script', () => {
      expect(ctx.postScript).toContain('failedFilesFromResult');
      expect(ctx.postScript).toContain('readFailuresFromStderr');
    });

    it('coverage block never calls core.setFailed for low coverage or read failures', () => {
      const start = ctx.postScript.indexOf(
        'coverageThreshold = resolveCoverageThreshold',
      );
      const end = ctx.postScript.indexOf('const summary = body.join', start);
      const coverageBlock = ctx.postScript.slice(
        start,
        end > start ? end : undefined,
      );
      expect(coverageBlock).not.toContain('core.setFailed');
    });

    it('ensures ocr-coverage-report.json exists with valid JSON before redaction', () => {
      const ensureStep = stepNamed(
        ctx.codeReviewJob,
        'Ensure valid OCR coverage report',
      );
      expect(ensureStep).toBeDefined();
      const ensureRun = commandText(ensureStep);
      expect(ensureRun).toContain('ocr-coverage-report.json');
    });

    it('ensures the Ensure valid coverage step runs BEFORE Redact', () => {
      const steps = ctx.codeReviewJob.steps;
      const ensureIdx = steps.findIndex(
        (s) => s.name === 'Ensure valid OCR coverage report',
      );
      const redactIdx = steps.findIndex(
        (s) => s.name === 'Redact OCR diagnostic artifacts',
      );
      expect(ensureIdx).toBeGreaterThanOrEqual(0);
      expect(redactIdx).toBeGreaterThanOrEqual(0);
      expect(ensureIdx).toBeLessThan(redactIdx);
    });

    it('removes ocr-coverage-report.json from the post-hash Ensure placeholders step', () => {
      const ensureStep = stepNamed(
        ctx.codeReviewJob,
        'Ensure OCR artifact placeholders exist',
      );
      const ensureRun = commandText(ensureStep);
      expect(ensureRun).not.toMatch(
        /ocr-coverage-report\.json.*schema_version.*below_threshold/,
      );
    });
  });

  describe('failed-review coverage integration (ran=false with preview files)', () => {
    function loadCoveragePipeline() {
      const sandbox = loadFunctionsTogether(
        [
          'normalizeFilePaths',
          'evidencedPathsFromResult',
          'readFailuresFromStderr',
          'resolveCoverageThreshold',
          'computeFileCoverage',
          'buildCoverageReport',
          'coverageWarningText',
          'serializeCoverageReport',
        ],
        {
          REDACTION: '[REDACTED]',
          ocrTokenForRedaction: '',
          ocrUrlForRedaction: '',
        },
      );
      return sandbox;
    }

    it('a failed review with preview files must show gaps (not 0/0=100%)', () => {
      const { buildCoverageReport, coverageWarningText } =
        loadCoveragePipeline();
      const report = buildCoverageReport({
        previewFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        evidencedFiles: [],
        readFailureFiles: ['src/a.ts'],
        thresholdPercentage: 90,
      });
      expect(report.counts.preview).toBe(3);
      expect(report.counts.covered).toBe(0);
      expect(report.counts.failed_preview).toBe(1);
      expect(report.counts.preview_only).toBe(2);
      expect(report.coverage.percentage).toBe(0);
      expect(report.has_review_failures).toBe(true);
      expect(report.below_threshold).toBe(true);
      const warning = coverageWarningText(report);
      expect(warning).toContain('0/3');
    });

    it('a failed review with evidence_available=false marks unavailable result evidence', () => {
      const { buildCoverageReport } = loadCoveragePipeline();
      const report = buildCoverageReport({
        previewFiles: ['src/a.ts'],
        evidencedFiles: [],
        readFailureFiles: [],
        thresholdPercentage: 90,
        evidenceAvailable: false,
      });
      expect(report.evidence_available).toBe(false);
      expect(report.counts.preview).toBe(1);
      expect(report.counts.covered).toBe(0);
    });
  });

  describe('artifact hash lifecycle (ensure-before-hash)', () => {
    it('hash matches uploaded bytes after a complete lifecycle (normal case)', () => {
      const sub = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-hash-life-'));
      try {
        initializeArtifacts(sub);
        prepareMainTelemetryArtifacts(sub);
        const report = {
          schema_version: '1.0.0',
          counts: { preview: 2, covered: 1 },
          coverage: { ratio: 0.5, percentage: 50 },
        };
        fs.writeFileSync(
          path.join(sub, 'ocr-coverage-report.json'),
          JSON.stringify(report, null, 2),
        );

        const ensureStep = stepNamed(
          ctx.codeReviewJob,
          'Ensure valid OCR coverage report',
        );
        execFileSync('bash', ['-c', commandText(ensureStep)], {
          cwd: sub,
          encoding: 'utf8',
        });

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

        const placeholderStep = stepNamed(
          ctx.codeReviewJob,
          'Ensure OCR artifact placeholders exist',
        );
        execFileSync('bash', ['-c', commandText(placeholderStep)], {
          cwd: sub,
          encoding: 'utf8',
          env: {
            ...process.env,
            GITHUB_OUTPUT: path.join(sub, 'github-output.txt'),
          },
        });

        const finalBytes = fs.readFileSync(
          path.join(sub, 'ocr-coverage-report.json'),
          'utf8',
        );
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

    it('hash integrity holds when coverage report was missing (ensure creates it first)', () => {
      const sub = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-hash-missing-'));
      try {
        initializeArtifacts(sub);
        prepareMainTelemetryArtifacts(sub);
        fs.rmSync(path.join(sub, 'ocr-coverage-report.json'));
        const ensureStep = stepNamed(
          ctx.codeReviewJob,
          'Ensure valid OCR coverage report',
        );
        execFileSync('bash', ['-c', commandText(ensureStep)], {
          cwd: sub,
          encoding: 'utf8',
        });

        const reportContent = fs.readFileSync(
          path.join(sub, 'ocr-coverage-report.json'),
          'utf8',
        );
        expect(() => JSON.parse(reportContent)).not.toThrow();

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

        const placeholderStep = stepNamed(
          ctx.codeReviewJob,
          'Ensure OCR artifact placeholders exist',
        );
        execFileSync('bash', ['-c', commandText(placeholderStep)], {
          cwd: sub,
          encoding: 'utf8',
          env: {
            ...process.env,
            GITHUB_OUTPUT: path.join(sub, 'github-output.txt'),
          },
        });

        const finalBytes = fs.readFileSync(
          path.join(sub, 'ocr-coverage-report.json'),
          'utf8',
        );
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
  });

  describe('structured+stderr union from production orchestration', () => {
    function loadUnionPipeline() {
      return loadFunctionsTogether(
        [
          'normalizeFilePaths',
          'readFailuresFromStderr',
          'failedFilesFromResult',
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

    it('unions structured subtask_error warnings with stderr file_read failures', () => {
      const {
        readFailuresFromStderr,
        failedFilesFromResult,
        normalizeFilePaths,
        buildCoverageReport,
      } = loadUnionPipeline();

      const parsedResult = {
        status: 'completed_with_errors',
        comments: [{ path: 'src/a.ts' }],
        warnings: [{ type: 'subtask_error', file: 'src/b.ts' }],
      };
      const stderrFailures = readFailuresFromStderr(
        'file_read failed: file "src/c.ts" not found\n',
      );
      const structuredFailures = failedFilesFromResult(parsedResult);
      const allFailures = normalizeFilePaths([
        ...stderrFailures,
        ...structuredFailures,
      ]);
      expect(allFailures).toEqual(['src/c.ts', 'src/b.ts']);

      const report = buildCoverageReport({
        previewFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        evidencedFiles: ['src/a.ts'],
        readFailureFiles: allFailures,
        thresholdPercentage: 90,
      });
      expect(report.counts.read_failures).toBe(2);
      expect(report.counts.failed_preview).toBe(2);
      expect(report.counts.covered).toBe(1);
    });
  });

  describe('shell syntax validation', () => {
    it('the Ensure placeholders step is valid bash (bash -n)', () => {
      const ensureStep = stepNamed(
        ctx.codeReviewJob,
        'Ensure OCR artifact placeholders exist',
      );
      const ensureRun = commandText(ensureStep);
      const scriptPath = path.join(tmpDir, 'ensure-syntax.sh');
      fs.writeFileSync(scriptPath, ensureRun);
      execFileSync('bash', ['-n', scriptPath], { encoding: 'utf8' });
    });
  });

  describe('valid JSON placeholder and fallback', () => {
    function readCoverageReport(directory) {
      return JSON.parse(
        fs.readFileSync(
          path.join(directory, 'ocr-coverage-report.json'),
          'utf8',
        ),
      );
    }

    function runEnsure(directory) {
      const ensureStep = stepNamed(
        ctx.codeReviewJob,
        'Ensure valid OCR coverage report',
      );
      execFileSync('bash', ['-c', commandText(ensureStep)], {
        cwd: directory,
        encoding: 'utf8',
      });
    }

    it('uses the same unavailable-evidence placeholder during initialization and missing-report recovery', () => {
      const initialized = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-init-'));
      const recovered = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-ensure-'));
      try {
        initializeArtifacts(initialized);
        initializeArtifacts(recovered);
        fs.rmSync(path.join(recovered, 'ocr-coverage-report.json'));
        runEnsure(recovered);
        expect(readCoverageReport(recovered)).toEqual(
          readCoverageReport(initialized),
        );
        expect(readCoverageReport(recovered).evidence_available).toBe(false);
      } finally {
        fs.rmSync(initialized, { recursive: true, force: true });
        fs.rmSync(recovered, { recursive: true, force: true });
      }
    });

    it('Ensure valid OCR coverage report replaces invalid JSON with the shared placeholder', () => {
      const initialized = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-init-'));
      const recovered = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-ensure-'));
      try {
        initializeArtifacts(initialized);
        initializeArtifacts(recovered);
        fs.writeFileSync(
          path.join(recovered, 'ocr-coverage-report.json'),
          'NOT VALID JSON{{{',
        );
        runEnsure(recovered);
        expect(readCoverageReport(recovered)).toEqual(
          readCoverageReport(initialized),
        );
      } finally {
        fs.rmSync(initialized, { recursive: true, force: true });
        fs.rmSync(recovered, { recursive: true, force: true });
      }
    });

    it('preserves an earlier infrastructure diagnostic when report recovery adds coverage context', () => {
      const sub = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-ensure-'));
      try {
        initializeArtifacts(sub);
        fs.rmSync(path.join(sub, 'ocr-coverage-report.json'));
        fs.writeFileSync(
          path.join(sub, 'ocr-infrastructure-failure.txt'),
          'phase=review; reason=provider unavailable\n',
        );
        runEnsure(sub);
        const diagnostic = fs.readFileSync(
          path.join(sub, 'ocr-infrastructure-failure.txt'),
          'utf8',
        );
        expect(diagnostic).toContain(
          'phase=review; reason=provider unavailable',
        );
        expect(diagnostic).toContain(
          'phase=coverage; reason=ocr-coverage-report.json was missing or empty before classification',
        );
      } finally {
        fs.rmSync(sub, { recursive: true, force: true });
      }
    });

    function runRedactionFailure(fileName) {
      const redactStep = stepNamed(
        ctx.codeReviewJob,
        'Redact OCR diagnostic artifacts',
      );
      const redactScript = commandText(redactStep);
      const writes = {};
      const fakeFs = {
        writeFileSync: (name, content) => {
          writes[name] = content;
        },
        rmSync: () => {},
      };
      const sandbox = {
        ...SANDBOX_GLOBALS,
        fs: fakeFs,
        process: { exitCode: 0 },
      };
      vm.createContext(sandbox);
      const source = extractFunctionSource(
        redactScript,
        'replaceWithRedactionFailure',
      );
      vm.runInContext(source, sandbox, { timeout: VM_TIMEOUT_MS });
      sandbox.replaceWithRedactionFailure(fileName, { code: 'EACCES' });
      return writes[fileName];
    }

    it('Redact step emits valid JSON for ocr-coverage-report.json on redaction failure', () => {
      const content = runRedactionFailure('ocr-coverage-report.json');
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it('Redact step emits plain-text diagnostic for non-JSON artifacts on failure', () => {
      const content = runRedactionFailure('ocr-result.txt');
      expect(content).toContain('redaction failed');
    });
  });

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
      const serialize = loadSerializer().serializeCoverageReport;
      const report = {
        schema_version: '1.0.0',
        preview_files: [CREDENTIAL_LIKE_FILENAME],
        covered_files: [CREDENTIAL_LIKE_FILENAME],
      };
      const serialized = serialize(report);
      expect(() => JSON.parse(serialized)).not.toThrow();
    });

    it('serializeCoverageReport preserves JSON structure integrity for credential-like filename', () => {
      const serialize = loadSerializer().serializeCoverageReport;
      const report = { preview_files: [CREDENTIAL_LIKE_FILENAME] };
      const serialized = serialize(report);
      expect(() => JSON.parse(serialized)).not.toThrow();
      // The serialized output must be valid JSON with the preview_files array
      // intact (the value may be redacted, but the JSON structure must not
      // be corrupted by raw regex over the serialized string).
      const parsed = JSON.parse(serialized);
      expect(Array.isArray(parsed.preview_files)).toBe(true);
      expect(parsed.preview_files).toHaveLength(1);
    });

    it('full lifecycle: serialize → validate → redact → hash stays consistent', () => {
      const sub = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-cred-life-'));
      try {
        initializeArtifacts(sub);
        prepareMainTelemetryArtifacts(sub);
        const { serializeCoverageReport } = loadSerializer();
        const report = {
          schema_version: '1.0.0',
          counts: { preview: 1, covered: 1 },
          coverage: { ratio: 1, percentage: 100 },
          preview_files: [CREDENTIAL_LIKE_FILENAME],
          covered_files: [CREDENTIAL_LIKE_FILENAME],
        };
        const serialized = serializeCoverageReport(report);
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
      const { buildCoverageReport } = loadNoopPipeline();
      const report = buildCoverageReport({
        previewFiles: [],
        evidencedFiles: [],
        readFailureFiles: [],
        thresholdPercentage: 90,
        evidenceAvailable: false,
      });
      expect(report.evidence_available).toBe(false);
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
      const { buildCoverageReport, coverageWarningText } =
        loadOrchestrationPipeline();
      const report = buildCoverageReport({
        previewFiles: ['a.ts', 'b.ts'],
        evidencedFiles: ['a.ts', 'b.ts'],
        readFailureFiles: ['outside.ts'],
        thresholdPercentage: 90,
      });
      expect(report.coverage.percentage).toBe(100);
      expect(report.ratio_below_threshold).toBe(false);
      expect(report.has_review_failures).toBe(true);
      const text = coverageWarningText(report);
      expect(text).not.toMatch(/100%.*is below the.*90%/);
      expect(text).toMatch(/read\/review failure/i);
    });

    it('states "is below the 90% threshold" for 89.5% ratio', () => {
      const { buildCoverageReport, coverageWarningText } =
        loadOrchestrationPipeline();
      const preview = Array.from({ length: 200 }, (_, i) => `f${i}.ts`);
      const covered = preview.slice(0, 179);
      const report = buildCoverageReport({
        previewFiles: preview,
        evidencedFiles: covered,
        readFailureFiles: [],
        thresholdPercentage: 90,
      });
      expect(report.ratio_below_threshold).toBe(true);
      expect(report.has_review_failures).toBe(false);
      const text = coverageWarningText(report);
      expect(text).toContain('below the');
      expect(text).toContain('90%');
    });

    it('emits a separate generic review/read failure warning outside preview', () => {
      const { buildCoverageReport, coverageWarningText } =
        loadOrchestrationPipeline();
      const report = buildCoverageReport({
        previewFiles: ['a.ts'],
        evidencedFiles: ['a.ts'],
        readFailureFiles: ['not-in-preview.ts'],
        thresholdPercentage: 90,
      });
      const text = coverageWarningText(report);
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
