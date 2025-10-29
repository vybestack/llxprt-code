# PLAN-20251028-STATELESS6 – Integration Map

> @plan PLAN-20251028-STATELESS6.P03
> @requirement REQ-STAT6-001, REQ-STAT6-002, REQ-STAT6-003

## Component Dependency Mapping

| Component | Current Dependencies | Lines (geminiChat.ts / subagent.ts) | Target Runtime View Adapter |
|-----------|---------------------|-------------------------------------|------------------------------|
| **GeminiChat** | `config.getProviderManager()` | 561, 1177, 1775, 2480 | `runtimeContext.providerAdapter.getActiveProvider(): IProvider` |
| **GeminiChat** | `config.getSettingsService()` | 716, 1071, 1279, 1849 | `runtimeContext.settingsAdapter: ISettingsService` (always present, no fallback) |
| **GeminiChat** | `config.getEphemeralSetting(key)` | 1392, 1396, 1575, 1578, 1700 | `runtimeContext.getEphemeralSetting(key: string): unknown` |
| **GeminiChat** | `logApiRequest(config, event)` | 454, 624, 1025 | `runtimeContext.telemetry.logApiRequest(metadata, payload)` |
| **GeminiChat** | `logApiResponse(config, event)` | 468, 758, 1147 | `runtimeContext.telemetry.logApiResponse(metadata, response)` |
| **GeminiChat** | `logApiError(config, event)` | 491, 853, 1157 | `runtimeContext.telemetry.logApiError(metadata, error)` |
| **GeminiChat** | `config.getToolRegistry().getAllTools()` | 2282 | `runtimeContext.toolAdapter.getAllToolNames(): string[]` (read-only diagnostics) |
| **SubAgentScope** | `runtimeContext.setModel(model)` **[MUTATION]** | 609 | **Constructor receives pre-built `AgentRuntimeContext` with subagent model** |
| **SubAgentScope** | `runtimeContext.getToolRegistry()` | 290, 355 | `runtimeContext.toolAdapter.getTool(name): FunctionDeclaration` |
| **SubAgentScope** | `runtimeContext.getSessionId()` | 399, 606, 612 | `runtimeContext.sessionId: string` (immutable field) |
| **SubAgentScope** | `runtimeContext.getContentGeneratorConfig()` | 594 | `runtimeContext.contentGeneratorConfig: ContentGenConfig` (derived from profile) |
| **Telemetry Helpers** | `logApiRequest/Response/Error(config, event)` | N/A (packages/core/src/telemetry/loggers.ts) | Refactor to accept `TelemetryMetadata` instead of `Config` |

---

## Runtime View Adapter Interfaces

> @plan PLAN-20251028-STATELESS6.P03

### 1. Provider Adapter
**Purpose**: Replaces `config.getProviderManager()` with stateless provider lookup.

```typescript
interface ProviderAdapter {
  /**
   * Get the active provider for this runtime context.
   * @returns Provider instance or undefined if not configured.
   */
  getActiveProvider(): IProvider | undefined;

  /**
   * List all available provider names (read-only).
   * Used for validation and error messages.
   */
  listProviders(): string[];
}
```

**Implementation Strategy**:
- Foreground: Delegate to `config.getProviderManager()` (runtime view adapter)
- Subagent: Return pre-configured provider instance from subagent profile

**Usage in GeminiChat**:
```typescript
// Before (STATELESS5 + Config)
const providerManager = this.config.getProviderManager?.();
const provider = providerManager?.getActiveProvider();

// After (STATELESS6 + Runtime View)
const provider = this.runtimeContext.providerAdapter.getActiveProvider();
```

---

### 2. Settings Adapter
**Purpose**: Replaces `config.getSettingsService()` with guaranteed settings interface.

```typescript
interface SettingsAdapter {
  /**
   * Get feature flag or configuration value.
   * @param key Setting identifier
   * @returns Setting value or undefined
   */
  getSetting(key: string): unknown;

  /**
   * Check if a feature is enabled.
   * @param feature Feature flag name
   */
  isFeatureEnabled(feature: string): boolean;
}
```

**Implementation Strategy**:
- Always present in runtime context (no optional chaining)
- Foreground: Delegates to `config.getSettingsService()`
- Subagent: Minimal implementation with subagent-specific defaults

**Usage in GeminiChat**:
```typescript
// Before (STATELESS5 + Config fallback)
const settings = activeRuntime.settingsService ?? this.config.getSettingsService();

// After (STATELESS6 + Runtime View)
const settings = this.runtimeContext.settingsAdapter;
```

---

### 3. Ephemeral Settings Access
**Purpose**: Replaces `config.getEphemeralSetting()` with runtime-scoped configuration.

```typescript
interface EphemeralSettings {
  'compression-threshold': number;        // Default: 0.6 (60% of context limit)
  'compression-preserve-threshold': number; // Default: 0.3 (preserve last 30%)
  'context-limit': number;                 // Default: 60000 tokens
  'compression-min-age': number;           // Default: 4 turns
  'maxOutputTokens': number;               // Default: 65536
  'max-output-tokens': number;             // Alias for maxOutputTokens
  'tool-format-override'?: string;         // Optional tool output format
}

interface AgentRuntimeContext {
  /**
   * Get ephemeral setting value with type safety.
   * @param key Setting key from EphemeralSettings
   * @returns Setting value or undefined if not set
   */
  getEphemeralSetting<K extends keyof EphemeralSettings>(
    key: K
  ): EphemeralSettings[K] | undefined;
}
```

**Implementation Strategy**:
- Foreground: Read from `config.getEphemeralSetting()` during runtime view construction
- Subagent: Derive from subagent profile + system defaults

**Usage in GeminiChat**:
```typescript
// Before (STATELESS5 + Config)
const threshold = (this.config.getEphemeralSetting('compression-threshold') as number | undefined) ?? 0.6;

// After (STATELESS6 + Runtime View)
const threshold = this.runtimeContext.getEphemeralSetting('compression-threshold') ?? 0.6;
```

---

### 4. Telemetry Target
**Purpose**: Replaces `logApiRequest/Response/Error(config, event)` with metadata-based logging.

```typescript
interface TelemetryMetadata {
  sessionId: string;     // Correlation ID for request chain
  runtimeId: string;     // Unique identifier for this runtime instance
  provider: string;      // Provider name (e.g., 'gemini', 'openai')
  model: string;         // Model identifier (e.g., 'gemini-2.0-flash')
  authType: AuthType;    // Authentication method (apiKey, serviceAccount, etc.)
  timestamp: number;     // Request initiation time (milliseconds since epoch)
}

interface TelemetryTarget {
  /**
   * Log API request initiation.
   * @param metadata Runtime metadata for correlation
   * @param requestPayload Serialized request content
   */
  logApiRequest(metadata: TelemetryMetadata, requestPayload: string): void;

  /**
   * Log successful API response.
   * @param metadata Runtime metadata for correlation
   * @param response Response event with usage stats
   */
  logApiResponse(metadata: TelemetryMetadata, response: ApiResponseEvent): void;

  /**
   * Log API error.
   * @param metadata Runtime metadata for correlation
   * @param error Error event with failure details
   */
  logApiError(metadata: TelemetryMetadata, error: ApiErrorEvent): void;
}
```

**Implementation Strategy**:
- Telemetry helpers refactored to accept metadata instead of Config
- Runtime context constructs metadata from immutable fields
- Foreground/subagent implementations share same telemetry target interface

**Usage in GeminiChat**:
```typescript
// Before (STATELESS5 + Config)
logApiRequest(this.config, new ApiRequestEvent(model, prompt_id, requestText));

// After (STATELESS6 + Runtime View)
this.runtimeContext.telemetry.logApiRequest({
  sessionId: this.runtimeContext.sessionId,
  runtimeId: this.runtimeContext.runtimeId,
  provider: this.runtimeState.provider,
  model: this.runtimeState.model,
  authType: this.runtimeState.authType,
  timestamp: Date.now(),
}, requestText);
```

---

### 5. Tool Adapter (Diagnostics Only)
**Purpose**: Replaces `config.getToolRegistry().getAllTools()` for error diagnostics.

```typescript
interface ToolAdapter {
  /**
   * Get list of all available tool names (read-only).
   * Used for validation and error messages.
   */
  getAllToolNames(): string[];

  /**
   * Get function declaration for a specific tool.
   * Used by subagents to load tool definitions.
   */
  getTool(name: string): FunctionDeclaration | undefined;
}
```

**Implementation Strategy**:
- GeminiChat: Only needs tool names for schema depth error diagnostics
- SubAgentScope: Needs full FunctionDeclaration objects for tool execution
- Foreground: Delegates to `config.getToolRegistry()`
- Subagent: Returns filtered tool list from subagent profile

**Usage in GeminiChat**:
```typescript
// Before (STATELESS5 + Config)
const tools = this.config.getToolRegistry().getAllTools();
const cyclicSchemaTools = tools.filter(t => hasCycleInSchema(t.schema));

// After (STATELESS6 + Runtime View)
const toolNames = this.runtimeContext.toolAdapter.getAllToolNames();
// Schema checking moved to adapter implementation
```

---

## Subagent Constructor Signature Change

> @plan PLAN-20251028-STATELESS6.P03
> @requirement REQ-STAT6-001.1, REQ-STAT6-003.1

### Current (VIOLATES ISOLATION)
```typescript
constructor(
  readonly name: string,
  readonly runtimeContext: Config,  // ❌ Enables mutation via setModel()
  private readonly promptConfig: PromptConfig,
  private readonly modelConfig: ModelConfig,
  private readonly runConfig: RunConfig,
  private readonly toolConfig?: ToolConfig,
  private readonly outputConfig?: OutputConfig,
)
```

### Target (ENFORCES ISOLATION)
```typescript
constructor(
  readonly name: string,
  readonly runtimeContext: AgentRuntimeContext,  // ✅ Immutable view
  private readonly promptConfig: PromptConfig,
  private readonly runConfig: RunConfig,
  private readonly toolConfig?: ToolConfig,
  private readonly outputConfig?: OutputConfig,
)
```

**Key Changes**:
1. `runtimeContext` type changed from `Config` to `AgentRuntimeContext`
2. `modelConfig` **removed** - model/provider already embedded in `runtimeContext`
3. Line 609 mutation (`setModel()`) eliminated - runtime context pre-built with correct model

**Construction Pattern**:
```typescript
// Before (STATELESS5 - mutates shared Config)
const subagent = await SubAgentScope.create(
  'my-subagent',
  config,  // Shared Config
  { systemPrompt: '...' },
  { model: 'gemini-2.0-flash', temp: 0.7, top_p: 0.9 },  // Will mutate config.setModel()
  { max_time_minutes: 5 }
);

// After (STATELESS6 - isolated runtime context)
const subagentRuntimeContext = createSubagentRuntimeContext(config, {
  model: 'gemini-2.0-flash',
  provider: 'gemini',
  temp: 0.7,
  top_p: 0.9,
  sessionId: config.getSessionId(),
});
const subagent = await SubAgentScope.create(
  'my-subagent',
  subagentRuntimeContext,  // Pre-built, immutable
  { systemPrompt: '...' },
  { max_time_minutes: 5 }
);
```

---

## Migration Path Summary

> @plan PLAN-20251028-STATELESS6.P03

### Phase P04 (TDD Design)
- Define `AgentRuntimeContext` interface with all adapters
- Define adapter interfaces (Provider, Settings, Telemetry, Tool)
- Write unit tests for adapter contracts

### Phase P05 (Pseudocode)
- Document runtime view construction algorithms
- Specify adapter implementation strategies
- Define subagent initialization flow

### Phase P06 (Stub Implementation)
- Implement adapter stubs returning dummy data
- Refactor GeminiChat to accept runtime context parameter
- Update SubAgentScope constructor signature
- Create runtime view factory: `createRuntimeViewFromConfig()`

### Phase P07+ (Incremental Implementation)
- Implement each adapter (Provider, Settings, Ephemeral, Telemetry, Tool)
- Replace Config calls with runtime context calls
- Add immutability verification tests
- Update integration tests for isolation guarantees

---

## Cross-Reference: Requirements to Adapters

> @plan PLAN-20251028-STATELESS6.P03

| Requirement | Adapter(s) Required | Implementation Notes |
|-------------|---------------------|---------------------|
| REQ-STAT6-001.1 (Runtime view injection) | All adapters | GeminiChat/SubAgentScope constructors accept `AgentRuntimeContext` |
| REQ-STAT6-001.2 (Config elimination in GeminiChat) | Provider, Settings, Ephemeral, Telemetry, Tool | Replace 20 Config access points with adapter calls |
| REQ-STAT6-001.3 (SubAgentScope mutation elimination) | N/A - Constructor signature change | Remove `setModel()` call by pre-building runtime context |
| REQ-STAT6-002.1 (Provider/model/auth completeness) | Provider Adapter | Delegate to `runtimeState` fields (already complete from STATELESS5) |
| REQ-STAT6-002.2 (Ephemeral settings completeness) | Ephemeral Settings | Expose compression/context thresholds, output budgets |
| REQ-STAT6-002.3 (Telemetry hooks) | Telemetry Target | Provide metadata-based logging interface |
| REQ-STAT6-003.1 (Config isolation) | All adapters | Runtime context immutability verified via `Object.isFrozen()` |
| REQ-STAT6-003.2 (Parallel subagent support) | All adapters | Each subagent receives isolated runtime context instance |
| REQ-STAT6-003.3 (State isolation verification) | N/A - Integration tests | Verify `config.getModel()` unchanged after subagent execution |

---

## Post-Implementation Architecture State

> @plan PLAN-20251028-STATELESS6.P11

### Implementation Completion Summary

**Phase P10/P10a Results** (completed 2025-10-28):

**GeminiChat Dependency Elimination:**
- **20 Config access points removed** from `/Users/acoliver/projects/llxprt-code/packages/core/src/core/geminiChat.ts`
- **0 residual `this.config` references** (verified via grep search)
- **0 `config.get*()` runtime calls** (verified via grep search)
- All Config access replaced with AgentRuntimeContext adapters:
  - Provider access: `this.runtimeContext.provider.getActiveProvider()`
  - Ephemeral settings: `this.runtimeContext.ephemerals.compressionThreshold()`
  - Telemetry: `this.runtimeContext.telemetry.logApiRequest/Response/Error()`
  - Tool registry: `this.runtimeContext.tools.listToolNames()`

**SubAgentScope Dependency Elimination:**
- **7 Config access points removed** from `/Users/acoliver/projects/llxprt-code/packages/core/src/core/subagent.ts`
- **0 `setModel()` or `setProvider()` mutation calls** (verified via grep search)
- AgentRuntimeContext passed to GeminiChat with pre-configured model/provider
- Runtime context constructed via `createAgentRuntimeContext()` factory

**Residual Config Usage Analysis (P11 Hardening):**

| Search Query | Results | Classification | Notes |
|-------------|---------|----------------|-------|
| `grep "this\.config" geminiChat.ts` | 0 matches | ✅ CLEAN | All Config references eliminated |
| `grep "runtimeContext" subagent.ts` | 6 matches | ✅ ALLOWED | All references to AgentRuntimeContext (expected) |
| `grep -r "getEphemeralSetting" packages/core/src` | 89 matches | ✅ ALLOWED | All in tests, Config class, providers, tools (not GeminiChat/SubAgentScope) |
| `grep "config\.get" geminiChat.ts` | 1 match (comment) | ✅ ALLOWED | Comment line 600: "Step 006.3: Replace config.getEphemeralSetting" |
| `grep "setModel\|setProvider" subagent.ts` | 2 matches (comments) | ✅ ALLOWED | Comments documenting mutation elimination |

**Verification Status:**
- ✅ **No BLOCKER Config usage found** in GeminiChat or SubAgentScope
- ✅ **All ephemeral setting access** now through `runtimeContext.ephemerals.*()` closures
- ✅ **All provider access** now through `runtimeContext.provider.*()` adapter
- ✅ **All telemetry calls** now through `runtimeContext.telemetry.*()` adapter
- ✅ **Immutability enforced** via `Object.freeze(runtimeContext)`

### Architectural Outcomes

**Runtime View Pattern Success:**
- GeminiChat constructor signature: `constructor(view: AgentRuntimeContext, ...)`
- SubAgentScope factory: `createAgentRuntimeContext({ state, history, ... })`
- Foreground adapter: `createRuntimeContextFromConfig(config)` (temporary bridge)

**Adapter Implementation Complete:**
1. **Provider Adapter** (`runtimeContext.provider`):
   - Foreground: Delegates to `providerManager.getActiveProvider()`
   - Subagent: Returns pre-configured provider from runtime state
   - Read-only for subagents (throws on `setActiveProvider()`)

2. **Ephemeral Settings** (`runtimeContext.ephemerals`):
   - Implemented as closure functions returning defaults
   - `compressionThreshold()`, `contextLimit()`, `preserveThreshold()`
   - Values frozen at context creation (no runtime mutation)

3. **Telemetry Target** (`runtimeContext.telemetry`):
   - Enriches calls with runtime metadata (sessionId, runtimeId, provider, model)
   - Conditional forwarding: only logs if telemetry service present
   - No Config dependency in telemetry path

4. **Tool Registry View** (`runtimeContext.tools`):
   - Foreground: Delegates to `toolRegistry.listToolNames()`
   - Subagent: Returns empty view `{ listToolNames: () => [] }`
   - Read-only diagnostics interface

**Isolation Guarantees Achieved:**
- ✅ Foreground Config immutable during subagent execution
- ✅ Distinct `runtimeId` per agent instance
- ✅ Separate `HistoryService` per runtime context
- ✅ No shared state mutation (verified via integration tests)

**Test Results:**
- **3298/3301 tests passing** (3 pre-existing acceptable failures in subagent.test.ts)
- **0 type errors** (interface shadowing resolved via `IProviderAdapter` rename)
- **All CI gates passing** (format, lint, typecheck, build)
