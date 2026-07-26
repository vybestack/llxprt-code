/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  REPRESENTATIVE_TELEMETRY,
  loadWorkflow,
  metricsScript,
  withTempDirectory,
} from './ocr-concurrency-canary-2673-helpers.js';
import { commandText, stepNamed } from './ocr-review-workflow-helpers.js';

function executeShellStep(step, directory, environment = {}) {
  return execFileSync('bash', ['-c', commandText(step)], {
    cwd: directory,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...environment,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('.github/workflows/ocr-review.yml — issue #2673 canary artifacts', () => {
  let workflowYml;
  let codeReviewJob;

  beforeAll(() => {
    const loaded = loadWorkflow();
    workflowYml = loaded.yml;
    codeReviewJob = loaded.parsed.jobs?.['code-review'];
  });

  describe('dispatch-only artifact lifecycle', () => {
    it('does not initialize, placeholder, or commonly upload canary evidence', () => {
      expect(
        commandText(stepNamed(codeReviewJob, 'Initialize OCR artifact files')),
      ).not.toContain('ocr-canary-metrics.json');
      expect(
        commandText(
          stepNamed(codeReviewJob, 'Ensure OCR artifact placeholders exist'),
        ),
      ).not.toContain('ocr-canary-metrics.json');
      expect(
        String(stepNamed(codeReviewJob, 'Upload OCR artifacts').with?.path),
      ).not.toContain('ocr-canary-metrics.json');
    });

    it('redacts canary evidence only when present and preserves JSON on redaction failure', () => {
      const run = commandText(
        stepNamed(codeReviewJob, 'Redact OCR diagnostic artifacts'),
      );
      expect(run).toContain("if (fs.existsSync('ocr-canary-metrics.json'))");
      expect(run).toContain('valid: false');
      expect(run).toContain('validation_errors:');
    });

    it('keeps invalid canary JSON parseable and sanitized through the real redaction step', () =>
      withTempDirectory('ocr-redact-2673-', (directory) => {
        const token = 'transport-redaction-token-2673';
        const providerUrl = 'https://provider.invalid/v1';
        const artifact = {
          schema_version: 1,
          valid: false,
          validation_errors: [`failed near ${providerUrl} with token=${token}`],
          transport: REPRESENTATIVE_TELEMETRY,
        };
        fs.writeFileSync(
          path.join(directory, 'ocr-canary-metrics.json'),
          JSON.stringify(artifact),
        );

        executeShellStep(
          stepNamed(codeReviewJob, 'Redact OCR diagnostic artifacts'),
          directory,
          { OCR_LLM_TOKEN: token, OCR_LLM_URL: providerUrl },
        );

        const content = fs.readFileSync(
          path.join(directory, 'ocr-canary-metrics.json'),
          'utf8',
        );
        const parsed = JSON.parse(content);
        expect(parsed.valid).toBe(false);
        expect(parsed.transport).toEqual(REPRESENTATIVE_TELEMETRY);
        expect(content).not.toContain(token);
        expect(content).not.toContain(providerUrl);
        expect(content).toContain('[REDACTED]');
      }));

    it('executes final validation against valid, invalid, redacted, malformed, and missing artifacts', () => {
      const validate = stepNamed(
        codeReviewJob,
        'Validate final OCR canary artifact',
      );
      const cases = [
        { content: JSON.stringify({ valid: true }), passes: true },
        { content: JSON.stringify({ valid: false }), passes: false },
        {
          content: JSON.stringify({ valid: true, value: '[REDACTED]' }),
          passes: false,
        },
        { content: '{bad', passes: false },
        { content: null, passes: false },
      ];

      for (const testCase of cases) {
        withTempDirectory('ocr-validate-2673-', (directory) => {
          if (testCase.content !== null) {
            fs.writeFileSync(
              path.join(directory, 'ocr-canary-metrics.json'),
              testCase.content,
            );
          }
          if (testCase.passes) {
            expect(() => executeShellStep(validate, directory)).not.toThrow();
          } else {
            expect(() => executeShellStep(validate, directory)).toThrow();
          }
        });
      }
    });

    it('validates final JSON and then always uploads a separate dispatch artifact', () => {
      const validate = stepNamed(
        codeReviewJob,
        'Validate final OCR canary artifact',
      );
      const upload = stepNamed(codeReviewJob, 'Upload OCR canary artifact');
      expect(String(validate.if)).toContain('always()');
      expect(String(validate.if)).toContain(
        "github.event_name == 'workflow_dispatch'",
      );
      expect(commandText(validate)).toContain('parsed.valid !== true');
      expect(commandText(validate)).toContain('[REDACTED');
      expect(String(upload.if)).toContain('always()');
      expect(String(upload.if)).toContain(
        "github.event_name == 'workflow_dispatch'",
      );
      expect(upload.with?.path).toBe('ocr-canary-metrics.json');
      expect(upload.with?.['if-no-files-found']).toBe('error');
      expect(codeReviewJob.steps.indexOf(validate)).toBeLessThan(
        codeReviewJob.steps.indexOf(upload),
      );
    });

    it('never reads or uploads raw OCR session JSONL', () => {
      const uploadPaths = codeReviewJob.steps
        .filter((step) => step.uses?.includes('upload-artifact'))
        .map((step) => String(step.with?.path ?? ''))
        .join('\n');
      expect(uploadPaths).not.toMatch(/\.opencodereview|\bsession\b|\.jsonl/i);
      expect(metricsScript()).not.toMatch(
        /\.opencodereview\/sessions|session.*\.jsonl/i,
      );
      expect(workflowYml).not.toContain('REAL_');
    });
  });
});
