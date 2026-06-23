<!-- @plan:PLAN-20260621-COREAPIREMED.P02 @requirement:REQ-004 -->
# Pseudocode: Public Client Contract Promotion

Component target: `packages/agents/src/api/index.ts` (MODIFY — additive TYPE-ONLY re-export on the
CURATED API barrel) + `packages/agents/src/internals.ts` (CONFIRM class stays) +
`packages/agents/src/index.ts` (CONFIRM root already re-exports both barrels; no edit).
Requirements: REQ-004, REQ-004.1, REQ-004.2.

---

## Symbol Origin (verified)

```
AgentClientContract is CORE-OWNED:
  - DEFINED at: packages/core/src/core/clientContract.ts:67  (structural interface)
  - IMPORTED by agents at: packages/agents/src/core/agenticLoop/types.ts:27
      `import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';`
  - The same module specifier is used by agents elsewhere (createAgent.ts, agentImpl.ts, core/client.ts).
So the promotion RE-EXPORTS the core-owned type; it does NOT define a new type in agents.
```

## Current boundary (verified)

```
- packages/agents/src/internals.ts:38  EXPORT { AgentClient, PostTurnAction } FROM './core/client.js'
- packages/agents/src/index.ts:26-27    EXPORT * FROM './internals.js'  AND  EXPORT * FROM './api/index.js'
    => the package ROOT ALREADY transitively re-exposes the AgentClient CLASS today (NOT absent).
- packages/agents/src/api/index.ts      does NOT export AgentClientContract  (verified ABSENT).
    => the CURATED API barrel is the boundary #1595 imports from and the one that survives the
       #1595 internals trim. THIS is where the contract must be promoted.
```

---

## Interface Contracts

```typescript
// PROMOTED to the CURATED API barrel (packages/agents/src/api/index.ts), TYPE-ONLY:
export type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
//   Same specifier agents already uses (core/agenticLoop/types.ts:27). Re-export, not redefine.

// UNCHANGED on the power-user subpath (internals.ts:38):
export { AgentClient, PostTurnAction } from './core/client.js';

// UNCHANGED at the root (index.ts:26-27): export * from both barrels — so the promoted contract
// reaches the root transitively. NO separate root edit.
```

`AgentClientContract` is the structural contract (clientContract.ts:67). `AgentClient` (concrete
class) implements it. The promotion adds the CONTRACT (type) to the curated API barrel; it does
NOT add the class to that barrel, and it does NOT rely on the root's pre-existing low-level class
re-export (that is #1595's to trim).

---

## Numbered Pseudocode

```
# ---- curated API barrel: packages/agents/src/api/index.ts ----
10: # ADD a TYPE-ONLY re-export of the core-owned structural contract.
11: EXPORT TYPE AgentClientContract FROM '@vybestack/llxprt-code-core/core/clientContract.js'
12:   # SAME module specifier agents already imports at core/agenticLoop/types.ts:27.
13:   # Re-export only; do NOT redefine the interface in agents.
14: # DO NOT add the concrete AgentClient class to this barrel.
15: # DO NOT add a runtime value named AgentClientContract (type-only, erasable — REQ-004.2).

# ---- power-user subpath: internals.ts (UNCHANGED) ----
20: # CONFIRM line 38 still: EXPORT { AgentClient, PostTurnAction } FROM './core/client.js'
21: # No change; this is the non-breaking guarantee REQ-004.1.

# ---- package root: index.ts (UNCHANGED) ----
30: # CONFIRM lines 26-27 still: EXPORT * FROM './internals.js' AND EXPORT * FROM './api/index.js'
31: # => promoted contract reaches the root transitively; NO root edit required.
```

---

## Integration Points (Line-by-Line)

```
Line 11: type-only export of AgentClientContract on api/index.ts
         - Use `export type { ... }` to keep it erasable (no runtime cost, no value export).
         - Consumers (#1595) type-reference the client from the curated barrel without importing
           ./core/client.js, ./internals.js, or core internals.
Line 14-15: no class, no runtime value at the barrel
         - Keeps the curated barrel a TYPE promotion only; the concrete class stays a power-user
           concern on internals.js.
Line 20: internals.ts:38 unchanged
         - Existing deep consumers (a2a, etc.) keep working (REQ-004.1, REQ-006.1).
Line 30-31: root unchanged
         - Root already re-exports both barrels; the contract is reachable transitively. The plan
           does NOT promise the root's low-level AgentClient class re-export as stable surface.
```

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: add the type-only export to packages/agents/src/index.ts (the root)
[OK]   DO:     add it to packages/agents/src/api/index.ts (curated barrel #1595 imports from)

[ERROR] DO NOT: export { AgentClient } from './core/client.js'  // class onto the curated barrel
[OK]   DO:     export type { AgentClientContract } ...           // contract only

[ERROR] DO NOT: export const AgentClientContract = ...           // it's a TYPE, not a value
[OK]   DO:     export type { AgentClientContract }

[ERROR] DO NOT: remove the internals.ts:38 export                // breaking change
[OK]   DO:     leave it untouched (REQ-004.1)

[ERROR] DO NOT: redefine AgentClientContract inside agents       // single source is core
[OK]   DO:     re-export the existing core-owned contract type from clientContract.js

[ERROR] DO NOT: claim the root previously exported NEITHER class nor contract  // false; root
                already re-exposes the class via `export * from './internals.js'`
[OK]   DO:     promote the CONTRACT on the curated barrel; acknowledge the root class re-export
```

---

## Verification Hooks (for the harness, T5/T9)

```
- Type import test: `import type { AgentClientContract } from '@vybestack/llxprt-code-agents'`
  compiles and the type structurally matches clientContract.ts (has getCurrentSequenceModel, etc.).
  (Resolves via the curated API barrel; also resolves from the root transitively.)
- Static test: `AgentClient` is STILL importable from '@vybestack/llxprt-code-agents/internals.js'.
- Type-only test: no runtime export key named `AgentClientContract` on the api barrel namespace.
- Non-breaking: every export present in api/index.ts AND index.ts before this phase is still present.
```
