/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3062 (AC3) — per-file walkthrough failures must never publish the
 * internal process/prompt diagnostics.
 *
 * `runMapPhase()` previously embedded `result.error` (the rejected
 * `execFile` error, whose message is the full `llxprt … --prompt <entire
 * prompt including the UNTRUSTED DATA payload>`) straight into the public
 * per-file summary. When every provider call failed, the rendered walkthrough
 * comment reproduced the command, the prompt, and the untrusted-data payload.
 *
 * This is a process-level regression: it runs the real walkthrough script as a
 * subprocess against real review artifacts and a deliberately failing `llxprt`
 * executable (on PATH), then asserts the rendered comment contains only a fixed
 * generic per-file failure summary plus the file path — never the diagnostics —
 * while the script's stderr still carries them for workflow logs.
 *
 * POSIX-only: the failing executable is a shebang script resolved by
 * `execFile` via PATH, which is the same boundary CI exercises.
 */

import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(__filename, '..', '..', '..');
const walkthroughScript = join(repoRoot, 'scripts', 'pr-review-walkthrough.ts');
// process.execPath is the Bun running this test, so it exists on every host
// (dev installs resolve Bun via the system PATH; the node_modules/bun layout
// is platform-specific and absent on some dev machines).
const bunExecutable = process.execPath;

// A unique marker planted inside review artifacts. It flows into the map
// prompt (buildMapPrompt embeds the diff and PR body), so a leaked command
// error would carry it into the public comment. The generic summary must not.
const DIFF_SENTINEL = 'LEAKSENTINEL_DIFF_3062';
const PR_SENTINEL = 'LEAKSENTINEL_PR_3062';
const UNTRUSTED_MARKER = 'UNTRUSTED DATA (JSON)';
// Unique marker planted in the diff so it flows through the map prompt into the
// rejected command diagnostic that the walkthrough logs on stderr. It must never
// reach the public comment. (The failing executable's own stdio is captured and
// discarded by execFile, so the prompt is the only propagation path into the
// logged diagnostic.)
const FAILED_SENTINEL = 'LLXPRT-FAKE-3062-FAILED';

const isPosix = process.platform !== 'win32';

describe.skipIf(!isPosix)(
  'issue #3062 (AC3): per-file failures publish a generic summary, not diagnostics',
  () => {
    it('renders a generic per-file summary and keeps diagnostics on stderr', () => {
      const sandbox = mkdtempSync(join(tmpdir(), 'llxprt-3062-walkthrough-'));
      try {
        const reviewDir = join(sandbox, 'review');
        mkdirSync(reviewDir, { recursive: true });
        mkdirSync(join(reviewDir, 'issues'), { recursive: true });
        mkdirSync(join(reviewDir, 'diffs'), { recursive: true });

        // Real review artifacts the pipeline reads (pr-review-artifacts.ts).
        writeFileSync(
          join(reviewDir, 'pr.json'),
          JSON.stringify({
            number: 3062,
            title: 'Restore walkthrough without prompt leakage',
            body: PR_SENTINEL,
            changedFiles: 1,
            additions: 5,
            deletions: 1,
          }),
        );
        writeFileSync(
          join(reviewDir, 'issues', '3062.json'),
          JSON.stringify({
            number: 3062,
            title: 'Issue 3062',
            body: 'Acceptance criteria for the walkthrough hardening.',
          }),
        );
        // Small diff (well under MAX_DIFF_BYTES) so it is not skipped as
        // oversized; it must reach the failing LLM call path.
        writeFileSync(
          join(reviewDir, 'diffs', 'app.diff'),
          [
            'diff --git a/src/app.ts b/src/app.ts',
            '--- a/src/app.ts',
            '+++ b/src/app.ts',
            '@@ -1,3 +1,4 @@',
            ' function app() {',
            '-  return null;',
            `+  return ${DIFF_SENTINEL};`,
            `+  // ${FAILED_SENTINEL}`,
            ' }',
            '',
          ].join('\n'),
        );
        writeFileSync(
          join(reviewDir, 'diff-manifest.txt'),
          'app.diff\tsrc/app.ts\n',
        );
        writeFileSync(join(reviewDir, 'numstat.txt'), '5\t1\tsrc/app.ts\n');
        const binDir = join(sandbox, 'bin');
        mkdirSync(binDir, { recursive: true });

        // Failing `llxprt` executable on PATH. It exits non-zero so execFile
        // rejects with a message equal to the full command + args, including the
        // `--prompt` value (which carries the diff, its sentinels, and the
        // UNTRUSTED DATA payload). That rejected message is the diagnostic the
        // walkthrough logs on stderr and which must never be published.
        // execFile captures and discards the child's own stdio, so the sentinels
        // reach the logged diagnostic solely via the prompt.
        const fakeLlxprt = join(binDir, 'llxprt');
        writeFileSync(fakeLlxprt, '#!/bin/sh\nexit 1\n');
        chmodSync(fakeLlxprt, 0o755);

        const childEnv = {
          ...process.env,
          PATH: binDir + delimiter + (process.env.PATH ?? ''),
          LLXPRT_DEFAULT_PROVIDER: 'openai',
          OPENAI_API_KEY: 'test',
          // Required by runLlxprtPrompt; never reached because llxprt fails.
          OPENAI_BASE_URL: 'http://127.0.0.1:9/v1',
          LLXPRT_DEFAULT_MODEL: 'gpt-test',
          LLXPRT_STRONG_MODEL: 'gpt-test',
          CI: 'true',
        };

        // Run the real walkthrough script at the same command boundary CI uses.
        // cwd is the sandbox so the script's hardcoded "review" dir resolves to
        // the artifacts above.
        const proc = spawnSync(bunExecutable, [walkthroughScript], {
          cwd: sandbox,
          encoding: 'utf8',
          timeout: 120_000,
          env: childEnv,
          maxBuffer: 10 * 1024 * 1024,
        });

        const stderr = proc.stderr ?? '';

        // The walkthrough must complete cleanly at the CI command boundary: a
        // timeout (proc.error set / signal SIGTERM) or a hang must not pass.
        expect(proc.error).toBeUndefined();
        expect(proc.status).toBe(0);
        expect(proc.signal).toBeNull();

        const commentPath = join(reviewDir, 'comment.md');
        if (!existsSync(commentPath)) {
          throw new Error(
            `walkthrough did not write comment.md. exit=${proc.status} signal=${proc.signal}\nstderr:\n${stderr}`,
          );
        }
        const comment = readFileSync(commentPath, 'utf8');

        // The public comment must identify the file and the generic failure.
        expect(comment).toContain('src/app.ts');
        expect(comment).toMatch(/per-file summary unavailable/i);

        // The public comment must NOT leak any internal diagnostic, including
        // the unique failing-executable marker and the prompt's sentinels.
        expect(comment).not.toContain(FAILED_SENTINEL);
        expect(comment).not.toContain(DIFF_SENTINEL);
        expect(comment).not.toContain(PR_SENTINEL);
        expect(comment).not.toContain(UNTRUSTED_MARKER);
        expect(comment).not.toContain('--prompt');
        expect(comment).not.toContain('Command failed: llxprt');

        // Internal diagnostics remain available on stderr itself (not stdout)
        // for workflow logs: the rejected command error carries the failing-
        // executable marker, the prompt, and its UNTRUSTED DATA payload —
        // proving diagnostics are logged rather than swallowed or published.
        expect(stderr).toContain(FAILED_SENTINEL);
        expect(stderr).toContain(UNTRUSTED_MARKER);
        expect(stderr).toContain(DIFF_SENTINEL);
        expect(stderr).toContain('--prompt');
        expect(stderr).toContain('Command failed: llxprt');
      } finally {
        rmSync(sandbox, { recursive: true, force: true });
      }
    }, 180_000);
  },
);
