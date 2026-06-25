<!-- @plan:PLAN-20260622-MCPOAUTHTRUTH.P00 @requirement:REQ-001..REQ-005,REQ-INT-001..REQ-INT-002 -->
# Plan: Report real persisted MCP OAuth truth through the Agent API (prereq for #1595)

Plan ID: PLAN-20260622-MCPOAUTHTRUTH
Generated: 2026-06-22
Issue: #2165 (prerequisite for #1595 "Refactor CLI to consume core API")
Predecessor: PLAN-20260622-COREAPIGAP (#2143, PR #2156 merged) — G6 added the MCP OAuth
`authenticate()` + `details()` surface. THIS plan corrects the *truth* that surface reports.
Requirements: REQ-001 … REQ-005, REQ-INT-001 … REQ-INT-002.

> Counting note: phases are numbered 00/00a, 01/01a, 02/02a, then two implementation triplets
> (TDD `NN` → impl `NN+1` → impl-verifier `(NN+1)a`) — Phase 1 (engine helper, 03/04/04a) and
> Phase 2 (agents projection, 05/06/06a) — then 07/07a (non-breaking), 08/08a (quality gates),
> and 09 (final plan-quality eval). The two TDD phases (03, 05) self-enforce RED via BLOCKING bash
> gates AND are retroactively re-audited (behavioral-RED, property ratio, no mock-theater, no
> reverse-test) by their paired impl-verifier (04a, 06a). The `00-overview.md` index is not itself
> a phase.

## Critical Reminders

Before implementing ANY phase:

1. Phase 00a (preflight) MUST pass first — every type / call-path / barrel anchor this plan depends
   on is re-verified against current source, including the THREE ground-truthed design corrections:
   (a) the canonical token read is the **static** `MCPOAuthTokenStorage.getToken(serverName):
   Promise<MCPOAuthCredentials | null>` (`oauth-token-storage.ts:104-110`, casts at `:109`) whose
   result carries `.token: MCPOAuthToken` (`token-store.ts:45`) — the new helper threads
   `credentials.token` into the **static** `MCPOAuthTokenStorage.isTokenExpired(token)`
   (`oauth-token-storage.ts:130-136`) and MUST NOT copy the CLI's `isTokenExpired(token as never)`
   cast; (b) `mcpServerRequiresOAuth` is a module-level `Map<string, boolean>`
   (`mcp-status.ts:46`) that is **monotonic / true-only** (writers `mcp-connection.ts:269,:318`
   both set `true`; ZERO clear/delete/set-false anywhere) — tests reset it by deleting keys between
   cases; (c) the agents projection's current `authenticated`/`requiresAuth` are **hardcoded /
   in-session-only** (`mcpControl.ts:254,:258,:321,:336,:403`) — they are the defect this plan
   fixes, NOT a contract to preserve verbatim.
2. This plan touches exactly **two production packages**: `packages/mcp` (Phase 1: one NEW
   `auth/oauth-status.ts` + barrel) and `packages/agents` (Phase 2: project the corrected truth
   through `agent.ts` types, `control/mcpControl.ts`, `control/mcpControlWiring.ts`, and the api
   barrel). It also re-exports the new helper/type through the `packages/core` barrel
   (`core/src/index.ts`, the mcp re-export groups at `:486-503` value / `:505-514` type). It does
   **NOT** modify `packages/cli/**` (the CLI tri-state at `mcpDisplay.ts` is the reference we
   canonicalize, replaced in #1595), `packages/providers/**`, `packages/policy/**`, or
   `packages/tools/**`.
3. **Engine owns expiry (R-INNER-TOKEN, R-FAULT-TOLERANT).** The single source of truth for "is
   this server's persisted OAuth still valid" is the new engine helper
   `getMcpServerOAuthStatus(serverName, opts?)` in `packages/mcp`. Every consumer (agents now; CLI
   in #1595) delegates to it. No consumer re-derives expiry, re-reads the token store, or copies the
   5-minute skew buffer. The helper is **fault-tolerant**: any token-read failure resolves to
   `'none'` (never throws, never leaks).
4. **Non-breaking is a HARD constraint (REQ-004).** Every current export of
   `@vybestack/llxprt-code-agents` and `@vybestack/llxprt-code-mcp` keeps its exact shape;
   `McpServerAuthStatus` / `McpServerDetail` GAIN fields (`oauthStatus`, `sessionAuthenticated`) but
   lose/rename none, and `authenticated` keeps its NAME (its *meaning* is corrected to
   `oauthStatus === 'authenticated'`). Backed by the existing additive-surface guards
   (`additiveSurface.types.ts`, `nonBreaking.exports.test.ts`, `publicSurface.nonbreaking.test.ts`),
   extended in P07.
5. **Integration-first adequacy:** the #1595 contract is that the public agents root reports MCP
   OAuth truth that MATCHES the engine helper, with `sessionAuthenticated` distinct from
   `oauthStatus`. The Phase-2 behavioral suite drives this through the PUBLIC ROOT
   `@vybestack/llxprt-code-agents` + the BLESSED `new McpControl(deps)` seam ONLY (the `.behavior`/
   `.spec` T17 boundary). Any real adequacy gap is fixed in the controller/helper, never by
   weakening a test.
6. **TDD discipline (gate-enforced):** TDD phases write BEHAVIORAL tests that FAIL for behavioral
   reasons (RED is ENFORCED — a TDD phase FAILS if its new tests unexpectedly pass, or fail for
   compile/import/setup reasons, per dev-docs/PLAN.md:733-737: reject only on
   `Cannot find module|SyntaxError|Failed to resolve import|ReferenceError`; a missing-export /
   wrong-value behavioral failure is ACCEPTABLE RED). ≥30% of tests are property-based (fast-check;
   the ratio is COMPUTED and ENFORCED, MIN-2 distinct property cases); NO mock theater
   (`toHaveBeenCalled`/`mockResolvedValue`/`mockReturnValue`/`vi.fn(`/`vi.spyOn`); NO reverse tests
   (`toThrow('NotYetImplemented')`/`not.toThrow()`); NO structure-only assertions
   (`toHaveProperty`/`toBeDefined` as the sole assertion); no `any`. Impl phases cite pseudocode
   line numbers (`@pseudocode lines N-M`).
7. **Verification gates BLOCK:** every mandatory check EXITS NON-ZERO on violation (no
   print-and-continue); `|| true` is used ONLY where a grep finding nothing is the PASS case.
8. **Mutation is a behavioral MEASUREMENT, not a coverage chase (LOCKED POLICY — see
   specification.md "Mutation-testing policy").** P08 mutates ONLY the two logic-bearing files
   (`packages/mcp/src/auth/oauth-status.ts` — the 4-outcome decision + OR-combine + catch→`none`;
   and the corrected projection in `packages/agents/src/api/control/mcpControl.ts`). A SURVIVING
   mutant is a REVIEW QUESTION ("is there a real observable behavior we forgot to assert?") → add a
   BEHAVIORAL case if yes; LEAVE IT SURVIVED (with a `// Stryker disable next-line` + written
   reason) if killing it would require a private/internal/mock-call assertion or it is genuinely
   equivalent. Glue/setters/barrels are NEVER mutated. Behavioral honesty (RULES.md) OVERRIDES the
   80% number; any file that cannot reach 80% without a RULES.md violation documents why in P08.
9. **Comment discipline (N5):** production code carries ONLY `@plan` / `@requirement` /
   `@pseudocode` marker blocks — no explanatory prose comments.
10. **Canonical single-file test command:** `npx vitest run <file>` (with `set -o pipefail`). NEVER
    `npm test --workspace pkg -- run <path>`. The monorepo-root `npm run test` oversubscribes CPU →
    timing/property flakes; re-run any failing file IN ISOLATION to confirm (CI runs packages
    separately).

---

## Summary

#2143 (PR #2156, merged) gave the public `Agent` API an MCP OAuth surface: `agent.mcp.authenticate`,
`agent.mcp.details`, and `McpServerAuthStatus` / `McpServerDetail` projections. But that surface
reports **two falsehoods** and is **missing one distinction** that #1595's CLI must have:

| Defect | Current behaviour (verified source) | Truth we need |
|---|---|---|
| D1 | `authenticated` reflects the **in-session** marker only (`mcpControl.ts:254,:403` read `isMcpAuthenticated` → `agentImpl.ts:500` → `this.authState.mcpAuth.has(server)`; that Set starts EMPTY `authState.ts:86`, written ONLY by `auth.mcpLogin` `authControl.ts:214` + a successful `authenticate` `agentImpl.ts:502`). A server with a **valid persisted token** but no in-session login reports `authenticated:false`. | `authenticated` must mean "has a valid (non-expired) persisted OAuth credential", derived from the engine helper. |
| D2 | `requiresAuth` is **hardcoded `true`** (`mcpControl.ts:258,:321,:336`). Every server — even ones with no OAuth configured — claims it requires auth. | `requiresAuth` must be real: `server.oauth?.enabled === true` OR `mcpServerRequiresOAuth.has(server)`. |
| D3 | There is **no way to tell** "valid persisted token" from "logged in THIS session" from "token expired" — the CLI computes a tri-state itself (`mcpDisplay.ts` `getCredentials:102` / `isTokenExpired:73` / green:81 / yellow-expired:76 / red:109) by reaching past the Agent API. | A canonical quad-state `oauthStatus: 'authenticated' \| 'expired' \| 'none' \| 'not-required'` plus a distinct boolean `sessionAuthenticated` (the in-session marker, preserved). |

If left unfixed, #1595's `/mcp` UI must keep reaching into the token store and Config to recompute
OAuth state — defeating its acceptance criterion ("the CLI could be replaced by a different UI using
the same core API"). This plan closes the gap **additively**: one canonical engine helper + a
faithful agents projection.

---

## Architectural Decisions (recap from specification.md)

- **Single canonical engine helper (R-INNER-TOKEN).** `packages/mcp/src/auth/oauth-status.ts`
  exports `type McpOAuthStatus = 'authenticated' | 'expired' | 'none' | 'not-required'` and
  `async function getMcpServerOAuthStatus(serverName: string, opts?: { requiresOAuth?: boolean }):
  Promise<McpOAuthStatus>`. It composes the EXISTING engine primitives — static
  `MCPOAuthTokenStorage.getToken` / `isTokenExpired` and the `mcpServerRequiresOAuth` map — and is
  the ONE place expiry is decided.
- **OR-combine the requirement signal (R-REQUIRED-OR).** The helper treats a server as
  OAuth-required when EITHER `opts.requiresOAuth === true` (the caller's config-derived signal, e.g.
  agents passing `serverConfig.oauth?.enabled === true`) OR the helper's own
  `mcpServerRequiresOAuth.get(serverName) === true` (the runtime-discovered signal). Not-required →
  `'not-required'` regardless of token presence.
- **Quad-state semantics (R-AUTHENTICATED-DERIVED).**
  `not-required` when neither requirement signal is set; else `none` when there is no persisted
  credential; else `expired` when `isTokenExpired(credentials.token)`; else `authenticated`.
- **Fault-tolerant, masked (R-FAULT-TOLERANT, R-MASKED).** The `try` wraps ONLY the token READ; any
  failure resolves to `'none'`. The helper returns ONLY the enum — never a token string, never the
  credential object.
- **Faithful agents projection (R-AUTHENTICATED-DERIVED, R-REQUIRESAUTH-REAL, R-SESSION-DISTINCT).**
  `agent.mcp` projects: `oauthStatus` = the helper result; `authenticated` = `oauthStatus ===
  'authenticated'` (NAME preserved, meaning corrected); `requiresAuth` = real
  (`oauth?.enabled === true || mcpServerRequiresOAuth.has(server)`); `sessionAuthenticated` = the
  preserved in-session `isMcpAuthenticated` marker.
- **Delegate, never cache (R-DELEGATE).** The controller resolves config / the helper PER CALL via
  its injected `getOAuthStatus` / `getRequiresAuth` closures (wired in `mcpControlWiring.ts`); no
  OAuth state is cached in the controller, so a later token mutation is always reflected.
- **Undefined-safe wiring (R-UNDEFINED-SAFE).** `getOAuthStatus` / `getRequiresAuth` are OPTIONAL
  `McpControlDeps` members; when absent (or `getMcpServers()` returns `undefined`) the controller
  yields `'not-required'` / `false` and never throws — mirroring the existing `McpControl` idle
  idiom.
- **DRY the projection (R-NO-REDERIVE).** A single private `buildAuthStatus(server)` produces the
  `{server, authenticated, requiresAuth, oauthStatus, sessionAuthenticated}` shape and is shared by
  `auth()` and BOTH exits of `authenticate()` (replacing the hardcoded fabrications at `:321,:336`);
  `details()` resolves all servers' statuses UP FRONT via `Promise.all` and threads the resolved
  status as a new argument into the still-sync `buildServerDetail` (R-ASYNC-DETAIL — never leak a
  Promise into a detail field).
- **Core barrel seam (R-CORE-BARREL-SEAM).** The helper + type are re-exported through the
  `packages/core` barrel's existing mcp groups so agents (which imports `MCPOAuthProvider` from the
  bare core barrel at `mcpControlWiring.ts:14`) can reach them without a deep import.
- **Type-only public re-export (R-MASKED, R-NONBREAK).** `McpOAuthStatus` surfaces from the agents
  public root as a TYPE-only re-export (mirrors `ApprovalMode` at `agent.ts:568`); the new interface
  fields surface automatically because `McpServerAuthStatus` / `McpServerDetail` are already
  type-re-exported at `api/index.ts:34,:36`.

---

## Subagent Role Table

| Role | Subagent | Phases |
|---|---|---|
| Implementation / worker | `typescriptexpert` | All `NN` worker phases (01, 02, 03, 04, 05, 06, 07, 08) |
| Verification / review | `architect` | Preflight `00a`; every `NNa` verifier (01a, 02a, 04a, 06a, 07a, 08a); and the final plan-quality evaluation (09) |

> Each impl-verifier (`NNa`) independently re-audits the paired TDD phase's tests (behavioral-RED
> was real, ≥30% property ratio, no mock theater, no reverse tests) in addition to the
> pseudocode-compliance + scoped-mutation triage on the implementation. Reviews are BLIND — the
> architect is given no hint of prior review outcomes, counts, or desired verdict.

---

## Requirements (full titles)

- **REQ-001** Canonical engine helper — `packages/mcp` exports `McpOAuthStatus` +
  `getMcpServerOAuthStatus(serverName, opts?)` composing static `getToken` /
  `isTokenExpired(credentials.token)` / `mcpServerRequiresOAuth`; quad-state; OR-combined
  requirement; fault-tolerant (`'none'` on failure); masked (enum only); barrel `mcp → core`.
- **REQ-002** Corrected `authenticated` — `agent.mcp` projects `authenticated = oauthStatus ===
  'authenticated'` (valid persisted token), no longer the in-session marker; NAME preserved.
- **REQ-003** Real `requiresAuth` — `agent.mcp` projects `requiresAuth = oauth?.enabled === true ||
  mcpServerRequiresOAuth.has(server)`, no longer hardcoded `true`; undefined-safe.
- **REQ-004** Additive quad-state + session distinction — `McpServerAuthStatus` / `McpServerDetail`
  GAIN `oauthStatus: McpOAuthStatus` + `sessionAuthenticated: boolean`; non-breaking; type-only
  `McpOAuthStatus` re-export from the agents root.
- **REQ-005** Documentation — `docs/agent-api.md` MCP section documents `oauthStatus` /
  `sessionAuthenticated` and the corrected `authenticated` / `requiresAuth` semantics.
- **REQ-INT-001** Engine↔agents parity — the value `agent.mcp.status(server)` /
  `details()` report for a server EQUALS what `getMcpServerOAuthStatus` returns for the same token /
  requirement state, across all four outcomes, driven through the public root + blessed seam.
- **REQ-INT-002** Session-vs-persisted independence — `sessionAuthenticated` and `oauthStatus`
  vary INDEPENDENTLY (valid token + no session login → `authenticated:true,
  sessionAuthenticated:false`; in-session login + expired/no token → the session marker is true
  while `oauthStatus` is `expired`/`none`), proven behaviorally.

---

## Phase Index (CONTIGUOUS — NO SKIPPED NUMBERS)

| Phase | File | Worker | Title |
|---|---|---|---|
| 00a | `00a-preflight-verification.md` | architect | Preflight: re-verify all anchors (getToken cast, isTokenExpired, monotonic map, barrels, agent.ts type lines) |
| 01 | `01-analysis.md` | typescriptexpert | Domain analysis (confirm `analysis/domain-model.md`) |
| 01a | `01a-analysis-verification.md` | architect | Verify analysis |
| 02 | `02-pseudocode.md` | typescriptexpert | Pseudocode (confirm `analysis/pseudocode/*.md`) |
| 02a | `02a-pseudocode-verification.md` | architect | Verify pseudocode (contract-first, real anchors, decision tables) |
| 03 | `03-engine-helper-tdd.md` | typescriptexpert | REQ-001/INT-001 engine helper — behavioral RED tests |
| 04 | `04-engine-helper-impl.md` | typescriptexpert | REQ-001 engine helper — impl (cite oauth-status-helper.md) |
| 04a | `04a-engine-helper-impl-verification.md` | architect | Pseudocode-compliance gate + scoped mutation + re-audit P03 tests |
| 05 | `05-agents-projection-tdd.md` | typescriptexpert | REQ-002..004/INT-001..002 agents projection — behavioral RED tests |
| 06 | `06-agents-projection-impl.md` | typescriptexpert | REQ-002..004 agents projection — impl (cite agents-projection.md) |
| 06a | `06a-agents-projection-impl-verification.md` | architect | Pseudocode-compliance gate + scoped mutation + re-audit P05 tests |
| 07 | `07-non-breaking-and-docs.md` | typescriptexpert | REQ-004/005 extend non-breaking guards + `docs/agent-api.md` |
| 07a | `07a-non-breaking-and-docs-verification.md` | architect | Verify nothing removed/renamed + docs accurate |
| 08 | `08-quality-gates.md` | typescriptexpert | Full suite (test/lint/typecheck/format/build + smoke) + scoped mutation triage |
| 08a | `08a-quality-gates-verification.md` | architect | Verify gates output + survivor-triage honesty |
| 09 | `09-final-plan-quality-eval.md` | architect | Final plan-quality evaluation → `plan-evaluation.json` |

---

## REQ → Phase Mapping (authoritative)

| Requirement | Worker phases | Verifier phases |
|---|---|---|
| REQ-001 (engine helper) | 03, 04 | 04a |
| REQ-002 (authenticated corrected) | 05, 06 | 06a |
| REQ-003 (requiresAuth real) | 05, 06 | 06a |
| REQ-004 (quad-state + session, non-breaking) | 05, 06, 07 | 06a, 07a |
| REQ-005 (docs) | 07 | 07a |
| REQ-INT-001 (engine↔agents parity) | 05, 06 | 06a |
| REQ-INT-002 (session-vs-persisted independence) | 05, 06 | 06a |

---

## Defect → REQ → Phase (the three defects, explicit)

| Defect | REQ | First proven fixed at |
|---|---|---|
| D1 (`authenticated` = in-session only) | REQ-002, REQ-INT-001 | P06 impl (parity suite) |
| D2 (`requiresAuth` hardcoded true) | REQ-003 | P06 impl |
| D3 (no persisted/session/expired distinction) | REQ-001, REQ-004, REQ-INT-002 | P04 helper; P06 projection |

---

## #1595 Adequacy Statement

When phases 03–08 are green, the public `@vybestack/llxprt-code-agents` surface reports MCP OAuth
truth that #1595's `/mcp` UI can consume directly: `agent.mcp.status(server)` /
`agent.mcp.details()` expose a canonical `oauthStatus` quad-state that EQUALS the engine helper's
verdict (so the CLI no longer reads the token store or recomputes expiry), a corrected
`authenticated` (valid persisted token, not the in-session flag), a real `requiresAuth`, and a
distinct `sessionAuthenticated` for the in-session login marker — all masked, undefined-safe,
delegated (never cached), non-breaking, and re-exported from the public root. The final evaluation
(P09) rejects the plan if any of the three defects can still be observed through the public root, if
any consumer re-derives expiry instead of delegating to the engine helper, or if the change is not
strictly additive.
