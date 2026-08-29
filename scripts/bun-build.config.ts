/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun-based bundling for distributable artifacts.
 * Replaces the retired `esbuild.config.js`.
 *
 * Two targets are produced when this script runs as the main module:
 *
 *  1. `packages/a2a-server/dist/a2a-server.mjs` — the self-contained a2a-server
 *     artifact consumed by release/packaging workflows.
 *  2. `packages/cli/bundle/llxprt.js` — a prebuilt CLI bundle (issue #2999).
 *     The published package ships raw TypeScript, so Bun resolves, transpiles,
 *     and evaluates the whole module graph on *every* launch. Building that
 *     graph once at publish time and shipping the artifact removes the
 *     per-launch cost; see issue #2999 for current benchmark numbers.
 *     TypeScript remains the source of truth; the bundle is a gitignored
 *     publish artifact, never committed.
 *
 * The build configs are exported so tests can build the CLI bundle directly
 * (proving externals resolve and the artifact launches) without triggering the
 * a2a-server build. Top-level execution is guarded by `import.meta.main`.
 */

import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { portableTiktokenPlugin } from './portable-tiktoken-plugin.js';
import { stageCliBundleAssets } from './copy_bundle_assets.js';

/**
 * Re-exported so the issue #3062 guard keeps its import path. The alias
 * collection itself now lives with the rest of the bundle asset staging in
 * `copy_bundle_assets.ts` (issue #3068), which subsumed the alias-only copy
 * that used to live here: staging every bundle-relative asset in one place
 * keeps a single implementation and a single fail-fast contract.
 */
export { collectAliasAssets } from './copy_bundle_assets.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));

/**
 * Modules that must remain external in the bundle. These are either native
 * addons (`.node`), Bun-specific UI packages, or optional platform binaries
 * that cannot be bundled.
 */
export const EXTERNALS = [
  '@lydell/node-pty',
  'node-pty',
  '@lydell/node-pty-darwin-arm64',
  '@lydell/node-pty-darwin-x64',
  '@lydell/node-pty-linux-x64',
  '@lydell/node-pty-win32-arm64',
  '@lydell/node-pty-win32-x64',
  '@napi-rs/keyring',
  'node:module',
  // UI package uses opentui which has Bun-specific imports.
  '@vybestack/llxprt-ui',
  '@vybestack/opentui-core',
  '@vybestack/opentui-react',
  // ast-grep uses native Node.js addons (.node files) that cannot be bundled.
  '@ast-grep/napi',
  '@ast-grep/lang-python',
  '@ast-grep/lang-go',
  '@ast-grep/lang-rust',
  '@ast-grep/lang-java',
  '@ast-grep/lang-cpp',
  '@ast-grep/lang-c',
  '@ast-grep/lang-json',
  '@ast-grep/lang-ruby',
  '@ast-grep/lang-csharp',
  '@ast-grep/lang-kotlin',
  '@ast-grep/lang-php',
  '@ast-grep/lang-scala',
  '@ast-grep/lang-swift',
  // Optional prompt watcher dependency; runtime falls back to fs.watch.
  'chokidar',
];

/**
 * Modules whose runtime behaviour depends on their own `__dirname` and so MUST
 * stay external to the CLI bundle.
 *
 * When Bun inlines a CommonJS module it freezes `__dirname` as a build-time
 * string literal. Any dependency that locates a runtime asset (WASM, locales,
 * config files) relative to its own `__dirname` then ships the *build
 * machine's* absolute path baked into the artifact: that path resolves only on
 * the builder and leaks the release engineer's filesystem layout into user
 * stack traces. Keeping such modules external lets Bun resolve them from
 * `node_modules` at launch, so `__dirname` points at the *installed* package —
 * exactly the resolution the pre-bundle TypeScript launch always used.
 *
 * **Ownership rule (invariant):** every entry MUST be a declared direct
 * dependency of `packages/cli/package.json` (the published package that ships
 * the bundle). Only a direct dependency guarantees its runtime resolution from
 * `<pkg>/bundle/llxprt.js`: the package manager installs it in the published
 * package's own `node_modules` scope, so `require("<name>")` from the bundle
 * finds the *right* copy. A transitive dependency that merely appears somewhere
 * in `node_modules` does NOT give this guarantee — it may be hoisted, shadowed
 * by a consumer's conflicting version, or absent entirely depending on the
 * consumer's install tree. That was the defect behind issue #3055:
 * `config-chain` is owned by `@pnpm/npm-conf` (under `update-notifier`'s
 * transitive graph), so externalizing it moved the resolution owner to the CLI
 * package, where no package manager guarantees it resolves.
 *
 * Enforced by `scripts/tests/issue-3055-cli-externals-ownership.bun.test.ts`.
 *
 * This list is deliberately separate from `EXTERNALS`: the a2a-server bundle is
 * a self-contained artifact that inlines its dependencies and already
 * neutralises tiktoken via `portableTiktokenPlugin`, so forcing these external
 * there would break that strategy.
 */
export const CLI_DIRNAME_DEPENDENT_EXTERNALS = [
  // Locates tiktoken_bg.wasm via __dirname; throws "Missing tiktoken_bg.wasm"
  // at import time when the baked build-machine path is absent (issue #3055).
  '@dqbd/tiktoken',
  // Direct dependency of packages/cli. Its transitive graph includes
  // @pnpm/npm-conf -> config-chain, which walks __dirname to find npm-style
  // config files. Externalizing update-notifier (not config-chain) keeps the
  // entire transitive graph resolving from update-notifier's own package
  // scope, where config-chain is a guaranteed dependency of @pnpm/npm-conf.
  'update-notifier',
  // Resolves its locale directory relative to __dirname; a baked path silently
  // degrades CLI localisation.
  'yargs',
] as const;

const tiktokenWasmSource = require.resolve('@dqbd/tiktoken/tiktoken_bg.wasm');

// a2a-server bundle: packages/a2a-server/src/http/server.ts -> dist/a2a-server.mjs
const a2aServerConfig: Parameters<typeof Bun.build>[0] = {
  target: 'node',
  format: 'esm',
  conditions: ['production'],
  external: EXTERNALS,
  plugins: [portableTiktokenPlugin],
  loader: { '.node': 'file' },
  minify: true,
  splitting: false,
  sourcemap: 'none',
  define: {
    'process.env.CLI_VERSION': JSON.stringify(pkg.version),
    'process.env.NODE_ENV': '"production"',
  },
  entrypoints: ['packages/a2a-server/src/http/server.ts'],
  outdir: 'packages/a2a-server/dist',
  naming: 'a2a-server.mjs',
  // a2a-server does not import bare 'module'. A static import avoids
  // Top-Level Await while still exposing require/__filename/__dirname in the
  // bundled output.
  banner: `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); globalThis.__filename = require('url').fileURLToPath(import.meta.url); globalThis.__dirname = require('path').dirname(globalThis.__filename);`,
};

/**
 * Directory the published CLI bundle is written to. Single source of truth for
 * both the Bun.build output location and the runtime-asset staging target
 * (issue #3068), so the JS artifact and its data files can never diverge.
 */
export const CLI_BUNDLE_DIR = join(root, 'packages/cli/bundle');

const cliBundleSharedConfig = {
  target: 'bun',
  loader: { '.node': 'file' },
  minify: false,
  splitting: false,
  sourcemap: 'none',
  define: {
    'process.env.CLI_VERSION': JSON.stringify(pkg.version),
    'process.env.NODE_ENV': '"production"',
  },
  outdir: CLI_BUNDLE_DIR,
} satisfies Pick<
  Parameters<typeof Bun.build>[0],
  | 'target'
  | 'loader'
  | 'minify'
  | 'splitting'
  | 'sourcemap'
  | 'define'
  | 'outdir'
>;

/**
 * CLI bundle (issue #2999): packages/cli/index.ts -> bundle/llxprt.js.
 *
 * `target: 'bun'` keeps the artifact compatible with the Bun runtime that
 * executes the published CLI. No `createRequire` banner is needed: Bun exposes
 * `require` natively, and the CLI source computes `__dirname`/`__filename` from
 * `import.meta.url`, which resolves to the bundle's location at runtime. The
 * EXTERNALS list is reused so native addons and Bun-specific UI packages stay
 * external (resolved from node_modules at launch, exactly as raw TS does).
 */
export const cliBundleConfig: Parameters<typeof Bun.build>[0] = {
  ...cliBundleSharedConfig,
  external: [...EXTERNALS, ...CLI_DIRNAME_DEPENDENT_EXTERNALS],
  // Absolute paths: `prepack` runs this from `packages/cli`, not the repo
  // root, so cwd-relative entrypoints would not resolve.
  entrypoints: [join(root, 'packages/cli/index.ts')],
  naming: 'llxprt.js',
};

interface CliBundleTarget {
  readonly label: string;
  readonly config: Parameters<typeof Bun.build>[0];
}

function profilerBundleConfig(
  sourceName: string,
  outputName: string,
): Parameters<typeof Bun.build>[0] {
  return {
    ...cliBundleSharedConfig,
    external: [...EXTERNALS, ...CLI_DIRNAME_DEPENDENT_EXTERNALS],
    entrypoints: [join(root, 'scripts/memory', sourceName)],
    naming: outputName,
  };
}

export function requireDependenciesInstalled(
  workspaceRoot: string = root,
): void {
  if (!dependenciesInstalled(workspaceRoot)) {
    throw new Error(
      'bun-build.config: cannot build publishable CLI bundles without node_modules. Run `npm install` before packing.',
    );
  }
}

/**
 * Each executable has its own single-entry build so its published name cannot
 * depend on Bun's multi-entry naming rules. The preload remains an independent
 * side-effect entry rather than being imported by the launcher bundle.
 */
export const cliBundleTargets: readonly CliBundleTarget[] = [
  { label: 'cli-bundle', config: cliBundleConfig },
  {
    label: 'memprofile-launcher',
    config: profilerBundleConfig(
      'installed-launcher.ts',
      'memprofile-launcher.js',
    ),
  },
  {
    label: 'memprofile-preload',
    config: profilerBundleConfig(
      'installed-preload.ts',
      'memprofile-preload.js',
    ),
  },
  {
    label: 'memprofile-request',
    config: profilerBundleConfig(
      'installed-request.ts',
      'memprofile-request.js',
    ),
  },
  {
    label: 'memprofile-report',
    config: profilerBundleConfig('installed-report.ts', 'memprofile-report.js'),
  },
  {
    label: 'memprofile-analyze',
    config: profilerBundleConfig(
      'installed-analyze.ts',
      'memprofile-analyze.js',
    ),
  },
];

/**
 * Separator for multi-diagnostic messages: one diagnostic per line, indented so
 * the group reads as a unit in CI logs.
 */
const DIAGNOSTIC_SEPARATOR = '\n  ';

/**
 * Renders one Bun diagnostic, keeping its source position when it carries one.
 *
 * Deliberately duck-typed rather than gated on `instanceof Error`: Bun attaches
 * `BuildMessage`/`ResolveMessage` objects, which carry `position` but are NOT
 * Errors, so an `instanceof` gate would discard the file/line/column that makes
 * a bundle failure actionable.
 */
function renderDiagnostic(diagnostic: unknown): string {
  if (diagnostic === null || typeof diagnostic !== 'object') {
    return String(diagnostic);
  }
  const { message, position } = diagnostic as {
    message?: unknown;
    position?: { file?: string; line?: number; column?: number } | null;
  };
  const where = position?.file
    ? ` (${position.file}:${position.line ?? 0}:${position.column ?? 0})`
    : '';
  const text = typeof message === 'string' ? message : String(diagnostic);
  return `${text}${where}`;
}

/**
 * Renders every diagnostic Bun attaches to a rejected build.
 *
 * `Bun.build` rejects with an `AggregateError` whose own message is the
 * uninformative constant "Bundle failed"; the resolution and transpile errors
 * that say what actually broke are in `errors`. Reporting only
 * `error.message` leaves a CI failure undiagnosable, which is what issue #3061
 * had to reproduce locally to explain.
 */
function describeBuildFailure(failure: unknown): string {
  const head = renderDiagnostic(failure);
  if (!(failure instanceof AggregateError)) {
    return head;
  }
  const nested: readonly unknown[] = failure.errors;
  return [head, ...nested.map(renderDiagnostic)].join(DIAGNOSTIC_SEPARATOR);
}

/** Renders the diagnostics of a build that completed with `success === false`. */
function describeBuildLogs(logs: readonly unknown[]): string {
  return logs.length === 0
    ? '(no diagnostics)'
    : logs.map(renderDiagnostic).join(DIAGNOSTIC_SEPARATOR);
}

/**
 * Runs a Bun.build target and exits non-zero on any failure (rejected promise
 * or `success === false`), surfacing diagnostics. Stale artifacts must never be
 * shipped downstream, so both failure modes are fatal.
 */
async function buildOrFail(
  config: Parameters<typeof Bun.build>[0],
  label: string,
): Promise<Bun.BuildOutput> {
  const result: Bun.BuildOutput | Error = await Bun.build(config).catch(
    (error: unknown): Error =>
      error instanceof Error ? error : new Error(String(error)),
  );

  if (result instanceof Error || result.success === false) {
    console.error(
      result instanceof Error
        ? `${label} build failed: ${describeBuildFailure(result)}`
        : `${label} build completed with errors: ${describeBuildLogs(result.logs ?? [])}`,
    );
    process.exit(1);
  }
  return result;
}

/**
 * Builds the a2a-server artifact plus its tiktoken asset.
 */
async function buildA2aServer(): Promise<readonly string[]> {
  const a2aResult = await buildOrFail(a2aServerConfig, 'a2a-server');

  const tiktokenBundleAsset = join(
    root,
    'packages/a2a-server/dist/tiktoken_bg.wasm',
  );
  copyFileSync(tiktokenWasmSource, tiktokenBundleAsset);

  return [
    ...a2aResult.outputs.map((o) => `${o.path}=${o.size}`),
    tiktokenBundleAsset,
  ];
}

/**
 * Removes every entry in the bundle directory except the just-emitted build
 * outputs, leaving a clean slate for asset staging.
 *
 * A no-op when the directory does not exist yet (the first build).
 */
function pruneStaleBundleEntries(bundleDir: string, keep: Set<string>): void {
  if (!existsSync(bundleDir)) {
    return;
  }
  for (const entry of readdirSync(bundleDir)) {
    if (!keep.has(entry)) {
      rmSync(join(bundleDir, entry), { recursive: true, force: true });
    }
  }
}

const INK_MEMORY_RETENTION_PATCH_VERSION = 2;
const INK_MEMORY_RETENTION_PATCH_MARKER = `export const internal_memoryRetentionPatchVersion = ${INK_MEMORY_RETENTION_PATCH_VERSION};`;

export function assertInkMemoryRetentionPatch(rootDir: string = root): void {
  const measureTextPath = join(
    rootDir,
    'node_modules',
    'ink',
    'build',
    'measure-text.js',
  );
  let source: string;
  try {
    source = readFileSync(measureTextPath, 'utf8');
  } catch {
    throw new Error(
      `Ink memory-retention patch v${INK_MEMORY_RETENTION_PATCH_VERSION} is required; run the repository install before building publishable CLI bundles.`,
    );
  }
  if (!source.includes(INK_MEMORY_RETENTION_PATCH_MARKER)) {
    throw new Error(
      `Ink memory-retention patch v${INK_MEMORY_RETENTION_PATCH_VERSION} is required; reinstall dependencies so patch-package can apply patches/ink+6.4.8.patch.`,
    );
  }
}

/**
 * Builds the prebuilt CLI bundle only (issue #2999).
 *
 * Kept separately invocable so `prepack` can produce the shipped bundle
 * without paying for the unrelated a2a-server build.
 *
 * Throws on failure rather than calling `process.exit`, because this is
 * exported for tests: a build failure must surface as a reportable assertion
 * failure, not as a hard kill of the test runner process.
 */
export async function buildCliBundle(): Promise<readonly string[]> {
  assertInkMemoryRetentionPatch();
  const results: Bun.BuildOutput[] = [];
  for (const target of cliBundleTargets) {
    let result: Awaited<ReturnType<typeof Bun.build>>;
    try {
      result = await Bun.build(target.config);
    } catch (error) {
      throw new Error(
        `${target.label} build failed: ${describeBuildFailure(error)}`,
      );
    }
    if (!result.success) {
      throw new Error(
        `${target.label} build completed with errors: ${describeBuildLogs(result.logs ?? [])}`,
      );
    }
    results.push(result);
  }

  const emittedOutputs = results.flatMap((result) => result.outputs);
  const outputs = emittedOutputs.map(
    (output) => `${output.path}=${output.size}`,
  );
  // Prune only after the complete publication set succeeds. A failed profiler
  // build therefore fails prepack without deleting any previously publishable
  // artifact, while a successful run removes outputs no longer produced.
  pruneStaleBundleEntries(
    CLI_BUNDLE_DIR,
    new Set(emittedOutputs.map((output) => basename(output.path))),
  );
  // Stage the runtime data assets the bundled code reads relative to the
  // bundle directory (issue #3068). Throws on a missing required asset so a
  // broken bundle can never be silently published; this propagates as a
  // build failure because prepack runs this entry point. `repoRoot: root`
  // keeps a single derivation of the repo root rather than letting the stager
  // re-derive it from its own import.meta.url.
  const staged = stageCliBundleAssets({
    bundleDir: CLI_BUNDLE_DIR,
    repoRoot: root,
  });
  return [...outputs, ...staged];
}

/**
 * Reports whether workspace dependencies are installed.
 *
 * `prepack` fires on any `npm pack` of packages/cli, including from a copy of
 * the repo made without node_modules (the release-pack smoke does exactly
 * this). Bundling is impossible there -- Bun cannot resolve a single import --
 * so the build would fail for a reason that says nothing about the code.
 */
export function dependenciesInstalled(rootDir: string = root): boolean {
  return existsSync(join(rootDir, 'node_modules'));
}

async function runBuilds(argv: readonly string[]): Promise<void> {
  const cliOnly = argv.includes('--cli-only');
  const a2aOnly = argv.includes('--a2a-only');

  if (cliOnly && a2aOnly) {
    console.error(
      'bun-build.config: --cli-only and --a2a-only are mutually exclusive.',
    );
    process.exit(1);
  }

  requireDependenciesInstalled();

  const artifacts: string[] = [];
  if (!cliOnly) {
    artifacts.push(...(await buildA2aServer()));
  }
  if (!a2aOnly) {
    artifacts.push(...(await buildCliBundle()));
  }

  // Diagnostics go to stderr: this script runs as `prepack`, and anything on
  // stdout corrupts `npm pack --json` output for downstream parsers.
  console.error('bun build complete:', ...artifacts);
}

// Only execute builds when run directly (`bun scripts/bun-build.config.ts`),
// not when imported (e.g. by the issue-2999 bun test that builds the CLI bundle
// in isolation).
if (import.meta.main) {
  // buildCliBundle throws rather than exiting (so tests can catch it), so the
  // CLI entry point is where a build failure is turned into a non-zero exit.
  try {
    await runBuilds(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
