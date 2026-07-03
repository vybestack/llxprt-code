# API-Surface Guard Mechanism & Runtime Factory Decision Records

Plan ID: PLAN-20260629-ISSUE2285
Artifact type: Pre-implementation analysis (decisions for preflight)

## 1. API-surface guard mechanism decision

### Options

| Option | Description | Type-aware? | Stale-risk |
|--------|-------------|-------------|------------|
| A | Runtime `Object.keys(root)` snapshot | NO (values only) | low |
| B | Parse freshly emitted `dist/index.d.ts` after `npm run build` | YES | requires fresh build |
| C | TypeScript compiler API to read exported type names from source | YES | none |
| D | API-report-style declaration snapshot (checked-in `.d.ts`-derived report) | YES | snapshot drift |

### Decision: Option B — parse freshly emitted declarations, built via an isolated temp tsconfig (revision 3)

Rationale:
- The overview explicitly lists "parsing freshly emitted `dist/index.d.ts`
  after `npm run build`" as acceptable.
- It covers BOTH value and type exports (declaration surface).
### Preflight-confirmed mechanism: B1a (rootDir at workspace root)

**CONFIRMED BY P01 PREFLIGHT (authoritative — see
`preflight-results.md` §7).** The recorded mechanism is **B1a**: isolated temp
tsconfig extending the SOURCE-path `packages/agents/tsconfig.json`, with
`rootDir` set to the **repo root** (NOT `packages/agents`). P01 proved that B1
(`rootDir` = `packages/agents`) FAILS with `TS6059: File is not under rootDir`
once ambient-type noise (`TS2688`) is cleared, because the source-path
`tsconfig.json` maps dependency packages to source files OUTSIDE
`packages/agents` (e.g. `../core/src/test-utils/config.ts`). B1a (rootDir =
repo root) contains all dependency source within rootDir, so no `TS6059`
occurs. The remaining nonzero exit is caused ONLY by type-checking errors in
transitively-included test files and one dependency-source WASM-module import
(`shell-parser.ts` `TS2307`), which do NOT affect the agents root-barrel
declaration emission.

**Exact B1a config (from preflight-results.md §7):**
1. `extends` the SOURCE-path `packages/agents/tsconfig.json` (NOT
   `tsconfig.build.json`) — dependency SOURCE resolves, no dependency `dist/`
   required, clean-CI safe.
2. `rootDir` = repo root (NOT `packages/agents`).
3. Override `types: ['node']` and add `typeRoots: [<repo-root>/node_modules/@types]`
   — resolves `TS2688` (cannot find type definition for 'node'/'vitest/globals').
4. `skipLibCheck: true` — avoids spurious `.d.ts` lib-check errors.
5. Override `outDir`, `tsBuildInfoFile` to temp paths.
6. The guard script checks the EMITTED declaration at the NESTED path
   `<temp>/packages/agents/index.d.ts` (root entrypoint) and resolves the
   real barrel at `<temp>/packages/agents/src/index.d.ts` — NOT at
   `<temp>/index.d.ts` (which is the B1 layout, not B1a).
7. The guard script MUST NOT fail on `tsc`'s nonzero exit code — it verifies
   declaration PRESENCE (`test -f <nested-index.d.ts>`) and parses the emitted
   declarations; it does NOT rely on `tsc` exit 0.

**CI wiring (B1a → source-path resolution):** the guard runs in BOTH the
pre-build `lint_javascript` job (alongside `lint:cli-boundary`) AND the
post-build `test` job (to generate the report before `npm run test`).

**B2 (fresh shared dist) was NOT chosen** because B1a works. B2 would read
`packages/agents/dist/index.d.ts` post-build, running ONLY in the `test` job.


### Implementation reality (revision 3 — architect findings 1, 2, 3, 20)

**Finding 1 (temp-build unimplementable as previously written):** the prior
revision said the guard script "builds the agents package to a TEMPORARY
output directory" by passing an outDir override to `scripts/build_package.js`.
That is NOT implementable: `scripts/build_package.js` runs
`tsc --build <tsconfig>` with a fixed `tsconfig.build.json`/`tsconfig.json`
whose `outDir` is hard-coded to `dist`, and it then runs
`tsc --build --clean` and `copy_files.js`. There is NO outDir override path
through that script. The two genuinely implementable options are:

- **(B1) Isolated temp tsconfig + direct `tsc -p`.** The guard script creates
  a temp directory (`mktemp -d`), writes a `tsconfig.api-surface.json` inside
  it that `extends` the real `packages/agents/tsconfig.build.json` (or
  `tsconfig.json`) but overrides ONLY `outDir` (to the temp dir),
  `tsBuildInfoFile` (to a temp path), and `rootDir`/`declaration` as needed.
  The script then runs `tsc -p <temp-tsconfig>` DIRECTLY — NOT through
  `build_package.js`. This emits `.d.ts` (and `.js`) into the temp dir only,
  never mutating the shared `packages/agents/dist` or its `.tsbuildinfo`.
  This is the chosen mechanism (see "Guard build mechanism" below).
- **(B2) Fresh shared `dist` via `npm run build --workspace`.** Accept that
  the guard consumes `packages/agents/dist/index.d.ts` produced by a normal
  `npm run build --workspace @vybestack/llxprt-code-agents`. This mutates the
  shared `dist/` and the cached `node_modules/.cache/tsbuildinfo/agents.tsbuildinfo`.
  This is simpler but has side effects on concurrent test runs and leaves
  generated artifacts in the worktree.

**Chosen mechanism (PREFLIGHT-CONFIRMED — see
"Preflight-confirmed mechanism: B1a" above + `preflight-results.md` §7):
(B1a) isolated temp tsconfig that extends the SOURCE-path `tsconfig.json`,
NOT `tsconfig.build.json`, + direct `tsc -p`, with `rootDir` set to the REPO
ROOT.** The source-path `tsconfig.json` resolves dependency packages
(`@vybestack/llxprt-code-core`, `-auth`, `-settings`) to their SOURCE entrypoints
(`../core/index.ts`, `../auth/src/index.ts`, `../settings/src/index.ts`), NOT to
`../core/dist/index.d.ts`. This means the guard does NOT require dependency
`dist/` to exist — it compiles agents against dependency SOURCE, producing the
agents root `index.d.ts` in a temp dir without any pre-build step. This is the
clean-CI strategy: the lint job in `.github/workflows/ci.yml` runs guards
(`lint:eslint-guard`, `lint:cli-boundary`) AFTER `npm ci` but BEFORE
`npm run build`, so dependency `dist/` does NOT exist at that point. A temp
tsconfig extending `tsconfig.build.json` (which maps deps to `../core/dist/...`)
would FAIL in that job. Extending the source-path `tsconfig.json` avoids the
dependency-dist requirement entirely. The exact temp tsconfig overrides
(per preflight-results.md §7): `extends` the absolute source-path
`packages/agents/tsconfig.json`, `rootDir` set to the **repo root** (NOT
`packages/agents` — B1 with `rootDir: packages/agents` FAILS with `TS6059`
once `TS2688` ambient-type noise is cleared),
`types: ['node']` + `typeRoots: [<repo-root>/node_modules/@types]`,
`skipLibCheck: true`,
`outDir` set to the temp dir, `tsBuildInfoFile` set to a temp path,
`declaration: true`, `noEmit: false`, and `include` mirroring the source
`tsconfig.json` include array. The expected emitted declaration is at the
NESTED path `<temp-dir>/packages/agents/index.d.ts` (root entrypoint) and the
real barrel at `<temp-dir>/packages/agents/src/index.d.ts` (because
rootDir = repo root shifts the output layout — NOT `<temp-dir>/index.d.ts`
which is the B1 layout).

(B2) is documented as the fallback if (B1) proves impractical during P03; if
(B2) is chosen, the guard MUST run `npm run build --workspace
@vybestack/llxprt-code-agents` itself (not rely on pre-existing stale dist),
it MUST be wired in CI to run AFTER `npm run build` (NOT in the pre-build lint
job), and the plan records the shared-dist side-effect tradeoff explicitly
plus the CI ordering constraint.

**Revision 6 architect finding 7 (mechanism-conditional CI wiring):** the CI
job placement depends on which mechanism the preflight (P01) records:
- **B1/B1a/B1b**: source-path resolution → no dependency `dist/` needed → the
  guard runs in BOTH the pre-build `lint_javascript` job (alongside
  `lint:cli-boundary`) AND the post-build `test` job (to generate the report
  before `npm run test`).
- **B2**: reads `packages/agents/dist/index.d.ts` → requires `npm run build`
  first → the guard runs ONLY in the `test` job (post-build). It MUST NOT be
  placed in the pre-build `lint_javascript` job because `dist/` does not exist
  there and the guard would fail.
P03 reads the recorded mechanism from this section and modifies
`.github/workflows/ci.yml` accordingly.

**Revision 5 architect finding 3 (rootDir/outside-rootDir TS6059 error):**
B1 as written sets `rootDir` to `packages/agents` while the source-path
`tsconfig.json` maps dependency packages to source files OUTSIDE
`packages/agents` (e.g. `../core/index.ts`). When TypeScript compiles with
`declaration: true`, it requires all source files to be within `rootDir` —
dependency source files outside `rootDir` cause `TS6059: File is not under
rootDir`. P01 preflight MUST prove the exact config works by running
`tsc -p <temp-tsconfig>` and checking for `TS6059`. If B1 fails with TS6059,
the concrete fallbacks are:

- **(B1a) Expanded rootDir at workspace root**: set `rootDir` to the repo root
  (or `packages/`) so all dependency source files are within `rootDir`. The
  emitted `index.d.ts` lands deeper in the temp dir tree
  (`<temp-dir>/packages/agents/index.d.ts`), but the parser adjusts its read
  path accordingly. This preserves source-path dependency resolution and
  clean-CI safety.
- **(B1b) `emitDeclarationOnly: true` + `declaration: true`**: this changes
  the compiler's file-scoping behavior; test whether it avoids TS6059. If
  `emitDeclarationOnly` still enforces `rootDir` constraints, use B1a or B2.
- **(B2) Fresh shared dist via `npm run build --workspace`**: accept the
  shared-dist side effect, wire in CI post-build (see B2 details above).

**CONFIRMED mechanism: B1a** (recorded above in "Preflight-confirmed
mechanism: B1a" and in `preflight-results.md` §7). P03 implements the B1a
config; the script reads declarations at the nested path
`<temp>/packages/agents/src/index.d.ts` matching the repo-root rootDir.

**Finding 20 (generated dist/.tsbuildinfo side effects):** both (B1) and (B2)
produce build side effects. (B1) confines them to a temp dir that the script
removes on exit (trap-based cleanup). (B2) leaves `dist/` and
`node_modules/.cache/tsbuildinfo/agents.tsbuildinfo` modified in the worktree.
`dist/` is gitignored so it never appears in source inventory, but
`.tsbuildinfo` lives under `node_modules/.cache/` (also gitignored). The
preflight (P01) MUST record: (a) confirm `dist` and the tsbuildinfo cache path
are gitignored; (b) confirm `git status` shows neither as a tracked change
after a build; (c) record the chosen mechanism (B1 or B2) and, for (B2), the
side-effect acknowledgement.

**Finding 2 (parser/helper placement vs Node execution):** the API-surface
parser and the standalone fixture/proof scripts (e.g.
`runtime-factory-single-source-proof.mjs`, `boundary-checker-characterization-proof.mjs`)
run under plain `node`. A TypeScript test helper
(`packages/agents/src/api/__tests__/apiSurfaceParser.ts`) CANNOT be imported
by those standalone Node scripts without a TS loader this project does not
configure for plain `node`. Therefore the parser is a plain ESM
**`.mjs`** module — `packages/agents/src/api/__tests__/apiSurfaceParser.mjs` —
using the TypeScript compiler API via `createRequire('typescript')` (the same
pattern `scripts/check-cli-import-boundary.mjs` already uses). The Vitest
guard test imports the `.mjs` directly (Vitest/Node both load `.mjs` natively).
No `.ts` test helper is created for the parser surface.

**Finding 3 (GlobalSetup vs standalone pretest — concrete decision):** the
guard build MUST NOT run inside the Vitest lifecycle (no `globalSetup`, no
`beforeAll` shell-out). `globalSetup` is part of the Vitest run lifecycle,
and the plan forbids builds inside the test lifecycle. The chosen wiring is a
**standalone npm script** added to the root `package.json`:

```jsonc
"lint:agents-api-surface": "node scripts/check-agents-api-surface.mjs"
```

This script builds (via the temp tsconfig — B1), parses, compares, and exits
nonzero on mismatch. It is invoked:
- standalone in P03/P05/P05a/P13/P13a verification,
- as a named step in the project's CI/presubmit alongside
  `lint:cli-boundary` (the plan does NOT wire it into `npm run test` or a
  Vitest hook; CI adds it as an explicit job/step).

The Vitest guard test (`publicSurface.guard.test.ts`) does NOT build. It reads
a JSON surface report that `lint:agents-api-surface` emits to an
**already-gitignored** cache path (`node_modules/.cache/agents-api-surface/report.json`
— `node_modules` is gitignored, so this never dirties the worktree; revision 4
architect finding 2: the prior path
`packages/agents/src/api/__tests__/.api-surface-report.json` was NOT matched by
any `.gitignore` entry and would appear as an untracked file). OR — if the report
is absent — the test FAILS CLOSED (revision 5 architect finding 2: the test
NEVER silently skips). In CI (`CI=true`), it fails with a message instructing
the developer to run `npm run lint:agents-api-surface` first. Locally (CI not
set), it fails the same way unless `LLXPRT_API_SURFACE_SKIP=1` is set — the
ONLY permitted local skip path. **Architect review finding 9: the
`LLXPRT_API_SURFACE_SKIP` escape hatch MUST be UNSET during final verification
(P13/P13a). The final verification gate asserts the env var is unset before
running the API-surface guard, so the final gate always runs in full fail-closed
mode. This prevents the escape hatch from undercutting final fail-closed
behavior.** The fail-closed contract is carried by BOTH
the `lint:agents-api-surface` script (which always builds fresh) AND the
Vitest test (which fails rather than skipping when the report is absent). This resolves the globalSetup-vs-standalone contradiction by
choosing standalone, naming the exact npm script, and keeping builds out of the
test lifecycle entirely. The report path constant is shared between the script
and the test (e.g. both read `API_SURFACE_REPORT_PATH` computed from
`node_modules/.cache/agents-api-surface/report.json` relative to the repo root).

### Guard contract

1. `npm run lint:agents-api-surface` builds declarations via the isolated temp
   tsconfig (B1) — extending the source-path `packages/agents/tsconfig.json`
   (NOT `tsconfig.build.json`) so dependency SOURCE resolves (no dependency
   `dist/` required, clean-CI safe) — and produces `index.d.ts`-equivalent
   declarations in the temp dir. Emits the JSON report to
   `node_modules/.cache/agents-api-surface/report.json` (already gitignored
   under `node_modules` — revision 4 architect finding 2).
2. The script's parser (`apiSurfaceParser.mjs`) reads the freshly emitted
   `index.d.ts`, extracts the set of exported names (both
   `export { X }` / `export type { X }` / `export *`-resolved names visible in
   the declaration), recursively resolving `export *` re-exports.
   **Revision 6 architect finding 3 (.js-to-.d.ts specifier normalization):**
   the parser MUST normalize `.js` specifiers to `.d.ts` when traversing
   re-export declarations. The actual package root
   (`packages/agents/index.ts`) uses `export * from './src/index.js'` (not
   `'.ts'` or `'.d.ts'`), so the emitted declarations reference
   `'./src/index.d.ts'`. The parser resolves the specifier relative to the
   current declaration file's directory, strips `.js`/extensionless suffixes,
   and appends `.d.ts` to find the referenced declaration file. This applies
   to all re-export forms (`export * from`, `export { } from`, `export type
   { } from`).
3. Compares against a checked-in expected-surface file
   (`packages/agents/src/api/__tests__/expected-root-surface.json`).
4. Independently asserts ABSENCE of denied internals: `AgentClient`,
   `CoreToolScheduler`, concrete `AgenticLoop` class/value.
5. Fails closed on unknown additions (any new root export not in the expected
   snapshot fails until the snapshot is intentionally updated).

### Why not runtime Object.keys alone

`Object.keys(root)` only sees runtime value exports. A `type`-only re-export
of an internal name (e.g. `export type { AgentClient } from './internals.js'`)
would be invisible to `Object.keys` but would still leak the internal type
through the root declaration surface. The declaration parse catches this.

## 2. Runtime factory contract decision

### Current state

`AgentRuntimeFactoryBindings` is defined in TWO places:
- `packages/agents/src/api/runtimeFactories.ts` (agents-owned, in terms of core
  contract types).
- `packages/providers/src/runtime/runtimeContextFactory.ts` (providers-owned,
  the dependency-inversion seam).

### Dependency direction

- agents → depends on → providers (agents `package.json` lists providers).
- providers does NOT depend on agents.
- A single source in agents would create providers → agents dependency (WRONG
  direction / cycle).
- A single source in providers would make agents import the contract from
  providers — acceptable directionally, but the agents version is expressed in
  core contract types and the providers version in core contract types too.
- A neutral/core-owned contract is the cleanest single-source option: define
  `AgentRuntimeFactoryBindings` in core (both agents and providers already
  depend on core).

### Decision: evaluate neutral/core-owned contract first; fall back to documented duplication with compile-time drift guard

Preflight must determine:
1. Whether core already has a natural home for the contract (it already owns
   `AgentClientFactory`, `ToolSchedulerFactory`, `TaskToolRegistration`).
2. Whether moving the structural interface to core is a non-breaking additive
   change for both packages.

If core-owned is feasible → single source of truth in core, both agents and
providers import it. No cycle, no duplication. The decision record
(`runtime-factory-contract-decision.md`, **architect review finding 1: CREATED
in P01, finalized in P09**) records `decision: single-source` and
the exact core module/re-export path.

If core-owned is NOT feasible (e.g. core does not re-export it from its root
and adding it would widen core's surface inappropriately) → retained
duplication with:
- Decision record (`runtime-factory-contract-decision.md`, **architect review
  finding 1: CREATED in P01, finalized in P09**) recording
  `decision: retained-duplication`, the no-cycle/no-neutral justification, AND
  the **exact drift-guard file path** (revision 3 — architect finding 14: the
  guard path is READ from this decision record by P08/P08a/P09/P09a/P13/P13a
  verification, never hard-coded in the verification commands).
- Comments at both declarations referencing the drift guard.
- A compile-time drift guard in a `.types.ts` file (typecheck-visible, NOT a
  `.test.ts` excluded from `tsc --noEmit`) proving exact assignability both
  directions.
- The plan names the exact package/tsconfig command that includes the guard
  and includes a verifier step proving `npm run typecheck` fails on drift.

### Verification branching (revision 3 — architect finding 12)

P09/P09a/P13/P13a verification commands MUST branch on the RECORDED DECISION,
not assume one path. Previously the retained-duplication fallback and P09's
unconditional "both packages import from core" assertion contradicted each
other. The corrected contract:

- The decision record (`runtime-factory-contract-decision.md`, **architect
  review finding 1: CREATED in P01, finalized in P09**) is the single
  source of truth for which path was chosen. It contains a machine-greppable
  `decision: single-source` OR `decision: retained-duplication` line.
- P09 verification: if `decision: single-source`, assert exactly one
  declaration in core AND both packages import from the core root. If
  `decision: retained-duplication`, assert 2+ declarations AND the drift guard
  file (path read from the decision record) exists and participates in
  typecheck. P09 must NOT unconditionally assert core imports when the
  recorded decision is retained-duplication.
- P13/P13a final gate reads the decision record and runs the matching branch.

## 3. CLI session safe test seams

`cliSessionDispatch.tsx` responsibilities (candidate split seams):
1. Interactive Ink render/bootstrap (`startInteractiveUI`).
2. Non-interactive dispatch and runner (`dispatchInteractiveOrNonInteractive`,
   `runPipedOrPromptSession`, `runNonInteractiveSession`).
3. Piped prompt/session driving (stdin merge in `runPipedOrPromptSession`).
4. Output listener setup/flush (`initializeOutputListenersAndFlush`).
5. SIGINT and non-interactive error handling
   (`installNonInteractiveSigintHandler`, `reportNonInteractiveError`,
   `formatNonInteractiveError`).
6. Process lifecycle and unhandled rejection handling
   (`setupUnhandledRejectionHandler`).
7. Terminal protocol and mouse cleanup (`mouseEventsExitHandler`,
   `restoreTerminalProtocolsSync` registration, `setWindowTitle`).

Safe test seams (permissible boundary isolation — replace external effects so
real dispatch code runs):
- Replace `process.stdout`/`process.stderr` writes with captured buffers.
- Replace `process.exit` with a safe seam (throw a sentinel or use a
  subprocess-style characterization) — never terminate the test runner.
- Replace Ink `render` with a no-op or recording fake that captures the React
  tree without a real TTY.
- Replace filesystem diagnostics (`appendFileSync`) with a temp-dir sink.
- Replace `enableMouseEvents`/`disableMouseEvents`/terminal sequence writes
  with captured spies that record the calls but write nowhere.

FORBIDDEN: mocking the `cliSessionDispatch` module itself and asserting only
that the mocks were called without checking resulting output, cleanup state,
handler effect, selected branch, or flushed payloads.

## 4. app-service subpath non-scope check

`./app-service.js` is a declared `exports` entry in `packages/agents/package.json`
pointing at `dist/src/app-service.js` (source: `packages/agents/src/app-service.ts`).
It is consumed by:
- `packages/cli/src/services/commandApiMapCompleteness.test.ts` (test).
- `packages/agents/src/app-services/*` (internal).

It is ORTHOGONAL to the root internals leak (it is its own curated subpath, not
the root barrel). Preflight confirms no direct requirement to change it. The
plan does NOT modify `app-service.js` unless preflight identifies a direct
requirement.

## 5. CLI_BOUNDARY_ROOT fixture test updates

The synthetic fixture tests in `scripts/tests/cli-import-boundary.test.js` that
encode the old symbol-allowlist behavior:
- "allows importing a PUBLIC agents symbol (createAgent) from the bare root"
- "flags importing an INTERNAL symbol (AgentClient) from the bare agents root"
- "flags importing an INTERNAL type-only symbol (CoreToolScheduler)..."
- "flags a namespace import..."
- "flags a default import..."
- "allows importing PUBLIC runtime-construction factories..."
- "flags importing the concrete AgenticLoop class..."
- "flags importing an internal symbol via an alias..."
- "flags internal agents symbols with NO per-file escape hatch..."
- "flags internal agents symbols from ANY file..."

After `PUBLIC_AGENT_SYMBOLS` removal, the bare-root symbol check is GONE. The
checker no longer inspects WHICH symbol is imported from the bare root — it
only cares about the SPECIFIER. So:
- `import { AgentClient } from '@vybestack/llxprt-code-agents'` → the bare root
  is allowed (specifier-level), but the IMPORT WILL FAIL at typecheck/build
  because `AgentClient` is no longer a root export. The boundary checker no
  longer needs to flag this; the API-surface guard + typecheck catch it.
- `import { AgentClient } from '@vybestack/llxprt-code-agents/internals.js'`
  → the internals subpath is FORBIDDEN in production CLI (deep import rule).

The fixture tests must be updated to reflect the new specifier-based rules:
the bare root is always allowed at the specifier level; the internals subpath
is forbidden; deep agents source paths are forbidden. The symbol-level fixture
tests are removed or converted to internals-subpath tests.
