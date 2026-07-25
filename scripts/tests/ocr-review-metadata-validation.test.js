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
  makePostSanitizer,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.js';

describe('.github/workflows/ocr-review.yml — metadata validation (issue #2671)', () => {
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

  /**
   * Build a vm sandbox providing the globals the extracted
   * validateFindingMetadata function needs: the KNOWN_CATEGORIES and
   * KNOWN_SEVERITIES constants, a redactSecretDiagnostics stub, and a core
   * object that captures warnings.
   */
  function buildSandbox() {
    const warnings = [];
    const stderrChunks = [];
    return {
      warnings,
      stderrChunks,
      core: {
        warning: (msg) => {
          warnings.push(String(msg));
        },
        info: () => {},
      },
      process: {
        stderr: {
          write: (chunk) => {
            stderrChunks.push(String(chunk));
            return true;
          },
        },
      },
      redactSecretDiagnostics: (value) => String(value),
      KNOWN_CATEGORIES: new Set([
        'bug',
        'maintainability',
        'test',
        'security',
        'style',
      ]),
      KNOWN_SEVERITIES: new Set(['high', 'medium', 'low']),
      Set,
      Map,
      Number,
      String,
      Object,
      Array,
      Boolean,
      Error,
      JSON,
      Math,
    };
  }

  /**
   * Extract the REAL validateFindingMetadata from the committed workflow YAML
   * and execute it in an isolated vm sandbox with a real finding input.
   * Returns { result, warnings }.
   */
  function runValidation(finding, overrides = {}) {
    const funcSource = extractFunctionSource(
      postScript,
      'validateFindingMetadata',
    );
    const sandbox = buildSandbox();
    if (overrides.redactSecretDiagnostics) {
      sandbox.redactSecretDiagnostics = overrides.redactSecretDiagnostics;
    }
    sandbox.__INPUT__ = finding;
    vm.runInNewContext(
      `${funcSource}\n__RESULT__ = validateFindingMetadata(__INPUT__);`,
      sandbox,
    );
    return {
      result: sandbox.__RESULT__,
      warnings: sandbox.warnings,
      stderr: sandbox.stderrChunks.join(''),
    };
  }

  describe('validateFindingMetadata behavior', () => {
    it('passes valid category and severity through unchanged with no warnings (AC 1)', () => {
      const input = {
        path: 'a.ts',
        start_line: 1,
        end_line: 1,
        content: 'x',
        category: 'bug',
        severity: 'high',
      };
      const { result, warnings } = runValidation(input);

      expect(result.category).toBe('bug');
      expect(result.severity).toBe('high');
      expect(result.path).toBe('a.ts');
      expect(result.start_line).toBe(1);
      expect(result.end_line).toBe(1);
      expect(result.content).toBe('x');
      expect(warnings).toHaveLength(0);
    });

    it('preserves the raw drifted values in originalCategory/originalSeverity for downstream telemetry (AC 6)', () => {
      const input = {
        path: 'drift.ts',
        start_line: 5,
        end_line: 5,
        content: 'y',
        category: 'correctness',
        severity: 'info',
      };
      const { result, warnings } = runValidation(input);

      // Classification fields are normalized to 'unknown' for existing logic.
      expect(result.category).toBe('unknown');
      expect(result.severity).toBe('unknown');
      // Raw drifted values are preserved so drift detection/reporting can
      // distinguish "intentionally unknown" from "undocumented new value".
      expect(result.originalCategory).toBe('correctness');
      expect(result.originalSeverity).toBe('info');
      expect(warnings.some((w) => w.includes('correctness'))).toBe(true);
      expect(warnings.some((w) => w.includes('info'))).toBe(true);
    });

    it('preserves originalCategory/originalSeverity unchanged when metadata is valid', () => {
      const input = {
        path: 'z.ts',
        content: 'w',
        category: 'bug',
        severity: 'low',
      };
      const { result } = runValidation(input);

      expect(result.category).toBe('bug');
      expect(result.severity).toBe('low');
      expect(result.originalCategory).toBe('bug');
      expect(result.originalSeverity).toBe('low');
    });

    it('maps undocumented category "correctness" to unknown with a warning, not suppressed (AC 2)', () => {
      const input = {
        category: 'correctness',
        severity: 'low',
        path: 'b.ts',
        content: 'y',
      };
      const { result, warnings } = runValidation(input);

      expect(result).toBeTruthy();
      expect(result.category).toBe('unknown');
      expect(result.severity).toBe('low');
      expect(result.content).toBe('y');
      expect(warnings).toHaveLength(1);
    });

    it('maps undocumented category "other" to unknown with a warning (AC 2)', () => {
      const input = {
        category: 'other',
        severity: 'low',
        path: 'c.ts',
        content: 'z',
      };
      const { result, warnings } = runValidation(input);

      expect(result).toBeTruthy();
      expect(result.category).toBe('unknown');
      expect(warnings).toHaveLength(1);
    });

    it('maps undocumented severity "info" to unknown with a warning, not suppressed (AC 3)', () => {
      const input = {
        category: 'bug',
        severity: 'info',
        path: 'd.ts',
        content: 'w',
      };
      const { result, warnings } = runValidation(input);

      expect(result).toBeTruthy();
      expect(result.severity).toBe('unknown');
      expect(result.category).toBe('bug');
      expect(warnings).toHaveLength(1);
    });

    it('treats missing category as unknown with no warning and no error (AC 4)', () => {
      const input = { severity: 'low', path: 'e.ts', content: 'v' };
      const { result, warnings } = runValidation(input);

      expect(result.category).toBe('unknown');
      expect(warnings).toHaveLength(0);
    });

    it('treats missing severity as unknown with no warning and no error (AC 4)', () => {
      const input = { category: 'bug', path: 'f.ts', content: 'u' };
      const { result, warnings } = runValidation(input);

      expect(result.severity).toBe('unknown');
      expect(warnings).toHaveLength(0);
    });

    it('treats missing category and severity as unknown with zero warnings (AC 4)', () => {
      const input = { path: 'g.ts', content: 't' };
      const { result, warnings } = runValidation(input);

      expect(result.category).toBe('unknown');
      expect(result.severity).toBe('unknown');
      expect(warnings).toHaveLength(0);
    });

    it('passes a non-object finding (bare string) through untouched, guarding the lineless fallback', () => {
      const { result, warnings } = runValidation('some string');

      expect(result).toBe('some string');
      expect(warnings).toHaveLength(0);
    });

    it('passes a null finding through untouched', () => {
      const { result, warnings } = runValidation(null);

      expect(result).toBeNull();
      expect(warnings).toHaveLength(0);
    });

    it('passes an array finding through untouched (arrays report typeof object)', () => {
      const arrayFinding = ['stray', 'array'];
      const { result, warnings } = runValidation(arrayFinding);

      expect(result).toBe(arrayFinding);
      expect(Array.isArray(result)).toBe(true);
      expect(warnings).toHaveLength(0);
    });

    it('does not suppress findings when core.warning throws (fail-open contract)', () => {
      // A throw in core.warning must not abort findings.map() and suppress
      // the remaining findings. (process.stderr.write is exercised by the
      // catch path, which has its own best-effort guard.)
      const baseSandbox = buildSandbox();
      const sandbox = {
        ...baseSandbox,
        core: {
          ...baseSandbox.core,
          warning: () => {
            throw new Error('warning channel unavailable');
          },
        },
      };
      const validateSrc = extractFunctionSource(
        postScript,
        'validateFindingMetadata',
      );
      const JOIN_SEP = String.fromCharCode(10);
      sandbox.__INPUT__ = [{ category: 'correctness', severity: 'low' }];
      vm.runInNewContext(
        [
          validateSrc,
          '__RESULT__ = __INPUT__.map(validateFindingMetadata);',
        ].join(JOIN_SEP),
        sandbox,
      );

      expect(sandbox.__RESULT__).toHaveLength(1);
      expect(sandbox.__RESULT__[0].category).toBe('unknown');
    });

    it('does not mutate the original input object (immutability)', () => {
      const input = {
        severity: 'low',
        category: 'bug',
        path: 'h.ts',
        start_line: 7,
        end_line: 9,
        content: 's',
      };
      const snapshot = { ...input };

      runValidation(input);

      // No existing property may be added, removed, or changed.
      expect(input).toEqual(snapshot);
    });

    it('always returns an object with both category and severity as string keys downstream (AC 6)', () => {
      const input = { path: 'i.ts', content: 'r' };
      const { result } = runValidation(input);

      expect('category' in result).toBe(true);
      expect('severity' in result).toBe(true);
      expect(typeof result.category).toBe('string');
      expect(typeof result.severity).toBe('string');
    });

    it('routes the undocumented value through redactSecretDiagnostics in the warning (AC 5)', () => {
      const { warnings } = runValidation(
        { category: 'correctness', severity: 'low' },
        { redactSecretDiagnostics: (value) => `[REDACTED]-${String(value)}` },
      );

      expect(warnings).toHaveLength(1);
      // The entire composed warning (location + metadata) flows through the
      // injected redactor, proving the real redactor would sanitize it too.
      expect(warnings[0]).toMatch(/^\[REDACTED\]-OCR schema drift/);
      expect(warnings[0]).toContain('[REDACTED]-correctness');
    });

    it('includes the file path and line number in the warning when present', () => {
      const input = {
        path: 'src/foo.ts',
        start_line: 42,
        category: 'correctness',
        severity: 'low',
      };
      const { warnings } = runValidation(input);

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('src/foo.ts:42');
    });

    it('omits the location suffix gracefully from the warning when no path is present', () => {
      const input = { category: 'correctness', severity: 'low' };
      const { warnings } = runValidation(input);

      expect(warnings).toHaveLength(1);
      // Verify the key behavioral aspects (prefix, metadata, no location)
      // without asserting the exact wording, which would be brittle.
      expect(warnings[0]).toContain('OCR schema drift');
      expect(warnings[0]).toContain('correctness');
      expect(warnings[0]).not.toMatch(/\bin\s+\S+/);
    });

    it('emits a single warning containing both category and severity when both are undocumented', () => {
      const input = { category: 'other', severity: 'info' };
      const { warnings } = runValidation(input);

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('category');
      expect(warnings[0]).toContain('severity');
    });

    it('redacts the entire composed warning (path and metadata) with the REAL redactor (AC 5 security)', () => {
      // Exercise the real extracted redactSecretDiagnostics together with the
      // real validator: a secret leaked into the path must be redacted from
      // the composed warning rather than appearing verbatim.
      const secret = 'leaked-token-1234567890abcdef';
      const realRedactor = makePostSanitizer(postScript, secret);
      const input = {
        path: `src/${secret}/module.ts`,
        start_line: 7,
        category: 'correctness',
        severity: 'low',
      };
      const { warnings, stderr } = runValidation(input, {
        redactSecretDiagnostics: realRedactor,
      });

      expect(warnings).toHaveLength(1);
      expect(stderr.trim()).toBe(warnings[0]);
      expect(warnings[0]).not.toContain(secret);
      expect(warnings[0]).toContain('[REDACTED]');
    });

    it('mirrors the schema-drift warning to process.stderr so it appears in the raw step log (AC 5)', () => {
      const input = { category: 'correctness', severity: 'low' };
      const { warnings, stderr } = runValidation(input);

      expect(warnings).toHaveLength(1);
      expect(stderr).toContain(warnings[0]);
      const NEWLINE = String.fromCharCode(10);
      expect(stderr.charAt(stderr.length - 1)).toBe(NEWLINE);
    });

    it('emits no stderr and no warning for valid metadata', () => {
      const input = {
        path: 'a.ts',
        start_line: 1,
        end_line: 1,
        content: 'x',
        category: 'bug',
        severity: 'high',
      };
      const { warnings, stderr } = runValidation(input);

      expect(warnings).toHaveLength(0);
      expect(stderr).toBe('');
    });
  });

  describe('YAML wiring', () => {
    it('defines KNOWN_CATEGORIES and KNOWN_SEVERITIES as Sets with the documented values', () => {
      expect(postScript).toContain('const KNOWN_CATEGORIES');
      expect(postScript).toContain(
        "new Set(['bug', 'maintainability', 'test', 'security', 'style'])",
      );
      expect(postScript).toContain('const KNOWN_SEVERITIES');
      expect(postScript).toContain("new Set(['high', 'medium', 'low'])");
    });

    it('defines function validateFindingMetadata(finding)', () => {
      expect(postScript).toContain('function validateFindingMetadata(finding)');
    });

    it('wires findings.map(validateFindingMetadata) before dedup and before the inline/lineless split', () => {
      // Structural wiring check: this ordering cannot be verified by a pure
      // behavioral unit test because the three stages only execute inside
      // GitHub Actions, so we assert the source ordering directly. The
      // behavioral complement lives in 'validation-before-dedup pipeline
      // ordering', which runs the real functions through a vm.
      const mapIndex = postScript.indexOf(
        'findings.map(validateFindingMetadata)',
      );
      const dedupIndex = postScript.indexOf(
        'findings = dedupedFindings.deduped;',
      );
      const splitIndex = postScript.indexOf('// Split findings into inline');

      expect(mapIndex).toBeGreaterThan(-1);
      expect(dedupIndex).toBeGreaterThan(mapIndex);
      expect(splitIndex).toBeGreaterThan(dedupIndex);
    });

    it('defines the metadata constants in the header region near REDACTION', () => {
      const redactionIndex = postScript.indexOf(
        "const REDACTION = '[REDACTED]';",
      );
      const categoriesIndex = postScript.indexOf('const KNOWN_CATEGORIES');

      expect(redactionIndex).toBeGreaterThan(-1);
      expect(categoriesIndex).toBeGreaterThan(-1);
      expect(categoriesIndex).toBeGreaterThan(redactionIndex);
      // The constants are defined in the same header block as REDACTION.
      // This guards against accidental relocation during refactors.
      const METADATA_HEADER_PROXIMITY = 600;
      expect(categoriesIndex - redactionIndex).toBeLessThan(
        METADATA_HEADER_PROXIMITY,
      );
    });
  });

  describe('validation-before-dedup pipeline ordering', () => {
    // Proves that schema drift on a finding sharing a dedup key with another
    // is still observed, because validation runs before deduplication.
    function runValidateThenDedup(inputFindings) {
      const validateSrc = extractFunctionSource(
        postScript,
        'validateFindingMetadata',
      );
      const dedupKeySrc = extractFunctionSource(postScript, 'deduplicationKey');
      const dedupSrc = extractFunctionSource(postScript, 'deduplicateFindings');
      const sandbox = buildSandbox();
      sandbox.__INPUT__ = inputFindings;
      const JOIN_SEP = String.fromCharCode(10);
      vm.runInNewContext(
        [
          validateSrc,
          dedupKeySrc,
          dedupSrc,
          '__VALIDATED__ = __INPUT__.map(validateFindingMetadata);',
          '__DEDUPED__ = deduplicateFindings(__VALIDATED__);',
        ].join(JOIN_SEP),
        sandbox,
      );
      return {
        validated: sandbox.__VALIDATED__,
        deduped: sandbox.__DEDUPED__.deduped,
        suppressed: sandbox.__DEDUPED__.suppressed,
        warnings: sandbox.warnings,
      };
    }

    it('warns about undocumented metadata on a finding that dedup later suppresses', () => {
      // Two findings share path/lines/body (same dedup key) but differ only
      // in metadata: the second carries undocumented category 'correctness'.
      const a = {
        path: 'a.ts',
        start_line: 1,
        end_line: 1,
        content: 'duplicate body',
        category: 'bug',
        severity: 'low',
      };
      const b = {
        path: 'a.ts',
        start_line: 1,
        end_line: 1,
        content: 'duplicate body',
        category: 'correctness',
        severity: 'low',
      };
      const { deduped, suppressed, warnings } = runValidateThenDedup([a, b]);

      // Dedup still suppresses the duplicate after normalization.
      expect(deduped).toHaveLength(1);
      expect(suppressed).toBe(1);
      // But the schema-drift warning for 'correctness' was still emitted,
      // because validation observed every finding before dedup.
      expect(warnings.some((w) => w.includes('correctness'))).toBe(true);
    });
  });
});
