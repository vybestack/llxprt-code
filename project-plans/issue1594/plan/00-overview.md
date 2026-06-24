# Plan Overview: Core Public Agent API (Issue #1594)

Plan ID: PLAN-20260617-COREAPI
Generated: 2026-06-17
Total Phases: 59 (1 preflight + 28 worker + 28 verification + 1 final eval)
Requirements: REQ-001 … REQ-021

## Summary

`createAgent`/`Agent` is a **composition over shipped engine primitives**
(`createIsolatedRuntimeContext` / shared providers-runtime composition in providers #2033, `AgenticLoop` in agents #2034),
published from `@vybestack/llxprt-code-agents`. This plan turns `overview.md` into a
test-first TDD spine: a CLI-touchpoint + event-characterization harness is written
against compiling stubs (RED) and then driven GREEN by behavior-preserving wrapper
implementations, each referencing numbered pseudocode.

This is **not an isolated feature**: the harness in `packages/agents/src/api/__tests__/`
is the executable contract that **#1595 (CLI rewrite)** and **a2a-server** consume.
The CLI stops deep-importing `core`/`providers`/`tools` internals to run turns,
switch providers, approve tools, manage auth, or compress history. `core/index.ts`
trim and the CLI rewrite itself are #1595.

## Subagents (per COORDINATING.md — ONE PHASE = ONE SUBAGENT)

| Role | Subagent | Used for |
|---|---|---|
| Worker (stub/TDD/impl/docs/export) | `typescriptexpert` | all worker phases (NN) |
| Verifier | `typescriptreviewer` | all verification phases (NNa), incl. preflight (P00a) |
| Pseudocode-compliance + deep/semantic review | `deepthinker` | pseudocode-backed impl-phase verifiers + final plan eval |
| Final plan-quality evaluation | `deepthinker` | last phase (P29) |

Every NN phase = `typescriptexpert`; every NNa = `typescriptreviewer` **except** the
pseudocode-compliance gates (P02a, P14a, P15a, P16a, P17a, P24a) which are
`deepthinker`; the final evaluation phase (P29) is `deepthinker`.

Verifier-only phases (`*a`) are verification artifacts: they follow COORDINATING.md with explicit checks and completion markers, but they do not repeat worker-phase `Requirements Implemented (Expanded)` sections unless they create or modify deliverable artifacts.

### Comment discipline (N5)

Production code carries `@plan:PLAN-20260617-COREAPI.P<NN>` + `@requirement:REQ-xxx`
marker blocks ONLY. No extra explanatory prose comments beyond those marker blocks —
the project prefers sparse comments. Verifiers SHOULD flag superfluous narration.


## Formal Requirements (REQ list)

| REQ | Title | Harness rows |
|---|---|---|
| REQ-001 | createAgent bootstrap/composition (ordering: provider-manager + shared settings set before refreshAuth; valid runtimeId; post-auth client bind) | T25, T1 |
| REQ-002 | AgentConfig→ConfigParameters translation incl. full field classification table | (all; adapter underpins T1) |
| REQ-003 | Typed AgentEvent stream + complete 21-variant mapping + exactly-one-`done` | T16, T1, T8, T9 |
| REQ-004 | provider/model/param switching wrapping providers/runtime | T4, T5 |
| REQ-005 | context-preservation-across-switch (same HistoryService; stripThoughts normalize) | T4d, T4e, T4f, T4c |
| REQ-006 | tools/scheduler/confirmation incl. correlationId + dual consumer paths | T2, T3, T3b, T3c, T2b |
| REQ-007 | high-level tool-loop via AgenticLoop wrapping | T21, T2 |
| REQ-008 | auth control plane (/auth /key /keyfile precedence, buckets, MCP OAuth, secure-store + profile-save) | T18, T18b, T18c |
| REQ-009 | profiles CRUD+apply (standard+load-balancer) | T4b, T18d |
| REQ-010 | history/session/recording/checkpointing | T6, T6b, T7, T14b |
| REQ-011 | compression (explicit+automatic) | T8 |
| REQ-012 | side-channel generate/generateJson/generateEmbedding (detached) | T10 |
| REQ-013 | MCP control + discovery gating | T12b, T20 |
| REQ-014 | IDE | T15 |
| REQ-015 | hooks/lifecycle | T15b, T15c |
| REQ-016 | dispose ownership/teardown table | T13 |
| REQ-017 | discovery helpers (static + instance) | T12 |
| REQ-018 | export strategy + non-breaking root + power-user subpath (core/index trim sequenced into #1595) | T23 |
| REQ-019 | no-deep-import/package-boundary guard | T17 |
| REQ-020 | docs/agent-api.md | (doc phase) |
| REQ-021 | runtime-vs-app-service boundary + command→API map + non-interactive | T22, T23, T24, T8b, T19, T18e |

Full REQ text lives in `specification.md` §Formal Requirements; each phase file
re-expands the REQs it implements.

## Harness layering (overview §9)

1. **Static / boundary** — T17 (no-deep-import), T23 (durable app-service subpaths), T24 (completions boundary).
2. **Event characterization** — T16 (21-variant table), driven at real emission sites with JSONL fixtures + injection.
3. **Core Agent behavior** — T1, T8, T8b, T9, T10, T6, T6b, T7, T14b.
4. **CLI-parity integration** — T2/T2b/T3/T3b/T3c, T4/T4b/T4c/T4d/T4e/T4f, T5, T12/T12b, T15/T15b/T15c, T18/T18b/T18c/T18d/T18e, T19, T20, T21, T22, T25.
5. **Resource-leak** — T13 (ownership-table-driven disposal).

## Mapping to overview.md §8 phasing

| §8 sketch step | Plan phases |
|---|---|
| 0. Preflight (event table, capability checklist, contract tables) | P00a, P01/P01a (analysis), P02/P02a (pseudocode) |
| 1. Public types + stubs + subpath exports + quality gate setup | P03/P03a (config-schema), P04/P04a (event-schema), P05/P05a (control-plane-interface), P06/P06a (stubs), P07/P07a (export strategy), P08/P08a (mutation/property tooling) |
| 2. CLI-touchpoint harness (test-first) | P09/P09a (static/boundary), P10/P10a (event-characterization), P11/P11a (core-behavior), P12/P12a (cli-parity), P13/P13a (resource-leak) |
| 3. createAgent + core conversation | P14/P14a (adapters), P15/P15a (createAgent+event mapping+dispose) |
| 4. Control-plane methods (split) | P16..P24 (switch/context, tools/loop, auth/keys, profiles, history/session/compression, generate, mcp/ide, hooks/scheduler/sandbox, dispose-impl) |
| 5. Discovery / non-interactive / app-service | P25/P25a (discovery), P26/P26a (non-interactive), P27/P27a (app-service) |
| 6. Docs | P28/P28a |
| Final plan-quality eval | P29 |

## Phase Index (contiguous, NN worker / NNa verifier — NO skipped numbers)

| Phase | Title | Subagent |
|---|---|---|
| 00a | Preflight verification | typescriptreviewer |
| 01 | Domain analysis | typescriptexpert |
| 01a | Analysis verification | typescriptreviewer |
| 02 | Pseudocode finalization | typescriptexpert |
| 02a | Pseudocode verification | deepthinker |
| 03 | AgentConfig types + Zod schema | typescriptexpert |
| 03a | Config-schema verification | typescriptreviewer |
| 04 | AgentEvent union + Zod schema | typescriptexpert |
| 04a | Event-schema verification | typescriptreviewer |
| 05 | Agent control-plane interface | typescriptexpert |
| 05a | Control-plane interface verification | typescriptreviewer |
| 06 | createAgent/Agent + sub-surface stubs | typescriptexpert |
| 06a | Stub verification | typescriptreviewer |
| 07 | Non-breaking export strategy + internals subpath | typescriptexpert |
| 07a | Export verification | typescriptreviewer |
| 08 | Quality gate setup (Stryker/property tooling) | typescriptexpert |
| 08a | Quality gate setup verification | typescriptreviewer |
| 09 | Harness L1: static/boundary tests (T17/T23/T24) RED | typescriptexpert |
| 09a | Harness L1 verification | typescriptreviewer |
| 10 | Harness L2: event-characterization (T16) RED | typescriptexpert |
| 10a | Harness L2 verification | typescriptreviewer |
| 11 | Harness L3: core Agent behavior RED | typescriptexpert |
| 11a | Harness L3 verification | typescriptreviewer |
| 12 | Harness L4: CLI-parity integration RED | typescriptexpert |
| 12a | Harness L4 verification | typescriptreviewer |
| 13 | Harness L5: resource-leak (T13) RED | typescriptexpert |
| 13a | Harness L5 verification | typescriptreviewer |
| 14 | Impl: Config adapter + event adapter | typescriptexpert |
| 14a | Adapters pseudocode-compliance verification | deepthinker |
| 15 | Impl: createAgent bootstrap + core conversation | typescriptexpert |
| 15a | createAgent pseudocode-compliance verification | deepthinker |
| 16 | Impl: provider/model/param switch + context preservation | typescriptexpert |
| 16a | Switch/context pseudocode-compliance verification | deepthinker |
| 17 | Impl: tools/approval/loop merge | typescriptexpert |
| 17a | Tools/loop pseudocode-compliance verification | deepthinker |
| 18 | Impl: auth/keys control plane | typescriptexpert |
| 18a | Auth/keys verification | typescriptreviewer |
| 19 | Impl: profiles CRUD + apply | typescriptexpert |
| 19a | Profiles verification | typescriptreviewer |
| 20 | Impl: history/session/compression | typescriptexpert |
| 20a | History/compression verification | typescriptreviewer |
| 21 | Impl: side-channel generate | typescriptexpert |
| 21a | Generate verification | typescriptreviewer |
| 22 | Impl: MCP control + IDE | typescriptexpert |
| 22a | MCP/IDE verification | typescriptreviewer |
| 23 | Impl: hooks/lifecycle + scheduler factory + sandbox status | typescriptexpert |
| 23a | Hooks/lifecycle/sandbox verification | typescriptreviewer |
| 24 | Impl: full dispose/teardown wiring | typescriptexpert |
| 24a | Dispose pseudocode-compliance verification | deepthinker |
| 25 | Impl: discovery helpers | typescriptexpert |
| 25a | Discovery verification | typescriptreviewer |
| 26 | Impl: non-interactive parity | typescriptexpert |
| 26a | Non-interactive verification | typescriptreviewer |
| 27 | Impl: app-service subpaths + command→API map | typescriptexpert |
| 27a | App-service/boundary verification | typescriptreviewer |
| 28 | Docs: docs/agent-api.md | typescriptexpert |
| 28a | Docs verification | typescriptreviewer |
| 29 | Final plan-quality eval | deepthinker |

> Numbering is **contiguous** NN worker / NNa verifier with **no skipped numbers**
> (per COORDINATING.md). COORDINATING.md sequential execution:
> P00a → P01 → P01a → P02 → P02a → P03 → P03a → … → P28 → P28a → P29.

## Open-question decisions (resolved by this plan)

See `specification.md` §Architectural Decisions for the one-line rationale on each:
entry = `@vybestack/llxprt-code-agents`; control plane = full (option B);
sub-surfaces (`tools/mcp/auth/ide/session/hooks/profiles`) are public methods;
**no-handler confirmation behavior follows the real `AgenticLoop`** (see below);
idle-timeout → **terminal**; `core/index.ts` trim sequenced into **#1595**; stats
canonical source = **telemetry `uiTelemetryService`** imported via the legal core
re-export subpath `@vybestack/llxprt-code-core/telemetry/uiTelemetry.js` (no new dep);
docs file = **`docs/agent-api.md`** (entry is `-agents`, not `-core`).

### No-handler confirmation behavior (B7 resolution)

The public `Agent.chat()`/`stream()` **delegate to `AgenticLoop`**, so the public
behavior MUST match the loop, not the scheduler coordinator:

- **No approval handler + `ASK_USER` required (non-interactive):** `AgenticLoop`
  converts this to a **safe tool error / denial** (verified docstring +
  `AgenticLoop.ts`), it does NOT throw. The public path therefore yields a denied
  `tool-result` and the turn continues/ends cleanly.
- **Approval-handler rejection:** `AgenticLoop` converts to
  `ToolConfirmationOutcome.Cancel` (denial) — a denied `tool-result`, not a throw.
- **Coordinator throw is scoped:** `confirmation-coordinator.setupConfirmationPrompt`
  throws only when invoked directly in non-interactive mode WITHOUT going through the
  loop's safe-denial path. The public Agent does not expose that raw path as a
  default; it is documented as a low-level (`./internals.js`) behavior.

Tests T3/T11/T21 assert the **loop safe-denial** semantics for the high-level Agent
surface; the coordinator-throw is asserted only where the raw coordinator path is
explicitly exercised (documented power-user/internals path).
