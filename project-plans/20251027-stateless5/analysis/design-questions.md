# Design Questions: AgentRuntimeState Architecture

**Phase ID**: `PLAN-20251027-STATELESS5.P01`
**Analysis Date**: 2025-10-27

## Core Design Questions

### Q1: AgentRuntimeState Field Contract

**Question**: What fields should `AgentRuntimeState` expose for provider/model/auth access?

**Current Config API** (89 touchpoints identified):
```typescript
config.getModel(): string
config.getProvider(): string
config.getSessionId(): string
config.getUserMemory(): string
config.getContentGeneratorConfig(): ContentGeneratorConfig
config.getProviderManager(): ProviderManager
config.getSettingsService(): SettingsService
config.getEphemeralSetting(key: string): unknown
config.getToolRegistry(): ToolRegistry
```

**Option A - Minimal Mirror**:
```typescript
interface AgentRuntimeState {
  model: string;
  provider: string;
  authType: AuthType;
  sessionId: string;
  // Delegate everything else to Config
}
```
- ✅ Pro: Minimal breaking changes
- ❌ Con: Still depends on Config for ephemeral settings, tools, etc.

**Option B - Comprehensive Replacement**:
```typescript
interface AgentRuntimeState {
  model: string;
  provider: string;
  authType: AuthType;
  sessionId: string;
  userMemory: string;
  ephemeralSettings: Record<string, unknown>;
  providerManager: ProviderManager;
  settingsService: SettingsService;
  toolRegistry: ToolRegistry;
}
```
- ✅ Pro: Full stateless isolation
- ❌ Con: Massive API surface, breaks all 89 touchpoints

**Recommended**: **Option B with phased migration** - Start with Option A for Phase 5, migrate to Option B in Phase 6.

**@requirement:REQ-STAT5-001.1** - AgentRuntimeState must provide synchronous accessors for provider/model/auth

---

### Q2: Interaction with ProviderRuntimeContext

**Question**: How does `AgentRuntimeState` interact with existing `ProviderRuntimeContext`?

**Current Structure**:
```typescript
interface ProviderRuntimeContext {
  settingsService?: SettingsService;
  config?: Config;  // ← Contains provider/model/auth!
  runtimeId?: string;
  metadata?: Record<string, unknown>;
}
```

**Option A - AgentRuntimeState Wraps ProviderRuntimeContext**:
```typescript
interface AgentRuntimeState {
  runtimeContext: ProviderRuntimeContext;
  model: string;  // Cached from config.getModel()
  provider: string;  // Cached from config.getProvider()
}
```
- ✅ Pro: Minimal refactoring
- ❌ Con: Still tied to Config via runtimeContext.config

**Option B - AgentRuntimeState Replaces Config Field**:
```typescript
interface ProviderRuntimeContext {
  settingsService?: SettingsService;
  runtimeState?: AgentRuntimeState;  // ← Replaces config
  runtimeId?: string;
  metadata?: Record<string, unknown>;
}
```
- ✅ Pro: Clean separation
- ❌ Con: Breaks all code reading `context.config`

**Recommended**: **Option A for Phase 5**, deprecate `context.config` in favor of `context.config.getRuntimeState()`.

**@requirement:REQ-STAT5-001.2** - AgentRuntimeState must integrate with ProviderRuntimeContext without circular dependencies

---

### Q3: Ephemeral Settings Migration Strategy

**Question**: Who owns ephemeral settings (compression-threshold, context-limit, etc.)?

**Current Usage** (4 touchpoints in runtimeSettings.ts):
```typescript
config.getEphemeralSetting("compression-threshold")
config.setEphemeralSetting("context-limit", 100000)
```

**Option A - Keep in Config, Add Passthroughs**:
```typescript
class AgentRuntimeState {
  getEphemeralSetting(key: string): unknown {
    return this.config.getEphemeralSetting(key);  // Delegate
  }
}
```
- ✅ Pro: Zero migration cost
- ❌ Con: Config remains authoritative source

**Option B - Migrate to AgentRuntimeState**:
```typescript
class AgentRuntimeState {
  private ephemeralSettings: Map<string, unknown>;
  getEphemeralSetting(key: string): unknown {
    return this.ephemeralSettings.get(key);
  }
}
```
- ✅ Pro: True stateless design
- ❌ Con: Breaks 62 files calling `config.getEphemeralSetting()`

**Recommended**: **Option A for Phase 5** (passthrough), migrate to Option B in Phase 6.

**@requirement:REQ-STAT5-002.1** - Ephemeral settings must remain accessible via existing API during migration

---

### Q4: Slash Command Integration

**Question**: How do slash commands access `AgentRuntimeState` without breaking CommandContext contract?

**Current CommandContext**:
```typescript
interface CommandContext {
  services: {
    config: Config;  // ← Used by /set, /provider, /model
  };
  ui?: UIContext;
}
```

**Option A - Add Parallel runtimeState Field**:
```typescript
interface CommandContext {
  services: {
    config: Config;
    runtimeState: AgentRuntimeState;  // ← New field
  };
}
```
- ✅ Pro: Backward compatible
- ❌ Con: Dual APIs, unclear which to use

**Option B - Replace config with getRuntimeState()**:
```typescript
interface CommandContext {
  services: {
    config: Config & { getRuntimeState(): AgentRuntimeState };
  };
}
```
- ✅ Pro: Single accessor
- ❌ Con: Requires Config interface changes

**Recommended**: **Option A for Phase 5** (add `runtimeState` field), deprecate `config` access in Phase 6.

**@requirement:REQ-STAT5-002.2** - Slash commands must access runtime state without breaking CommandContext contract

---

### Q5: GeminiChat Constructor Signature

**Question**: What happens to `GeminiChat` constructor signature?

**Current Signature** (47 test files affected):
```typescript
constructor(
  private readonly config: Config,
  contentGenerator: ContentGenerator,
  generationConfig: GenerateContentConfig,
  initialHistory: Content[],
  historyService?: HistoryService,
)
```

**Option A - Add runtimeState Parameter, Keep config**:
```typescript
constructor(
  private readonly config: Config,  // Deprecated, kept for compat
  private readonly runtimeState: AgentRuntimeState,  // New
  contentGenerator: ContentGenerator,
  ...
)
```
- ✅ Pro: Gradual migration
- ❌ Con: Confusing dual parameters

**Option B - Replace config with runtimeState**:
```typescript
constructor(
  private readonly runtimeState: AgentRuntimeState,
  contentGenerator: ContentGenerator,
  ...
)
```
- ✅ Pro: Clean API
- ❌ Con: Breaks all 47 test files immediately

**Recommended**: **Option A for Phase 5** (add parameter, deprecate config usage), migrate tests incrementally.

**@requirement:REQ-STAT5-004.1** - GeminiChat must operate without direct Config access

---

### Q6: Change Event Propagation

**Question**: How does UI track provider/model changes if state is immutable?

**Current Pattern**:
```typescript
config.setProvider("anthropic");  // Mutation
config.setModel("claude-3-5-sonnet");  // Mutation
// UI polls config.getProvider() / config.getModel()
```

**Option A - Mutable AgentRuntimeState with Events**:
```typescript
class AgentRuntimeState extends EventEmitter {
  setProvider(name: string): void {
    this.provider = name;
    this.emit('providerChanged', { provider: name });
  }
}
```
- ✅ Pro: UI can subscribe to changes
- ❌ Con: Not truly stateless

**Option B - Immutable Snapshots, Manual UI Updates**:
```typescript
interface AgentRuntimeState {
  readonly model: string;
  readonly provider: string;
  // No setters - create new instance
}
// UI calls setModel() → creates new AgentRuntimeState → UI re-renders
```
- ✅ Pro: True immutability
- ❌ Con: Requires UI refactor

**Recommended**: **Option A for Phase 5** (EventEmitter pattern), explore immutability in Phase 6.

**@requirement:REQ-STAT5-001.3** - AgentRuntimeState must emit synchronous change events for diagnostics

---

## Open Design Constraints

1. **ContentGenerator Coupling**: `createContentGenerator(contentGenConfig, config, sessionId)` expects Config. Requires coordination with ContentGenerator API changes.

2. **Telemetry Signature**: All telemetry functions (`logApiRequest`, `logApiResponse`, `logApiError`) pass Config as first parameter. Need telemetry adapter or interface extension.

3. **HistoryService Model Tracking**: `HistoryService.add(content, currentModel)` requires synchronous model accessor. AgentRuntimeState must provide `getModel(): string`.

4. **Provider Enforcement**: `GeminiChat.sendMessage()` enforces desired provider by reading `config.getProvider()`. Stateless design should eliminate enforcement, but migration path unclear.

---

**@plan:PLAN-20251027-STATELESS5.P01**
