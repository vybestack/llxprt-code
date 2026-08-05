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
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { portableTiktokenPlugin } from './portable-tiktoken-plugin.js';

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
  target: 'bun',
  external: [...EXTERNALS, ...CLI_DIRNAME_DEPENDENT_EXTERNALS],
  loader: { '.node': 'file' },
  minify: false,
  splitting: false,
  sourcemap: 'none',
  define: {
    'process.env.CLI_VERSION': JSON.stringify(pkg.version),
    'process.env.NODE_ENV': '"production"',
  },
  // Absolute paths: `prepack` runs this from `packages/cli`, not the repo
  // root, so cwd-relative entrypoints would not resolve.
  entrypoints: [join(root, 'packages/cli/index.ts')],
  outdir: join(root, 'packages/cli/bundle'),
  naming: 'llxprt.js',
};

/**
 * Built-in provider alias data (issue #3062).
 *
 * The bundled `providerAliases` loader computes its built-in directory as
 * `<bundleDir>/providers/aliases` (resolved from the bundle's own `__dirname`
 * at runtime). When the bundle was the only emitted artifact that directory did
 * not exist, so no built-in aliases registered and `--provider openai` failed
 * with "Provider 'openai' not found". The alias assets live as raw
 * `.config`/`.json` files in the providers package source; emit them verbatim
 * next to the bundle so the loader finds them exactly as in development.
 */
const providerAliasSourceDir = join(
  root,
  'packages/providers/src/composition/aliases',
);
const providerAliasBundleDir = join(
  root,
  'packages/cli/bundle/providers/aliases',
);

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
    if (result instanceof Error) {
      console.error(`${label} build failed:`, result);
    } else {
      console.error(`${label} build completed with errors.`);
      const detail = (result.logs ?? []).map((log) => log.message).join('; ');
      console.warn(`${label} build logs: ` + (detail || '(none)'));
    }
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
 * Collects built-in provider alias asset names (`.config`/`.json`) from `dir`,
 * failing fast when none are found.
 *
 * An empty result is a build-input error, not a silent no-op: the bundled
 * `providerAliases` loader would then register zero built-in providers and
 * `--provider openai` would fail at launch (issue #3062 regression). Surfacing
 * this at build time prevents shipping a bundle that silently dropped every
 * built-in alias.
 */
export function collectAliasAssets(dir: string): string[] {
  const assets = readdirSync(dir).filter(
    (name) => name.endsWith('.config') || name.endsWith('.json'),
  );
  if (assets.length === 0) {
    throw new Error(
      `cli-bundle build produced no built-in provider alias assets: ${dir} ` +
        `contains no .config/.json files; the bundled providerAliases loader ` +
        `would register no built-in providers.`,
    );
  }
  return assets;
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
  let cliResult: Awaited<ReturnType<typeof Bun.build>>;
  try {
    cliResult = await Bun.build(cliBundleConfig);
  } catch (error) {
    throw new Error(
      `cli-bundle build failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!cliResult.success) {
    const detail = (cliResult.logs ?? []).map((log) => log.message).join('; ');
    throw new Error(
      `cli-bundle build completed with errors: ${detail || '(no details)'}`,
    );
  }

  // Emit the built-in provider alias data next to the bundle (issue #3062).
  // Replace any stale copy wholesale so removed/renamed alias files never leak
  // into a publish artifact.
  rmSync(providerAliasBundleDir, { recursive: true, force: true });
  mkdirSync(providerAliasBundleDir, { recursive: true });
  const aliasAssets = collectAliasAssets(providerAliasSourceDir);
  for (const name of aliasAssets) {
    copyFileSync(
      join(providerAliasSourceDir, name),
      join(providerAliasBundleDir, name),
    );
  }

  return [
    ...cliResult.outputs.map((o) => `${o.path}=${o.size}`),
    ...aliasAssets.map((name) => join(providerAliasBundleDir, name)),
  ];
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

  // Skipping is safe specifically because the bundle is an optimisation, not a
  // requirement: packages/cli ships its TypeScript source too, and the entry
  // resolver falls back to it when no bundle is present. A publisher always has
  // dependencies installed, so a real release still gets the bundle; this only
  // spares dependency-free `npm pack` callers a failure they cannot act on.
  if (!dependenciesInstalled()) {
    console.error(
      'bun-build.config: node_modules is absent, so the CLI bundle cannot be ' +
        'built. Skipping the bundle; the package still ships TypeScript source ' +
        'and the launcher falls back to it. Run `npm install` to bundle.',
    );
    return;
  }

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
