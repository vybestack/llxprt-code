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

// Unique markers planted inside review artifacts. They flow into the map
// prompt (buildMapPrompt embeds the diff and PR body), so a leaked command
// error would carry them into the public comment or onto stderr. They must
// appear in neither: the subprocess boundary must redact the command/argv and
// --prompt value rather than logging them.
const DIFF_SENTINEL = 'LEAKSENTINEL_DIFF_3062';
const PR_SENTINEL = 'LEAKSENTINEL_PR_3062';
const UNTRUSTED_MARKER = 'UNTRUSTED DATA (JSON)';
// A second prompt-borne marker planted in the diff. It reaches the rejected
// command diagnostic only via the prompt (the failing executable's own stdio
// is captured and discarded by execFile), so its absence from stderr proves
// the prompt value itself was not serialized.
const FAILED_SENTINEL = 'LLXPRT-FAKE-3062-FAILED';
// A SAFE diagnostic the failing executable writes to its OWN stderr. It must
// survive onto the script's stderr (after secret redaction) so workflow logs
// keep a useful provider-side failure reason — proving diagnostics are redacted
// of the command/prompt, not silenced entirely.
const PROVIDER_DIAG_SENTINEL = 'PROVIDERDIAG_3062';

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

        // Failing `llxprt` executable on PATH. It writes a SAFE provider-side
        // diagnostic to its own stderr, then exits non-zero. execFile captures
        // the child's stdio, so that diagnostic reaches the parent only through
        // the rejected error object. The boundary must surface the provider
        // stderr (secret-redacted) and the exit code on the script's stderr,
        // while never serializing the command/argv or the `--prompt` value
        // (which carries the diff, its sentinels, and the UNTRUSTED DATA
        // payload).
        const fakeLlxprt = join(binDir, 'llxprt');
        writeFileSync(
          fakeLlxprt,
          `#!/bin/sh\necho "${PROVIDER_DIAG_SENTINEL}: upstream connection refused" 1>&2\nexit 7\n`,
        );
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
        // the unique failing-executable marker, the prompt's sentinels, or the
        // safe provider diagnostic (which belongs on stderr only).
        expect(comment).not.toContain(FAILED_SENTINEL);
        expect(comment).not.toContain(DIFF_SENTINEL);
        expect(comment).not.toContain(PR_SENTINEL);
        expect(comment).not.toContain(UNTRUSTED_MARKER);
        expect(comment).not.toContain(PROVIDER_DIAG_SENTINEL);
        expect(comment).not.toContain('--prompt');
        expect(comment).not.toContain('Command failed:');

        // SAFE diagnostics must remain on stderr (not stdout) for workflow
        // logs: the provider-side failure reason the executable wrote to its
        // own stderr, plus process-exit metadata. This proves diagnostics are
        // REDACTED of the command/prompt, not silenced entirely.
        expect(stderr).toContain(PROVIDER_DIAG_SENTINEL);
        expect(stderr).toMatch(/exit code/i);

        // The command/argv and the --prompt value must NEVER reach stderr: the
        // subprocess boundary redacts them at the source rather than logging the
        // rejected ExecError verbatim. Their prompt-borne sentinels must
        // therefore be absent as well.
        expect(stderr).not.toContain(FAILED_SENTINEL);
        expect(stderr).not.toContain(UNTRUSTED_MARKER);
        expect(stderr).not.toContain(DIFF_SENTINEL);
        expect(stderr).not.toContain(PR_SENTINEL);
        expect(stderr).not.toContain('--prompt');
        expect(stderr).not.toContain('Command failed:');
      } finally {
        rmSync(sandbox, { recursive: true, force: true });
      }
    }, 180_000);
  },
);
