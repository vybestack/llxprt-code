# Plan: High Density Context Compression

Plan ID: `PLAN-20260211-HIGHDENSITY`
Generated: 2026-02-11
Total Phases: 29 (+ verification companions)
Requirements: REQ-HD-001 through REQ-HD-013

## Critical Reminders

Before implementing ANY phase, ensure you have:

1. Completed preflight verification (Phase 0.5 — see `00a-preflight-verification.md`)
2. Defined integration contracts for multi-component features (in pseudocode files)
3. Written integration tests BEFORE unit tests for connected components
4. Verified all dependencies and types exist as assumed
5. Read ALL pseudocode references listed in the phase — implementations MUST cite line numbers
6. Checked that the previous phase's completion marker exists

## Analysis Artifacts

- `analysis/domain-model.md` — entity relationships, state transitions, business rules, edge cases
- `analysis/pseudocode/strategy-interface.md` — types, interface changes, factory, existing strategy updates
- `analysis/pseudocode/history-service.md` — applyDensityResult, getRawHistory, recalculateTotalTokens
- `analysis/pseudocode/high-density-optimize.md` — optimize() entry point, READ→WRITE pruning, file dedup, recency pruning

## Execution Status

| Phase | ID | Title | Status | Started | Completed | Verified | Semantic? |
|-------|-----|-------|--------|---------|-----------|----------|-----------|
| 01 | P01 | Analysis | ⬜ | - | - | - | N/A |
| 01a | P01a | Analysis Verification | ⬜ | - | - | - | N/A |
| 02 | P02 | Pseudocode | ⬜ | - | - | - | N/A |
| 02a | P02a | Pseudocode Verification | ⬜ | - | - | - | N/A |
| 03 | P03 | Types & Strategy Interface — Stub | ⬜ | - | - | - | ⬜ |
| 03a | P03a | Types Stub Verification | ⬜ | - | - | - | ⬜ |
| 04 | P04 | Types & Strategy Interface — TDD | ⬜ | - | - | - | ⬜ |
| 04a | P04a | Types TDD Verification | ⬜ | - | - | - | ⬜ |
| 05 | P05 | Types & Strategy Interface — Impl | ⬜ | - | - | - | ⬜ |
| 05a | P05a | Types Impl Verification | ⬜ | - | - | - | ⬜ |
| 06 | P06 | HistoryService Extensions — Stub | ⬜ | - | - | - | ⬜ |
| 06a | P06a | HistoryService Stub Verification | ⬜ | - | - | - | ⬜ |
| 07 | P07 | HistoryService Extensions — TDD | ⬜ | - | - | - | ⬜ |
| 07a | P07a | HistoryService TDD Verification | ⬜ | - | - | - | ⬜ |
| 08 | P08 | HistoryService Extensions — Impl | ⬜ | - | - | - | ⬜ |
| 08a | P08a | HistoryService Impl Verification | ⬜ | - | - | - | ⬜ |
| 09 | P09 | High Density Optimize — Stub | ⬜ | - | - | - | ⬜ |
| 09a | P09a | HD Optimize Stub Verification | ⬜ | - | - | - | ⬜ |
| 10 | P10 | High Density Optimize — TDD | ⬜ | - | - | - | ⬜ |
| 10a | P10a | HD Optimize TDD Verification | ⬜ | - | - | - | ⬜ |
| 11 | P11 | High Density Optimize — Impl | ⬜ | - | - | - | ⬜ |
| 11a | P11a | HD Optimize Impl Verification | ⬜ | - | - | - | ⬜ |
| 12 | P12 | High Density Compress — Stub | ⬜ | - | - | - | ⬜ |
| 12a | P12a | HD Compress Stub Verification | ⬜ | - | - | - | ⬜ |
| 13 | P13 | High Density Compress — TDD | ⬜ | - | - | - | ⬜ |
| 13a | P13a | HD Compress TDD Verification | ⬜ | - | - | - | ⬜ |
| 14 | P14 | High Density Compress — Impl | ⬜ | - | - | - | ⬜ |
| 14a | P14a | HD Compress Impl Verification | ⬜ | - | - | - | ⬜ |
| 15 | P15 | Settings & Factory — Stub | ⬜ | - | - | - | ⬜ |
| 15a | P15a | Settings Stub Verification | ⬜ | - | - | - | ⬜ |
| 16 | P16 | Settings & Factory — TDD | ⬜ | - | - | - | ⬜ |
| 16a | P16a | Settings TDD Verification | ⬜ | - | - | - | ⬜ |
| 17 | P17 | Settings & Factory — Impl | ⬜ | - | - | - | ⬜ |
| 17a | P17a | Settings Impl Verification | ⬜ | - | - | - | ⬜ |
| 18 | P18 | Orchestration — Stub | ⬜ | - | - | - | ⬜ |
| 18a | P18a | Orchestration Stub Verification | ⬜ | - | - | - | ⬜ |
| 19 | P19 | Orchestration — TDD | ⬜ | - | - | - | ⬜ |
| 19a | P19a | Orchestration TDD Verification | ⬜ | - | - | - | ⬜ |
| 20 | P20 | Orchestration — Impl | ⬜ | - | - | - | ⬜ |
| 20a | P20a | Orchestration Impl Verification | ⬜ | - | - | - | ⬜ |
| 21 | P21 | Enriched Prompts & Todos — Stub | ⬜ | - | - | - | ⬜ |
| 21a | P21a | Prompts Stub Verification | ⬜ | - | - | - | ⬜ |
| 22 | P22 | Enriched Prompts & Todos — TDD | ⬜ | - | - | - | ⬜ |
| 22a | P22a | Prompts TDD Verification | ⬜ | - | - | - | ⬜ |
| 23 | P23 | Enriched Prompts & Todos — Impl | ⬜ | - | - | - | ⬜ |
| 23a | P23a | Prompts Impl Verification | ⬜ | - | - | - | ⬜ |
| 24 | P24 | Integration — Stub | ⬜ | - | - | - | ⬜ |
| 24a | P24a | Integration Stub Verification | ⬜ | - | - | - | ⬜ |
| 25 | P25 | Integration — TDD | ⬜ | - | - | - | ⬜ |
| 25a | P25a | Integration TDD Verification | ⬜ | - | - | - | ⬜ |
| 26 | P26 | Integration — Impl | ⬜ | - | - | - | ⬜ |
| 26a | P26a | Integration Impl Verification | ⬜ | - | - | - | ⬜ |
| 27 | P27 | Migration — Backward Compatibility | ⬜ | - | - | - | ⬜ |
| 27a | P27a | Migration Verification | ⬜ | - | - | - | ⬜ |
| 28 | P28 | Deprecation — Cleanup | ⬜ | - | - | - | ⬜ |
| 28a | P28a | Deprecation Verification | ⬜ | - | - | - | ⬜ |
| 29 | P29 | Final Verification | ⬜ | - | - | - | ⬜ |

## Phase Summary

### Foundation (P01–P02)
- **P01 Analysis** — Domain model, entity relationships, state transitions, edge cases
- **P02 Pseudocode** — Numbered pseudocode for all components with integration contracts

### Types & Strategy Interface (P03–P05)
- **P03 Stub** — StrategyTrigger, DensityResult, DensityConfig, DensityResultMetadata types; CompressionStrategy interface update; COMPRESSION_STRATEGIES tuple; trigger on existing strategies
- **P04 TDD** — Behavioral tests for type shapes, existing strategy trigger property, compress compatibility
- **P05 Impl** — Full type implementations, existing strategy trigger wiring

### HistoryService Extensions (P06–P08)
- **P06 Stub** — applyDensityResult(), getRawHistory(), recalculateTotalTokens() method stubs
- **P07 TDD** — Tests for replacement-first ordering, reverse removal, validation, conflict invariant, bounds checking, raw history access, token recalculation
- **P08 Impl** — Full HistoryService method implementations per pseudocode/history-service.md

### High Density Optimize (P09–P11)
- **P09 Stub** — HighDensityStrategy class skeleton with optimize() stub
- **P10 TDD** — READ→WRITE pruning, file dedup, recency pruning, edge case tests
- **P11 Impl** — Full optimize() implementation per pseudocode/high-density-optimize.md

### High Density Compress (P12–P14)
- **P12 Stub** — compress() method stub on HighDensityStrategy
- **P13 TDD** — Tool response summarization, tail preservation, token targeting tests
- **P14 Impl** — Full compress() implementation

### Settings & Factory (P15–P17)
- **P15 Stub** — Settings registry entries, ephemeral accessors, factory case stubs
- **P16 TDD** — Settings resolution, ephemeral accessor, factory instantiation tests
- **P17 Impl** — Full settings wiring and factory registration

### Orchestration (P18–P20)
- **P18 Stub** — ensureDensityOptimized() stub, densityDirty flag in geminiChat.ts
- **P19 TDD** — Dirty flag lifecycle, optimization-before-threshold, emergency path tests
- **P20 Impl** — Full orchestration wiring in geminiChat.ts

### Enriched Prompts & Todos (P21–P23)
- **P21 Stub** — CompressionContext additions, prompt section placeholders
- **P22 TDD** — Prompt section presence, todo inclusion, transcript reference tests
- **P23 Impl** — Full prompt enhancement and todo-aware summarization

### Integration (P24–P26)
- **P24 Stub** — Wire all components together, integration test scaffolding
- **P25 TDD** — End-to-end flow tests: user message → density optimize → threshold check → compress
- **P26 Impl** — Full integration wiring, verify feature reachable from CLI

### Migration & Deprecation (P27–P28)
- **P27 Migration** — Backward compatibility tests: existing strategy defaults, profile loading, no breaking changes
- **P28 Deprecation** — Cleanup: remove stub artifacts, unused code, phase-transition TODOs; plan marker audit

### Final Verification (P29)
- **P29** — Full regression, mutation testing, manual smoke test, completion sign-off
