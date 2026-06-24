<!-- @plan:PLAN-20260617-COREAPI.P02 @requirement:REQ-016 -->
# Pseudocode: dispose / teardown

Plan ID: PLAN-20260617-COREAPI
Phase: P02 (finalized)
Component: `packages/agents/src/api/agentDispose.ts`
Requirements: REQ-016 (dispose ownership/teardown table)

---

## Interface Contracts

```typescript
// INPUTS:
interface DisposeInput { ownership: OwnershipRecord }   // recorded at createAgent line 141

// OwnershipRecord T13 completion markers (the disposed-observable for resources
// that have NO boolean flag of their own and that the headless harness never
// creates a live instance of — LSP/extensions/session-locks). dispose() sets
// each marker = true ONLY after its corresponding NET-NEW teardown step
// completes without throwing (set INSIDE the safe() closure, after the await).
// These are the GREEN-reachable observables T13 reads (a real primitive flag
// does not exist; a primitive transition is unobservable in fake mode). They are
// bookkeeping on the SAME ownership record captured pre-dispose — they do NOT
// change teardown behavior.
//   ownership.disposed: boolean               // idempotency guard (line 13)
//   ownership.lspShutDown?: boolean           // set after line 70 succeeds
//   ownership.extensionsDisposed?: boolean    // set after line 80 succeeds
//   ownership.sessionLocksReleased?: boolean  // set after lines 81-82 complete

// OUTPUTS:
type DisposeOutput = Promise<void>                      // idempotent; all teardown awaited

// DEPENDENCIES (real, all created by createAgent):
interface Dependencies {
  config, providerManager, oauthManager, messageBus, loopHolder, activeRunController,
  injectedFactoryScheduler?, injectedFactoryCoordinator?, mcpManager, extensionsManager,
  sessionLocks, busSubscriptions, runtimeHandle
}
```

## Integration Points

```
Line 30: activeRunController.abort() - facade-owned AbortController whose .signal was passed to loop.run(message, signal); AgenticLoop has NO cancel/dispose method and self-cleans in run()'s finally (G1)
Line 40: injectedFactoryScheduler?.dispose()   - CONDITIONAL T19 only: dispose a facade-held scheduler ONLY IF one was created via the injected toolSchedulerFactory and retained by the facade (guard with existence check). Per-turn loop schedulers are owned+disposed by AgenticLoop via config.getOrCreateScheduler (AgenticLoop.ts:436) / config.disposeScheduler (AgenticLoop.ts:552) in the loop's finally — NOT by dispose().
Line 45: injectedFactoryCoordinator?.dispose() - CONDITIONAL T19 only: dispose the coordinator ONLY IF it backs an injected-factory scheduler held by the facade (coordinator is owned by the scheduler). Per-turn coordinators are created+disposed by AgenticLoop with the per-turn scheduler.
Line 55: runtimeHandle.cleanup()              - unregisters runtime context (B5)
Line 60: config.dispose()                     - core (partial today: agentClient + mcpClientManager)
Line 70: ownership.config.shutdownLspService() - method exists on Config (configBase.ts:159, calls shutdownLsp from lspIntegration.ts:388) but is NOT called by Config.dispose() today (NET-NEW wiring)
Line 80: extensions/hook subs/session locks   - NO teardown today (NET-NEW)
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT dispose caller-supplied resources   [OK] only tear down what createAgent created
[ERROR] DO NOT fire-and-forget teardown            [OK] await every disposal
[ERROR] DO NOT throw if already disposed           [OK] idempotent; guard with disposed flag
[ERROR] DO NOT leave bus subscriptions attached    [OK] unsubscribe all recorded subs
```

## Numbered Pseudocode

```
10: METHOD dispose(ownership)
11:   IF ownership.disposed
12:     RETURN                                            # idempotent
13:   ownership.disposed = true
14:   errors = []
15:
20:   await safe(errors, () => agent.hooks.trigger('SessionEnd'))   # REQ-015 lifecycle
21:
30:   await safe(errors, () => ownership.activeRunController?.abort())  # G1: stop in-flight turn by aborting the facade-owned AbortController whose .signal was passed to loop.run(message, signal); AgenticLoop has NO cancel/dispose method and self-cleans in run()'s finally (AgenticLoop.ts:300-305) (B1: controller + loop in mutable slots)
31:
40:   IF ownership.injectedFactoryScheduler EXISTS                # CONDITIONAL T19: only a facade-held scheduler created via the injected toolSchedulerFactory is disposed here. Per-turn loop schedulers are owned+disposed by AgenticLoop (config.getOrCreateScheduler AgenticLoop.ts:436 -> config.disposeScheduler AgenticLoop.ts:552 in the loop's finally) — dispose() does NOT touch them.
41:     await safe(errors, () => ownership.injectedFactoryScheduler.dispose())  # T19 conditional; guard with existence check
42:   END IF
45:   IF ownership.injectedFactoryCoordinator EXISTS              # CONDITIONAL T19: coordinator is owned by the injected-factory scheduler; only present when an injected-factory scheduler was created and retained
46:     await safe(errors, () => ownership.injectedFactoryCoordinator.dispose())  # T19 conditional
47:   END IF

50:   FOR sub IN ownership.busSubscriptions
51:     safe(errors, () => sub.unsubscribe())                       # NET-NEW wiring
52:
55:   await safe(errors, () => ownership.runtimeHandle.cleanup())   # unregister runtime context (B5)
56:
60:   await safe(errors, () => ownership.config.dispose())          # disposes agentClient + mcpClientManager
61:
70:   await safe(errors, () => { await ownership.config.shutdownLspService(); ownership.lspShutDown = true })  # NET-NEW wiring: method exists on Config (configBase.ts:159 -> shutdownLsp, lspIntegration.ts:388) but Config.dispose() does NOT call it today. The Config the facade already owns exposes this method directly — there is NO separate LSP manager object. T13 observable: set ownership.lspShutDown = true INSIDE safe(), AFTER the await, so it only flips on success (the real LspState has no boolean and the harness never starts LSP, so this completion marker is the GREEN-reachable disposed-observable).
71:
80:   await safe(errors, () => { await ownership.extensionsManager.dispose(); ownership.extensionsDisposed = true })  # NET-NEW. T13 observable: set ownership.extensionsDisposed = true INSIDE safe(), AFTER the await (Config has no extensionsManager field of its own and the harness creates none; this marker is the GREEN-reachable disposed-observable).
81:   FOR lock IN ownership.sessionLocks
82:     await safe(errors, () => lock.release())                    # NET-NEW
83:   ownership.sessionLocksReleased = true                         # T13 observable: set AFTER the release loop completes (SessionLockManager.release() flips a CLOSURE var, not a handle property; this marker is the GREEN-reachable disposed-observable). With zero locks (headless) the loop is a no-op and the marker still flips true, matching "all locks released."
84:
90:   # OAuth infra is torn down as part of runtimeHandle.cleanup() above (line 55).
91:   # If runtimeHandle does not dispose oauthManager, dispose explicitly:
92:   await safe(errors, () => ownership.oauthManager?.dispose?.())   # defensive; runtimeHandle.cleanup() should handle it
93:
100:  IF errors.length > 0
101:    THROW AggregateDisposeError(errors)                         # surface, do not swallow
102:  RETURN
103: END METHOD
104:
110: METHOD safe(errors, fn)
111:   TRY await fn()
112:   CATCH e: errors.push(e)                                      # continue tearing down rest
113: END METHOD
```

## Resource-ownership / teardown table (drives T13)
| Resource | Created by | Torn down by | Exists today? |
|---|---|---|---|
| runtime context (Config+Settings+ProviderManager+OAuth under one runtimeId) | createAgent via createIsolatedRuntimeContext | runtimeHandle.cleanup() (unregisters + tears down) | yes (handle.activate/cleanup) |
| config-owned AgentClient | Config.refreshAuth | config.dispose -> agentClient.dispose | partial (yes) |
| MCP transports | Config.initialize | config.dispose -> mcpClientManager.stop | yes |
| CoreToolScheduler — per-turn loop scheduler (TRANSIENT) | AgenticLoop via config.getOrCreateScheduler (AgenticLoop.ts:436) | config.disposeScheduler (AgenticLoop.ts:552) — disposed by AgenticLoop in the loop's finally, NOT by dispose() | yes (loop-owned; facade does NOT hold it) |
| CoreToolScheduler — facade-held injected-factory instance (T19, CONDITIONAL) | createAgent via injected toolSchedulerFactory, retained by the facade | injectedFactoryScheduler.dispose() (guarded existence check) | conditional; only present when an injected toolSchedulerFactory creates an instance the facade holds (T19). Most agents have NO facade-held scheduler. |
| ConfirmationCoordinator | owned by whichever scheduler created it | coordinator.dispose() (with its scheduler) | per-turn coordinator => loop-owned; facade-held coordinator => only the conditional T19 injected-factory case |
| MessageBus subscriptions | createAgent + control | unsubscribe all | NET-NEW |
| AgenticLoop active run | chat/stream | facade-owned activeRunController.abort() (the signal passed to loop.run; loop self-cleans in run()'s finally) | partial |
| LSP service | config/configBase (configBase.ts:159) | config.shutdownLspService() (-> shutdownLsp, lspIntegration.ts:388) | method exists on Config but NOT called by Config.dispose() today (NET-NEW wiring); teardown is a Config method, NOT a separate object |
| Extensions | Config.initialize | extensionsManager.dispose() | NET-NEW |
| Session/recording locks | session control | lock.release() | NET-NEW |
| OAuth infra | runtime context factory | runtimeHandle.cleanup() (oauthManager disposed within) | check in preflight |

## T13 disposed-observable per row (what the harness reads — GREEN-reachable)
The harness (`disposal.spec.ts` + `helpers/disposalProbe.ts`) captures references
PRE-dispose and reads a disposed-observable POST-dispose. Each observable below is
one that GENUINELY transitions for the headless fake agent. Resources with no
primitive boolean AND no live instance in fake mode are observed via an
OwnershipRecord completion marker that dispose() sets after the teardown await
(see Interface Contracts). P24 MUST produce exactly these observables; P24a checks them.
| Resource | T13 disposed-observable | Why this observable |
|---|---|---|
| config-owned AgentClient | `agentClient._unsubscribe` transitions `function → undefined` | client.ts:146 sets `_unsubscribe = subscribeToAgentRuntimeState(...)`; client.ts:263-265 calls it then sets `undefined`. AgentClient has NO `disposed` boolean; this is the real transition the fake (constructed by Config.refreshAuth) actually performs. |
| facade-held injected-factory scheduler (T19) | recording handle `.disposed === true` | The injected recording fake handle exposes a real `disposed` boolean flipped by `dispose()`. Built only WITH an injected toolSchedulerFactory + a driven tool turn. |
| facade-held injected-factory coordinator (T19) | recording coordinator `.disposed === true` | Same injected-fake path; coordinator backs the injected scheduler. |
| MessageBus subscriptions | `emitter.eventNames().reduce(+listenerCount(name)) === 0` | Real private `EventEmitter`; total listener tally reaches baseline once all recorded subs are removed (lines 50-52). |
| LSP service | `ownership.lspShutDown === true` | Real `LspState` has NO boolean and the harness never starts LSP (no primitive transition is observable); dispose() sets this marker after `config.shutdownLspService()` (line 70). |
| Extensions | `ownership.extensionsDisposed === true` | Config has no `extensionsManager` field of its own and the harness creates none; dispose() sets this marker after `extensionsManager.dispose()` (line 80). |
| Session/recording locks | `ownership.sessionLocksReleased === true` | `SessionLockManager.release()` flips a CLOSURE var, not a handle property; dispose() sets this marker after the release loop (lines 81-82); with zero locks the marker still flips true (vacuously "all released"). |
| AggregateDisposeError | `e.name === 'AggregateDisposeError' && Array.isArray(e.errors)` | Structural predicate; the class is created at P24 (line 101) — specs assert shape without importing it. |

## Notes for impl phase
- Lines 40-47 are CONDITIONAL (T19): the facade disposes a scheduler/coordinator ONLY
  IF an injected `toolSchedulerFactory` created a facade-held instance. Per-turn loop
  schedulers are TRANSIENT — created by AgenticLoop via `config.getOrCreateScheduler`
  (AgenticLoop.ts:436) and disposed by the loop itself via `config.disposeScheduler`
  (AgenticLoop.ts:552) in the loop's `finally`. dispose() does NOT touch loop-owned
  schedulers. This reconciles with tool-confirmation-merge.md D1: the Agent facade does
  NOT own a stable scheduler; status flows through the AgenticLoopEvent stream. Most
  agents have NO facade-held scheduler, so lines 40-47 are no-ops then.
- Lines 70/80/82 are the genuinely NET-NEW cleanup flagged in the overview. Each
  sets its OwnershipRecord completion marker (`lspShutDown` / `extensionsDisposed` /
  `sessionLocksReleased`) AFTER its teardown await succeeds — these markers are the
  T13 disposed-observable for resources that have no primitive boolean and that the
  headless harness never instantiates live (see the "T13 disposed-observable per row"
  table). They are bookkeeping on the SAME ownership record captured pre-dispose; they
  do not alter teardown behavior. dispose()'s idempotency guard (`ownership.disposed`)
  already lives on this record, so the markers are co-located with existing state.
- Line 55 calls `runtimeHandle.cleanup()` to unregister the runtime context
  (`setCliRuntimeContext` teardown) — this is required so the switch pipeline no
  longer resolves this agent's instances after dispose (B5). The OAuth manager is
  torn down within cleanup (or defensively at line 92).
- Line 30 aborts the facade-owned `activeRunController` (B1 + G1): the `.signal` of
  this controller is what was passed to `loop.run(message, signal)`. AgenticLoop has NO
  cancel/dispose method; it cancels via the AbortSignal and self-cleans in run()'s
  `finally` (`unsubscribe(); this.isRunning = false`, AgenticLoop.ts:300-305). The
  controller (and the loop slot) live in mutable slots because `rebuildLoop`
  reconstructs them on every client rebind; dispose reads the CURRENT controller from
  the slot, not a stale fixed ref.
- T13 asserts each table row's disposed flag, not a generic no-open-handles check.
