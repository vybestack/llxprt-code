/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asOptionalRecord,
  asRecord,
  asString,
  errorField,
  parseWorkflowYaml,
} from './typed-test-helpers.ts';
import {
  WORKFLOW_PATH,
  commandText,
  extractBashBlock,
  hasBash,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.ts';

// OCR >= 1.8.0 writes this structured usage record (emitFailureUsage in
// cmd/opencodereview/output.go) to stderr when a `--format json` review fails.
// It is a pretty-printed top-level JSON object whose braces sit alone at
// column 0. Its counters embed digit runs that look like HTTP status codes
// (214295 contains "429", 240123 contains "401", 105295 contains "529") and
// the session UUID contains "429b" and "403a".
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
  "tool_calls": {
    "total": 12,
    "by_tool": {
      "code_search": 4,
      "file_read": 6,
      "file_read_diff": 2
    }
  },
  "session_id": "7c1d429b-403a-4e51-9f52-9b0a1c2d3e4f"
}`;

// The same record with counters whose values are exactly the status codes the
// classifier looks for. Token-boundary anchoring alone cannot reject these —
// only dropping the record can.
const USAGE_JSON_EXACT_CODES = `{
  "status": "failed",
  "summary": {
    "files_reviewed": 429,
    "total_tokens": 401,
    "input_tokens": 403,
    "output_tokens": 529,
    "cache_read_tokens": 0,
    "cache_write_tokens": 0,
    "elapsed": "3s",
    "budget_exceeded": false
  },
  "tool_calls": {
    "total": 529,
    "by_tool": {
      "code_search": 429,
      "file_read": 403
    }
  },
  "session_id": "0d1f2a3b-4c5d-6e7f-8a9b-0c1d2e3f4a5b"
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
    let classifierBlock: string;

    beforeAll(() => {
      const workflow = parseWorkflowYaml(readRootFile(WORKFLOW_PATH));
      const jobs = workflow.jobs;
      if (!jobs) throw new Error('workflow should have jobs');
      const reviewStep = stepNamed(
        asRecord(jobs['code-review']),
        'Run OpenCodeReview',
      );
      // Extract the REAL classification block (usage-record strip plus the
      // if/elif/fi chain) from the workflow rather than re-implementing it.
      classifierBlock = extractBashBlock(
        commandText(reviewStep),
        /^\s*ocr_diagnostics="\$\(awk /,
      );
    });

    // One workspace for the whole suite: removing it in afterAll keeps a
    // cleanup failure in its own hook instead of masking a test failure.
    let directory: string;

    beforeAll(() => {
      directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ocr-classification-2929-'),
      );
    });

    afterAll(() => {
      fs.rmSync(directory, { recursive: true, force: true });
    });

    function classify(stderrContent: string): string {
      const artifactPath = path.join(
        directory,
        'ocr-infrastructure-failure.txt',
      );
      // The workflow's mark_infrastructure_failure appends, so start each case
      // from an empty artifact.
      fs.rmSync(artifactPath, { force: true });
      fs.writeFileSync(
        path.join(directory, 'ocr-stderr.log'),
        stderrContent,
        'utf8',
      );
      try {
        execFileSync(
          'bash',
          ['-c', ['set -euo pipefail', MARK_STUB, classifierBlock].join('\n')],
          {
            cwd: directory,
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8',
          },
        );
      } catch (error) {
        throw new Error(
          [
            'The extracted classification block failed to run.',
            `status: ${errorField(error, 'status')}`,
            `stderr: ${errorField(error, 'stderr')}`,
            `input: ${JSON.stringify(stderrContent)}`,
          ].join('\n'),
          { cause: error },
        );
      }
      const content = fs.readFileSync(artifactPath, 'utf8').trim();
      const reasonMatch = /reason=(.*)$/.exec(content);
      expect(
        reasonMatch,
        `unexpected artifact content: ${content}`,
      ).not.toBeNull();
      return asString(reasonMatch?.[1]);
    }

    // ------------------------------------------------------------------
    // Codes embedded inside longer numbers or hex identifiers are rejected
    // by the token-boundary anchoring. Each case isolates one embedded run
    // so a regression in a single pattern cannot be masked by another.
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

    // ------------------------------------------------------------------
    // Counters whose value is exactly a status code are only rejected
    // because the usage record itself is dropped before classification.
    // ------------------------------------------------------------------
    it('classifies a whole real 1.8.x failure usage record as generic', () => {
      expect(classify(`${USAGE_JSON}\n${SESSION_LINE}\n`)).toBe(GENERIC_REASON);
    });

    it('ignores usage counters whose value is exactly a status code', () => {
      expect(classify(`${USAGE_JSON_EXACT_CODES}\n${SESSION_LINE}\n`)).toBe(
        GENERIC_REASON,
      );
    });

    it('does not let an exact-valued usage counter mask a later diagnostic', () => {
      expect(
        classify(
          `${USAGE_JSON_EXACT_CODES}\ncontext deadline exceeded: timed out\n`,
        ),
      ).toBe(TIMEOUT_REASON);
    });

    // ------------------------------------------------------------------
    // Genuine diagnostics are still classified.
    // ------------------------------------------------------------------
    it('classifies HTTP 429 Too Many Requests as a rate limit', () => {
      expect(classify('HTTP 429 Too Many Requests\n')).toBe(RATE_LIMIT_REASON);
    });

    it('classifies a single-line provider error payload of 429 as a rate limit', () => {
      expect(classify('{"error":{"code":429,"message":"quota"}}\n')).toBe(
        RATE_LIMIT_REASON,
      );
    });

    it('classifies a multi-line provider error surfaced through the Error: prefix', () => {
      // OCR surfaces provider failures through `fmt.Fprintf(os.Stderr,
      // "Error: %v\n", err)`, so even a body containing braces never begins
      // with a bare `{` at column 0 and is therefore never stripped.
      expect(
        classify(
          'Error: review failed: POST "https://api.example/v1/messages": 429 Too Many Requests\n' +
            '{"type":"error","error":{"type":"rate_limit_error"}}\n',
        ),
      ).toBe(RATE_LIMIT_REASON);
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

    it('still classifies a genuine 429 emitted before the usage record', () => {
      expect(
        classify(
          `HTTP 429 Too Many Requests\n${USAGE_JSON}\n${SESSION_LINE}\n`,
        ),
      ).toBe(RATE_LIMIT_REASON);
    });

    it('classifies the real 1.8.4 per-file read failure line as generic', () => {
      // OCR prints tool failures as
      // `[ocr]   ✘ file_read failed: file "path" not found: ...` — the format
      // the coverage report's read-failure extractor consumes. It carries no
      // provider status, so the failure cause stays generic.
      expect(
        classify(
          '[ocr]   \u2718 file_read failed: file "src/missing.ts" not found: no such file\n',
        ),
      ).toBe(GENERIC_REASON);
    });
  },
);

describe('.github/workflows/ocr-review.yml — OCR version pin (issue #2929)', () => {
  it('pins OCR_VERSION to the verified 1.8.4 release', () => {
    const workflow = parseWorkflowYaml(readRootFile(WORKFLOW_PATH));
    expect(asOptionalRecord(workflow.env)?.['OCR_VERSION']).toBe('1.8.4');
  });
});
