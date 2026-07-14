# Phase 31: Enforcement gate — IMPL (+ wire CI as npm scripts)

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P31`

## Prerequisites
- Required: Phase 30 completed (gate tests failing).
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P30" scripts/__tests__`
- Expected files from previous phase: gate fixture-repo tests (known #2424 vectors detected, allow-listed exempt, false-positives spared) — currently failing against the skeleton.
- Required: Phases 02 + 29 completed — the gate script skeleton, `checkF` structural matchers, the working `--count` mode, and the allow-list/baseline artifacts already exist (P02) and the remaining check signatures + test-gate skeleton exist (P29). This phase EXTENDS them with the full fail-mode bodies; it does NOT recreate the script (Major 5).
- Preflight verification: Phase 0.5 completed.
- Pseudocode: `analysis/pseudocode/enforcement-gate.md` — follow line numbers EXACTLY.

## Requirements Implemented (Expanded)

### REQ-012.1: Parser-based core gate
**Full Text**: `scripts/agents-neutral-gate.ts` is an AST/parser-based check over `packages/agents/src` production files detecting §8 checks (a)-(h): (a) raw `@google/genai` imports; (b) banned Google symbol imports/aliases BOUND TO A BANNED MODULE (`@google/genai`/`core/clientContract`/`llm-types/geminiContent` or a resolver-proven re-export of a banned binding) — NOT bare banned NAMES from safe modules (provenance, not name; Major 4); (c) `Contract*` payload-type imports/aliases from `clientContract`; (d) round-trip symbols (`convertIContentToResponse`/`streamChunkWrapper`/`providerStopReason`); (e) enum re-declarations (`FinishReason`/`Type`); (f) structural `{candidates}`/`{role,parts}` literals + generic `.parts` mutators (incl. raw-import-free); (g) `toGeminiContent(s)` calls + `GeminiContent*` barrel imports; (h) Gemini usage keys outside boundary modules — with a central versioned allow-list as the single authoritative exemption mechanism.
**Behavior**:
- **GIVEN:** the neutralized agents tree (only allow-listed bounded exceptions remain);
- **WHEN:** the gate runs in default (no-flag) fail-mode;
- **THEN:** it exits 0 (only allow-listed hits present).
- **GIVEN:** a re-introduced synthetic `{candidates}` response, a `Contract*` alias, or a raw-import-free `.parts` mutator;
- **WHEN:** the gate runs;
- **THEN:** it exits non-zero, naming the offending file + AST context.
**Why This Matters**: this is the anti-#2424 detector; it must key on STRUCTURE, not provenance.

### REQ-012.2: Central allow-list artifact
**Full Text**: `dev-docs/agents-neutral-gate-allowlist.md` records per exemption: exact file, permitted AST-context pattern, written justification. Inline comments grant NOTHING (OQ-17 DECIDED).
**Behavior**:
- **GIVEN:** a structural hit whose file+AST-context matches an allow-list entry;
- **WHEN:** the gate runs;
- **THEN:** the hit is EXEMPT.
- **GIVEN:** the SAME structural hit carrying only an inline `// gate-exempt` comment and NO allow-list entry;
- **WHEN:** the gate runs;
- **THEN:** the gate STILL fails (inline comments grant nothing).
**Why This Matters**: a central versioned list is auditable; inline comments are the exact bypass #2424 could have used.

### REQ-012.3: Test gate
**Full Text**: `scripts/agents-neutral-test-gate.ts` bans `GenerateContentResponse`/`{candidates}` fixtures in agents test files except the named characterization allow-list (§8.1).
**Behavior**:
- **GIVEN:** a normal agents test file with a `{candidates}` fixture (not on the characterization allow-list);
- **WHEN:** the test gate runs;
- **THEN:** it FAILS.
- **GIVEN:** the same fixture in an allow-listed characterization test file;
- **WHEN:** the test gate runs;
- **THEN:** it PASSES.
**Why This Matters**: keeps the migrated test suite from silently re-introducing Google fixtures.

## Implementation Tasks (make ALL P30 tests pass — EXTEND the P02/P29 skeleton)
- `scripts/agents-neutral-gate.ts`:
  - The cheap #2424 vectors **(a)(b)(c)(e)** — `checkA_rawGenaiImports`, `checkB_bannedSymbols`, `checkC_contractAliases`, `checkE_enumRedeclarations` — ALREADY have REAL fail-mode bodies from **P02** (Major 6), wired behind `--enforce-imports`. This phase does NOT re-implement them; it FLIPS `--enforce-imports` into the DEFAULT (no-flag) run (now valid because P27 reached zero production importers) and confirms they respect the central allow-list. (Do not regress or duplicate them.) **checkB stays PROVENANCE-based (Major 4):** it flags a banned §1.3 symbol ONLY when its import specifier resolves to a banned module (`@google/genai`/`core/clientContract`/`llm-types/geminiContent` or a resolver-proven re-export of a banned binding) — it MUST spare the same-named neutral/domain identifiers (`Content`/`Tool`/`Schema`/`Type`) imported from safe modules (proven by the `safe-neutral-names.ts` false-positive fixture). Do NOT broaden checkB to bare-name matching.
  - Implement the remaining EXPENSIVE fail-mode checks `checkD` (round-trip symbols `convertIContentToResponse`/`streamChunkWrapper`/`providerStopReason`), `checkG-barrel` (`GeminiContent*` barrel imports), and `checkH` (Gemini usage keys outside boundary modules), plus the FULL FAIL gate for `checkF` structural literals + `checkG-call` (pseudocode lines 15-39) AST/parser-based; allow-list AST-context match is authoritative (line 23); false-positive guards (lines 33-34).
  - **`checkH` MUST be AST-context, NOT file-level (Major 4 round 8 — the same #2424 bypass guard as G3/hookWireAdapter).** Do NOT exempt the WHOLE `eventAdapter.ts`/`event-types.ts`/`event-schema.ts` files. Collect EVERY Gemini-usage-key node, then subtract via the AST-context allow-list ONLY: (a) in `event-types.ts`/`event-schema.ts`, nodes that are members of the DECLARED `UsageMetadataValue` type; (b) in `eventAdapter.ts`, nodes whose ENCLOSING FUNCTION is `usageStatsToPublicUsageMetadata`. A usage-key literal ANYWHERE ELSE in `eventAdapter.ts` (outside the mapper body) STILL fires. A bare file-path allow-list key is REJECTED (pseudocode lines 36-39e). Also implement the `--check-usage-key-boundary` mode (pseudocode lines 39a-39e) that runs this AST-context `checkH` over `packages/agents/src/api` only (consumed by P19's Major-4 verification). PRESERVE and reuse the P02-landed `checkF` structural matchers, the `toGeminiContent(s)` call matcher, the working `--count` mode (which already prints ONLY the integer non-exempt structural-hit total; pseudocode lines 40-44), the `--by-file` per-site detail mode (pseudocode lines 45-48, used by every migration slice's Major-4 site-specific closure and by the P33 §2A.4 inventory-closure gate), AND the `resolveInputFiles` input contract (`--files`/`--root`/positional — pseudocode lines 9-9e, Critical 2) — do NOT reimplement or regress them; the full fail-mode checks must feed the SAME per-site listing so `--by-file` reflects all of (a)-(h), not only `checkF`, and the new `checkD`/`checkG-barrel`/`checkH` bodies MUST also run over `resolveInputFiles(argv)` so a `--files <fixture>` invocation evaluates the given file under the full check set. Wire the now-complete checks (including flipping `--enforce-imports` on by default) into the default (no-flag) fail-mode run so the gate exits non-zero on any non-exempt structural hit.
- `scripts/agents-neutral-test-gate.ts`: implement §8.1 test gate (lines 50-59).
- `dev-docs/agents-neutral-gate-allowlist.md`: populate the entries that actually apply at target state (lines 66-71): the G3 hook-wire adapter in `streamRequestHelpers.ts` (OQ-1a KEEPS the wire → this entry EXISTS), **the hook-wire adapter `packages/agents/src/core/hookWireAdapter.ts` (Major 3 — AST-context-keyed, see the dedicated entry below)**, `api/event-types.ts`/`event-schema.ts`, the `usageStatsToPublicUsageMetadata` mapper module in `eventAdapter.ts`, and the test characterization allow-list. NOTE: OQ-3t is committed NEUTRAL, so `turnLogging.ts` is NOT allow-listed (it must be fully neutral).

### `hookWireAdapter.ts` allow-list entry MUST be AST-context-specific, NOT file-level (Major 3 — the #2424 bypass guard)
`packages/agents/src/core/hookWireAdapter.ts` (created P07, extended P13) is the SINGLE named agents boundary that reads/writes the core `HookGenerateContentResponse` JSON wire (`candidates?.[0]?.content?.parts`/`text`). It is a bounded external-wire adapter and needs an allow-list entry, but a FILE-LEVEL entry would let ANY future generic `candidates`/`parts` read in that file pass — recreating the #2424 structural bypass. Therefore:
- The `hookWireAdapter.ts` entry MUST match on AST CONTEXT: ONLY the named external-wire mapping functions `afterModelModifiedToChunk` / `afterModelBlockingToModelOutput` / `beforeModelRequestToWire` / `wireToNeutralRequest` / `beforeModelBlockingToModelOutput` / `afterModelModifiedToModelOutput` may read `candidates`/`content`/`parts` from the `HookGenerateContentResponse` wire, and each MUST immediately produce a neutral `ContentBlock[]` / `ModelStreamChunk` / `ModelOutput` and MUST NOT export or return any Google-shaped value.
- A generic `candidates`/`content`/`parts` read in `hookWireAdapter.ts` OUTSIDE those named functions FAILS the gate (proven by a P30 fixture, below). The allow-list matcher rejects a bare `hookWireAdapter.ts` file path as an exemption key (same rule as the G3 entry).
- P07/P13/P31 converge on this SAME `hookWireAdapter` AST-context rule: P07 records the initial entry for its after-model export `afterModelModifiedToChunk`; P13 extends it with the before-model/direct exports AND `afterModelBlockingToModelOutput` (added in P13 per C3); P31 finalizes the entry and its AST-context matcher.
- `dev-docs/agents-neutral-gate-baseline.md`: finalize the target-state baseline count (the bounded floor = number of allow-listed structural hits). The shrink-ratchet in each migration slice compares against this.
  - **EXPLICIT metric re-baseline step (Major 2 — NOT a silent redefinition):** through P27 the `--count`/`--by-file` metric measured non-exempt hits from the checks implemented AT THAT TIME (P02-real `checkA/B/C/E` + `checkF` + `checkG-call`). This phase ADDS `checkD`/`checkG-barrel`/`checkH` to the detection, which CHANGES what `--count` measures. Therefore P31 performs a DOCUMENTED re-baseline: (1) record the FINAL pre-P31-check `--count` (the P27 floor) as the "phase-scoped ratchet" close-out; (2) run the now-FULL `--count` (all of a-h); (3) write BOTH integers into `dev-docs/agents-neutral-gate-baseline.md` with a dated note "metric widened from {A/B/C/E/F/G-call} to {full a-h} at P31 — see enforcement-gate.md lines 42-42c" so the meaning change is explicit and auditable. The final bounded floor is the full-check allow-listed hit count. NO migration slice's ratchet meaning changed retroactively.

### Root `package.json` — Files to Modify (M2)
- Add two scripts alongside the existing gate scripts (root `package.json` lines 92-94, pattern `"lint:cli-boundary": "bun scripts/check-cli-import-boundary.ts"`):
  ```json
  "lint:agents-neutral-gate": "npx tsx scripts/agents-neutral-gate.ts",
  "lint:agents-neutral-test-gate": "npx tsx scripts/agents-neutral-test-gate.ts",
  ```

### `.github/workflows/ci.yml` — Files to Modify (M2)
- In the `lint_javascript` job, after the existing `npm run lint:cli-boundary` step (ci.yml ~line 261) and consistent with `npm run lint:agents-api-surface` (~line 275), add two run steps invoking the npm scripts EXACTLY as full verification will:
  ```yaml
  - name: 'Run agents neutral gate (structural)'
    run: npm run lint:agents-neutral-gate
  - name: 'Run agents neutral test gate'
    run: npm run lint:agents-neutral-test-gate
  ```
- Keep the existing `genai-import-inventory`/shrink-ratchet wiring.

- Document REQ-007.3 core-owned `ServerUsageMetadataEvent` scope limitation in the allow-list doc (pseudocode lines 72-74): the agents gate cannot enforce `packages/core/src/core/turn.ts:221-228`; the compensating core shape check lives in P19 (`serverUsageMetadataEvent.shape.test.ts`).

### G3 allow-list entry MUST be AST-context-specific, NOT file-level (Additional Risk 2 — the #2424 bypass guard)
`streamRequestHelpers.ts` contains BOTH the ALLOWED hook-wire `toGeminiContents` at the before-model hook target (`:228`) AND a telemetry OFFENDER at `logOutgoingRequest` (`:281`, G4 — deleted in P19). A FILE-LEVEL allow-list entry for `streamRequestHelpers.ts` would exempt the offender too and recreate the #2424 bypass. Therefore:
- The G3 allow-list entry MUST match on AST CONTEXT — the exact call expression inside the before-model hook-adapter function (the `applyLLMRequestModifications({ contents: toGeminiContents(requestContents) })` target), NOT the file path.
- The allow-list artifact schema (P29) and the gate's allow-list matcher (this phase) MUST both require an AST-context pattern (enclosing function + call shape), and MUST reject a bare file path as an exemption key.
- Verification (below) asserts that after P19 deletes G4 (`:281`), a re-introduced telemetry `toGeminiContents` in `streamRequestHelpers.ts` STILL fails the gate even though the file has a G3 entry.

### Required Code Markers
EVERY gate function MUST carry the marker block with the SPECIFIC `@pseudocode` line range (from `enforcement-gate.md`):
```typescript
/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 * @pseudocode lines 10-39   // checkA..H fail-mode bodies (per-check range)
 */
```
- `checkA/B/C/D/E/H` + barrel matcher → `@pseudocode lines 10-39`; `@requirement:REQ-012.1`.
- allow-list AST-context matcher (authoritative; rejects bare file path) → `@pseudocode line 23`; `@requirement:REQ-012.2`.
- false-positive guards → `@pseudocode lines 33-34`; `@requirement:REQ-012.1`.
- `--count` mode (reuse P02) → `@pseudocode lines 40-44`; `@requirement:REQ-012.1`.
- `--by-file` per-site detail mode (reuse/extend P02 to reflect all checks a-h) → `@pseudocode lines 45-48`; `@requirement:REQ-012.1`.
- `agents-neutral-test-gate.ts` §8.1 → `@pseudocode lines 50-59`; `@requirement:REQ-012.3`.
- Markers `@plan:PLAN-20260707-AGENTNEUTRAL.P31`, `@requirement:REQ-012.1/.2/.3`, plus the per-function `@pseudocode lines X-Y` above.

## Constraints
- Do NOT loosen any lint/complexity rule to make the gate pass. Do NOT grant exemptions via inline comments.

## Verification Commands
```bash
npm test -- scripts/__tests__/agentsNeutralGate.test.ts scripts/__tests__/agentsNeutralTestGate.test.ts   # ALL pass
npm run lint:agents-neutral-gate        # run via npm script EXACTLY as CI does -> exit 0
npm run lint:agents-neutral-test-gate   # exit 0
npx tsx scripts/agents-neutral-gate.ts --count   # prints the bounded-floor integer (== allow-listed hit count)
# Additional Risk 2: the G3 allow-list entry is AST-context-specific, NOT file-level. Prove a re-introduced
# telemetry toGeminiContents in streamRequestHelpers.ts STILL fails the gate despite the file's G3 entry
# (this scenario is one of the P30 gate fixtures, agentsNeutralGate.test.ts):
grep -nE "streamRequestHelpers|AST-context|enclosing function|file-level" dev-docs/agents-neutral-gate-allowlist.md   # G3 entry keyed on AST context, not bare file path
grep -nE '"lint:agents-neutral-(gate|test-gate)"' package.json   # both scripts present
grep -nE 'lint:agents-neutral-(gate|test-gate)' .github/workflows/ci.yml   # both wired in CI
npm run typecheck
```

## Success Criteria
- Gate green against the neutralized tree; catches all P30 fixtures; both npm scripts exist and are CI-wired; `--count` mode works; allow-list authoritative (inline comments grant nothing); OQ-3t neutral (no `turnLogging.ts` entry).

## Failure Recovery
1. If a P30 fixture is not detected: fix the AST check, do NOT weaken the fixture.
2. If a false-positive fires (domain `candidates`, neutral names): tighten the AST-context guard, do NOT add a blanket allow-list entry.
3. `git checkout --` the scripts/CI/package.json changes and re-implement per pseudocode if the gate cannot reach exit 0 on the clean tree without loosening.
4. Cannot proceed to Phase 32 until all P30 tests pass and both npm scripts exit 0.

## Phase Completion Marker
`project-plans/issue2349/.completed/P31.md`.
