# PR 2: SessionSchedulerRegistry implementation, schedulerSingleton deletion

Part of #2615, slice E wave 2. Branch `issue2615` (fast-forwarded past merged PR #3710).

## Scope

Replace the process-global, session-id-string-keyed `schedulerSingleton.ts` with the
`SessionSchedulerRegistry` implementation from PR #3710's contracts, keyed by owner
object identity. Delete `packages/core/src/config/schedulerSingleton.ts` and every
reference to it in this PR (issue acceptance: `grep -rn schedulerSingleton packages/`
excluding `dist/` returns nothing).

## Design decisions

1. **Registry implementation.** `packages/core/src/session/sessionSchedulerRegistryImpl.ts`,
   class `SessionSchedulerRegistryImpl implements SessionSchedulerRegistry`, factory
   function `createSessionSchedulerRegistry(deps)`. Deps: `{ createScheduler(options:
   {interactiveMode?: boolean}): Promise<SchedulerHandle> }`. Semantics carried over
   from schedulerSingleton.ts: refcount per entry (owner, purpose); in-flight creation
   dedup (concurrent getOrCreate same key await one factory call, one handle);
   `release` decrements, disposes at zero (dispose errors swallowed at cleanup exactly
   as today); `disposeAll` disposes every entry and joins in-flight creations first;
   releasing an unknown key is a no-op. Keys: `Map<object, Map<SchedulerPurpose, Entry>>`
   (plain Map, not WeakMap: disposeAll must enumerate; entries die on release/disposeAll).
   interactiveMode is first-acquisition-wins per key (matches today's "using existing
   scheduler mode" behavior).

2. **Port amendment (types only).** `SessionSchedulerRegistry.getOrCreate(owner, purpose)`
   gains an optional third parameter `options?: { interactiveMode?: boolean }`.
   Consumer trace: `toolContextInteractiveMode` is a creation argument of
   `toolSchedulerFactory` (schedulerSingleton createNewScheduler -> factory({...,
   toolContextInteractiveMode}), fed by interactiveToolScheduler (true),
   nonInteractiveToolExecutor (false), subagentExecution (absent, defaults true
   today). interactiveMode is not purpose-derivable, so the acquisition carries it.
   If any consumer needs members beyond `schedule/cancelAll/setCallbacks/dispose`,
   widen `SchedulerHandle`'s `Pick` with the traced member list in this same PR.

3. **Temporary Config ownership, named, with deletion criterion.** Config keeps
   `getOrCreateScheduler`/`disposeScheduler` as the caller access point, now backed
   by a lazily created per-Config `SessionSchedulerRegistryImpl` instance field.
   TEMPORARY (issue rule): moves to SessionRuntime when the E-wave lands it;
   deletion criterion: SessionRuntime owns the registry and both Config methods
   plus the field and the lazy getter are deleted in that PR. Code comment on the
   field and getter names this. This is instance state, not a module global; the
   process-global maps die with schedulerSingleton.ts.

4. **Config delegate semantics (preserved exactly unless noted).**
   - deps validation unchanged: missing `deps.messageBus` still throws the #2312 error.
   - The registry's `createScheduler` closure captures the FIRST acquiring call's
     deps (messageBus, toolRegistry) and `getToolSchedulerFactory()`. Today creation
     uses the creating call's deps; identical.
   - After acquisition (fresh, reused, or in-flight-joined), the delegate calls
     `handle.setCallbacks({config, messageBus: current deps, toolRegistry: current
     deps, ...callbacks})`, preserving today's reuse-refresh behavior with current
     deps. Note: today's in-flight path COMBINES the callbacks of concurrent
     acquirers; last-setCallbacks-wins replaces that corner (documented behavior
     change; the first acquirer's callbacks are replaced if a second acquirer joins
     during creation). No production path depends on combined in-flight callbacks;
     the full suite is the arbiter.
   - Signature: `getOrCreateScheduler(owner: object, purpose: SchedulerPurpose,
     callbacks, options?, deps?)` -> `Promise<SchedulerHandle>`; `disposeScheduler(owner:
     object, purpose)`. String session-id keys are gone from the surface.

5. **Caller migration (owner, purpose).**
   - AgenticLoop: owner = the AgenticLoop instance (`this`), purpose `'agentic-loop'`.
     The `schedulerSessionId` UUID key (AgenticLoop.ts:190) is deleted; object
     identity replaces the UUID-suffix workaround. Loop-internal dispose uses the
     same pair. `schedulerSessionId` field and its uses (incl. the constructor line)
     are removed in this PR.
   - interactiveToolScheduler (cli): owner = the per-session runtime object the file
     already holds (read the file; the runtime/scheduler adapter object), purpose
     `'session'`, interactiveMode true path unchanged.
   - subagentExecution: owner = the subagent execution context/runtime object (the
     object that today supplies `ctx.schedulerConfig.getSessionId()`), purpose
     `'subagent'`, forwarded to the foreground Config exactly as today; dispose via
     the same pair. Two subagents with colliding sessionId strings now get distinct
     schedulers (the bug the issue names).
   - nonInteractiveToolExecutor: its context interface's scheduler methods change to
     (owner, purpose) shape; callers pass the subagent/task context object as owner,
     purpose `'subagent'`, interactiveMode false path unchanged.
   - subagentRuntimeSetup toolExecutorContext forwarding: forward (owner, purpose)
     through to foregroundConfig unchanged in spirit.
   - agenticLoop/types.ts ToolExecutorContext (lines ~120) and cliUiRuntime
     (285-286, 680-682) adapters: signature updates only.
   - `getSchedulerInstance` and `clearAllSchedulers`: delete (no production callers;
     test-only cleanup). Tests re-point: per-Config registry means cross-test leakage
     dies; tests that called `clearAllSchedulers()` construct fresh configs or call
     the config registry's disposeAll through a test helper.

6. **Behavioral tests (bun, no mock theater, real schedulers via the existing
   test config factory pattern in config.scheduler.test.ts).**
   - S-same-label (issue acceptance): two owner objects whose session-id strings are
     identical get DISTINCT schedulers (factory invoked twice, handles !== );
     releasing both disposes both.
   - Same owner+purpose acquires one scheduler across two acquisitions (factory
     once, same handle), refcount: first release keeps it schedulable, second
     releases the entry.
   - In-flight dedup: two concurrent getOrCreate on one key -> one factory call,
     one handle; both resolved handles identical.
   - disposeAll: entries disposed, in-flight creation joined then disposed.
   - Loop-level isolation: the existing agenticLoop.scheduler-isolation.test.ts
     keeps passing with owner=loop identity (loop tools isolated from a main
     scheduler acquired by a different owner).
   - Config-level: missing deps.messageBus still throws; setCallbacks refresh on
     reuse still applies the latest acquirer's callbacks (observable via the
     scheduler's behavior with a real scheduler + recording callback).

7. **Counts for the PR description (issue rule: per-PR reconciliation).**
   - schedulerSingleton.ts: 1 module deleted, 0 remaining references.
   - String scheduler keys removed: AgenticLoop UUID key, subagent getSessionId()
     key, nonInteractive sessionId key, interactiveToolScheduler sessionId key.
   - Port members added: getOrCreate options param (+ any SchedulerHandle widening,
     each new Pick member listed with its consumer).
   - Census: Config service-typed fields go from 63 to 63 (toolSchedulerFactory
     removal is a later wave; unchanged this PR), scheduler path moved to registry.

## Out of scope (later E-wave PRs)

SessionRuntime, tasks/shell/approvals/recording migration, toolSchedulerFactory
field deletion, Config getOrCreateScheduler/disposeScheduler deletion (they are the
named temporary delegates), agentImpl/terminalBackground items.

## Verification

Full cycle per the issue: npm run test / lint / typecheck / format / build, plus
zai-glm-flash smoke. Scoped: bun test on touched test files;
`npx tsc --noEmit -p packages/core/tsconfig.noemit.json` and the agents/cli
equivalents if present. Two implementation subagent tasks (core, then callers);
verification run by the orchestrator in background between phases.
