# Phase 03: API/Type-Surface Guard TDD — mechanism + leak-detection characterization

## Phase ID
`PLAN-20260629-ISSUE2285.P03`

## Prerequisites
- Required: Phase 02a completed.
- Verification: `test -f project-plans/issue2285/.completed/P02a.md`.
- Preflight verification (P01a) completed.

## Requirements Implemented (Expanded)

### REQ-002.1/.2/.3/.4/.5: Public API Contract Gate (guard mechanism + leak proof)

**Full Text**: A focused agents public API-surface guard must be implemented
(declaration-aware, covering type and value exports). It must fail closed on
unknown root-surface changes, independently assert absence of known internals,
and if it reads `dist`, build ordering must guarantee fresh declarations.
Snapshot update must be an intentional reviewable change.

**Behavior**:
- GIVEN: the agents root currently re-exports internals
  (`export * from './internals.js'`).
- WHEN: the API-surface guard mechanism (parser + comparator + deny checker)
  is implemented and a CURRENT-STATE characterization test runs against it.
- THEN: the characterization test is GREEN because it asserts the CURRENT
  leaky surface is detectable — i.e. it proves the guard catches the existing
  export-star leak (`AgentClient`, `CoreToolScheduler`, concrete `AgenticLoop`
  ARE resolved through `export * from './internals.js'`). This is GREEN
  characterization, NOT a committed RED test.

**Why This Matters**: without a declaration-aware guard that recursively
resolves `export *` re-exports, type-only internal leakage and export-star
transitive leaks bypass the guard. This phase proves the mechanism detects the
CURRENT real leak before the guard is flipped to deny mode in P05.

## Architect findings addressed by this phase

- **Finding 1** (sequencing): this phase ends GREEN (current-state
  characterization). No phase commits a RED test. The deny-flip + depollution
  happen together in P05 so verification is green at every phase boundary.
- **Finding 2** (export-star leak): the parser MUST use the TypeScript compiler
  API or recursively resolve `export *` declarations so transitive leaks
  through `export * from './internals.js'` are caught. The characterization
  test PROVES the current leak is detected.
- **Finding 3** (snapshot brittleness): the expected-surface snapshot must
  live in a location proven to resolve under Vitest and the build. Preflight
  (P01) determines the exact supported fixture/snapshot location; this phase
  adds a preflight resolution check proving the snapshot path is readable by
  the test at runtime. See "Snapshot location" below.

## TDD sequencing within P03 (architect review finding 8)

**Architect review finding 8 (P03 combines too many concerns for strict
PLAN/RULES adherence):** P03 combines the guard test/contract, the parser, the
standalone script, the snapshot, and the green characterization in one phase.
If strict PLAN/RULES TDD adherence is required, the test/contract must be
established BEFORE implementation and record a proof that would FAIL if
export-star/type-only leak detection were absent.

To satisfy this without splitting the phase sequence (P00→P13a preserved),
this phase MUST be executed in strict internal sub-steps that establish the
contract first:

1. **Contract-first sub-step (before any parser/script implementation):**
   write the `publicSurface.guard.test.ts` file with the Guard Test Contract
   (described below) INCLUDING assertions that resolve denied names through
   `export *`. At this point the parser does not exist, so the test file
   references `apiSurfaceParser.mjs` which does not yet exist. The worker
   records (in the completion marker) that the test FAILS at this point
   because the parser is absent — this is the failing/characterization proof.
   The proof demonstrates that without export-star/type-only leak detection,
   the test cannot pass: the denied names (`AgentClient`,
   `CoreToolScheduler`, `AgenticLoop`) would not be resolved.

2. **Implementation sub-step:** implement `apiSurfaceParser.mjs` (with
   `.js`-to-`.d.ts` specifier normalization for export-star traversal),
   `scripts/check-agents-api-surface.mjs`, and the CI wiring.

3. **Characterization GREEN sub-step:** re-run the test — it now PASSES
   because the parser resolves denied names through `export *` and the
   snapshot matches the current leaky surface. This is the GREEN
   characterization proof: the mechanism detects the CURRENT real leak.

The completion marker for P03 MUST record:
- The initial failing/characterization proof (sub-step 1): the test existed
  before the parser and could not pass without export-star resolution.
- The GREEN characterization result (sub-step 3): the mechanism now detects
  the leak.
This ensures the contract is established before implementation and the proof
would fail if export-star/type-only leak detection were absent.

## Implementation Tasks

### Files to Modify

- `package.json` (root) — add the `lint:agents-api-surface` npm script entry.
- `.github/workflows/ci.yml` — **revision 4 architect finding 1**: add an
  explicit `Run agents API-surface guard` step in the `lint_javascript` job
  (after the existing `Run CLI import-boundary guard` step) AND a
  `Generate agents API-surface report` step in the `test` job (after
  `Build project`, before `Run tests and generate reports`). Without these,
  the guard is NOT CI-enforced (prior revisions only added the package.json
  script, which proves local wiring, not CI enforcement). See "CI Workflow
  Modification" below for the exact step YAML.

### Files to Create

This phase writes the GUARD MECHANISM (parser + comparator + deny checker),
the EXPLICIT API-surface script (`scripts/check-agents-api-surface.mjs`,
wired as the standalone `lint:agents-api-surface` npm script), and a
CURRENT-STATE characterization test. The deny-mode flip + depollution is P05.

**Revision 4 (architect findings 1, 2, 3, 9):**

- The guard script builds declarations via an **ISOLATED TEMP TSCONFIG that
  extends the SOURCE-path `tsconfig.json`** (revision 4 finding 3) — it
  resolves dependency SOURCE, not dependency `dist/`, so it is clean-CI safe
  in the pre-build lint job. See "API Guard Build Mechanism (revision 4 —
  finding 3)" below.
- The parser is a plain ESM **`.mjs`** module (finding 2), not a `.ts` test
  helper, so standalone Node scripts and the Vitest test can both import it.
- The build runs as a **STANDALONE npm script** (`lint:agents-api-surface`),
  NOT inside a Vitest `globalSetup` (finding 3 — globalSetup runs inside the
  test lifecycle, which the plan forbids for builds).
- **Revision 4 architect finding 1 (CI wiring)**: this phase MUST also modify
  `.github/workflows/ci.yml` to add an explicit step running
  `npm run lint:agents-api-surface` in the `lint_javascript` job, immediately
  after the existing `Run CLI import-boundary guard` step. Without this, the
  guard is not CI-enforced. See "CI Workflow Modification" below.
- **Revision 4 architect finding 9 (marker policy)**: `@plan`/`@requirement`
  markers are NOT added to executable scripts, including
  `scripts/check-agents-api-surface.mjs`. The revision 3 finding 21 exception
  for lint scripts is rescinded. Markers go in test files and plan artifacts
  only. The API-surface script is created marker-free.
- **Revision 4 architect finding 2 (report path)**: the JSON surface report is
  written to `node_modules/.cache/agents-api-surface/report.json` (already
  gitignored under `node_modules`), NOT to
  `packages/agents/src/api/__tests__/.api-surface-report.json` (which was NOT
  matched by any `.gitignore` entry and would dirty the worktree). The report
  path is shared between the script and the test via a computed constant.
- **Revision 4 architect finding 12 (CI report ordering)**: the guard test
  fails in CI (`CI=true`) when the report is absent (does not silently skip),
  and allows local skips only under `LLXPRT_API_SURFACE_SKIP=1`. Additionally,
  `.github/workflows/ci.yml` `test` job runs `npm run lint:agents-api-surface`
  before `npm run test` so the report exists for the test.

- `scripts/check-agents-api-surface.mjs` — the standalone API-surface lint
  script. This script:
  - Builds the agents package declarations into a TEMPORARY directory via an
    isolated temp tsconfig extending the SOURCE-path `tsconfig.json` + direct
    `tsc -p` (mechanism B1, revision 4 finding 3 — NOT `tsconfig.build.json`
    which requires dependency dist/) — NOT via `scripts/build_package.js`
    (which has no outDir override) and NOT into the shared `dist/`. Fallback
    (B2): if B1 proves impractical, run
    `npm run build --workspace @vybestack/llxprt-code-agents` and read
    `packages/agents/dist/index.d.ts`, recording the shared-dist side-effect
    tradeoff and the CI ordering constraint (B2 must run post-build) in the
    decision record. The chosen mechanism is recorded in
    `project-plans/issue2285/analysis/api-guard-mechanism.md` section 1.
  - Parses the temp-dir (or dist) declarations via `parseExportedNames`,
    producing a JSON surface report at the ALREADY-GITIGNORED path
    `node_modules/.cache/agents-api-surface/report.json` (revision 4 finding 2).
  - Compares the report against the checked-in snapshot
    (`expected-root-surface.json`).
  - Asserts denied names are present (P03 characterization mode) or absent
    (P05 deny mode).
  - **Architect review finding 2 (mode transition mechanism):** the script
    reads its enforcement mode from the SNAPSHOT itself, NOT from a separate
    `DENY_MODE` flag. In P03, the snapshot (`expected-root-surface.json`)
    represents the CURRENT leaky surface (includes `AgentClient`,
    `CoreToolScheduler`, `AgenticLoop`). The script's deny logic is ALWAYS
    enforcement-active: it asserts that the report's denied-name set MATCHES
    the snapshot's denied-name set. In P03, since the snapshot still contains
    the denied names, the script passes because the report also contains them
    (characterization — the snapshot and report agree on the leaky surface).
    In P05, the snapshot is UPDATED to the depolluted surface (denied names
    removed), so the script's deny assertions enforce ABSENCE — any denied
    name remaining in the report causes a nonzero exit. The snapshot update
    IS the mode transition: there is no separate `DENY_MODE` flag in the
    script. The Vitest test's `DENY_MODE` flag controls only the TEST's
    assertion direction (P03: assert presence for characterization; P05:
    assert absence for enforcement) — the script is always enforcement-active
    but measures enforcement against the current snapshot.
  - Exits nonzero on mismatch.
  - Trap-removes the temp dir on exit (finding 20 — no lingering side effects).
  - **NO `@plan`/`@requirement` markers** (revision 4 finding 9 — executable
    scripts are marker-free; markers are for test files and plan artifacts
    only).
  - Wired into CI/presubmit as a named step. The root `package.json` gains:
    `"lint:agents-api-surface": "node scripts/check-agents-api-surface.mjs"`.
    **Revision 4 finding 1**: `.github/workflows/ci.yml` ALSO gains an explicit
    step in the `lint_javascript` job (see CI Workflow Modification below).
    The Vitest test does NOT trigger builds (finding 3).

- `packages/agents/src/api/__tests__/apiSurfaceParser.mjs` — plain ESM helper
  module (revision 3 finding 2) that parses the declaration surface and
  extracts exported names (value + type), **recursively resolving `export *`
  re-exports**. It is `.mjs` (not `.ts`) so standalone Node scripts and the
  Vitest test can both import it without a TS loader.
  - **Revision 5 architect finding 1 (marker policy): NO `@plan`/`@requirement`
    markers.** `apiSurfaceParser.mjs` is an executable ESM helper imported by
    both standalone Node scripts and the Vitest test. It is classified as an
    executable script/helper — the same marker-free policy that applies to
    `scripts/check-agents-api-surface.mjs` applies here. Markers are restricted
    to test files (`.test.ts`, `.spec.ts`) and plan artifacts (`.md`) only.
    Attribution for this helper lives in this plan artifact
    (`03-api-surface-guard-tdd.md`), not in the executable file itself.
  - Exports: `parseExportedNames(declarationPath: string): Set<string>`
    - MUST handle `export * from '...'` by recursively following the referenced
      declaration files (or use the TypeScript compiler API to resolve the full
      public surface). A regex over `index.d.ts` alone is NOT sufficient — it
      must resolve export-star transitive names.
    - Extracts: `export { X }`, `export { X as Y }` (records `Y`),
      `export type { X }`, `export interface X`, `export class X`,
      `export function X`, `export const/let/var X`, and resolved `export *`
      names.
    - **Revision 6 architect finding 3 (.js-to-.d.ts specifier normalization):
      MUST normalize `.js` specifiers to `.d.ts` declaration files when
      traversing re-export declarations.** The actual package root
      `packages/agents/index.ts` exports `export * from './src/index.js'`
      (line 12), and `src/api/index.ts` uses `export * from './agent.js'` etc.
      When parsing emitted declarations, these specifiers appear as
      `export * from './src/index.d.ts'` or `'./agent.d.ts'` in the `.d.ts`
      output. The parser MUST strip/replace the `.js` (or extensionless)
      specifier and append `.d.ts` so the referenced declaration file is found
      relative to the current declaration file's directory. This applies to
      ALL re-export forms: `export * from './X.js'`, `export { Y } from
      './X.js'`, and `export type { Z } from './X.js'`. Fixtures MUST include:
      - `export * from './src/index.js'` (root-to-src barrel — the actual
        pattern in `packages/agents/index.ts` line 12)
      - nested `export * from './internals.js'` (re-exported from
        `./src/index.js`)
      so the parser's specifier normalization is proven against real patterns.
  - Exports: `DENIED_INTERNAL_NAMES: ReadonlySet<string>` (contains
    `AgentClient`, `CoreToolScheduler`, `AgenticLoop`).
  - Exports: `loadExpectedSurface(snapshotPath: string): Set<string>`.
  - Exports: `API_SURFACE_REPORT_PATH` (the shared report path constant:
    `node_modules/.cache/agents-api-surface/report.json` relative to the repo
    root — revision 4 finding 2).

- `packages/agents/src/api/__tests__/publicSurface.guard.test.ts` — the
  declaration-aware API-surface guard test, in CURRENT-STATE CHARACTERIZATION
  mode (P03).
  - MUST include: `@plan:PLAN-20260629-ISSUE2285.P03`
  - MUST include: `@requirement:REQ-002`
  - P03 mode: the test reads the JSON surface report produced by
    `lint:agents-api-surface` (NOT by an in-lifecycle build) from the shared
    report path (`node_modules/.cache/agents-api-surface/report.json`) and
    asserts the guard DETECTS the current leak — i.e. the report INCLUDES
    `AgentClient`, `CoreToolScheduler`, and concrete `AgenticLoop` (proving
    export-star transitive resolution works against the real current root).
    This is GREEN against the current leaky root.
  - **Revision 4 architect finding 12 (report-absent behavior)**: if the
    report is absent, the test does NOT silently skip unconditionally. In CI
    (`CI=true`), the test FAILS with a message instructing to run
    `npm run lint:agents-api-surface` first. Locally (CI not set), it skips
    ONLY if `LLXPRT_API_SURFACE_SKIP=1` is set; otherwise it also fails with
    the instruction. This ensures `npm run test` in CI cannot silently skip
    the guard when the report is absent.
  - The DENY assertions (`expect(exported).not.toContain(name)`) and snapshot
    comparison are written in this phase but guarded by a mode flag
    (`DENY_MODE = false` in P03) so the committed test is GREEN. P05 flips
    `DENY_MODE = true` after depollution. The deny logic is real code (not
    stubbed) — it runs against the current surface and the characterization
    asserts it WOULD flag the leak.
  - Type-only deny case: a test proving a type-only export of a denied name
    is resolved by the parser (proves declaration-awareness + export-star
    resolution, not just runtime values).

- `packages/agents/src/api/__tests__/expected-root-surface.json` — the
  checked-in expected surface snapshot. In P03 this represents the CURRENT
  (pre-depollution, leaky) surface so the snapshot comparison passes in
  characterization mode. P05 updates it to the depolluted surface.

### API Guard Build Mechanism (revision 4 — finding 3: source-path tsconfig for clean CI)

The guard script builds declarations WITHOUT mutating shared `dist` AND without
requiring dependency `dist/` to exist. Since `scripts/build_package.js` offers
no outDir override, the script uses an isolated temp tsconfig + direct
`tsc -p`. **Critically (revision 4 architect finding 3), the temp tsconfig
extends the SOURCE-path `packages/agents/tsconfig.json`, NOT
`tsconfig.build.json`.** The source `tsconfig.json` maps dependencies
(`@vybestack/llxprt-code-core`, `-auth`, `-settings`) to their SOURCE
entrypoints (`../core/index.ts`, `../auth/src/index.ts`, `../settings/src/index.ts`),
while `tsconfig.build.json` maps them to `../core/dist/index.d.ts` etc.
In CI, the `lint_javascript` job runs lint guards (including this one) AFTER
`npm ci` but BEFORE `npm run build` — so dependency `dist/` does NOT exist at
that point. Extending `tsconfig.build.json` would fail; extending
`tsconfig.json` resolves dependencies from source and succeeds.

```javascript
// Inside scripts/check-agents-api-surface.mjs (mechanism B1, revision 4):
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-api-surface-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const tempConfig = {
  // extends the SOURCE-path tsconfig.json — NOT tsconfig.build.json (finding 3)
  extends: path.join(repoRoot, 'packages/agents/tsconfig.json'),
  compilerOptions: {
    rootDir: path.join(repoRoot, 'packages/agents'),
    outDir: tmp,
    tsBuildInfoFile: path.join(tmp, '.api-surface.tsbuildinfo'), // finding 20
    declaration: true,
    noEmit: false,
    composite: false,
  },
  include: [
    path.join(repoRoot, 'packages/agents/index.ts'),
    path.join(repoRoot, 'packages/agents/src/**/*.ts'),
    path.join(repoRoot, 'packages/agents/src/**/*.json'),
  ],
  exclude: [
    'node_modules',
    'dist',
    '**/*.test.ts',
    '**/*.spec.ts',
  ],
};
fs.writeFileSync(path.join(tmp, 'tsconfig.api-surface.json'),
  JSON.stringify(tempConfig, null, 2));
execFileSync('npx', ['tsc', '-p', path.join(tmp, 'tsconfig.api-surface.json')], {
  stdio: 'inherit', cwd: repoRoot,
});
// root entrypoint is index.ts; rootDir is the package dir → index.d.ts at tmp root
const declarationText = fs.readFileSync(path.join(tmp, 'index.d.ts'), 'utf8');
// Write the report to an ALREADY-GITIGNORED cache path (finding 2):
// node_modules is gitignored, so this never dirties the worktree.
const reportDir = path.join(repoRoot, 'node_modules/.cache/agents-api-surface');
fs.mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, 'report.json');
fs.writeFileSync(reportPath, JSON.stringify([...parsedNames].sort()));
```

If P03 discovers that the source-path temp-tsconfig approach fails (e.g. the
source tsconfig's path mappings are incompatible with isolated compilation),
the script falls back to mechanism B2 (`npm run build --workspace
@vybestack/llxprt-code-agents` then read `packages/agents/dist/index.d.ts`).
For B2, the guard MUST be wired in CI to run AFTER `npm run build` (NOT in the
pre-build `lint_javascript` job — it would go in the `test` job after the
build step, or a dedicated post-build lint step), and the plan records the
shared-dist side-effect tradeoff (finding 20) and the CI ordering constraint.
The decision record (`analysis/api-guard-mechanism.md` section 1) records
which mechanism shipped.

**Revision 5 architect finding 3 (rootDir/outside-rootDir source error):**
the B1 temp tsconfig as written above sets `rootDir` to
`packages/agents` while extending the source-path `tsconfig.json` whose path
mappings resolve dependency packages (core, auth, settings) to SOURCE files
OUTSIDE `packages/agents` (e.g. `../core/index.ts`). When `declaration: true`
and `emitDeclarationOnly`-style emission is active, TypeScript may error with
`TS6059: File '.../core/index.ts' is not under 'rootDir' '.../packages/agents'`
because the compiler is being asked to emit declarations for files outside
`rootDir`. **This is a known TypeScript constraint, not a hypothetical risk.**
P01 MUST prove the exact B1 configuration works by running it and confirming
`index.d.ts` is emitted without error. If P01 discovers the rootDir conflict
is real, one of these concrete fallbacks is used (and recorded in
`analysis/api-guard-mechanism.md` section 1):

- **(B1a) Expanded rootDir**: set `rootDir` to the workspace root
  (`repoRoot`), so all source-mapped dependency files are under `rootDir`.
  The emitted `index.d.ts` will be nested under the package-relative path in
  the temp dir (e.g. `<tmp>/packages/agents/index.d.ts`), and the script reads
  it at that nested path. No `TS6059` error because all input files are under
  `rootDir`.
- **(B1b) `emitDeclarationOnly: false` + `declaration: true` + `noEmit:
  false` with `rootDir` at workspace root and explicit `include` limited to
  agents source** — same as B1a but with `declaration` as the only output;
  the script reads declarations from the nested path.
- **(B2) Fresh shared dist fallback**: `npm run build --workspace
  @vybestack/llxprt-code-agents` (builds with the real build config), then
  read `packages/agents/dist/index.d.ts`. This avoids the rootDir problem
  entirely because the real build config already handles cross-package
  declaration emission. Wired in CI to run AFTER `npm run build`.

The P01 preflight check (section 7) MUST run the exact B1 config first. If it
fails with `TS6059` or any rootDir-related error, P01 records the failure and
the chosen fallback (B1a/B1b/B2), and P03 uses that fallback. The decision is
authoritative — P03/P03a/P13/P13a all read the recorded mechanism from
`analysis/api-guard-mechanism.md` section 1.

### CI Workflow Modification (revision 4 — architect finding 1: wire the guard into GitHub CI; revision 6 finding 7: mechanism-conditional wiring)

**This phase MUST modify `.github/workflows/ci.yml`** to add explicit steps
running `npm run lint:agents-api-surface`. Without this, the guard is a
local-only script — it is NOT CI-enforced. The existing CI `lint_javascript`
job runs `lint:eslint-guard` and `lint:cli-boundary` but NOT the new guard.

**Revision 6 architect finding 7 (mechanism-conditional CI wiring):** the CI
job placement depends on the recorded build mechanism (B1/B1a/B1b vs B2),
which P01 preflight determines. The prior revision unconditionally placed
the guard in the pre-build `lint_javascript` job AND required
`lint:agents-api-surface` there. That is correct for B1/B1a/B1b (source-path
tsconfig resolves dependencies from SOURCE — no dependency `dist/` needed),
but CONTRADICTORY for B2 (which reads `packages/agents/dist/index.d.ts` and
therefore MUST run AFTER `npm run build`). The CI wiring is split:

**If the recorded mechanism is B1/B1a/B1b (isolated temp tsconfig — source-path resolution):**

**Step 1 — `lint_javascript` job (the lint job, pre-build)**: add a new step
immediately after the existing `Run CLI import-boundary guard` step and before
`Run linter`:

```yaml
      - name: 'Run agents API-surface guard'
        run: |-
          npm run lint:agents-api-surface
```

**Why this placement works (revision 4 finding 3)**: the `lint_javascript`
job runs `npm ci` then the lint guards (before `npm run build`). The API-surface
guard's temp tsconfig extends the SOURCE-path `tsconfig.json`, which resolves
dependencies from SOURCE — so it does NOT need dependency `dist/` and works
in this pre-build position.

**Step 2 — `test` job (post-build, pre-test)**: the `test` job runs
`npm run test` which includes the guard test. To ensure the report exists for
the test, add a step in the `test` job after `Build project` / `Create bundle`
and before `Run tests and generate reports`:

```yaml
      - name: 'Generate agents API-surface report'
        run: |-
          npm run lint:agents-api-surface
```

This guarantees the report at `node_modules/.cache/agents-api-surface/report.json`
exists when `npm run test` runs the guard test, so the test does not fail (or
skip) due to a missing report (revision 4 finding 12).

**If the recorded mechanism is B2 (fresh shared dist — post-build):**

The guard reads `packages/agents/dist/index.d.ts`, which only exists AFTER
`npm run build`. Therefore the guard MUST NOT run in the pre-build
`lint_javascript` job (it would fail because `dist/` does not exist). Instead:

**Step 1 — `test` job ONLY (post-build)**: add the guard step AFTER
`Build project` / `Create bundle` and before `Run tests and generate reports`:

```yaml
      - name: 'Run agents API-surface guard'
        run: |-
          npm run lint:agents-api-surface
```

This single step both validates the API surface AND generates the report for
the guard test. The `lint_javascript` job does NOT include this step when B2
is the recorded mechanism.

The recorded mechanism in `analysis/api-guard-mechanism.md` section 1
determines which CI wiring applies. P03 reads the recorded mechanism and
modifies `.github/workflows/ci.yml` accordingly.

### Snapshot location (finding 3 — brittleness mitigation)

The snapshot path must be proven to resolve under Vitest at runtime. Two
acceptable strategies (preflight P01 decides and records which):

1. **Vitest import/fixture resolution**: place the snapshot where the test can
   read it via a path relative to `import.meta.url` (proven to resolve in
   Vitest). The test's `beforeAll` asserts the file exists and is readable,
   failing closed if the path does not resolve.
2. **Inline snapshot via Vitest's snapshot mechanism**: use Vitest's
   `toMatchSnapshot()` / inline snapshot so the expected surface lives in the
   test's own snapshot artifact (`.snap`), which Vitest natively resolves.

P03 MUST include a **preflight resolution proof**: the test's `beforeAll`
asserts the snapshot file is readable (strategy 1) OR the snapshot is a native
Vitest snapshot (strategy 2). If strategy 1 is chosen, the test fails with a
clear message if the path does not resolve — this catches the brittleness
before it becomes a silent CI issue.

### Required Code Markers (test files and plan artifacts ONLY — revision 4 finding 9 + revision 5 findings 1, 5)

Every **TEST** file (`.test.ts`, `.spec.ts`) created in this phase MUST include:
```typescript
/**
 * @plan PLAN-20260629-ISSUE2285.P03
 * @requirement REQ-002
 * @pseudocode api-surface-guard.md lines 120-240
 */
```

**Marker policy (revision 4 finding 9 + revision 5 architect findings 1, 5 +
architect review finding 5)**:
`@plan`/`@requirement` markers are RESTRICTED to test files (`.test.ts`,
`.spec.ts`) and plan artifacts (`.md`) only. They are NOT added to:
- executable scripts (`scripts/check-agents-api-surface.mjs`)
- executable ESM helpers (`apiSurfaceParser.mjs`)
- any `.mjs` file
- production source files (no NEW `@plan:PLAN-20260629-ISSUE2285` markers)

The revision 3 finding 21 exception for lint scripts is rescinded. This makes
the marker policy self-consistent: one rule for all executable scripts and
helpers — no markers. Attribution for executable files lives in this adjacent
plan artifact (`.md`).

**Pre-existing marker debt (architect review finding 5):** production source
files across the repo (e.g. `packages/tools/**`, `packages/settings/**`)
already contain `@plan`/`@requirement` markers from prior issues. The policy
prohibits only NEW issue2285 markers — it does NOT imply existing markers must
be removed unless the line they annotate is changed for issue #2285 scope.

## Guard Test Contract (from pseudocode api-surface-guard.md)

**Architect finding (revision 2): the prior revision embedded `npm run build`
inside the Vitest `beforeAll` lifecycle, risking brittle/slow shared-`dist`
side effects. Revision 3 (finding 3): the in-lifecycle build was replaced by
an EXPLICIT standalone script. globalSetup was considered and REJECTED because
globalSetup runs inside the Vitest run lifecycle and the plan forbids builds
there. The chosen wiring is a standalone npm script
(`lint:agents-api-surface`) invoked as a CI/presubmit step; the Vitest test
reads the JSON report it emits.**

The test MUST:
1. NOT shell out to `npm run build` (or `tsc`) from within its
   `beforeAll`/lifecycle. The standalone `lint:agents-api-surface` script
   builds (via the isolated temp tsconfig — B1) and emits a JSON surface
   report. The test READS the JSON report; **if absent, it FAILS CLOSED**
   (revision 5 architect finding 2: consistent fail-closed behavior — the test
   NEVER silently skips. In CI (`CI=true`), it fails with a message instructing
   to run `npm run lint:agents-api-surface` first. Locally (CI not set), it
   fails the same way unless `LLXPRT_API_SURFACE_SKIP=1` is set, which is the
   ONLY permitted skip path for local-only development convenience. This is
   consistent with the report-absent behavior specified for the test file
   above — both describe the same fail-closed contract).
2. Parse the report's exported names. (The recursive export-star resolution
   happens inside the `.mjs` parser, invoked by the script at build time.)
3. P03 characterization: assert the current leaky names ARE in the report
   (GREEN).
4. DENY logic: the deny check is real code, exercised against the report; the
   characterization asserts it would flag each denied name.
5. Snapshot comparison: compare against the expected snapshot; in P03 this
   matches the current leaky surface (GREEN).
6. Type-only deny case: prove the parser resolves type-only re-exports
   through `export *`.

### API Guard Build Constraints (revision 3 — findings 1, 3, 8, 20)

1. **Standalone script, NOT globalSetup (finding 3)**: the guard runs as
   `npm run lint:agents-api-surface` (`scripts/check-agents-api-surface.mjs`).
   It is a CI/presubmit step. It is NOT wired into Vitest `globalSetup`
   (globalSetup runs inside the test lifecycle → forbidden for builds) and NOT
   into a per-test `beforeAll`. The root `package.json` gains the
   `lint:agents-api-surface` script entry.
2. **Isolated temp tsconfig (finding 1 + revision 5 finding 3)**: the script
   builds declarations via a temp tsconfig + direct `tsc -p` into a temp dir,
   NOT via `scripts/build_package.js` (no outDir override) and NOT into shared
   `dist`. **Revision 5 finding 3 (rootDir/TS6059)**: if the source-path
   tsconfig's `paths` map dependency packages to source files OUTSIDE the
   agents `rootDir`, `tsc` may error (TS6059: file not under rootDir). The
   preflight proof (P01 section 7) determines which sub-mechanism works:
   **(B1a)** expand `rootDir` to the workspace root so all dependency source
   files are under rootDir; **(B1b)** set `emitDeclarationOnly: true` and
   `declarationDir` to temp (some TS versions relax rootDir for declaration-
   only emits); **(B2)** fresh shared dist via
   `npm run build --workspace`, recorded in the decision record with the
   side-effect acknowledgement (finding 20) and CI ordering constraint (B2
   must run post-build).
3. **No tracked-file mutation**: the script writes ONLY to the temp dir
   (gitignored/removed on exit) and the JSON report (gitignored). The snapshot
   is READ — updating it is an EXPLICIT developer action producing a
   reviewable diff.
4. **Fresh declaration contract**: the script always runs a fresh build (temp
   or shared) — no reliance on pre-existing stale declarations.
5. **No shared-dist side effects (B1)**: the build targets a temp dir;
   concurrent test runs and tests reading shared `dist/` are unaffected.
6. **tsbuildinfo isolation (finding 20)**: the temp tsconfig overrides
   `tsBuildInfoFile` to a temp path so the shared incremental cache is not
   perturbed. (For B2, the shared `node_modules/.cache/tsbuildinfo/` is
   perturbed — acknowledged.)

## Reachability

This test exercises the REAL agents package build output. It is reachable
through `npm run test --workspace @vybestack/llxprt-code-agents`. It is NOT an
isolated feature — it guards the actual public root surface consumed by CLI,
A2A, and all library consumers.

## Verification Commands

```bash
# The standalone API-surface script builds via the isolated temp tsconfig and
# emits the report. Run it to confirm characterization mode (detects current leak).
# Architect review finding 8: the guard test reads
# node_modules/.cache/agents-api-surface/report.json and FAILS CLOSED when
# absent. Therefore lint:agents-api-surface MUST run immediately before the
# guard test. This ordering requirement applies to EVERY phase that runs the
# guard test (P03, P03a, P05, P05a, P13, P13a).
npm run lint:agents-api-surface
test $? -eq 0 || { echo "FAIL: API-surface script did not pass in characterization mode"; exit 1; }

# Run the guard test — GREEN in characterization mode (reads the JSON report;
# does NOT shell out to a build from within the test lifecycle).
# MUST run immediately after lint:agents-api-surface (report must exist).
npm run test --workspace @vybestack/llxprt-code-agents -- publicSurface.guard
test $? -eq 0 || { echo "FAIL: guard test did not pass in characterization mode (ensure lint:agents-api-surface ran immediately before — finding 8)"; exit 1; }

# Confirm the test does NOT shell out to build (revision 3 — no in-lifecycle build, no globalSetup)
grep -E "execSync|spawnSync|child_process|npm run build|globalSetup" packages/agents/src/api/__tests__/publicSurface.guard.test.ts && { echo "FAIL: guard test shells out to build or wires globalSetup (use the standalone lint:agents-api-surface script instead)"; exit 1; } || echo "OK: no in-lifecycle build"

# Confirm the standalone script exists and the npm wiring is present (revision 3 finding 3/17 — config/script proof, not Vitest-reporter grep)
test -f scripts/check-agents-api-surface.mjs || { echo "FAIL: scripts/check-agents-api-surface.mjs missing"; exit 1; }
node -e "const p=require('./package.json'); if(!(p.scripts&&p.scripts['lint:agents-api-surface'])) { console.error('FAIL: lint:agents-api-surface script not in package.json'); process.exit(1); } console.log('OK: lint:agents-api-surface wired');"

# Revision 4 architect findings 1, 8: verify the guard is wired into the
# ACTUAL GitHub CI workflow — NOT just package.json (which proves local wiring,
# not CI enforcement). The lint_javascript job MUST have a step running
# npm run lint:agents-api-surface, and the test job MUST generate the report
# before running tests.
grep -q "lint:agents-api-surface" .github/workflows/ci.yml || { echo "FAIL: lint:agents-api-surface NOT wired into .github/workflows/ci.yml (architect finding 1)"; exit 1; }
echo "OK: lint:agents-api-surface is in the GitHub CI workflow"

# Revision 4 architect finding 9: verify the executable script is marker-free
# (no @plan/@requirement markers in scripts).
grep -E "@plan:|@requirement:" scripts/check-agents-api-surface.mjs && { echo "FAIL: executable script contains markers (architect finding 9 — scripts must be marker-free)"; exit 1; } || echo "OK: executable script is marker-free"

# Revision 5 architect finding 1: verify the executable .mjs helper is marker-free
# (no @plan/@requirement markers in executable .mjs helpers).
grep -E "@plan:|@requirement:" packages/agents/src/api/__tests__/apiSurfaceParser.mjs && { echo "FAIL: executable .mjs helper contains markers (revision 5 finding 1 — .mjs helpers must be marker-free)"; exit 1; } || echo "OK: .mjs helper is marker-free"

# Revision 4 architect finding 2: verify the report is written to an
# already-gitignored path (node_modules/.cache/...), NOT to a tracked
# location that would dirty the worktree.
grep -q "node_modules/.cache/agents-api-surface" scripts/check-agents-api-surface.mjs || { echo "FAIL: report path is not under node_modules/.cache (architect finding 2 — must be gitignored)"; exit 1; }
# Confirm the OLD unignored path is NOT used.
grep -q "__tests__/.api-surface-report" scripts/check-agents-api-surface.mjs && { echo "FAIL: report path uses the unignored __tests__ location (architect finding 2)"; exit 1; } || echo "OK: report path is gitignored"

# Confirm no mock theater / reverse testing (fail-closed)
grep -r "toHaveBeenCalled" packages/agents/src/api/__tests__/publicSurface.guard.test.ts && { echo "FAIL: mock theater"; exit 1; } || echo "OK"
grep -r "NotYetImplemented" packages/agents/src/api/__tests__/publicSurface.guard.test.ts && { echo "FAIL: reverse testing"; exit 1; } || echo "OK"

# Confirm export-star resolution is present in the .mjs parser (revision 3 finding 2 — not flat regex) — fail-closed
test "$(grep -c 'export \*\|exportStar\|resolveExport\|ts\.' packages/agents/src/api/__tests__/apiSurfaceParser.mjs)" -ge 1 || { echo "FAIL: no export-star resolution in parser"; exit 1; }
```

## Export-star leak proof (finding 2 — worker runs locally and records output)

The characterization test MUST prove the current leak is caught. Record the
output showing the JSON surface report (from
`npm run lint:agents-api-surface`) resolves `AgentClient`,
`CoreToolScheduler`, and concrete `AgenticLoop` through the
`export * from './internals.js'` chain. If the parser does NOT resolve these
names, the export-star resolution is broken — this is a BLOCKING failure; the
parser must be fixed before P03 can complete.

```bash
# Build the report first (fail-closed)
npm run lint:agents-api-surface
test $? -eq 0 || { echo "FAIL: API-surface script"; exit 1; }
# Local proof: the JSON report contains the denied names (fail-closed)
# Revision 4 architect finding 2: report is at node_modules/.cache/...
node -e "
const fs=require('fs');
const report=JSON.parse(fs.readFileSync('node_modules/.cache/agents-api-surface/report.json','utf8'));
const names=new Set(report);
for (const denied of ['AgentClient','CoreToolScheduler','AgenticLoop']) {
  if (!names.has(denied)) { console.error('FAIL: denied name not resolved through export-star: '+denied); process.exit(1); }
}
console.log('OK: denied names resolved through export-star');
"
```

## Deferred Implementation Detection (revision 3 — finding 4: scoped to phase-owned files)

```bash
# Fail-closed — scoped ONLY to files this phase creates/owns (avoids unrelated hits)
DEFERRED="$(grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder|for now)" packages/agents/src/api/__tests__/publicSurface.guard.test.ts packages/agents/src/api/__tests__/apiSurfaceParser.mjs scripts/check-agents-api-surface.mjs || true)"
test -z "$DEFERRED" || { echo "FAIL: deferred language:"; echo "$DEFERRED"; exit 1; }
```

## Success Criteria
- `apiSurfaceParser.mjs` created (plain ESM, revision 3 finding 2) with
  recursive export-star resolution + deny-set + snapshot loader. **Marker-free**
  (revision 5 architect finding 1 — executable `.mjs` helper, no
  `@plan`/`@requirement` markers).
- `publicSurface.guard.test.ts` created in CURRENT-STATE CHARACTERIZATION mode
  (GREEN — reads the JSON report from `lint:agents-api-surface` and proves the
  guard detects the existing export-star leak). **Report-absent behavior is
  fail-closed** (revision 5 architect finding 2 — never silently skips; fails
  in CI, fails locally unless `LLXPRT_API_SURFACE_SKIP=1`).
- `scripts/check-agents-api-surface.mjs` created and wired as the
  `lint:agents-api-surface` npm script (revision 3 finding 3). Marker-free
  (revision 4 finding 9).
- Build mechanism recorded (B1/B1a/B1b isolated temp tsconfig OR B2 fresh
  shared dist — revision 5 finding 3 rootDir fallback) in
  `analysis/api-guard-mechanism.md` section 1 (findings 1, 20).
- Snapshot file created representing the current surface; path resolution
  proven (preflight resolution check in `beforeAll`).
- Export-star leak proof recorded (report resolves denied names through
  `export * from './internals.js'`).
- No mock theater, no reverse testing.
- Tests are GREEN (characterization, not committed failing tests) against the
  current root.

## Failure Recovery

If the parser fails to resolve export-star transitive names (the leak proof
fails), the parser implementation is wrong — do NOT proceed. Fix the parser to
recursively resolve `export *` (or use the TS compiler API) and re-run the leak
proof until GREEN.

This phase does NOT use `git checkout` rollback for failure recovery (see
architect finding 10 — rollback can discard unrelated changes). Instead:
- If the parser is wrong: fix the parser in place and re-run.
- If the snapshot path does not resolve: move the snapshot to the proven
  supported location and re-run.
- Report any blocking issue to the coordinator; do NOT blindly revert
  phase-owned files if unrelated changes exist in the worktree.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P03.md`.


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
