# PLAN-20251028-STATELESS6 Deep Analysis

**Date:** 2025-10-28
**Analyst:** Claude (Sonnet 4.5)
**Status:** ⚠️ CRITICAL GAPS IDENTIFIED

## Executive Summary

PLAN-20251028-STATELESS6 is currently in **early planning stage** with gaps that still prevent execution, although several planning artifacts have now been drafted:

- ⚠️ **Pseudocode drafted** (Phase P05 captured in `analysis/pseudocode/agent-runtime-context.md`, awaiting verification)
- ⚠️ **Test strategy expanded** (Phase P04 now lists concrete cases; property coverage & telemetry checks still need validation)
- ❌ **Missing runtime view interface** (AgentRuntimeContext not yet implemented in codebase)
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

**Architectural Gap:** AgentRuntimeState was designed for provider/model/auth only. STATELESS6 requires a superset "AgentRuntimeContext" that includes runtime settings.

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
- ❌ No interface specification for AgentRuntimeContext
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

**Status:** ✅ Draft completed (pending verification)

**Delivered Content (`analysis/pseudocode/agent-runtime-context.md`):**
- Steps 001–004 define `ReadonlySettingsSnapshot`, `ToolRegistryView`, `AgentRuntimeContext`, and factory options.
- Steps 005 & 009 describe the builder implementation, default handling, telemetry/provider/tool adapters, and immutability requirements.
- Step 006 outlines the GeminiChat constructor refactor to consume the injected view.
- Step 007 captures the SubAgentScope refactor, including runtime view construction and generator wiring.
- Step 008 provides the transitional Config adapter.
- Step 010 documents traceability expectations for downstream phases.

**Remaining Risks:**
- Step 005.4 (telemetry enrichment) still needs concrete metadata structure before implementation.
- Step 007.5 references a content generator bridge helper whose responsibilities should be clarified in P06/P08 tasks.
- Config adapter deprecation timeline (step 008) is not yet captured in later phases.

### 2.4 Phases P06-P10: Implementation

**Status:** ⚠️ BLOCKED (pending P05 verification and expanded P04 coverage)

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
const runtimeView = buildAgentRuntimeContext(subagentRuntimeState, {
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

**Dependency:** Requires AgentRuntimeContext interface (Phase P05) and GeminiChat refactor (Phase P10).

---

## 4. Interface Design Requirements (Missing)

### 4.1 AgentRuntimeContext Interface (DRAFT - Not in Plan)

**Required Fields:**
```typescript
interface AgentRuntimeContext {
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

**Gap:** Interface captured in P05 pseudocode; implementation still absent from codebase.

### 4.2 Builder Function Signature (DRAFT - Not in Plan)

```typescript
function buildAgentRuntimeContext(
  runtimeState: AgentRuntimeState,
  overrides?: {
    ephemerals?: Partial<EphemeralSettings>;
    telemetry?: Partial<TelemetryConfig>;
    headers?: Record<string, string>;
  }
): AgentRuntimeContext
```

**Gap:** Builder workflow defined in P05 pseudocode steps 005/009; TypeScript implementation remains to be written in P06/P08.

### 4.3 Telemetry API Refactor (DRAFT - Not in Plan)

**Current:**
```typescript
logApiRequest(config: Config, event: ApiRequestEvent): void
```

**Required:**
```typescript
logApiRequest(view: AgentRuntimeContext, event: ApiRequestEvent): void
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

1. **Review & Sign Off Phase P05 Pseudocode** ✅ CRITICAL
   - Confirm AgentRuntimeContext/adapter definitions align with architectural goals
   - Flesh out telemetry enrichment metadata (step 005.4)
   - Validate SubAgentScope/GeminiChat refactor steps cover all Config touchpoints

2. **Finalize Phase P04 Test Strategy** ⚠️ HIGH PRIORITY
   - Lock property-testing percentage and mutation thresholds
   - Ensure telemetry assertions and isolation checks are explicit
   - Add verification commands for marker/pseudocode compliance to P04a/P05a/P07a/P09a

3. **Extend AgentRuntimeState** ⚠️ HIGH PRIORITY
   - Add ephemeral settings container
   - Add telemetry config
   - Add custom headers
   - OR: Create separate AgentRuntimeContext wrapping AgentRuntimeState + ephemerals

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

**Option B: Wrap with AgentRuntimeContext**
```typescript
interface AgentRuntimeContext {
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

  toRuntimeView(): AgentRuntimeContext {
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
| P04 | ⚠️ Partial | Concrete tests drafted; telemetry/property coverage still open |
| P05 | ⚠️ Partial | Draft steps 001–010 exist; verification & telemetry detail outstanding |
| P06 | ❌ No | Blocked until P05 verified and builder API frozen |
| P07 | ❌ No | Blocked until P05 verified and P04 telemetry/property cases finalized |
| P08 | ❌ No | Blocked on P07 TDD setup |
| P09 | ❌ No | Blocked on P08 implementation, P04 integration test spec |
| P10 | ❌ No | Blocked on P09 integration TDD |

**Overall Status:** ❌ NOT READY TO EXECUTE

**Prerequisites for Execution:**
1. Verify/finalize P05 pseudocode (interface, telemetry metadata, adapter plan)
2. Lock P04 test strategy coverage (telemetry assertions, property/mutation thresholds)
3. Make architectural decisions (wrap vs. extend, adapter vs. removal)
4. Complete P03 analysis (dependency graph, telemetry API refactor plan)

---

## 8. Alignment with Requirements

### REQ-STAT6-001: No Config Mutation
**Current:** ❌ FAILS (setModel at subagent.ts:609)
**Plan Coverage:** ✅ P05 steps 006/007 eliminate Config mutation via AgentRuntimeContext injection.
**Test Coverage:** ⚠️ Partial (P04 strategy lists explicit setModel spy/history isolation tests; telemetry assertions still pending).

### REQ-STAT6-002: Runtime View Encapsulates Data
**Current:** ❌ No AgentRuntimeContext exists
**Plan Coverage:** ✅ P05 steps 001–005/009 define interface, builder, and immutability requirements.
**Test Coverage:** ⚠️ Partial (unit tests for immutability/ephemerals documented; property thresholds & mutation configs need locking).

### REQ-STAT6-003: Independent Runtime Views
**Current:** ❌ Shared Config violates independence
**Plan Coverage:** ✅ P05 step 007 and P09 integration scenario articulate isolation requirements.
**Test Coverage:** ⚠️ Partial (integration tests describe telemetry/runtime-id assertions; success metrics still to be quantified).

**Requirement-Test Traceability:** ⚠️ Improving
- Requirements mapped to concrete P04 test cases and P05 pseudocode steps.
- Need to record expected property/mutation coverage percentages in verification phases.
- Verification phases must still enforce marker presence and pseudocode compliance.

---

## 9. Conclusion

PLAN-20251028-STATELESS6 correctly identifies the statelessness gaps left by STATELESS5:

1. ✅ **Correct Problem Identification**
   - setModel mutation in SubAgentScope
   - Config dependency in GeminiChat (ephemerals, telemetry, provider manager)
   - AgentRuntimeState incompleteness

2. ⚠️ **Solution Design Drafted, Needs Sign-off**
   - AgentRuntimeContext interface and builder described in P05 pseudocode
   - Telemetry enrichment metadata needs explicit schema
   - Test strategy now includes concrete cases but must lock coverage expectations
   - Telemetry API refactor approach still outlined at high level

3. ⚠️ **Execution Blocked Pending Verification**
   - Phases P06-P10 waiting on P05 verification + telemetry/test strategy refinements
   - Verification phases must incorporate pseudocode and marker compliance checks

**Recommendation:** **PAUSE execution** until planning artifacts are verified:
1. Review and sign off P05 pseudocode (including telemetry enrichment details).
2. Finalize P04 test strategy metrics (property %, mutation thresholds, telemetry assertions).
3. Make architectural decisions (wrap vs. extend, adapter vs. removal) explicit in plan narrative.
4. Update verification phases to enforce pseudocode + marker compliance before implementation.

**Estimated Planning Completion:** ~2 additional hours for reviews and verification updates.

---

**Next Steps:**
1. Conduct peer review of P05 pseudocode and capture action items in P05a.
2. Augment Phase P04/P04a with telemetry coverage checks, property percentages, and mutation configs.
3. Complete Phase P03 analysis (dependency graph, telemetry refactor plan).
4. Update execution tracker/verification phases with new checks.
5. Begin Phase P06 once prerequisites complete.
