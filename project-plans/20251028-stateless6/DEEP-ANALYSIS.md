# PLAN-20251028-STATELESS6 Deep Analysis

**Date:** 2025-10-28
**Analyst:** Claude (Sonnet 4.5)
**Status:** ⚠️ CRITICAL GAPS IDENTIFIED

## Executive Summary

PLAN-20251028-STATELESS6 is currently in **early planning stage** with significant gaps that prevent execution:

- ❌ **No pseudocode written** (Phase P05 not started)
- ❌ **Vague test strategy** (Phase P04 incomplete)
- ❌ **Missing runtime view interface** (GeminiRuntimeView doesn't exist)
- ❌ **Incomplete AgentRuntimeState** (lacks ephemeral settings, telemetry config)
- ⚠️ **setModel mutation unaddressed** (subagent.ts:609 still mutates shared Config)

The plan correctly identifies the problems but lacks the detailed design and implementation strategy to fix them.

---

## 1. Current State Analysis

### 1.1 GeminiChat Config Dependencies (geminiChat.ts)

**Still relies on `this.config` for:**

| Dependency | Line Numbers | Purpose | STATELESS6 Impact |
|------------|--------------|---------|-------------------|
| `getProviderManager()` | 561, 1177, 1775, 2480 | Provider switching logic | Blocks independent runtime views |
| `getSettingsService()` | 716, 1071, 1279, 1849 | Settings fallback for runtime context | Couples subagent to foreground settings |
| `getEphemeralSetting()` | 1392, 1396, 1575, 1700 | Compression/context thresholds | Prevents isolated subagent compression config |
| `getToolRegistry()` | 2282 | Tool diagnostics for schema errors | Read-only, but couples to Config instance |

**From STATELESS5 (already fixed):**
- ✅ Uses `this.runtimeState` for provider/model/auth (lines 400, 471, 564, 590, etc.)
- ✅ AgentRuntimeState properly enforced in constructor

**Gap:** Config is still needed for ephemerals, telemetry, and provider manager access.

### 1.2 SubAgentScope Critical Mutation (subagent.ts)

**Line 609 - The Core Problem:**
```typescript
this.runtimeContext.setModel(this.modelConfig.model);
```

**Why This Breaks Isolation:**
1. `runtimeContext` is a shared `Config` instance passed from foreground
2. Calling `setModel()` mutates the shared config
3. Foreground conversation's model is overwritten by subagent's model
4. Violates REQ-STAT6-003 (isolated runtime views)

**Current Flow:**
```
SubAgentScope.createChatObject()
  ├─> this.runtimeContext.setModel(subagent model)  ← MUTATION!
  ├─> createContentGenerator(config, ...)
  └─> new GeminiChat(runtimeState, config, ...)
```

**Required Flow (STATELESS6):**
```
SubAgentScope.createChatObject()
  ├─> Create isolated runtime state (no mutation)
  ├─> Build runtime view from state + ephemeral overrides
  └─> new GeminiChat(runtimeState, runtimeView, ...)  ← No shared Config!
```

### 1.3 Telemetry API Coupling (telemetry/loggers.ts)

**Current Signatures:**
```typescript
export function logApiRequest(config: Config, event: ApiRequestEvent): void
export function logApiResponse(config: Config, event: ApiResponseEvent): void
export function logApiError(config: Config, event: ApiErrorEvent): void
```

**Problem:** These APIs require Config instance to extract:
- Session ID
- Settings service (for telemetry enabled/disabled flags)
- Provider/model metadata (already in event, but Config used for validation)

**Gap:** Telemetry can't work with just runtime view - needs refactoring.

### 1.4 AgentRuntimeState Incompleteness

**From STATELESS5 (AgentRuntimeState.ts), currently has:**
```typescript
interface AgentRuntimeState {
  runtimeId: string;
  provider: string;
  model: string;
  authType: AuthType;
  authPayload?: AuthPayload;
  baseUrl?: string;
  proxyUrl?: string;
  modelParams?: ModelParams;
  sessionId: string;
  updatedAt: number;
}
```

**STATELESS6 needs (missing):**
- ❌ Ephemeral settings (compression threshold, context limit, preserve threshold)
- ❌ Telemetry flags (enabled, sink config)
- ❌ Custom headers (for provider API calls)
- ❌ Provider manager accessor (for runtime provider switching)
- ❌ Tool registry reference (for diagnostics)

**Architectural Gap:** AgentRuntimeState was designed for provider/model/auth only. STATELESS6 requires a superset "GeminiRuntimeView" that includes runtime settings.

---

## 2. Plan Gaps Analysis

### 2.1 Phase P03: Architecture Analysis

**Status:** ⚠️ Partially Complete

**What's Done:**
- ✅ Identified Config touchpoints in geminiChat.ts
- ✅ Documented setModel mutation in subagent.ts
- ✅ Listed ephemeral settings usage

**What's Missing:**
- ❌ No dependency graph showing call chains
- ❌ No impact analysis of Config removal
- ❌ No migration path for existing callers
- ❌ Incomplete telemetry API redesign analysis

### 2.2 Phase P04: Requirements & Test Strategy

**Status:** ⚠️ Incomplete

**Requirements (requirements.md):**
```
REQ-STAT6-001: Operate exclusively on injected runtime view (no Config mutation)
REQ-STAT6-002: Runtime view encapsulates immutable data for API calls
REQ-STAT6-003: Independent runtime views with isolated history/telemetry
```

**Gaps:**
- ❌ No interface specification for GeminiRuntimeView
- ❌ No definition of "immutable data for API calls" (what fields?)
- ❌ No specification of ephemeral settings format in runtime view

**Test Strategy (test-strategy.md):**
```
Unit: SubAgentScope stateless tests (P07)
Integration: Dual runtime view scenario (P09)
```

**Gaps:**
- ❌ No specific test cases listed
- ❌ No mutation detection strategy (e.g., Object.freeze() assertions)
- ❌ No telemetry verification approach
- ❌ Vague "dual runtime view scenario" - what does it actually test?

### 2.3 Phase P05: Pseudocode

**Status:** ❌ NOT STARTED

**Current Content (geminiChat-runtime-view.md):**
```markdown
> Draft detailed pseudocode during Phase P05. Outline should cover:
> 1. GeminiRuntimeView structure ...
> 2. Adapter enabling existing Config-based callers ...
> ...
```

**Critical Gap:** This is just a TODO list, not actual pseudocode. Without this, Phases P06-P10 cannot proceed.

**Required Pseudocode Artifacts:**
1. **GeminiRuntimeView interface definition** (fields, methods, read-only accessors)
2. **Runtime view builder** (from AgentRuntimeState + ephemeral overrides)
3. **GeminiChat constructor refactor** (accept view instead of config)
4. **SubAgentScope.createChatObject refactor** (build isolated view, no setModel)
5. **Telemetry adapter** (extract metadata from view instead of Config)

### 2.4 Phases P06-P10: Implementation

**Status:** ❌ BLOCKED (waiting on P05 pseudocode)

**Execution Tracker:** All phases marked ⬜ (not started)

---

## 3. Critical Blocker: setModel Mutation

### 3.1 The Problem

**Location:** `packages/core/src/core/subagent.ts:609`

**Context:**
```typescript
private async createChatObject(context: ContextState) {
  // ... setup code ...

  this.runtimeContext.setModel(this.modelConfig.model);  // ← MUTATES SHARED CONFIG!

  const runtimeState = createAgentRuntimeStateFromConfig(
    this.runtimeContext,
    { ... }
  );

  return new GeminiChat(runtimeState, this.runtimeContext, ...);
}
```

**Impact:**
- Foreground chat using `gemini-2.0-flash-exp`
- Subagent launched with `gemini-2.0-flash-thinking-exp`
- `setModel` overwrites foreground's model in shared Config
- Foreground's NEXT API call uses subagent's model
- Breaks REQ-STAT6-003 (isolated runtime views)

### 3.2 Root Cause

**Architectural Flaw:**
- SubAgentScope receives `Config` as `runtimeContext`
- Config is mutable, shared across foreground + all subagents
- `setModel()` mutates this shared state
- STATELESS5 introduced `AgentRuntimeState` but didn't remove Config dependency

**Why STATELESS5 Didn't Fix This:**
- STATELESS5 focused on GeminiChat reading from runtime state
- SubAgentScope still constructs runtime state FROM Config (mutation needed)
- Config removal requires ephemeral settings migration (STATELESS6 scope)

### 3.3 Required Fix (STATELESS6 Scope)

**Step 1:** Create isolated runtime state for subagent
```typescript
// Don't mutate shared config!
const subagentRuntimeState = createAgentRuntimeState({
  runtimeId: `${this.runtimeContext.getSessionId()}-subagent`,
  provider: this.runtimeContext.getActiveProvider().name,
  model: this.modelConfig.model,  // ← Subagent's model, not foreground's
  authType: ...,
  // ... ephemeral overrides ...
});
```

**Step 2:** Build runtime view from state
```typescript
const runtimeView = buildGeminiRuntimeView(subagentRuntimeState, {
  compressionThreshold: 0.8,  // Subagent-specific override
  contextLimit: 40000,         // Subagent-specific override
  // ... other ephemerals ...
});
```

**Step 3:** Pass view to GeminiChat (no Config)
```typescript
return new GeminiChat(
  subagentRuntimeState,
  runtimeView,  // ← New! Replaces 'config' parameter
  contentGenerator,
  generationConfig,
  start_history,
);
```

**Dependency:** Requires GeminiRuntimeView interface (Phase P05) and GeminiChat refactor (Phase P10).

---

## 4. Interface Design Requirements (Missing)

### 4.1 GeminiRuntimeView Interface (DRAFT - Not in Plan)

**Required Fields:**
```typescript
interface GeminiRuntimeView {
  // Runtime identity
  readonly runtimeId: string;
  readonly sessionId: string;

  // Provider/model state (from AgentRuntimeState)
  readonly provider: string;
  readonly model: string;
  readonly authType: AuthType;
  readonly authPayload?: AuthPayload;
  readonly baseUrl?: string;
  readonly proxyUrl?: string;
  readonly modelParams?: ModelParams;

  // Ephemeral settings (NEW - for compression/telemetry)
  readonly ephemerals: {
    compressionThreshold: number;
    compressionPreserveThreshold: number;
    contextLimit: number;
    maxOutputTokens?: number;
  };

  // Telemetry config (NEW - replaces Config.getSettingsService())
  readonly telemetry: {
    enabled: boolean;
    sink?: TelemetrySink;
  };

  // Custom headers (NEW - for API calls)
  readonly headers?: Record<string, string>;

  // Provider manager accessor (NEW - replaces Config.getProviderManager())
  readonly providerRegistry: {
    getActiveProvider(): IProvider;
    listProviders(): string[];
    // NO setActiveProvider() - read-only view!
  };

  // Tool diagnostics (NEW - replaces Config.getToolRegistry())
  readonly toolDiagnostics: {
    getAllTools(): ToolDeclaration[];
  };
}
```

**Gap:** This interface doesn't exist in the codebase. Phase P05 pseudocode must define it.

### 4.2 Builder Function Signature (DRAFT - Not in Plan)

```typescript
function buildGeminiRuntimeView(
  runtimeState: AgentRuntimeState,
  overrides?: {
    ephemerals?: Partial<EphemeralSettings>;
    telemetry?: Partial<TelemetryConfig>;
    headers?: Record<string, string>;
  }
): GeminiRuntimeView
```

**Gap:** No builder exists. Phase P06 (stub) must introduce it.

### 4.3 Telemetry API Refactor (DRAFT - Not in Plan)

**Current:**
```typescript
logApiRequest(config: Config, event: ApiRequestEvent): void
```

**Required:**
```typescript
logApiRequest(view: GeminiRuntimeView, event: ApiRequestEvent): void
// OR
logApiRequest(metadata: TelemetryMetadata, event: ApiRequestEvent): void

interface TelemetryMetadata {
  sessionId: string;
  provider: string;
  model: string;
  authType: AuthType;
  telemetryEnabled: boolean;
  sink?: TelemetrySink;
}
```

**Gap:** Telemetry refactor not addressed in plan. Needs Phase P09/P10.

---

## 5. Test Strategy Gaps

### 5.1 Unit Tests (Phase P07)

**Plan Says:**
> "Assert SubAgentScope no longer mutates shared Config (e.g., `setModel`)"

**Missing Specifications:**
- ❌ How to detect mutation? (Object.freeze? Spy on setModel?)
- ❌ What happens if test calls setModel? (Should throw? Should be unavailable?)
- ❌ How to verify runtime view construction? (Check fields? Type guards?)

**Recommended Test Cases:**
```typescript
describe('SubAgentScope.createChatObject', () => {
  it('should not call config.setModel', () => {
    const setModelSpy = vi.spyOn(mockConfig, 'setModel');
    await scope.runNonInteractive(context);
    expect(setModelSpy).not.toHaveBeenCalled();
  });

  it('should build isolated runtime state', () => {
    const state = scope['buildRuntimeState']();
    expect(state.model).toBe('subagent-model');
    expect(state.model).not.toBe(foregroundModel);
  });

  it('should freeze runtime view', () => {
    const view = scope['buildRuntimeView']();
    expect(() => { (view as any).model = 'hacked'; }).toThrow();
  });
});
```

**Gap:** Test plan has no concrete test cases.

### 5.2 Integration Tests (Phase P09)

**Plan Says:**
> "Simulate foreground + synthetic subagent chats executing sequentially, verifying isolated history/telemetry and different provider/model combinations."

**Missing Specifications:**
- ❌ What does "sequentially" mean? (Interleaved API calls? Separate event loops?)
- ❌ How to verify isolation? (Check model doesn't change? Check history separate?)
- ❌ What provider/model combinations? (Same provider different models? Different providers?)

**Recommended Integration Test:**
```typescript
it('should maintain isolated models during subagent execution', async () => {
  // Foreground using gemini-2.0-flash-exp
  const foregroundChat = createGeminiChat({
    model: 'gemini-2.0-flash-exp',
  });

  // Subagent using gemini-2.0-flash-thinking-exp
  const subagent = await SubAgentScope.create({
    modelConfig: { model: 'gemini-2.0-flash-thinking-exp', ... },
  });

  // Run subagent
  await subagent.runNonInteractive(context);

  // Verify foreground model unchanged
  const foregroundState = foregroundChat['runtimeState'];
  expect(foregroundState.model).toBe('gemini-2.0-flash-exp');

  // Verify subagent used its own model
  expect(apiCallSpy).toHaveBeenCalledWith(
    expect.objectContaining({ model: 'gemini-2.0-flash-thinking-exp' })
  );
});
```

**Gap:** Test plan lacks this level of detail.

---

## 6. Recommendations

### 6.1 Immediate Actions (Before Proceeding)

1. **Complete Phase P05 Pseudocode** ✅ CRITICAL
   - Define GeminiRuntimeView interface with all fields
   - Specify builder function signature and logic
   - Document GeminiChat constructor changes
   - Show SubAgentScope refactor removing setModel
   - Design telemetry API refactor

2. **Expand Phase P04 Test Strategy** ⚠️ HIGH PRIORITY
   - List specific test cases for P07 (unit)
   - Detail integration test scenario for P09
   - Specify mutation detection approach
   - Define verification criteria for each requirement

3. **Extend AgentRuntimeState** ⚠️ HIGH PRIORITY
   - Add ephemeral settings container
   - Add telemetry config
   - Add custom headers
   - OR: Create separate GeminiRuntimeView wrapping AgentRuntimeState + ephemerals

### 6.2 Architecture Decisions Needed

**Decision 1:** Extend AgentRuntimeState vs. Wrap It?

**Option A: Extend AgentRuntimeState**
```typescript
interface AgentRuntimeState {
  // ... existing fields ...
  ephemerals?: EphemeralSettings;
  telemetry?: TelemetryConfig;
  headers?: Record<string, string>;
}
```
- ✅ Single source of truth
- ❌ Mixes provider/model state with runtime settings
- ❌ Violates STATELESS5 design (pure provider/model/auth)

**Option B: Wrap with GeminiRuntimeView**
```typescript
interface GeminiRuntimeView {
  state: AgentRuntimeState;  // Provider/model/auth
  ephemerals: EphemeralSettings;
  telemetry: TelemetryConfig;
  headers?: Record<string, string>;
}
```
- ✅ Preserves STATELESS5 AgentRuntimeState design
- ✅ Clear separation of concerns
- ✅ Easier to test runtime settings independently
- ❌ Extra indirection layer

**Recommendation:** Option B (wrap). Preserves STATELESS5 abstraction and allows GeminiChat-specific settings without polluting core runtime state.

**Decision 2:** Config Adapter vs. Full Removal?

**Option A: Config Adapter (Phase P06 stub approach)**
```typescript
class ConfigToRuntimeViewAdapter {
  constructor(private config: Config) {}

  toRuntimeView(): GeminiRuntimeView {
    // Extract ephemerals from config.getEphemeralSetting()
    // Build view on-the-fly
  }
}
```
- ✅ Incremental migration
- ✅ Existing callers work unchanged
- ❌ Doesn't fix setModel mutation (adapter still wraps mutable Config)

**Option B: Full Removal**
```typescript
// SubAgentScope receives ephemeral overrides, not Config
SubAgentScope.create(..., ephemeralOverrides: EphemeralSettings)
```
- ✅ Forces isolation
- ✅ Eliminates mutation risk
- ❌ Requires caller refactoring (breaking change)

**Recommendation:** Hybrid approach:
1. Phase P06: Introduce adapter for existing callers (backward compat)
2. Phase P08: Refactor SubAgentScope to accept overrides (forward migration)
3. Future: Deprecate adapter once all callers migrated

---

## 7. Execution Readiness Assessment

| Phase | Ready? | Blocker(s) |
|-------|--------|------------|
| P03 | ⚠️ Partial | Missing dependency graph, telemetry API analysis |
| P04 | ❌ No | Vague test strategy, no concrete test cases |
| P05 | ❌ No | No pseudocode written (just TODO outline) |
| P06 | ❌ No | Blocked on P05 interface definition |
| P07 | ❌ No | Blocked on P05 pseudocode, P04 test cases |
| P08 | ❌ No | Blocked on P07 TDD setup |
| P09 | ❌ No | Blocked on P08 implementation, P04 integration test spec |
| P10 | ❌ No | Blocked on P09 integration TDD |

**Overall Status:** ❌ NOT READY TO EXECUTE

**Prerequisites for Execution:**
1. Complete P05 pseudocode with interface definitions
2. Expand P04 test strategy with concrete test cases
3. Make architectural decisions (wrap vs. extend, adapter vs. removal)
4. Complete P03 analysis (dependency graph, telemetry API refactor plan)

---

## 8. Alignment with Requirements

### REQ-STAT6-001: No Config Mutation
**Current:** ❌ FAILS (setModel at subagent.ts:609)
**Plan Coverage:** ⚠️ Partial (identifies problem, lacks solution pseudocode)
**Test Coverage:** ⚠️ Vague ("assert no mutation" without specifics)

### REQ-STAT6-002: Runtime View Encapsulates Data
**Current:** ❌ No GeminiRuntimeView exists
**Plan Coverage:** ✅ Requirement defined
**Test Coverage:** ❌ No tests specified for view construction

### REQ-STAT6-003: Independent Runtime Views
**Current:** ❌ Shared Config violates independence
**Plan Coverage:** ⚠️ Partial (goal stated, implementation unclear)
**Test Coverage:** ⚠️ Vague ("dual runtime scenario" undefined)

**Requirement-Test Traceability:** ⚠️ WEAK
- Requirements are high-level goals
- Tests don't specify how to verify requirements
- Missing acceptance criteria for each requirement

---

## 9. Conclusion

PLAN-20251028-STATELESS6 correctly identifies the statelessness gaps left by STATELESS5:

1. ✅ **Correct Problem Identification**
   - setModel mutation in SubAgentScope
   - Config dependency in GeminiChat (ephemerals, telemetry, provider manager)
   - AgentRuntimeState incompleteness

2. ❌ **Incomplete Solution Design**
   - No GeminiRuntimeView interface defined
   - No pseudocode for refactoring approach
   - Vague test strategy without concrete test cases
   - Missing telemetry API refactor plan

3. ❌ **Execution Blocked**
   - Phase P05 (pseudocode) is a stub, not actual pseudocode
   - Phases P06-P10 can't proceed without P05
   - Test strategy too abstract to implement TDD phases

**Recommendation:** **PAUSE execution** and complete planning artifacts:
1. Write actual P05 pseudocode with interface definitions
2. Specify concrete test cases in P04
3. Make architectural decisions (wrap vs. extend, adapter vs. removal)
4. Then proceed with TDD implementation (P06-P10)

**Estimated Planning Completion:** 2-3 hours for thorough pseudocode and test specification.

---

**Next Steps:**
1. Complete Phase P05 pseudocode (define GeminiRuntimeView interface, builder, refactorings)
2. Expand Phase P04 test strategy (concrete test cases for P07 and P09)
3. Complete Phase P03 analysis (dependency graph, telemetry refactor plan)
4. Update execution tracker with realistic estimates
5. Begin Phase P06 once prerequisites complete
