# Phase 15: Context Limit Integration

## Phase ID

`PLAN-20251202-THINKING.P15`

## Prerequisites

- Required: Phase 14a completed
- Required: Phase 03b completed (ephemeral settings for reasoning.*)
- Required: Phase 03c completed (ephemeral settings verification)
- Verification:
  ```bash
  cat project-plans/20251202thinking/.completed/P14a.md
  cat project-plans/20251202thinking/.completed/P03b.md
  cat project-plans/20251202thinking/.completed/P03c.md
  ```
- Expected: Message building complete with settings integration AND reasoning.* ephemeral settings accessible via runtimeContext.ephemerals

## Requirements Implemented (Expanded)

### REQ-THINK-005: Context Limit Handling

**Full Text**: Context calculations must account for reasoning tokens based on settings
**Behavior**:

- GIVEN: History with ThinkingBlocks and `reasoning.includeInContext=false`
- WHEN: Calculating context usage
- THEN: ThinkingBlock tokens are NOT counted (they won't be sent)

**Why This Matters**: Prevents premature compression when reasoning is stripped

### REQ-THINK-005.1: Effective Token Count

**Full Text**: Context usage display MUST reflect effective token count (after stripping)
**Behavior**:

- GIVEN: 100k tokens of content, 50k tokens of reasoning
- WHEN: includeInContext=false
- THEN: Display shows 100k, not 150k

### REQ-THINK-005.2: Compression Trigger

**Full Text**: Compression trigger MUST use effective token count, not raw count
**Behavior**:

- GIVEN: Context limit 150k, raw count 160k, effective count 100k
- WHEN: Evaluating compression need
- THEN: No compression triggered (effective under limit)

## Implementation Tasks

### Concrete File Locations (from codebase analysis)

#### Token Counting Locations

##### Primary: `packages/core/src/core/geminiChat.ts`

**How to Locate Functions** (use these grep commands to find exact line numbers):
```bash
# Find shouldCompress method - this is where compression decision happens
grep -n "shouldCompress(" packages/core/src/core/geminiChat.ts
# Expected: Shows definition around line ~1514 and call sites

# Find enforceContextWindow method - this enforces hard context limits
grep -n "enforceContextWindow(" packages/core/src/core/geminiChat.ts
# Expected: Shows definition around line ~1705 and call sites

# Find estimatePendingTokens method - this estimates tokens for new messages
grep -n "estimatePendingTokens(" packages/core/src/core/geminiChat.ts
# Expected: Shows definition around line ~1577 and call sites

# Find all places that call getTotalTokens (need to replace with effective count)
grep -n "getTotalTokens()" packages/core/src/core/geminiChat.ts
# Expected: Shows calls in shouldCompress and enforceContextWindow
```

1. **shouldCompress() method**
   **Current code pattern** (search for `this.historyService.getTotalTokens()` inside `shouldCompress`):
   ```typescript
   private shouldCompress(pendingTokens: number = 0): boolean {
     // ...
     const currentTokens =
       this.historyService.getTotalTokens() + Math.max(0, pendingTokens);
     const shouldCompress = currentTokens >= this.cachedCompressionThreshold;
   ```
   **Change**: Replace `getTotalTokens()` with effective token calculation:
   ```typescript
   const currentTokens =
     this.getEffectiveTokenCount() + Math.max(0, pendingTokens);
   ```

2. **enforceContextWindow() method**
   **Current code pattern** (search for `this.historyService.getTotalTokens()` inside `enforceContextWindow`):
   ```typescript
   private async enforceContextWindow(...): Promise<void> {
     // ...
     const projected =
       this.historyService.getTotalTokens() +
       Math.max(0, pendingTokens) +
       completionBudget;
   ```
   **Change**: Replace `getTotalTokens()` with effective token calculation:
   ```typescript
   const projected =
     this.getEffectiveTokenCount() +
     Math.max(0, pendingTokens) +
     completionBudget;
   ```

3. **estimatePendingTokens() method**
   **Current code pattern**:
   ```typescript
   private async estimatePendingTokens(contents: IContent[]): Promise<number> {
     return await this.historyService.estimateTokensForContents(contents, model);
   ```
   **Change**: Filter thinking blocks before estimation:
   ```typescript
   private async estimatePendingTokens(contents: IContent[]): Promise<number> {
     const includeInContext = this.runtimeContext.ephemerals.reasoning.includeInContext();
     const filteredContents = includeInContext ? contents : contents.map(c => removeThinkingFromContent(c));
     return await this.historyService.estimateTokensForContents(filteredContents, this.runtimeContext.state.model);
   ```

##### Secondary: `packages/core/src/services/history/HistoryService.ts`

**How to Locate HistoryService methods**:
```bash
# Find getTotalTokens method - returns raw token count
grep -n "getTotalTokens(" packages/core/src/services/history/HistoryService.ts
# Expected: Method definition showing it returns sum of all content tokens

# Find estimateTokensForContents method - estimates tokens for IContent array
grep -n "estimateTokensForContents(" packages/core/src/services/history/HistoryService.ts
# Expected: Method that estimates tokens for given contents

# Verify no reasoning/thinking logic in HistoryService (should be none)
grep -n -i "reasoning\|thinking" packages/core/src/services/history/HistoryService.ts
# Expected: No matches - HistoryService doesn't know about reasoning settings
```

**NOTE**: HistoryService does NOT need modification. Token counting should happen in geminiChat.ts which has access to settings via runtimeContext.ephemerals.

1. **getTotalTokens()** - Keep unchanged. This returns raw token count.

2. **estimateContentTokens()** - Keep unchanged. Thinking blocks are already counted when present.

#### Compression Trigger Locations

##### `packages/core/src/core/geminiChat.ts`

**How to Locate**:
```bash
# Find ensureCompressionBeforeSend method
grep -n "private async ensureCompressionBeforeSend" packages/core/src/core/geminiChat.ts

# Find getCompressionSplit method
grep -n "private getCompressionSplit" packages/core/src/core/geminiChat.ts
```

1. **ensureCompressionBeforeSend() method**
   Calls `shouldCompress()` which will use effective token count after modification.
   **No change needed** - inherits fix from shouldCompress().

2. **getCompressionSplit() method**
   Uses `historyService.getCurated()`.
   **No change needed** - compression operates on actual history, stripping happens before message building.

##### `packages/core/src/core/client.ts`

**How to Locate**:
```bash
# Find tryCompressChat method
grep -n "async tryCompressChat" packages/core/src/core/client.ts
```

1. **tryCompressChat() method**
   Manual compression trigger.
   **No change needed** - uses GeminiChat's compression logic which will use effective tokens.

#### Settings Access Pattern

Settings are accessed via `runtimeContext.ephemerals.reasoning.*()`:

```typescript
// In geminiChat.ts
const includeInContext = this.runtimeContext.ephemerals.reasoning.includeInContext();
const stripPolicy = this.runtimeContext.ephemerals.reasoning.stripFromContext();

// Calculate effective tokens
const effectiveTokens = includeInContext
  ? this.historyService.getTotalTokens()
  : this.historyService.getEffectiveTokens(stripPolicy);
```

### Files to Modify

#### GAP 7 RESOLUTION: getEffectiveTokenCount Location

**CRITICAL CLARIFICATION**: Add `getEffectiveTokenCount()` as a **PRIVATE METHOD in geminiChat.ts**, NOT in HistoryService.

**File Location**: `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/core/src/core/geminiChat.ts`

**Method Signature**:
```typescript
private getEffectiveTokenCount(): number
```

**Rationale**:
- geminiChat.ts has access to `runtimeContext.ephemerals.reasoning` settings
- HistoryService does NOT have access to settings and should remain stateless
- geminiChat already has methods like `shouldCompress()` that use history + settings
- This is a PRIVATE helper method used by compression logic, not a public API

**Verification of Location**:
```bash
# After implementation, verify the method exists in geminiChat.ts:
grep -n "private getEffectiveTokenCount" packages/core/src/core/geminiChat.ts
# Expected: Should show line number of method definition

# Verify it's NOT in HistoryService:
grep -n "getEffectiveTokenCount" packages/core/src/services/history/HistoryService.ts
# Expected: No matches
```

#### 1. `packages/core/src/core/geminiChat.ts`

Add new private method:

```typescript
/**
 * Calculate effective token count based on reasoning settings.
 * This accounts for whether reasoning will be included in API calls.
 *
 * @plan PLAN-20251202-THINKING.P15
 * @requirement REQ-THINK-005.1, REQ-THINK-005.2
 */
private getEffectiveTokenCount(): number {
  const includeInContext = this.runtimeContext.ephemerals.reasoning.includeInContext();
  const stripPolicy = this.runtimeContext.ephemerals.reasoning.stripFromContext();

  // If reasoning IS included in context, all tokens count
  if (includeInContext) {
    return this.historyService.getTotalTokens();
  }

  // If reasoning is NOT included, calculate actual reduction by:
  // 1. Get current history
  // 2. Extract thinking blocks that would be stripped
  // 3. Estimate their token count
  // 4. Subtract from total

  const allContents = this.historyService.getCurated();
  const rawTokens = this.historyService.getTotalTokens();

  // Apply strip policy to determine what would be removed
  // Import needed: extractThinkingBlocks, estimateThinkingTokens from reasoningUtils
  let thinkingTokensToStrip = 0;

  if (stripPolicy === 'all') {
    // Sum up all thinking tokens
    for (const content of allContents) {
      const thinkingBlocks = extractThinkingBlocks(content);
      thinkingTokensToStrip += estimateThinkingTokens(thinkingBlocks);
    }
  } else if (stripPolicy === 'allButLast') {
    // Find last content with thinking blocks
    const lastIndexWithThinking = allContents.map((c, i) =>
      ({ content: c, index: i })
    ).reverse().find(({ content }) =>
      extractThinkingBlocks(content).length > 0
    )?.index;

    // Strip thinking from all except that last one
    allContents.forEach((content, i) => {
      if (i !== lastIndexWithThinking) {
        const thinkingBlocks = extractThinkingBlocks(content);
        thinkingTokensToStrip += estimateThinkingTokens(thinkingBlocks);
      }
    });
  }
  // stripPolicy === 'none': no stripping, but includeInContext=false means they won't be sent
  // In this case, we still strip ALL thinking for effective count
  else {
    for (const content of allContents) {
      const thinkingBlocks = extractThinkingBlocks(content);
      thinkingTokensToStrip += estimateThinkingTokens(thinkingBlocks);
    }
  }

  return Math.max(0, rawTokens - thinkingTokensToStrip);
}
```

**Implementation Rationale**:
- **GAP 4 FIXED**: Uses actual calculation with extractThinkingBlocks and estimateThinkingTokens
- No longer relies on 20% heuristic - calculates exact thinking token count
- Respects stripFromContext policy to determine what gets excluded
- Handles all three policies: 'all', 'allButLast', 'none'
- Returns accurate effective token count for compression decisions

**Required Imports** (add to geminiChat.ts):
```typescript
import { extractThinkingBlocks, estimateThinkingTokens } from '../providers/reasoning/reasoningUtils.js';
```

### Update Compression Logic

Find where compression decision is made:

```typescript
// BEFORE: Used raw count
const currentTokens = getRawTokenCount(history);
if (currentTokens > compressionThreshold) {
  triggerCompression();
}

// AFTER: Use effective count
const settings = getEphemeralSettings();
const effectiveTokens = getEffectiveTokenCount(history, settings);
if (effectiveTokens > compressionThreshold) {
  triggerCompression();
}
```

### Update Display

Find where context usage is displayed:

```typescript
// Show effective count, not raw count
const effectiveTokens = getEffectiveTokenCount(history, settings);
display(`Context: ${effectiveTokens}/${contextLimit}`);
```

## Verification Commands

### Automated Checks

```bash
# Check effective token function exists
grep "getEffectiveTokenCount" packages/core/src/

# Check plan markers
grep "@plan.*THINKING.P15" packages/core/src/

# Check requirement markers
grep "@requirement.*REQ-THINK-005" packages/core/src/

# TypeScript compiles
npm run typecheck

# All tests pass
npm run test:ci
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Run ALL of these checks - if ANY match, phase FAILS:

# Check for TODO/FIXME/HACK markers in context limit changes
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/ | grep -i "effective.*token\|context.*limit\|compression.*trigger" | grep -v ".test.ts"
# Expected: No matches (or only in comments explaining WHY, not WHAT to do)

# Check for "cop-out" comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/ | grep -i "effective.*token\|reasoning.*token" | grep -v ".test.ts"
# Expected: No matches

# Verify effective count logic exists (not just placeholder)
grep -A 10 "getEffectiveTokenCount\|getEffectiveTokens" packages/core/src/ | grep -E "(filterThinkingForContext|removeThinkingFromContent|stripPolicy)"
# Expected: Matches showing actual filtering logic

# Check compression uses effective count, not raw count
grep -B 5 -A 5 "shouldCompress\|compressionThreshold" packages/core/src/core/geminiChat.ts | grep -E "(getEffectiveToken|reasoning)"
# Expected: Matches showing effective token calculation
```

### Tests to Add

```typescript
describe('getEffectiveTokenCount @plan:PLAN-20251202-THINKING.P15', () => {
  it('excludes thinking tokens when includeInContext=false', () => {
    const contents = [
      createAiContentWithThinking('Long thought...', 'Short answer'),
    ];
    const settings = { 'reasoning.includeInContext': false };

    const result = getEffectiveTokenCount(contents, settings);

    // Should only count 'Short answer', not 'Long thought...'
    expect(result).toBeLessThan(estimateTokensForContents(contents));
  });

  it('includes thinking tokens when includeInContext=true', () => {
    const contents = [
      createAiContentWithThinking('Long thought...', 'Short answer'),
    ];
    const settings = {
      'reasoning.includeInContext': true,
      'reasoning.stripFromContext': 'none',
    };

    const result = getEffectiveTokenCount(contents, settings);

    // Should count everything
    expect(result).toBe(estimateTokensForContents(contents));
  });

  it('applies strip policy before counting', () => {
    const contents = [
      createAiContentWithThinking('T1', 'R1'),
      createAiContentWithThinking('T2', 'R2'),
    ];
    const settings = {
      'reasoning.includeInContext': true,
      'reasoning.stripFromContext': 'allButLast',
    };

    const result = getEffectiveTokenCount(contents, settings);

    // Should not count T1, only T2
    // (approximate check)
  });
});
```

## Semantic Verification Checklist

- [ ] Effective count excludes thinking when includeInContext=false
- [ ] Effective count respects stripFromContext policy
- [ ] Compression uses effective count
- [ ] Display shows effective count
- [ ] No breaking changes to non-reasoning scenarios

## Success Criteria

- Context limit calculation uses effective token count
- Compression triggers based on effective count
- Display shows effective count
- All existing functionality preserved

## Failure Recovery

If this phase fails:

1. Revert context calculation changes
2. Ensure existing compression logic still works
3. Re-attempt with smaller scope

## Phase Completion Marker

Create: `project-plans/20251202thinking/.completed/P15.md`
