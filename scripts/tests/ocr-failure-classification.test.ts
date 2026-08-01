/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  asOptionalRecord,
  asRecord,
  asString,
  parseWorkflowYaml,
} from './typed-test-helpers.ts';
import {
  WORKFLOW_PATH,
  commandText,
  extractBashIfChain,
  hasBash,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.ts';

// OCR >= 1.8.0 emits a structured usage record (emitFailureUsage in
// cmd/opencodereview/output.go) to stderr when a `--format json` review
// fails. Its token counters and session UUID embed digit runs that look like
// HTTP status codes: 214295 contains "429", 240123 contains "401",
// 105295 contains "529", and the session UUID contains "429b" and "403a".
// The classifier must not read any of those as a status code.
const USAGE_JSON = `{
  "status": "failed",
  "summary": {
    "files_reviewed": 2,
    "total_tokens": 214295,
    "input_tokens": 240123,
    "output_tokens": 1548,
    "cache_read_tokens": 105295,
    "cache_write_tokens": 0,
    "elapsed": "1m36s",
    "budget_exceeded": false
  },
  "session_id": "7c1d429b-403a-4e51-9f52-9b0a1c2d3e4f"
}`;
const SESSION_LINE =
  '[ocr] Session: 7c1d429b-403a-4e51-9f52-9b0a1c2d3e4f ' +
  '(retry with: --resume 7c1d429b-403a-4e51-9f52-9b0a1c2d3e4f)';

const GENERIC_REASON = 'OCR review command failed';
const RATE_LIMIT_REASON = 'OCR review failed: HTTP 429 rate limit';
const OVERLOADED_REASON = 'OCR review failed: HTTP 529 provider overloaded';
const AUTH_REASON = 'OCR review failed: authentication or configuration error';
const TIMEOUT_REASON = 'OCR review failed: timeout';
const ALL_FAILED_REASON =
  'all OCR per-file reviews failed; likely LLM provider/config/auth failure';

// Mirrors the real helper the workflow writes in "Initialize OCR artifact
// files" (ocr-workflow-helpers.sh).
const MARK_STUB =
  'mark_infrastructure_failure() {\n' +
  '  echo "phase=$1; reason=$2" >> ocr-infrastructure-failure.txt\n' +
  '}\n';

describe.skipIf(!hasBash())(
  '.github/workflows/ocr-review.yml — review failure classification (issue #2929)',
  () => {
    let classifierChain: string;

    beforeAll(() => {
      const workflow = parseWorkflowYaml(readRootFile(WORKFLOW_PATH));
      const jobs = workflow.jobs;
      if (!jobs) throw new Error('workflow should have jobs');
      const reviewStep = stepNamed(
        asRecord(jobs['code-review']),
        'Run OpenCodeReview',
      );
      // Extract the REAL if/elif/fi chain from the workflow rather than
      // re-implementing it here.
      classifierChain = extractBashIfChain(
        commandText(reviewStep),
        /^\s*if grep -Eqi .*429.*ocr-stderr\.log/,
      );
    });

    function classify(stderrContent: string): string {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ocr-classification-2929-'),
      );
      try {
        fs.writeFileSync(
          path.join(directory, 'ocr-stderr.log'),
          stderrContent,
          'utf8',
        );
        execFileSync(
          'bash',
          ['-c', ['set -euo pipefail', MARK_STUB, classifierChain].join('\n')],
          {
            cwd: directory,
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8',
          },
        );
        const content = fs
          .readFileSync(
            path.join(directory, 'ocr-infrastructure-failure.txt'),
            'utf8',
          )
          .trim();
        const reasonMatch = /reason=(.*)$/.exec(content);
        expect(
          reasonMatch,
          `unexpected artifact content: ${content}`,
        ).not.toBeNull();
        return asString(reasonMatch?.[1]);
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }

    // ------------------------------------------------------------------
    // The 1.8.x structured usage record must not be read as a status code.
    // Each case isolates a single embedded digit run so a regression in one
    // pattern cannot be masked by another.
    // ------------------------------------------------------------------
    it('does not read 429 inside a token counter as a rate limit', () => {
      expect(classify('  "total_tokens": 214295,\n')).toBe(GENERIC_REASON);
    });

    it('does not read 401 inside a token counter as an auth error', () => {
      expect(classify('  "input_tokens": 240123,\n')).toBe(GENERIC_REASON);
    });

    it('does not read 403 inside a token counter as an auth error', () => {
      expect(classify('  "output_tokens": 140312,\n')).toBe(GENERIC_REASON);
    });

    it('does not read 529 inside a token counter as provider overload', () => {
      expect(classify('  "cache_read_tokens": 105295,\n')).toBe(GENERIC_REASON);
    });

    it('does not read status codes inside a session UUID', () => {
      expect(classify(`${SESSION_LINE}\n`)).toBe(GENERIC_REASON);
    });

    it('classifies a whole real 1.8.x failure usage record as generic', () => {
      expect(classify(`${USAGE_JSON}\n${SESSION_LINE}\n`)).toBe(GENERIC_REASON);
    });

    // ------------------------------------------------------------------
    // Genuine diagnostics are still classified.
    // ------------------------------------------------------------------
    it('classifies HTTP 429 Too Many Requests as a rate limit', () => {
      expect(classify('HTTP 429 Too Many Requests\n')).toBe(RATE_LIMIT_REASON);
    });

    it('classifies a JSON status field of 429 as a rate limit', () => {
      expect(classify('{"status":429}\n')).toBe(RATE_LIMIT_REASON);
    });

    it('classifies a digit-free "rate limit" message as a rate limit', () => {
      expect(classify('rate limit exceeded\n')).toBe(RATE_LIMIT_REASON);
    });

    it('classifies HTTP 529 as provider overload', () => {
      expect(classify('HTTP 529 overloaded\n')).toBe(OVERLOADED_REASON);
    });

    it('classifies 401 Unauthorized as an auth error', () => {
      expect(classify('401 Unauthorized\n')).toBe(AUTH_REASON);
    });

    it('classifies 403 Forbidden as an auth error', () => {
      expect(classify('403 Forbidden\n')).toBe(AUTH_REASON);
    });

    it('classifies "invalid api key" as an auth error', () => {
      expect(classify('invalid api key\n')).toBe(AUTH_REASON);
    });

    it('classifies "timed out" as a timeout', () => {
      expect(classify('context deadline exceeded: timed out\n')).toBe(
        TIMEOUT_REASON,
      );
    });

    it('classifies "all N file review(s) failed" as a total per-file failure', () => {
      expect(classify('all 15 file review(s) failed\n')).toBe(
        ALL_FAILED_REASON,
      );
    });

    // ------------------------------------------------------------------
    // A genuine signal is not lost when the usage record is also present.
    // ------------------------------------------------------------------
    it('still classifies a genuine 429 alongside the usage record', () => {
      expect(
        classify(
          `${USAGE_JSON}\nHTTP 429 Too Many Requests\n${SESSION_LINE}\n`,
        ),
      ).toBe(RATE_LIMIT_REASON);
    });
  },
);

describe('.github/workflows/ocr-review.yml — OCR version pin (issue #2929)', () => {
  it('pins OCR_VERSION to the verified 1.8.4 release', () => {
    const workflow = parseWorkflowYaml(readRootFile(WORKFLOW_PATH));
    expect(asOptionalRecord(workflow.env)?.['OCR_VERSION']).toBe('1.8.4');
  });
});
