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

/**
 * Scans emitted bundle source for quoted string literals that begin with a
 * build-root path form, returning every distinct offending literal.
 *
 * The repo root must be followed by a path separator (a forward slash, or
 * the JavaScript-escaped Windows separator - a backslash Bun emits doubled)
 * OR the closing quote, so a path that merely SHARES the repo root as a
 * prefix is not mistaken for a leak: with root `/foo/bar` the unrelated
 * literal `"/foo/barbecue/thing"` is NOT reported while
 * `"/foo/bar/node_modules/..."` IS. A zero-width lookahead enforces that
 * boundary while still letting `[^"]*"` capture the complete quoted literal,
 * so the failure message names the full offending path.
 *
 * Extracted from the inline scan so the prefix-rejection contract is unit
 * tested directly (synthetic strings) without building a real bundle, using
 * the SAME predicate the real guard uses.
 */
function findBuildRootPathLeaks(
  contents: string,
  pathForms: Iterable<string>,
): string[] {
  const offending: string[] = [];
  for (const pathForm of pathForms) {
    if (pathForm.length === 0) continue;
    // Lookahead asserts the repo root is followed by a path separator or the
    // closing quote. A single backslash in the class covers the doubled `\`
    // Bun emits (its first backslash satisfies the class) as well as any raw
    // single-backslash path form.
    const pattern = new RegExp(
      `${escapeRegExp(`"${pathForm}`)}(?=[/\\\\]|")[^"]*"`,
      'g',
    );
    for (const match of contents.matchAll(pattern)) {
      if (!offending.includes(match[0])) {
        offending.push(match[0]);
      }
    }
  }
  return offending;
}

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

    const offending = findBuildRootPathLeaks(contents, pathForms);

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

describe('issue #3055: build-root leak scan rejects prefix false positives', () => {
  // The scan must require the repo root to be followed by a path separator (or
  // the closing quote), so a path that merely shares the repo root as a prefix
  // is not mistaken for a leak. These exercise the SAME findBuildRootPathLeaks
  // the real guard uses, so a regression here means the guard is broken too.
  // No real bundle is built: pure-string inputs keep this fast and hermetic.

  it('does not report a sibling path that only shares the repo-root prefix', () => {
    const fakeRoot = '/foo/bar';
    // "/foo/bar" + "ecue/..." shares the prefix but is a different path; it
    // must NOT be flagged. The real leak ("/foo/bar/node_modules/...") MUST.
    const source = `"${fakeRoot}ecue/thing", "${fakeRoot}/node_modules/leaked"`;
    const offending = findBuildRootPathLeaks(source, [fakeRoot]);
    expect(offending).toEqual([`"${fakeRoot}/node_modules/leaked"`]);
  });

  it('reports a real leak rooted at the repo root', () => {
    const fakeRoot = '/foo/bar';
    const leaked = `"${fakeRoot}/node_modules/@dqbd/tiktoken/asset.wasm"`;
    expect(findBuildRootPathLeaks(leaked, [fakeRoot])).toEqual([leaked]);
  });

  it('reports an exact repo-root match followed immediately by the closing quote', () => {
    const fakeRoot = '/foo/bar';
    const exact = `"${fakeRoot}"`;
    expect(findBuildRootPathLeaks(exact, [fakeRoot])).toEqual([exact]);
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
