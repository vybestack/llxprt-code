<!-- @plan:PLAN-20260621-COREAPIREMED.P02 @requirement:REQ-005,REQ-001.2 -->
# Pseudocode: Providers `providerManager?` Adoption Seam

Component target: `packages/providers/src/runtime/runtimeContextFactory.ts` (MODIFY — add
`providerManager?` option + adopt it via `options.providerManager ?? new ProviderManager(...)`).
NOTE: NO adoption flag is threaded to cleanup — the factory performs no ProviderManager disposal for
either path (verified runtimeContextFactory.ts cleanup ~400-447), so there is nothing to gate; the
same manager instance (adopted or factory-built) is passed through to `onCleanup` exactly as today.
Requirements: REQ-005, REQ-005.2, REQ-001.2.

---

## Why (CRIT-1 grounding, verified against source)

`createIsolatedRuntimeContext` builds a `ProviderManager` UNCONDITIONALLY:

```
const providerManager = new ProviderManager({
  runtime: initialRuntimeContext,
  settingsService: resolvedSettingsService,
  config,
});
```

There is NO `providerManager?` option (unlike `messageBus?`, adopted via
`options.messageBus ?? new MessageBus(...)`). The "no second ProviderManager" invariant
(REQ-001.2/REQ-005.2) is therefore unsatisfiable without this seam. This pseudocode mirrors the
existing `messageBus?` adoption pattern exactly.

### CRIT-1 type decision — the option is the STRUCTURAL `RuntimeProviderManager`, NOT the concrete class (verified type-safe)

The agents-side caller (`fromConfig`, P09) derives the manager to adopt from
`Config.getProviderManager()`, whose declared return type is the CORE structural interface
`RuntimeProviderManager | undefined` (verified `packages/core/src/config/configBaseCore.ts:265`;
interface at `packages/core/src/runtime/contracts/RuntimeProviderManager.ts:50-67`). The concrete
providers class is declared `class ProviderManager implements IProviderManager` (verified
`packages/providers/src/ProviderManager.ts:80`) — it does NOT declare `implements
RuntimeProviderManager`. Therefore typing the seam option as the concrete `ProviderManager` would
leave P09 with NO type-safe path to pass `config.getProviderManager()` (a `RuntimeProviderManager`)
under the plan's no-`any`/no-unsafe-`as` constraint.

**Decision (Option 1 — verified valid): type the INPUT option as the structural
`RuntimeProviderManager` interface** (imported from `@vybestack/llxprt-code-core`, which the
providers package ALREADY imports widely — verified `runtimeContextFactory.ts:24`,
`runtimeLifecycle.ts:29,92`, `runtimeAccessors.ts:29`, `runtimeRegistry.ts:24`,
`composition/providerManagerInstance.ts:19,175`). This is type-safe because EVERY consumer of the
adopted instance on the factory path uses ONLY structural-interface members:

```
- (providerManager as unknown as { runtime?: ProviderRuntimeContext }).runtime = scopedRuntime
    -> already a cast onto an ad-hoc shape; works on ANY object (verified runtimeContextFactory.ts,
       activate closure).
- bindings.registerInfrastructure(providerManager, oauthManager, { messageBus })
    -> CLI impl registerCliProviderInfrastructure(manager: RuntimeProviderManager, ...) ALREADY
       types its param as the structural interface (verified runtimeLifecycle.ts:91-92); it calls
       manager.setConfig(config) (a RuntimeProviderManager member, RuntimeProviderManager.ts:65) and
       registerProviderManagerSingleton(manager as never, ...) (the `as never` decouples internally —
       verified providerManagerInstance.ts:612).
- bindings.linkProviderManager(config, providerManager)
    -> CLI impl configureProviderRuntimeFactories(config, manager: RuntimeProviderManager) ALREADY
       types its param as the structural interface and calls config.setProviderManager(manager)
       (Config.setProviderManager(p: RuntimeProviderManager), configBaseCore.ts:262) — verified
       providerManagerInstance.ts:173-176.
- options.prepare / options.onCleanup receive providerManager; the agents callers use ONLY
    .listProviders()/.getProviderByName()/.registerProvider()/.setActiveProvider()/
    .getActiveProvider() (all RuntimeProviderManager members) — verified
    packages/agents/src/api/createAgent.ts:438-472 (registerProvidersOntoManager) and
    agentImpl.ts:910 (.listProviders()).
```

The DEFAULT path still constructs `new ProviderManager({...})`, which structurally satisfies
`RuntimeProviderManager` (the same instance is already passed to the
`RuntimeProviderManager`-typed `configureProviderRuntimeFactories`/`registerCliProviderInfrastructure`
today). Consequently P09 passes `config.getProviderManager()` with **ZERO assertion and no `any`**.

To keep the resolved local assignable end-to-end, the factory's INTERNAL types that carry the
manager are widened to `RuntimeProviderManager` as well: the `IsolatedRuntimeContextHandle.providerManager`
field, the `buildActivateClosure`/`buildCleanupClosure` `providerManager` params, the
`prepare`/`onCleanup` callback-context `providerManager`, and the `RuntimeActivationBindings`
`registerInfrastructure`/`linkProviderManager` `manager` params (the latter already MATCH the CLI
impls which are typed `RuntimeProviderManager`). No `IProviderManager`/concrete-only member is used
on the adopted path, so this widening is purely a type change with no behavioral effect.

### Stub → RED → GREEN split (CRIT-2)

To keep TDD honest, the field DECLARATION and the ADOPTION are split across phases:

- **P03 (stub):** DECLARE the optional `providerManager?: RuntimeProviderManager` field ONLY (mirror
  the `messageBus?` declaration at ~line 199; ADD a type-only `import type { RuntimeProviderManager }`
  to the file's existing `@vybestack/llxprt-code-core` import block at ~line 22 — the file does NOT
  import this type today, so P03 must add it, mirroring sibling files runtimeLifecycle.ts:29 /
  runtimeAccessors.ts:29 / runtimeRegistry.ts:24). KEEP the construction site UNCONDITIONAL
  (`const providerManager = new ProviderManager({...})` at ~lines 502-506). Adoption is ABSENT.
- **P04 (TDD):** the identity test `handle.providerManager === pm` FAILS RED because the stub still
  builds a fresh manager.
- **P05 (impl):** ADD the `??` adoption at the construction site (lines 11-14 below), mirroring
  `options.messageBus ?? new MessageBus(...)` (~lines 482-484), flipping P04 GREEN.

The resulting `providerManager` is consumed by `buildActivateClosure(...)` /
`buildCleanupClosure(...)`; inside activate it is passed to
`bindings.registerInfrastructure(providerManager, oauthManager, { messageBus })` and
`bindings.linkProviderManager(config, providerManager)` (which calls `config.setProviderManager`).
`Config.getProviderManager(): RuntimeProviderManager | undefined` exists (configBaseCore.ts:265);
the AGENTS-side caller (`fromConfig`, P09) derives the manager to pass — the factory only ADOPTS.

---

## Interface Contracts

```typescript
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core'; // ADD to the file's existing core import block (runtimeContextFactory.ts:22) in P03; the file does NOT import this type today

// ADDED to IsolatedRuntimeContextOptions (near config?/messageBus? declarations):
interface IsolatedRuntimeContextOptionsAddition {
  /**
   * Caller-provided provider manager; when present, ADOPT (do not construct a second).
   * Typed as the STRUCTURAL core interface RuntimeProviderManager (NOT the concrete providers
   * class) so the agents caller can pass Config.getProviderManager() (which returns
   * RuntimeProviderManager | undefined) with ZERO assertion. The default `new ProviderManager(...)`
   * structurally satisfies this interface.
   */
  providerManager?: RuntimeProviderManager;   // structural core interface (CRIT-1)
}

// OUTPUT widened to the structural interface (purely a type change; default path still builds a
// concrete ProviderManager which satisfies it):
//   IsolatedRuntimeContextHandle { ..., providerManager: RuntimeProviderManager, ... }
```

---

## Numbered Pseudocode

```
# ---- adoption at the (formerly unconditional) construction site ----
# P03 STUB: only declares the option; construction stays `new ProviderManager({...})` (no ??).
# P05 IMPL: replaces the unconditional construction with the `??` adoption below (lines 11-14).
# (No providerManagerAdopted flag is needed: cleanup performs no manager disposal for either path,
#  so there is nothing to gate — see the cleanup section below.)
11: SET providerManager = options.providerManager                    # P05: adoption ?? seam
12:                       ?? new ProviderManager({ runtime: initialRuntimeContext,
13:                                                 settingsService: resolvedSettingsService,
14:                                                 config })
15: # NOTE: exactly ONE `new ProviderManager(` remains in the file (the ?? right-hand side).

# ---- activate closure (existing) — adoption-safe linking ----
20: WITHIN buildActivateClosure:
21:   AWAIT bindings.registerInfrastructure(providerManager, oauthManager, { messageBus })
22:   # linkProviderManager sets config.setProviderManager(providerManager).
23:   # When the adopted manager is ALREADY config.getProviderManager() (fromConfig case), this is
24:   # an idempotent set of the SAME reference — safe, no swap, no second manager.
25:   AWAIT bindings.linkProviderManager(config, providerManager)

# ---- cleanup closure — VERIFIED no-new-disposal contract ----
# GROUNDED: the shipped buildCleanupClosure (runtimeContextFactory.ts:400-447) resets
# infrastructure, clears the settings runtime context, flushes the auth scope, invokes
# options.onCleanup({... providerManager ...}), and optionally disposeRuntime. It does NOT dispose
# or tear down the ProviderManager for EITHER path (grep for a providerManager-disposal call in that
# closure is EMPTY). The adoption seam therefore introduces NO NEW disposal:
30: WITHIN buildCleanupClosure (UNCHANGED disposal behavior):
31:   # Do NOT add manager disposal for the adopted path (caller-owned).
32:   # Do NOT add manager disposal for the default path either — keep today's behavior
33:   #   byte-for-byte (the closure does not dispose the manager today).
34:   PASS the SAME providerManager instance (adopted or factory-built) into options.onCleanup,
35:        exactly as today.
36:   # No `providerManagerAdopted` disposal-gating flag is required because there is no manager
37:   #   disposal to gate. (If a FUTURE change ever adds manager disposal, it must skip the adopted
38:   #   instance — but that is OUT OF SCOPE for this seam.)
40: END
```

---

## Integration Points (Line-by-Line)

```
Line 11-14: options.providerManager ?? new ProviderManager(...)
         - Mirrors options.messageBus ?? new MessageBus(...) at the same scope.
         - Field declared on IsolatedRuntimeContextOptions; typed as the STRUCTURAL core interface
           RuntimeProviderManager (CRIT-1) so Config.getProviderManager() flows in with no assertion.
           The `??` result type is `RuntimeProviderManager` (the default concrete ProviderManager is
           assignable to it). The resolved local + handle field + activate/cleanup closures +
           prepare/onCleanup contexts are all RuntimeProviderManager-typed; the
           RuntimeActivationBindings registerInfrastructure/linkProviderManager params are likewise
           RuntimeProviderManager (matching the CLI impls registerCliProviderInfrastructure /
           configureProviderRuntimeFactories, which ALREADY take RuntimeProviderManager — verified
           runtimeLifecycle.ts:91-92, providerManagerInstance.ts:173-176).
Line 22-25: bindings.linkProviderManager(config, providerManager)
         - Existing call. For the adopt path the manager is typically already the Config's; the
           set is idempotent. Do NOT add a branch that constructs/swaps.
Line 30-40: cleanup no-new-disposal contract
         - VERIFIED: buildCleanupClosure (runtimeContextFactory.ts:400-447) does NOT dispose the
           ProviderManager for either path today. This seam adds NO disposal: the adopted manager is
           not force-disposed (caller-owned), and the default path is unchanged. onCleanup receives
           the same manager instance activation used. There is no adoption flag to thread because
           there is no disposal to gate.
```

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: add a second `new ProviderManager(` anywhere          // breaks single-construction
[OK]   DO:     keep exactly one, as the ?? right-hand side

[ERROR] DO NOT: ignore options.providerManager and always construct   // defeats REQ-001.2
[OK]   DO:     adopt when supplied

[ERROR] DO NOT: add manager disposal to cleanup for EITHER path       // cleanup disposes no manager today
[OK]   DO:     leave cleanup disposal behavior unchanged; onCleanup gets the same manager instance

[ERROR] DO NOT: call config.getProviderManager() inside the factory   // adoption is caller's job
[OK]   DO:     adopt exactly what the caller passes (agents fromConfig derives it — P09)

[ERROR] DO NOT: type the option as the concrete `ProviderManager`      // forces an unsafe cast in P09
                (Config.getProviderManager() returns RuntimeProviderManager | undefined, NOT the class)
[OK]   DO:     type the option as the STRUCTURAL `RuntimeProviderManager` interface (CRIT-1)

[ERROR] DO NOT: use `as ProviderManager`/`as any`/`as unknown as ProviderManager` on the adopt path
[OK]   DO:     keep the adopt path assertion-free; the default `new ProviderManager(...)` satisfies
              the interface and the agents caller passes a RuntimeProviderManager directly
```

---

## Verification Hooks (T1–T6)

```
- T1: createIsolatedRuntimeContext({..., providerManager: pm}) -> handle.providerManager === pm.
- T2: omit option -> handle.providerManager is fresh (!== pm).
- T4: instrument the ProviderManager constructor -> count unchanged when option supplied.
- T6: cleanup() introduces NO new disposal for either path (the shipped closure disposes no
      manager today); onCleanup receives the same manager activation used (the adopted pm on the
      adopt path). Do NOT assert "default-path manager torn down" — that behavior does not exist.
- T7 (CRIT-1 type-safety, enforced as a grep gate in P05/P05a): the option is declared
      `providerManager?: RuntimeProviderManager` (structural interface), and NO `as ProviderManager`/
      `as any`/`as unknown as ProviderManager`/`: any` appears on the adopt path. The default
      construction site remains exactly one `new ProviderManager(`.
```
