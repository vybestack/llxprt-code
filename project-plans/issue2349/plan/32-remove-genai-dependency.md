# Phase 32: Remove @google/genai from packages/agents/package.json — LAST

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P32`

## Prerequisites
- Required: Phase 31 completed; gates green; ZERO prod importers (P27) and neutral tests with LOCAL structural fixtures (P28).
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P31" packages/agents/src scripts`
- Expected files from previous phase: `scripts/agents-neutral-gate.ts` (full fail-mode a-h) + `scripts/agents-neutral-test-gate.ts` wired into CI + root `package.json` (`lint:agents-neutral-gate`, `lint:agents-neutral-test-gate`); populated `dev-docs/agents-neutral-gate-allowlist.md`.
- Preflight verification: Phase 0.5 completed.

## Requirements Implemented (Expanded)

### REQ-013.1: Dependency FULLY removed; baseline → 0
**Full Text**: `@google/genai` is removed from `packages/agents/package.json` ENTIRELY — from BOTH `dependencies` AND `devDependencies`. No `@google/genai` entry may remain under any dependency key. The `dev-docs/genai-import-baseline.md` agents-owner count reaches 0.
**Behavior**:
- GIVEN: zero `@google/genai` imports under `packages/agents/src` (production AND tests)
- WHEN: the dependency is removed from every dependency key
- THEN: typecheck/build/agents-tests stay green.
**Why This Matters**: the issue scope requires `packages/agents` to be OFF `@google/genai` outright; a residual devDependency would leave the package coupled to the SDK and is explicitly disallowed (no escape hatch).

### REQ-013.2: Allow-listed characterization tests use local structural fixtures (no SDK dependency)
**Full Text**: Any allow-listed converter/boundary characterization test that needs a Gemini-shaped fixture expresses it as a plain LOCAL structural object typed locally / `unknown` (e.g. `const fixture = { candidates: [{ content: { role: 'model', parts: [{ text: 'x' }] } }] } as const`), NOT via an `@google/genai` import. Tests that genuinely require the SDK's own types are relocated to the Gemini provider/conversion package where the SDK is an allowed dependency.
**Behavior**:
- GIVEN: the §8.1 characterization allow-list
- WHEN: the tests run
- THEN: none of them import `@google/genai`, so removing the dependency does not break them.
**Why This Matters**: removes the only rationale that could justify a residual devDependency, so the escape hatch is unnecessary AND forbidden.

## Implementation Tasks
- Confirm zero imports under `packages/agents/src` (prod AND tests): `grep -rl "@google/genai" packages/agents/src` ⇒ EMPTY. If any allow-listed characterization test still imports the SDK, convert its fixture to a LOCAL structural object (typed locally/`unknown`) per REQ-013.2, or relocate the SDK-typed test to the Gemini provider/conversion package. Do NOT keep the dependency to satisfy a test.
- Remove `@google/genai` from `packages/agents/package.json` — check `dependencies`, `devDependencies`, `peerDependencies`, and `optionalDependencies`; NONE may retain it.
- Update `dev-docs/genai-import-baseline.md` agents owner → 0.
- Markers `@plan:PLAN-20260707-AGENTNEUTRAL.P32`, `@requirement:REQ-013.1/.2`.

## Verification Commands
```bash
if grep -rl "@google/genai" packages/agents/src; then echo "FAIL: @google/genai still imported anywhere in agents (prod OR tests)"; exit 1; fi
if grep -n "@google/genai" packages/agents/package.json; then echo "FAIL: @google/genai still declared in packages/agents/package.json"; exit 1; fi
npm run typecheck && npm run build && npm test -- packages/agents   # green
npx tsx scripts/agents-neutral-gate.ts && npx tsx scripts/agents-neutral-test-gate.ts   # both exit 0
```

## Success Criteria
- `@google/genai` absent from EVERY dependency key in `packages/agents/package.json`; zero imports (prod + tests); baseline 0; monorepo green; both gates green.

## Failure Recovery
If this phase fails (a test/prod file still imports the SDK, or removal breaks build):
1. Re-run `grep -rl "@google/genai" packages/agents/src` and neutralize each remaining importer (convert fixture to local structural object or relocate to the provider package). Do NOT re-add the dependency.
2. `git checkout -- packages/agents/package.json` only to retry cleanly; the end state MUST have no `@google/genai` entry.
3. Cannot proceed to Phase 33 until the dependency is fully removed and the tree is green.

## Phase Completion Marker
`project-plans/issue2349/.completed/P32.md`.
