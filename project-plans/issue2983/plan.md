# Issue #2983 — Remove the build from the test path; keep it for lint/typecheck only and emit declarations, not JS

## Objective

Confine the TypeScript build to the one thing that consumes it — type-aware
lint and `tsc --noEmit` — and stop emitting JavaScript that nothing runs.

Two changes:

1. Remove the full `npm run build` from the `test_shard` CI legs.
2. Give the retained type-resolution build a declaration-only mode
   (`--emitDeclarationOnly`) so it writes `.d.ts` and no `.js`.

## Preflight evidence (measured, not assumed)

Ran every shard with `packages/*/dist` and the tsbuildinfo cache deleted.

| Shard       | Result without `dist/`                                        |
| ----------- | ------------------------------------------------------------- |
| `core`      | pass                                                          |
| `providers` | pass                                                          |
| `rest`      | 2 failures in `packages/auth` (build-artifact assertions)     |
| `cli`       | 34 failures across 3 integration files spawning `dist/index.js` |
| `scripts`   | 3 failures from `scripts/start.ts`; 1 from the agents guard   |
| `agents`    | fails at `pretest` (agents API-surface guard)                 |

Root causes found:

1. **`scripts/start.ts` imports compiled output.**
   `import { parseBootstrapArgs } from '../packages/cli/dist/src/config/profileBootstrap.js'`
   — a runtime consumer of emitted JavaScript. This is the defect the issue
   predicted; fix at the import site by resolving the TypeScript source.

2. **`packages/auth/src/__tests__/package-boundary.test.ts` asserts build
   artifacts exist on disk** (`dist/index.js`, `dist/index.d.ts`). These are
   build smoke assertions misplaced in a unit shard: the shard no longer
   builds, so the assertion tests the harness, not the package. The adjacent
   metadata assertions (`main === 'dist/index.js'`, `types`, `exports`) already
   pin the published contract and stay.

3. **`packages/cli`'s build chains `chmod_executable.ts dist/index.js`.**
   In declaration-only mode that file is deliberately not emitted.

4. **Three CLI integration files spawn `node packages/cli/dist/index.js`.**
   `cli-args-test-helpers.ts` and `loadbalancer.integration.test.ts` build the
   path from `process.cwd()`. Their own comments already describe the child as
   booting "the whole CLI from TypeScript source", so the compiled launcher was
   vestigial; spawning `index.ts` with the Bun binary that runs the suite is
   both correct and faster.

5. **`scripts/check-agents-api-surface.ts` needs dependency declarations.**
   Its docblock claims otherwise, but its temp tsconfig resolves
   `@vybestack/llxprt-code-{telemetry,mcp}` and several `storage/*` subpaths
   through `node_modules` → `dist/*.d.ts`, because `packages/agents/tsconfig.json`
   has no source mapping for them. Those subpaths are not expressible as
   wildcard `paths` entries — `@vybestack/llxprt-code-storage/storage/secure-store.js`
   resolves to `src/secure-store/secure-store.ts`, and
   `@vybestack/llxprt-code-tools/doubleEscapeUtils.js` to
   `src/formatters/doubleEscapeUtils.ts` — so repointing them is a per-subpath
   refactor across several packages. That is issue #2618 (tsconfig bypasses)
   and is explicitly **out of scope here**. Both the `agents` shard (via the
   agents package `pretest` hook) and the `scripts` shard (via
   `scripts/tests/check-agents-api-surface.test.ts`) run this guard.

6. **The VS Code companion's build bundles with esbuild**, which resolves
   `@vybestack/llxprt-code-ide-integration` at `dist/*.js`. It contributes no
   declarations that any tsconfig maps and is built separately by
   `npm run build:vscode`, so the declaration build skips it.

7. **A partially built workspace is worse than an unbuilt one.** Bun applies
   tsconfig `paths` at runtime, so `packages/core/tsconfig.json`'s
   `@vybestack/llxprt-code-mcp -> ../mcp/dist/mcp/index.d.ts` mapping wins over
   the package's `bun` export condition whenever that file exists. Measured:
   with a declaration-only `dist`, 178 of 340 agents test files die at import
   with `Cannot find module './src/index.js' from packages/mcp/dist/mcp/index.d.ts`,
   and `bun scripts/start.ts` fails the same way. With no `dist`, resolution
   falls through to the `bun` condition and everything passes. Therefore
   `build:types` is confined to `lint_javascript`, which runs no application
   code, and the two guard legs run the full build.

## Accepted behavior

- **AC1** — No `test_shard` leg runs the full `npm run build`.
- **AC2** — Every `test_shard` leg that no longer builds passes with no
  `dist/` on disk. The `agents` and `scripts` legs retain the full build,
  because both run the agents API-surface guard and that guard needs a built
  workspace (root causes 5 and 7). This is documented in `ci.yml` and blocked
  on #2618.
- **AC3** — A declaration-only build mode exists and is what the type-aware
  lint job runs. It emits `.d.ts` and writes no `.js`. It is confined to jobs
  that execute no application code (root cause 7).
- **AC4** — The release/publish path keeps full JavaScript emit. Every
  published workspace still declares `main: dist/index.js`, `files` still
  include `dist`, and `release.yml` still runs `npm run build:packages`.
- **AC5** — The redundant `Run agents API-surface guard` step is removed from
  the `agents` test leg; the `lint_javascript` job already runs it after the
  build, and the agents package `pretest` hook covers the shard.
- **AC6** — The stale `ci.yml` comment naming "storage, settings" is corrected
  to the real declaration dependents: `cli → tools`, `core → mcp`,
  `a2a-server → settings/storage/tools`.
- **AC7** — The publish-time CLI bundle (`packages/cli/bundle/llxprt.js`,
  issues #2999/#3013) stays decoupled: it is not built by
  `scripts/build_package.ts`, and no build path deletes `packages/cli/bundle/`.
- **AC8** — No new lint suppressions, no relaxed rules, no raised thresholds.

## Out of scope

- Repointing the cross-workspace `dist/*.d.ts` tsconfig mappings at source
  (issue #2618). The build is retained deliberately for lint/typecheck.
- Changing what is published or how the CLI launches.
- Removing the last declaration-only build from the `scripts` shard leg;
  that is unblocked by #2618.

## Design

### Declaration-only mode

`tsc --build` accepts `--emitDeclarationOnly` (verified against the pinned
TypeScript 5.8.3 build-mode help), so no parallel tsconfig tree is needed.

- `scripts/build_package.ts` appends `--emitDeclarationOnly` to the
  `tsc --build` invocation when `LLXPRT_EMIT_DECLARATIONS_ONLY=1`.
- Root script `build:types` sets that variable and delegates to the existing
  `build`, so there is exactly one build pipeline with two emit modes.
- `scripts/build.ts` drops the bundle-only VS Code companion workspace in
  declaration-only mode.
- `scripts/chmod_executable.ts` treats an absent target as a no-op **only** in
  declaration-only mode, and still fails fast otherwise.

### CI wiring

- `lint_javascript` job: `npm run build` → `npm run build:types`.
- `test_shard`: `Build project` gated to the `agents` and `scripts` legs and
  left on the full build.
- `test_shard`: `Run agents API-surface guard` deleted (redundant).
- `acp_conformance` job and `release.yml` keep the full build unchanged.

Net effect: four of six shard legs stop building entirely, and the retained
lint/typecheck build stops transpiling.

## Test plan (behavioral, bun:test)

New `scripts/tests/issue-2983-declaration-build.test.ts`:

1. Real `tsc --build --emitDeclarationOnly` run against a temp fixture project
   emits `.d.ts` and no `.js`; the same fixture without the flag emits `.js`.
2. `resolveBuildPlan` (exported from `build_package.ts`) selects the flag from
   the environment and never selects it by default.
3. `chmod_executable.ts` exits 0 on a missing target in declaration-only mode
   and exits non-zero on a missing target otherwise.
4. `ci.yml`: `test_shard` has exactly one build step, gated to the `agents`
   and `scripts` legs, and it is not the declaration-only variant; no
   per-shard API-surface guard step remains; `lint_javascript` builds
   declarations before running the guard and never runs the full build.
5. `ci.yml`: the lint build comment names `cli -> tools`, `core -> mcp`,
   `a2a-server -> settings/storage/tools`.
6. `release.yml` still runs `npm run build:packages` (full emit), and neither
   `build` nor `build:packages` sets the declaration-only flag.
7. The CLI bundle stays out of `build_package.ts`/`copy_files.ts` and remains
   on the CLI package `prepack`.

Updated existing tests:

- `packages/auth/src/__tests__/package-boundary.test.ts` — drop the two
  build-artifact existence assertions.
- `packages/cli/src/integration-tests/{cli-args-test-helpers,loadbalancer.integration.test}.ts`
  — spawn `packages/cli/index.ts` under Bun instead of `node dist/index.js`.

## Review triage

| Finding                                                            | Class        | Action                                                                                                                              |
| ------------------------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Full build still runs on the `agents`/`scripts` legs                 | Defer        | The remedy is repointing cross-workspace mappings at source, which the issue lists under **Out of scope**. Owned by #2618.            |
| `build:types` still emitted LSP JavaScript                           | In-scope-Fix | `packages/lsp` skipped in declaration mode; nothing imports it or maps it in any tsconfig, so no declarations are lost.               |
| `copy_files.ts` stages two example-extension `.js` assets            | Reject       | Copied verbatim, not compiler output. Staging must stay so `dist`-mapped JSON imports resolve. Wording tightened to say "transpiled". |
| New tests only exercised a compiler fixture, not the real pipeline   | In-scope-Fix | Added an end-to-end `build_package.ts` run against a throwaway workspace, asserting emitted files in both modes.                      |
| Deleting auth's on-disk artifact assertions loses release coverage    | In-scope-Fix | Replaced by the end-to-end pipeline test, which proves the full build writes `index.js`, `index.d.ts`, assets and `.last_build`.      |
| Comments overstate that nothing consumes `dist/*.js`                 | In-scope-Fix | Corrected: published library packages do consume it through `main`/`import`; only the PR path does not.                              |
| `scripts/build.ts` builds a shell command string                     | Reject       | Names come from repo-owned manifests and are validated against npm's package-name grammar; matches the file's existing `execSync` use. |

## Verification

`npm run test`, `npm run lint:ci`, `npm run lint:eslint-guard`,
`npm run typecheck`, `npm run format:check`, `npm run build`, and
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.

Plus a cold-shard rerun with `packages/*/dist` deleted.
