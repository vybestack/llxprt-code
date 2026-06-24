<!-- @plan:PLAN-20260621-COREAPIREMED.P02 @requirement:REQ-005,REQ-001.2 -->
# Pseudocode: Provider-Runtime Reachability Seam

Component target: `packages/agents/src/api/agent.ts` (MODIFY — add `getRuntimeId`) +
`packages/agents/src/api/agentImpl.ts` (MODIFY — impl + confirm providers sub-surface adopts
runtime).
Requirements: REQ-005, REQ-005.1/.2, REQ-001.2.

---

## Interface Contracts

```typescript
// ADDED to the public Agent interface:
interface AgentRuntimeSurface {
  getRuntimeId(): string;          // read-only; the bound runtime-context runtimeId
}

// DEPENDENCIES (NEVER stubbed):
interface Dependencies {
  runtimeId: string;               // threaded from finalizeAgent (createAgent.ts:240 sessionId/runtimeId)
  // providers sub-surface (existing #1594): getProvider()/getModel()/getProviderStatus()
  // read the PER-AGENT snapshot `this.providerState` (agentImpl.ts:594/621/648), which is seeded
  // in the constructor from `deps.runtimeState` (agentImpl.ts:267-275). `deps.runtimeState`,
  // `deps.config`, and `deps.providerManager` all originate from the ADOPTED runtime context, so
  // the snapshot + switch pipeline operate on the adopted instances (REQ-001.2). There is NO
  // `getCliRuntimeServices()` call in agentImpl — these are direct providerState reads.
}
```

`fromConfig` adopts the provider runtime via `createIsolatedRuntimeContext({ config, ... })`
(see config-injection-seam.md). The `ProviderManager` is the one reachable from the adopted
Config; NO second manager is constructed (REQ-001.2). The existing DIRECT provider/model methods
(`agent.getProvider()`/`agent.getModel()`/`agent.getProviderStatus()`) return the per-agent
`this.providerState` snapshot (agentImpl.ts:594/621/648), seeded at construction from
`deps.runtimeState` (agentImpl.ts:267-275). Because `deps.runtimeState`/`deps.config`/
`deps.providerManager` derive from the adopted runtime, the snapshot reflects the adopted Config's
active provider/model (shipped #1594 behavior, unchanged).

---

## Numbered Pseudocode

```
10: METHOD getRuntimeId() -> string
11:   RETURN this.deps.runtimeId                     # the runtimeId bound at build time; REQ-005.1
12: END METHOD

# DIRECT provider/model methods (EXISTING, confirm adoption — no new impl, just adopted-runtime wiring)
20: # agent.getProvider()/getModel()/getProviderStatus() return this.providerState.* (agentImpl.ts
21: #   594/621/648), a per-agent snapshot seeded from deps.runtimeState (agentImpl.ts:267-275).
22: # Because fromConfig builds deps.runtimeState/config/providerManager from the ADOPTED context,
23: #   the snapshot reflects the adopted runtime. No change required beyond ensuring fromConfig
24: #   adopts the Config BEFORE finalize seeds runtimeState (see seam steps 27).
```

---

## Integration Points (Line-by-Line)

```
Line 11: this.deps.runtimeId
         - For createAgent: runtimeId = parsed.sessionId ?? generateRuntimeId().
         - For fromConfig: runtimeId = options.sessionId ?? deriveFromConfig ?? generateRuntimeId().
         - MUST equal the runtimeId passed to createIsolatedRuntimeContext (REQ-005.1).
Line 20-24: direct provider/model method adoption
         - Reads are direct: getProvider()/getModel()/getProviderStatus() return this.providerState.*
           (agentImpl.ts:594/621/648), seeded from deps.runtimeState (agentImpl.ts:267-275). The
           switch pipeline (switchActiveProvider/setActiveModel) operates on this.deps.config +
           this.deps.providerManager and mutates providerState. Because fromConfig adopts the Config
           and derives runtimeState/providerManager from it, these are the adopted instances → no
           second ProviderManager (REQ-001.2, REQ-005.2). NOTE: there is NO getCliRuntimeServices()
           call in agentImpl (that helper lives in the CLI discovery surface, not here).
```

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: createHeadlessProviderManager() inside fromConfig   // builds divergent SettingsService (B6)
[OK]   DO:     adopt via createIsolatedRuntimeContext({ config, settingsService, messageBus })

[ERROR] DO NOT: expose getProviderManager(): ProviderManager at root // leaks engine internal
[OK]   DO:     expose read-only getRuntimeId() + keep the DIRECT provider/model methods + auth sub-surface

[ERROR] DO NOT: return '' for getRuntimeId()                          // stub left after impl
[OK]   DO:     return this.deps.runtimeId

[ERROR] DO NOT: construct a new ProviderManager in fromConfig         // REQ-001.2 violation
[OK]   DO:     adopt the one reachable from the supplied Config
```

---

## Verification Hooks (T6)

```
- Build agent via fromConfig({config}); assert agent.getRuntimeId() === the runtimeId used to
  build the runtime context.
- Assert agent.getProvider()/getModel() reflect the adopted Config's active provider.
- Assert no second ProviderManager constructed: spy/instrument createProviderManager (real, at
  the providers seam) shows the agent reused the adopted manager (count unchanged after build).
```
