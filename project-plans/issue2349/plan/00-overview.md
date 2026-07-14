# Plan Overview: PLAN-20260707-AGENTNEUTRAL (Issue #2349)

> **NON-EXECUTABLE overview; not a phase; excluded from phase-template compliance checks (Minor 3 round 8).** `00-overview.md` is plan metadata/orientation, NOT an executable phase — despite its `00` numeric prefix it carries none of the phase-template sections (Requirements Implemented, Verification Commands, etc.) and MUST be skipped by any mechanical phase-template heading check. The FIRST executable phase is **P0.5** (`00a-preflight-verification.md`); the execution-tracker treats P0.5 as the first executable phase.

Migrate `packages/agents` off `@google/genai` AND off all Google-shaped STRUCTURAL content, to neutral domain-named types. Read `specification.md` first; `overview.md` (1146 lines) is the authoritative technical map; `analysis/domain-model.md` records the resolved Open Questions; `analysis/pseudocode/*.md` are the line-numbered algorithms implementation phases MUST follow.

Plan ID: PLAN-20260707-AGENTNEUTRAL
Total Phases: 0.5 (preflight) + 0.6 (analysis/pseudocode immutability verification, Minor 1) + 01..33 (see sequence); each implementation/provisioning phase NN has a verification sibling NNa

> **Phase-numbering note (Minor 1):** The canonical PLAN.md Phase 01 (analysis) and Phase 02 (pseudocode)
> for this feature were completed OUT-OF-BAND and are represented by `analysis/domain-model.md` and
> `analysis/pseudocode/*.md` (NOT executable phases) — so a literal coordinator must NOT think P01/P02
> were skipped. The **P01/P02 phase SLOTS in THIS plan are reused** for two provisioning gates that MUST
> exist before any production phase: **P01** (core mutation tooling — makes P05's mutation gate
> executable, C3) and **P02** (early AST-gate skeleton + working `--count` — makes the shrink-ratchet
> AST-precise from the first slice and lands anti-#2424 structural detection before the migration body,
> Major 4/5). A dedicated **P0.6** verification phase (Minor 1) explicitly confirms the out-of-band
> analysis/pseudocode artifacts are present/immutable/contract-first/cited, so the slot reuse can never be
> mistaken for skipping canonical analysis/pseudocode. This keeps phase numbering fully contiguous
> (0.5, 0.6, 01, 02, 03 … 33) with NO gaps and required NO renumber of the existing P03-P33 files.
>
> **Analysis-before-code IS satisfied (Major 2 — maintainer-accepted).** PLAN.md §"Core Principle 4"
> (Analysis Before Code) is met: the canonical analysis (PLAN.md P01) lives in
> `analysis/domain-model.md` and the canonical pseudocode (PLAN.md P02) lives in the nine
> `analysis/pseudocode/*.md` files — both authored BEFORE any production phase and mechanically verified
> present/contract-first/line-numbered/code-free/cited/hash-frozen by **P0.6** (check A-F). A mechanical
> method-doc compliance checker MUST treat this as analysis+pseudocode DONE (not skipped): the P01/P02
> executable SLOTS are DELIBERATELY repurposed for tooling/gate provisioning with explicit maintainer
> acceptance recorded here and in `execution-tracker.md`. We do NOT create redundant empty
> `01-analysis`/`02-pseudocode` phase files because the artifacts already exist and are verified by P0.6;
> duplicating them as empty phases would be method-theater, not compliance.

## Why this is a MIGRATION, not a feature (integration-first by construction)

Every MIGRATION/PRODUCTION phase MODIFIES existing files, DELETES dead code, and RETYPES signatures; P01/P02 are explicit PROVISIONING gates (mutation tooling + the AST-gate skeleton/artifacts) required before production migration and create tooling/gate artifacts rather than modifying production `packages/agents/src`. There is NO parallel `ServiceV2`. Two whole files are DELETED — `streamChunkWrapper.ts` and `providerStopReason.ts`, both co-located in **P25** (the last phase that removes their final production consumers/readers — C2 build-order) — and a function-level delete inventory removes synthetic-response-only functions across P07-P15. The plan CANNOT build anything in isolation — the neutral types have named existing consumers (specification "Integration Points"), and acceptance requires the OLD Google-shaped code to be GONE.

## How the plan avoids the #2424 rejection

1. **Structural, not name-based.** Slices delete the synthetic-response round-trip and side-channels, not just re-point imports. The AST-context-aware gate SKELETON lands EARLY (Phase 02) with a working `--count` so every migration slice ratchets against precise structural counts. Phase 02 ALSO lands REAL FAIL-MODE for the cheap, high-value #2424 vectors — (a) raw `@google/genai` imports, (b) banned Google symbol imports, (c) `Contract*` alias imports, (e) `FinishReason`/`Type` enum re-declaration — behind `--enforce-imports`, run per-slice (scoped to each slice's migrated files) so a slice that re-introduces the exact #2424 aliasing/import pattern FAILS immediately, not at P31 (Major 6). The EXPENSIVE structural checks — structural `{candidates}`/`{role,parts}` literals + `.parts` mutators (`checkF` FAIL gate), the `GeminiContent*` barrel-import matcher (`checkG-barrel`), round-trip symbols (`checkD`), and usage-key context (`checkH`) — mature to full fail-mode at Phase 31 (extending the same script), and `--enforce-imports` flips into the default run there once zero production importers remain. This covers all the vectors #2424 used, with the literal import/alias vectors enforced from the first slice.
2. **Central versioned allow-list** is the single authoritative exemption mechanism; inline comments grant nothing (OQ-17 DECIDED).
3. **Test gate** bans Gemini fixtures in agents tests except a named characterization allow-list.

## TDD-as-migration (behavioral vertical slices)

For each migration slice: FIRST confirm/write BEHAVIORAL characterization tests pinning OBSERVABLE agent-loop behavior (event ordering, history-commit-once, tool dispatch, #2150 retry, #2329 refusal, hook JSON wire, usage/token accounting) using REAL agent-loop machinery (real `HistoryService`/`StreamProcessor`/`TurnProcessor`/`Turn`; mock ONLY the provider `AsyncIterable<IContent>`). THEN migrate internals underneath so those tests still pass. New neutral gap types get the classic stub→TDD→impl cycle. Tests: no mock theater, no reverse testing, ≥30% property-based, target ≥80% mutation.

## Phase sequence (execute sequentially, NEVER skip)

Dependencies flow: provisioning gates FIRST (P01 core mutation tooling → P02 AST gate skeleton + `--count`) → neutral-type gaps → stream pipeline (+ delete synthetic response + streamChunkWrapper) → side-channel retirement → non-streaming/direct + structural-access sites → usage-metadata/telemetry → clientContract cross-package → remaining retypes → test migration → EXTEND gate to full fail-mode (P29-31) + remove genai → full verification. (The AST gate is landed EARLY at P02 as a skeleton and EXTENDED at P29-31 — it is no longer "last".)

| Phase | ID | Purpose |
|---|---|---|
| 0.5 | P0.5 | Preflight verification — confirm every overview assumption before any impl (now also verifies mutation tooling per package + reserves gate script names + line-number drift → plan update, Minor 2) |
| 0.6 | P0.6 | Analysis/pseudocode immutability verification (Minor 1) — confirm `analysis/domain-model.md` + all 9 `analysis/pseudocode/*.md` are present, contract-first, line-numbered, code-free, cited by impl phases, and hash-frozen; makes the P01/P02 slot-reuse-for-tooling explicit so no one thinks canonical analysis/pseudocode were skipped |
| 01 | P01 | Core mutation tooling provisioning (tooling-only): `packages/core/stryker.conf.json` + `@stryker-mutator/*` devDeps + `test:mutation` — makes P05's core mutation gate executable (C3). NO production code. |
| 02 | P02 | AST gate SKELETON + working AST-context-aware `--count`/`--by-file` (early anti-#2424 enforcement, Major 4/5) + REAL fail-mode for the cheap #2424 vectors (a)(b)(c)(e) behind `--enforce-imports` (Major 6): `scripts/agents-neutral-gate.ts` (`checkF` F1/F3/F5 + `toGeminiContent(s)` call matcher + `--count`/`--by-file` + `checkA/B/C/E` import/alias/enum fail-mode bodies), `dev-docs/agents-neutral-gate-allowlist.md`, `dev-docs/agents-neutral-gate-baseline.md`. EXPENSIVE checks (`checkD`/`checkG-barrel`/`checkH` + `checkF`/`checkG-call` FAIL gate + test gate + CI wiring + `--enforce-imports` in the default run) extended at P29-P31. |
| 03 | P03 | Neutral gap types — STUB (`AgentMessageInput`, lossless converter, `afcHistory`, extended `toModelStreamChunk`, `sendParamsToRequest` turn-request DTO REQ-001.3) |
| 04 | P04 | Neutral gap types — TDD (behavioral + property tests incl. turn-request DTO) |
| 05 | P05 | Neutral gap types — IMPL (pseudocode `neutral-gap-types.md`) |
| 06 | P06 | Stream-pipeline behavioral characterization — TDD (pin observable behavior BEFORE migration) |
| 07 | P07 | StreamProcessor neutralization — IMPL (pseudocode `stream-processor-neutral.md`; delete `convertIContentToResponse` streaming usage; **neutralize the streaming AfterModel hook (`_processAfterModelHook`) onto `ContentBlock[]` in the SAME phase as the synthetic removal — C1 — via the single named `hookWireAdapter.ts` boundary, REQ-002.6**; create shrink-ratchet baseline) |
| 08 | P08 | TurnProcessor wrap + Turn consumption — IMPL (pseudocode `turnprocessor-turn-wrap.md`; STOP using `streamChunkWrapper` in TurnProcessor/turn — file NOT deleted, has P23/P25 consumers (C2); `sendMessage` STAYS `GenerateContentResponse`; streaming AfterModel hook neutral from P07 (C1)) |
| 09 | P09 | MessageConverter neutralization — IMPL (retype survivors; `convertIContentToResponse` chain KEPT until P13) |
| 10 | P10 | Side-channel characterization — TDD (#2329 refusal + hook restriction behavior) |
| 11 | P11 | Side-channel retirement — IMPL (neutralize `hookToolRestrictions.ts`; `providerStopReason` behavior neutral — WRITER dies P13, FILE deleted P25 with `streamChunkWrapper.ts`, C2) |
| 12 | P12 | Direct-message characterization — TDD (blocking + normal path observable behavior) |
| 13 | P13 | DirectMessageProcessor neutralization — IMPL (`sendMessage`→`ModelOutput` flip; DELETE both fabricators + `convertIContentToResponse` chain + `providerStopReason` WRITER; `providerStopReason.ts` FILE delete deferred to P25 with `streamChunkWrapper.ts`, C2) |
| 14 | P14 | Structural-access sites — TDD (ConversationManager consolidation, clientLlmUtilities, streamResponseHelpers, MessageStreamOrchestrator) |
| 15 | P15 | Structural-access sites — IMPL (§2A.4 construction + access/mutation surface; DELETE `isValidResponse`) |
| 16 | P16 | Runtime enum/value + googlePartHelpers — TDD (tool-schema structure + block-helper outputs; C5 split) |
| 17 | P17 | Runtime enum/value + googlePartHelpers — IMPL (`Type`/`FinishReason`/`ApiError` replacements; `googlePartHelpers` neutralize; helper-by-helper table) |
| 18 | P18 | Usage-metadata characterization — TDD (OQ-2v runtime shape decision-gate FIRST) |
| 19 | P19 | Usage-metadata boundary + telemetry — IMPL (pseudocode `usage-metadata-boundary.md`; core `ServerUsageMetadataEvent` shape check) |
| 20 | P20 | clientContract cross-package — TDD (contract-surface behavioral + CLI/core consumer compile checks) |
| 21 | P21 | clientContract cross-package — IMPL (pseudocode `clientcontract-neutralization.md`; core + 23 CLI + 5 core consumers) |
| 22 | P22 | Subagent slice — characterization TDD (run, tool-response feed, nudges, non-interactive) |
| 23 | P23 | Subagent slice — IMPL (subagent*.ts retype; shrink-ratchet) |
| 24 | P24 | Executor slice — characterization TDD (initial msg, template application, tool feed, recovery) |
| 25 | P25 | Executor slice — IMPL (executor*.ts incl. raw-import-free `executor-prompt-builder` mutator, OQ-12; STOP using `streamChunkWrapper` in `executor-stream-processor.ts` + **DELETE `streamChunkWrapper.ts`** as the last-consumer phase, deferred from P08 (C2), + **DELETE `providerStopReason.ts`** (its last reader lived inside `streamChunkWrapper.ts`, deferred from P13, C2); shrink-ratchet) |
| 26 | P26 | Remaining group — characterization TDD (compression, agenticLoop cancelled-tool, api session-control, TodoContinuation, chatSession) |
| 27 | P27 | Remaining group — IMPL (compression/agenticLoop/api/misc retype → ZERO prod `@google/genai` imports; shrink-ratchet floor) |
| 28 | P28 | Test migration — behavioral rewrite of agent-loop tests off `{candidates}`; confirm characterization allow-list |
| 29 | P29 | Enforcement gate — STUB (core gate + test gate + allow-list artifact skeletons) |
| 30 | P30 | Enforcement gate — TDD (fixture repo: known hits detected, allow-listed exempt, false-positives spared) |
| 31 | P31 | Enforcement gate — IMPL (pseudocode `enforcement-gate.md`; wire CI + root package.json scripts) |
| 32 | P32 | Remove `@google/genai` from `packages/agents/package.json` ENTIRELY (no devDep escape hatch); baseline → 0 |
| 33 | P33 | Full verification — test/lint/typecheck/format/build + grep/AST gate + mutation gate + smoke haiku |

Each implementation phase NN has a verification sibling NNa (semantic verification per PLAN.md §7: read code, trace path, prove behavior — not marker-counting; deferred-implementation/mock-theater/reverse-testing detectors).

## Cross-package build-green checkpoints (OQ-4)

- After P05: neutral gap types land; no consumer break.
- After P07-P09: agents internal pipeline neutral (streaming); agents client still satisfies the (still-Google-shaped) `clientContract.ts` surface (structural superset). `sendMessage` still returns `GenerateContentResponse` (direct path) until P13. Build green.
- After P13: direct path flipped to `ModelOutput`; `sendMessage` returns `ModelOutput`; all synthetic fabricators gone; the `providerStopReason` WRITER is removed (the `providerStopReason.ts` + `streamChunkWrapper.ts` FILES survive with a single residual reference each until their co-located P25 delete — C2). Build green.
- After P25: `streamChunkWrapper.ts` + `providerStopReason.ts` FILES DELETED (last consumers/readers migrated); zero references remain. Build green.
- P21: `clientContract.ts` payload types flipped to neutral AND all 23 CLI + 5 core consumers migrated IN THE SAME PHASE. Build MUST be green at phase end.
- After P27: ZERO prod `@google/genai` imports across `packages/agents/src`.
- P32: genai dep removed only after zero imports (verified P27/P31).

## Global gates (checked at EVERY verification phase)

1. No `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no severity downgrade; no complexity/size threshold increase (`npm run lint:eslint-guard`).
2. No mock theater, no reverse testing (`expect().not.toThrow()`, `toThrow('NotYetImplemented')`), no structure-only tests.
3. ≥30% property-based tests for the phase's new tests.
4. `npm run typecheck` + touched-workspace tests pass.
5. RULES.md: no `any`, no type assertions, immutability.
6. Public event shapes `ServerAgentStreamEvent`/`StreamEvent`/`StreamEventType` UNCHANGED (RISK-1); hook JSON wire byte-shape UNCHANGED (RISK-2).
