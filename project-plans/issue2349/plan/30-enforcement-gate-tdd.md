# Phase 30: Enforcement gate — TDD

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P30`

## Prerequisites
- Required: Phase 29 completed.
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P29" scripts dev-docs`
- Expected files from previous phase: `scripts/agents-neutral-gate.ts` + `scripts/agents-neutral-test-gate.ts` (check signatures/skeleton) + `dev-docs/agents-neutral-gate-allowlist.md` (artifact skeleton).
- Preflight verification: Phase 0.5 completed.
- Pseudocode: `analysis/pseudocode/enforcement-gate.md` — TDD-ONLY phase: writes NO production gate code and implements NO pseudocode lines. It authors the RED fixture-repo gate tests that the P31 impl (which carries the concrete `@pseudocode lines 10-59` citations from this file) must satisfy. Read here as the behavior/fixture spec, not a line map to implement.

## Requirements Implemented (Expanded)

### REQ-012.1: Parser-based core gate
**Full Text**: `scripts/agents-neutral-gate.ts` is an AST/parser-based check over `packages/agents/src` production files detecting §8 checks (a)-(h): raw `@google/genai` imports; banned Google/`Contract*` symbol imports/aliases; round-trip symbols; enum re-declarations; structural `{candidates}`/`{role,parts}` literals + `.parts` mutators; `toGeminiContent(s)` calls + `GeminiContent*` barrel imports; and Gemini usage keys outside boundary modules — with a central versioned allow-list as the single authoritative exemption mechanism.
**Behavior**:
- GIVEN: a fixture containing any (a)-(h) vector
- WHEN: the gate runs
- THEN: it reports a hit and exits non-zero; GIVEN a clean fixture; THEN zero hits, exit 0.
**Why This Matters**: this is the anti-#2424 detector; it must key on STRUCTURE (not just raw imports) so an aliased/structural bypass is caught.

### REQ-012.2: Central allow-list artifact
**Full Text**: `dev-docs/agents-neutral-gate-allowlist.md` records, per exemption: exact file, permitted AST-context pattern, and a written justification. Inline comments grant NOTHING (OQ-17).
**Behavior**:
- GIVEN: a hit whose file+AST-context matches an allow-list entry
- THEN: it is exempt; GIVEN the same code with only an inline `// gate-exempt` comment and NO allow-list entry; THEN it still fails.
**Why This Matters**: a single versioned exemption surface prevents silent per-line exemptions from re-opening the #2424 hole.

### REQ-012.3: Test gate
**Full Text**: `scripts/agents-neutral-test-gate.ts` bans `GenerateContentResponse`/`{candidates}` fixtures in agents test files except the named characterization allow-list (§8.1).
**Behavior**:
- GIVEN: a `{candidates}` fixture in a normal agents test
- THEN: FAIL; GIVEN the same in an allow-listed characterization test; THEN PASS.
**Why This Matters**: without a test gate, a reintroduced synthetic response could hide behind a "characterization" test.

The gate must catch the #2424 vectors AND spare false-positives.

## Implementation Tasks (test-writing; behavioral; RED first — the gate is a real program with real fixtures)

### Files to Create
- `scripts/__tests__/agentsNeutralGate.test.ts` — `@plan:PLAN-20260707-AGENTNEUTRAL.P30`, `@requirement:REQ-012.1`
- `scripts/__tests__/agentsNeutralTestGate.test.ts` — `@requirement:REQ-012.3`

### Fixtures + assertions (use small in-memory/temp TS fixtures)
> **Reuse the P02 fixtures (DRY):** the six `scripts/__tests__/fixtures/{clean-neutral,raw-genai-import,banned-symbol,contract-alias,finishreason-enum,safe-neutral-names}.ts` files created in P02 for the `--enforce-imports` proof ALREADY cover the checkA/B/C/E vectors + the clean baseline + the checkB provenance false-positive guard (safe-neutral-names); this phase REUSES them (does not duplicate) and ADDS the remaining fixtures below (checkF `{candidates}`/`{role,parts}`/`.parts`-mutator, checkG `toGeminiContents` call + `GeminiContent*` barrel, checkH usage keys, the hookWireAdapter named-vs-generic distinction, the NAMED `scripts/__tests__/fixtures/reintroduced-blocking-compat.ts` `beforeModelBlockingCompat` reintroduction case (consumed mechanically by P13's Major-6 verification), and the false-positive guards). Extend the fixtures directory; do not fork a second copy of the shared vectors.
- **Detects (must FAIL the gate):**
  - raw `import { Content } from '@google/genai'` (check a/b).
  - a banned §1.3 symbol (e.g. `GenerateContentResponse`) imported from a BANNED MODULE that is not the raw
    specifier — `core/clientContract` or `llm-types/geminiContent` (or a resolver-proven re-export of a banned
    binding) — checkB MUST hit by PROVENANCE (Major 4).
  - `import { ContractContent } from '.../clientContract'` (check c).
  - `enum FinishReason { STOP='STOP' }` re-declaration (check e).
  - `{ candidates:[{ content:{ role:'model', parts:[] } }] }` literal (check f1).
  - `x as GenerateContentResponse` (check f2).
  - `{ role:'user', parts:[...] }` literal (check f3).
  - `applyTemplateToInitialMessages<T extends {parts?}>` `.parts` mutation with NO import (check f5 — the #2424 structural case).
  - `ContentConverters.toGeminiContents(x)` call (check g).
  - a GENERIC `candidates?.[0]?.content?.parts` read in `hookWireAdapter.ts` OUTSIDE the named external-wire mapping functions (Major 3 — the file-level exemption must NOT be abusable: a wire read outside the allow-listed named functions still FAILS even though the file has a `hookWireAdapter.ts` AST-context entry).
  - a REINTRODUCED `GenerateContentResponse`-shaped restriction-stamping helper (the `beforeModelBlockingCompat` shape) after the compat allow-list entry is removed (Major 6 — once `beforeModelBlockingCompat.ts` is deleted in P13 and its allow-list entry removed, a new helper of the same `GenerateContentResponse` shape MUST FAIL; the freed allow-list slot cannot be reused to smuggle a new Google-shaped helper). **This is a NAMED fixture file `scripts/__tests__/fixtures/reintroduced-blocking-compat.ts`** (a `GenerateContentResponse`-shaped restriction-stamping helper) so P13's verification can RUN it against the real gate via `--files` AFTER deleting the compat module (P13 Major-6 mechanical tie); the gate MUST flag it (exit non-zero) with NO compat allow-list entry present. The P30 test also asserts the gate flags it.
  - `{ promptTokenCount: n }` in a core-loop file (check h).
  - **(Major 4 round 8 — AST-context usage-key boundary) a Gemini-usage-key object literal in `eventAdapter.ts` OUTSIDE the `usageStatsToPublicUsageMetadata` function body** — checkH MUST fire even though `eventAdapter.ts` hosts the allow-listed mapper (the exemption is the mapper FUNCTION BODY, not the whole file). Author this as a fixture proving `--check-usage-key-boundary` exits non-zero on a usage-key node in `api/` outside the mapper. Also assert the SAME usage key INSIDE the `usageStatsToPublicUsageMetadata` body PASSES (the mapper body is the sole eventAdapter exemption).
- **Spares (must PASS the gate — false-positive guards):**
  - `private candidates: CompressionLoadBalancerCandidate[]` (domain candidates).
  - `const candidates: PublicProfileCandidate[]` (profilesControl).
  - neutral names `ContentBlock`/`ToolDeclaration`/`JsonSchema`/`ContentMetadata`/`.blocks`.
  - **checkB provenance guard (Major 4):** the banned NAMES `Content`/`Tool`/`Schema`/`Type` imported from a
    SAFE, non-banned module (e.g. a local neutral domain module) — checkB MUST SPARE them because they are
    bound to a safe module (provenance), NOT `@google/genai`/`clientContract`/`geminiContent`. (Reuses the P02
    `safe-neutral-names.ts` fixture.)
  - the allow-listed hook-wire `toGeminiContents` adapter WHEN its AST context matches (streamRequestHelpers G3) AND an allow-list entry exists — but NOT `streamRequestHelpers.ts:281` telemetry in the same file.
  - the `hookWireAdapter.ts` wire read (`candidates?.[0]?.content?.parts`) INSIDE a named external-wire mapping function (`afterModelModifiedToChunk`/`afterModelBlockingToModelOutput`/`beforeModelBlockingToModelOutput`/`afterModelModifiedToModelOutput`/`beforeModelRequestToWire`/`wireToNeutralRequest`) WHEN the AST-context allow-list entry matches — spared (Major 3).
  - Gemini usage keys that are MEMBERS of the DECLARED `UsageMetadataValue` type in `api/event-types.ts`/`api/event-schema.ts` (declared-type members — AST-context spared, NOT the whole file).
  - Gemini usage keys INSIDE the `usageStatsToPublicUsageMetadata` function body in `eventAdapter.ts` (the sole eventAdapter exemption — AST-context enclosing-function match, Major 4 round 8).
- **Test gate:** `{candidates}` fixture in a normal test → FAIL; same in `boundaryRecovery.test.ts` (allow-listed) → PASS.
- **PROPERTY (detection — Minor 3):** for randomized BANNED structural forms the gate DETECTS them (exits non-zero / reports a hit). At least these generators:
  - randomized `{ role: 'user'|'model', parts: [...] }` wrappers (randomized part arrays) — check f3 MUST hit.
  - randomized banned import aliases (`import { X as Y } from '@google/genai'` and `import { ContractContent as Z } from '.../clientContract'` with randomized alias names) — checks b/c MUST hit.
  - randomized Google usage keys (`promptTokenCount`/`candidatesTokenCount`/`totalTokenCount`) in a randomized NON-boundary core-loop file — check h MUST hit.
- **PROPERTY (false-positive sparing — Minor 3):** for randomized DOMAIN `*Candidate[]` array declarations (randomized domain type names ending in `Candidate`, e.g. `Foo Candidate[]`/`BarCandidate[]`) the gate SPARES them (zero hits) — check f EXCLUDE guard.
- **PROPERTY (checkB provenance sparing — Major 4):** for randomized imports of the banned NAMES (`Content`/`Tool`/`Schema`/`Type`) from randomized SAFE (non-banned) module specifiers, the gate SPARES them (zero checkB hits); the SAME banned names imported from a banned module (`@google/genai`/`clientContract`/`geminiContent`) MUST hit. This pins checkB to import provenance, not the bare name.
- **PROPERTY (clean baseline):** for ANY file with zero banned patterns, the gate returns no hits. (This clean-only property is NECESSARY but NOT SUFFICIENT — it MUST be paired with the detection + sparing generators above so the ratio is not inflated by clean-only inputs.)
- **Mutation requirement (Minor 3):** mutants that disable `checkF`/`checkG`/`checkH` (e.g. force them to `return []`) MUST be KILLED by these property + example tests (verified by the P31 mutation run over the gate script).

## Forbidden
- NO mock theater; run the REAL gate against REAL fixture files.

## Verification Commands
```bash
npm test -- scripts/__tests__/agentsNeutralGate.test.ts scripts/__tests__/agentsNeutralTestGate.test.ts   # exist, FAIL naturally against stub

# Property ratio computed over BOTH test files THIS phase creates (C4), aggregate ≥30%, via prop_ratio:
prop_ratio \
  scripts/__tests__/agentsNeutralGate.test.ts \
  scripts/__tests__/agentsNeutralTestGate.test.ts
```

## Success Criteria
- Gate tests exist and FAIL NATURALLY against the P29 stub (real gate run over real fixtures, not mock theater). NOTE: the deferred checks (`checkD`/`checkG-barrel`/`checkH`) are STUBS at P29, so the fixtures targeting them fail naturally BECAUSE the stub returns no hit; the P02-real checks (`checkA/B/C/E`/`checkF`/`checkG-call`) already detect and their fixtures assert the real hit.
- Fixtures cover ALL #2424 vectors (raw import, `Contract*` alias, enum re-declaration, `{candidates}`, `x as GenerateContentResponse`, `{role,parts}`, raw-import-free `.parts` mutator, `toGeminiContents` call, Gemini usage key in a core-loop file) AND the false-positive guards (domain `candidates`, neutral names, boundary modules, AST-context distinguishing G3 from telemetry in the same file, AND the `hookWireAdapter.ts` named-function-vs-generic-read distinction — Major 3).
- Test-gate fixtures cover normal-test FAIL + allow-listed-test PASS; ≥30% property-based INCLUDING the detection + false-positive-sparing generators (Minor 3), not clean-only; mutants disabling `checkF`/`checkG`/`checkH` are killed.

## Failure Recovery
1. If a test passes against the stub: it is not exercising the real detection — rewrite it to run the actual gate over a real fixture file and assert the hit/no-hit.
2. If a fixture is missing a #2424 vector or a false-positive guard: add it — the gate's whole purpose is to catch both name AND structural forms without flagging domain `candidates`.
3. `git checkout --` the test files and re-author. Cannot proceed to Phase 31 until the gate tests fail naturally and cover every vector + guard.

## Phase Completion Marker
`project-plans/issue2349/.completed/P30.md`.
