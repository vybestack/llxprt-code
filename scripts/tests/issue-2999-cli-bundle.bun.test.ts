/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2999 — the bundle must be genuinely launchable.
 *
 * This is the anti-mock-theater test: it actually builds the CLI bundle via
 * the same `scripts/bun-build.config.ts` machinery used at publish time, then
 * executes the artifact with the repo's Bun, asserting it prints the version
 * and exits 0. This proves:
 *   - externals resolve (node-pty, keyring, @ast-grep/*, opentui/UI);
 *   - no top-level-await breakage;
 *   - no broken import.meta/__dirname/require semantics in a bundle;
 *   - the artifact is genuinely launchable, not just syntactically valid.
 *
 * The build takes ~21s, so it is gated behind
 * `LLXPRT_RUN_BUNDLE_BUILD_TEST=1` to keep it off the default test shard. It
 * MUST run somewhere in CI (nightly) so externals drift is caught.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliBundleConfig } from '../bun-build.config.ts';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(__filename, '..', '..', '..');
// The Bun binary name is platform-dependent; CI runs on Linux.
const repoBun = join(
  repoRoot,
  'node_modules',
  'bun',
  'bin',
  process.platform === 'win32' ? 'bun.exe' : 'bun',
);
const bundlePath = join(repoRoot, 'packages', 'cli', 'bundle', 'llxprt.js');
const expectedVersion = (
  JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as {
    version: string;
  }
).version;

const RUN_BUILD_TEST = process.env.LLXPRT_RUN_BUNDLE_BUILD_TEST === '1';

describe.skipIf(!RUN_BUILD_TEST)(
  'issue #2999: prebuilt CLI bundle launches',
  () => {
    // The build takes ~21s; give it a generous floor so CI runners don't flake.
    it('builds the bundle and executes --version successfully', async () => {
      // Clean any stale bundle first so we prove the build produces a fresh one.
      rmSync(join(repoRoot, 'packages', 'cli', 'bundle'), {
        recursive: true,
        force: true,
      });

      // try/catch rather than .catch(): Bun.build can also throw synchronously
      // on a malformed config, and both paths must report the same way.
      let result: Awaited<ReturnType<typeof Bun.build>>;
      try {
        result = await Bun.build(cliBundleConfig);
      } catch (error) {
        throw new Error(
          `bundle build failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      expect(result.success).toBe(true);
      expect(existsSync(bundlePath)).toBe(true);

      // Execute the artifact with the same Bun that resolves 4,274 modules
      // when running raw TypeScript. A 0 exit with version output proves the
      // bundled module graph loads cleanly.
      const proc = spawnSync(repoBun, [bundlePath, '--version'], {
        encoding: 'utf8',
        timeout: 60_000,
        env: { ...process.env, CI: 'true' },
      });

      expect(proc.error).toBeUndefined();
      expect(proc.status).toBe(0);
      // Assert the exact version rather than a shape-matching regex: this also
      // proves the CLI_VERSION define was applied to the bundled artifact.
      expect(proc.stdout.trim()).toBe(expectedVersion);
    }, 90_000);

    // afterAll rather than a trailing `it`: cleanup must run even when the
    // build test fails or the runner aborts, otherwise the gitignored artifact
    // lingers and affects other tests (e.g. publish-integrity packing).
    afterAll(() => {
      rmSync(join(repoRoot, 'packages', 'cli', 'bundle'), {
        recursive: true,
        force: true,
      });
    });
  },
);
