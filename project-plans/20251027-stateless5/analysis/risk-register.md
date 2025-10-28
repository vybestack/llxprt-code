# Risk Register: Stateless Foreground Agent Phase 5

**Phase ID**: `PLAN-20251027-STATELESS5.P01`
**Analysis Date**: 2025-10-27

## Critical Risks

### RISK-001: Config Mutation Chains
**Severity**: HIGH  
**Probability**: CERTAIN  
**Impact**: Many operations mutate Config in multi-step sequences (e.g., provider switch clears 9 settings, sets provider, sets model, refreshes auth). Atomic vs. incremental migration unclear.

**Example**:
```typescript
// switchActiveProvider() sequence:
config.setEphemeralSetting("activeProvider", undefined);
config.setEphemeralSetting("base-url", undefined);
// ... 7 more clears
config.setProvider("anthropic");
config.setModel("claude-3-5-sonnet");
config.refreshAuth(AuthType.USE_PROVIDER);
```

**Mitigation**:
- Phase 02: Design transaction-like `AgentRuntimeState.updateBatch({ provider, model, ... })` API
- Phase 03: Implement atomic state transitions with rollback capability
- Phase 04: Add integration tests for multi-step operations

**Owner**: Phase 02 (Pseudocode Design)

**@requirement:REQ-STAT5-002.3** - CLI helpers must delegate multi-step operations atomically

---

### RISK-002: Telemetry Coupling
**Severity**: MEDIUM  
**Probability**: HIGH  
**Impact**: All telemetry operations (`logApiRequest`, `logApiResponse`, `logApiError`) pass `Config` as first parameter. Breaking change if `AgentRuntimeState` doesn't implement same interface.

**Current Signature**:
```typescript
function logApiRequest(config: Config, event: ApiRequestEvent): void {
  const model = config.getModel();
  const sessionId = config.getSessionId();
  // ...
}
```

**Mitigation**:
- Phase 02: Define `TelemetryContext` interface with `getModel()`, `getSessionId()`, etc.
- Phase 03: Make both `Config` and `AgentRuntimeState` implement `TelemetryContext`
- Phase 04: Update telemetry signature to `logApiRequest(context: TelemetryContext, ...)`

**Owner**: Phase 03 (AgentRuntimeState Implementation)

---

### RISK-003: History Service Model Tracking
**Severity**: HIGH  
**Probability**: CERTAIN  
**Impact**: `HistoryService.add(content, currentModel)` expects model from `config.getModel()`. If `AgentRuntimeState` doesn't provide synchronous model accessor, breaks history tracking.

**Critical Path**:
```typescript
const currentModel = this.config.getModel();  // 8 occurrences in geminiChat.ts
this.historyService.add(ContentConverters.toIContent(content), currentModel);
```

**Mitigation**:
- Phase 02: Ensure `AgentRuntimeState` interface includes `getModel(): string` (synchronous)
- Phase 03: Validate model accessor performance (must be < 1ms)
- Phase 04: Add regression tests for history model tracking

**Owner**: Phase 02 (Pseudocode Design)

**@requirement:REQ-STAT5-001.1** - AgentRuntimeState must provide synchronous accessors

---

### RISK-004: ContentGenerator Initialization
**Severity**: HIGH  
**Probability**: CERTAIN  
**Impact**: `createContentGenerator(contentGenConfig, config, sessionId)` expects Config as second parameter. Migration requires coordinating with `ContentGenerator` API changes.

**Current Call Site** (client.ts:202):
```typescript
this.contentGenerator = await createContentGenerator(
  contentGenConfig,
  this.config,          // ← Config dependency
  this.config.getSessionId(),
);
```

**Mitigation**:
- Phase 02: Design `createContentGenerator` overload: `(contentGenConfig, runtimeState, sessionId)`
- Phase 03: Implement adapter: `createContentGenerator` accepts `Config | AgentRuntimeState`
- Phase 04: Migrate GeminiClient to use new signature
- Phase 05: Deprecate old signature

**Owner**: Phase 03 (AgentRuntimeState Implementation)

---

### RISK-005: Provider Enforcement Logic
**Severity**: MEDIUM  
**Probability**: HIGH  
**Impact**: `GeminiChat.sendMessage()` enforces desired provider by reading `config.getProvider()` and calling `providerManager.setActiveProvider()`. Stateless design should eliminate this enforcement pattern, but unclear how.

**Current Code** (geminiChat.ts:523-548):
```typescript
const providerManager = this.config.getProviderManager?.();
const desiredProviderName = this.config.getProvider();
if (providerManager && desiredProviderName && provider.name !== desiredProviderName) {
  const previousProviderName = provider.name;
  try {
    providerManager.setActiveProvider(desiredProviderName);
    provider = providerManager.getActiveProvider();
  } catch (error) {
    this.logger.error(`Failed to enforce provider '${desiredProviderName}': ${error}`);
  }
}
```

**Mitigation**:
- Phase 02: Clarify whether AgentRuntimeState should enforce provider consistency or assume pre-validated state
- Phase 03: If enforcement needed, move logic to `AgentRuntimeState.getProvider()` accessor
- Phase 04: If no enforcement, document assumption that caller ensures provider consistency

**Owner**: Phase 02 (Pseudocode Design)

**@requirement:REQ-STAT5-004.2** - GeminiChat must not mutate provider state during message operations

---

### RISK-006: Test Churn Estimation
**Severity**: MEDIUM  
**Probability**: CERTAIN  
**Impact**: 40-60% of test suite requires updates to mock/inject `AgentRuntimeState`.

**Affected Files**:
- 62 files calling `config.get*` methods
- 24 files calling `config.set*` methods
- ~150 test files constructing `Config` instances
- 47 test files constructing `GeminiChat` with Config

**Mitigation**:
- Phase 02: Create test helpers: `createTestRuntimeState()`, `mockRuntimeState()`
- Phase 03: Implement backward-compat mode where `Config.getRuntimeState()` returns AgentRuntimeState
- Phase 04: Migrate high-value tests first (integration > unit)
- Phase 05: Parallel test runs to validate both old and new APIs

**Owner**: Phase 04 (TDD Test Writing)

---

### RISK-007: Circular Dependency: AgentRuntimeState ↔ ProviderRuntimeContext
**Severity**: HIGH  
**Probability**: MEDIUM  
**Impact**: If `AgentRuntimeState` wraps `ProviderRuntimeContext`, and `ProviderRuntimeContext` contains `config` field, creates circular dependency.

**Current Structure**:
```typescript
interface ProviderRuntimeContext {
  config?: Config;  // ← Contains provider/model/auth
}

// Proposed:
interface AgentRuntimeState {
  runtimeContext: ProviderRuntimeContext;  // ← Circular if ProviderRuntimeContext.config.getRuntimeState() → AgentRuntimeState
}
```

**Mitigation**:
- Phase 02: Design one-way dependency: `AgentRuntimeState` does NOT reference `ProviderRuntimeContext`
- Phase 03: Instead, `ProviderRuntimeContext` optionally contains `runtimeState?: AgentRuntimeState`
- Phase 04: Deprecate `ProviderRuntimeContext.config` in favor of `ProviderRuntimeContext.runtimeState`

**Owner**: Phase 02 (Pseudocode Design)

**@requirement:REQ-STAT5-001.2** - AgentRuntimeState must integrate without circular dependencies

---

### RISK-008: Ephemeral Settings Fragmentation
**Severity**: LOW  
**Probability**: MEDIUM  
**Impact**: If ephemeral settings remain in Config while provider/model move to AgentRuntimeState, creates split brain scenario.

**Mitigation**:
- Phase 02: Document ephemeral settings ownership (Config vs. AgentRuntimeState)
- Phase 03: Implement passthrough: `AgentRuntimeState.getEphemeralSetting(key)` delegates to Config
- Phase 05: Migrate ephemeral settings to AgentRuntimeState in Phase 6

**Owner**: Phase 02 (Pseudocode Design)

---

### RISK-009: Change Event Propagation to UI
**Severity**: MEDIUM  
**Probability**: HIGH  
**Impact**: If AgentRuntimeState is immutable, UI cannot detect provider/model changes without polling.

**Mitigation**:
- Phase 02: Design event system: `AgentRuntimeState extends EventEmitter`
- Phase 03: Emit `providerChanged`, `modelChanged`, `authChanged` events
- Phase 04: Update UI components to subscribe to events
- Phase 05: Document event lifecycle in integration guide

**Owner**: Phase 03 (AgentRuntimeState Implementation)

**@requirement:REQ-STAT5-005.1** - Diagnostics commands must source data from runtime state snapshots

---

## Medium Risks

### RISK-010: Slash Command Context Extension
**Severity**: LOW  
**Probability**: HIGH  
**Impact**: Adding `context.services.runtimeState` creates parallel APIs alongside `context.services.config`.

**Mitigation**:
- Phase 02: Decide on single accessor pattern (`config.getRuntimeState()` vs. parallel `runtimeState` field)
- Phase 04: Update slash command documentation to prefer new accessor
- Phase 05: Deprecation warnings for old accessor

**Owner**: Phase 04 (TDD Test Writing)

---

### RISK-011: GeminiChat Constructor Breakage
**Severity**: HIGH  
**Probability**: CERTAIN  
**Impact**: Changing constructor from `(config, ...)` to `(runtimeState, ...)` breaks 47 test files.

**Mitigation**:
- Phase 02: Design constructor overload pattern or optional parameter
- Phase 04: Create migration guide for test updates
- Phase 05: Automated codemod for constructor signature changes

**Owner**: Phase 05 (Implementation)

---

## Low Risks

### RISK-012: DebugLogger Config Coupling
**Severity**: LOW  
**Probability**: LOW  
**Impact**: Some DebugLogger instances may read from Config for context.

**Mitigation**:
- Phase 01a: Grep for `new DebugLogger` to identify Config dependencies
- Phase 04: Ensure logger context reads from AgentRuntimeState

**Owner**: Phase 01a (Verification)

---

**@plan:PLAN-20251027-STATELESS5.P01**
**Total Risks**: 12 (3 Critical, 6 High, 2 Medium, 1 Low)
