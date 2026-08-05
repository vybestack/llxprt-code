/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3055 — the shipped CLI bundle must not bake the build machine's
 * absolute filesystem path into the artifact.
 *
 * When Bun inlines a CommonJS module it freezes `__dirname` as a build-time
 * string literal. Dependencies that locate runtime assets (WASM, locales,
 * config) relative to their own `__dirname` then ship the *builder's* path,
 * which resolves only on the build machine and leaks the release engineer's
 * filesystem layout into user stack traces. `@dqbd/tiktoken` throws
 * "Missing tiktoken_bg.wasm" at import time on every other machine, killing
 * the CLI before any of our code runs.
 *
 * This guard builds the real CLI bundle and asserts the emitted `llxprt.js`
 * contains no absolute path rooted at the repository/build root. It generalises
 * beyond tiktoken: the next dependency that bakes `__dirname` fails here, named
 * explicitly in the failure message.
 *
 * The build is invoked as a child process (`scripts/bun-build.config.ts
 * --cli-only`) rather than `Bun.build(cliBundleConfig)` in-process. The
 * production `prepack` step invokes the exact same entry point, so this
 * exercises the real artefact pipeline; and the in-repo `bunfig.toml` test
 * preload interferes with Bun.build's resolution of the CLI entry's dynamic
 * `import('./src/cli.js')` when run under `bun test`, so a fresh process is
 * both more faithful and more reliable.
 *
 * Unlike the launch smoke (`issue-2999-cli-bundle.bun.test.ts`), this guard is
 * NOT gated behind `LLXPRT_RUN_BUNDLE_BUILD_TEST`, so it runs in the `scripts`
 * shard on every PR that touches the bundle config or any dependency
 * (`package.json` / lockfiles are shared inputs that force a full run).
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(__filename, '..', '..', '..');
const bundleDir = join(repoRoot, 'packages', 'cli', 'bundle');
const bundlePath = join(bundleDir, 'llxprt.js');

afterAll(() => {
  // The bundle is a gitignored publish artifact; remove it so a stale build
  // can never satisfy a future run or interfere with the launch smoke.
  rmSync(bundleDir, { recursive: true, force: true });
});

describe('issue #3055: prebuilt CLI bundle is free of build-tree paths', () => {
  it('the shipped llxprt.js contains no absolute path rooted at the repo root', () => {
    // Start from a clean slate so a stale artifact can never satisfy the check.
    rmSync(bundleDir, { recursive: true, force: true });

    // Build the real CLI bundle via the production entry point. process.execPath
    // is the Bun binary running this test; a fresh process avoids the in-test
    // bunfig preload that interferes with Bun.build's dynamic-import resolution.
    const build = spawnSync(
      process.execPath,
      ['scripts/bun-build.config.ts', '--cli-only'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 120_000,
        env: { ...process.env, CI: 'true' },
      },
    );
    // Assert spawn health BEFORE status: when spawnSync fails to spawn
    // (ENOENT) or kills the child on timeout, build.status is null and the
    // real cause lives in build.error / build.signal. Asserting these first
    // names the actual failure mode instead of masking it as
    // "expected null to be 0" with empty streams.
    expect(
      build.error,
      `CLI bundle build failed to spawn (ENOENT or unavailable binary): ${
        build.error instanceof Error ? build.error.message : String(build.error)
      }`,
    ).toBeUndefined();
    expect(
      build.signal,
      `CLI bundle build was killed by signal ${build.signal} (likely timeout).\n` +
        `stdout: ${build.stdout}\nstderr: ${build.stderr}`,
    ).toBeNull();
    expect(
      build.status,
      `CLI bundle build failed (exit ${build.status}).\nstdout: ${build.stdout}\nstderr: ${build.stderr}`,
    ).toBe(0);
    expect(existsSync(bundlePath)).toBe(true);

    const contents = readFileSync(bundlePath, 'utf8');

    // Any dependency that bakes __dirname emits the build root as a string
    // literal. Scanning for the repo root catches every such leak without
    // naming individual packages, so this stays correct as deps drift — and
    // it closes the path-disclosure leak in one general rule.
    //
    // We scan for BOTH the raw OS path and its JavaScript-escaped form
    // (JSON.stringify, which doubles backslashes on Windows). Bun emits
    // string literals in the bundle using double quotes, but the exact
    // escaping depends on the Bun version and the path separator. On Windows
    // the raw repoRoot is `C:\work\repo`, but Bun emits `"C:\\work\\repo\\..."`
    // (the JavaScript-escaped form). A regex built from the raw path uses
    // unescaped backslashes and would never match on Windows, silently
    // passing the guard. We also cover realpathSync(repoRoot) because Bun
    // may canonicalize a symlinked checkout, emitting the real path rather
    // than the logical one.
    const pathForms = new Set<string>();
    for (const basePath of [repoRoot, realpathSync(repoRoot)]) {
      pathForms.add(basePath);
      pathForms.add(JSON.stringify(basePath).slice(1, -1));
    }

    const offending: string[] = [];
    for (const pathForm of pathForms) {
      if (pathForm.length === 0) continue;
      const pattern = new RegExp(`${escapeRegExp(`"${pathForm}`)}[^"]*"`, 'g');
      for (const match of contents.matchAll(pattern)) {
        if (!offending.includes(match[0])) {
          offending.push(match[0]);
        }
      }
    }

    expect(
      offending,
      `CLI bundle leaked build-tree absolute path(s) into the shipped artifact. ` +
        `This usually means a CommonJS dependency that derives a runtime asset ` +
        `path from __dirname was inlined; mark it external in cliBundleConfig ` +
        `(see CLI_DIRNAME_DEPENDENT_EXTERNALS). Offending path(s):\n` +
        offending.map((path) => `  ${path}`).join('\n'),
    ).toEqual([]);
  }, 180_000);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
