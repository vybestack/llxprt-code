# Phase 06: reasoningUtils Stub

## Phase ID

`PLAN-20251202-THINKING.P06`

## Prerequisites

- Required: Phase 05a completed
- Verification: `cat project-plans/20251202thinking/.completed/P05a.md`
- Expected: ThinkingBlock interface complete with sourceField and signature

## Requirements Implemented (Expanded)

### REQ-THINK-002: Reasoning Utility Functions

**Full Text**: Utility functions for reasoning/thinking block manipulation
**Behavior**:

- GIVEN: IContent with ThinkingBlocks
- WHEN: Calling utility functions
- THEN: Blocks are extracted, filtered, converted as needed

**Why This Matters**: Centralized utilities prevent code duplication across providers

## Implementation Tasks

### Files to Create

#### GAP 9 RESOLUTION: Verify Directory Structure Before Implementation

**CRITICAL: Run these verification commands BEFORE creating any files**

```bash
# 1. Verify parent directory exists
ls -ld packages/core/src/providers/
# Expected: Directory exists (should show drwxr-xr-x or similar)
# If fails: Parent directory structure is wrong - STOP and investigate

# 2. Check if reasoning directory already exists
ls -ld packages/core/src/providers/reasoning/ 2>&1
# Expected: "No such file or directory" (we're about to create it)
# If exists: Review existing contents before proceeding

# 3. Verify IContent.ts location (for import validation)
ls -la packages/core/src/services/history/IContent.ts
# Expected: File exists
# If fails: Import path in reasoningUtils.ts will be wrong - STOP

# 4. Verify OpenAIProvider.ts location (for future import validation)
ls -la packages/core/src/providers/openai/OpenAIProvider.ts
# Expected: File exists
# If fails: Provider can't import reasoningUtils - STOP
```

**Only proceed if all verifications pass. If any fail, update the plan with correct paths.**

#### Create Directory (After Verification)

```bash
# Create the reasoning directory if it doesn't exist
mkdir -p packages/core/src/providers/reasoning

# Verify creation succeeded
ls -ld packages/core/src/providers/reasoning/
# Expected: Directory exists
```

#### `packages/core/src/providers/reasoning/reasoningUtils.ts`

**Import Path Verification** (GAP 9 FIX):
```bash
# Before writing the file, verify the import path is correct:
# From: packages/core/src/providers/reasoning/reasoningUtils.ts
# To:   packages/core/src/services/history/IContent.ts
#
# Path calculation:
# - Up 2 levels: ../../
# - Into services/history/: services/history/
# - File: IContent.ts
#
# Result: ../../services/history/IContent.js (note .js extension for ESM)

# Verification command:
ls packages/core/src/services/history/IContent.ts
# Expected: File exists
```

```typescript
/**
 * Utility functions for handling reasoning/thinking content across providers.
 *
 * @plan PLAN-20251202-THINKING.P06
 * @requirement REQ-THINK-002
 */

import type { IContent, ThinkingBlock, ContentBlock } from '../../services/history/IContent.js';

/** Policy for stripping thinking blocks from context */
export type StripPolicy = 'all' | 'allButLast' | 'none';

/**
 * Extract all ThinkingBlock instances from an IContent.
 *
 * @plan PLAN-20251202-THINKING.P06
 * @requirement REQ-THINK-002.1
 * @pseudocode lines 10-18
 */
export function extractThinkingBlocks(content: IContent): ThinkingBlock[] {
  // STUB: Will be implemented in P08
  throw new Error('Not implemented: extractThinkingBlocks');
}

/**
 * Filter thinking blocks from contents based on strip policy.
 *
 * @plan PLAN-20251202-THINKING.P06
 * @requirement REQ-THINK-002.2
 * @pseudocode lines 30-50
 */
export function filterThinkingForContext(
  contents: IContent[],
  policy: StripPolicy
): IContent[] {
  // STUB: Will be implemented in P08
  throw new Error('Not implemented: filterThinkingForContext');
}

/**
 * Convert ThinkingBlocks to a single reasoning_content string.
 *
 * @plan PLAN-20251202-THINKING.P06
 * @requirement REQ-THINK-002.3
 * @pseudocode lines 70-77
 */
export function thinkingToReasoningField(blocks: ThinkingBlock[]): string | undefined {
  // STUB: Will be implemented in P08
  throw new Error('Not implemented: thinkingToReasoningField');
}

/**
 * Estimate token count for thinking blocks.
 *
 * @plan PLAN-20251202-THINKING.P06
 * @requirement REQ-THINK-002.4
 * @pseudocode lines 80-86
 */
export function estimateThinkingTokens(blocks: ThinkingBlock[]): number {
  // STUB: Will be implemented in P08
  throw new Error('Not implemented: estimateThinkingTokens');
}

/**
 * Helper: Remove thinking blocks from a single IContent.
 *
 * @plan PLAN-20251202-THINKING.P06
 * @pseudocode lines 60-65
 */
export function removeThinkingFromContent(content: IContent): IContent {
  // STUB: Will be implemented in P08
  throw new Error('Not implemented: removeThinkingFromContent');
}
```

### Required Code Markers

Every function must have:

```typescript
/**
 * @plan PLAN-20251202-THINKING.P06
 * @requirement REQ-THINK-002.X
 * @pseudocode lines X-Y
 */
```

## Verification Commands

### Automated Checks

```bash
# Check directory exists
ls -ld packages/core/src/providers/reasoning/
# Expected: Directory exists

# Check file exists
ls packages/core/src/providers/reasoning/reasoningUtils.ts

# Check plan markers
grep -c "@plan.*THINKING.P06" packages/core/src/providers/reasoning/reasoningUtils.ts
# Expected: 5+ occurrences

# Check all functions are exported
grep "^export function" packages/core/src/providers/reasoning/reasoningUtils.ts
# Expected: 5 functions

# Check TypeScript compiles (stubs are valid)
npm run typecheck
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Run ALL of these checks - if ANY match, phase FAILS:

# Check stubs properly throw NotImplementedError
grep -rn "throw new Error.*Not implemented" packages/core/src/providers/reasoning/reasoningUtils.ts
# Expected: 5 matches (one for each function stub)

# Verify no premature implementation (stubs should only throw)
grep -A 5 "export function" packages/core/src/providers/reasoning/reasoningUtils.ts | grep -v "throw new Error" | grep -v "function\|^--$\|\/\/"
# Expected: Only function signatures and throw statements

# Check for TODO/FIXME markers
grep -rn -E "(TODO|FIXME|HACK|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/providers/reasoning/reasoningUtils.ts | grep -v ".test.ts"
# Expected: No matches (stubs don't need TODOs - implementation is P08)
```

### Semantic Verification Checklist (MANDATORY)

**Go beyond markers. Actually verify the behavior exists.**

#### Behavioral Verification Questions (answer ALL before proceeding)

1. **Does the code DO what the requirement says?**
   - [ ] I read REQ-THINK-002.1 and verified extractThinkingBlocks stub signature is correct
   - [ ] I read REQ-THINK-002.2 and verified filterThinkingForContext accepts StripPolicy
   - [ ] I read REQ-THINK-002.3 and verified thinkingToReasoningField returns string | undefined
   - [ ] I read REQ-THINK-002.4 and verified estimateThinkingTokens returns number
   - [ ] All stubs have correct TypeScript signatures matching pseudocode

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed - stubs correctly throw "Not implemented"
   - [ ] No logic beyond throw statement (premature implementation)
   - [ ] StripPolicy type exported for use by other modules
   - [ ] No "will be implemented" comments needed (that's what stubs are for)

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests will fail with "Not implemented" error (correct TDD state)
   - [ ] Tests verify function signature exists and is callable
   - [ ] Tests have assertions for expected behavior (will pass in P08)

4. **Is the feature REACHABLE by users?**
   - [ ] Functions exported from reasoningUtils.ts
   - [ ] File location correct: packages/core/src/providers/reasoning/
   - [ ] Can be imported by OpenAIProvider in P09/P11
   - [ ] No circular dependencies preventing import

5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] [gap 1]
   - [ ] [gap 2]

#### Feature Actually Works

```bash
# Manual verification: Show stub functions exist with correct signatures
grep "^export function" packages/core/src/providers/reasoning/reasoningUtils.ts
# Expected: All 5 functions listed

# Verify stubs throw correctly
grep -A 2 "export function" packages/core/src/providers/reasoning/reasoningUtils.ts | grep "throw new Error"
# Expected: 5 throw statements
```

#### Stub Quality Verified

- [ ] All functions have JSDoc with @plan markers
- [ ] All functions have @requirement markers
- [ ] All functions have @pseudocode line references
- [ ] Stubs are minimalist (just signature + throw)
- [ ] TypeScript types are specific, not 'any'

### Structural Verification Checklist

- [ ] File created at correct path
- [ ] All 5 functions stubbed
- [ ] All functions have plan markers
- [ ] All functions have requirement markers
- [ ] All functions have pseudocode references
- [ ] TypeScript compiles
- [ ] Stubs throw "Not implemented"

## Success Criteria

- All stub functions exist with correct signatures
- Plan markers present
- TypeScript compiles
- Ready for TDD tests in P07

## Failure Recovery

If this phase fails:

1. `rm -rf packages/core/src/providers/reasoning/`
2. Review ThinkingBlock interface
3. Re-attempt

## Phase Completion Marker

Create: `project-plans/20251202thinking/.completed/P06.md`
