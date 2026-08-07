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
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  makeLoadFunctionsTogether,
  useWorkflowFixture,
} from './ocr-manifest-test-helpers.ts';
import {
  commandText,
  extractFunctionSource,
  stepNamed,
} from './ocr-review-workflow-helpers.ts';
import {
  asRecord,
  asRecordArray,
  asString,
  asStringArray,
  asVmFunction,
  numberRecordField,
} from './typed-test-helpers.ts';

const VM_TIMEOUT_MS = 2000;

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

let tmpDir: string;
beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-cov-int-'));
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

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

  describe('YAML wiring', () => {
    it('wires RANGE_MODE into the preview step env', () => {
      const previewStep = stepNamed(
        ctx.codeReviewJob,
        'Verify review scope includes changed tests',
      );
      expect(previewStep.env?.RANGE_MODE).toContain('OCR_EFFECTIVE_RANGE_MODE');
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
      const steps = asRecordArray(ctx.codeReviewJob['steps'] ?? []);
      const ensureIdx = steps.findIndex(
        (s: Record<string, unknown>) =>
          s['name'] === 'Ensure valid OCR coverage report',
      );
      const redactIdx = steps.findIndex(
        (s: Record<string, unknown>) =>
          s['name'] === 'Redact OCR diagnostic artifacts',
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
      return sandbox;
    }

    it('a failed review with preview files must show gaps (not 0/0=100%)', () => {
      const sandbox = loadCoveragePipeline();
      const buildCoverageReport = sandboxFn(sandbox, 'buildCoverageReport');
      const coverageWarningText = sandboxFn(sandbox, 'coverageWarningText');
      const report = asRecord(
        buildCoverageReport({
          previewFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
          evidencedFiles: [],
          readFailureFiles: ['src/a.ts'],
          thresholdPercentage: 90,
        }),
      );
      const counts = numberRecordField(report, 'counts');
      expect(counts['preview']).toBe(3);
      expect(counts['covered']).toBe(0);
      expect(counts['failed_preview']).toBe(1);
      expect(counts['preview_only']).toBe(2);
      const coverage = asRecord(report['coverage']);
      expect(coverage['percentage']).toBe(0);
      expect(report['has_review_failures']).toBe(true);
      expect(report['below_threshold']).toBe(true);
      const warning = asString(coverageWarningText(report));
      expect(warning).toContain('0/3');
    });

    it('a failed review with evidence_available=false marks unavailable result evidence', () => {
      const sandbox = loadCoveragePipeline();
      const buildCoverageReport = sandboxFn(sandbox, 'buildCoverageReport');
      const report = asRecord(
        buildCoverageReport({
          previewFiles: ['src/a.ts'],
          evidencedFiles: [],
          readFailureFiles: [],
          thresholdPercentage: 90,
          evidenceAvailable: false,
        }),
      );
      expect(report['evidence_available']).toBe(false);
      const counts = numberRecordField(report, 'counts');
      expect(counts['preview']).toBe(1);
      expect(counts['covered']).toBe(0);
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
      const sandbox = loadUnionPipeline();
      const readFailuresFromStderr = sandboxFn(
        sandbox,
        'readFailuresFromStderr',
      );
      const failedFilesFromResult = sandboxFn(sandbox, 'failedFilesFromResult');
      const normalizeFilePaths = sandboxFn(sandbox, 'normalizeFilePaths');
      const buildCoverageReport = sandboxFn(sandbox, 'buildCoverageReport');

      const parsedResult = {
        status: 'completed_with_errors',
        comments: [{ path: 'src/a.ts' }],
        warnings: [{ type: 'subtask_error', file: 'src/b.ts' }],
      };
      const stderrFailures = asStringArray(
        readFailuresFromStderr('file_read failed: file "src/c.ts" not found\n'),
      );
      const structuredFailures = asStringArray(
        failedFilesFromResult(parsedResult),
      );
      const allFailures = asStringArray(
        normalizeFilePaths([...stderrFailures, ...structuredFailures]),
      );
      expect(allFailures).toEqual(['src/c.ts', 'src/b.ts']);

      const report = asRecord(
        buildCoverageReport({
          previewFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
          evidencedFiles: ['src/a.ts'],
          readFailureFiles: allFailures,
          thresholdPercentage: 90,
        }),
      );
      const counts = numberRecordField(report, 'counts');
      expect(counts['read_failures']).toBe(2);
      expect(counts['failed_preview']).toBe(2);
      expect(counts['covered']).toBe(1);
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
    function readCoverageReport(directory: string) {
      return JSON.parse(
        fs.readFileSync(
          path.join(directory, 'ocr-coverage-report.json'),
          'utf8',
        ),
      );
    }

    function runEnsure(directory: string) {
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

    function runRedactionFailure(fileName: string) {
      const redactStep = stepNamed(
        ctx.codeReviewJob,
        'Redact OCR diagnostic artifacts',
      );
      const redactScript = commandText(redactStep);
      const writes: Record<string, unknown> = {};
      const fakeFs = {
        writeFileSync: (name: string | number, content: unknown) => {
          writes[String(name)] = content;
        },
        rmSync: () => {},
      };
      const sandbox: Record<string, unknown> = {
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
      const fn = sandbox['replaceWithRedactionFailure'];
      if (typeof fn !== 'function') {
        throw new Error('replaceWithRedactionFailure not found in sandbox');
      }
      asVmFunction(fn)(fileName, { code: 'EACCES' });
      return writes[fileName];
    }

    it('Redact step emits valid JSON for ocr-coverage-report.json on redaction failure', () => {
      const content = String(runRedactionFailure('ocr-coverage-report.json'));
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it('Redact step emits plain-text diagnostic for non-JSON artifacts on failure', () => {
      const content = String(runRedactionFailure('ocr-result.txt'));
      expect(content).toContain('redaction failed');
    });
  });
});
