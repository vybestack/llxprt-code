<!-- @plan:PLAN-20260621-COREAPIREMED.P02 @requirement:REQ-002,REQ-INT-003 -->
# Pseudocode: Agent Settings / Config Projection

Component target: `packages/agents/src/api/agent.ts` (MODIFY interface) +
`packages/agents/src/api/agentImpl.ts` (MODIFY impl).
Requirements: REQ-002, REQ-002.1/.2/.3, REQ-INT-003.

---

## Interface Contracts

```typescript
// CRIT-2: `getConfig()` is SHARED by C1 (identity of the ADOPTED Config) and C2 (settings
// projection). It is DECLARED on the Agent interface (agent.ts) WITH THE fromConfig SEAM in P06 as a
// NotYetImplemented stub (so the early parity slice P07/EP1 + fromConfig TDD P08/T1 can COMPILE and
// reference identity, RED for a behavioral reason), then IMPLEMENTED for real
// (`return this.deps.config` in agentImpl.ts) at P09 (GREEN). The SETTINGS SURFACE (P10–P12) adds
// ONLY the three ephemeral methods and REFERENCES the already-present getConfig — it does NOT
// (re)declare or (re)implement it. The getConfig contract is shown here for completeness of the
// projection surface, but lines 10–12 are a PRECONDITION (declared P06, implemented P09), not a
// P10–P12 task.

// ADDED to the public Agent interface (agent.ts):
//   - by P06 (with the fromConfig seam): getConfig() DECLARED (impl at P09)
//   - by P10 (settings surface): the three ephemeral methods
interface AgentSettingsSurface {
  getConfig(): Config;                                          // identity accessor — declared P06, implemented P09 (CRIT-2)
  getEphemeralSetting(key: string): unknown;                    // delegate read — P10
  setEphemeralSetting(key: string, value: unknown): void;       // delegate write — P10
  getEphemeralSettings(): Readonly<Record<string, unknown>>;    // delegate full map — P10
}

// DEPENDENCIES (NEVER stubbed):
interface Dependencies {
  config: Config;   // the bound Config (constructed OR adopted) — single source of truth
}
```

The bound `Config` is `this.deps.config` in `agentImpl.ts` (already threaded — used by
`setModel` at agentImpl.ts:662 `this.deps.config.initializeContentGeneratorConfig()`).

Reference behavior in `Config` (configBase.ts):
- `getEphemeralSetting(key)` (L173) — normalizes `streaming`, `context-limit` on read.
- `setEphemeralSetting(key, value)` (L191) — normalizes; throws if `streaming` not string;
  propagates `task-max-async` to AsyncTaskManager; clears provider caches for
  `auth-key`/`auth-keyfile`/`base-url`/`socket-*`/`streaming`.
- `getEphemeralSettings()` (L265) — returns full map.

---

## Numbered Pseudocode

```
# Lines 10–12: PRECONDITION declared in P06 with the fromConfig seam (interface member + NotYetImplemented
# stub) and IMPLEMENTED at P09 (CRIT-2), NOT a P10–P12 task. Shown here because getConfig is part of the
# projection surface; P10–P12 reference it, never re-add it.
10: METHOD getConfig() -> Config
11:   RETURN this.deps.config                       # identity; REQ-002.2 (declared P06, impl lives in P09)
12: END METHOD

20: METHOD getEphemeralSetting(key: string) -> unknown
21:   RETURN this.deps.config.getEphemeralSetting(key)   # delegate; normalization done by Config
22: END METHOD

30: METHOD setEphemeralSetting(key: string, value: unknown) -> void
31:   this.deps.config.setEphemeralSetting(key, value)   # delegate; Config normalizes + side effects
32:   # NO local cache; NO swallow of errors (e.g. streaming non-string throws and propagates)
33: END METHOD

40: METHOD getEphemeralSettings() -> Readonly<Record<string, unknown>>
41:   RETURN this.deps.config.getEphemeralSettings()     # delegate; REQ-002.1
42: END METHOD
```

---

## Integration Points (Line-by-Line)

```
Line 11: RETURN this.deps.config
         - MUST be the exact bound instance (===), not a clone. Enables CLI to pass the same
           Config the agent uses to any residual core API during #1595 migration.
Line 21: config.getEphemeralSetting(key)
         - Normalization (streaming/context-limit) is Config's responsibility; the agent must
           NOT re-normalize (would double-apply).
Line 31: config.setEphemeralSetting(key, value)
         - Side effects (cache clear, AsyncTaskManager propagation) happen in Config and MUST
           NOT be duplicated here.
         - Errors (streaming non-string) propagate; do NOT catch.
Line 41: config.getEphemeralSettings()
         - Returns the full normalized map identical to the CLI's current direct call.
```

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: this.ephemeral = new Map()           // parallel settings store
[OK]   DO:     delegate every call to this.deps.config

[ERROR] DO NOT: if (key === 'streaming') normalize(value)  // re-normalize in the agent
[OK]   DO:     pass through to config.setEphemeralSetting (Config normalizes)

[ERROR] DO NOT: try { config.set... } catch { /* ignore */ }  // swallow Config errors
[OK]   DO:     let errors propagate (REQ-002 delegation semantics)

[ERROR] DO NOT: return structuredClone(this.deps.config)      // getConfig must be identity
[OK]   DO:     return this.deps.config

[ERROR] DO NOT: return {} as Config                            // stub return left after impl
[OK]   DO:     return this.deps.config
```
