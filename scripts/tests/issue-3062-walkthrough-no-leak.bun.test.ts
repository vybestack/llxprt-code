/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const DIFF_SENTINEL = 'LEAKSENTINEL_DIFF_3062';
const PR_SENTINEL = 'LEAKSENTINEL_PR_3062';
const FAILED_SENTINEL = 'LLXPRT-FAKE-3062-FAILED';
const PROVIDER_DIAG_SENTINEL = 'PROVIDERDIAG_3062';
const UNTRUSTED_MARKER = 'UNTRUSTED DATA (JSON)';

describe('issue #3062: local per-file failures never publish prompts or diagnostics', () => {
  it('renders generic failures and retains safe HTTP diagnostics at the real process boundary', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'llxprt-3062-walkthrough-'));
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () =>
        new Response(`${PROVIDER_DIAG_SENTINEL}: ${FAILED_SENTINEL}`, {
          status: 400,
        }),
    });
    try {
      const reviewDir = join(sandbox, 'review');
      await mkdir(join(reviewDir, 'issues'), { recursive: true });
      await mkdir(join(reviewDir, 'diffs'), { recursive: true });
      await writeFile(
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
      await writeFile(
        join(reviewDir, 'issues/3062.json'),
        JSON.stringify({
          number: 3062,
          title: 'Issue 3062',
          body: 'Acceptance criteria for walkthrough hardening.',
        }),
      );
      await writeFile(
        join(reviewDir, 'diffs/app.diff'),
        `diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,3 +1,4 @@\n function app() {\n-  return null;\n+  return ${DIFF_SENTINEL};\n+  // ${FAILED_SENTINEL}\n }\n`,
      );
      await writeFile(
        join(reviewDir, 'diff-manifest.txt'),
        'app.diff\tsrc/app.ts\n',
      );
      await writeFile(join(reviewDir, 'numstat.txt'), '5\t1\tsrc/app.ts\n');
      await writeFile(
        join(reviewDir, 'related.json'),
        JSON.stringify({ state: 'complete', items: [] }),
      );
      const proc = Bun.spawn(
        [
          process.execPath,
          resolve(import.meta.dirname, '../pr-review-walkthrough.ts'),
        ],
        {
          cwd: sandbox,
          env: {
            ...process.env,
            LOCAL_REVIEW_ENDPOINT: `http://127.0.0.1:${server.port}`,
            OPENAI_API_KEY: 'SECRET_HOSTED_KEY',
            GH_TOKEN: 'SECRET_GH_TOKEN',
          },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const [status, stderr, stdout] = await Promise.all([
        proc.exited,
        new Response(proc.stderr).text(),
        new Response(proc.stdout).text(),
      ]);
      expect(status).toBe(0);
      expect(proc.signalCode).toBeNull();
      const comment = await readFile(join(reviewDir, 'comment.md'), 'utf8');
      expect(comment).toContain('src/app.ts');
      expect(comment).toMatch(/per-file summary unavailable/i);
      expect(comment).toContain('Review incomplete');
      for (const sentinel of [
        FAILED_SENTINEL,
        DIFF_SENTINEL,
        PR_SENTINEL,
        UNTRUSTED_MARKER,
        PROVIDER_DIAG_SENTINEL,
        '--prompt',
        'Command failed:',
        'SECRET_HOSTED_KEY',
        'SECRET_GH_TOKEN',
      ]) {
        expect(comment).not.toContain(sentinel);
        expect(stderr).not.toContain(sentinel);
        expect(stdout).not.toContain(sentinel);
      }
      expect(stderr).toContain('Local inference HTTP 400');
      expect(stdout).not.toContain('Local inference HTTP 400');
    } finally {
      server.stop(true);
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});
