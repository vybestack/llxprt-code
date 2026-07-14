# Execution Tracker — PLAN-20260707-AGENTNEUTRAL (Issue #2349)

Migrate `packages/agents` off `@google/genai` AND off all Google-shaped structural content, to neutral domain-named types. Read `../overview.md` (authoritative inventory), then `../specification.md`, `../analysis/domain-model.md`, and the pseudocode under `../analysis/pseudocode/`.

**Execute phases in EXACT numerical order. NEVER skip. Each impl phase has an `NNa` verification sibling that MUST pass before proceeding.** Semantic verification per `verification-template.md` (read the code, trace the path, prove behavior — not marker-counting).

> **Phase-numbering note (Minor 1):** Canonical PLAN.md P01 (analysis) / P02 (pseudocode) were done OUT-OF-BAND and live in `../analysis/domain-model.md` + `../analysis/pseudocode/*.md` (NOT executable phases) — P01/P02 were NOT skipped. The **P01/P02 phase SLOTS here are reused** for two provisioning gates that must precede production: **P01** core mutation tooling (makes P05's mutation gate executable, C3) and **P02** the early AST-gate skeleton + `--count` (makes the shrink-ratchet AST-precise from the first slice and lands anti-#2424 detection before the migration body, Major 4/5). A dedicated **P0.6** phase (Minor 1) verifies the out-of-band analysis/pseudocode artifacts are present/immutable/contract-first/cited (so the slot reuse is never mistaken for skipping analysis/pseudocode). Numbering stays contiguous (0.5, 0.6, 01, 02, 03 … 33) with no gaps and NO renumber of P03-P33.

> **Analysis-before-code IS satisfied (Major 2 — maintainer-accepted).** The canonical PLAN.md P01 (analysis) = `../analysis/domain-model.md` and P02 (pseudocode) = the nine `../analysis/pseudocode/*.md`, authored BEFORE any production phase and mechanically verified by **P0.6** (present/contract-first/line-numbered/code-free/cited/hash-frozen). A mechanical compliance checker MUST read this as analysis+pseudocode DONE, not skipped. The P01/P02 executable SLOTS are deliberately repurposed for tooling/gate provisioning with explicit maintainer acceptance; no redundant empty `01-analysis`/`02-pseudocode` phase files are created because the artifacts already exist and are P0.6-verified.

## Cross-package build-green checkpoints
Monorepo `npm run build` must be green at the end of: P05, P07, P08, P09, P13, P15, P17, P19, **P21 (cross-package flip)**, P23, P25, P27, P31, P32, P33.

## Status table

| Phase | ID | Kind | Purpose | Pseudocode | Status | Verified | Semantic? |
|-------|-----|------|---------|------------|--------|----------|-----------|
| 0.5 | P0.5 | preflight | Verify load-bearing assumptions (provider AsyncIterable<IContent>, neutral llm-types surface, toModelStreamChunk gap, 46 importers, 7 toGeminiContents, clientContract blast-radius, runtime enum imports, core block helpers, AST parser) + **mutation tooling per package (check 12)** + **reserve gate script names (check 13)** + **line-number drift → plan update (Minor 2)** | — | ⬜ | — | N/A |
| 0.6 | P0.6 | verify | **Analysis/pseudocode immutability (Minor 1)**: domain-model + 9 pseudocode files present/contract-first/line-numbered/code-free/cited/hash-frozen; documents P01/P02 slot reuse | — | ⬜ | — | N/A |
| 01 | P01 | tooling | **Core mutation tooling** (tooling-only, NO src): `packages/core/stryker.conf.json` + `@stryker-mutator/*` devDeps + `test:mutation` — makes P05's mutation gate executable (C3) | — | ⬜ | ⬜ | ⬜ |
| 02 | P02 | tooling | **AST gate SKELETON + working `--count`/`--by-file`** (Major 4/5) **+ REAL fail-mode for cheap #2424 vectors (a)(b)(c)(e) behind `--enforce-imports`** (Major 6): `scripts/agents-neutral-gate.ts` (`checkF` F1/F3/F5 + `toGeminiContent(s)` call matcher + `--count` + `checkA/B/C/E` import/alias/enum fail-mode), allow-list + baseline artifacts; establishes the AST-precise ratchet baseline BEFORE P07; EXPENSIVE checks extended at P29-31 | enforcement-gate | ⬜ | ⬜ | ⬜ |
| 03 | P03 | stub | Neutral gap types surface: AgentMessageInput + ModelOutput.afcHistory + sendParamsToRequest (REQ-001.3) | neutral-gap-types | ⬜ | ⬜ | ⬜ |
| 04 | P04 | tdd | Behavioral tests for gap-types (lossless legacy conv, providerMetadata preserve, afc, turn-request DTO) | neutral-gap-types | ⬜ | ⬜ | ⬜ |
| 05 | P05 | impl | Implement gap-types; extend toModelStreamChunk (OQ-16); sendParamsToRequest | neutral-gap-types | ⬜ | ⬜ | ⬜ |
| 06 | P06 | char-tdd | Stream-pipeline behavioral characterization (safety net) | stream-processor-neutral, turnprocessor-turn-wrap | ⬜ | ⬜ | ⬜ |
| 07 | P07 | impl | StreamProcessor neutral (toModelStreamChunk, block accumulate, delete synthetic call); **create shrink-ratchet baseline (M4)** | stream-processor-neutral | ⬜ | ⬜ | ⬜ |
| 08 | P08 | impl | TurnProcessor wrap + Turn consume ContentBlock[]; **STOP using streamChunkWrapper in TurnProcessor/turn (file NOT deleted — has P23/P25 consumers, C2)**; sendMessage STAYS GenerateContentResponse (flip deferred to P13); **streaming AfterModel hook already neutral (P07, C1)** | turnprocessor-turn-wrap | ⬜ | ⬜ | ⬜ |
| 09 | P09 | impl | MessageConverter: retype survivors neutral; convertIContentToResponse chain KEPT (deleted P13) | messageconverter-neutralization | ⬜ | ⬜ | ⬜ |
| 10 | P10 | char-tdd | Side-channel behavioral characterization (#2329 stop reason; hook restriction filter) | hooktoolrestrictions-neutral | ⬜ | ⬜ | ⬜ |
| 11 | P11 | impl | **NEUTRALIZE hookToolRestrictions.ts** (drop WeakMap/Symbol); providerStopReason behavior neutral here — WRITER dies P13, FILE deleted P25 (reader lives inside streamChunkWrapper.ts until then, C2) | hooktoolrestrictions-neutral | ⬜ | ⬜ | ⬜ |
| 12 | P12 | char-tdd | Direct-message behavioral characterization (blocking + normal paths) | directmessageprocessor-neutral | ⬜ | ⬜ | ⬜ |
| 13 | P13 | impl | DirectMessageProcessor→ModelOutput; sendMessage→ModelOutput flip; **DELETE both fabricators + convertIContentToResponse chain + providerStopReason WRITER** (providerStopReason FILE delete deferred to P25 with streamChunkWrapper.ts — C2) | directmessageprocessor-neutral | ⬜ | ⬜ | ⬜ |
| 14 | P14 | char-tdd | Structural-access characterization (consolidation, thought-filter, next_speaker, pending-tool-call) | stream-processor-neutral | ⬜ | ⬜ | ⬜ |
| 15 | P15 | impl | Migrate §2A.4-II access/mutation sites to ContentBlock[] (internal `getHistory` consolidation/thought reimpl on blocks — public return-type stays `Content[]`); **DELETE isValidResponse**. G1/G2 `toGeminiContents` deletion + `getHistory` return-type flip DEFERRED to P21 (Major 3, cross-package build-green) | stream-processor-neutral, messageconverter-neutralization | ⬜ | ⬜ | ⬜ |
| 16 | P16 | char-tdd | Runtime-enum + googlePartHelpers characterization (tool-schema structure, block-helper outputs) — C5 split | messageconverter-neutralization | ⬜ | ⬜ | ⬜ |
| 17 | P17 | impl | Runtime Type/FinishReason/ApiError value replacements; neutralize googlePartHelpers (helper-by-helper table, ResponseOutcome core-owned) | messageconverter-neutralization | ⬜ | ⬜ | ⬜ |
| 18 | P18 | char-tdd | Usage-metadata runtime-shape characterization (OQ-2v — RECORDED EVIDENCE only; OQ-2u is committed to option (C) unconditionally, NOT a decision-gate — Critical 1 round 7) | usage-metadata-boundary | ⬜ | ⬜ | ⬜ |
| 19 | P19 | impl | §7A option-(C) bridge mapper **UNCONDITIONAL** (declared Gemini-named public type UNCHANGED; no option-B retype — preserves CLI consumers) + telemetry neutralize (delete toGeminiContents G4/G5/G7); **core ServerUsageMetadataEvent shape check (M3)** | usage-metadata-boundary | ⬜ | ⬜ | ⬜ |
| 20 | P20 | char-tdd | clientContract surface characterization (history round-trip, direct-message, stream) | clientcontract-neutralization | ⬜ | ⬜ | ⬜ |
| 21 | P21 | impl | **Cross-package flip**: delete Contract* payload types; retype surface; **`getHistory` return-type flip to `IContent[]` + G1/G2 `toGeminiContents` deletion (moved from P15, Major 3)**; migrate 23 CLI + 5 core consumers + getHistory callers (deepthinker checkpointed diff verify) | clientcontract-neutralization | ⬜ | ⬜ | ⬜ |
| 22 | P22 | char-tdd | Subagent slice characterization (run, tool-response feed, nudges, non-interactive) — C5/M1 split | — | ⬜ | ⬜ | ⬜ |
| 23 | P23 | impl | Subagent group retype → neutral (subagent*.ts); **stop using streamChunkWrapper in subagentNonInteractive.ts (C2)**; shrink-ratchet | — | ⬜ | ⬜ | ⬜ |
| 24 | P24 | char-tdd | Executor slice characterization (initial msg, template application, tool feed, recovery) | — | ⬜ | ⬜ | ⬜ |
| 25 | P25 | impl | Executor group retype → neutral incl. executor-prompt-builder raw-import-free mutator (OQ-12); **stop using streamChunkWrapper in executor-stream-processor.ts + DELETE streamChunkWrapper.ts (last consumer, deferred from P08, C2) + DELETE providerStopReason.ts (its last reader was inside streamChunkWrapper.ts, deferred from P13, C2)**; shrink-ratchet | — | ⬜ | ⬜ | ⬜ |
| 26 | P26 | char-tdd | Remaining group characterization (compression, agenticLoop cancelled-tool, api session-control, TodoContinuation, chatSession) | — | ⬜ | ⬜ | ⬜ |
| 27 | P27 | impl | Remaining group retype → **ZERO prod @google/genai imports**; shrink-ratchet at floor | — | ⬜ | ⬜ | ⬜ |
| 28 | P28 | test-mig | Behavioral test migration off {candidates}/Google fixtures; finalize characterization allow-list | — | ⬜ | ⬜ | ⬜ |
| 29 | P29 | stub | Enforcement gate scripts + central allow-list artifact (skeleton) | enforcement-gate | ⬜ | ⬜ | ⬜ |
| 30 | P30 | tdd | Gate behavioral tests: detect all #2424 vectors + spare false-positives | enforcement-gate | ⬜ | ⬜ | ⬜ |
| 31 | P31 | impl | Implement AST core gate (a-h) + test gate; wire CI + root package.json scripts (M2); populate allow-list | enforcement-gate | ⬜ | ⬜ | ⬜ |
| 32 | P32 | impl | Remove @google/genai from packages/agents/package.json ENTIRELY (no devDep escape hatch); baseline→0 | — | ⬜ | ⬜ | ⬜ |
| 33 | P33 | full-verify | Whole-migration acceptance (overview §9.1 1-10) + mutation gate + smoke haiku (deepthinker) | — | ⬜ | ⬜ | ⬜ |

Legend: ⬜ pending ·  in progress · [OK] done. Update after EACH phase.

## Requirement → Phase coverage map (must all be covered — REQ numbering per specification.md)
- REQ-001 (neutral gap types: AgentMessageInput/lossless conv/**turn-request DTO REQ-001.3**/afcHistory/toModelStreamChunk provider-metadata preserve) → P03-P05.
- REQ-002 (stream pipeline neutral; delete synthetic streaming round-trip + streamChunkWrapper.ts + MessageConverter fabricators; public event shape unchanged) → P06-P09, P13 (final fabricator deletion). **REQ-002.4 staged deletion (Major 3):** streamChunkWrapper USAGE-stop P08/P23, **streamChunkWrapper.ts FILE DELETE P25** (last consumer, C2); fabricator chain P13; VALIDATOR `isValidResponse` P15. **REQ-002.6 (streaming+direct AfterModel hook neutralized via single `hookWireAdapter.ts`, C1/C3):** streaming P07, direct P13; core `HookGenerateContentResponse` wire DTO PRESERVED (not retyped).
- REQ-003 (side-channels retired: hookToolRestrictions neutralize P11; providerStopReason WRITER removed P13, FILE deleted P25 co-located with streamChunkWrapper.ts — C2) → P10-P11, P13, P25.
- REQ-004 (direct-message neutral; ModelOutput both paths; delete both fabricators; sendMessage flip) → P12-P13.
- REQ-005 (structural-access §2A.4 sites migrated to ContentBlock[]; remaining retypes) → REQ-005.1 P14-P15; REQ-005.2 (clientLlmUtilities) P14-P15; REQ-005.3 (streamResponseHelpers) P07/P07a + P14-P15; REQ-005.4 (MessageStreamOrchestrator) P14-P15; REQ-005.5 P15; slices REQ-005.5a (subagent) → P22-P23, REQ-005.5b (executor, OQ-12) → P24-P25, REQ-005.5c (remaining; ZERO-prod-imports floor) → P26-P27. [REQ-005.1..5.5 + 5.5a/b/c all now spec-defined — no orphans.]
- REQ-006 (runtime Type/FinishReason/ApiError/createUserContent value replacements) → P16-P17.
- REQ-007 (public-event usage-metadata boundary §7A; OQ-2v runtime characterization = RECORDED EVIDENCE only; OQ-2u COMMITTED UNCONDITIONALLY to option (C) — no branch, option (B) rejected for #2349 to preserve the CLI/public usage wire; core-owned scope limitation + core shape check) → P18-P19 (+ documented P31).
- REQ-008 (telemetry neutralized or bounded) → P19.
- REQ-009 (clientContract payload types DELETE + surface retype) → P20-P21.
- REQ-010 (structural converter flows toGeminiContent(s)/GeminiContent* eliminated) → REQ-010.1 **P21 (G1/G2, moved from P15 with the getHistory return-type flip — Major 3)** + P19 (G4/G5/G7) + P08 (G6); REQ-010.2 (no GeminiContent* imports) P15/P19/P21/P27 (client.ts/ConversationManager.ts GeminiContent*/Content import removal asserted in P21a, not P15a — Major 3); enforced P31.
- REQ-011 (googlePartHelpers fate — core block equivalents; ResponseOutcome core-owned) → P16-P17.
- REQ-012 (enforcement gates prod + test + central allow-list; root npm scripts) → **P02 (skeleton + `--count`/`--by-file` + allow-list/baseline artifacts + REAL fail-mode for cheap vectors (a)(b)(c)(e) behind `--enforce-imports`, Major 4/5/6)** + P29-P31 (extend to EXPENSIVE checks full fail-mode + `checkF`/`checkG-call` FAIL gate + test gate + CI wiring + flip `--enforce-imports` into default run). REQ-012.4 (core mutation tooling C3 + P33 whole-surface mutation coverage C5, spec-defined) → **P01** (tooling) + **P33** (acceptance coverage).
- REQ-013 (remove @google/genai dependency ENTIRELY; baseline 0) → REQ-013.1 (dep removal + baseline 0) **P32**; REQ-013.2 (allow-listed tests use LOCAL structural fixtures, no SDK dep — spec-defined) **P28** (fixtures authored local) + **P32** (verified zero imports incl tests).
- REQ-INT-001 (behavioral contracts §7 preserved) → characterization phases P06/P10/P12/P14/P16/P18/P20/P22/P24/P26; acceptance P33.
- REQ-INT-002 (CLI+core cross-package consumers migrated; build-green ordering OQ-4) → P21.
- REQ-INT-003 (core services/history stay neutral; no regression) → P06/P08 characterization; acceptance P33.
- REQ-INT-004 (dead-code removal real: files + functions gone) → P07-P13, P23/P25/P27 (verified by NNa greps + shrink-ratchet) + P33.
- REQ-INT-005 (tests migrated behaviorally; allow-list) → P28.
- REQ-INT-006 (smoke + full verification green; zero raw imports + zero structural bypasses) → P33.

## Mutation & shrink-ratchet gates (see verification-template.md §8-9)
- Core mutation tooling is provisioned in **P01** (dedicated tooling phase: `packages/core/stryker.conf.json` + `@stryker-mutator/*` devDeps + `test:mutation` script), so P05's core mutation gate is executable (C3). Agents already has Stryker.
- Every impl phase's NNa verification runs scoped Stryker (`--mutate` on the phase's changed files) and HARD-FAILS below 80% (parse `reports/mutation/mutation.json`).
- The AST-context-aware gate SKELETON with a working `--count` mode is landed EARLY in **P02** (before the first migration slice P07), so from P07 onward the shrink-ratchet uses the SAME AST-context-aware `scripts/agents-neutral-gate.ts --count` mechanism — NOT a broad grep (Major 4/5). From P07 onward every migration-slice impl (P08/P09/P11/P13/P15/P17/P19/P21/P23/P25/P27) records the AST `--count` structural-hit count against `dev-docs/agents-neutral-gate-baseline.md` (created in P02); the count MUST strictly decrease (or stay at the bounded floor) — a slice that does not shrink the structural surface fails its NNa. **Each migration-slice NNa ALSO runs `npx tsx scripts/agents-neutral-gate.ts --enforce-imports` SCOPED to that slice's just-migrated files (Major 6): a slice that migrates a file but re-introduces a raw `@google/genai` import, a banned Google symbol, a `Contract*` alias, or a `FinishReason`/`Type` enum re-declaration in it FAILS immediately (not at P31).** The broad grep is retained ONLY as an advisory, slice-scoped human cross-check (never a pass/fail gate). P29-P31 EXTEND the P02 skeleton (full checks a-h fail-mode + test gate + CI wiring + npm scripts + populated allow-list); the `--count` integer is continuous across the whole plan.

## Completion gates
- [ ] All phases have `@plan:PLAN-20260707-AGENTNEUTRAL.P##` markers in code.
- [ ] All requirements have `@requirement:REQ-###` markers.
- [ ] Both enforcement gates green; no lint/complexity loosening or suppression anywhere.
- [ ] No phases skipped; every `NNa` verification PASS before the next phase.
- [ ] Smoke haiku passes.
