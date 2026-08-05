/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3068 — the prebuilt CLI bundle must ship the runtime data assets the
 * bundled code resolves relative to the bundle directory.
 *
 * `buildCliBundle()` inlines the whole module graph into a single
 * `packages/cli/bundle/llxprt.js`. Every module that locates a data file via
 * `__dirname` / `import.meta.url` then resolves it under `<bundle-dir>/…`, so
 * those files must be staged next to the bundle or every such read fails in
 * the published package (emscripten `tree-sitter.wasm` ENOENT abort + a CLI
 * with no providers available). These are behavioural tests: they build the
 * REAL bundle via the production entry point and assert against the REAL
 * output, then clean up the gitignored artifact in `afterAll`.
 *
 * Follows the pattern of `issue-3055-bundle-purity.bun.test.ts` (build the real
 * artifact in a child process, assert against it, clean up). The build is shared
 * across the asset/provider/wasm cases via a single `beforeAll` rather than
 * gated off, because the asset-presence assertions are cheap and valuable enough
 * to run in normal CI.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stageCliBundleAssets } from '../copy_bundle_assets.ts';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(__filename, '..', '..', '..');
const bundleDir = join(repoRoot, 'packages', 'cli', 'bundle');
const bundlePath = join(bundleDir, 'llxprt.js');

/** Lists regular file names directly inside a directory. */
function fileNamesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

/**
 * Recursively lists every regular file under `rootDir` as forward-slash relative
 * paths (sorted), so a staged tree can be compared to its source tree for exact
 * set-equality — a newly added source file can never be silently forgotten.
 */
function listRelativeFiles(rootDir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [''];
  while (stack.length > 0) {
    const rel = stack.pop();
    if (rel === undefined) {
      break;
    }
    const abs = rel === '' ? rootDir : join(rootDir, rel);
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        stack.push(childRel);
      } else if (entry.isFile()) {
        out.push(childRel);
      }
    }
  }
  return out.sort();
}

/**
 * Builds the real CLI bundle via the production `prepack` entry point. The build
 * is invoked as a child process (matching `prepack`) rather than in-process so
 * the test exercises the real artifact pipeline. Returns once `llxprt.js` and
 * every staged asset exist.
 */
function buildRealBundle(): void {
  rmSync(bundleDir, { recursive: true, force: true });
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
  expect(
    build.error,
    `CLI bundle build failed to spawn: ${
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
}

describe('issue #3068: CLI bundle ships its runtime assets', () => {
  // Shared spawn result for the provider-resolution and wasm-abort cases. Both
  // need the bundle to reach Config construction (which awaits the tree-sitter
  // parser) and provider activation, so a single launch covers both assertions.
  let providerLaunch: {
    stdout: string;
    stderr: string;
    status: number | null;
    signal: NodeJS.Signals | null;
  };

  beforeAll(() => {
    buildRealBundle();
    providerLaunch = launchBundleProviderResolve();
  }, 150_000);

  afterAll(() => {
    // The bundle is a gitignored publish artifact; remove it so a stale build
    // can never satisfy a future run or interfere with the launch smoke.
    rmSync(bundleDir, { recursive: true, force: true });
  });

  it('stages every required asset at its required bundle path', () => {
    // Asset 1: tree-sitter.wasm exists and is a real WASM file (magic bytes),
    // not a placeholder or an error page.
    const wasmPath = join(bundleDir, 'tree-sitter.wasm');
    expect(existsSync(wasmPath)).toBe(true);
    const wasmHeader = readFileSync(wasmPath).subarray(0, 4);
    // `\0asm` = 0x00 0x61 0x73 0x6d
    expect(Array.from(wasmHeader)).toEqual([0x00, 0x61, 0x73, 0x6d]);

    // Asset 2: provider aliases — staged set must EXACTLY match the source dir,
    // so a future added alias can never be silently forgotten.
    const sourceAliasDir = join(
      repoRoot,
      'packages/providers/src/composition/aliases',
    );
    const stagedAliasDir = join(bundleDir, 'providers', 'aliases');
    // Compared over the extensions the alias loader actually reads, matching
    // the staging filter, so incidental files in the source dir do not make
    // this assertion fail while a genuinely missed alias still does.
    const aliases = (dir: string): string[] =>
      fileNamesIn(dir).filter(
        (name) => name.endsWith('.config') || name.endsWith('.json'),
      );
    expect(aliases(stagedAliasDir)).not.toHaveLength(0);
    expect(new Set(aliases(stagedAliasDir))).toEqual(
      new Set(aliases(sourceAliasDir)),
    );

    // Asset 3: policy TOMLs — staged set must EXACTLY match the source dir.
    const sourcePolicyDir = join(repoRoot, 'packages/policy/src/policies');
    const stagedPolicyDir = join(bundleDir, 'policies');
    const tomls = (dir: string): string[] =>
      fileNamesIn(dir).filter((name) => name.endsWith('.toml'));
    expect(tomls(stagedPolicyDir)).not.toHaveLength(0);
    expect(new Set(tomls(stagedPolicyDir))).toEqual(
      new Set(tomls(sourcePolicyDir)),
    );

    // Asset 4: the six macOS seatbelt profiles, staged flat at the bundle root.
    const sbProfiles = fileNamesIn(bundleDir).filter((name) =>
      name.endsWith('.sb'),
    );
    expect(sbProfiles.sort()).toEqual(
      [
        'sandbox-macos-permissive-closed.sb',
        'sandbox-macos-permissive-open.sb',
        'sandbox-macos-permissive-proxied.sb',
        'sandbox-macos-restrictive-closed.sb',
        'sandbox-macos-restrictive-open.sb',
        'sandbox-macos-restrictive-proxied.sb',
      ].sort(),
    );

    // Asset 5: official tokenizer BPE assets (kimi-k3, glm-5.2, minimax-m3),
    // staged as a required tree under bundle/assets. Each model dir carries a
    // manifest, BPE file, and license; without them those models cannot start a
    // chat. Full recursive set-equality so a new asset cannot be forgotten.
    const sourceTokenizerDir = join(
      repoRoot,
      'packages/providers/src/tokenizers/official/assets',
    );
    const stagedTokenizerFiles = listRelativeFiles(join(bundleDir, 'assets'));
    expect(stagedTokenizerFiles).not.toHaveLength(0);
    expect(new Set(stagedTokenizerFiles)).toEqual(
      new Set(listRelativeFiles(sourceTokenizerDir)),
    );

    // Asset 6: extension boilerplate templates, staged as a required tree under
    // bundle/examples. `extensions new` readdir()s this in the yargs builder,
    // so a missing tree crashes argument parsing. Full recursive set-equality.
    const sourceExamplesDir = join(
      repoRoot,
      'packages/cli/src/commands/extensions/examples',
    );
    const stagedExampleFiles = listRelativeFiles(join(bundleDir, 'examples'));
    expect(stagedExampleFiles).not.toHaveLength(0);
    expect(new Set(stagedExampleFiles)).toEqual(
      new Set(listRelativeFiles(sourceExamplesDir)),
    );

    // Asset 7: prompt-default markdown tree, preserving structure. These are
    // spot checks rather than a full set-equality because the stager globs
    // `**/*.md`; the deepest leaves vary across providers/models, so a
    // representative sample (root, a tool, a nested provider/model) proves the
    // tree was mirrored while staying resilient to unrelated leaf churn.
    expect(existsSync(join(bundleDir, 'core.md'))).toBe(true);
    expect(existsSync(join(bundleDir, 'tools', 'shell.md'))).toBe(true);
    expect(existsSync(join(bundleDir, 'providers', 'gemini', 'core.md'))).toBe(
      true,
    );
  });

  it('resolves built-in providers from the bundle (no "not found")', () => {
    // This is the exact reproduction from issue #3068. Before the fix the bundle
    // staged no provider aliases, so provider activation failed with
    // "Provider 'openai' not found". The spawn still fails later for a missing
    // API key (expected); we assert only on the ABSENCE of the not-found error.
    const combined = providerLaunch.stdout + providerLaunch.stderr;
    // Guard against a vacuous pass: the spawn must actually have run past
    // startup (not be spawn-killed or empty), otherwise the absence assertion
    // would be meaningless.
    expect(
      providerLaunch.signal,
      'provider spawn was killed (likely timeout)',
    ).toBeNull();
    expect(
      combined.length,
      'provider spawn produced no output; the absence assertion would be vacuous',
    ).toBeGreaterThan(0);
    expect(combined).not.toContain("Provider 'openai' not found");
  });

  it('does not abort on a missing tree-sitter.wasm', () => {
    const combined = providerLaunch.stdout + providerLaunch.stderr;
    // Positive progress guard: prove the launch reached Config construction
    // (which awaits initializeParser(), where a missing wasm prints its abort)
    // and beyond, so the absence assertions below cannot pass vacuously.
    //
    // Measured behaviour: with no API key the run reaches the provider auth
    // check — a post-Config failure — and reports it. In the FULL pre-fix state
    // (a bundle containing only llxprt.js) the CLI instead dies in
    // setupRuntimeContext -> createProviderManager with "Provider 'openai' not
    // found" BEFORE Config construction ever awaits initializeParser(), so on a
    // full revert NEITHER wasm string appears and these absence assertions
    // would hold vacuously. Removing ONLY tree-sitter.wasm from an otherwise
    // complete bundle DOES reproduce both abort lines from the issue, so this
    // progress guard is what distinguishes "wasm is fine" from "the launch
    // never got far enough to print the abort".
    expect(
      combined,
      'launch did not reach Config/post-Config execution; wasm assertions ' +
        'would be vacuous (pre-fix bundles die with "Provider not found" ' +
        'before initializeParser runs)',
    ).toMatch(/Auth token unavailable|Error when talking to/);
    expect(combined).not.toContain('failed to asynchronously prepare wasm');
    expect(combined).not.toContain('tree-sitter.wasm');
  });
});

/**
 * Runs the built bundle with an OpenAI provider prompt using an environment that
 * guarantees a fast LOCAL failure (no API key → auth error, no network reach),
 * while still exercising Config construction and provider activation. The
 * process is expected to exit non-zero on its own; the timeout is a safety net.
 *
 * Output is captured by a SHELL REDIRECT to files, not by `spawnSync`'s own
 * capture. Under the `bun:test` harness every in-process capture method for a
 * spawned child is broken: `spawnSync` (pipe and explicit `stdio` fd) and
 * `Bun.spawn` streaming all return EMPTY stdout/stderr while the exit code is
 * still correct — measured for `bun test v1.3.14` against this repo's
 * `bunfig.toml`, where a `spawnSync` of the real bundle returns `errLen=0` but
 * a shell redirect of the identical command captures the full 337-char auth
 * error. (The same `spawnSync` DOES capture when driven from a plain `bun`
 * script outside `bun:test`, which is the source of the false premise.) A shell
 * redirect writes the child's stdio straight to files at the OS level, so the
 * files are the only reliable way to observe what the launched bundle prints.
 *
 * Finding A8 asked for plain `spawnSync`; that is a documented deviation here —
 * plain `spawnSync` makes the wasm/provider assertions vacuous, contradicting
 * A7's anti-vacuity requirement. The command is passed to `sh` as separate argv
 * consumed positionally (`"$0" "$@"`), so no shell quoting is needed and the
 * args are never re-parsed by the shell (injection-safe).
 */
function launchBundleProviderResolve(): {
  stdout: string;
  stderr: string;
  status: number | null;
  signal: NodeJS.Signals | null;
} {
  const isolatedHome = mkdtempSync(join(tmpdir(), 'issue3068-bundle-run-'));
  const outFile = join(isolatedHome, 'stdout.txt');
  const errFile = join(isolatedHome, 'stderr.txt');
  try {
    // Strip any real auth/credentials and isolate config so the provider fails
    // locally and the spawn never reaches the network (which would hang/retry
    // indefinitely). API keys, HOME, XDG_CONFIG_HOME, and every LLXPRT_* var
    // are cleared so a developer machine's real config cannot leak into the run.
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CI: 'true',
      HOME: isolatedHome,
    };
    for (const key of [
      'OPENAI_API_KEY',
      'OPENAI_BASE_URL',
      'GOOGLE_API_KEY',
      'GEMINI_API_KEY',
      'ANTHROPIC_API_KEY',
      'XDG_CONFIG_HOME',
    ]) {
      delete env[key];
    }
    for (const key of Object.keys(env)) {
      if (key.startsWith('LLXPRT_')) {
        delete env[key];
      }
    }
    env.__I3068_OUT = outFile;
    env.__I3068_ERR = errFile;
    const result = spawnSync(
      'sh',
      [
        '-c',
        '"$0" "$@" > "$__I3068_OUT" 2> "$__I3068_ERR"',
        process.execPath,
        bundlePath,
        '--provider',
        'openai',
        '--model',
        'gpt-4o',
        '-p',
        'hi',
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 60_000,
        env,
      },
    );
    return {
      stdout: existsSync(outFile) ? readFileSync(outFile, 'utf8') : '',
      stderr: existsSync(errFile) ? readFileSync(errFile, 'utf8') : '',
      status: result.status,
      signal: result.signal,
    };
  } finally {
    rmSync(isolatedHome, { recursive: true, force: true });
  }
}

describe('issue #3068: staging fails fast on a missing required asset', () => {
  it('throws an actionable error naming the missing path (file-shaped asset)', () => {
    // A fresh checkout must still be able to run `npm run bundle:cli`, but a
    // source root missing a REQUIRED asset must never silently produce a broken
    // bundle. Drive the staging function against an empty source root and
    // assert it throws naming the absent asset. The first required stager is
    // the file-shaped tree-sitter.wasm, so this exercises the file-shaped path.
    const emptyRoot = mkdtempSync(join(tmpdir(), 'issue3068-empty-root-'));
    try {
      expect(() =>
        stageCliBundleAssets({
          repoRoot: emptyRoot,
          bundleDir: join(emptyRoot, 'bundle'),
        }),
      ).toThrow(/tree-sitter\.wasm/);
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it('throws an actionable error when a DIRECTORY-shaped asset is missing', () => {
    // The empty-root case above only reaches the first (file-shaped) required
    // asset. Directory-shaped required assets use stageRequiredDir /
    // stageRequiredTree, whose existsSync guard is what turns a missing source
    // directory into an actionable error instead of a raw ENOENT from
    // readdirSync. Expose the real node_modules so the wasm stage resolves and
    // the stager reaches the first directory asset (provider aliases), which is
    // absent in this synthetic root.
    const root = mkdtempSync(join(tmpdir(), 'issue3068-dir-root-'));
    try {
      symlinkSync(join(repoRoot, 'node_modules'), join(root, 'node_modules'));
      let thrown: Error | undefined;
      try {
        stageCliBundleAssets({
          repoRoot: root,
          bundleDir: join(root, 'bundle'),
        });
      } catch (e) {
        thrown = e instanceof Error ? e : new Error(String(e));
      }
      if (thrown === undefined) {
        throw new Error('staging a missing directory asset must throw');
      }
      // Actionable message naming the missing directory asset, NOT the raw fs
      // ENOENT/scandir that readdirSync would otherwise leak.
      expect(thrown.message).toContain('provider alias configs');
      expect(thrown.message).toContain('missing at');
      expect(thrown.message).not.toContain('ENOENT');
      expect(thrown.message).not.toContain('scandir');
    } finally {
      // Remove the symlink explicitly first so the real node_modules is never
      // touched, then clean the rest of the synthetic root.
      rmSync(join(root, 'node_modules'), { force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('issue #3068: gitCommitInfo resolves beside the loader', () => {
  it('finds git-commit.json sitting next to the loader (bundle-root layout)', async () => {
    // The fix adds a loader-relative candidate (`join(loaderDir, INFO_FILENAME)`)
    // so that when bundled — loaderDir IS the bundle root — the JSON copied next
    // to the bundle is found regardless of the caller's cwd. Behavioural: copy
    // the real loader into a bundle-root-shaped layout (a temp dir inside the
    // repo so its bare imports still resolve) with a known commit beside it, and
    // assert the loader returns that exact commit.
    const gitCommitInfoSrc = join(
      repoRoot,
      'packages/cli/src/utils/gitCommitInfo.ts',
    );
    // tmp/ is gitignored and has no tracked files, so on a fresh checkout it may
    // not exist; create it (recursively) before mkdtempSync. The temp dir stays
    // INSIDE the repo on purpose: the copied loader imports
    // @vybestack/llxprt-code-telemetry and needs the node_modules walk-up.
    const loaderParent = join(repoRoot, 'tmp');
    mkdirSync(loaderParent, { recursive: true });
    const loaderDir = mkdtempSync(join(loaderParent, 'issue3068-gitcommit-'));
    const savedPath = process.env.LLXPRT_GIT_COMMIT_INFO_PATH;
    try {
      copyFileSync(gitCommitInfoSrc, join(loaderDir, 'gitCommitInfo.ts'));
      const knownCommit = 'cafebabe3068';
      writeFileSync(
        join(loaderDir, 'git-commit.json'),
        JSON.stringify({ commit: knownCommit }),
      );
      // Ensure the non-override candidate path is exercised.
      delete process.env.LLXPRT_GIT_COMMIT_INFO_PATH;

      // Importing the COPY gives it an import.meta.url rooted at loaderDir, so
      // the loader-relative candidate resolves exactly the bundled layout.
      const moduleUrl = pathToFileURL(join(loaderDir, 'gitCommitInfo.ts')).href;
      const mod = await import(moduleUrl);
      // knownCommit lives ONLY beside the loader, so returning it proves the
      // loader-relative candidate is the one that resolved.
      expect(mod.getGitCommitInfo()).toBe(knownCommit);
    } finally {
      // Restore the env var so the test cannot leak its deletion to siblings.
      if (savedPath === undefined) {
        delete process.env.LLXPRT_GIT_COMMIT_INFO_PATH;
      } else {
        process.env.LLXPRT_GIT_COMMIT_INFO_PATH = savedPath;
      }
      rmSync(loaderDir, { recursive: true, force: true });
    }
  });
});
