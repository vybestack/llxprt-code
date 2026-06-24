<!-- @plan:PLAN-20260622-COREAPIGAP.P02 @requirement:REQ-008 -->
# Pseudocode: Public Barrel Re-Exports (`packages/agents/src/api/index.ts`)

Plan ID: PLAN-20260622-COREAPIGAP
Component: G8a — re-export all new public projected types + value enums from the agents api barrel.
Source of truth: specification.md REQ-008; domain-model.md R-BARREL-TYPEONLY, R-NONBREAK.
Analysis only — NO implementation code is written in this document.

> The api barrel currently `export *`s the controller interfaces from `./agent.js` (so the NEW
> control interfaces — `AgentPolicyControl`, `AgentTasksControl`, `AgentToolKeyControl`, plus the
> extended `AgentMcpControl`/`AgentAuthControl`/`AgentHookControl` — surface automatically). This
> phase adds the standalone PROJECTED public types + the two VALUE enums that consumers need by name.

---

## Interface Contracts

```typescript
// In packages/agents/src/api/index.ts (current barrel head at :10-20).
// verbatimModuleSyntax is ON → `export type` for interfaces/type-aliases, plain `export` for VALUES.

// --- VALUE enums (re-exported from the core barrel; NOT `type`) ---
export { PolicyDecision, ApprovalMode } from '@vybestack/llxprt-code-core';

// --- TYPE-ONLY projected public types (defined in agent.ts; surfaced explicitly by name) ---
export type {
  PolicyRuleView,
  AgentTaskInfo,
  HookInfo,
  AuthProviderDetail,
  AuthBucketStatus,
  McpServerAuthStatus,
  McpDetailStatus,
  McpServerDetail,
  McpDetailsOptions,
  McpPromptInfo,
  McpResourceInfo,
  McpBlockedServer,
  ToolKeyInfo,
  ToolKeyStatus,
} from './agent.js';
```

### Dependencies (NEVER stubbed)

```
None — this is pure module re-export wiring. The projected types are DEFINED in agent.ts
(co-located with the control interfaces); the two enums come from the core barrel.
```

---

## Numbered Pseudocode

```
1: // @pseudocode REQ-008.1 — surface value enums (ApprovalMode already re-exported `export type`
2: //                          at agent.ts:387; add the VALUE form so consumers can use enum members)
3: ADD to api/index.ts: export { PolicyDecision, ApprovalMode } from '@vybestack/llxprt-code-core'
4:
5: // @pseudocode REQ-008.2 — surface all projected public TYPES by name (type-only)
6: ADD to api/index.ts: export type { PolicyRuleView, AgentTaskInfo, HookInfo,
7:        AuthProviderDetail, AuthBucketStatus, McpServerAuthStatus, McpDetailStatus,
8:        McpServerDetail, McpDetailsOptions, McpPromptInfo, McpResourceInfo, McpBlockedServer,
9:        ToolKeyInfo, ToolKeyStatus } from './agent.js'
10:
11: // @pseudocode REQ-008.3 — control INTERFACES (AgentPolicyControl/AgentTasksControl/
12: //   AgentToolKeyControl + extended Agent*Control) are surfaced by the EXISTING `export *
13: //   from './agent.js'`; NO new line needed, but the non-breaking guard asserts their presence.
14: VERIFY existing `export type * from './agent.js'` (or equivalent) still present (REQ-009)
```

> Value-vs-type classification is CRITICAL under `verbatimModuleSyntax` + `noUnusedLocals`:
> `PolicyDecision`/`ApprovalMode` are runtime enums → plain `export`; everything else is a TS
> interface → `export type` (else TS1205 / runtime "not exported" errors).

---

## Integration Points (Line-by-Line, REAL symbols)

| Pseudocode line | Real symbol | File:line (verified) |
|---|---|---|
| 3 | `PolicyDecision` (enum) | core barrel `core/src/index.ts:17` |
| 3 | `ApprovalMode` (enum) | core barrel `core/src/index.ts:18` |
| 6-9 | projected types DEFINED alongside control interfaces | `agents/src/api/agent.ts` (added by component phases) |
| 14 | existing barrel re-export of `./agent.js` | `agents/src/api/index.ts:12` (`export type * from './agent.js'`) |
| n/a | barrel head where new lines land | `agents/src/api/index.ts:10-20` |

---

## Anti-Pattern Warnings

- [ERROR] DO NOT: `export type { PolicyDecision }` (it's a VALUE enum → breaks enum-member use).
  [OK] DO: plain `export { PolicyDecision, ApprovalMode }`.
- [ERROR] DO NOT: `export { PolicyRuleView }` without `type` (TS1205 under verbatimModuleSyntax).
  [OK] DO: `export type { PolicyRuleView, ... }`.
- [ERROR] DO NOT: remove or reorder existing barrel exports.
  [OK] DO: APPEND only; the non-breaking guard (REQ-009) asserts the prior set is a subset.
- [ERROR] DO NOT: re-export raw core types that leak internals (`AsyncTaskInfo` with
  `abortController`, raw `RegExp` `PolicyRule`).
  [OK] DO: re-export the PROJECTED public types (`AgentTaskInfo`, `PolicyRuleView`).

---

## Behavior Decision Table

| Symbol | export form | Rationale |
|---|---|---|
| `PolicyDecision` | `export { … }` | runtime enum value |
| `ApprovalMode` | `export { … }` | runtime enum value (was type-only at agent.ts:387; value form added) |
| `PolicyRuleView` | `export type { … }` | interface |
| `AgentTaskInfo` | `export type { … }` | interface (omits abortController) |
| `HookInfo` | `export type { … }` | interface |
| `AuthProviderDetail`/`AuthBucketStatus` | `export type { … }` | interfaces (masked) |
| `McpServerAuthStatus`/`McpDetailStatus`/`McpServerDetail`/`McpDetailsOptions`/`McpPromptInfo`/`McpResourceInfo`/`McpBlockedServer` | `export type { … }` | interfaces |
| `ToolKeyInfo`/`ToolKeyStatus` | `export type { … }` | interfaces |
| `AgentPolicyControl`/`AgentTasksControl`/`AgentToolKeyControl` | (none — via `export *`) | surfaced by existing star re-export |
