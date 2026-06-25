<!-- @plan:PLAN-20260622-COREAPIGAP.P02 @requirement:REQ-001 -->
# Pseudocode: Approval Mode (top-level `Agent` methods)

Plan ID: PLAN-20260622-COREAPIGAP
Component: G1 — `Agent.getApprovalMode()` / `Agent.setApprovalMode(mode)`
Source of truth: specification.md REQ-001; domain-model.md R-DELEGATE, R-APPROVAL-THROW.
Analysis only — NO implementation code is written in this document.

---

## Interface Contracts

These are top-level methods on the `Agent` interface (NOT a sub-controller) — approval mode has no
per-agent sub-state, so it mirrors the ephemeral-settings one-liners (`agentImpl.ts:726-738`).

```typescript
// Added to the Agent interface in packages/agents/src/api/agent.ts
// (near the existing getEphemeralSetting/setEphemeralSetting declarations at agent.ts:341-345)
interface Agent {
  // ...existing members unchanged (REQ-009)...
  getApprovalMode(): ApprovalMode;
  setApprovalMode(mode: ApprovalMode): void;
}

// ApprovalMode is ALREADY imported at agent.ts:11 and re-exported `export type` at agent.ts:387.
// It is a VALUE enum from the core barrel (core/src/index.ts:18). No new import needed in agent.ts
// for the type position; agentImpl.ts already has Config access via this.deps.config.
```

### Dependencies (NEVER stubbed)

```typescript
// AgentImpl already holds this.deps.config: Config (the live bound Config).
// No new dependency object is introduced for this capability.
//   - this.deps.config.getApprovalMode(): ApprovalMode      // configBaseCore.ts:463
//   - this.deps.config.setApprovalMode(mode: ApprovalMode): void  // config.ts:401 (THROWS :404)
```

---

## Numbered Pseudocode

### METHOD getApprovalMode(): ApprovalMode

```
1: // @pseudocode REQ-001.1 — live read, no cache
2: METHOD getApprovalMode() RETURNS ApprovalMode
3:   RETURN this.deps.config.getApprovalMode()
4: END METHOD
```

### METHOD setApprovalMode(mode: ApprovalMode): void

```
10: // @pseudocode REQ-001.2 — direct delegation; the untrusted-folder throw MUST propagate
11: METHOD setApprovalMode(mode: ApprovalMode) RETURNS void
12:   // NO try/catch, NO normalization, NO mode validation here — Config owns the guard.
13:   // For any non-DEFAULT mode in an untrusted folder, config.setApprovalMode throws
14:   // "Cannot enable privileged approval modes in an untrusted folder." (config.ts:404);
15:   // that throw escapes this method UNCHANGED.
16:   this.deps.config.setApprovalMode(mode)
17: END METHOD
```

---

## Integration Points (Line-by-Line, REAL symbols)

| Pseudocode line | Real symbol / call | File:line (verified) |
|---|---|---|
| 3 | `Config.getApprovalMode(): ApprovalMode` | `packages/core/src/config/configBaseCore.ts:463` |
| 16 | `Config.setApprovalMode(mode: ApprovalMode): void` (throws on untrusted, non-DEFAULT) | `packages/core/src/config/config.ts:401` (throw `:404`) |
| n/a (wiring) | declarations added next to existing ephemeral one-liners | `agentImpl.ts:726-738` (getEphemeralSetting:726, setEphemeralSetting:731) |
| n/a (type) | `ApprovalMode` value enum | core barrel `core/src/index.ts:18`; re-exported `export type` `agent.ts:387` |

CLI consumer this unblocks (#1595, not modified here):
`packages/cli/src/ui/hooks/useAutoAcceptIndicator.ts` (reads `config.getApprovalMode()`, writes
`config.setApprovalMode(...)`).

---

## Anti-Pattern Warnings

- [ERROR] DO NOT: wrap `config.setApprovalMode(mode)` in try/catch — swallowing the untrusted-folder
  throw violates REQ-001.2 / C-APPROVAL-THROW.
  [OK] DO: call it directly and let the error propagate.
- [ERROR] DO NOT: cache the approval mode in an instance field and return the cached copy.
  [OK] DO: read `this.deps.config.getApprovalMode()` live every call (R-DELEGATE).
- [ERROR] DO NOT: normalize/clamp `mode` (e.g. coerce YOLO→DEFAULT) before delegating.
  [OK] DO: pass `mode` through verbatim; Config is the single source of validation.
- [ERROR] DO NOT: add a sub-controller (`agent.approval.*`) — approval has no sub-state.
  [OK] DO: add two top-level `Agent` methods, mirroring the ephemeral-settings shape.

---

## Behavior Decision Table

| GIVEN (folder trust) | mode arg | Config behavior | Method result |
|---|---|---|---|
| trusted | `DEFAULT` | sets, returns void | returns void; subsequent get → `DEFAULT` |
| trusted | `AUTO_EDIT` | sets, returns void | returns void; subsequent get → `AUTO_EDIT` |
| trusted | `YOLO` | sets, returns void | returns void; subsequent get → `YOLO` |
| untrusted | `DEFAULT` | sets (DEFAULT allowed), returns void | returns void |
| untrusted | `AUTO_EDIT` | THROWS (`config.ts:404`) | THROWS — same error propagates (REQ-001.2) |
| untrusted | `YOLO` | THROWS (`config.ts:404`) | THROWS — same error propagates (REQ-001.2) |
| (any) read | — | `getApprovalMode()` returns live value | exact live `ApprovalMode` (REQ-001.1) |
