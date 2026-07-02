# Pseudocode: Runtime Factory Contract (single-source core migration)

Plan ID: PLAN-20260629-ISSUE2285
Component: `AgentRuntimeFactoryBindings` single-source migration

## Decision context

**Recorded decision (authoritative — see
`analysis/runtime-factory-contract-decision.md`):**

```
decision: single-source
```

P01 preflight proved single-source in core is feasible (additive,
non-breaking, no cycle — both agents and providers already depend on core).
Core already owns all constituent contract types (`AgentClientFactory`,
`ToolSchedulerFactory`, `TaskToolRegistration`). **No drift guard is needed**
because `single-source` eliminates duplication entirely — both packages import
the ONE core-owned interface. A drift guard is only required for the
`retained-duplication` path (which was NOT chosen).

This file documents the core-ownership migration pseudocode that P09
implements and P08 proves via a disposable-worktree structural typecheck.

## Interface Contracts

```
INPUT: two duplicated declarations:
  - packages/agents/src/api/runtimeFactories.ts:58 (inline agentClientFactory)
  - packages/providers/src/runtime/runtimeContextFactory.ts:55 (AgentClientFactory alias)
OUTPUT: one core-owned AgentRuntimeFactoryBindings, imported by both packages
```

## Numbered pseudocode — single-source core migration

```
10: METHOD migrateRuntimeFactoryBindingsToCore()
20:   // STEP 1: Define the interface in core, composed from core-owned types.
30:   // Core already owns the three constituent types:
40:   //   AgentClientFactory    — packages/core/src/core/clientContract.ts:127
50:   //   ToolSchedulerFactory  — packages/core/src/core/toolSchedulerContract.ts:107
60:   //   TaskToolRegistration  — packages/core/src/config/toolRegistryFactory.ts:86
70:   //
80:   // Core does NOT currently export AgentRuntimeFactoryBindings (grep
90:   // packages/core/src = 0 hits) → adding it is ADDITIVE, non-breaking.
100:  FILE packages/core/src/core/runtimeFactoryBindings.ts
110:    import type { AgentClientFactory } from './clientContract.js'
120:    import type { ToolSchedulerFactory } from './toolSchedulerContract.js'
130:    import type { TaskToolRegistration } from '../config/toolRegistryFactory.js'
140:    export interface AgentRuntimeFactoryBindings {
150:      agentClientFactory: AgentClientFactory
160:      toolSchedulerFactory: ToolSchedulerFactory
170:      taskToolRegistration: () => TaskToolRegistration
180:    }
190:  // The agentClientFactory uses AgentClientFactory (the canonical alias),
200:  // NOT the agents inline signature — they are structurally identical
210:  // (AgentClientFactory IS the inline (config, runtimeState) => AgentClientContract).
220:  //
230:  // STEP 2: Re-export from core's root barrel so both packages can import it.
240:  // The exact core root-barrel path and re-export line are determined in
250:  // P09 against the actual packages/core/src/index.ts surface.
260:  // P08 proves the chosen path resolves under the real workspace typecheck.
270:  EDIT packages/core/src/index.ts
280:    ADD: export type { AgentRuntimeFactoryBindings } from './core/runtimeFactoryBindings.js'
290:  //
300:  // STEP 3: Update agents to import from core instead of declaring inline.
310:  EDIT packages/agents/src/api/runtimeFactories.ts
320:    REMOVE: export interface AgentRuntimeFactoryBindings { ... }  // lines 58+
330:    ADD:    import type { AgentRuntimeFactoryBindings } from '@vybestack/llxprt-code-core'
340:    RE-EXPORT (if agents API barrel exposes it):
350:      export type { AgentRuntimeFactoryBindings } from '@vybestack/llxprt-code-core'
360:  //
370:  // STEP 4: Update providers to import from core instead of declaring inline.
380:  EDIT packages/providers/src/runtime/runtimeContextFactory.ts
390:    REMOVE: export interface AgentRuntimeFactoryBindings { ... }  // lines 55+
400:    ADD:    import type { AgentRuntimeFactoryBindings } from '@vybestack/llxprt-code-core'
410:    RE-EXPORT (if providers barrel exposes it):
420:      export type { AgentRuntimeFactoryBindings } from '@vybestack/llxprt-code-core'
430:  //
440:  // STEP 5: Both packages already depend on core — NO new dependency edge,
450:  // NO cycle. npm run typecheck confirms the migration is non-breaking.
460:  RUN npm run typecheck  // must PASS (exit 0)
470: ENDMETHOD
```

## Why no drift guard

```
500: // The single-source decision eliminates duplication entirely. Both
510: // packages import the ONE core-owned AgentRuntimeFactoryBindings. There
520: // is no second copy to drift from, so no compile-time drift guard is
530: // required. The retained-duplication path (NOT chosen) would require a
540: // .types.ts drift guard with non-distributive tuple-wrapped equality
550: // ([X] extends [Y] — NOT naked X extends Y, which distributes over unions
560: // and silently passes on optional-member drift — architect finding 4).
570: // That guard is documented here ONLY as the NOT-CHOSEN alternative.
```

## P08 proof path (single-source)

```
600: // P08 proves the migration BEFORE production changes via a disposable
610: // full-repo worktree copy. It makes the EXACT changes above inside the
620: // copy and runs `npm run typecheck`. This exercises the REAL workspace
630: // tsconfig path mappings, REAL package root barrels, and REAL inter-
640: // package dependency graph — not a temp-fixture approximation.
650: // P08 does NOT require a drift guard or drift-perturbation proof
660: // (those are retained-duplication-only).
```

## P09 finalization

```
700: // P09 applies the migration to the real worktree and FINALIZES the
710: // decision record (runtime-factory-contract-decision.md) with the
720: // applied outcome. The record was CREATED in P01 with decision:
730: // single-source; P09 does NOT create it — it fills the "Finalization
740: // (P09 fills this section)" block with the applied core module path,
750: // re-export path, and typecheck result.
```

## Anti-pattern warnings

```
[ERROR] DO NOT: define the interface in agents (would create providers → agents cycle)
[OK] DO: define it in core (both packages already depend on core, no cycle)

[ERROR] DO NOT: retain duplication "just in case" without a drift guard
[OK] DO: single-source eliminates duplication; no guard needed

[ERROR] DO NOT (single-source path): add a .types.ts drift guard — it is
         unnecessary and references a second copy that no longer exists
[OK] DO: the single interface in core IS the drift prevention mechanism

[ERROR] DO NOT: change the interface shape during migration (inline → alias
         is structural-only; call sites are unaffected)
[OK] DO: the core-owned interface uses AgentClientFactory (canonical alias),
         which IS structurally identical to the agents inline signature
```
