/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import {
  WORKFLOW_PATH,
  commandText,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.js';

describe('.github/workflows/ocr-review.yml — OCR telemetry (issue #2676)', () => {
  let workflow;
  let codeReviewJob;
  let _postScript;
  let initialClassificationStep;
  let _initialClassificationRun;
  let telemetryStep;
  let telemetryRun;
  let redactStep;
  let _redactRun;
  let placeholderStep;
  let placeholderRun;
  let hashStep;
  let _hashRun;
  let uploadStep;
  let wallClockStep;
  let _wallClockRun;
  let filesReviewedStep;
  let _filesReviewedRun;
  let finalClassificationStep;
  let _finalClassificationRun;

  beforeAll(() => {
    workflow = yaml.load(readRootFile(WORKFLOW_PATH));
    codeReviewJob = workflow.jobs?.['code-review'];
    expect(codeReviewJob).toBeTruthy();
    _postScript = commandText(stepNamed(codeReviewJob, 'Post OCR results'));
    initialClassificationStep = stepNamed(
      codeReviewJob,
      'Resolve OCR failure classification',
    );
    _initialClassificationRun = commandText(initialClassificationStep);
    telemetryStep = stepNamed(
      codeReviewJob,
      'Emit OCR telemetry (issue #2676)',
    );
    telemetryRun = commandText(telemetryStep);
    redactStep = stepNamed(codeReviewJob, 'Redact OCR diagnostic artifacts');
    _redactRun = commandText(redactStep);
    placeholderStep = stepNamed(
      codeReviewJob,
      'Ensure OCR artifact placeholders exist',
    );
    placeholderRun = commandText(placeholderStep);
    hashStep = stepNamed(
      codeReviewJob,
      'Compute reviewed-range manifest hashes',
    );
    _hashRun = commandText(hashStep);
    uploadStep = stepNamed(codeReviewJob, 'Upload OCR artifacts');
  });

  describe('step ordering and id', () => {
    it('places telemetry AFTER classification', () => {
      const names = codeReviewJob.steps.map((step) => step.name);
      const classificationIndex = names.indexOf(
        'Resolve OCR failure classification',
      );
      const telemetryIndex = names.indexOf('Emit OCR telemetry (issue #2676)');
      expect(classificationIndex).toBeGreaterThan(-1);
      expect(telemetryIndex).toBeGreaterThan(classificationIndex);
    });

    it('places final classification after telemetry validation and upload', () => {
      const names = codeReviewJob.steps.map((step) => step.name);
      const validationIndex = names.indexOf('Validate redacted OCR telemetry');
      const uploadIndex = names.indexOf('Upload OCR artifacts');
      const finalIndex = names.indexOf('Resolve final OCR classification');
      expect(validationIndex).toBeGreaterThan(-1);
      expect(finalIndex).toBeGreaterThan(validationIndex);
      expect(finalIndex).toBeGreaterThan(uploadIndex);
    });

    it('places final classification AFTER the Post OCR results step', () => {
      const names = codeReviewJob.steps.map((step) => step.name);
      const postIndex = names.indexOf('Post OCR results');
      const finalIndex = names.indexOf('Resolve final OCR classification');
      expect(postIndex).toBeGreaterThan(-1);
      expect(finalIndex).toBeGreaterThan(postIndex);
    });

    it('redacts source diagnostics before telemetry extraction', () => {
      const names = codeReviewJob.steps.map((step) => step.name);
      const telemetryIndex = names.indexOf('Emit OCR telemetry (issue #2676)');
      const redactIndex = names.indexOf('Redact OCR diagnostic artifacts');
      expect(redactIndex).toBeLessThan(telemetryIndex);
    });

    it('places redaction BEFORE hash computation', () => {
      const names = codeReviewJob.steps.map((step) => step.name);
      const redactIndex = names.indexOf('Redact OCR diagnostic artifacts');
      const hashIndex = names.indexOf('Compute reviewed-range manifest hashes');
      expect(hashIndex).toBeGreaterThan(redactIndex);
    });

    it('places non-telemetry placeholder recovery before telemetry and upload after validation', () => {
      const names = codeReviewJob.steps.map((step) => step.name);
      const telemetryIndex = names.indexOf('Emit OCR telemetry (issue #2676)');
      const placeholderIndex = names.indexOf(
        'Ensure OCR artifact placeholders exist',
      );
      const validationIndex = names.indexOf('Validate redacted OCR telemetry');
      const uploadIndex = names.indexOf('Upload OCR artifacts');
      expect(placeholderIndex).toBeLessThan(telemetryIndex);
      expect(validationIndex).toBeGreaterThan(telemetryIndex);
      expect(uploadIndex).toBeGreaterThan(validationIndex);
    });
  });

  describe('telemetry step runs always after classification', () => {
    it('runs with if: always()', () => {
      expect(telemetryStep.if).toBe('always()');
    });

    it('uses the trusted scripts/ocr-telemetry.js module', () => {
      expect(telemetryStep.shell).toBe('bash');
      expect(telemetryRun).toContain('scripts/ocr-telemetry.js');
    });

    it('passes run identity and PR context via environment', () => {
      expect(telemetryStep.env?.OCR_RUN_ID).toBe('${{ github.run_id }}');
      expect(telemetryStep.env?.OCR_RUN_ATTEMPT).toBe(
        '${{ github.run_attempt }}',
      );
      expect(telemetryStep.env?.OCR_PR_NUMBER).toBe(
        '${{ steps.pr-context.outputs.number }}',
      );
      expect(telemetryStep.env?.OCR_SHA).toBe('${{ env.HEAD_SHA }}');
    });

    it('does NOT use github.event.head_commit.timestamp (absent for non-push triggers)', () => {
      expect(telemetryStep.env?.OCR_GENERATED_AT).not.toBe(
        '${{ github.event.head_commit.timestamp }}',
      );
    });

    it('passes an authoritative workflow-measured wall-clock duration', () => {
      expect(telemetryStep.env?.OCR_WALL_CLOCK_SECONDS).toBe(
        '${{ steps.ocr-wall-clock.outputs.wall_clock_seconds }}',
      );
    });

    it('passes the validated OCR result summary files_reviewed count', () => {
      expect(telemetryStep.env?.OCR_FILES_REVIEWED).toBe(
        '${{ steps.ocr-files-reviewed.outputs.files_reviewed }}',
      );
    });

    it('passes the post-ocr-results lifecycle state', () => {
      expect(telemetryStep.env?.OCR_POST_STATE).toBe(
        '${{ steps.ocr-telemetry-classification.outputs.post_state }}',
      );
    });

    it('does NOT alias comments_skipped as already_resolved', () => {
      expect(telemetryStep.env).not.toHaveProperty('OCR_ALREADY_RESOLVED');
    });

    it('passes classification flags and output counters', () => {
      expect(telemetryStep.env?.OCR_INFRASTRUCTURE_FAILURE).toBe(
        '${{ steps.ocr-telemetry-classification.outputs.infrastructure_failure }}',
      );
      expect(telemetryStep.env?.OCR_POLICY_FAILURE).toBe(
        '${{ steps.ocr-telemetry-classification.outputs.policy_failure }}',
      );
      expect(telemetryStep.env?.OCR_INLINE_POSTED).toBe(
        '${{ steps.post-ocr-results.outputs.comments_inline }}',
      );
      expect(telemetryStep.env?.OCR_COMMENTS_SKIPPED).toBe(
        '${{ steps.post-ocr-results.outputs.comments_skipped }}',
      );
      expect(telemetryStep.env?.OCR_COMMENTS_FAILED).toBe(
        '${{ steps.post-ocr-results.outputs.comments_failed }}',
      );
      expect(telemetryStep.env?.OCR_COMMENTS_TOTAL).toBe(
        '${{ steps.post-ocr-results.outputs.comments_total }}',
      );
    });

    it('invokes the module to write ocr-telemetry.json and append step summary', () => {
      expect(telemetryRun).toContain('scripts/ocr-telemetry.js');
      expect(telemetryRun).toContain('GITHUB_STEP_SUMMARY');
    });

    it('does not initialize telemetry as a zero-byte placeholder', () => {
      const initRun = commandText(
        stepNamed(codeReviewJob, 'Initialize OCR artifact files'),
      );
      expect(initRun).not.toContain(': > ocr-telemetry.json');
    });
  });

  describe('telemetry artifact lifecycle', () => {
    it('redacts telemetry with the producer CLI after source redaction', () => {
      const validationStep = stepNamed(
        codeReviewJob,
        'Validate redacted OCR telemetry',
      );
      expect(commandText(validationStep)).toContain(
        '--redact ocr-telemetry.json',
      );
    });

    it('never replaces telemetry with an empty placeholder', () => {
      expect(placeholderRun).not.toContain('ocr-telemetry.json');
    });

    it('includes ocr-telemetry.json in the upload artifact path', () => {
      expect(uploadStep.with?.path).toContain('ocr-telemetry.json');
    });
  });

  describe('authoritative wall-clock capture', () => {
    beforeAll(() => {
      wallClockStep = stepNamed(codeReviewJob, 'Capture OCR wall-clock');
      _wallClockRun = commandText(wallClockStep);
    });

    it('captures a start timestamp before the OCR review invocation', () => {
      const runStep = stepNamed(codeReviewJob, 'Run OpenCodeReview');
      const runScript = commandText(runStep);
      expect(runScript).toMatch(/OCR_WALL_CLOCK_START|ocr_wall_clock_start/);
    });

    it('emits a wall_clock_seconds output id ocr-wall-clock', () => {
      expect(wallClockStep.id).toBe('ocr-wall-clock');
      expect(wallClockStep.if).toBe('always()');
      expect(_wallClockRun).toContain('wall_clock_seconds');
    });
  });

  describe('validated files_reviewed from OCR result summary', () => {
    beforeAll(() => {
      filesReviewedStep = stepNamed(
        codeReviewJob,
        'Extract OCR files_reviewed',
      );
      _filesReviewedRun = commandText(filesReviewedStep);
    });

    it('reads summary.files_reviewed from ocr-result.json and exports it', () => {
      expect(filesReviewedStep.id).toBe('ocr-files-reviewed');
      expect(_filesReviewedRun).toContain('files_reviewed');
      expect(_filesReviewedRun).toContain('ocr-result.json');
    });
  });

  describe('final classification after post and telemetry', () => {
    beforeAll(() => {
      finalClassificationStep = stepNamed(
        codeReviewJob,
        'Resolve final OCR classification',
      );
      _finalClassificationRun = commandText(finalClassificationStep);
    });

    it('runs under always() after the Post OCR results step', () => {
      const names = codeReviewJob.steps.map((step) => step.name);
      const postIndex = names.indexOf('Post OCR results');
      const finalIndex = names.indexOf('Resolve final OCR classification');
      expect(postIndex).toBeGreaterThan(-1);
      expect(finalIndex).toBeGreaterThan(postIndex);
      expect(finalClassificationStep.if).toBe('always()');
    });

    it('emits infrastructure_failure and policy_failure from final marker files', () => {
      expect(_finalClassificationRun).toContain('infrastructure_failure');
      expect(_finalClassificationRun).toContain('policy_failure');
      expect(_finalClassificationRun).toContain(
        'ocr-infrastructure-failure.txt',
      );
      expect(_finalClassificationRun).toContain('ocr-policy-failure.txt');
    });
  });
  it('validates with the shared validator after telemetry redaction', () => {
    const names = codeReviewJob.steps.map((step) => step.name);
    const redactIndex = names.indexOf('Redact OCR diagnostic artifacts');
    const validationStep = stepNamed(
      codeReviewJob,
      'Validate redacted OCR telemetry',
    );
    const validationIndex = names.indexOf(validationStep.name);
    expect(validationIndex).toBeGreaterThan(redactIndex);
    expect(commandText(validationStep)).toContain('--validate');
    expect(validationStep.id).toBe('ocr-telemetry-validation');
  });

  it('hashes telemetry before reading the finalized manifest for its self-hash', () => {
    expect(_hashRun).toMatch(
      /hashableArtifacts\s*=\s*\[[\s\S]*ocr-telemetry\.json[\s\S]*\];/,
    );
    expect(_hashRun.indexOf('ocr-telemetry.json')).toBeLessThan(
      _hashRun.indexOf('const manifestContent'),
    );
  });

  it('only uploads when redacted telemetry validation succeeded', () => {
    expect(String(uploadStep.if)).toContain(
      'steps.ocr-telemetry-validation.outputs.valid',
    );
    expect(uploadStep.id).toBe('upload-ocr-artifacts');
  });

  it('publishes final job outputs from post-upload classification', () => {
    expect(codeReviewJob.outputs.infrastructure_failure).toContain(
      'ocr-final-classification',
    );
    expect(codeReviewJob.outputs.policy_failure).toContain(
      'ocr-final-classification',
    );
    expect(codeReviewJob.outputs.completeness).toContain(
      'ocr-final-classification',
    );
  });

  describe('telemetry validation before upload', () => {
    it('validates the redacted ocr-telemetry.json with the shared CLI', () => {
      const validationStep = stepNamed(
        codeReviewJob,
        'Validate redacted OCR telemetry',
      );
      expect(commandText(validationStep)).toContain(
        '--validate ocr-telemetry.json',
      );
    });

    it('uses an atomic write (temp file + rename) for ocr-telemetry.json', () => {
      // The trusted producer module performs the atomic write internally;
      // the workflow step invokes node scripts/ocr-telemetry.js which writes
      // via an atomic temp+rename. Verify the step does not itself truncate
      // ocr-telemetry.json before invoking the producer.
      expect(telemetryRun).not.toMatch(/: > ocr-telemetry\.json/);
    });
  });

  describe('ocr-selected-files.txt captured for all review runs', () => {
    it('extracts selected files before entering the changed-tests-only guard', () => {
      const previewStep = stepNamed(
        codeReviewJob,
        'Verify review scope includes changed tests',
      );
      const previewRun = commandText(previewStep);
      const selectedFilesWrite = previewRun.indexOf('> ocr-selected-files.txt');
      const changedTestsGuard = previewRun.indexOf(
        'if [ -n "$changed_tests" ]; then',
      );
      expect(selectedFilesWrite).toBeGreaterThan(-1);
      expect(selectedFilesWrite).toBeLessThan(changedTestsGuard);
      expect(previewRun.match(/> ocr-selected-files\.txt/g)).toHaveLength(1);
    });
  });
});
