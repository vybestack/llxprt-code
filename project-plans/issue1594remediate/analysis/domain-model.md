<!-- @plan:PLAN-20260621-COREAPIREMED.P01 @requirement:REQ-001..REQ-007,REQ-INT-001..REQ-INT-004 -->
# Domain Model: Core Public Agent API Remediation

Plan ID: PLAN-20260621-COREAPIREMED
Source: `project-plans/issue1594remediate/specification.md`; verified post-merge source.
Scope: analysis only — NO implementation code.

---

## 1. Entities

### 1.1 `Agent` (existing aggregate root — the public facade, EXTENDED here)
Shipped by #1594. Delegates to `AgenticLoop`, providers runtime, `Config`, `MessageBus`,
scheduler. THIS plan ADDS to its public surface:
- **Settings projection** (`getEphemeralSetting`/`setEphemeralSetting`/`getEphemeralSettings`)
  — thin delegation to the bound `Config` (REQ-002).
- **Config accessor** (`getConfig(): Config`) — identity accessor to the bound `Config`
  (REQ-002.2). SHARED by C1 (identity of the ADOPTED Config) and C2 (settings projection);
  DECLARED on the `Agent` interface WITH the fromConfig seam in P06 as a NotYetImplemented stub (so
  the early parity slice P07/EP1 + fromConfig TDD P08/T1 can COMPILE and reference identity, RED for
  a behavioral reason), then IMPLEMENTED (GREEN) by P09. The settings surface (P10–P12) adds ONLY the
  ephemeral methods and REFERENCES this existing accessor.
- **Real `getCurrentSequenceModel(): string | null`** — delegates to the bound client
  (REQ-003).
- **`getRuntimeId(): string`** — read-only runtime id (REQ-005.1).

**Invariant (unchanged from #1594):** the facade never caches a live `AgentClient`; it resolves
`config.getAgentClient()` (via the `resolveClient()` closure) whenever it needs one. The new
`getCurrentSequenceModel` MUST therefore call `resolveClient()` each time, not a cached client.

### 1.2 `Config` (existing core value object/service — adopted, not redefined)
Single source of truth for settings/history/auth/provider wiring. Already constructed by both
`createAgent` (internally) and the CLI (`loadCliConfig`). THIS plan introduces a path
(`fromConfig`) where an EXTERNAL `Config` is **adopted** rather than constructed. The settings
surface delegates here (`configBase.ts:173/191/265`).

**Ownership distinction (REQ-001.3):**
- Config CONSTRUCTED by `createAgent` → Agent-owned → disposed on `dispose()` (unchanged #1594).
- Config SUPPLIED to `fromConfig` → caller-owned → NOT disposed by `dispose()`.

### 1.3 `FromConfigOptions` (NEW value object — config-injection input)
`{ config, messageBus?, onApproval?, onOAuthPrompt?, editorCallbacks?, toolSchedulerFactory?, sessionId? }`.
The `config` field is the adopted `Config`. `messageBus?` is the caller-supplied SHARED
`MessageBus` (CRIT-2), adopted via the existing `IsolatedRuntimeContextOptions.messageBus?` seam
(specification.md:473-477, 515); when omitted, `fromConfig` builds exactly ONE bus from
`config.getPolicyEngine()` (Config has no `getMessageBus()` accessor — see §2). Callback fields
mirror `AgentConfig`'s host callbacks. NOT Zod-validated as a whole (functions + live Config are
not parseable); only the small `sessionId` portion is schema-validated for symmetry.

### 1.4 `AgentClientContract` (existing core-owned structural contract — PROMOTED here)
`packages/core/src/core/clientContract.ts:67`. Already the stable structural interface the
concrete `AgentClient` implements. Includes `getCurrentSequenceModel(): string | null` (line 118).
THIS plan PROMOTES the TYPE to the agents public root (REQ-004) while leaving the concrete
`AgentClient` class on `./internals.js` (REQ-004.1).

### 1.5 `IsolatedRuntimeContextHandle` / `IsolatedRuntimeContextOptions` (existing providers seam)
`packages/providers/src/runtime/runtimeContextFactory.ts`. Options ALREADY accept `config?`
(line 187) and `messageBus?` (line 199) — added by #1594. This is the seam `fromConfig` uses to
adopt an external Config under the shared runtime registry. `handle.activate()` registers the
context so the provider switch pipeline resolves THESE instances.

### 1.6 Engine collaborators (existing, referenced — not redefined)
`AgenticLoop`, `AgentClient`, `ProviderManager`, `OAuthManager`, `SettingsService`, `MessageBus`,
`HistoryService`, `CoreToolScheduler`, `FakeProvider`.

---

## 2. Relationships

```
createAgent(AgentConfig)  --(builds)-->  new Config(params)  --\
                                                                +--> finalizeAgent(...)  -->  Agent
fromConfig({config,...})  --(adopts)-->  external Config     --/        (SHARED path)

external Config --(reachable)--> SettingsService (getSettingsService()),
                                 ProviderManager (getProviderManager(), configBaseCore.ts:265)
   NOTE: MessageBus is NOT reachable off Config (NO getMessageBus() accessor — config.ts only
   CONSUMES a bus via initialize({messageBus?})@117 / getOrCreateScheduler({messageBus?})@715).
   The caller supplies the shared bus via FromConfigOptions.messageBus; if omitted, fromConfig
   builds exactly ONE bus from config.getPolicyEngine().
createIsolatedRuntimeContext({ config: externalConfig, settingsService,
   messageBus: <caller-supplied-or-single-config-policy-bus>,
   providerManager: config.getProviderManager(), runtimeId })
   --(adopt, NOT construct second)--> IsolatedRuntimeContextHandle --activate()--> registry

Agent.getEphemeralSetting(k)   --(delegates)--> Config.getEphemeralSetting(k)
Agent.setEphemeralSetting(k,v) --(delegates)--> Config.setEphemeralSetting(k,v)
Agent.getEphemeralSettings()   --(delegates)--> Config.getEphemeralSettings()
Agent.getConfig()              --(identity)-->  bound Config
Agent.getCurrentSequenceModel()--(delegates)--> resolveClient().getCurrentSequenceModel()
Agent.getRuntimeId()           --(reads)-->     bound runtimeId

public root (index.ts) --(type re-export)--> AgentClientContract     [from core]
./internals.js         --(class re-export)--> AgentClient            [unchanged]

CLI (#1595 target):
  loadCliConfig() -> Config -> fromConfig({config}) -> Agent
  CLI turn:  agent.stream(message)   ≡(parity)≡   new AgenticLoop({ agentClient, config, messageBus, interactiveMode, approvalHandler, displayCallbacks })  // object-form; useAgenticLoop.ts:254
  CLI setting:  agent.getEphemeralSetting(k)  ≡  config.getEphemeralSetting(k)
```

**Shared-finalize invariant:** `createAgent` and `fromConfig` MUST converge on the SAME
`finalizeAgent`/`assembleFacade` path (runtime state, post-auth client bind, loop build via
`rebuildLoop`, ownership record, SessionStart hook). The only divergence is construct-vs-adopt of
the Config/runtime-context up front.

---

## 3. State Transitions

### 3.1 Bootstrap via `fromConfig` (adopt path) — REQ-001
**Pre-conditions:** caller supplies an already-constructed, initialized-capable `Config`; runtime
deps available; `zod` present.

```
[start]
  -> options-validated (sessionId portion parsed; callbacks destructured off)
  -> config-adopted (bind to supplied Config; derive runtimeId = sessionId ?? config-derived id)
  -> runtime-context-adopted (createIsolatedRuntimeContext({config, settingsService:
       config.getSettingsService(), messageBus: <caller-supplied-or-single-config-policy-bus>,
       providerManager: config.getProviderManager(), runtimeId }))
  -> runtime-context-active (await handle.activate())
  -> [if not already initialized] initialized (await config.initialize({messageBus}))
  -> [if auth pending] authed (await config.refreshAuth(...))   // skipped if Config already authed
  -> SHARED finalize: runtime-state-created -> client-bound(post-auth) -> loop-constructed
       -> ownership-recorded (Config marked caller-owned) -> facade-built -> SessionStart fired
  -> [ready]
```
**Post-conditions:**
- `agent.getConfig() === suppliedConfig` (identity; REQ-001.2, REQ-002.2).
- No second `Config`/`SettingsService` constructed; no second `ProviderManager` when the adopted
  Config exposes one (via `Config.getProviderManager()`, configBaseCore.ts:265 — adopted through the
  providers `providerManager?` seam, P03–P05); a caller-supplied `MessageBus` is ADOPTED via the
  existing `IsolatedRuntimeContextOptions.messageBus?` seam; if the caller omits it, exactly ONE
  runtime `MessageBus` is constructed from the Config policy engine (REQ-001.2).
- `dispose()` does NOT dispose the supplied `Config` (nor a caller-supplied `MessageBus`/
  `ProviderManager`) (REQ-001.3).
- Behavior otherwise identical to `createAgent`'s finalize (REQ-001.1).

### 3.2 Settings read/write — REQ-002 / REQ-INT-003
**Pre-conditions:** `[ready]`.
```
setEphemeralSetting(k,v) -> config.setEphemeralSetting(k,v)
   (Config applies normalization: 'streaming' -> string|throw; 'context-limit' -> number;
    cache-clear for auth-key/auth-keyfile/base-url/socket-*/streaming; task-max-async -> AsyncTaskManager)
getEphemeralSetting(k)   -> config.getEphemeralSetting(k)  (normalized read)
getEphemeralSettings()   -> config.getEphemeralSettings()  (full normalized map)
```
**Post-conditions:** values + normalization side effects identical to direct `Config` use
(single source of truth). No parallel store mutated (REQ-002.3).

### 3.3 `getCurrentSequenceModel` — REQ-003
**Pre-conditions:** `[ready]`; a bound client exists.
```
getCurrentSequenceModel() -> client = resolveClient() -> return client.getCurrentSequenceModel()
   (client returns string for sticky LB model, or null when none)
```
**Post-conditions:** returns the client's real value; reflects the CURRENT bound client after a
switch/rebind (REQ-003.2); returns `null` only when the client returns `null` (REQ-003.1).

### 3.4 Client contract promotion — REQ-004 (no runtime transition; export topology)
Public root re-exports the `AgentClientContract` TYPE from core. `./internals.js` keeps the
concrete `AgentClient` class. No behavior change; pure surface addition.

### 3.5 Provider-runtime reachability — REQ-005
```
getRuntimeId() -> return bound runtimeId
agent.getProvider()/getModel() -> reflect adopted runtime (already shipped behavior)
```
**Post-conditions:** consumer can read provider/model/runtime without constructing a
`ProviderManager`; `fromConfig` adopted the runtime (no second manager) (REQ-005, REQ-INT-001).

---

## 4. Business Rules (Named Invariants)

1. **R-ADOPT (REQ-001/005):** `fromConfig` ADOPTS the supplied Config and its reachable
   SettingsService (`getSettingsService()`) and ProviderManager (`getProviderManager()`,
   configBaseCore.ts:265 — via the providers `providerManager?` seam, P03–P05); it never constructs
   a second `Config`/`SettingsService`, and never a second `ProviderManager` when the Config exposes
   one. The `MessageBus` is NOT reachable off Config (NO `getMessageBus()` accessor): a
   caller-supplied bus (`FromConfigOptions.messageBus`) is ADOPTED via the existing
   `IsolatedRuntimeContextOptions.messageBus?` seam; if omitted, exactly ONE bus is built from the
   Config policy engine. Testable: T1, T6.
2. **R-SHAREDFINALIZE (REQ-001.1):** `createAgent` and `fromConfig` share one finalize path; any
   change to finalize affects both identically. Testable: T1, T2 (createAgent characterization).
3. **R-CONFIGOWNER (REQ-001.3):** Supplied Config is caller-owned (not disposed); constructed
   Config is Agent-owned (disposed). Testable: T7.
4. **R-DELEGATE (REQ-002):** Settings surface delegates to the bound Config with identical
   normalization; no parallel store. Testable: T3, T8.
5. **R-IDENTITY (REQ-002.2):** `getConfig()` returns the exact bound Config instance. Testable: T3.
6. **R-SEQMODEL (REQ-003):** `getCurrentSequenceModel` returns the bound client's real value via
   `resolveClient()`; never an unconditional null; reflects current client after rebind.
   Testable: T4, T4b.
7. **R-CONTRACT (REQ-004):** `AgentClientContract` reachable at the public root; `AgentClient`
   class stays on `./internals.js`. Testable: T5.
8. **R-NONBREAK (REQ-006):** Additive only; no existing export removed/renamed; existing #1594
   tests pass; `createAgent` path unchanged. Testable: T2, T9, full #1594 suite.
9. **R-PARITY (REQ-INT-002):** `agent.stream()` drive ≡ reference `AgenticLoop` drive on the same
   FakeProvider script (equivalent projected events, exactly one terminal done). Testable: T10.
10. **R-NODEEP (REQ-INT-004):** Parity harness imports ONLY public root + documented subpaths.
    Testable: T11.

---

## 5. Edge Cases

### 5.1 `fromConfig` (REQ-001)
- **Config already initialized/authed** — `fromConfig` must NOT double-initialize or
  double-refresh; detect via `config.getAgentClient()` presence / initialized flag and skip.
- **Config supplies no MessageBus accessor** — derive a MessageBus from the Config's policy engine
  exactly as `createAgent` does today (one bus), still adopting the Config.
- **`sessionId` omitted** — derive a stable runtimeId from the Config (or generate), matching
  `createAgent`'s `sessionId ?? generateRuntimeId()` rule.
- **Caller passes a Config whose runtime context is already registered under a different
  runtimeId** — adopt that runtimeId; do not create a conflicting registration.

### 5.2 Settings surface (REQ-002)
- **`streaming` written as non-string** — Config throws (preserved); the agent surface does NOT
  swallow it (delegation propagates the throw).
- **`context-limit` written as numeric string** — normalized to number on read (Config behavior).
- **Unknown key** — stored/read verbatim (Config behavior); no agent-level rejection.

### 5.3 `getCurrentSequenceModel` (REQ-003)
- **No bound client yet** (pre-ready / mid-rebind) — guard: if `resolveClient()` is undefined,
  return `null` (matches contract's nullable return) rather than throwing.
- **Client returns null legitimately** — return `null`.

### 5.4 Client contract promotion (REQ-004)
- **Name collision at root** — ensure no existing root export named `AgentClientContract`
  (verified absent: `index.ts` has no `AgentClient*`); pure addition.

### 5.5 Non-breaking (REQ-006)
- **A consumer relied on the stubbed `getCurrentSequenceModel` returning null** — characterization
  scan: no current #1594 consumer asserts the null stub; behavior fix is safe (documented).

---

## 6. Error Scenarios

| Scenario | Expected behavior | Harness row |
|---|---|---|
| `fromConfig` given a Config that fails to expose a post-auth client after init/refresh | reject with a clear `AgentBootstrapError` (same as createAgent) | T1 |
| Settings `streaming` set to non-string | Config throws; agent surface propagates unchanged | T8 |
| `getCurrentSequenceModel` with no bound client | returns `null` (no throw) | T4b |
| Promoted contract import resolves to wrong shape | static/type test fails | T5 |
| Parity harness deep-imports core internals | boundary test fails | T11 |
| `dispose()` disposes a caller-supplied Config | ownership test fails (must NOT dispose) | T7 |

---

## 7. Requirement Coverage Map

| REQ | Entities | Transition | Invariant | Harness row(s) | Phases |
|---|---|---|---|---|---|
| REQ-001 | FromConfigOptions, Config, Agent, RuntimeContextHandle | §3.1 | R-ADOPT, R-SHAREDFINALIZE, R-CONFIGOWNER | T1, T6, T7 | P06/P08/P09 (early parity P07→P09) |
| REQ-002 | Agent, Config | §3.2 | R-DELEGATE, R-IDENTITY | T3, T8 | P10/P11/P12 |
| REQ-003 | Agent, AgentClientContract | §3.3 | R-SEQMODEL | T4, T4b | P13/P14 |
| REQ-004 | AgentClientContract, AgentClient | §3.4 | R-CONTRACT | T5 | P15/P16 |
| REQ-005 | Agent, RuntimeContextHandle, ProviderManager | §3.5 | R-ADOPT | T6 | P03/P04/P05, P09, P17/P18 |
| REQ-006 | createAgent, Agent, exports | (characterization) | R-NONBREAK | T2, T9 | P03/P05/P15/P21 (+ all impl) |
| REQ-007 | docs | n/a | n/a | (doc) | P22 |
| REQ-INT-001 | Config, Agent | §3.1 | R-ADOPT | T1 | P07/P09/P19 |
| REQ-INT-002 | Agent, AgenticLoop, FakeProvider | §3.1/parity | R-PARITY | T10 | P07/P09/P19/P20 |
| REQ-INT-003 | Agent, Config | §3.2 | R-DELEGATE | T8 | P11/P12/P19 |
| REQ-INT-004 | imports | n/a | R-NODEEP | T11 | P07/P19/P21 |

> **n/a rows are intentional.** REQ-007 (Documentation) and REQ-INT-004's transition are marked
> n/a because they are documentation / static-import-boundary requirements with no runtime entity
> state transition or invariant; no synthetic transition or invariant should be inferred.

---

## 8. Harness Row Cross-Reference (T1–T11)

| T-row | REQ(s) | Behavior | Layer |
|---|---|---|---|
| T1 | REQ-001, REQ-INT-001 | fromConfig adopts external Config; getConfig identity; turn streams | L4 integration |
| T2 | REQ-006 | createAgent characterization (signature/behavior pinned, unchanged) | L2 characterization |
| T3 | REQ-002 | getConfig identity + ephemeral get/set/getAll delegate | L3 behavior |
| T4 | REQ-003 | getCurrentSequenceModel returns client value | L3 behavior |
| T4b | REQ-003.1/.2 | null passthrough + reflects rebind | L3 behavior |
| T5 | REQ-004 | AgentClientContract at public root; class on internals | L1 static/type |
| T6 | REQ-005, REQ-001.2 | runtimeId + provider/model reachable; no second manager | L4 integration |
| T7 | REQ-001.3 | supplied Config NOT disposed; created Config disposed | L5 resource |
| T8 | REQ-002, REQ-INT-003 | normalization parity (streaming/context-limit) vs direct Config | L3 behavior |
| T9 | REQ-006.1 | all existing root + internals exports still present | L1 static |
| T10 | REQ-INT-002 | agent.stream() parity with reference AgenticLoop drive | L4 CLI-parity |
| T11 | REQ-INT-004 | parity harness imports only public root + subpaths | L1 boundary |
