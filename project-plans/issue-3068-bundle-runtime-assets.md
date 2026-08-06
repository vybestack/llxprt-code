# Issue #3068 — Published CLI bundle ships no runtime assets

## Problem

The npm package `@vybestack/llxprt-code` is built from `packages/cli` and ships a
`bundle` directory (`"files": ["bundle", ...]`). `packages/cli/bundle/llxprt.js`
is produced by `buildCliBundle()` in `scripts/bun-build.config.ts`, invoked by
the `prepack` script that both `npm publish` and `npm pack` trigger.

That bundle inlines the whole TypeScript module graph into a single file at
`<package-root>/bundle/llxprt.js`. Every module that locates a runtime data file
via `__dirname` / `import.meta.url` therefore resolves it relative to
`<package-root>/bundle/` instead of its original source directory.

`buildCliBundle()` emits **only** `llxprt.js`. No data files are copied. So every
bundle-relative asset read fails in the published package.

Observed on macOS (issue #3068, v0.11.0-nightly.260805.bb700c00e):

```
failed to asynchronously prepare wasm: Error: ENOENT: no such file or directory,
  open '/opt/homebrew/lib/node_modules/@vybestack/llxprt-code/bundle/tree-sitter.wasm'
Aborted(Error: ENOENT: ... /bundle/tree-sitter.wasm)
```

followed by the CLI starting with **no providers available**.

Reproduced locally on this branch:

```
$ npm run bundle:cli && bun packages/cli/bundle/llxprt.js --provider openai --model gpt-4o -p "hi"
An unexpected critical error occurred:
Error: Could not activate explicitly-configured provider 'openai': Provider 'openai' not found
```

`scripts/copy_bundle_assets.ts` — the script that used to stage these assets for
the retired esbuild flow — still exists but is orphaned: no npm script, build
script, or workflow invokes it, and it writes to the gitignored **repo-root**
`bundle/` directory that nothing consumes. That is why the regression was
invisible when the prebuilt CLI bundle was introduced.

## Root cause

`buildCliBundle()` produces the JS artifact without the data files the bundled
code reads from `<bundle-dir>/…`. The asset-staging step was never re-wired to
the new bundle location after the esbuild flow was retired.

## Accepted behaviour

The prebuilt CLI bundle must ship, alongside `llxprt.js`, every runtime asset
that the bundled code resolves relative to the bundle directory.

| # | Asset | Source | Required bundle path | Resolving site | Failure today |
|---|-------|--------|----------------------|----------------|---------------|
| 1 | `tree-sitter.wasm` | `node_modules/web-tree-sitter/tree-sitter.wasm` | `bundle/tree-sitter.wasm` | `web-tree-sitter` `findWasmBinary()` → `new URL('tree-sitter.wasm', import.meta.url)` | emscripten abort printed at startup (issue screenshot) |
| 2 | Provider aliases (`*.config`) | `packages/providers/src/composition/aliases/` | `bundle/providers/aliases/` | `providerAliases.ts` `BUNDLE_ALIAS_DIR = join(__dirname,'providers','aliases')` | **no providers available** |
| 3 | Policy TOMLs | `packages/policy/src/policies/*.toml` | `bundle/policies/` | `packages/policy/src/config.ts` `DEFAULT_CORE_POLICIES_DIR`; `toml-loader.ts` `loadDefaultPolicies()` | built-in tool policies silently absent |
| 4 | macOS seatbelt profiles (`*.sb`) | `packages/cli/src/utils/sandbox-macos-*.sb` | `bundle/` (flat) | `sandbox-seatbelt.ts` `new URL('./sandbox-macos-<p>.sb', import.meta.url)` | `FatalSandboxError` — macOS sandbox unusable |
| 5 | Prompt defaults (`**/*.md`) | `packages/core/src/prompt-config/defaults/` | `bundle/` preserving structure | `core/provider/tool-defaults.ts` `tryLoadFromBundleDir` | default prompts unavailable |
| 6 | Prompt manifest | `packages/core/dist/prompt-config/defaults/default-prompts.json` | `bundle/default-prompts.json` | `manifest-loader.ts` `candidatePaths()` | manifest fast-path unavailable |
| 7 | `git-commit.json` | `packages/cli/src/generated/git-commit.json` | `bundle/git-commit.json` | `gitCommitInfo.ts` `candidatePaths()` | commit reported as `N/A` |
| 8 | Official tokenizer BPE assets | `packages/providers/src/tokenizers/official/assets/{kimi-k3,glm-5.2,minimax-m3}/{manifest.json,tokenizer.bpe,LICENSE}` (+ `NOTICE.md`) | `bundle/assets/**` (tree) | `assetLoader.ts` `ASSETS_DIR = join(__dirname,'assets')`; reached via `providerManagerInstance.ts` → `officialPromptEstimators.ts` → `kimiK3Tokenizer.ts`/`glm52Tokenizer.ts`/`minimaxM3Tokenizer.ts` | `Prompt estimator asset-unavailable for kimi-k3` — three model families cannot start a chat |
| 9 | Extension boilerplate templates | `packages/cli/src/commands/extensions/examples/**` (5 templates: context, exclude-tools, hooks, mcp-server, skills) | `bundle/examples/**` (tree) | `new.ts` `EXAMPLES_PATH = join(__dirname,'examples')`; `getBoilerplateChoices()` `readdir`s it inside the yargs builder | `ENOENT ... scandir '.../bundle/examples'` — `llxprt extensions new` crashes during argument parsing |

Asset 7 additionally requires a one-line fix in `gitCommitInfo.ts`: its comment
already states "the JSON is copied to the bundle root", but the candidate it
builds is `join(process.cwd(), 'bundle', …)` — cwd-relative, so it only matches
when the CLI happens to be launched from the package root. The correct candidate
is `join(loaderDir, INFO_FILENAME)`, which is the bundle root when bundled. This
is the same bundle-relative-resolution defect and is fixed with the rest.

### Explicitly out of scope

- **`tree-sitter-bash.wasm`.** `shell-parser.ts` resolves it with
  `require.resolve('tree-sitter-bash/tree-sitter-bash.wasm')` — module
  resolution from `node_modules`, not a bundle-relative read. Copying it into
  `bundle/` would not change resolution. It is not part of the reported failure
  and the parser degrades gracefully to regex parsing. Not touched. Residual
  caveat: `tree-sitter-bash` is a dependency of `@vybestack/llxprt-code-core`,
  not of `packages/cli`, so it relies on npm hoisting — the same ownership
  hazard documented for `CLI_DIRNAME_DEPENDENT_EXTERNALS`.
- **Built-in skills.** `packages/core/src/skills/builtin` does not exist in the
  repo at all, so there is nothing to stage. Not a bundle regression.
- **`@dqbd/tiktoken` / `yargs` / `update-notifier`.** Already handled by
  `CLI_DIRNAME_DEPENDENT_EXTERNALS` (issue #3055). Unchanged.
- **Externalizing `web-tree-sitter`.** Not required: it resolves its WASM through
  `import.meta.url`, which Bun rewrites to the bundle URL (proven by the ENOENT
  path in the report), so staging the file next to the bundle is the correct
  fix. Externalizing would additionally require adding a direct `packages/cli`
  dependency, which the `CLI_DIRNAME_DEPENDENT_EXTERNALS` ownership invariant
  demands and which this issue does not justify.

### Failure behaviour (fail fast)

Asset staging must **throw** when a required asset is missing, so a release can
never produce a silently broken bundle again. Required = assets 1–5, 8, and 9.
Assets 6 and 7 are generated artifacts (`npm run generate`) and are copied when
present; their absence must not break `npm run bundle:cli` in a fresh checkout,
matching the existing tolerance in `bun-build.config.ts` and `gitCommitInfo.ts`.

## Implementation

1. Rewrite `scripts/copy_bundle_assets.ts` into a parameterised, exported
   staging function that targets the **CLI bundle directory**
   (`packages/cli/bundle`) instead of the dead repo-root `bundle/`. Keeping the
   existing file (rather than adding a second script) avoids duplicating the
   copy logic and removes the orphan in one move.
2. Call it from `buildCliBundle()` in `scripts/bun-build.config.ts` immediately
   after `Bun.build` succeeds, so `prepack` — the single hook both `npm publish`
   and `npm pack` fire — stages the assets into the directory that
   `"files": ["bundle"]` packs.
3. The bundle directory is pruned before `Bun.build` runs, so removed source
   files cannot linger; `Bun.build` does not clean its `outdir` and the stager
   only writes, never deletes.
4. The `tree-sitter.wasm` source is resolved with
   `require.resolve('web-tree-sitter/tree-sitter.wasm')` (anchored at the repo
   root) instead of a hardcoded `node_modules/...` path, so nested/non-hoisted
   installs still resolve — the same idiom used for the tiktoken WASM.
5. Required directory/tree stagers guard with `existsSync` before reading, so a
   missing source directory yields the actionable error rather than a raw
   `ENOENT`.

## Tests (behavioural, written first)

New `scripts/tests/issue-3068-bundle-runtime-assets.bun.test.ts`, following the
pattern of `scripts/tests/issue-3055-bundle-purity.bun.test.ts` (build the real
artifact in a child process, assert against it, clean up):

1. **Asset presence.** After the real bundle build, assert each required asset
   exists at its required bundle path, and that the staged provider-alias and
   policy sets exactly match their source directories (so a newly added alias
   cannot be forgotten). Assert `tree-sitter.wasm` starts with the `\0asm` magic
   bytes, proving a real WASM file was staged, not a placeholder.
2. **Providers resolve from the bundle.** Spawn the built bundle with
   `--provider openai --model gpt-4o -p …` and assert the output does **not**
   contain `Provider 'openai' not found`. This is the exact reproduction above
   and fails before the fix.
3. **No tree-sitter WASM abort.** Spawn the built bundle through a start path
   that reaches `Config` creation (which awaits `initializeParser()`) and assert
   stderr contains neither `failed to asynchronously prepare wasm` nor
   `tree-sitter.wasm`.
4. **Fail fast on missing required assets.** Drive the staging function with a
   source root lacking a required asset and assert it throws an actionable
   error naming the missing path.
5. **`git-commit.json` is found at the bundle root.** Unit-level test that
   `gitCommitInfo.ts` resolves the JSON sitting beside the loader.

## Acceptance criteria

- `npm run bundle:cli` produces `packages/cli/bundle/` containing `llxprt.js`
  plus assets 1–5, 8, and 9 (and 6–7 when generated).
- The bundle directory is pruned before each build, so an alias, policy, or
  template removed from source cannot linger and ship.
- Running the built bundle reports no `tree-sitter.wasm` error, resolves
  built-in providers, starts a chat for the pinned-tokenizer model families
  (kimi-k3 / glm-5.2 / minimax-m3 — no `asset-unavailable`), and `extensions
  new` succeeds.
- Staging throws with an actionable message if a required asset is missing
  (file- and directory-shaped alike).
- `scripts/copy_bundle_assets.ts` is no longer orphaned.
- Full verification passes: `npm run test`, `lint`, `typecheck`, `format`,
  `build`, and the CLI smoke run.
