<!-- @plan:PLAN-20260622-COREAPIGAP.P02 @requirement:REQ-004 -->
# Pseudocode: Hooks Administration (extend `AgentHookControl` / `HookControl`)

Plan ID: PLAN-20260622-COREAPIGAP
Component: G4 — extend the EXISTING hook control with registry inspection + enable/disable admin.
Source of truth: specification.md REQ-004; domain-model.md R-HOOKS-ROUNDTRIP, R-UNDEFINED-SAFE.
Analysis only — NO implementation code is written in this document.

---

## Interface Contracts

```typescript
// EXTEND the existing AgentHookControl interface in packages/agents/src/api/agent.ts (:314-321).
// Existing members (onHookExecution / triggerSessionStart / triggerSessionEnd / clear) stay
// EXACTLY as-is (REQ-009 non-breaking). ADD:
interface AgentHookControl {
  // ...existing members unchanged...
  listHooks(): readonly HookInfo[];
  getDisabledHooks(): readonly string[];
  setDisabledHooks(names: readonly string[]): void;
  enable(name: string): void;        // convenience over the disabled-set
  disable(name: string): void;       // convenience over the disabled-set
}

// Projected public type (specification.md Data Schemas).
interface HookInfo {
  readonly name: string;             // = registry.getHookName(entry)  (hookRegistry.ts:118)
  readonly eventName: string;        // = entry.eventName
  readonly enabled: boolean;         // = entry.enabled                (hookRegistry.ts:41)
  readonly source?: string;          // = String(entry.source)
}
```

### Dependencies (NEVER stubbed)

The existing `HookControl` already holds `this.deps.config: Config` — NO new constructor plumbing
is required (confirmed: `control/hooks.ts` constructor stores deps incl. `config`). The admin
methods resolve the live hook system from that Config per call.

```typescript
// Already available on HookControlDeps:
//   readonly config: Config
// Live resolutions used by the new methods (all PER CALL, undefined-safe):
//   config.getHookSystem(): HookSystem | undefined          // config.ts:755 (nullable)
//   config.getDisabledHooks(): string[]                     // config.ts:734
//   config.setDisabledHooks(names: string[]): void          // configBase.ts:132
//   hookSystem.isInitialized(): boolean                     // hookSystem.ts:158
//   hookSystem.getRegistry(): HookRegistry                  // hookSystem.ts:137
//   registry.getAllHooks(): HookRegistryEntry[]             // hookRegistry.ts:82
//   registry.getHookName(entry): string                    // hookRegistry.ts:118
```

---

## Numbered Pseudocode

### METHOD listHooks(): readonly HookInfo[]

```
1: // @pseudocode REQ-004.1 — registry snapshot; undefined/uninitialised-safe
2: METHOD listHooks() RETURNS readonly HookInfo[]
3:   SET system = this.deps.config.getHookSystem()
4:   IF system IS undefined THEN RETURN []                  // R-UNDEFINED-SAFE
5:   IF system.isInitialized() IS false THEN RETURN []      // guard: getRegistry/getAllHooks safe only after init
6:   SET registry = system.getRegistry()
7:   SET entries = registry.getAllHooks()                   // HookRegistryEntry[] (hookRegistry.ts:82)
8:   SET out = empty array
9:   FOR EACH entry IN entries
10:    SET info = {
11:      name: registry.getHookName(entry),                 // hookRegistry.ts:118
12:      eventName: String(entry.eventName),                // HookEventName enum → string
13:      enabled: entry.enabled,                             // hookRegistry.ts:41
14:      source: entry.source IS undefined ? undefined : String(entry.source),  // optional; never the literal "undefined"
15:    }
16:    APPEND info TO out
17:  END FOR
18:  RETURN out
19: END METHOD
```

### METHOD getDisabledHooks(): readonly string[]

```
30: // @pseudocode REQ-004.2 — read-through; snapshot copy
31: METHOD getDisabledHooks() RETURNS readonly string[]
32:   RETURN [...this.deps.config.getDisabledHooks()]        // config.ts:734 (fresh copy, not live ref)
33: END METHOD
```

### METHOD setDisabledHooks(names): void

```
40: // @pseudocode REQ-004.3 — write-through; round-trips with getDisabledHooks (R-HOOKS-ROUNDTRIP)
41: METHOD setDisabledHooks(names) RETURNS void
42:   this.deps.config.setDisabledHooks([...names])          // configBase.ts:132 (defensive copy)
43: END METHOD
```

### METHOD enable(name): void  /  disable(name): void

```
50: // @pseudocode REQ-004.4 — convenience over the disabled-set; idempotent
51: METHOD disable(name) RETURNS void
52:   SET current = this.deps.config.getDisabledHooks()
53:   IF current ALREADY CONTAINS name THEN RETURN           // idempotent (no duplicate)
54:   this.deps.config.setDisabledHooks([...current, name])
55: END METHOD
56:
57: METHOD enable(name) RETURNS void
58:   SET current = this.deps.config.getDisabledHooks()
59:   SET next = current.filter(n => n !== name)
60:   this.deps.config.setDisabledHooks(next)                // idempotent if name absent
61: END METHOD
```

---

## Integration Points (Line-by-Line, REAL symbols)

| Pseudocode line | Real symbol / call | File:line (verified) |
|---|---|---|
| 3 | `Config.getHookSystem(): HookSystem \| undefined` | `config.ts:755` |
| 5 | `HookSystem.isInitialized(): boolean` | `hookSystem.ts:158` |
| 6 | `HookSystem.getRegistry(): HookRegistry` | `hookSystem.ts:137` |
| 7 | `HookRegistry.getAllHooks(): HookRegistryEntry[]` | `hookRegistry.ts:82` |
| 11 | `HookRegistry.getHookName(entry): string` | `hookRegistry.ts:118` |
| 13 | `HookRegistryEntry.enabled: boolean` | `hookRegistry.ts:41` |
| 32 | `Config.getDisabledHooks(): string[]` | `config.ts:734` |
| 42/54/60 | `Config.setDisabledHooks(names: string[]): void` | `configBase.ts:132` |
| n/a | `HookRegistryEntry` (re-export) | core barrel `export * from './hooks/index.js'` `index.ts:36` |
| n/a (wiring) | extend existing `buildHookControl()` | `agentImpl.ts:391` |

CLI consumer this unblocks (#1595): `packages/cli/src/ui/commands/hooksCommand.ts`
(`getHookSystem:31,74,144,211,279`, `getDisabledHooks:107,177`, `setDisabledHooks:111,180,239`).

---

## Anti-Pattern Warnings

- [ERROR] DO NOT: call `system.getRegistry()` / `getAllHooks()` without an `isInitialized()` guard.
  [OK] DO: return `[]` when `getHookSystem()` is undefined OR `isInitialized()` is false (R-UNDEFINED-SAFE).
- [ERROR] DO NOT: return the live array from `config.getDisabledHooks()`.
  [OK] DO: return a spread copy `[...]` so callers cannot mutate engine state.
- [ERROR] DO NOT: push a duplicate name in `disable()`.
  [OK] DO: short-circuit when the name is already present (idempotent).
- [ERROR] DO NOT: break/replace the existing `onHookExecution`/`triggerSessionStart`/
  `triggerSessionEnd`/`clear` methods.
  [OK] DO: ADD the admin methods alongside them (REQ-009 non-breaking).
- [ERROR] DO NOT: cache the registry or disabled set on the controller.
  [OK] DO: resolve from `this.deps.config` per call (R-DELEGATE).

---

## Behavior Decision Table

| GIVEN | Method | Result |
|---|---|---|
| `getHookSystem()` undefined | `listHooks()` | `[]` |
| system present, `isInitialized()` false | `listHooks()` | `[]` |
| system initialised, 2 hooks (1 enabled, 1 disabled) | `listHooks()` | length 2; `enabled` flags mirror entries |
| disabled set `["a"]` | `getDisabledHooks()` | `["a"]` (fresh copy) |
| call `setDisabledHooks(["a","b"])` then `getDisabledHooks()` | round-trip | `["a","b"]` (R-HOOKS-ROUNDTRIP) |
| disabled `["a"]`, call `disable("a")` | idempotent | disabled stays `["a"]` |
| disabled `["a","b"]`, call `enable("a")` | — | disabled becomes `["b"]` |
| disabled `["a"]`, call `enable("zzz")` (absent) | idempotent | disabled stays `["a"]` |
