# PR B (of the #2616 lane): Delete AgentRuntimeState global registries

Stacked on PR A (#3739, branch `issue2616`). Branch: `issue2616-pr2`.

## Scope

Issue #2616 inventory item — `core/src/runtime/AgentRuntimeState.ts:166-175`: the
global `runtimeStateRegistry`, `subscriptionRegistry`, and `lastTimestamp`.
Disposition per the issue: "keep immutable state creation only, owned by explicit
caller".

## Census (pinned on 5b949fc96, branch issue2616)

- `runtimeStateRegistry` Map: written by `createAgentRuntimeState` and
  `updateAgentRuntimeState`; **no exported reader exists** (write-only global).
- `subscriptionRegistry` Map: only entry point is
  `subscribeToAgentRuntimeState(runtimeId, cb)`.
- `updateAgentRuntimeState` / `updateAgentRuntimeStateBatch`: **zero production
  callers** (spec file + core `index.ts` re-export only). Therefore the single
  production subscriber below can never fire.
- Sole production subscriber: `packages/agents/src/core/client.ts:158` —
  subscribes to its own runtimeId, callback is a `logger.debug('Runtime state
  changed', ...)`, and `_unsubscribe` is immediately `void`-ed; the unsubscribe
  function does run at `dispose()`, but the callback it removed could never
  fire in production (zero production callers of `updateAgentRuntimeState` mean
  the channel never emits).
- `lastTimestamp` module counter: only used by `getTimestamp()` at state
  creation. Per-lineage monotonicity in the update path is already
  self-contained (busy-wait vs `oldState.updatedAt`).

## Changes

1. `packages/core/src/runtime/AgentRuntimeState.ts`:
   - Delete `runtimeStateRegistry`, `subscriptionRegistry`, `lastTimestamp`,
     `getTimestamp()`, `subscribeToAgentRuntimeState`, `invokeSubscribers`,
     `invokeSubscription`.
   - `createAgentRuntimeState`: drop the registry `.set(...)`; `updatedAt`
     becomes `Date.now()`.
   - `updateAgentRuntimeState`: drop the registry `.set(...)` and the
     changeset/event/invoke-subscriber block; keep validation, immutable
     update, monotonic `updatedAt` vs `oldState.updatedAt`.
   - Keep: `updateAgentRuntimeState(Batch)` (pure public API, tests),
     `getAgentRuntimeStateSnapshot`, sync accessors, errors, types still
     referenced elsewhere (check `RuntimeStateChangedEvent`,
     `RuntimeStateChangeCallback`, `UnsubscribeFunction` consumers before
     deleting any type; delete a type only if unreferenced).
2. `packages/agents/src/core/client.ts`: delete the subscription block,
   `_unsubscribe` field/void, and the deep import.
3. `packages/core/src/index.ts` + `packages/core/src/runtime/index.ts`: stop
   re-exporting `subscribeToAgentRuntimeState` (and deleted types if any).
4. `packages/core/src/runtime/AgentRuntimeState.spec.ts`: delete the
   registry/subscriber test suites; keep creation/update/snapshot/accessor
   suites green. bun:test only.
5. `scripts/tests/ambient-runtime-symbols-guard.ts`: add the banned names
   `runtimeStateRegistry|subscriptionRegistry|subscribeToAgentRuntimeState`
   to the scanned symbol set (production `packages/*/src`, tests excluded),
   with a negative-control case each in the guard's own test.

## Acceptance criteria

1. `rg -n "runtimeStateRegistry|subscriptionRegistry|subscribeToAgentRuntimeState" packages/*/src --glob '!**/*.test.*' --glob '!**/*.spec.*'`
   returns nothing; the CI guard scans the same names.
2. `AgentRuntimeState.ts` retains pure immutable create/update/snapshot
   behavior; its spec's retained suites pass unchanged in their assertions
   (monotonic updatedAt, validation errors, frozen states, snapshots).
3. `client.ts` constructs and runs with no ambient subscription; existing
   client tests pass.
4. Full cycle green: test, lint, typecheck, format, build; zai-glm-flash smoke
   passes.

## Out of scope (later PRs of this lane)

Providers internals (`runtimeRegistry`/`defaultCliRuntimeId`/`runtimeAccessors`
barrel/`registerCliProviderInfrastructure`), agents WeakMap side-channels, CLI
`latestBridge`, `providerManagerInstance` singletons, MCP host callbacks
(#2615/#3222).
