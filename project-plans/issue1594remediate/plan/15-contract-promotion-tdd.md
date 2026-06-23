<!-- @plan:PLAN-20260621-COREAPIREMED.P15 @requirement:REQ-004,REQ-006 -->
# Phase 15: Public Client Contract Promotion — Behavioral TDD

## Phase ID

`PLAN-20260621-COREAPIREMED.P15`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 14a completed (PASS)
- Verification: `test -f project-plans/issue1594remediate/.completed/P14a.md`

## Requirements Implemented (Expanded)

### REQ-004: Promote AgentClientContract to the curated API barrel

**Full Text**: `AgentClientContract` MUST be importable as a TYPE from `@vybestack/llxprt-code-agents`
via the CURATED API barrel `packages/agents/src/api/index.ts` (the boundary #1595 imports from and
the one that survives the eventual #1595 internals trim), so #1595 can type-reference the bound
client without deep-importing `./core/client.js`, `./internals.js`, or core internals. The contract
is core-owned (`@vybestack/llxprt-code-core/core/clientContract.ts:67`) and is re-exported, not
redefined. The concrete `AgentClient` class MUST remain on the `./internals.js` subpath. (The
package root already re-exports both barrels at `index.ts:26-27`, so the contract also resolves from
the root transitively; the plan does NOT promise the root's pre-existing low-level `AgentClient`
class re-export as stable promoted surface — #1595 owns trimming that.)
- **REQ-004.1**: Existing `./internals.js` exports (`AgentClient`, `PostTurnAction`) remain
  unchanged (non-breaking).
- **REQ-004.2**: The contract is exported TYPE-ONLY (`export type`); no runtime value named
  `AgentClientContract` is added to the API barrel.

> H1 RECONCILIATION (reframing from the original H1 wording): the #1595-relevant need is the STABLE,
> type-only `AgentClientContract` on the curated `api/index.ts` barrel — NOT promotion of the concrete
> `AgentClient` class. The class deliberately STAYS on `./internals.js` because power users who need it
> already reach it there (and transitively via the root barrel) today — a non-breaking, already-
> available access path — and promoting an implementation class would needlessly widen the curated API.
> Tests here therefore assert BOTH: the TYPE resolves from the curated root, AND the CLASS still
> resolves only from `./internals.js`. Impl is P16.

### REQ-006 (non-breaking constraint cross-cut)

**Full Text**: No existing export anywhere in the agents public surface may be removed or changed by
this remediation; promotions are additive only.

**Behavior (GIVEN/WHEN/THEN)**:
- GIVEN a consumer module
- WHEN it writes `import type { AgentClientContract } from '@vybestack/llxprt-code-agents'` (resolved
  via the curated API barrel; transitively reachable from the root)
- THEN it compiles AND the type structurally has `getCurrentSequenceModel(): string | null` etc.
- AND `import { AgentClient } from '@vybestack/llxprt-code-agents/internals.js'` STILL compiles
- AND the curated barrel `packages/agents/src/api/index.ts` exposes the type while adding NO runtime
  value named `AgentClientContract` (type-only, REQ-004.2)

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/__tests__/contractPromotion.types.ts`
  > FILE-NAMING (CCF-6, PROVEN): this type-assertion file MUST be named `contractPromotion.types.ts`
  > **without** a `.test`/`.spec` suffix. The phase's RED is a TypeScript compile error observed via
  > `npm run typecheck` (= `tsc --noEmit`), and `packages/agents/tsconfig.json` `exclude` contains
  > `**/*.test.ts` + `**/*.spec.ts` — so a `.test.ts` type assertion would NEVER be compiled and the
  > RED could never be observed. A plain `*.types.ts` under `__tests__/` IS compiled by `tsconfig.json`
  > (`include: src/**/*.ts`; it excludes only `*.test.ts`/`*.spec.ts`/`fixtures`), IS excluded from the
  > shipped build by `tsconfig.build.json` (`exclude: src/**/__tests__/**`), and is NOT executed by
  > vitest (default matcher `*.{test,spec}.*`). Verified by probe: a missing named type import from
  > `@vybestack/llxprt-code-agents` in a compiled `.ts` raises `TS2305: has no exported member` (the
  > `export *` barrel does NOT degrade it to `any`). This file holds ONLY type-level compile assertions.
  - Type-level checks (compile-only — no runtime `it(...)` here; runtime checks live in the
    `nonBreaking.exports.test.ts` file below so vitest has a real GREEN suite):
    - A `satisfies`-style / structural compile assertion that the root-imported `AgentClientContract`
      (`import type { AgentClientContract } from '@vybestack/llxprt-code-agents'`) has the expected
      members (`getCurrentSequenceModel`, `getChat`, `getHistory`, `getHistoryService`, `getUserTier`,
      `dispose`, `startChat`, etc. — enumerate from clientContract.ts:67-118). Use a real type
      assertion (e.g. `type Expect<T extends true> = T;` + `type HasKeys<T, K extends string> = K
      extends keyof T ? true : false;` + `export type _Assert = Expect<HasKeys<AgentClientContract,
      'getCurrentSequenceModel' | 'getChat' | 'getHistory' | 'getUserTier' | 'dispose' |
      'startChat'>>;`) that FAILS to compile while the type is missing from the curated barrel.
    > CRITICAL (PROVEN — P16-GREEN trap): the root `tsconfig.json` sets `noUnusedLocals: true`, and
    > a type alias is NOT exempted by an underscore prefix. A NON-exported `type _Assert = …` raises
    > `TS6196: '_Assert' is declared but never used` — which would survive the P16 promotion (the
    > TS2305 disappears but the TS6196 lingers) and keep `npm run typecheck` RED forever, breaking the
    > P16 GREEN gate. Therefore every assertion alias MUST be `export type _Assert… = …` (the `export`
    > consumes the binding so it is "used"). Likewise `Expect`/`HasKeys` helpers must each be USED by
    > an exported assertion (an unused helper alias trips the same TS6196). Verified by probe: exported
    > assert → typecheck EXIT=0 against a resolvable type; non-exported assert → TS6196 EXIT=2.
  - Markers `@plan:PLAN-20260621-COREAPIREMED.P15`, `@requirement:REQ-004,REQ-006`.

- `packages/agents/src/api/__tests__/nonBreaking.exports.test.ts`
  > This file carries ALL the RUNTIME assertions for P15 (it is vitest-run and must be GREEN now and
  > after P16). It also absorbs the two runtime checks formerly bundled into the contract file:
  > (a) the value `AgentClient` is still exported from `@vybestack/llxprt-code-agents/internals.js`
  > (`expect(typeof AgentClient).toBe('function')`); (b) the curated barrel adds NO runtime value
  > named `AgentClientContract` — import the package-root namespace and assert the runtime key is
  > absent (`expect(Object.prototype.hasOwnProperty.call(ns, 'AgentClientContract')).toBe(false)`),
  > which pins the type-only contract REQ-004.2 both before AND after P16. (The `internals.js` import
  > lives in THIS `*xport*`-named file, not the `*ontract*` file, so it does not trip the 15a
  > deep-import guard which scans only the `*ontract*` glob.)
  - Snapshot the set of runtime export keys of `@vybestack/llxprt-code-agents` and
    `@vybestack/llxprt-code-agents/internals.js`; assert the PRE-EXISTING keys are a subset of the
    post-change keys (no removals). (This same test guards P21.)
  - Markers `@requirement:REQ-006`.

### Constraints

- Type-only test must actually fail to compile if the type is missing — use a real type assertion,
  not a comment.
- No mock theater.

## Verification Commands

```bash
set -e
# NOTE (CCF-6): the type-assertion file is `contractPromotion.types.ts` (NO `.test` suffix) so it is
# visible to `tsc --noEmit` (tsconfig.json excludes `**/*.test.ts`). All RUNTIME assertions live in
# `nonBreaking.exports.test.ts` (vitest-run).
test -f packages/agents/src/api/__tests__/contractPromotion.types.ts || { echo "MISSING contractPromotion type file"; exit 1; }
test -f packages/agents/src/api/__tests__/nonBreaking.exports.test.ts || { echo "MISSING nonBreaking test"; exit 1; }

# The type file must import the contract from the package ROOT specifier (resolved via the curated
# api/index.ts barrel), NOT via a deep core/internals import:
grep -q "from '@vybestack/llxprt-code-agents'" packages/agents/src/api/__tests__/contractPromotion.types.ts || { echo "FAIL: type file must import contract from the package entry, not a deep path"; exit 1; }

# RED-STATE ENFORCEMENT (CRIT-5): this is a TYPE-SURFACE phase, so the expected RED is a TYPE
# ERROR (the contract is not yet on the curated barrel), NOT a runtime behavioral failure. Capture
# typecheck status and REQUIRE it to fail before impl. If typecheck PASSES now, the type already
# exists (or the file is not actually asserting the type) -> FAIL the phase.
set +e
# MIN-1: do NOT pipe into tail — `$?` would capture tail's status and MASK a typecheck failure.
# Redirect to a temp file WITHOUT a pipeline so $? is typecheck's real exit code; tail only the log.
npm run typecheck > /tmp/p15-typecheck.log 2>&1
TC=$?
set -e
tail -30 /tmp/p15-typecheck.log
if [ "$TC" -eq 0 ]; then echo "FAIL (RED expected): typecheck passes, but the contract should not yet be on the curated barrel"; exit 1; fi
# The RED must be attributable to the promotion type file (TS2305 missing exported member), not an
# unrelated breakage:
grep -qiE "AgentClientContract" /tmp/p15-typecheck.log || { echo "FAIL: typecheck RED not attributable to AgentClientContract"; exit 1; }
echo "RED confirmed: typecheck fails because AgentClientContract is not yet re-exported from api/index.ts"

# The runtime non-breaking suite must itself be GREEN now (it guards pre-existing exports):
npx vitest run packages/agents/src/api/__tests__/nonBreaking.exports.test.ts

# Reverse-testing forbidden (scan both files):
if grep -nE "toThrow\('NotYetImplemented'\)|not\.toThrow\(\)" packages/agents/src/api/__tests__/contractPromotion.types.ts packages/agents/src/api/__tests__/nonBreaking.exports.test.ts; then echo "FAIL: reverse test"; exit 1; fi
```

### Semantic Verification Checklist (BLOCKING — any unchecked box BLOCKS progression)

- [ ] Type-import test fails NOW (RED) because the CURATED api barrel lacks the type export — and the
      RED reason is a TYPE error, the legitimate RED form for a type-surface phase (CRIT-5 exception).
- [ ] Test imports the contract from the package entry `@vybestack/llxprt-code-agents` (curated
      barrel boundary), not a deep `./core/...` / `./internals.js` path.
- [ ] internals.js value-export test is present (asserts the class still importable).
- [ ] Type-only assertion present (no runtime `AgentClientContract` value on the barrel — REQ-004.2).
- [ ] Non-breaking export snapshot test present.
- [ ] No reverse testing (no `NotYetImplemented`).

## Success Criteria

- Tests authored; contract-at-root test RED; non-breaking guard present.

## Failure Recovery

- `rm -f packages/agents/src/api/__tests__/contractPromotion.types.ts packages/agents/src/api/__tests__/nonBreaking.exports.test.ts` (both are new, untracked files).

## Deferred Implementation Detection (MANDATORY — scoped)

Scoped to the NEW spec/helper file(s) THIS phase creates (NOT an unscoped `__tests__/` global scan
that would trip on pre-existing #1594 matches). Test files MUST contain no deferred-impl markers and
no reverse/weakened tests.

```bash
set -e
# scoped target file(s): packages/agents/src/api/__tests__/contractPromotion.types.ts, packages/agents/src/api/__tests__/nonBreaking.exports.test.ts
for F in "packages/agents/src/api/__tests__/contractPromotion.types.ts" "packages/agents/src/api/__tests__/nonBreaking.exports.test.ts"; do
  test -f "$F" || continue
  # No deferred-implementation placeholder language in the new test/helper file.
  if grep -nE "(TODO|FIXME|HACK|XXX|TEMPORARY|WIP|placeholder|for now|in a real|coming soon)" "$F"; then
    echo "FAIL: deferred-implementation marker in $F"; exit 1
  fi
  # Reverse-test ban (scoped): no test that asserts the FAILURE/absence as the desired end state.
  if grep -niE "expect\\(.*\\)\\.(not)\\.toBeDefined|toThrow\\(.*NotYetImplemented|should (not )?be implemented|reverse test|negative test \\(expected\\)" "$F"; then
    echo "FAIL: reverse/weakened-test pattern in $F"; exit 1
  fi
  # No test.skip/it.skip/xit/xdescribe smuggling a deferred test past RED.
  if grep -nE "\\b(it|test|describe)\\.skip\\b|\\bxit\\b|\\bxdescribe\\b" "$F"; then
    echo "FAIL: skipped/disabled test in $F (would mask a deferred behavior)"; exit 1
  fi
done
echo "PASS: no deferred-implementation markers / reverse tests in the new spec/helper file(s)."
```

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P15.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P15
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```

