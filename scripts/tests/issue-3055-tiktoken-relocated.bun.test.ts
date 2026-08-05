/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3055 — automated form of the manual "hide the package" reproduction.
 *
 * Builds a fixture that imports `@dqbd/tiktoken` and encodes a string, using
 * the CLI bundle's external policy (`cliBundleConfig.external`). The built
 * fixture is resolved against a *temporary* `node_modules` tree that this test
 * creates and owns (a copy of the real `@dqbd/tiktoken` package), then the
 * bundle is relocated next to a *fresh* `node_modules`, the original build
 * tree is deleted, and the relocated bundle is executed.
 *
 * - On main, `cliBundleConfig.external` does NOT include `@dqbd/tiktoken`, so
 *   the fixture inlines it with a build-machine `__dirname`; relocated away
 *   from the (now deleted) build tree, it throws "Missing tiktoken_bg.wasm"
 *   and the test FAILS.
 * - After the fix, `@dqbd/tiktoken` is external, so the relocated fixture
 *   resolves it from the temporary `node_modules` and the WASM is found
 *   relative to the package's real `__dirname` — the test PASSES.
 *
 * The fixture writes its token count to a file (path passed via env var) rather
 * than stdout: Bun's stdout pipe is not reliably flushed under `spawnSync` from
 * a `bun test` parent, so a file makes the assertion unambiguous. The
 * repository's own `node_modules` is never modified.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliBundleConfig } from '../bun-build.config.ts';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(__filename, '..', '..', '..');
const sourceTiktokenDir = join(repoRoot, 'node_modules', '@dqbd', 'tiktoken');

const tempDirs: string[] = [];

afterAll(() => {
  // Clean up every temp directory even when an assertion throws, so a failure
  // never leaves build/run trees behind on the runner.
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

describe('issue #3055: tiktoken resolves from a relocated node_modules', () => {
  it('a fixture built with the CLI external policy runs after relocation', async () => {
    // Precondition: this test copies the real @dqbd/tiktoken package out of
    // the repo's node_modules into temp trees. If dependencies are not
    // installed, cpSync throws an opaque ENOENT that does not explain the
    // precondition — fail fast here with an actionable message instead.
    if (!existsSync(sourceTiktokenDir)) {
      throw new Error(
        `Precondition unmet: @dqbd/tiktoken is not installed at ` +
          `${sourceTiktokenDir}. This test copies the real package into a ` +
          `temp tree; run 'npm install' (or 'bun install') at the repo ` +
          `root to restore it.`,
      );
    }

    // 1. Build directory with its OWN node_modules containing @dqbd/tiktoken,
    //    so the fixture resolves tiktoken at build time. On main (tiktoken not
    //    external) this inlines it and bakes __dirname into the build tree;
    //    after the fix it stays a runtime import.
    const buildDir = makeTempDir('llxprt-3055-build-');
    mkdirSync(join(buildDir, 'node_modules', '@dqbd'), { recursive: true });
    cpSync(
      sourceTiktokenDir,
      join(buildDir, 'node_modules', '@dqbd', 'tiktoken'),
      { recursive: true },
    );

    const entry = join(buildDir, 'entry.ts');
    writeFileSync(
      entry,
      [
        `import { get_encoding } from '@dqbd/tiktoken';`,
        `import { writeFileSync } from 'node:fs';`,
        `const encoder = get_encoding('o200k_base');`,
        `const tokens = encoder.encode('hello world', [], []);`,
        `writeFileSync(process.env.RESULT_FILE, String(tokens.length));`,
        `encoder.free();`,
        '',
      ].join('\n'),
    );

    // 2. Build with the CLI bundle's external policy — the same policy the
    //    shipped artifact uses.
    let result: Awaited<ReturnType<typeof Bun.build>>;
    try {
      result = await Bun.build({
        entrypoints: [entry],
        outdir: buildDir,
        target: 'bun',
        external: cliBundleConfig.external,
        naming: 'entry.js',
      });
    } catch (error) {
      throw new Error(
        `fixture build failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    expect(result.success).toBe(true);
    const fixtureBundle = join(buildDir, 'entry.js');
    expect(existsSync(fixtureBundle)).toBe(true);

    // 3. Relocation directory with a fresh node_modules we own, mirroring an
    //    install on a different machine. @dqbd/tiktoken has no dependencies of
    //    its own, so the package directory is self-contained.
    const runDir = makeTempDir('llxprt-3055-run-');
    mkdirSync(join(runDir, 'node_modules', '@dqbd'), { recursive: true });
    cpSync(
      sourceTiktokenDir,
      join(runDir, 'node_modules', '@dqbd', 'tiktoken'),
      { recursive: true },
    );
    const relocatedBundle = join(runDir, 'entry.js');
    copyFileSync(fixtureBundle, relocatedBundle);
    const resultFile = join(runDir, 'result.txt');

    // 4. Delete the build tree. This is the crux: an inlined (main) bundle has
    //    __dirname baked to a path that no longer exists, so the WASM lookup
    //    fails. An external (fixed) bundle resolves tiktoken from runDir's
    //    node_modules and finds the WASM relative to the package's real
    //    __dirname.
    rmSync(buildDir, { recursive: true, force: true });

    // 5. Execute the relocated bundle. process.execPath is the Bun binary
    //    running this test. The fixture writes its token count to resultFile.
    const proc = spawnSync(process.execPath, [relocatedBundle], {
      cwd: runDir,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, RESULT_FILE: resultFile },
    });

    expect(proc.error).toBeUndefined();
    // Assert the signal is null BEFORE status: when spawnSync kills the child
    // on timeout, proc.status is null and proc.signal is 'SIGTERM', so the
    // status assertion alone would read "expected null to be 0" and hide the
    // timeout. Naming the signal surfaces the real failure mode.
    expect(
      proc.signal,
      `relocated fixture was killed by signal ${proc.signal} (likely timeout).\n` +
        `stdout: ${proc.stdout}\nstderr: ${proc.stderr}`,
    ).toBeNull();
    expect(
      proc.status,
      `relocated fixture exited ${proc.status}.\n` +
        `stdout: ${proc.stdout}\nstderr: ${proc.stderr}`,
    ).toBe(0);
    // The result file's presence + numeric content proves the encoder actually
    // tokenised input using the relocated WASM payload.
    expect(existsSync(resultFile), resultFile).toBe(true);
    const tokenCount = readFileSync(resultFile, 'utf8').trim();
    // Assert the EXACT token count, not just > 0: a degenerate stub returning
    // `1` for every input would pass a positivity check without proving the
    // WASM actually executed. 'hello world' under o200k_base is deterministic
    // and produces exactly 2 tokens (measured empirically and confirmed stable
    // across node/bun; consistent with the bounded-range precedent in
    // token-divergence.test.ts:248-249 which asserts > 0 and < 10).
    const parsed = Number.parseInt(tokenCount, 10);
    expect(Number.isSafeInteger(parsed)).toBe(true);
    expect(parsed).toBe(2);
  }, 120_000);
});
