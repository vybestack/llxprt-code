/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  asString,
  errorField,
  parseWorkflowYaml,
} from './typed-test-helpers.ts';
import {
  WORKFLOW_PATH,
  commandText,
  extractHeredocBody,
  hasBash,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.ts';

// Issue #3544: `mark_infrastructure_failure` recorded a failure reason only
// in ocr-infrastructure-failure.txt. When a re-run replaces that artifact the
// reason is gone forever, which is exactly what happened to attempt 1 of
// production run 33750459882 (ten minutes of review phase with zero log
// output). The helper must ALSO surface the phase and reason as a GitHub
// Actions warning annotation, while keeping the artifact file byte-identical
// for the notifier workflow that parses it.

describe.skipIf(!hasBash())(
  '.github/workflows/ocr-review.yml — mark_infrastructure_failure visibility (#3544)',
  () => {
    let helperScript: string;
    let directory: string;

    beforeAll(() => {
      const workflow = parseWorkflowYaml(readRootFile(WORKFLOW_PATH));
      const jobs = workflow.jobs;
      if (!jobs) throw new Error('workflow should have jobs');
      const initializeStep = stepNamed(
        jobs['code-review'],
        'Initialize OCR artifact files',
      );
      // Extract the REAL generated ocr-workflow-helpers.sh heredoc rather
      // than re-implementing the helper in the test.
      helperScript = extractHeredocBody(
        commandText(initializeStep),
        'Initialize OCR artifact files',
        'EOF',
      );
      directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ocr-infra-annotation-3544-'),
      );
      fs.writeFileSync(
        path.join(directory, 'ocr-workflow-helpers.sh'),
        helperScript,
        'utf8',
      );
    });

    afterAll(() => {
      fs.rmSync(directory, { recursive: true, force: true });
    });

    /** Start from an empty artifact, mirroring the workflow's `: >` init. */
    function resetArtifact(): void {
      fs.writeFileSync(
        path.join(directory, 'ocr-infrastructure-failure.txt'),
        '',
        'utf8',
      );
    }

    function readArtifact(): string {
      return fs.readFileSync(
        path.join(directory, 'ocr-infrastructure-failure.txt'),
        'utf8',
      );
    }

    /** Run the extracted helper once and return its stdout. */
    function markFailure(phase: string, reason: string): string {
      try {
        return execFileSync(
          'bash',
          [
            '-c',
            [
              'set -euo pipefail',
              '. ./ocr-workflow-helpers.sh',
              `mark_infrastructure_failure ${JSON.stringify(phase)} ${JSON.stringify(reason)}`,
            ].join('\n'),
          ],
          {
            cwd: directory,
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8',
          },
        );
      } catch (error) {
        throw new Error(
          [
            'The extracted mark_infrastructure_failure helper failed to run.',
            `status: ${errorField(error, 'status')}`,
            `stderr: ${errorField(error, 'stderr')}`,
          ].join('\n'),
          { cause: error },
        );
      }
    }

    it('appends the unchanged phase/reason line to ocr-infrastructure-failure.txt', () => {
      resetArtifact();

      markFailure('review', 'OCR review failed: timeout');

      // Byte-identical to the pre-existing format: the notifier workflow and
      // existing tests parse this file.
      expect(readArtifact()).toBe(
        'phase=review; reason=OCR review failed: timeout\n',
      );
    });

    it('emits the phase and reason as a workflow warning annotation', () => {
      resetArtifact();

      const stdout = asString(
        markFailure('review', 'OCR review command failed'),
      );

      expect(stdout).toContain('::warning::');
      expect(stdout).toContain('phase=review');
      expect(stdout).toContain('reason=OCR review command failed');
    });

    it('identifies the OCR subsystem in the annotation and keeps the prefix out of the artifact', () => {
      resetArtifact();

      const stdout = asString(
        markFailure('review', 'OCR review command failed'),
      );

      // The annotation must be self-describing in the Actions UI, where it
      // appears among unrelated annotations with no other subsystem context.
      expect(stdout).toContain(
        '::warning::OCR infrastructure failure recorded: phase=review; reason=OCR review command failed',
      );
      // The notifier workflow parses ocr-infrastructure-failure.txt by the
      // byte-identical `phase=...; reason=...` format, so the prefix must
      // never leak into the artifact.
      expect(readArtifact()).not.toContain(
        'OCR infrastructure failure recorded',
      );
    });

    it('still emits an annotation for a phase whose call site has no echo of its own', () => {
      // The six review-phase classifier branches pair their call with no
      // echo at all — the helper itself must carry the log line so those
      // branches stop being silent.
      resetArtifact();

      const stdout = asString(
        markFailure('review', 'OCR review failed: HTTP 429 rate limit'),
      );

      expect(stdout.trim()).not.toBe('');
      expect(stdout).toContain('::warning::');
      expect(stdout).toContain('OCR review failed: HTTP 429 rate limit');
    });

    it('records repeated failures by appending and announcing each one', () => {
      resetArtifact();

      const first = markFailure(
        'llm-preflight',
        'OCR LLM connectivity check timed out (model=test)',
      );
      const second = markFailure('review', 'OCR review command failed');

      expect(readArtifact()).toBe(
        'phase=llm-preflight; reason=OCR LLM connectivity check timed out (model=test)\n' +
          'phase=review; reason=OCR review command failed\n',
      );
      expect(first).toContain('::warning::');
      expect(second).toContain('::warning::');
    });
  },
);
