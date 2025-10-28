# AgentRuntimeState Interface Definition & Pseudocode

**Phase ID**: `PLAN-20251027-STATELESS5.P02`
**Analysis Date**: 2025-10-28

## Purpose

Define the complete `AgentRuntimeState` API including constructors, getters, immutable update methods, event emission, and invariants. This pseudocode serves as the blueprint for TDD implementation in Phase 04.

---

## Field Contract & Invariants

### Core Fields (Derived from Design Questions Q1, Q2)

**@requirement:REQ-STAT5-001.1** - Runtime state must validate provider/model/auth inputs

```typescript
interface AgentRuntimeState {
  // Immutable identity
  readonly runtimeId: string;          // Unique identifier for this runtime instance

  // Provider/model state (migrated from Config)
  readonly provider: string;           // Provider key (e.g., "gemini", "anthropic")
  readonly model: string;              // Model ID (e.g., "gemini-2.0-flash")
  readonly authType: AuthType;         // Auth mechanism (OAUTH, API_KEY, etc.)
  readonly authPayload?: AuthPayload;  // Optional auth credentials

  // Connection settings
  readonly baseUrl?: string;           // Custom provider base URL
  readonly proxyUrl?: string;          // HTTP proxy configuration

  // Model parameters (Phase 5 scope - minimal for now)
  readonly modelParams?: {
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    [key: string]: unknown;
  };

  // Session metadata
  readonly sessionId: string;          // Session identifier for telemetry
  readonly updatedAt: number;          // Unix timestamp of last update

  // Ephemeral settings (Phase 6 migration target)
  // For Phase 5, these remain passthrough to Config
  // readonly ephemeralSettings?: Map<string, unknown>;
}
```

### Invariants

**@requirement:REQ-STAT5-001.2** - State updates must be immutable and emit events

1. **Provider Validity**: `provider` must be non-empty string matching `ProviderManager.getProviderNames()`
2. **Model Validity**: `model` must be non-empty string
3. **Auth Consistency**: If `authType` is `API_KEY`, `authPayload` must contain `apiKey` field
4. **Immutability**: All fields are `readonly`; updates create new instances
5. **Update Atomicity**: Multi-field updates (e.g., provider switch) must be atomic
6. **Event Ordering**: Change events emit synchronously before method returns
7. **Snapshot Consistency**: `getSnapshot()` must return frozen object

**Validation Reference**: See Risk Register RISK-001 (mutation chains)

---

## Constructor Pseudocode

**@requirement:REQ-STAT5-001.1** - Runtime state construction validates inputs

### Step 1: Primary Constructor

```pseudocode
1. function createAgentRuntimeState(params: RuntimeStateParams): AgentRuntimeState
2.   validate params.runtimeId is non-empty string
3.     if invalid → throw RuntimeStateError('runtimeId.missing')
4.   validate params.provider is non-empty string
5.     if invalid → throw RuntimeStateError('provider.missing')
6.   validate params.model is non-empty string
7.     if invalid → throw RuntimeStateError('model.missing')
8.   validate params.authType is valid AuthType enum value
9.     if invalid → throw RuntimeStateError('authType.invalid')
10.  if params.authType === AuthType.API_KEY:
11.    validate params.authPayload?.apiKey exists
12.      if invalid → throw RuntimeStateError('auth.apiKey.missing')
13.  if params.authType === AuthType.OAUTH:
14.    validate params.authPayload?.token exists
15.      if invalid → throw RuntimeStateError('auth.token.missing')
16.  if params.baseUrl provided:
17.    validate baseUrl is valid URL format
18.      if invalid → throw RuntimeStateError('baseUrl.invalid')
19.  create frozen state object:
20.    runtimeId ← params.runtimeId
21.    provider ← params.provider
22.    model ← params.model
23.    authType ← params.authType
24.    authPayload ← deepFreeze(params.authPayload)
25.    baseUrl ← params.baseUrl
26.    proxyUrl ← params.proxyUrl
27.    modelParams ← deepFreeze(params.modelParams || {})
28.    sessionId ← params.sessionId || generateSessionId()
29.    updatedAt ← Date.now()
30.  register state in global registry keyed by runtimeId
31.  return frozen state
```

**Cross-reference**: Design Questions Q1 (Option B - Comprehensive Replacement)

### Step 2: From Config Migration Helper

**@requirement:REQ-STAT5-002.3** - Legacy Config mirrors update only for diagnostics

```pseudocode
1. function createAgentRuntimeStateFromConfig(config: Config, runtimeId: string): AgentRuntimeState
2.   extract provider ← config.getProvider()
3.   extract model ← config.getModel()
4.   extract authType ← config.getAuthType()
5.   extract sessionId ← config.getSessionId()
6.   extract baseUrl ← config.getEphemeralSetting('base-url')
7.   extract proxyUrl ← config.getProxy()
8.   build authPayload:
9.     if authType === AuthType.API_KEY:
10.      authPayload ← { apiKey: config.getApiKey() }
11.    if authType === AuthType.OAUTH:
12.      authPayload ← { token: config.getOAuthToken() }
13.  call createAgentRuntimeState({
14.    runtimeId,
15.    provider,
16.    model,
17.    authType,
18.    authPayload,
19.    baseUrl,
20.    proxyUrl,
21.    sessionId
22.  })
23.  return state
```

**Migration Note**: This helper is temporary for Phase 5 bootstrap. Phase 6 removes Config dependency.

---

## Read Operations

**@requirement:REQ-STAT5-003.1** - GeminiClient reads provider/model/auth exclusively from runtime state

### Step 3: Synchronous Accessors

```pseudocode
1. function getProvider(state: AgentRuntimeState): string
2.   return state.provider
3.   // Performance: <1ms (in-memory field access)
4.   // Reference: Risk Register RISK-003 (History Service model tracking)

5. function getModel(state: AgentRuntimeState): string
6.   return state.model

7. function getAuthType(state: AgentRuntimeState): AuthType
8.   return state.authType

9. function getAuthPayload(state: AgentRuntimeState): Readonly<AuthPayload>
10.  return Object.freeze({ ...state.authPayload })
11.  // Return frozen clone to prevent mutation

12. function getBaseUrl(state: AgentRuntimeState): string | undefined
13.  return state.baseUrl

14. function getSessionId(state: AgentRuntimeState): string
15.  return state.sessionId

16. function getModelParams(state: AgentRuntimeState): Readonly<ModelParams>
17.  return Object.freeze({ ...state.modelParams })
```

### Step 4: Ephemeral Settings Passthrough (Phase 5)

**@requirement:REQ-STAT5-002.1** - Ephemeral settings must remain accessible during migration

```pseudocode
1. function getEphemeralSetting(state: AgentRuntimeState, key: string): unknown
2.   // Phase 5: Delegate to legacy Config
3.   legacyConfig ← getConfigForRuntimeId(state.runtimeId)
4.   if legacyConfig exists:
5.     return legacyConfig.getEphemeralSetting(key)
6.   else:
7.     return undefined
8.   // Phase 6: Replace with state.ephemeralSettings.get(key)

9. function getAllEphemeralSettings(state: AgentRuntimeState): Record<string, unknown>
10.  // Phase 5: Delegate to legacy Config
11.  legacyConfig ← getConfigForRuntimeId(state.runtimeId)
12.  if legacyConfig exists:
13.    return legacyConfig.getAllEphemeralSettings()
14.  else:
15.    return {}
```

**Cross-reference**: Design Questions Q3 (Option A for Phase 5)

---

## Immutable Updates

**@requirement:REQ-STAT5-001.2** - State updates must be immutable and emit synchronous change events

### Step 5: Single Field Update

```pseudocode
1. function updateRuntimeState(
2.   oldState: AgentRuntimeState,
3.   updates: Partial<RuntimeStateParams>
4. ): AgentRuntimeState
5.   validate update keys are allowed fields:
6.     allowed ← ['provider', 'model', 'authType', 'authPayload', 'baseUrl', 'proxyUrl', 'modelParams']
7.     for each key in updates:
8.       if key not in allowed:
9.         throw RuntimeStateError('update.unsupported', { key })
10.  validate updated fields maintain invariants:
11.    if updates.provider provided:
12.      validate non-empty string → else throw RuntimeStateError('provider.invalid')
13.    if updates.model provided:
14.      validate non-empty string → else throw RuntimeStateError('model.invalid')
15.    if updates.authType provided:
16.      validate matches AuthType enum → else throw RuntimeStateError('authType.invalid')
17.  create new state:
18.    newState ← { ...oldState, ...updates, updatedAt: Date.now() }
19.  freeze newState
20.  register newState in global registry (replaces old state)
21.  compute changeset:
22.    changes ← {}
23.    for each key in updates:
24.      if oldState[key] !== newState[key]:
25.        changes[key] ← { old: oldState[key], new: newState[key] }
26.  emit RuntimeStateChanged event:
27.    payload ← {
28.      runtimeId: newState.runtimeId,
29.      changes,
30.      snapshot: getSnapshot(newState),
31.      timestamp: newState.updatedAt
32.    }
33.    invokeSubscribers(newState.runtimeId, payload)  // Synchronous
34.  return newState
```

**Cross-reference**: Design Questions Q6 (Option A - EventEmitter pattern)

### Step 6: Batch Update (Atomic Provider Switch)

**@requirement:REQ-STAT5-002.3** - Multi-step operations must be atomic

```pseudocode
1. function updateRuntimeStateBatch(
2.   oldState: AgentRuntimeState,
3.   updates: BatchRuntimeStateUpdate
4. ): AgentRuntimeState
5.   // Example: Provider switch updates provider, model, auth, baseUrl atomically
6.   validate all update keys at once (same as Step 5)
7.   if validation fails:
8.     throw without mutating state (rollback semantics)
9.   create new state with all updates:
10.    newState ← { ...oldState, ...updates, updatedAt: Date.now() }
11.  freeze newState
12.  register newState in global registry
13.  compute changeset (includes all changed fields)
14.  emit single RuntimeStateChanged event with multi-field changes
15.  return newState
16.
17. // Usage example for provider switch:
18. newState ← updateRuntimeStateBatch(oldState, {
19.   provider: 'anthropic',
20.   model: 'claude-3-5-sonnet-20241022',
21.   authType: AuthType.OAUTH,
22.   authPayload: { token: 'new-token' },
23.   baseUrl: 'https://api.anthropic.com'
24. })
```

**Risk Mitigation**: Addresses Risk Register RISK-001 (mutation chains)

---

## Event Subscription

**@requirement:REQ-STAT5-003.2** - GeminiClient subscribes to runtime state changes for telemetry

### Step 7: Subscription API

```pseudocode
1. function subscribeToAgentRuntimeState(
2.   runtimeId: string,
3.   callback: (event: RuntimeStateChangedEvent) => void,
4.   options?: { async: boolean }
5. ): UnsubscribeFunction
6.   validate runtimeId is non-empty string
7.   validate callback is function
8.   get or create subscriber list for runtimeId
9.   generate unique subscriptionId
10.  store subscription:
11.    subscriptions[runtimeId][subscriptionId] ← {
12.      callback,
13.      async: options?.async || false
14.    }
15.  return unsubscribe function:
16.    return () => {
17.      delete subscriptions[runtimeId][subscriptionId]
18.    }

19. function invokeSubscribers(runtimeId: string, event: RuntimeStateChangedEvent): void
20.  get subscriber list for runtimeId
21.  for each subscription in list:
22.    if subscription.async === true:
23.      queueMicrotask(() => subscription.callback(event))
24.    else:
25.      subscription.callback(event)  // Synchronous by default
26.  // Note: Error handling wraps each callback to prevent cascade failures
```

**Design Decision**: Default synchronous emission for predictable timing (Design Questions Q6)

---

## Snapshot Export

**@requirement:REQ-STAT5-001.3** - Diagnostics snapshot includes provider/model/auth/baseUrl metadata

### Step 8: Serializable Snapshot

```pseudocode
1. function getAgentRuntimeStateSnapshot(state: AgentRuntimeState): RuntimeStateSnapshot
2.   return Object.freeze({
3.     runtimeId: state.runtimeId,
4.     provider: state.provider,
5.     model: state.model,
6.     authType: state.authType,
7.     authPayload: sanitizeAuthPayload(state.authPayload),  // Redact sensitive fields
8.     baseUrl: state.baseUrl,
9.     proxyUrl: state.proxyUrl,
10.    modelParams: { ...state.modelParams },
11.    sessionId: state.sessionId,
12.    updatedAt: state.updatedAt,
13.    version: 1  // Schema version for future migrations
14.  })

15. function sanitizeAuthPayload(payload?: AuthPayload): SanitizedAuthPayload
16.  if not payload:
17.    return undefined
18.  result ← { type: payload.type }
19.  if payload.apiKey:
20.    result.apiKey ← maskSecret(payload.apiKey)  // Show only last 4 chars
21.  if payload.token:
22.    result.token ← '[REDACTED]'
23.  return result
```

**Usage**: Diagnostics UI calls this for display; telemetry uses for context

---

## Validation & Error Handling

**@requirement:REQ-STAT5-001.1** - Validation must provide clear error messages

### Step 9: Error Types

```pseudocode
1. class RuntimeStateError extends Error {
2.   constructor(
3.     public code: string,
4.     public details?: Record<string, unknown>
5.   )
6.   // Error codes:
7.   // - 'runtimeId.missing'
8.   // - 'provider.missing' / 'provider.invalid'
9.   // - 'model.missing' / 'model.invalid'
10.  // - 'authType.invalid'
11.  // - 'auth.apiKey.missing'
12.  // - 'auth.token.missing'
13.  // - 'baseUrl.invalid'
14.  // - 'update.unsupported'
15. }
```

### Step 10: Field Validators

```pseudocode
1. function validateProvider(provider: string): void
2.   if typeof provider !== 'string' || provider.length === 0:
3.     throw RuntimeStateError('provider.invalid', { provider })
4.   // Optional: Check against ProviderManager.getProviderNames() in Phase 5
5.   // Phase 4 implementation may skip this for speed

6. function validateModel(model: string): void
7.   if typeof model !== 'string' || model.length === 0:
8.     throw RuntimeStateError('model.invalid', { model })

9. function validateAuthType(authType: AuthType): void
10.  validTypes ← Object.values(AuthType)
11.  if authType not in validTypes:
12.    throw RuntimeStateError('authType.invalid', { authType })

13. function validateBaseUrl(baseUrl: string): void
14.  try:
15.    new URL(baseUrl)  // Throws if invalid
16.  catch error:
17.    throw RuntimeStateError('baseUrl.invalid', { baseUrl, error })
```

---

## Diagnostics Helpers

**@requirement:REQ-STAT5-005.1** - Diagnostics commands source data from runtime state snapshots

### Step 11: Diagnostic Output

```pseudocode
1. function toDiagnostics(state: AgentRuntimeState): DiagnosticInfo
2.   return {
3.     runtimeId: state.runtimeId,
4.     provider: {
5.       name: state.provider,
6.       baseUrl: state.baseUrl || '[default]',
7.       authType: state.authType
8.     },
9.     model: {
10.      id: state.model,
11.      params: state.modelParams
12.    },
13.    session: {
14.      sessionId: state.sessionId,
15.      updatedAt: new Date(state.updatedAt).toISOString()
16.    }
17.  }

18. function getChangeLog(state: AgentRuntimeState): ChangeLogEntry[]
19.  // Optional: Track history of updates for debugging
20.  // Phase 5: Return empty array (not implemented)
21.  // Phase 6: Implement circular buffer of last N changes
22.  return []
```

---

## Integration with ProviderRuntimeContext

**@requirement:REQ-STAT5-001.2** - AgentRuntimeState must integrate without circular dependencies

### Step 12: Context Injection Pattern

```pseudocode
1. // ProviderRuntimeContext interface update (one-way dependency)
2. interface ProviderRuntimeContext {
3.   settingsService?: SettingsService;
4.   config?: Config;  // Phase 5: Keep for backward compat
5.   runtimeState?: AgentRuntimeState;  // Phase 5: Add new field
6.   runtimeId?: string;
7.   metadata?: Record<string, unknown>;
8. }
9.
10. // Factory function for creating context
11. function createProviderRuntimeContext(
12.   runtimeState: AgentRuntimeState,
13.   settingsService: SettingsService,
14.   legacyConfig?: Config  // Optional for Phase 5 compat
15. ): ProviderRuntimeContext
16.   return {
17.     runtimeState,
18.     runtimeId: runtimeState.runtimeId,
19.     settingsService,
20.     config: legacyConfig,  // Phase 6: Remove
21.     metadata: {}
22.   }
```

**Cross-reference**: Design Questions Q2 (Option A for Phase 5)

---

## History Service Interaction

**@requirement:REQ-STAT5-004.2** - HistoryService is injected per instance

### Step 13: Model Tracking Pattern

```pseudocode
1. // In GeminiChat.sendMessage():
2. function sendMessage(content: Content[], runtimeState: AgentRuntimeState, historyService: HistoryService): void
3.   currentModel ← getModel(runtimeState)  // <1ms synchronous accessor
4.   // ... send to provider ...
5.   historyService.add(ContentConverters.toIContent(content), currentModel)
6.   // Note: HistoryService NOT stored in runtime state
7.   // Satisfies requirement that history service is instance-level dependency
```

**Risk Mitigation**: Addresses Risk Register RISK-003 (History Service model tracking)

---

## Phase 5 Migration Path

**@requirement:REQ-STAT5-002.3** - Legacy Config mirrors update for diagnostics

### Step 14: Dual-Write Pattern (Temporary)

```pseudocode
1. function updateRuntimeStateWithConfigMirror(
2.   oldState: AgentRuntimeState,
3.   updates: Partial<RuntimeStateParams>,
4.   legacyConfig?: Config
5. ): AgentRuntimeState
6.   newState ← updateRuntimeState(oldState, updates)
7.   if legacyConfig provided:
8.     // Mirror updates to Config for UI components still reading it
9.     if updates.provider:
10.      legacyConfig.setProvider(updates.provider)
11.    if updates.model:
12.      legacyConfig.setModel(updates.model)
13.    if updates.authType:
14.      legacyConfig.setAuthType(updates.authType)
15.    if updates.baseUrl:
16.      legacyConfig.setEphemeralSetting('base-url', updates.baseUrl)
17.  return newState
18.
19. // Phase 6: Remove this function entirely
```

---

## TDD Scenarios (Reference for Phase 04)

**@requirement:REQ-STAT5-001.1** - Tests must assert validation behavior

### Scenario Coverage Checklist

1. ✓ **Constructor validation** (Step 1, lines 2-18)
   - Missing runtimeId → throws 'runtimeId.missing'
   - Missing provider → throws 'provider.missing'
   - Missing model → throws 'model.missing'
   - Invalid authType → throws 'authType.invalid'
   - API_KEY without apiKey → throws 'auth.apiKey.missing'

2. ✓ **Immutable updates** (Step 5, lines 17-34)
   - Update creates new instance
   - Old state unchanged
   - Event emitted with correct changeset

3. ✓ **Batch updates** (Step 6, lines 1-24)
   - Atomic multi-field update
   - Single event emission
   - Rollback on validation failure

4. ✓ **Event subscription** (Step 7, lines 1-26)
   - Synchronous callback by default
   - Async callback if opted-in
   - Unsubscribe removes callback

5. ✓ **Snapshot export** (Step 8, lines 1-23)
   - Auth payload sanitized
   - Frozen object returned
   - Schema version included

---

## Performance Benchmarks (Reference for Phase 05)

- `createAgentRuntimeState`: <1ms
- `getModel/getProvider/getAuthType`: <0.01ms (field access)
- `updateRuntimeState`: <2ms (includes event emission)
- `getAgentRuntimeStateSnapshot`: <1ms
- `invokeSubscribers` (10 subscribers): <5ms

---

## Open Questions for Phase 03 Implementation

1. Should `updateRuntimeState` support partial auth payload updates, or require full replacement?
2. Do we need rate-limiting on event emission for rapid updates?
3. Should frozen objects use `Object.freeze()` or deep-freeze library?

---

**@plan:PLAN-20251027-STATELESS5.P02**

## Cross-References
- **Design Questions**: Q1, Q2, Q3, Q6 (design-questions.md)
- **Risk Register**: RISK-001, RISK-003, RISK-007 (risk-register.md)
- **State Coupling**: All 89 Config touchpoints (state-coupling.md)
- **Next Phase**: Phase 03 (stub implementation), Phase 04 (TDD tests)
