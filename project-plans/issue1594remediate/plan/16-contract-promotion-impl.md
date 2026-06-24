<!-- @plan:PLAN-20260621-COREAPIREMED.P16 @requirement:REQ-004,REQ-006 -->
# Phase 16: Public Client Contract Promotion — Implementation

## Phase ID

`PLAN-20260621-COREAPIREMED.P16`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 15a completed (PASS)
- Verification: `test -f project-plans/issue1594remediate/.completed/P15a.md`
- Pseudocode: `analysis/pseudocode/client-contract-promotion.md` (lines 10–31)

## Requirements Implemented (Expanded)

### REQ-004 / REQ-004.1 / REQ-004.2 / REQ-006

Add a type-only re-export of the core-owned `AgentClientContract` to the CURATED API barrel
`packages/agents/src/api/index.ts` (the boundary #1595 imports from). Leave `internals.ts:38` and the
root `index.ts:26-27` untouched (the root already re-exports both barrels, so the contract reaches
the root transitively). Make all Phase 15 tests pass. See Phase 15 GIVEN/WHEN/THEN.

> H1 RECONCILIATION (why TYPE-only on the curated barrel, CLASS stays on internals): The original H1
> wording implied "promote the client surface." This plan REFRAMES that precisely: the #1595-relevant
> need is a STABLE, type-only `AgentClientContract` on the curated `api/index.ts` so the CLI (and other
> consumers) can TYPE against the client without reaching into internals. The concrete `AgentClient`
> CLASS intentionally STAYS on `./internals.js` (internals.ts:38) — promoting a concrete class would
> (a) widen the curated public API with implementation, and (b) be unnecessary, since power users who
> need the class already reach it via `./internals.js` (and transitively via the root barrel) today —
> a non-breaking, already-available access path. So: stable TYPE (`AgentClientContract`) → curated
> `api/index.ts` (the #1595 need); concrete CLASS (`AgentClient`) → unchanged on `./internals.js`
> (non-breaking power-user access). This is additive and breaks nothing (REQ-006).

## Implementation Tasks

### Files to Modify

- `packages/agents/src/api/index.ts`  (the CURATED API barrel — NOT the root)
  - Per pseudocode lines 10–15, ADD:
    ```
    export type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
    ```
    (`AgentClientContract` is core-owned at `packages/core/src/core/clientContract.ts:67`; this is the
    SAME module specifier agents already imports at `packages/agents/src/core/agenticLoop/types.ts:27`.
    Re-export only — do NOT redefine the interface in agents.)
  - Do NOT add the concrete `AgentClient` class to this barrel.
  - Do NOT add a runtime value named `AgentClientContract` (type-only, erasable — REQ-004.2).
  - Markers: `@plan:PLAN-20260621-COREAPIREMED.P16`, `@requirement:REQ-004`,
    `@pseudocode lines 10-15`.

- `packages/agents/src/internals.ts`
  - CONFIRM (do not change) line 38: `export { AgentClient, PostTurnAction } from './core/client.js';`
  - No edit required; verification asserts it remains.

- `packages/agents/src/index.ts`  (the package ROOT)
  - CONFIRM (do not change) lines 26-27: `export * from './internals.js';` and
    `export * from './api/index.js';` — the promoted contract reaches the root transitively. No edit.

### Constraints

- Type-only export (`export type`), erasable, no runtime value.
- Additive only; remove nothing.
- Do NOT modify Phase 15 tests.

## Verification Commands

```bash
set -e
# CCF-6: the contract assertions live in `contractPromotion.types.ts` (NO `.test` suffix) and are
# compile-only — they are validated by `npm run typecheck`, NOT by vitest. The phase's GREEN is
# typecheck EXIT=0 (the type now resolves through the curated barrel). Only the runtime
# `nonBreaking.exports.test.ts` is executed under vitest.
npx vitest run packages/agents/src/api/__tests__/nonBreaking.exports.test.ts
# Capture typecheck WITHOUT a pipeline so $? is tsc's real exit code (MIN-1):
set +e
npm run typecheck > /tmp/p16-typecheck.log 2>&1
TC=$?
set -e
tail -30 /tmp/p16-typecheck.log
if [ "$TC" -ne 0 ]; then echo "FAIL (GREEN expected): typecheck still failing after promotion"; exit 1; fi
# GREEN attribution: the previously-RED contract type file must no longer raise the missing-member error:
if grep -qiE "AgentClientContract.*has no exported member|has no exported member.*AgentClientContract" /tmp/p16-typecheck.log; then echo "FAIL: contract still unresolved after promotion"; exit 1; fi
# Contract promoted (type-only) on the CURATED API barrel:
grep -q "export type { AgentClientContract }" packages/agents/src/api/index.ts || { echo "FAIL: missing type export on api barrel"; exit 1; }
# Re-export (not redefine): must use the core clientContract specifier:
grep -q "from '@vybestack/llxprt-code-core/core/clientContract.js'" packages/agents/src/api/index.ts || { echo "FAIL: not re-exporting core-owned contract"; exit 1; }
# No concrete class added to the API barrel (CRIT-4: must exit non-zero on violation):
if grep -nE "export[^;]*\bAgentClient\b[^C]" packages/agents/src/api/index.ts; then echo "FAIL: AgentClient class leaked to api barrel"; exit 1; fi
# No runtime value named AgentClientContract (type-only — REQ-004.2):
if grep -nE "export (const|let|var|function|class) AgentClientContract\b" packages/agents/src/api/index.ts; then echo "FAIL: AgentClientContract exported as runtime value"; exit 1; fi
# internals.js export unchanged:
grep -q "export { AgentClient, PostTurnAction } from './core/client.js'" packages/agents/src/internals.ts || { echo "FAIL: internals export changed"; exit 1; }
# Root unchanged (still re-exports both barrels):
grep -q "export \* from './api/index.js'" packages/agents/src/index.ts || { echo "FAIL: root no longer re-exports api barrel"; exit 1; }
grep -q "@pseudocode lines 10-15" packages/agents/src/api/index.ts || { echo "FAIL: missing @pseudocode marker"; exit 1; }
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Scope to CHANGED lines on the api barrel only (MIN-3):
if git diff HEAD -- packages/agents/src/api/index.ts | grep -E "^\+" | grep -vE "^\+\+\+" | grep -nE "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP)"; then echo "FAIL: deferred-impl marker in changed lines"; exit 1; fi
```

### Semantic Verification Checklist (BLOCKING — any unchecked box BLOCKS progression)

- [ ] `import type { AgentClientContract } from '@vybestack/llxprt-code-agents'` compiles (resolves
      via the curated API barrel; also via the root transitively).
- [ ] Contract added to `api/index.ts` (curated barrel), NOT to the root `index.ts`.
- [ ] Concrete class NOT on the api barrel; still on internals.js; root unchanged.
- [ ] Type-only (no runtime `AgentClientContract` value).
- [ ] Non-breaking export snapshot passes.
- [ ] Pseudocode cited; typecheck clean.

## Success Criteria

- Contract-promotion tests green; non-breaking guard green; typecheck clean.

## Failure Recovery

- `git checkout -- packages/agents/src/api/index.ts`; re-add the type-only re-export on the barrel.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P16.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P16
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```
