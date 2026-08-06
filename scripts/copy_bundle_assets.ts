/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stages the runtime data assets the prebuilt CLI bundle reads relative to the
 * bundle directory (issue #3068).
 *
 * `buildCliBundle()` in `bun-build.config.ts` inlines the whole TypeScript
 * module graph into a single `packages/cli/bundle/llxprt.js`. Every module that
 * locates a data file via `__dirname` / `import.meta.url` therefore resolves it
 * under `<bundle-dir>/…`, so those data files must be staged next to the bundle
 * or every such read fails in the published package. This module owns that
 * staging step.
 *
 * Required assets (the bundle is unusable without them) cause a hard throw so a
 * release can never again silently ship a broken bundle. Generated artifacts
 * (`npm run generate`) are copied when present and skipped when absent, so a
 * fresh checkout can still run `npm run bundle:cli`.
 *
 * Not staged here on purpose:
 *  - `tree-sitter-bash/tree-sitter-bash.wasm`. `shell-parser.ts` resolves it
 *    with `require.resolve('tree-sitter-bash/tree-sitter-bash.wasm')`, i.e.
 *    MODULE resolution from `node_modules`, not a bundle-relative read. Copying
 *    it into `bundle/` would change nothing; failure degrades gracefully to
 *    regex parsing. Residual caveat: `tree-sitter-bash` is a dependency of
 *    `@vybestack/llxprt-code-core`, not of `packages/cli`, so it relies on npm
 *    hoisting — the same ownership hazard documented for
 *    `CLI_DIRNAME_DEPENDENT_EXTERNALS` in `bun-build.config.ts`.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'glob';

/** Options for {@link stageCliBundleAssets}. */
export interface StageCliBundleAssetsOptions {
  /** Bundle directory assets are staged into. Defaults to packages/cli/bundle. */
  readonly bundleDir?: string;
  /** Repository root the source assets are read from. Defaults to repo root. */
  readonly repoRoot?: string;
}

function defaultRepoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/** Copies a single file, creating destination directories as needed. */
function copyFileTo(srcPath: string, destPath: string): string {
  ensureDir(dirname(destPath));
  copyFileSync(srcPath, destPath);
  return destPath;
}

function missingRequiredAsset(description: string, srcPath: string): Error {
  return new Error(
    `Cannot stage CLI bundle: required ${description} is missing at ${srcPath}. ` +
      `Run \`npm install\` (and \`npm run generate\` for generated assets) before bundling.`,
  );
}

/** Lists the regular files directly inside a directory. */
function listFilesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

/**
 * Recursively lists every regular file under `rootDir` as repo-style relative
 * paths (forward slashes), so a required directory tree can be mirrored into
 * the bundle preserving its structure.
 */
function walkFiles(rootDir: string): string[] {
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
  return out;
}

/** Copies a required single-file asset, throwing if the source is absent. */
function stageRequiredFile(
  srcPath: string,
  destPath: string,
  description: string,
): string {
  if (!existsSync(srcPath)) {
    throw missingRequiredAsset(description, srcPath);
  }
  return copyFileTo(srcPath, destPath);
}

/**
 * Copies a required directory's files into a destination directory, throwing if
 * the source directory is absent or holds no matching files. Returns the staged
 * destination paths so a future added source file can never be silently
 * forgotten by the bundle.
 */
function stageRequiredDir(
  srcDir: string,
  destDir: string,
  filter: (name: string) => boolean,
  description: string,
): string[] {
  // existsSync guard is load-bearing: readdirSync would throw a raw ENOENT for
  // a missing directory, so the actionable missingRequiredAsset below would be
  // unreachable. The guard surfaces the actionable message instead.
  if (!existsSync(srcDir)) {
    throw missingRequiredAsset(description, srcDir);
  }
  const files = listFilesIn(srcDir).filter(filter);
  if (files.length === 0) {
    throw missingRequiredAsset(description, srcDir);
  }
  return files.map((file) =>
    copyFileTo(join(srcDir, file), join(destDir, file)),
  );
}

/**
 * Recursively copies a required directory tree into a destination directory,
 * throwing if the source directory is absent or empty. Preserves the relative
 * structure so bundle-relative reads (`join(__dirname, 'subdir', …)`) resolve.
 */
function stageRequiredTree(
  srcDir: string,
  destDir: string,
  description: string,
): string[] {
  if (!existsSync(srcDir)) {
    throw missingRequiredAsset(description, srcDir);
  }
  const files = walkFiles(srcDir);
  if (files.length === 0) {
    throw missingRequiredAsset(description, srcDir);
  }
  return files.map((rel) => copyFileTo(join(srcDir, rel), join(destDir, rel)));
}

/** Copies a generated artifact when present; returns [] when absent. */
function stageOptionalFile(srcPath: string, destPath: string): string[] {
  if (!existsSync(srcPath)) {
    return [];
  }
  return [copyFileTo(srcPath, destPath)];
}

/**
 * Resolves the `web-tree-sitter` WASM via module resolution (the package's
 * `exports` map `"./tree-sitter.wasm"`), so a nested/non-hoisted install layout
 * still works — the same idiom `bun-build.config.ts` uses for tiktoken.
 *
 * Resolution is anchored at `repoRoot` (not this script's own location) so the
 * fail-fast tests that drive a synthetic `repoRoot` get a deterministic, real
 * result: an empty temp root has no `node_modules`, so resolution fails and the
 * actionable error fires. Anchoring at the script location would always find
 * the real repo's copy and silently mask a missing-asset regression. In
 * production `repoRoot` is the real repo root, so the two anchors are
 * equivalent there — this choice only affects testability.
 */
function resolveTreeSitterWasm(repoRoot: string): string {
  const requireAtRoot = createRequire(join(repoRoot, 'package.json'));
  try {
    return requireAtRoot.resolve('web-tree-sitter/tree-sitter.wasm');
  } catch {
    throw missingRequiredAsset(
      'tree-sitter.wasm',
      join(repoRoot, 'node_modules/web-tree-sitter/tree-sitter.wasm'),
    );
  }
}

function stageTreeSitterWasm(repoRoot: string, bundleDir: string): string[] {
  return [
    stageRequiredFile(
      resolveTreeSitterWasm(repoRoot),
      join(bundleDir, 'tree-sitter.wasm'),
      'tree-sitter.wasm',
    ),
  ];
}

/**
 * Extensions the alias loader reads (`SUPPORTED_EXTENSIONS` in
 * `packages/providers/src/composition/providerAliases.ts`). Staging is filtered
 * to these so incidental files in the source directory are never published.
 */
const ALIAS_EXTENSIONS = ['.config', '.json'];

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
  const assets = readdirSync(dir).filter((name) =>
    ALIAS_EXTENSIONS.some((ext) => name.endsWith(ext)),
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

function stageProviderAliases(repoRoot: string, bundleDir: string): string[] {
  const srcDir = join(repoRoot, 'packages/providers/src/composition/aliases');
  // The existsSync guard keeps the actionable message for a missing directory;
  // collectAliasAssets owns the "directory exists but holds no aliases" guard
  // (issue #3062) so both callers share one alias-collection implementation.
  if (!existsSync(srcDir)) {
    throw missingRequiredAsset('provider alias configs', srcDir);
  }
  const destDir = join(bundleDir, 'providers', 'aliases');
  return collectAliasAssets(srcDir).map((name) =>
    copyFileTo(join(srcDir, name), join(destDir, name)),
  );
}

function stagePolicyTomls(repoRoot: string, bundleDir: string): string[] {
  const srcDir = join(repoRoot, 'packages/policy/src/policies');
  return stageRequiredDir(
    srcDir,
    join(bundleDir, 'policies'),
    (name) => name.endsWith('.toml'),
    'policy TOML files',
  );
}

/**
 * macOS seatbelt profiles. The filter is scoped to the known profile shape
 * (`sandbox-macos-` prefix + `.sb` suffix) because the source directory is the
 * general `packages/cli/src/utils`, so a future unrelated or fixture `.sb` file
 * would otherwise be silently published.
 */
function stageSandboxProfiles(repoRoot: string, bundleDir: string): string[] {
  const srcDir = join(repoRoot, 'packages/cli/src/utils');
  return stageRequiredDir(
    srcDir,
    bundleDir,
    (name) => name.startsWith('sandbox-macos-') && name.endsWith('.sb'),
    'macOS seatbelt profiles',
  );
}

/**
 * Pinned tokenizer BPE assets read by the official prompt estimators
 * (`assetLoader.ts` computes `ASSETS_DIR = join(__dirname, 'assets')`). Three
 * model families (kimi-k3, glm-5.2, minimax-m3) each ship a manifest, BPE file,
 * and license; without them those models cannot start a chat. Staged as a
 * required tree so the on-disk layout the loader expects is preserved.
 */
function stageTokenizerAssets(repoRoot: string, bundleDir: string): string[] {
  const srcDir = join(
    repoRoot,
    'packages/providers/src/tokenizers/official/assets',
  );
  return stageRequiredTree(
    srcDir,
    join(bundleDir, 'assets'),
    'official tokenizer BPE assets',
  );
}

/**
 * Extension boilerplate templates read by `extensions new`
 * (`new.ts` computes `EXAMPLES_PATH = join(__dirname, 'examples')` and
 * `readdir`s it inside the yargs builder, so a missing tree crashes during
 * argument parsing). Five templates with nested files; staged as a required
 * tree preserving structure.
 */
function stageExtensionExamples(repoRoot: string, bundleDir: string): string[] {
  const srcDir = join(
    repoRoot,
    'packages/cli/src/commands/extensions/examples',
  );
  return stageRequiredTree(
    srcDir,
    join(bundleDir, 'examples'),
    'extension boilerplate examples',
  );
}

function stagePromptDefaults(repoRoot: string, bundleDir: string): string[] {
  const srcRoot = join(repoRoot, 'packages/core/src/prompt-config/defaults');
  // glob.sync returns [] for a missing dir, so an existsSync guard is not
  // needed here — the empty check below surfaces the actionable error.
  const files = glob.sync('**/*.md', { cwd: srcRoot });
  if (files.length === 0) {
    throw missingRequiredAsset('prompt default markdown files', srcRoot);
  }
  return files.map((rel) =>
    copyFileTo(join(srcRoot, rel), join(bundleDir, rel)),
  );
}

function stageGeneratedAssets(repoRoot: string, bundleDir: string): string[] {
  const staged: string[] = [];
  staged.push(
    ...stageOptionalFile(
      join(
        repoRoot,
        'packages/core/dist/prompt-config/defaults/default-prompts.json',
      ),
      join(bundleDir, 'default-prompts.json'),
    ),
  );
  staged.push(
    ...stageOptionalFile(
      join(repoRoot, 'packages/cli/src/generated/git-commit.json'),
      join(bundleDir, 'git-commit.json'),
    ),
  );
  return staged;
}

/**
 * Stages every runtime asset the prebuilt CLI bundle resolves relative to the
 * bundle directory. Throws on a missing required asset (the bundle would be
 * unusable); copies generated artifacts when present.
 *
 * @returns the destination paths of every staged asset, for inclusion in build
 * diagnostics / artifact lists.
 */
export function stageCliBundleAssets(
  options: StageCliBundleAssetsOptions = {},
): readonly string[] {
  const repoRoot = options.repoRoot ?? defaultRepoRoot();
  const bundleDir =
    options.bundleDir ?? join(repoRoot, 'packages', 'cli', 'bundle');
  ensureDir(bundleDir);

  const staged: string[] = [];
  staged.push(...stageTreeSitterWasm(repoRoot, bundleDir));
  staged.push(...stageProviderAliases(repoRoot, bundleDir));
  staged.push(...stagePolicyTomls(repoRoot, bundleDir));
  staged.push(...stageSandboxProfiles(repoRoot, bundleDir));
  staged.push(...stageTokenizerAssets(repoRoot, bundleDir));
  staged.push(...stageExtensionExamples(repoRoot, bundleDir));
  staged.push(...stagePromptDefaults(repoRoot, bundleDir));
  staged.push(...stageGeneratedAssets(repoRoot, bundleDir));
  return staged;
}

if (import.meta.main) {
  const staged = stageCliBundleAssets();
  console.error(
    `staged ${staged.length} CLI bundle runtime asset(s) into packages/cli/bundle`,
  );
}
