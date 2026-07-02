# Runtime Factory Contract Decision Record

Plan ID: PLAN-20260629-ISSUE2285
Phase: P01 (created) / P09 (finalized)
Artifact type: Decision record (machine-greppable)

This record is the AUTHORITATIVE single source of truth for the
`AgentRuntimeFactoryBindings` contract ownership decision. P08/P08a read the
`decision:` line below to select the proof path. P09 reads it to select the
implementation path and FINALIZES this record with the applied outcome.
P09a/P13/P13a read it for final verification branching.

## Decision

decision: single-source

## Rationale

### Problem

`AgentRuntimeFactoryBindings` is duplicated in two packages:

- `packages/agents/src/api/runtimeFactories.ts:58` — agents-owned.
- `packages/providers/src/runtime/runtimeContextFactory.ts:55` — providers-owned.

The two definitions are structurally identical (same three members:
`agentClientFactory`, `toolSchedulerFactory`, `taskToolRegistration`). The only
surface difference is that the agents version uses an inline
`(config: Config, runtimeState: AgentRuntimeState) => AgentClientContract`
signature for `agentClientFactory`, while the providers version uses the
core-owned `AgentClientFactory` type alias. These are structurally identical —
`AgentClientFactory` (`packages/core/src/core/clientContract.ts:127`) IS the
canonical form of that inline signature.

### Dependency direction evidence

- agents → depends on → providers: `packages/agents/package.json` lists
  `"@vybestack/llxprt-code-providers": "file:../providers"` (line 45).
- providers does NOT depend on agents: grep for
  `@vybestack/llxprt-code-agents` in `packages/providers/package.json` returned
  NO match.
- agents → depends on → core: `packages/agents/package.json` lists
  `"@vybestack/llxprt-code-core": "file:../core"` (line 42).
- providers → depends on → core: `packages/providers/package.json` lists
  `"@vybestack/llxprt-code-core": "file:../core"` (line 152).

Implication: a single source in agents would create providers → agents (wrong
direction / cycle). A single source in providers would make agents import from
providers (acceptable directionally but architecturally odd — providers is a
leaf runtime package, not a contract owner). A single source in core is the
cleanest: BOTH packages already depend on core, creating NO cycle.

### Core ownership evaluation (feasible)

Core already owns ALL constituent contract types:

- `AgentClientFactory`: `packages/core/src/core/clientContract.ts:127`
  (`export type AgentClientFactory = (...)`).
- `ToolSchedulerFactory`:
  `packages/core/src/core/toolSchedulerContract.ts:107`
  (`export type ToolSchedulerFactory = (...)`).
- `TaskToolRegistration`: `packages/core/src/config/toolRegistryFactory.ts:86`
  (`export interface TaskToolRegistration { ... }`).

Core does NOT currently export `AgentRuntimeFactoryBindings` (grep of
`packages/core/src` returned zero hits). Adding the interface to core is an
ADDITIVE, non-breaking change — no existing consumer is affected.

### Feasibility proof

1. Define `AgentRuntimeFactoryBindings` in core, composed from the
   already-core-owned constituent types (`AgentClientFactory`,
   `ToolSchedulerFactory`, `TaskToolRegistration`).
2. Re-export it from core's root barrel so both agents and providers can import
   it via `@vybestack/llxprt-code-core`.
3. Update `packages/agents/src/api/runtimeFactories.ts` to import the interface
   from core instead of declaring it inline.
4. Update `packages/providers/src/runtime/runtimeContextFactory.ts` to import
   the interface from core instead of declaring it inline.
5. Both packages already depend on core — NO new dependency edge, NO cycle.

This is non-breaking because:
- Adding an export to core is additive (no existing import breaks).
- The structural shape is identical in both packages — replacing the inline
  definitions with the core-owned interface changes ZERO call sites (the
  interface members and types are the same).

### Shape comparison (confirmed structurally identical)

agents version (`runtimeFactories.ts:58`):
```ts
export interface AgentRuntimeFactoryBindings {
  agentClientFactory: (config: Config, runtimeState: AgentRuntimeState) => AgentClientContract;
  toolSchedulerFactory: ToolSchedulerFactory;
  taskToolRegistration: () => TaskToolRegistration;
}
```

providers version (`runtimeContextFactory.ts:55`):
```ts
export interface AgentRuntimeFactoryBindings {
  agentClientFactory: AgentClientFactory;
  toolSchedulerFactory: ToolSchedulerFactory;
  taskToolRegistration: () => TaskToolRegistration;
}
```

The `agentClientFactory` inline signature in agents IS `AgentClientFactory`
(`clientContract.ts:127`):
```ts
export type AgentClientFactory = (
  config: Config,
  runtimeState: AgentRuntimeState,
) => AgentClientContract;
```

The core-owned interface uses `AgentClientFactory` (the canonical alias) —
structurally identical to both existing definitions.

## Drift guard

No drift guard is needed. The `single-source` decision eliminates duplication
entirely — both packages import the ONE core-owned interface. There is no
second copy to drift from. A drift guard is only required for the
`retained-duplication` path (which was NOT chosen).

## Downstream phase impact

- **P02/P02a**: runtime-factory pseudocode writes the single-source migration
  plan (move interface to core, update both imports). No drift-guard
  pseudocode needed.
- **P08/P08a**: single-source proof path —
  `runtime-factory-single-source-proof.mjs` makes the EXACT production changes
  P09 will make inside a disposable full-repo worktree copy and runs
  `npm run typecheck`. Does NOT require a drift guard or drift-perturbation
  proof (those are retained-duplication-only).
- **P09/P09a**: applies the single-source migration — defines the interface in
  core, re-exports it, updates both packages to import from core, removes the
  inline declarations. FINALIZES this record with the applied outcome.
- **P13/P13a**: final verification reads `decision: single-source` and asserts
  exactly one declaration in core AND both packages import from the core root.
  Does NOT assert a drift guard (none exists).

## Finalization (P09 fills this section)

**Applied outcome: single-source chosen and applied.**

P09 applied the exact single-source migration proved by the P08 type-proof
(`runtime-factory-typeproof.md` §4 + the disposable-current-working-tree
executable proof `runtime-factory-single-source-proof.mjs`, verified by P08a).
The duplicate `AgentRuntimeFactoryBindings` declarations are eliminated; core
is now the single source of truth.

Applied changes:

- `packages/core/src/core/clientContract.ts` — added the
  `AgentRuntimeFactoryBindings` interface (composed from the core-owned
  `AgentClientFactory`, `ToolSchedulerFactory`, and `TaskToolRegistration`),
  plus the two type-only constituent imports. Core root barrel
  (`packages/core/src/index.ts`) already had `export * from './core/clientContract.js';`,
  so no additional re-export line was required.
- `packages/agents/src/api/runtimeFactories.ts` — removed the local
  `export interface AgentRuntimeFactoryBindings`; replaced with
  `import type { AgentRuntimeFactoryBindings } from '@vybestack/llxprt-code-core'`
  and `export type { AgentRuntimeFactoryBindings } from '@vybestack/llxprt-code-core'`
  so `api/index.ts` and `configBuilder.ts` keep resolving. No constituent
  imports became unused (all remain in use by the public factory functions).
- `packages/providers/src/runtime/runtimeContextFactory.ts` — removed the local
  `export interface AgentRuntimeFactoryBindings`; replaced with the same
  core-root import/re-export, and removed the now-unused constituent imports
  (`AgentClientFactory`, `ToolSchedulerFactory`, `TaskToolRegistration`) to
  satisfy strict/noUnusedLocals. The transitive re-export in
  `runtimeSettings.ts:45`
  (`export type { AgentRuntimeFactoryBindings } from './runtimeContextFactory.js';`)
  keeps resolving.

No drift guard is needed: there is no duplicate source remaining that could
drift. The `single-source` decision is final.

Verification (P09):
- Declaration count: exactly 1
  (`packages/core/src/core/clientContract.ts`).
- Both agents and providers import `AgentRuntimeFactoryBindings` from the core
  root (`@vybestack/llxprt-code-core`).
- `npm run typecheck` passes (exit 0).
- `npm run lint:eslint-guard` passes.
- No suppression directives in phase-owned production source.
- No new `@plan:PLAN-20260629-ISSUE2285` markers in production source.
- No newly introduced deferred language.
