# Execution Tracker — PLAN-20260617-COREAPI (Issue #1594, Core Public API)

Plan ID: `PLAN-20260617-COREAPI`
Total Phases: 59 (1 preflight + 28 worker + 28 verification + 1 final eval)
Requirements: REQ-001 … REQ-021

## Subagent roles

- **typescriptexpert** — all worker (NN) phases: analysis, pseudocode, types/schemas, stubs, quality setup, harness RED phases, implementation, export strategy, discovery, non-interactive parity, app-service subpaths, docs.
- **typescriptreviewer** — preflight (P00a) and all verifier (NNa) phases EXCEPT pseudocode-compliance gates.
- **deepthinker** — pseudocode-compliance gate on pseudocode-backed impl verifiers (P02a, P14a, P15a, P16a, P17a, P24a) and final plan-quality evaluation (P29).

## Execution Status

| Phase | ID | Subagent | Status | Started | Completed | Verified | Semantic? | Notes |
|-------|-----|----------|--------|---------|-----------|----------|-----------|-------|
| 00a | P00a | typescriptreviewer | [ ] | - | - | - | N/A | Preflight verification |
| 01 | P01 | typescriptexpert | [ ] | - | - | - | [ ] | Domain analysis |
| 01a | P01a | typescriptreviewer | [ ] | - | - | - | [ ] | Analysis verification |
| 02 | P02 | typescriptexpert | [ ] | - | - | - | [ ] | Pseudocode finalization |
| 02a | P02a | deepthinker | [ ] | - | - | - | [ ] | Pseudocode verification |
| 03 | P03 | typescriptexpert | [ ] | - | - | - | [ ] | AgentConfig types + Zod schema |
| 03a | P03a | typescriptreviewer | [ ] | - | - | - | [ ] | Config-schema verification |
| 04 | P04 | typescriptexpert | [ ] | - | - | - | [ ] | AgentEvent union + Zod schema |
| 04a | P04a | typescriptreviewer | [ ] | - | - | - | [ ] | Event-schema verification |
| 05 | P05 | typescriptexpert | [ ] | - | - | - | [ ] | Agent control-plane interface |
| 05a | P05a | typescriptreviewer | [ ] | - | - | - | [ ] | Control-plane interface verification |
| 06 | P06 | typescriptexpert | [ ] | - | - | - | [ ] | createAgent/Agent + sub-surface stubs |
| 06a | P06a | typescriptreviewer | [ ] | - | - | - | [ ] | Stubs verification |
| 07 | P07 | typescriptexpert | [ ] | - | - | - | [ ] | Non-breaking export strategy + internals subpath |
| 07a | P07a | typescriptreviewer | [ ] | - | - | - | [ ] | Export verification |
| 08 | P08 | typescriptexpert | [ ] | - | - | - | [ ] | Quality gate setup: Stryker/property tooling |
| 08a | P08a | typescriptreviewer | [ ] | - | - | - | [ ] | Quality gate setup verification |
| 09 | P09 | typescriptexpert | [ ] | - | - | - | [ ] | Harness L1 static/boundary T17/T23/T24 RED |
| 09a | P09a | typescriptreviewer | [ ] | - | - | - | [ ] | Harness L1 verification |
| 10 | P10 | typescriptexpert | [ ] | - | - | - | [ ] | Harness L2 event-characterization T16 RED |
| 10a | P10a | typescriptreviewer | [ ] | - | - | - | [ ] | Harness L2 verification |
| 11 | P11 | typescriptexpert | [ ] | - | - | - | [ ] | Harness L3 core-behavior RED |
| 11a | P11a | typescriptreviewer | [ ] | - | - | - | [ ] | Harness L3 verification |
| 12 | P12 | typescriptexpert | [ ] | - | - | - | [ ] | Harness L4 CLI-parity RED |
| 12a | P12a | typescriptreviewer | [ ] | - | - | - | [ ] | Harness L4 verification |
| 13 | P13 | typescriptexpert | [ ] | - | - | - | [ ] | Harness L5 resource-leak T13 RED |
| 13a | P13a | typescriptreviewer | [ ] | - | - | - | [ ] | Harness L5 verification |
| 14 | P14 | typescriptexpert | [ ] | - | - | - | [ ] | Impl adapters (config + event) |
| 14a | P14a | deepthinker | [ ] | - | - | - | [ ] | Adapters pseudocode-compliance verification |
| 15 | P15 | typescriptexpert | [ ] | - | - | - | [ ] | Impl createAgent + stream/chat + initial loop |
| 15a | P15a | deepthinker | [ ] | - | - | - | [ ] | createAgent pseudocode-compliance verification |
| 16 | P16 | typescriptexpert | [ ] | - | - | - | [ ] | Impl switch + context-preservation |
| 16a | P16a | deepthinker | [ ] | - | - | - | [ ] | Switch/context pseudocode-compliance verification |
| 17 | P17 | typescriptexpert | [ ] | - | - | - | [ ] | Impl tools/approval/loop |
| 17a | P17a | deepthinker | [ ] | - | - | - | [ ] | Tools/approval/loop verification |
| 18 | P18 | typescriptexpert | [ ] | - | - | - | [ ] | Impl auth/keys |
| 18a | P18a | typescriptreviewer | [ ] | - | - | - | [ ] | Auth/keys verification |
| 19 | P19 | typescriptexpert | [ ] | - | - | - | [ ] | Impl profiles CRUD + apply |
| 19a | P19a | typescriptreviewer | [ ] | - | - | - | [ ] | Profiles verification |
| 20 | P20 | typescriptexpert | [ ] | - | - | - | [ ] | Impl history/session/compression |
| 20a | P20a | typescriptreviewer | [ ] | - | - | - | [ ] | History/session/compression verification |
| 21 | P21 | typescriptexpert | [ ] | - | - | - | [ ] | Impl side-channel generate |
| 21a | P21a | typescriptreviewer | [ ] | - | - | - | [ ] | Generate verification |
| 22 | P22 | architect | [x] | - | done | PASS | [x] | Impl MCP runtime + IDE (structural schema + shipped env test doubles + discovery gate) |
| 22a | P22a | deepthinker | [x] | - | done | PASS | [x] | MCP/IDE verification — PASS |
| 23 | P23 | architect | [x] | - | done | PASS | [x] | Impl hooks/lifecycle + T19 scheduler-handle teardown slice + sandbox decision |
| 23a | P23a | deepthinker | [x] | - | done | PASS | [x] | Hooks/scheduler/sandbox verification — PASS |
| 24 | P24 | architect | [x] | - | done | PASS | [x] | Impl full dispose/teardown — ordered teardown per dispose.md; step-80 real extension teardown (remediated) |
| 24a | P24a | deepthinker | [x] | - | done | PASS | [x] | Dispose pseudocode-compliance verification — PASS (after 1 remediation cycle) |
| 25 | P25 | architect | [x] | - | done | PASS | [x] | Impl discovery helpers — static module (runtime-free composition seam; instance P15 untouched) |
| 25a | P25a | deepthinker | [x] | - | done | PASS | [x] | Discovery verification — PASS |
| 26 | P26 | architect | [x] | - | done | PASS | [x] | Impl non-interactive parity |
| 26a | P26a | deepthinker | [x] | - | done | PASS | [x] | Non-interactive verification |
| 27 | P27 | architect | [x] | - | done | PASS | [x] | Impl app-service subpaths + command→API map |
| 27a | P27a | deepthinker | [x] | - | done | PASS | [x] | App-service verification |
| 28 | P28 | typescriptexpert | [ ] | - | - | - | [ ] | Docs/agent-api.md |
| 28a | P28a | typescriptreviewer | [ ] | - | - | - | [ ] | Docs verification |
| 29 | P29 | deepthinker | [ ] | - | - | - | [ ] | Final plan-quality evaluation |

## Requirement → Phase coverage

| REQ | Title | Implemented in |
|-----|-------|----------------|
| REQ-001 | createAgent bootstrap/composition | P05, P15, P26 |
| REQ-002 | AgentConfig→ConfigParameters + field classification + sandbox | P03, P14, P23 |
| REQ-003 | Typed AgentEvent + 21-variant mapping + exactly-one-done | P04, P10, P14, P15, P26 |
| REQ-004 | Provider/model/param switching | P16 |
| REQ-005 | Context preservation across switch | P16 |
| REQ-006 | Tools/scheduler/confirmation + scheduler factory | P03, P05, P15, P17, P23, P24 |
| REQ-007 | High-level tool-loop via AgenticLoop | P17 |
| REQ-008 | Auth precedence/keys/MCP OAuth/secure-store | P18 |
| REQ-009 | Profiles CRUD + apply | P19 |
| REQ-010 | History/session/recording/checkpointing | P20 |
| REQ-011 | Compression | P20 |
| REQ-012 | Side-channel generate/generateJson/generateEmbedding | P21 |
| REQ-013 | MCP control + discovery gating | P22 |
| REQ-014 | IDE | P22 |
| REQ-015 | Hooks/lifecycle | P23 |
| REQ-016 | Dispose ownership/teardown | P15, P24 |
| REQ-017 | Discovery helpers and public type support | P03, P04, P05, P25 |
| REQ-018 | Export strategy | P07 |
| REQ-019 | No-deep-import / package-boundary / quality gate infrastructure | P08, P09, P13 |
| REQ-020 | Docs/agent-api.md | P28 |
| REQ-021 | Runtime-vs-app-service boundary + non-interactive parity | P26, P27 |

## Harness T-row → Phase coverage

| T-row | REQ | Phase RED | Phase GREEN |
|-------|-----|-----------|-------------|
| T1 | REQ-001/003 | P11 | P15 |
| T2 / T2b | REQ-006/007 | P11 / P10 | P17 |
| T3 / T3b / T3c | REQ-006/007 | P11 | P17 |
| T4 / T4b / T4c / T4d / T4e / T4f | REQ-004/005/009 | P12 | P16 (T4b also P19) |
| T5 | REQ-004 | P12 | P16 |
| T6 / T6b / T7 / T8 / T8b | REQ-010/011 | P11 | P20 |
| T9 | REQ-003 | P11 | P15 |
| T10 | REQ-012 | P11 | P21 |
| T11 | REQ-006 | P11 | P17 |
| T12 / T12b | REQ-013/017 | P12 | P22, P25 |
| T13 | REQ-016 | P13 | P15 (initial), P24 (full) |
| T14 / T14b | REQ-007/010 | P12 / P11 | P17 / P20 |
| T15 / T15b / T15c | REQ-014/015 | P12 | P22 / P23 |
| T16 | REQ-003 | P10 | P14/P15 |
| T17 | REQ-019 | P09 | boundary guard once imports clean |
| T18 / T18b / T18c | REQ-008 | P12 | P18 |
| T18d | REQ-009 | P12 | P19 |
| T18e | REQ-002/021 | P12 | P23 |
| T19 | REQ-006 | P13 | P23 |
| T20 | REQ-013 | P12 | P22 |
| T21 | REQ-007 | P11 | P17 |
| T22 | REQ-001/003/021 | P11/P12 | P26 |
| T23 / T24 | REQ-021 | P09 | P27 |
| T25 | REQ-001/017 | P12 | P15/P25 |

## Completion Markers

- [ ] All phases have @plan markers in code
- [ ] All requirements have @requirement markers
- [ ] All harness rows T1–T25 green
- [ ] No phases skipped (contiguous P00a→P29)
- [ ] Mutation gate (Stryker ≥80%) enforced by P08/P29
- [ ] Property-based ≥30% computed and enforced globally by P08/P29
- [ ] plan-evaluation.json compliant=true (P29)
