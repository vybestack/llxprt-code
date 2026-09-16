# Issue #3536 — `npm run typecheck` must not depend on prior build output

Branch: `issue3536` (base: `main` @ `8921d849d`)
Plan owner: this effort. Fixes #3536.

## Root cause (verified on this checkout)

The root `typecheck` npm script is a bare fanout:

```
npm run typecheck --workspaces --if-present && tsc --project tsconfig.scripts.json && tsc --project evals/tsconfig.json
```

Workspace `tsc --noEmit` configs resolve most cross-workspace imports at
source through tsconfig `paths`, but three typecheck paths resolve at
generated declarations under `dist` (pinned by
`scripts/tests/issue-2983-declaration-build.test.ts` and the ci.yml build
comment):

- `packages/cli` → `@vybestack/llxprt-code-tools` at `../tools/dist/*`
- `packages/core` → `@vybestack/llxprt-code-mcp` at `../mcp/dist/*`
- `packages/a2a-server` → `@vybestack/llxprt-code-storage` at `../storage/dist/*`

When those declarations are missing or predate current source, the workspace
checks fail (TS2307 / TS6305 / TS2339 on members that exist in source), even
on a clean working tree. CI's `lint_javascript` job already runs
`npm run build:types` before `npm run typecheck`, so only bare root
`npm run typecheck` (the documented verification cycle, the cherrypicking
runbook "quick verify", and the luther.yml QA gate — all of which typecheck
before any build) is order-dependent.

Local reproduction on this branch (logs in `tmp/verify3536/`):

1. `mv packages/tools/dist tmp/verify3536/tools-dist-backup`
2. `cd packages/cli && npx tsc --noEmit -p tsconfig.noemit.json` → exit 2,
   TS2307 "Cannot find module '@vybestack/llxprt-code-tools'" and follow-on
   errors (`cli-noemit-nodist.log`).
3. `npm run build:types` (declaration-only build, issue #2983) regenerates
   `packages/tools/dist/index.d.ts` among all declaration workspaces.
4. Same `tsc --noEmit` → exit 0 (`cli-noemit-after-buildtypes.log`).

## Accepted behavior

AC1 — Self-sufficient root typecheck. On a clean tree whose generated
workspace declarations are missing or stale, `npm run typecheck` at the
repository root regenerates workspace declarations (via the existing
`npm run build:types` declaration-only path) BEFORE the workspace
`tsc --noEmit` fanout and the `tsconfig.scripts.json` / `evals` project
checks, and passes.

AC2 — Ordering invariant, pinned. The root `typecheck` script's first
fail-fast segment is `npm run build:types`; the remaining segments are
unchanged from today. Chaining stays `&&` only (no `;`, no `||`), so a
declaration-generation failure fails the typecheck gate rather than falling
through to stale-state checks.

AC3 — No behavior change elsewhere. Per-workspace `typecheck` scripts,
`preflight-ci.ts` step list, CI workflows, `build`, and `build:types` itself
are untouched. Callers that already build first (preflight, CI lint job) see
only an incremental no-op declaration rebuild.

AC4 — Runbook accuracy. The cherrypicking runbook troubleshooting note that
prescribes a manual `npm run build --workspace @vybestack/llxprt-code-core`
to clear stale-type typecheck failures is updated: `npm run typecheck` now
regenerates declarations itself; the manual step is no longer the remedy.

AC5: Declaration-only builds run with `--force` and skip the clean: they
refresh declarations in place without removing compiled JavaScript from a
prior full build and re-emit from scratch when dist is absent. TS 5.8
`--build` otherwise silently skips emission when a surviving `.tsbuildinfo`
claims the outputs exist. Evidence: the two real build_package pipeline tests
verify that a full build followed by a declaration-only build preserves
JavaScript, and that deleting dist before the declaration-only build still
regenerates declarations.

## Inputs and boundary cases

- Missing `dist` entirely (fresh checkout before any build) → covered:
  `build:types` emits declarations for all declaration workspaces.
- Present-but-stale `dist` (the issue's reproduction) → covered: tsc
  `--build --emitDeclarationOnly` re-emits from current source.
- Declaration generation fails (broken source) → typecheck fails fast at the
  first segment; no partial verification result.
- Workspace-scoped `npm run typecheck -w <ws>` → out of scope, unchanged
  (same contract as today).
- Type-aware lint (`npm run lint` on stale dist) → related but separate
  surface; explicitly out of scope for this issue.

**Known boundary:** If a source file is deleted, a no-clean declaration
build may leave its orphaned `.d.ts` until the next full build, which cleans.
CI's lint job builds declarations from a dist-less runner, so it is unaffected.

**Known boundary:** On a checkout that has never been built, `npm run
typecheck` leaves declaration-only output under `packages/*/dist` with no
compiled JavaScript, so `npm run test` fails on dist-mapped imports until a
full `npm run build` runs (documented in the cherrypicking runbook).

## Tests

New `scripts/tests/issue-3536-typecheck-declaration-order.bun.test.ts`
(Bun test; precedent: `test-bun-all-script.bun.test.ts`,
`issue-2983-declaration-build.test.ts` "build scripts" block). It reads the
real root `package.json` and pins:

1. `scripts.typecheck` exists and chains only with `&&` (no `||`, no `;`).
2. First trimmed segment is exactly `npm run build:types`.
3. `build:types` precedes the `--workspaces` fanout, which precedes
   `tsc --project tsconfig.scripts.json`, which precedes
   `tsc --project evals/tsconfig.json`.
4. `scripts['build:types']` remains the declaration-only variant (contains
   `LLXPRT_EMIT_DECLARATIONS_ONLY=1 npm run build`), so the prepend cannot
   silently drift onto the full build.

Behavioral evidence (manual, recorded in PR body, not a unit test): the
reproduction sequence above — remove `packages/tools/dist`, run root
`npm run typecheck`, observe pass; run `git status` (tree stays clean).

## Files to modify

- `package.json` — prepend `npm run build:types && ` to `scripts.typecheck`.
- `scripts/tests/issue-3536-typecheck-declaration-order.bun.test.ts` — new.
- `dev-docs/cherrypicking-runbook.md` — troubleshooting note (AC4).
- `scripts/build_package.ts`: declaration-only mode gains `--force` and skips the destructive clean.
- `scripts/tests/issue-2983-declaration-build.test.ts`: expectation update for the added flag.

## Out of scope (explicit)

- Repointing the cli→tools / core→mcp / a2a→storage tsconfig mappings at
  source (the dist mappings are deliberate, issue #2983).
- Making `npm run lint` self-sufficient (same class, different gate).
- preflight-ci.ts changes (its ordering already builds first) and any CI
  workflow edits (lint job already runs build:types before typecheck).
- Any change to `build`, `build:types`, or workspace build scripts.

## Verification

Full cycle per the issue workflow: `npm run test`, `npm run lint`,
`npm run typecheck` (now self-generating), `npm run format`, `npm run
build`, smoke `bun scripts/start.ts --profile-load zai-glm-flash "write me a
haiku and nothing else"`. Focused test first:
`bun test scripts/tests/issue-3536-typecheck-declaration-order.bun.test.ts`.

OCR: disabled per Andrew's standing instruction (not run for this effort).
