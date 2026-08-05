# Issue #3055 — prebuilt CLI bundle bakes build-machine absolute paths

## Symptom

Launching the installed nightly dies at startup before any CLI code runs:

    error: Missing tiktoken_bg.wasm
      at <anonymous> (...\@vybestack\llxprt-code\bundle\llxprt.js:194745:11)

Reported on Windows. It is **not** Windows-specific — see "Reproduction" below.

## Root cause

PR #3013 (issue #2999) introduced a prebuilt CLI bundle:

- `scripts/bun-build.config.ts` exports `cliBundleConfig`, which runs
  `Bun.build({ target: 'bun' })` over `packages/cli/index.ts` and emits
  `packages/cli/bundle/llxprt.js`.
- `packages/cli/package.json` lists `bundle` in `files`, so the artifact ships.
- `packages/cli/bin/llxprt` prefers `<pkg>/bundle/llxprt.js` over `index.ts`
  whenever the bundle exists.

`@dqbd/tiktoken` ships a CommonJS entry (`tiktoken.cjs`) that locates its WASM
payload from `__dirname`. When Bun inlines a CommonJS module it materialises
`__dirname` as a **string literal fixed at build time**. The emitted bundle
contains:

    var __dirname = "/Volumes/XS1000/.../node_modules/@dqbd/tiktoken";
    ...
    candidates.unshift(path.join(__dirname, "./tiktoken_bg.wasm"));
    ...
    if (bytes == null) throw new Error("Missing tiktoken_bg.wasm");

The remaining candidates are `<ancestor>/node_modules/tiktoken/tiktoken_bg.wasm`
built by walking that same baked path — and they use the *unscoped* name
`tiktoken`, so they never match `@dqbd/tiktoken` on any machine, including the
builder. The only candidate that ever resolves is the literal build-machine
path.

Consequences:

1. On the build machine the path exists, so every test and smoke passes.
2. On any other machine no candidate resolves and the module throws **at import
   time**, so the CLI cannot start at all.
3. The published artifact embeds the release engineer's absolute filesystem
   path, which is leaked verbatim in user-facing stack traces.

`a2aServerConfig` in the same file already guards this hazard with
`portableTiktokenPlugin`. `cliBundleConfig` has no `plugins` entry, so the
guard was never applied to the CLI bundle.

Two further modules leak build-machine paths into the same artifact:

- `config-chain` — `find(__dirname, rel)` — but `config-chain` is NOT a direct
  dependency of `packages/cli`; it is a transitive dependency owned by
  `@pnpm/npm-conf` (under `update-notifier`'s graph). Externalizing it at the
  CLI level moves the resolution owner to the wrong package — see "Fix" below.
- `yargs/build/index.cjs` — `y18n({ directory: resolve(__dirname, '../locales') })`,
  which silently degrades localisation rather than throwing.

## Why CI did not catch it

`scripts/tests/issue-2999-cli-bundle.bun.test.ts` builds the bundle and runs
`--version` **from the repo checkout**, where the baked path is still valid.
The Windows installed-command smoke installs a tarball packed on the same
runner, so the baked path is likewise still valid there. No existing check can
observe a build-tree dependency, because every check runs on the build tree.

## Reproduction (macOS, main @ 5c2dc30b4)

    bun scripts/bun-build.config.ts --cli-only
    bun packages/cli/bundle/llxprt.js --version          # -> 0.11.0

    mv node_modules/@dqbd/tiktoken node_modules/@dqbd/tiktoken__hidden
    bun packages/cli/bundle/llxprt.js --version          # -> Missing tiktoken_bg.wasm
    mv node_modules/@dqbd/tiktoken__hidden node_modules/@dqbd/tiktoken

Hiding the build-time location is exactly what installing on a different
machine does.

## Fix

### Ownership rule (invariant)

Every module the CLI bundle marks external must be a **declared direct
dependency of `packages/cli/package.json`** (the published package that ships
the bundle). Only a direct dependency guarantees its runtime resolution from
`<pkg>/bundle/llxprt.js`: the package manager installs it in the published
package's own `node_modules` scope, so `require("<name>")` from the bundle
finds the *right* copy. A transitive dependency that merely appears somewhere
in `node_modules` does NOT give this guarantee — it may be hoisted, shadowed by
a consumer's conflicting version, or absent entirely depending on the
consumer's install tree. Presence somewhere in `node_modules` and
resolvability from a specific importer are different guarantees.

### What was changed

1. `@dqbd/tiktoken` stays external — it is a declared direct dependency of
   `packages/cli` and locates tiktoken_bg.wasm via `__dirname`. Keeping it
   external lets Bun resolve it from `node_modules` at launch, so `__dirname`
   points at the *installed* package. This restores the pre-#3013 resolution
   path exactly, and matches the established pattern already used for
   `require.resolve('tree-sitter-bash/tree-sitter-bash.wasm')`.

2. `config-chain` was removed from the CLI external list and replaced with
   `update-notifier`, its direct-dependency owner. `config-chain` is owned by
   `@pnpm/npm-conf` (under `update-notifier -> latest-version -> package-json
   -> registry-auth-token -> @pnpm/npm-conf -> config-chain`). Externalizing
   `config-chain` at the CLI level moved the resolution owner to the CLI
   package, where no package manager guarantees it resolves — it only worked
   by accidental hoisting. Externalizing `update-notifier` instead keeps the
   entire transitive graph (including `config-chain`) resolving from
   `update-notifier`'s own package scope, where `config-chain` is a guaranteed
   dependency of `@pnpm/npm-conf`.

3. `yargs` stays external — it is a declared direct dependency of
   `packages/cli` and resolves its locale directory relative to `__dirname`.

4. The a2a-server bundle keeps its current inlining and
   `portableTiktokenPlugin` treatment; it is a separately packaged,
   self-contained artifact and must not regress.

### Ownership-contract test

`scripts/tests/issue-3055-cli-externals-ownership.bun.test.ts` reads the real
`packages/cli/package.json` manifest and asserts every entry in
`CLI_DIRNAME_DEPENDENT_EXTERNALS` is a declared direct dependency. It fails
if someone adds an undeclared transitive package (proven against the
`config-chain` entry that caused the original defect). It is cheap and
deterministic: no npm install, no network, no mocks — just `JSON.parse` of the
committed manifests.

### Purity guard

`scripts/tests/issue-3055-bundle-purity.bun.test.ts` builds the real CLI
bundle and asserts the emitted `llxprt.js` contains no absolute path rooted at
the repository/build root. It scans for both the raw OS path and its
JavaScript-escaped form (`JSON.stringify`, which doubles backslashes on
Windows), and also covers `realpathSync(repoRoot)` because Bun may canonicalize
a symlinked checkout. This generalises beyond tiktoken: it catches the next
dependency that bakes `__dirname`, and it also closes the path-disclosure leak.

### Relocated-runtime test

`scripts/tests/issue-3055-tiktoken-relocated.bun.test.ts` builds a fixture
entry that imports `@dqbd/tiktoken` and encodes a string, using the CLI bundle's
`external` policy, against a temporary `node_modules` we own. Delete that
temporary `node_modules`, place an equivalent one beside the relocated bundle,
and execute. Passes with the module external; reproduces `Missing
tiktoken_bg.wasm` when inlined. Asserts a positive integer token count, not
just any digit string.

## Tests (must fail on main, pass after the fix)

- **Artifact purity.** Build `cliBundleConfig` and assert the emitted
  `llxprt.js` contains no absolute path rooted at the repository root. Fails on
  main (three such paths). Deterministic, no network, no mocks.
- **Relocated-runtime behaviour.** Build a fixture entry that imports
  `@dqbd/tiktoken` and encodes a string, using the CLI bundle's `external`
  policy, against a temporary `node_modules` we own. Delete that temporary
  `node_modules`, place an equivalent one beside the relocated bundle, and
  execute. Passes with the module external; reproduces `Missing
  tiktoken_bg.wasm` when inlined. This is the automated form of the manual
  reproduction above.
- **Ownership contract.** Reads the real manifests and asserts every
  `CLI_DIRNAME_DEPENDENT_EXTERNALS` entry is a declared direct dependency of
  `packages/cli`. Fails against the `config-chain` entry that caused the defect.

## Packed/installed conflict test evaluation

The reviewer suggested a full packed/installed regression with a synthetic
dependency conflict (a conflicting `config-chain` at the consumer level). The
manifest invariant test is the **stronger and cheaper guard**: it catches the
defect class at the source — before the bundle is even built — by checking that
every externalized module is a direct dependency whose resolution is
guaranteed. A packed/installed conflict test would only catch the specific
`config-chain` scenario, requires building a synthetic `node_modules` tree
and a packed tarball, and adds significant runtime. The manifest invariant
subsumes it: if `config-chain` is never externalized (because it is not a direct
dependency), the conflict scenario cannot arise. The manifest test is
preferred.

## Out of scope

Changing the a2a-server bundle strategy, revisiting the #2999 launch-cost
optimisation, or reworking `portable-tiktoken-plugin.ts` for the a2a target.
