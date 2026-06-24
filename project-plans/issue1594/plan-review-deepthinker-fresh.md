# Independent Plan Review — Issue #1594 Core Public API

Verdict: FAIL

## BLOCKING issues

### B1 — Verification commands are not executable: the plan uses Vitest with a non-existent `--grep` flag throughout

**Location:** pervasive; examples: `plan/08-quality-gate-setup.md` verification command `npm test -- --grep "@plan:.*P08"`; `plan/09-harness-static-boundary.md`; `plan/10-harness-event-characterization.md`; all implementation phases P14–P28 and verifier phases similarly use `npm test -- --grep ...`.

**Problem:** This repo uses Vitest. In this workspace, `npx vitest --help` shows `-t, --testNamePattern <pattern>` and no `--grep`. Therefore most phase verification commands will fail for the harness/implementation phases even if the code is correct.

**Why it matters:** The coordinator cannot execute the plan as written. RED/GREEN phase gates, T-row checks, and final quality evaluation are all built around commands that do not run under the repository's test runner.

**Concrete fix:** Replace every `npm test -- --grep "..."`/`npm test -- --grep "T..."` with Vitest-supported syntax, e.g. `npm test -- --testNamePattern "..."` or `npm test -- -t "..."`, after confirming the plan markers/T-row IDs are actually in test names (not only comments). Update P08–P29 and all NNa verification files consistently.

---

### B2 — MCP discovery API is added in REQ/P22 but not added to the public type/interface phases

**Location:**
- `specification.md:421-428` requires `TurnOptions.mcpDiscovery:'skip'` and `AgentError{code:'mcp_discovery_failed'}`.
- `plan/12-harness-cli-parity.md:39` tests T20 against `TurnOptions.mcpDiscovery:'skip'` and `AgentError{code:'mcp_discovery_failed'}`.
- `plan/22-impl-mcp-ide.md:21,66-67` implements the same behavior.
- But `overview.md:472-476` defines `TurnOptions` as only `signal`, `promptId`, `maxTurns`; `specification.md` contains no `interface TurnOptions`; `plan/05-control-plane-interface.md` only says to define `TurnOptions`/`AgentResult` and its verification command never checks for `mcpDiscovery` or `AgentError`.

**Problem:** A new required public option and error shape are introduced after the interface/type phases, but no phase is instructed to add them to `packages/agents/src/api/agent.ts`/event or result types. Searches of the plan artifacts show `mcpDiscovery` only in REQ/P12/P22/P22a, not in the type/schema/interface phase instructions.

**Why it matters:** T20 cannot compile or be implemented cleanly if `TurnOptions` lacks `mcpDiscovery` and the public error/result shape lacks `AgentError`. Subagents will either invent ad hoc types in P22, mutate earlier interfaces out of phase, or leave the public API inconsistent with docs/tests.

**Concrete fix:** Amend P05 (and P04/P05 schemas/types if `AgentError` is part of `AgentEvent`/`AgentResult`) to explicitly define:
- `TurnOptions.mcpDiscovery?: 'await' | 'skip'` (or the chosen enum),
- the public `AgentError` shape including `code:'mcp_discovery_failed'`,
- how `stream()` emits it and how `chat()` carries it in `AgentResult.error`.
Update P05/P05a verification commands to grep/assert these fields and update docs P28 verification.

---

### B3 — External scheduler factory is required by the design but not specified as a real public contract; the plan is internally contradictory about its ownership

**Location:**
- Authoritative design `overview.md:898-904` requires an injected external/subagent scheduler factory and says the planner must define lifecycle, ownership, disposal, and public exposure.
- `specification.md` has no formal REQ text defining scheduler factory shape, no `AgentConfig` field for it, and no public interface type for it; the only mention is the T-row table at `specification.md:534`.
- `plan/03-config-schema.md:42-49` lists `ApprovalHandler`, `OAuthPromptHandler`, `EditorCallbacks` but not a scheduler factory field/type.
- `plan/05-control-plane-interface.md` does not require a scheduler factory type.
- `plan/13-harness-resource-leak.md:28-32` and `plan/23-impl-hooks-scheduler-sandbox.md:31-41` mention an injected scheduler factory but do not define the injection point or type.
- `analysis/domain-model.md:84-88` says caller-supplied injected scheduler factory is **NOT disposed**, while `plan/13-harness-resource-leak.md:30-32`, `plan/23-impl-hooks-scheduler-sandbox.md:34-41`, and P23 checklist require it to be torn down on dispose.

**Problem:** The plan knows T19 exists but never turns it into a precise API contract. It also contradicts itself: caller-supplied resources are not disposed, yet T19/P23 require the injected factory-created scheduler to be disposed.

**Why it matters:** This is a design-fidelity and executability failure. A subagent cannot implement or test T19 without knowing whether the user injects a factory via `AgentConfig`, `createAgent` options, an app-service, or internals; what it returns; who owns returned scheduler instances; and whether disposing them violates the “caller-supplied resources untouched” rule.

**Concrete fix:** Add an explicit public contract before implementation:
- Define the scheduler factory type and injection point in P03/P05 (likely `AgentConfig.schedulerFactory?: AgentSchedulerFactory` or a named `toolSchedulerFactory` field aligned with existing `ConfigParameters`).
- Define ownership precisely: the caller-supplied factory function is not disposed; scheduler instances created by `createAgent`/AgenticLoop through that factory are owned by the Agent and disposed, unless the contract says otherwise.
- Add pseudocode or a contract table for how createAgent passes it into `ConfigParameters`/scheduler creation and how P24 disposal records the created schedulers.
- Update P13/P23/P24 tests and verifiers to match that rule.

---

### B4 — Pseudocode discipline is still broken: implementation phases cite nonexistent numbered ranges

**Location:**
- `plan/17-impl-tools-approval-loop.md:61-68` says implement `tool-confirmation-merge.md` “lines 1-12” and “lines 14-28”, but the pseudocode file's numbered steps start at `10:` and use `20:`/`40:`/`60:`/`80:` (`analysis/pseudocode/tool-confirmation-merge.md`).
- `plan/24-impl-dispose-teardown.md:35-39` says `dispose.md` “lines 1-8”, “lines 9-22”, and “lines 24-end”, but the numbered pseudocode uses `10:`, `20:`, `30:`, `40:`, `45:`, `50:`, `60:`, `70:`, `80:`, `90:`, `100:`, `110:`.
- `plan/02-pseudocode.md` table says `event-adapter.md` is cited by P15, but P14 is the phase that actually implements the event adapter (`plan/14-impl-adapters.md`).

**Problem:** Several implementation phases do not cite the actual numbered pseudocode steps. They cite human line ranges or nonexistent ranges, contrary to PLAN.md's requirement that implementation phases reference numbered pseudocode accurately.

**Why it matters:** The coordinator cannot mechanically verify pseudocode compliance. This is especially risky for tool confirmation and dispose, two of the correctness-sensitive areas. It also undermines the `deepthinker` pseudocode-compliance gates because there is no exact range to verify.

**Concrete fix:** Rewrite P17 and P24 citations to the real numbered labels, e.g. `tool-confirmation-merge.md steps 10-31`, `40-45`, `60-71`, `80-89`; `dispose.md steps 10-14`, `20`, `30`, `40-45`, `50-52`, `60`, `70-82`, `90-102`, `110-113`. Fix P02's cited-by table for `event-adapter.md` to include P14 (and P15 only if P15 consumes the adapter through `stream()`). Update P17a/P24a to check those exact step labels.

---

### B5 — P08 mutation setup appears non-executable and references a target file that P08 does not create

**Location:** `plan/08-quality-gate-setup.md:30-55` creates `quality-gate-smoke.spec.ts`, `stryker.conf.json`, and a property-ratio script; verification at `plan/08-quality-gate-setup.md:65` runs `npx --workspace packages/agents stryker run packages/agents/stryker.conf.json --mutate "src/api/quality-gate-smoke.ts"`.

**Problem:** P08 never creates `packages/agents/src/api/quality-gate-smoke.ts`, only a smoke spec. The Stryker command mutates a production file that is not listed in Files to Create. The command syntax is also suspect for this repo: it uses `npx --workspace packages/agents` and passes `packages/agents/stryker.conf.json` while also running in a workspace context; this should be proven or corrected, not left for phase execution.

**Why it matters:** Mutation/property gates are a review criterion. If the quality-gate setup phase fails because its smoke target is missing or the command is invalid, all later phases are blocked. If subagents “fix” it ad hoc, the plan no longer provides deterministic coordination.

**Concrete fix:** Add an explicit tiny production file to P08, e.g. `packages/agents/src/api/quality-gate-smoke.ts`, and a behavioral spec for it, or change the Stryker mutate target to an actually existing file. Validate the exact command in this monorepo and use npm workspace-supported syntax consistently, for example `npm exec --workspace @vybestack/llxprt-code-agents -- stryker run stryker.conf.json ...` if that is the repo's working form.

## NON-BLOCKING issues / improvements

1. **P03 completeness verification under-checks the design field set.** `plan/03-config-schema.md:73-77` greps only a subset of the many fields listed in `overview.md` §4.2 and `specification.md`; it omits several fields such as `fileFiltering`, `recording`, `extensions`, `ide`, `hooks`, `memory`, `streamIdleTimeoutMs`, `toolOutputLimits`, `outputFormat`, `shell`, `contextLimit`, `skills`, `useWriteTodos`, and others. Strengthen the check or link it to the REQ-002 classification table.
2. **P18/P19 verification checks `tail -20 | grep -q "passing"`.** Vitest output may not include the literal word in the tailed section depending on failure/success formatting. Prefer relying on exit status plus `--testNamePattern`.
3. **P13/P23 ownership language should distinguish factory vs products.** This is blocking as written (B3), but once fixed, explicitly document “caller-owned factory is not disposed; Agent-owned scheduler instances created through it are disposed.”
4. **The plan includes previous review files under the same directory.** They are not part of the requested generated plan artifacts, but future grep-based verification should exclude `plan-review-*.md` to avoid false positives (as searches already found old `REQ-?` in review files).
5. **P27 is large.** It is much improved by forbidding deferred/unsupported results, but it still asks one subagent to implement MCP config, extensions/skills, memory, diagnostics, completions, package exports, and the command map. Consider splitting if any backing service is nontrivial; otherwise its verifier must be very strict.

## Coverage assessment — T1–T25 and REQ coverage

**T-row coverage:** Nominally, every T-row T1–T25 is allocated to a RED phase and GREEN phase in `execution-tracker.md:106-129` and the plan files:

- T1: P11 → P15, REQ-001/003.
- T2/T2b/T3/T3b/T3c/T11/T21: P11 → P17, REQ-006/007; T2b raw a2a path included.
- T4/T4b/T4c/T4d/T4e/T4f/T5: P12 → P16/P19, REQ-004/005/009.
- T6/T6b/T7/T8/T8b/T14b: P11 → P20, REQ-010/011.
- T9/T16: P10/P11 → P14/P15, REQ-003.
- T10: P11 → P21, REQ-012.
- T12/T12b/T20: P12 → P22/P25, REQ-013/017.
- T13/T19: P13 → P24/P23, REQ-016/006.
- T14: P11 → P17, REQ-007.
- T15/T15b/T15c: P12 → P22/P23, REQ-014/015 plus REQ-007/010 for save_memory refresh.
- T17: P09 boundary guard, REQ-019.
- T18/T18b/T18c/T18d/T18e: P12 → P18/P19/P23, REQ-008/009/002/021.
- T22: P11 → P26, REQ-001/003/021.
- T23/T24: P09 → P27, REQ-021.
- T25: P11/P12 → P15/P25, REQ-001/017.

However, coverage is **not executable** until B1/B2/B3/B4/B5 are fixed. T20's API is not in the interface phase, T19 lacks a real public contract, and all test invocations use an invalid Vitest flag.

**REQ coverage:** REQ-001 through REQ-021 are all nominally mapped in `execution-tracker.md:82-102`. There are no live `REQ-?` mappings in the plan/tracker/specification themselves (old `REQ-?` hits are in prior review artifacts). But REQ-006's scheduler-factory portion and REQ-013's MCP discovery option are incompletely specified in public types, and REQ-019's mutation gate setup is questionable.

## Yes/no assessment by requested dimension

1. **Design fidelity:** No. Most major design decisions are represented, including full control plane, 21-variant event mapping, correlationId semantics, auth precedence, context preservation, runtime-vs-app boundary, and non-breaking export sequencing. But scheduler-factory exposure/ownership is missing/contradictory, and MCP discovery adds public API not wired into the interface phase.
2. **Harness/requirement coverage:** No. T1–T25 and REQ-001–REQ-021 are nominally mapped, but T19 and T20 are not executable because their public contracts are incomplete; all harness commands use the wrong test-runner flag.
3. **TDD soundness:** No. The sequencing stubs → RED harness → implementation is structurally sound, but invalid verification commands prevent reliable RED/GREEN gates, and mutation setup has a missing mutate target.
4. **Pseudocode discipline:** No. The pseudocode files are contract-first and mostly strong, but P17/P24 cite nonexistent numbered ranges and P02 misstates event-adapter phase usage.
5. **Integration:** Yes, with caveats. CLI/#1595 and a2a consumers are named, boundary guards and app-service subpaths are planned, and export sequencing is non-breaking until #1595. P27 may be too broad but is directionally integrated.
6. **Coordination executability:** No. Phase numbering is contiguous and subagents/verifiers are named, but invalid commands and incomplete public contracts block execution.
7. **Open decisions:** Mostly yes, but not fully. Package entry, full control plane, sub-surfaces, no-handler semantics, MCP discovery behavior, idle-timeout, stats source, core/index trim timing, and app-service boundary are decided. Scheduler-factory public exposure/ownership remains under-specified despite being design-required.
8. **Correctness risks:** No. The plan addresses exactly-one done, stopped vs blocked, cached AgenticLoop client/rebuildLoop, shared runtime context/message bus, `await handle.activate()`, runtimeId, model-param lazy behavior, and correlationId. But the disposal/scheduler-factory ownership contradiction and missing `mcpDiscovery`/`AgentError` type contract leave significant correctness risks.
9. **Granularity:** Mixed / No. Most phases are appropriately scoped; P27 is broad, and P23 combines hooks, scheduler factory, and sandbox while one of those lacks a defined API contract.

## Overall summary

The revised plan is close in design intent and has strong coverage tables, but it is not executable as a coordinator plan. The most important blockers are mechanical (invalid Vitest `--grep` commands), public-contract gaps (`TurnOptions.mcpDiscovery`/`AgentError`, scheduler factory), and pseudocode citation errors in correctness-sensitive phases. Fix these before dispatching implementation subagents.
