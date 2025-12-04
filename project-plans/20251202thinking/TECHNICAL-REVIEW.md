# Technical Review: Reasoning/Thinking Token Support Implementation Plan

**Review Date**: 2025-12-02
**Reviewer**: Senior Software Architect
**Plan ID**: PLAN-20251202-THINKING
**Status**: CRITICAL GAPS IDENTIFIED

---

## Executive Summary

The implementation plan has **7 critical technical gaps** that will prevent successful implementation. These gaps fall into three categories:

1. **Runtime Context Access Issues** (3 gaps) - Plan assumes direct access to `runtimeContext.ephemerals` that doesn't exist in providers
2. **Token Counting Integration** (2 gaps) - Missing concrete integration with existing token counting system
3. **Settings Access Pattern Mismatch** (2 gaps) - Misunderstanding of how settings flow through the system

**Recommendation**: HALT implementation until gaps are resolved. The plan is well-structured but contains fundamental architectural misunderstandings.

---

## Critical Gaps

### GAP-1: OpenAIProvider Has No Direct RuntimeContext Access
**Location**: Phase 12 (Message Building Stub), Phase 14 (Message Building Implementation)
**Files Affected**: `packages/core/src/providers/openai/OpenAIProvider.ts`

**What's Missing**:
The plan assumes OpenAIProvider can access `this.runtimeContext.ephemerals.reasoning.*()`:

```typescript
// From plan Phase 12, line 51-58:
private buildMessagesWithReasoning(
  contents: IContent[],
  settings: SettingsService  // <-- WRONG TYPE
): ChatCompletionMessageParam[] {
```

**Why It Matters**:
1. OpenAIProvider extends BaseProvider, which does NOT have a `runtimeContext` property
2. BaseProvider only has `defaultSettingsService` and uses AsyncLocalStorage for call context
3. Settings are accessed via `NormalizedGenerateChatOptions` passed to provider methods, not injected as parameters

**Actual Architecture**:
```typescript
// From BaseProvider.ts lines 61-75
export interface NormalizedGenerateChatOptions extends GenerateChatOptions {
  settings: SettingsService;  // This is the actual SettingsService
  config?: Config;
  runtime?: ProviderRuntimeContext;
  // ... other fields
}
```

**How Settings Actually Flow**:
1. geminiChat.ts creates `NormalizedGenerateChatOptions` with `settings: SettingsService`
2. Passes options to provider's `generateChat` or `generateChatStream`
3. Provider methods receive options with settings as a parameter
4. Reasoning settings would be accessed via `options.settings.get('reasoning.includeInContext')`

**Required Fix**:
1. Phase 12 stub should accept `options: NormalizedGenerateChatOptions`, not `settings: SettingsService`
2. Settings access should be `options.settings.get('reasoning.includeInContext')` pattern
3. Update pseudocode in `openai-provider-reasoning.md` lines 110-143 to reflect actual parameter passing

**Impact**: HIGH - Implementation will fail to compile without this fix.

---

### GAP-2: Phase 15 Assumes geminiChat Has Direct Ephemeral Access
**Location**: Phase 15 (Context Limit Integration)
**Files Affected**: `packages/core/src/core/geminiChat.ts`

**What's Missing**:
Plan assumes geminiChat can access `this.runtimeContext.ephemerals.reasoning.includeInContext()`:

```typescript
// From Phase 15, lines 204-205:
const includeInContext = this.runtimeContext.ephemerals.reasoning.includeInContext();
```

**Why It Matters**:
1. geminiChat.ts DOES have `this.runtimeContext: AgentRuntimeContext` (line 392)
2. BUT `AgentRuntimeContext.ephemerals` interface (lines 166-171 in AgentRuntimeContext.ts) does NOT include reasoning sub-object
3. Phase 03b adds reasoning to interface, but Phase 15 assumes it's already working
4. There's a dependency order issue: Phase 15 can't work until Phase 03b/03c are complete

**Current Interface** (AgentRuntimeContext.ts lines 166-171):
```typescript
readonly ephemerals: {
  compressionThreshold(): number;
  contextLimit(): number;
  preserveThreshold(): number;
  toolFormatOverride(): string | undefined;
  // NO reasoning sub-object yet
};
```

**Required Fix**:
1. Ensure Phase 03b/03c are TRULY complete before Phase 15
2. Verify reasoning ephemeral accessors work end-to-end
3. Add verification step in Phase 15 to confirm `this.runtimeContext.ephemerals.reasoning` exists

**Impact**: MEDIUM-HIGH - Code will compile but crash at runtime if Phase 03b/03c are incomplete.

---

### GAP-3: Settings Access in Phase 03b Doesn't Match Actual Usage
**Location**: Phase 03b (Ephemeral Settings Registration)
**Files Affected**: `packages/core/src/runtime/createAgentRuntimeContext.ts`

**What's Missing**:
Phase 03b assumes settings are accessed as `options.settings['reasoning.enabled']` (lines 131-132):

```typescript
// From Phase 03b, lines 131-132:
enabled: (): boolean =>
  options.settings['reasoning.enabled'] ??
  EPHEMERAL_DEFAULTS.reasoning.enabled,
```

**Why It Matters**:
1. `ReadonlySettingsSnapshot` interface (lines 15-35 in AgentRuntimeContext.ts) uses property access, not string keys
2. Settings snapshot is created from SettingsService via key-value access
3. Need to verify how settings actually flow from CLI `/set` commands to ReadonlySettingsSnapshot

**Actual Interface** (AgentRuntimeContext.ts lines 15-35):
```typescript
export interface ReadonlySettingsSnapshot {
  compressionThreshold?: number;
  contextLimit?: number;
  // ... existing settings
  // Need to add reasoning.* properties
}
```

**Required Fix**:
1. Verify exact format: is it `'reasoning.enabled'` as string key or `reasoning: { enabled: boolean }`?
2. Check how SettingsService serializes dotted keys to snapshot
3. Ensure Phase 03b implementation matches actual settings system behavior
4. Add integration test to verify `/set reasoning.enabled true` flows to ephemerals

**Impact**: MEDIUM - Settings will be silently undefined if key format is wrong.

---

### GAP-4: Token Counting Has No Concrete Integration Point
**Location**: Phase 15 (Context Limit Integration)
**Files Affected**: `packages/core/src/core/geminiChat.ts`, `packages/core/src/services/history/HistoryService.ts`

**What's Missing**:
Phase 15 proposes `getEffectiveTokenCount()` but doesn't specify:
1. Where exactly to call this function (which methods in geminiChat.ts?)
2. How to integrate with existing `HistoryService.getTotalTokens()`
3. Whether to modify HistoryService or only geminiChat

**From Phase 15, lines 199-235**:
```typescript
private getEffectiveTokenCount(): number {
  // Pseudocode showing logic
  // BUT: No concrete grep commands to find insertion points
  // No line numbers for actual modifications
}
```

**Why It Matters**:
1. geminiChat.ts has multiple methods that call `this.historyService.getTotalTokens()`
2. Must identify ALL callsites that need effective count vs raw count
3. Compression logic is complex - wrong integration point breaks context management

**Missing Details**:
- Exact line numbers in geminiChat.ts for modifications
- Which methods need effective count: `shouldCompress()`, `enforceContextWindow()`, both?
- How `estimatePendingTokens()` should filter thinking blocks
- Whether display logic needs separate calculation

**Required Fix**:
1. Add concrete grep commands to find modification points
2. Provide EXACT line numbers for changes (not "~line 70" but "line 73-75")
3. Create verification tests that thinking tokens are properly excluded
4. Add pseudocode showing call stack: display → effective count → filtered tokens

**Impact**: HIGH - Implementation will be incomplete or break context management.

---

### GAP-5: reasoningUtils Import Path Not Verified
**Location**: Phase 06 (reasoningUtils Stub), Phase 09 (Parsing Stub), Phase 12 (Message Building Stub)
**Files Affected**: All files importing from `reasoningUtils.ts`

**What's Missing**:
Plan creates `packages/core/src/providers/reasoning/reasoningUtils.ts` but doesn't verify:
1. Directory `packages/core/src/providers/reasoning/` doesn't exist yet
2. No verification that import paths will work
3. No check that TypeScript will resolve the imports

**From Phase 06, lines 40**:
```typescript
import type { IContent, ThinkingBlock, ContentBlock } from '../../services/history/IContent.js';
```

**From Phase 12, lines 70-76**:
```typescript
import {
  filterThinkingForContext,
  thinkingToReasoningField,
  extractThinkingBlocks,
  type StripPolicy,
} from '../reasoning/reasoningUtils.js';
```

**Why It Matters**:
1. Import path assumes file structure that doesn't exist
2. TypeScript will fail if paths are wrong
3. No mkdir command in Phase 06 to create directory

**Required Fix**:
1. Phase 06 must include: `mkdir -p packages/core/src/providers/reasoning/`
2. Add verification: `ls packages/core/src/providers/reasoning/reasoningUtils.ts`
3. Add typecheck after Phase 06 to verify imports resolve
4. Document relative path from OpenAIProvider to reasoningUtils

**Impact**: MEDIUM - Implementation will fail to compile if directory structure is wrong.

---

### GAP-6: ThinkingBlock Enhancement Backward Compatibility Not Verified
**Location**: Phase 03 (ThinkingBlock Interface Enhancement)
**Files Affected**: `packages/core/src/services/history/IContent.ts`

**What's Missing**:
Plan adds optional properties to ThinkingBlock but doesn't verify:
1. All existing code that creates ThinkingBlocks
2. Whether any code does type narrowing on ContentBlock type
3. Whether serialization/deserialization handles new fields

**From Phase 03, lines 60-68**:
```typescript
interface ThinkingBlock {
  type: 'thinking';
  thought: string;
  isHidden?: boolean;
  /** Source field name for round-trip serialization */
  sourceField?: 'reasoning_content' | 'thinking' | 'thought';
  /** Signature for Anthropic extended thinking */
  signature?: string;
}
```

**Why It Matters**:
1. Gemini provider may already create ThinkingBlocks (from overview.md line 3)
2. Adding optional fields should be safe, but need to verify
3. HistoryService serialization must handle new fields
4. Profile save/load must preserve new fields

**Required Fix**:
1. Add verification step: `grep -r "type: 'thinking'" packages/core/src/`
2. Check all ThinkingBlock creation sites in codebase
3. Verify HistoryService.serialize() handles new properties
4. Add test that new properties survive save/load cycle

**Impact**: MEDIUM - Existing thinking functionality could break.

---

### GAP-7: Context Limit getEffectiveTokenCount Implementation is Incomplete
**Location**: Phase 15 (Context Limit Integration), lines 199-255
**Files Affected**: `packages/core/src/core/geminiChat.ts`

**What's Missing**:
Phase 15 provides TWO implementations of `getEffectiveTokenCount()`:
1. Full implementation (lines 199-235) - Complex, estimates tokens by character count
2. Simplified implementation (lines 239-255) - Uses 80% heuristic with TODO marker

**From Phase 15, lines 239-254**:
```typescript
private getEffectiveTokenCount(): number {
  const rawTokens = this.historyService.getTotalTokens();
  const includeInContext = this.runtimeContext.ephemerals.reasoning.includeInContext();

  // For initial implementation: if reasoning not included, assume it's roughly 20% of tokens
  // This avoids expensive recalculation and is conservative
  // TODO P15: Implement precise calculation by tracking thinking tokens separately
  return includeInContext ? rawTokens : Math.floor(rawTokens * 0.8);
}
```

**Why It Matters**:
1. Full implementation requires filtering history and re-estimating tokens (expensive)
2. Simplified implementation uses 80% heuristic (inaccurate but fast)
3. Plan says "recommended for initial implementation" but has TODO marker
4. Verification section (lines 321-323) expects FULL implementation, not simplified
5. Deferred implementation detection (line 313) will FAIL on the TODO marker

**Contradiction**:
- Verification expects: `grep -E "(filterThinkingForContext|removeThinkingFromContent|stripPolicy)"`
- Simplified version doesn't use any of these functions
- Verification will fail if simplified version is used

**Required Fix**:
1. Choose ONE implementation approach
2. If using simplified: Update verification to accept 80% heuristic, remove TODO requirement
3. If using full: Remove simplified version, acknowledge performance cost
4. Clarify that "recommended" means "use this one" not "consider this"
5. Add performance benchmarks if using full implementation

**Impact**: MEDIUM - Verification will fail, or implementation will be inaccurate.

---

## Integration Point Analysis

### 1. Data Flow Verification

**Question**: Can data actually flow through the system?

**Analysis**:
```
User input → /set reasoning.includeInContext true
  ↓
SettingsService (how is dotted key stored?)
  ↓
ReadonlySettingsSnapshot (is key 'reasoning.includeInContext' or reasoning.includeInContext?)
  ↓
createAgentRuntimeContext (Phase 03b)
  ↓
ephemerals.reasoning.includeInContext() (accessor function)
  ↓
geminiChat.ts reads setting (Phase 15)
  ↓
OpenAIProvider.buildMessagesWithReasoning (Phase 14) - HOW DOES IT GET THE SETTING?
```

**BROKEN LINK**: OpenAIProvider has no direct access to `runtimeContext.ephemerals`. It receives settings via `NormalizedGenerateChatOptions.settings: SettingsService`, not ephemeral accessors.

**Fix Required**: Either:
1. OpenAIProvider reads from `options.settings.get('reasoning.includeInContext')`
2. geminiChat reads setting and passes as parameter to provider
3. Add reasoning settings to `NormalizedGenerateChatOptions` interface

---

### 2. File Location Verification

**All file paths in plan are accurate EXCEPT**:
- `packages/core/src/providers/reasoning/` directory does NOT exist
- Must be created in Phase 06

**Verified Locations**:
- ✅ `packages/core/src/services/history/IContent.ts` exists
- ✅ `packages/core/src/providers/openai/OpenAIProvider.ts` exists
- ✅ `packages/core/src/runtime/AgentRuntimeContext.ts` exists
- ✅ `packages/core/src/runtime/createAgentRuntimeContext.ts` exists
- ✅ `packages/core/src/core/geminiChat.ts` exists
- ❌ `packages/core/src/providers/reasoning/` does NOT exist (must create)

---

### 3. Settings Accessibility

**Question**: Are settings actually accessible where they need to be used?

**geminiChat.ts**:
- ✅ Has `this.runtimeContext: AgentRuntimeContext`
- ❌ `ephemerals.reasoning` doesn't exist until Phase 03b complete
- ✅ Can use `this.runtimeContext.ephemerals.reasoning.includeInContext()` after Phase 03b

**OpenAIProvider.ts**:
- ❌ Has NO `this.runtimeContext` property
- ❌ Cannot use `this.runtimeContext.ephemerals.reasoning.*()` as plan assumes
- ✅ CAN access via `options.settings.get('reasoning.includeInContext')` where options is NormalizedGenerateChatOptions
- ⚠️ Plan's pseudocode is WRONG for provider setting access

**Required Fix**:
1. Update Phase 12/13/14 to use `options.settings.get()` pattern
2. Update pseudocode to reflect actual parameter passing
3. Verify settings are properly passed in NormalizedGenerateChatOptions

---

### 4. Error Handling Scenarios

**Edge Cases Covered**:
- ✅ EC-001: Model doesn't return reasoning_content (handled)
- ✅ EC-002: Empty reasoning_content (handled)
- ✅ EC-003: Mixed streaming (handled)
- ✅ EC-004: Settings changed mid-conversation (handled)
- ✅ EC-005: Profile load (handled)
- ✅ EC-006: Tool call with reasoning (handled)
- ✅ EC-007: Empty reasoning after stripping (handled)

**Error Scenarios Covered**:
- ✅ ERR-001: Invalid setting value (handled by /set command validation)
- ✅ ERR-002: Token estimation fails (fallback logic exists)
- ✅ ERR-003: reasoning_content too large (deferred to model)

**Missing Error Scenarios**:
- ❌ What if `filterThinkingForContext()` throws exception?
- ❌ What if `thinkingToReasoningField()` receives malformed blocks?
- ❌ What if reasoning settings are set but reasoningUtils import fails?
- ❌ What if effective token count is negative (edge case in calculation)?

---

### 5. Undefined Behavior for Edge Cases

**Covered**:
- ✅ All reasoning.* settings have default values (Phase 03b)
- ✅ Missing reasoning_content handled gracefully (return null)
- ✅ Empty ThinkingBlock array handled (return undefined)

**Undefined**:
- ❓ What if user sets `reasoning.stripFromContext='invalid'`? (runtime error or fallback?)
- ❓ What if ThinkingBlock.thought is empty string? (should it be filtered?)
- ❓ What if reasoning_content contains malformed UTF-8? (API will reject, but how to handle?)
- ❓ What if compression is triggered while building messages with reasoning? (race condition?)

---

### 6. Dependencies Between Phases

**Phase Dependencies** (from plan/00-overview.md lines 56-62):
```
P03 → P03a → P03b → P03c → P04 → P04a → P05 → P05a →
P06 → P06a → P07 → P07a → P08 → P08a →
P09 → P09a → P10 → P10a → P11 → P11a →
P12 → P12a → P13 → P13a → P14 → P14a →
P15 → P15a → P16 → P16a
```

**Critical Dependencies**:
1. Phase 12/14 (OpenAI message building) REQUIRES Phase 08 (reasoningUtils implementation)
2. Phase 15 (context limit) REQUIRES Phase 03b/03c (ephemeral settings)
3. Phase 11 (parsing implementation) REQUIRES Phase 08 (reasoningUtils)

**Missing Dependency Documentation**:
- Phase 15 assumes Phase 03b/03c are complete but doesn't verify
- Phase 12 imports from reasoningUtils but Phase 06 doesn't create directory
- No verification that reasoningUtils functions are actually implemented before use

---

### 7. Technical Inconsistencies Between Phases

**Inconsistency 1: Settings Access Pattern**
- Phase 03b: Uses `options.settings['reasoning.enabled']` (bracket notation)
- Phase 12: Assumes `settings.get('reasoning.includeInContext')` (method call)
- Phase 15: Uses `this.runtimeContext.ephemerals.reasoning.includeInContext()` (ephemeral accessor)

**Resolution**: These are DIFFERENT layers:
- Phase 03b: ephemeral accessor reads from settings snapshot
- Phase 12: should use `options.settings.get()` not ephemeral accessor
- Phase 15: correctly uses ephemeral accessor (has runtime context)

**Inconsistency 2: StripPolicy Type Location**
- Phase 06: Exports `StripPolicy` type from reasoningUtils.ts
- Phase 07: Tests import `StripPolicy` from reasoningUtils.ts
- Phase 03b: Uses string literal `'all' | 'allButLast' | 'none'` in ephemeral accessor

**Resolution**: StripPolicy should be defined ONCE, imported everywhere. Currently defined in multiple places.

**Inconsistency 3: Token Counting Approach**
- Phase 08: reasoningUtils has `estimateThinkingTokens()` that uses tokenizer
- Phase 15: getEffectiveTokenCount() simplified version uses character count heuristic
- HistoryService: Has `estimateTokensForContents()` async method

**Resolution**: Pick one approach. Either:
- Use HistoryService.estimateTokensForContents() (async, accurate)
- Use reasoningUtils.estimateThinkingTokens() (sync, less accurate)
- Use character count heuristic (sync, least accurate but fast)

---

## Utility Function Integration

### Question: Are utility functions properly integrated into providers?

**reasoningUtils.ts Functions** (from Phase 06):
1. `extractThinkingBlocks(content: IContent): ThinkingBlock[]`
2. `filterThinkingForContext(contents: IContent[], policy: StripPolicy): IContent[]`
3. `thinkingToReasoningField(blocks: ThinkingBlock[]): string | undefined`
4. `estimateThinkingTokens(blocks: ThinkingBlock[]): number`
5. `removeThinkingFromContent(content: IContent): IContent`

**Usage in OpenAIProvider** (Phase 11, 14):
- ✅ `filterThinkingForContext()` - called in buildMessagesWithReasoning (Phase 14)
- ✅ `extractThinkingBlocks()` - called in buildMessagesWithReasoning (Phase 14)
- ✅ `thinkingToReasoningField()` - called in buildMessagesWithReasoning (Phase 14)
- ❌ `estimateThinkingTokens()` - NOT used in OpenAIProvider
- ❌ `removeThinkingFromContent()` - NOT used in OpenAIProvider

**Usage in geminiChat.ts** (Phase 15):
- ✅ `filterThinkingForContext()` - mentioned in pseudocode line 116
- ❌ `removeThinkingFromContent()` - used in simplified version but not full version
- ❌ `estimateThinkingTokens()` - NOT used in either version

**Missing Integration**:
- `estimateThinkingTokens()` is defined but never called
- `removeThinkingFromContent()` is helper for other functions, but should it be used in Phase 15?

**Recommendation**:
- Clarify which functions are public API vs internal helpers
- Remove unused functions OR document where they'll be used in future phases

---

## Recommendations

### Immediate Actions (BEFORE starting implementation):

1. **HALT Implementation** - Do not proceed until gaps are resolved

2. **Fix GAP-1** - Update all provider-side setting access to use `options.settings.get()` pattern
   - Update Phase 12, 13, 14
   - Update pseudocode in `openai-provider-reasoning.md`

3. **Fix GAP-2** - Add explicit verification that Phase 03b/03c complete before Phase 15
   - Add test: `grep -A 10 "reasoning:" packages/core/src/runtime/AgentRuntimeContext.ts`
   - Verify 7 methods exist in ephemerals.reasoning

4. **Fix GAP-3** - Verify settings flow from CLI to ephemerals
   - Add integration test in Phase 03c
   - Test: `/set reasoning.enabled true` → verify `ephemerals.reasoning.enabled()` returns true

5. **Fix GAP-4** - Add concrete modification points for token counting
   - Provide exact line numbers for geminiChat.ts changes
   - Document which methods need effective count vs raw count
   - Add grep commands to find all modification points

6. **Fix GAP-5** - Add directory creation to Phase 06
   - `mkdir -p packages/core/src/providers/reasoning/`
   - Verify imports resolve after Phase 06

7. **Fix GAP-6** - Verify ThinkingBlock backward compatibility
   - Grep for existing ThinkingBlock creation
   - Test Gemini provider still works after interface change

8. **Fix GAP-7** - Choose ONE token counting approach
   - Remove the other implementation
   - Update verification to match chosen approach
   - Remove TODO markers from chosen implementation

### Medium-Term Improvements:

9. **Consolidate StripPolicy Type** - Define once, import everywhere

10. **Document Settings Flow** - Add architecture diagram showing setting propagation

11. **Add Missing Error Scenarios** - Document behavior for:
    - Invalid stripFromContext value
    - Empty ThinkingBlock.thought
    - Malformed reasoning_content

12. **Performance Testing** - If using full effective count calculation:
    - Benchmark with 100K token conversations
    - Verify no performance regression

### Long-Term Considerations:

13. **Consider Caching** - Effective token count could be cached and invalidated on history change

14. **Consider Tracking** - Track thinking tokens separately in HistoryService for O(1) effective count

15. **UI Rendering** - Phase 16 mentions E2E tests but UI rendering is "out of scope" - clarify

---

## Conclusion

**Overall Assessment**: The plan demonstrates strong TDD methodology and thorough requirement traceability. However, it contains fundamental misunderstandings of:
1. How providers access settings (GAP-1)
2. How runtime context flows through the system (GAP-2)
3. The actual implementation details of token counting (GAP-4, GAP-7)

**Risk Level**: HIGH - Implementation will fail without addressing gaps

**Recommendation**: Revise plan to fix all 7 critical gaps before implementation. Estimate 2-4 hours of plan revision work.

**Positive Aspects**:
- ✅ Excellent requirement traceability
- ✅ Thorough verification steps in each phase
- ✅ Good pseudocode documentation
- ✅ Comprehensive edge case analysis
- ✅ Strong TDD structure with stub → test → implement pattern

**Critical Issues**:
- ❌ Provider setting access pattern is wrong
- ❌ Token counting integration is unclear
- ❌ Missing directory creation step
- ❌ Contradictory token counting implementations
- ❌ Settings flow not verified end-to-end

---

## Appendix: Verification Checklist for Plan Revision

After addressing gaps, verify:

- [ ] GAP-1 fixed: All provider setting access uses `options.settings.get()` pattern
- [ ] GAP-2 fixed: Phase 15 verification confirms ephemerals.reasoning exists
- [ ] GAP-3 fixed: Integration test verifies `/set` → ephemerals flow
- [ ] GAP-4 fixed: Exact line numbers provided for geminiChat.ts modifications
- [ ] GAP-5 fixed: `mkdir -p` command added to Phase 06
- [ ] GAP-6 fixed: Existing ThinkingBlock creation sites verified
- [ ] GAP-7 fixed: ONE token counting approach chosen, other removed
- [ ] StripPolicy type consolidated to single definition
- [ ] Settings flow diagram added to specification.md
- [ ] Performance considerations documented for chosen approach
- [ ] All pseudocode updated to reflect actual parameter passing
- [ ] All verification commands tested and confirmed working

Once checklist complete, plan is ready for implementation.
