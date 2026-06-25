<!-- @plan:PLAN-20260622-COREAPIGAP.P01 @requirement:REQ-001,REQ-002,REQ-003,REQ-004,REQ-005,REQ-006,REQ-007,REQ-008,REQ-009,REQ-010,REQ-INT-001,REQ-INT-002,REQ-INT-003,REQ-INT-004,REQ-INT-005 -->
# Domain Model: Close Agent API Engine-Capability Gaps (prereq for #1595)

Plan ID: PLAN-20260622-COREAPIGAP
Source: `project-plans/issue2143/specification.md`
Scope: ANALYSIS ONLY — no implementation code. Models the entities, relationships, transitions,
invariants, edge cases, and the test-harness cross-reference for the seven additive capability
surfaces plus the barrel/command-map and non-breaking guarantees.

---

## 1. Entities

### 1.1 Agent (EXISTING — extended)
The public facade (`packages/agents/src/api/agent.ts` interface; `agentImpl.ts` impl). This plan ADDS
top-level `getApprovalMode()`/`setApprovalMode()` and two `readonly` sub-controllers (`policy`,
`tasks`), and EXTENDS three existing sub-controllers (`hooks`, `auth`, `mcp`) and one (`tools`, via a
new nested `keys`).
- Invariant: the facade owns NO engine state; it delegates to the bound `Config` / `OAuthManager`
  per call (R-DELEGATE).

### 1.2 ApprovalModeAccessor (NEW behavior on Agent)
Top-level read/write of the bound `Config` approval mode.
- Backing: `Config.getApprovalMode()` (`configBaseCore.ts:463`), `Config.setApprovalMode()`
  (`config.ts:401`).
- Invariant: `setApprovalMode` is a DIRECT delegation; the untrusted-folder throw propagates
  (R-APPROVAL-THROW).

### 1.3 AgentPolicyControl (NEW sub-controller)
Read-only projection of the bound `PolicyEngine` (`Config.getPolicyEngine()`, `configBaseCore.ts:475`;
engine in `packages/policy/src/policy-engine.ts`).
- Entities returned: `PolicyRuleView` (projected from `PolicyRule`, `argsPattern: RegExp → string`),
  `PolicyDecision` (VALUE enum).
- Invariant: returns SNAPSHOTS; never the live engine; `argsPattern` is `.source` string
  (R-POLICY-SNAPSHOT, R-ARGSPATTERN-STRING).

### 1.4 AgentTasksControl (NEW sub-controller)
Projection of `Config.getAsyncTaskManager()` (`config.ts:601`, nullable).
- Entities returned: `AgentTaskInfo` (projected from `AsyncTaskInfo`, OMITS `abortController`).
- Invariant: undefined-safe (R-UNDEFINED-SAFE); `AgentTaskInfo` never carries `abortController`
  (R-NO-ABORTCONTROLLER); `cancelAllRunning` returns a COUNT (R-CANCEL-COUNT).

### 1.5 AgentHookControl (EXISTING — extended for admin)
Adds registry inspection + disabled-set administration to the existing execution/lifecycle control
(`control/hooks.ts`).
- Backing: `Config.getHookSystem()` (`config.ts:755`, nullable) →
  `HookSystem.getRegistry().getAllHooks()` (`hookRegistry.ts:82`), `getHookName()`
  (`hookRegistry.ts:118`), `HookRegistryEntry.enabled` (`hookRegistry.ts:41`); `Config.getDisabledHooks()`
  (`config.ts:734`); `Config.setDisabledHooks()` (`configBase.ts:132`).
- Entities returned: `HookInfo`.
- Invariant: existing methods unchanged (R-NONBREAK); undefined-safe registry read
  (R-UNDEFINED-SAFE).

### 1.6 AgentAuthControl (EXISTING — extended for OAuth detail)
Adds masked OAuth metadata using the OAuthManager ALREADY on `AgentDeps` (`agentImpl.ts:121`).
- Backing: `OAuthManager.isAuthenticated()` (`oauth-manager.ts:199`), `isOAuthEnabled()` (`:300`),
  `peekStoredToken()` (`:243`), `getHigherPriorityAuth()` (`:313`), `getAuthStatusWithBuckets()`
  (`:395`).
- Entities returned: `AuthProviderDetail`, `AuthBucketStatus`.
- Invariant: MASKED metadata only — never raw token strings (R-NO-RAW-SECRETS).

### 1.7 AgentMcpControl (EXISTING — extended for OAuth + detail + refresh parity)
Adds the real MCP OAuth flow + deep detail + tool-refresh parity (`control/mcpControl.ts`).
- Backing: `MCPOAuthProvider.authenticate()` (core barrel `index.ts:498`; flow mirrors
  `mcpAuth.ts:82-136`), `manager.restartServer()`, `agentClient.setTools()`.
- Entities returned: `McpServerAuthStatus` (EXISTING), `McpDetailStatus` (NEW).
- Invariant: `refresh()` re-publishes tools (R-REFRESH-PARITY); existing methods unchanged
  (R-NONBREAK); undefined-safe (R-UNDEFINED-SAFE).

### 1.8 AgentToolKeysControl (NEW nested sub-controller on `tools`)
Built-in tool-key storage via `ToolKeyStorage` (`tool-key-storage.ts:109`) + registry helpers
(`getSupportedToolNames`/`getToolKeyEntry`/`isValidToolKeyName`/`maskKeyForDisplay`, core barrel
`index.ts:472-475`).
- Entities returned: `ToolKeyInfo`, `ToolKeyStatus`.
- Invariant: MASKED key only (R-NO-RAW-SECRETS); distinct from provider-auth `Agent.auth.keys`
  (R-KEYS-DISTINCT).

### 1.9 PublicBarrel + CommandApiMap (EXISTING — extended)
`packages/agents/src/api/index.ts` re-exports new projected types; `app-services/command-api-map.ts`
registers the six migrated commands (kind `runtime`).
- Invariant: type-only re-export for types; map stays orphan-free (R-MAP-VALID); no existing export
  removed (R-NONBREAK).

---

## 2. Relationships

```
                         ┌──────────────────────────── Agent (facade) ───────────────────────────┐
                         │                                                                        │
   getApprovalMode()/setApprovalMode()         readonly policy        readonly tasks              │
        │                                            │                     │                      │
        ▼                                            ▼                     ▼                      │
  Config.getApprovalMode()                   AgentPolicyControl     AgentTasksControl             │
  Config.setApprovalMode() ──(throws)──►            │                     │                      │
                                                    ▼                     ▼                      │
                                          Config.getPolicyEngine()  Config.getAsyncTaskManager()  │
                                          → PolicyEngine.getRules()  (nullable) → getAllTasks/…    │
                                                                                                   │
   readonly hooks (extended)   readonly auth (extended)   readonly mcp (extended)   tools.keys     │
        │                           │                          │                        │          │
        ▼                           ▼                          ▼                        ▼          │
  Config.getHookSystem()      deps.oauthManager           MCPOAuthProvider.auth()  ToolKeyStorage  │
  Config.get/setDisabledHooks (already on AgentDeps)      restartServer→setTools   + tool helpers  │
                         └──────────────────────────────────────────────────────────────────────┘
                                                  │
                                                  ▼
                              PublicBarrel (api/index.ts) re-exports projected types
                              CommandApiMap registers /approval-mode /policies /task
                                                 /hooks /toolkey /toolkeyfile
```

Shared-invariant notes:
- ALL controllers share R-DELEGATE (resolve live backing per call) and R-UNDEFINED-SAFE (no-op when
  the backing manager is absent — except policy/approval, whose backings are non-nullable on Config).
- The two "extend" controllers (hooks/auth/mcp) and `tools.keys` share R-NONBREAK with the barrel:
  no existing method/ export signature changes.
- The projected types (`AgentTaskInfo`, `PolicyRuleView`, `Auth*`, `McpDetailStatus`, `ToolKey*`)
  share R-NO-LEAK: omit non-serializable / secret internals (`abortController`, raw `RegExp`, raw
  tokens/keys).

---

## 3. State Transitions

### 3.1 Approval-mode write (REQ-001)
Pre-conditions: bound Config; folder trust state known.
- trusted folder: `setApprovalMode(YOLO)` ──► Config.approvalMode = YOLO ──► `getApprovalMode()` = YOLO
- untrusted folder + non-DEFAULT: `setApprovalMode(YOLO)` ──► THROWS (no state change)
Post-conditions: on success the live Config reflects the new mode; on throw the mode is unchanged and
the error propagates uncaught.

### 3.2 Async-task cancel-all (REQ-003.5)
Pre-conditions: manager present with N running tasks.
- `cancelAllRunning()` ──► for each running task: `cancelTask(id)` ──► returns count C (C ≤ N)
Post-conditions: previously-running tasks are cancelled; `listRunning()` reflects the reduced set;
return value equals the number actually cancelled.

### 3.3 Async-task undefined manager (REQ-003.6)
Pre-conditions: `getAsyncTaskManager()` returns `undefined`.
- any method ──► no-op (`[]`/`undefined`/`false`/`0`)
Post-conditions: no throw; deterministic empty results.

### 3.4 Hooks disabled-set round-trip (REQ-004.2/.3/.4)
Pre-conditions: bound Config (hook system may be present or absent).
- `setDisabledHooks(["a"])` ──► Config disabled = ["a"] ──► `getDisabledHooks()` = ["a"]
- `disable("b")` ──► Config disabled = ["a","b"] ; `enable("a")` ──► Config disabled = ["b"]
Post-conditions: the disabled set reflects the operations; `listHooks()` reflects per-hook enabled
flags when a system is present, `[]` otherwise.

### 3.5 MCP authenticate (REQ-006.1)
Pre-conditions: MCP manager present; server requires OAuth.
- `authenticate(server)` ──► MCPOAuthProvider.authenticate ──► manager.restartServer(server) ──►
  agentClient.setTools() ──► return auth status
Post-conditions: server authenticated; tools re-published (parity with `mcpAuth.ts:136`).

### 3.6 MCP refresh parity (REQ-006.2)
Pre-conditions: MCP manager present.
- `refresh(server?)` ──► restart ──► setTools()
Post-conditions: tool declarations re-published (the previously-missing step).

### 3.7 Tool-key save/mask (REQ-007.2/.3)
Pre-conditions: supported, valid tool name.
- `save(tool, "secret")` ──► ToolKeyStorage.saveKey ; `status(tool)` ──► hasKey=true,
  maskedKey=mask("secret")
Post-conditions: key persisted; status reports MASKED value; raw value never returned.

---

## 4. Business Rules (Named Invariants)

1. **R-DELEGATE (REQ-001..007, C-DELEGATE-NO-CACHE):** every accessor resolves the live backing
   (`this.deps.config.<getter>()` / injected closure) per call; no cached engine state. Testable: T1,
   T20.
2. **R-APPROVAL-THROW (REQ-001.2, C-APPROVAL-THROW):** `setApprovalMode` delegates directly; the
   untrusted-folder throw propagates uncaught/unnormalized. Testable: T2.
3. **R-POLICY-SNAPSHOT (REQ-002.1):** `policy.getRules()` returns read-only snapshots, not the live
   engine or live rule objects. Testable: T4.
4. **R-ARGSPATTERN-STRING (REQ-002.1, C-ARGSPATTERN-STRING):** `PolicyRuleView.argsPattern` is the
   `.source` string (or `undefined`), never a raw `RegExp`. Testable: T5.
5. **R-NO-ABORTCONTROLLER (REQ-003.7, C-NO-ABORTCONTROLLER):** `AgentTaskInfo` never contains an
   `abortController` key (proved by `.strict()` schema + key assertion). Testable: T8.
6. **R-CANCEL-COUNT (REQ-003.5):** `cancelAllRunning()` returns the integer count of tasks cancelled.
   Testable: T7.
7. **R-UNDEFINED-SAFE (REQ-003.6, REQ-004.5, REQ-006.4, C-UNDEFINED-SAFE):** when a backing manager is
   absent, methods no-op deterministically (`[]`/`undefined`/`false`/`0`) with no throw. Testable: T9,
   T12, T16.
8. **R-HOOKS-ROUNDTRIP (REQ-004.2/.3/.4):** `setDisabledHooks`→`getDisabledHooks` round-trips;
   `enable`/`disable` mutate the disabled set with exact `/hooks` semantics. Testable: T11.
9. **R-NO-RAW-SECRETS (REQ-005, REQ-007.2, C-NO-RAW-SECRETS):** auth-detail and tool-key surfaces
   return MASKED metadata only — no raw token strings, no raw key values. Testable: T13, T18.
10. **R-REFRESH-PARITY (REQ-006.2):** `mcp.refresh()` re-publishes tool declarations (setTools) after
    restart, matching `/mcp refresh`. Testable: T15.
11. **R-MCP-OAUTH-FLOW (REQ-006.1):** `mcp.authenticate()` performs provider-auth → restart →
    setTools → status, matching `mcpAuth.ts:82-136`. Testable: T14.
12. **R-KEYS-DISTINCT (REQ-007.7):** `agent.tools.keys` is built-in tool-key storage, separate from
    provider-auth `agent.auth.keys`; the latter is untouched. Testable: T17, T19.
13. **R-NONBREAK (REQ-009):** no existing public export or controller method is removed/renamed/
    retyped; extensions are additive. Testable: T21.
14. **R-MAP-VALID (REQ-008.2):** `COMMAND_API_MAP` stays orphan-free, unique-named, durable-entries
    importable, after the six new `runtime` rows. Testable: T22.
15. **R-NO-DEEP-IMPORT (REQ-INT-005):** the public-consumer path imports only the public root; the
    adequacy driver is a `.spec.ts` passing the T17 boundary guard. Testable: T23.
16. **R-BARREL-TYPEONLY (REQ-008.1):** projected interface types are re-exported `export type`;
    value enums are re-exported as values; no `any`/unsafe-`as`. Testable: T24.

---

## 5. Edge Cases

- **5.1** Approval read when Config mode is the default → returns `ApprovalMode.DEFAULT` (no throw,
  no fabrication).
- **5.2** `setApprovalMode(DEFAULT)` in an untrusted folder → does NOT throw (only non-DEFAULT modes
  throw, per `config.ts:402-405`).
- **5.3** Policy engine with a rule whose `argsPattern` is absent → `PolicyRuleView.argsPattern` is
  `undefined` (not `""`).
- **5.4** Async `cancel(id)` called twice → second returns `false` (idempotent core, `cancelTask`).
- **5.5** `cancelAllRunning()` with zero running tasks → returns `0` (not an error).
- **5.6** Hooks `setDisabledHooks([])` (clear-all) → disabled set becomes empty (mirrors
  `hooksCommand.ts:239`).
- **5.7** `disable(name)` for an already-disabled hook → disabled set unchanged (no duplicate).
- **5.8** Auth `detailedStatus` for a provider with no stored token → `authenticated:false`,
  `expiry` absent; no token field present.
- **5.9** MCP `authenticate` when the server doesn't require OAuth → returns a status indicating
  no-auth-needed (no spurious restart side effects beyond the documented flow).
- **5.10** MCP `details({})` with all flags false/absent → returns server list with names + auth
  flags only (no tools/prompts/resources arrays).
- **5.11** Tool-key `status` for a tool with a keyfile but no inline key → `hasKey` reflects resolved
  presence; `keyFile` is the path; `maskedKey` absent or masked-empty.
- **5.12** Tool-key `setKeyFile(tool, null)` → clears the keyfile (`clearKeyfilePath`).

---

## 6. Error Scenarios

| Scenario | Expected behavior | Harness row |
|---|---|---|
| `setApprovalMode(YOLO)` in untrusted folder | THROWS untrusted-folder error, uncaught/unnormalized | T2 |
| Async manager `undefined`, any task method | no-op (`[]`/`undefined`/`false`/`0`), no throw | T9 |
| Hook system `undefined`, `listHooks()` | returns `[]`, no throw; disabled get/set still delegate | T12 |
| MCP manager absent, `authenticate`/`details`/`refresh` | no-op safely, no throw | T16 |
| Tool-key `save` with invalid tool name | rejects (validation `isValidToolKeyName`), no silent write | T18b |
| Auth `detailedStatus` for unknown provider / no token | `authenticated:false`, no token field, no throw | T13b |
| Public-consumer `.spec.ts` deep-imports internals | T17 boundary guard FAILS the suite | T23 |
| Removed/renamed existing export | non-breaking characterization FAILS | T21 |

---

## 7. Requirement Coverage Map

> Rows marked n/a are intentional: REQ-010 (docs) and REQ-008.1's type-only compile assertion are
> validated by doc-accuracy review and `npm run typecheck` respectively, not a runtime transition.

| REQ | Entities | Transition | Invariant | Harness row(s) | Phases |
|---|---|---|---|---|---|
| REQ-001 | 1.2 | 3.1 | R-DELEGATE, R-APPROVAL-THROW | T1, T2, T3 | P03/P04/P04a |
| REQ-002 | 1.3 | (read) | R-POLICY-SNAPSHOT, R-ARGSPATTERN-STRING | T4, T5, T6 | P05/P06/P06a |
| REQ-003 | 1.4 | 3.2, 3.3 | R-CANCEL-COUNT, R-NO-ABORTCONTROLLER, R-UNDEFINED-SAFE | T7, T8, T9, T10 | P07/P08/P08a |
| REQ-004 | 1.5 | 3.4 | R-HOOKS-ROUNDTRIP, R-UNDEFINED-SAFE, R-NONBREAK | T11, T12 | P09/P10/P10a |
| REQ-005 | 1.6 | (read) | R-NO-RAW-SECRETS, R-NONBREAK | T13, T13b | P11/P12/P12a |
| REQ-006 | 1.7 | 3.5, 3.6 | R-MCP-OAUTH-FLOW, R-REFRESH-PARITY, R-UNDEFINED-SAFE | T14, T15, T16 | P13/P14/P14a |
| REQ-007 | 1.8 | 3.7 | R-NO-RAW-SECRETS, R-KEYS-DISTINCT | T17, T18, T18b, T19 | P15/P16/P16a |
| REQ-008 | 1.9 | (read) | R-MAP-VALID, R-BARREL-TYPEONLY | T22, T24 | P17/P17a |
| REQ-009 | 1.1, 1.9 | (read) | R-NONBREAK | T21 | P18/P18a |
| REQ-010 | n/a | n/a | (doc accuracy) | n/a | P19/P19a |
| REQ-INT-001 | 1.2 | 3.1 | R-APPROVAL-THROW | T3 | P20-driver, P21 |
| REQ-INT-002 | 1.3,1.4 | 3.2 | R-POLICY-SNAPSHOT, R-CANCEL-COUNT | T6, T10 | P20-driver, P21 |
| REQ-INT-003 | 1.5,1.6 | 3.4 | R-HOOKS-ROUNDTRIP, R-NO-RAW-SECRETS | T11, T13 | P20-driver, P21 |
| REQ-INT-004 | 1.7,1.8 | 3.5,3.7 | R-MCP-OAUTH-FLOW, R-KEYS-DISTINCT | T14, T19 | P20-driver, P21 |
| REQ-INT-005 | 1.1 | (import) | R-NO-DEEP-IMPORT | T23 | P20-driver, P21/P21a |

---

## 8. Harness Row Cross-Reference (T1–T24)

> Layers: L1 static/type, L2 characterization (non-breaking/export-surface), L3 behavior (unit
> controller behavior), L4 integration (public-root-only adequacy driver), L5 resource/undefined-safe.

| T-row | REQ(s) | Behavior | Layer |
|---|---|---|---|
| T1 | REQ-001.1 | `getApprovalMode()` returns live Config value | L3 |
| T2 | REQ-001.2 | `setApprovalMode` untrusted-folder THROW propagates | L3 |
| T3 | REQ-INT-001 | approval read/write parity via public root | L4 |
| T4 | REQ-002.1 | `policy.getRules()` returns snapshots | L3 |
| T5 | REQ-002.1 | `argsPattern` projected to `.source` string / undefined | L3 |
| T6 | REQ-002.2/.3, REQ-INT-002 | default-decision + non-interactive read-through | L3/L4 |
| T7 | REQ-003.5 | `cancelAllRunning()` returns cancelled COUNT | L3 |
| T8 | REQ-003.7 | `AgentTaskInfo` omits `abortController` (strict) | L1/L3 |
| T9 | REQ-003.6 | undefined manager → no-op everywhere | L5 |
| T10 | REQ-003.1-.4, REQ-INT-002 | list/listRunning/get/cancel full-surface parity | L3/L4 |
| T11 | REQ-004.2/.3/.4 | disabled-set round-trip + enable/disable | L3 |
| T12 | REQ-004.1/.5 | `listHooks()` snapshot + undefined-system → `[]` | L3/L5 |
| T13 | REQ-005.1/.3 | masked auth detail + bucket statuses (no token) | L3 |
| T13b | REQ-005 edge | unknown provider/no token → not-authenticated, no token | L3 |
| T14 | REQ-006.1 | `authenticate()` flow: auth→restart→setTools→status | L3 |
| T15 | REQ-006.2 | `refresh()` re-publishes tools (setTools parity) | L3 |
| T16 | REQ-006.4 | MCP absent → authenticate/details/refresh no-op | L5 |
| T17 | REQ-007.1/.2 | `tools.keys.supported()/status()` masked | L3 |
| T18 | REQ-007.3/.5/.6 | save/setKeyFile/getKeyFile round-trip (masked) | L3 |
| T18b | REQ-007.3 edge | invalid tool name → reject (validation) | L3 |
| T19 | REQ-007.7, REQ-INT-004 | `tools.keys` distinct from `auth.keys` | L3/L4 |
| T20 | R-DELEGATE | re-read after Config change reflects new value (no cache) | L3 |
| T21 | REQ-009 | non-breaking export-surface characterization | L2 |
| T22 | REQ-008.2 | `COMMAND_API_MAP` six rows valid (orphan-free) | L2 |
| T23 | REQ-INT-005 | adequacy driver `.spec.ts` passes T17 boundary | L4 |
| T24 | REQ-008.1 | projected types re-exported (typecheck compile-anchor) | L1 |
