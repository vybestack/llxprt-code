<!-- @plan:PLAN-20260622-COREAPIGAP.P00 @requirement:REQ-001..REQ-010,REQ-INT-001..REQ-INT-005 -->
# Plan: Close Agent API engine-capability gaps (prereq for #1595)

Plan ID: PLAN-20260622-COREAPIGAP
Generated: 2026-06-22
Issue: #2143 (prerequisite for #1595 "Refactor CLI to consume core API")
Predecessor: PLAN-20260621-COREAPIREMED (#1594 remediation, merged) — this plan is ADDITIVE on top.
Requirements: REQ-001 … REQ-010, REQ-INT-001 … REQ-INT-005.

> Counting note: phases are numbered 00a, 01/01a, 02/02a, then per-component triplets
> (TDD `NN` → impl `NN+1` → impl-verifier `(NN+1)a`) for REQ-001..007, then 17/17a … 22/22a,
> then 23 (final eval). The seven TDD phases (03, 05, 07, 09, 11, 13, 15) self-enforce RED via
> BLOCKING bash gates AND are retroactively re-audited (behavioral-RED, property ratio, no
> mock-theater / no reverse-test) by their paired impl-verifier (04a, 06a, 08a, 10a, 12a, 14a, 16a)
> — so every test file passes an independent architect gate even though TDD phases have no separate
> `a` file. The `00-overview.md` index is not itself a phase.

## Critical Reminders

Before implementing ANY phase:

1. Phase 00a (preflight) MUST pass first — every type / call-path / dependency assumption in the
   pseudocode is re-verified against current source, including the TWO corrected issue assumptions:
   (a) **`packages/cli/src/ui/commands/mcpAuth.ts` EXISTS** (`listOAuthServers:49`,
   `performMcpOAuth:82`) — the issue body's "no such file `mcpAuth.ts`" claim is FALSE; the real MCP
   OAuth flow is `MCPOAuthProvider.authenticate(:108)` → `manager.restartServer(:132)` →
   `agentClient.setTools(:136)`; (b) **Item A (auth detail) needs NO new constructor plumbing** —
   `OAuthManager` is ALREADY a field on `AgentDeps`/`AgentImpl` (`agentImpl.ts:121`); the
   auth-detail methods are wired by threading `this.deps.oauthManager` into `buildAuthControl()`
   (`agentImpl.ts:431`) via a closure only.
2. This plan is **purely additive to `packages/agents/src/api/**`** and makes the public agents
   surface ADEQUATE for the seven capabilities #1595's CLI commands drive directly from
   `core.Config` today. It modifies ONLY: `agent.ts`, `agentImpl.ts`, three NEW
   `control/<name>Control.ts` files, three EXTENDED control files, `api/index.ts`,
   `app-services/command-api-map.ts`, and `docs/agent-api.md`. It does **NOT** modify
   `packages/cli/**`, `packages/core/**`, `packages/providers/**`, `packages/policy/**`,
   `packages/mcp/**`, or `packages/tools/**` (those are consumed read-only; the CLI rewrite is
   #1595).
3. **Non-breaking is a HARD constraint (REQ-009).** Every current export of
   `@vybestack/llxprt-code-agents` keeps its exact shape; existing controller interfaces gain
   members but lose/rename none. Backed by an export-surface characterization test written as its
   own phase (P18) and re-asserted by the boundary phase.
4. **Integration-first adequacy:** the #1595 contract is an executable adequacy driver
   (`capabilityGaps.integration.spec.ts`, P20) that drives ALL seven capabilities through the
   PUBLIC ROOT `@vybestack/llxprt-code-agents` ONLY — proving the CLI could consume them without a
   single deep import or `agent.getConfig()` escape hatch. Because the controllers are implemented
   by the time it runs (P03–P16), a PASSING driver is its success condition; any real adequacy gap
   is fixed in the controllers (never by weakening the test). The boundary phase (P21) enforces the
   existing T17 no-deep-import guard (`boundary.spec.ts`) over the new `.spec.ts`.
5. **TDD discipline (gate-enforced):** TDD phases write BEHAVIORAL tests that FAIL for behavioral
   reasons (RED is ENFORCED — a TDD phase FAILS if its new tests unexpectedly pass, or fail for
   compile/import/setup reasons, per dev-docs/PLAN.md:733-737: reject only on
   `Cannot find module|SyntaxError|Failed to resolve import|ReferenceError`; a missing-method
   `TypeError` is ACCEPTABLE RED). ≥30% of tests are property-based (fast-check; the ratio is
   COMPUTED and ENFORCED, MIN-2 distinct property cases); NO mock theater
   (`toHaveBeenCalled`/`mockResolvedValue`/`mockReturnValue`); NO reverse tests
   (`toThrow('NotYetImplemented')`/`not.toThrow()`); NO structure-only assertions
   (`toHaveProperty`/`toBeDefined` as the sole assertion); no `any`. Impl phases cite pseudocode
   line numbers (`@pseudocode lines N-M`).
6. **Verification gates BLOCK:** every mandatory check EXITS NON-ZERO on violation (no
   print-and-continue); `|| true` is used ONLY where a grep finding nothing is the PASS case.
   Mutation ≥80% on each changed `src/api/**` file (Stryker, P22).
7. **Comment discipline (N5):** production code carries ONLY `@plan` / `@requirement` /
   `@pseudocode` marker blocks — no explanatory prose comments.
8. **Canonical single-file test command:** `npx vitest run <file>` (with `set -o pipefail`). NEVER
   `npm test --workspace pkg -- run <path>`. The monorepo-root `npm run test` oversubscribes CPU →
   timing/property flakes; re-run any failing file IN ISOLATION to confirm (CI runs packages
   separately).

---

## Summary

#1594 (+ its remediation) shipped `createAgent` / `fromConfig` returning an `Agent` facade whose
core interaction path (turn-drive, tools, streaming, settings, history, contract) is parity-proven.
A capability-coverage audit of `packages/cli/src/**` against that surface found **seven engine
capabilities the CLI drives directly from `core.Config` with no first-class `Agent` method**. If
left unaddressed, #1595 must keep `agent.getConfig().<coreMethod>()` escape hatches, defeating its
own acceptance criterion ("the CLI could be replaced with a different UI using the same core API").

| Gap | Title | Evidence (current source, verified) | Resolved by |
|---|---|---|---|
| G1 | Approval mode read/write | `useAutoAcceptIndicator.ts:27` (read) / `:41-47,:53` (write) → `config.getApprovalMode()` (`configBaseCore.ts:463`) / `config.setApprovalMode()` (`config.ts:401`, THROWS in untrusted folder `:404`) | REQ-001 — P03/P04 |
| G2 | Policy inspection (read-only) | `policiesCommand.ts:60` `getPolicyEngine()`, `:61` `getRules()`, `:110-111` `argsPattern.source`, `:125` `getDefaultDecision()`, `:128` `isNonInteractive()` | REQ-002 — P05/P06 |
| G3 | Async-task admin (`/task`) | `tasksCommand.ts:80,:117` `getAllTasks`, `:189` `getTask`, `:193` `getTaskByPrefix`, `:236` `cancelTask`; ESC-cancel `useGeminiStreamOrchestration.ts:109-112` | REQ-003 — P07/P08 |
| G4 | Hooks administration | `hooksCommand.ts` `getHookSystem()` (`:31,:74,…`), `getDisabledHooks()` (`:107,:177`), `setDisabledHooks()` (`:111,:180,…`) | REQ-004 — P09/P10 |
| G5 | Detailed OAuth state | `authCommand.ts` `peekStoredToken()`, `getHigherPriorityAuth()`, `getAuthStatusWithBuckets()` (OAuthManager) | REQ-005 — P11/P12 |
| G6 | MCP OAuth + deep detail | `mcpAuth.ts:82` real OAuth flow (authenticate→restartServer→setTools); `mcpControl.refresh()` lacks setTools parity (`mcpControl.ts:235-245`) | REQ-006 — P13/P14 |
| G7 | Built-in tool-key storage | `new ToolKeyStorage()` direct in `toolkeyCommand.ts` / `toolkeyfileCommand.ts` | REQ-007 — P15/P16 |

> The authoritative REQ→phase mapping is the table at the bottom of this file and the per-phase
> Prerequisites.

---

## Architectural Decisions (recap from specification.md)

- **Mirror the existing sub-controller convention EXACTLY — introduce no new patterns.** For each
  capability: declare the interface in `agent.ts` (alongside `AgentToolControl` / `AgentAuthControl`
  / `AgentMcpControl` / `AgentHookControl` at `agent.ts:223-321`); implement in
  `control/<name>Control.ts` (mirrors `control/authControl.ts`, `control/mcpControl.ts`); wire into
  `AgentImpl` as a `readonly <name>` field (near `:194-200`), instantiated in the ctor (near
  `:328-332`) via a `private build<Name>Control()` (near `:431-510`).
- **Three NEW sub-controllers, three EXTENDED, two top-level methods, two plumbing surfaces:**
  - NEW: `AgentPolicyControl` (`policy`), `AgentTasksControl` (`tasks`), `AgentToolKeyControl`
    (`tools.keys`).
  - EXTEND: `AgentHookControl` (admin), `AgentAuthControl` (detail), `AgentMcpControl` (OAuth +
    details + refresh parity) — existing members UNCHANGED.
  - TOP-LEVEL on `Agent`: `getApprovalMode()` / `setApprovalMode()` (mirrors the ephemeral-setting
    one-liners at `agentImpl.ts:726-738`; approval is a live engine setting, not a sub-state).
  - PLUMBING: barrel re-exports (`api/index.ts`) + `COMMAND_API_MAP` rows
    (`app-services/command-api-map.ts`).
- **Delegate, never cache (R-DELEGATE).** Every method resolves through `this.deps.config` /
  `this.deps.resolveClient()` / the injected closure PER CALL (mirrors `getConfig`/`getRuntimeId` at
  `agentImpl.ts:716-723`). No engine state is cached in a controller, so a later Config mutation is
  always reflected.
- **Undefined-safe backing managers (R-UNDEFINED-SAFE).** `getAsyncTaskManager()`, `getHookSystem()`
  and the MCP manager can all be absent; controllers return the idle/empty/no-op result
  (`[]`/`undefined`/`false`/`0`) — mirroring the `McpControl` idle idiom (`mcpControl.ts:121-124`).
- **Project public types that omit non-serializable internals.** `AgentTaskInfo` OMITS
  `abortController` (`asyncTaskManager.ts:28`); `PolicyRuleView.argsPattern` is the `.source` STRING
  (not a raw `RegExp`); auth/tool-key surfaces expose MASKED metadata only — NEVER raw token strings
  or secret values (R-NO-RAW-SECRETS, R-NO-ABORTCONTROLLER, R-ARGSPATTERN-STRING).
- **`setApprovalMode` delegates without try/catch (R-APPROVAL-THROW).** The untrusted-folder throw
  (`config.ts:404`) MUST propagate faithfully — the Agent method neither normalizes nor swallows it.
- **MCP `authenticate()` runs the REAL flow (R-MCP-OAUTH-FLOW)** —
  `MCPOAuthProvider.authenticate(serverName, oauthConfig, mcpServerUrl, undefined)` (events param is
  CLI-only; agents pass `undefined`) → `manager.restartServer(server)` →
  `resolveClient().setTools()`; and `refresh()` gains setTools parity (R-REFRESH-PARITY). The
  existing `mcp.auth(server)` per-agent-flag semantics are UNCHANGED.
- **`tools.keys` is DISTINCT from `auth.keys` (R-KEYS-DISTINCT).** `auth.keys` is provider-auth
  keys; `tools.keys` is built-in tool-key storage (`getToolKeyStorage()`).
- **Barrel re-exports value-vs-type correctness (R-BARREL-TYPEONLY).** Enums (`PolicyDecision`,
  `ApprovalMode`) re-export as VALUES; projected interfaces re-export `export type` (verbatimModule-
  Syntax); each surfaced via the existing `export type * from './agent.js'` where already covered.

---

## Subagent Role Table

| Role | Subagent | Phases |
|---|---|---|
| Implementation / worker | `typescriptexpert` | All `NN` worker phases (01, 02, 03–16, 17, 18, 19, 20, 21, 22) |
| Verification / review | `architect` | Preflight `00a`; every `NNa` verifier; the pseudocode-compliance gates on impl phases (04a, 06a, 08a, 10a, 12a, 14a, 16a); and the final plan-quality evaluation (23) |

> Each impl-verifier (`NNa`) independently re-audits the paired TDD phase's tests (behavioral-RED
> was real, ≥30% property ratio, no mock theater, no reverse tests) in addition to the
> pseudocode-compliance + mutation gate on the implementation.

---

## Requirements (full titles)

- **REQ-001** Approval mode — top-level `getApprovalMode(): ApprovalMode` /
  `setApprovalMode(mode): void` on `Agent`; untrusted-folder throw propagates (delegate, don't catch).
- **REQ-002** Read-only policy inspection — `agent.policy.getRules()` (snapshots,
  `argsPattern` → `.source` string) / `getDefaultDecision()` / `isNonInteractive()`.
- **REQ-003** Async-task administration — `agent.tasks.list/listRunning/get/cancel/cancelAllRunning`;
  undefined-safe; `cancelAllRunning()` returns the cancelled COUNT; `AgentTaskInfo` omits
  `abortController`.
- **REQ-004** Hooks administration — extend `AgentHookControl` with `listHooks` / `getDisabledHooks`
  / `setDisabledHooks` (+ convenience enable/disable); undefined-safe; existing exec/lifecycle
  members unchanged.
- **REQ-005** Detailed OAuth state — extend `Agent.auth` with `detailedStatus` /
  `getHigherPriorityAuth` / `listBucketStatuses`; MASKED metadata only (no raw tokens).
- **REQ-006** MCP OAuth + deep detail + refresh parity — extend `Agent.mcp` with `authenticate`
  (real flow) / `details` / `refresh()` setTools parity; undefined-safe.
- **REQ-007** Built-in tool-key storage — `agent.tools.keys` (`supported` / `status` (masked) /
  `save` / `delete` / `setKeyFile` / `getKeyFile`); distinct from `auth.keys`.
- **REQ-008** Public barrel re-exports + `COMMAND_API_MAP` registration of the six target commands.
- **REQ-009** Non-breaking guarantee — additive only; export-surface characterization.
- **REQ-010** Documentation — `docs/agent-api.md` documents every new surface.
- **REQ-INT-001..004** CLI-parity adequacy — each capability is reachable and behaves identically to
  the CLI's current direct-`Config` path, driven through the PUBLIC ROOT only.
- **REQ-INT-005** No-deep-import boundary — the adequacy driver imports ONLY
  `@vybestack/llxprt-code-agents` (T17 `boundary.spec.ts`).

---

## Phase Index (CONTIGUOUS — NO SKIPPED NUMBERS)

| Phase | File | Worker | Title |
|---|---|---|---|
| 00a | `00a-preflight-verification.md` | architect | Preflight: re-verify all anchors (incl. mcpAuth.ts-exists + oauthManager-already-on-deps) |
| 01 | `01-analysis.md` | typescriptexpert | Domain analysis (confirm `analysis/domain-model.md`) |
| 01a | `01a-analysis-verification.md` | architect | Verify analysis |
| 02 | `02-pseudocode.md` | typescriptexpert | Pseudocode (confirm `analysis/pseudocode/*.md`) |
| 02a | `02a-pseudocode-verification.md` | architect | Verify pseudocode (contract-first sections, real anchors) |
| 03 | `03-approval-tdd.md` | typescriptexpert | REQ-001 approval mode — behavioral RED tests |
| 04 | `04-approval-impl.md` | typescriptexpert | REQ-001 approval mode — impl (cite approval-mode.md) |
| 04a | `04a-approval-impl-verification.md` | architect | Pseudocode-compliance gate + re-audit P03 tests |
| 05 | `05-policy-tdd.md` | typescriptexpert | REQ-002 policy control — behavioral RED tests |
| 06 | `06-policy-impl.md` | typescriptexpert | REQ-002 policy control — impl (cite policy-control.md) |
| 06a | `06a-policy-impl-verification.md` | architect | Pseudocode-compliance gate + re-audit P05 tests |
| 07 | `07-tasks-tdd.md` | typescriptexpert | REQ-003 tasks control — behavioral RED tests |
| 08 | `08-tasks-impl.md` | typescriptexpert | REQ-003 tasks control — impl (cite tasks-control.md) |
| 08a | `08a-tasks-impl-verification.md` | architect | Pseudocode-compliance gate + re-audit P07 tests |
| 09 | `09-hooks-admin-tdd.md` | typescriptexpert | REQ-004 hooks admin — behavioral RED tests |
| 10 | `10-hooks-admin-impl.md` | typescriptexpert | REQ-004 hooks admin — impl (cite hooks-admin.md) |
| 10a | `10a-hooks-admin-impl-verification.md` | architect | Pseudocode-compliance gate + re-audit P09 tests |
| 11 | `11-auth-detail-tdd.md` | typescriptexpert | REQ-005 auth detail — behavioral RED tests |
| 12 | `12-auth-detail-impl.md` | typescriptexpert | REQ-005 auth detail — impl (cite auth-detail.md) |
| 12a | `12a-auth-detail-impl-verification.md` | architect | Pseudocode-compliance gate + re-audit P11 tests |
| 13 | `13-mcp-oauth-tdd.md` | typescriptexpert | REQ-006 MCP OAuth/details/refresh — behavioral RED tests |
| 14 | `14-mcp-oauth-impl.md` | typescriptexpert | REQ-006 MCP OAuth/details/refresh — impl (cite mcp-oauth.md) |
| 14a | `14a-mcp-oauth-impl-verification.md` | architect | Pseudocode-compliance gate + re-audit P13 tests |
| 15 | `15-tool-keys-tdd.md` | typescriptexpert | REQ-007 tool keys — behavioral RED tests |
| 16 | `16-tool-keys-impl.md` | typescriptexpert | REQ-007 tool keys — impl (cite tool-keys.md) |
| 16a | `16a-tool-keys-impl-verification.md` | architect | Pseudocode-compliance gate + re-audit P15 tests |
| 17 | `17-barrel-and-command-map.md` | typescriptexpert | REQ-008 barrel re-exports + `COMMAND_API_MAP` rows (cite barrel-exports.md, command-map.md) |
| 17a | `17a-barrel-and-command-map-verification.md` | architect | Verify exports value/type-correct + map invariants |
| 18 | `18-non-breaking.md` | typescriptexpert | REQ-009 export-surface non-breaking characterization |
| 18a | `18a-non-breaking-verification.md` | architect | Verify nothing removed/renamed |
| 19 | `19-docs.md` | typescriptexpert | REQ-010 `docs/agent-api.md` updates |
| 19a | `19a-docs-verification.md` | architect | Verify docs accuracy against code |
| 20 | `20-integration-adequacy-driver.md` | typescriptexpert | REQ-INT-001..004 `capabilityGaps.integration.spec.ts` (all 7 caps via public root) |
| 20a | `20a-integration-adequacy-verification.md` | architect | Verify adequacy proven, public-root-only on driver path |
| 21 | `21-boundary-and-nonbreaking.md` | typescriptexpert | REQ-INT-005 T17 no-deep-import boundary over new `.spec.ts` + final non-breaking sweep |
| 21a | `21a-boundary-and-nonbreaking-verification.md` | architect | Verify boundary + non-breaking |
| 22 | `22-quality-gates.md` | typescriptexpert | Full suite (test/lint/typecheck/format/build + smoke) + mutation ≥80% |
| 22a | `22a-quality-gates-verification.md` | architect | Verify gates output |
| 23 | `23-final-plan-quality-eval.md` | architect | Final plan-quality evaluation (integration-first, no isolation) |

---

## REQ → Phase Mapping (authoritative)

| Requirement | Worker phases | Verifier phases |
|---|---|---|
| REQ-001 (approval) | 03, 04 | 04a |
| REQ-002 (policy) | 05, 06 | 06a |
| REQ-003 (tasks) | 07, 08 | 08a |
| REQ-004 (hooks admin) | 09, 10 | 10a |
| REQ-005 (auth detail) | 11, 12 | 12a |
| REQ-006 (MCP OAuth) | 13, 14 | 14a |
| REQ-007 (tool keys) | 15, 16 | 16a |
| REQ-008 (barrel + map) | 17 | 17a |
| REQ-009 (non-breaking) | 18 (+ every impl phase) | 18a, 21a |
| REQ-010 (docs) | 19 | 19a |
| REQ-INT-001..004 (CLI parity) | 20 | 20a |
| REQ-INT-005 (no-deep-import) | 20, 21 | 20a, 21a |

---

## Gap → REQ → Phase (the seven gaps, explicit)

| Gap | REQ | First proven adequate at |
|---|---|---|
| G1 (approval mode) | REQ-001, REQ-INT-001 | P04 impl; adequacy driver P20 |
| G2 (policy inspection) | REQ-002, REQ-INT-002 | P06 impl; P20 |
| G3 (async tasks) | REQ-003, REQ-INT-002 | P08 impl; P20 |
| G4 (hooks admin) | REQ-004, REQ-INT-003 | P10 impl; P20 |
| G5 (auth detail) | REQ-005, REQ-INT-003 | P12 impl; P20 |
| G6 (MCP OAuth) | REQ-006, REQ-INT-004 | P14 impl; P20 |
| G7 (tool keys) | REQ-007, REQ-INT-004 | P16 impl; P20 |

---

## #1595 Adequacy Statement

When phases 03–21 are green, the public `@vybestack/llxprt-code-agents` surface provides everything
#1595 needs to replace the seven `core.Config` escape hatches with first-class `Agent` calls:
approval-mode read/write (preserving the untrusted-folder throw), read-only policy inspection, the
full `/task` admin surface, hooks registry administration, masked detailed OAuth state, the real MCP
OAuth flow + deep details + refresh-with-setTools parity, and masked built-in tool-key storage —
each re-exported from the public root, registered in `COMMAND_API_MAP`, non-breaking, and proven by
an executable adequacy driver that imports ONLY the public root (no `getConfig()` escape hatch, no
deep import). The final evaluation (P23) rejects the plan if any capability still requires reaching
through `agent.getConfig()` or a deep import to drive its CLI command.
