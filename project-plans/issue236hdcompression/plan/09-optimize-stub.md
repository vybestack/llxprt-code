# Phase 09: HighDensityStrategy — Optimize Stub

## Phase ID

`PLAN-20260211-HIGHDENSITY.P09`

## Prerequisites

- Required: Phase 08 completed
- Verification: `grep -r "@plan:PLAN-20260211-HIGHDENSITY.P08" packages/core/src/services/history/HistoryService.ts | wc -l` → ≥ 1
- Expected files from previous phase:
  - `packages/core/src/services/history/HistoryService.ts` (applyDensityResult, getRawHistory, recalculateTotalTokens implemented)
  - `packages/core/src/services/history/__tests__/density-history.test.ts` (all passing)
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

### REQ-HD-004.3: Strategy Properties

**Full Text**: The `HighDensityStrategy` shall declare `name` as `'high-density'`, `requiresLLM` as `false`, and `trigger` as `{ mode: 'continuous', defaultThreshold: 0.85 }`.
**Behavior**:
- GIVEN: A `HighDensityStrategy` instance
- WHEN: Its properties are inspected
- THEN: `name` is `'high-density'`, `requiresLLM` is `false`, `trigger.mode` is `'continuous'`, `trigger.defaultThreshold` is `0.85`
**Why This Matters**: The orchestrator uses these properties to determine when and how to invoke the strategy. `continuous` mode means `optimize()` runs before every threshold check.

### REQ-HD-005.1: Stale Read Identification (stub)

**Full Text**: When `readWritePruning` is enabled in `DensityConfig`, the `optimize()` method shall identify tool calls where a file was read by a read tool and subsequently written by a write tool later in history.
**Behavior**:
- GIVEN: A history containing read and write tool calls for the same file
- WHEN: `optimize()` is called with `readWritePruning: true`
- THEN: Stale reads (those followed by writes) are identified for removal
**Why This Matters**: Stale file reads consume significant context tokens for content that is now outdated. Removing them reclaims space.

### REQ-HD-006.1: Inclusion Detection (stub)

**Full Text**: When `fileDedupe` is enabled in `DensityConfig`, the `optimize()` method shall identify `@` file inclusions in human messages by matching the `--- <filepath> ---` ... `--- End of content ---` delimiter pattern in text blocks.
**Behavior**:
- GIVEN: Human messages containing `@` file inclusions
- WHEN: `optimize()` is called with `fileDedupe: true`
- THEN: Duplicate file inclusions are identified
**Why This Matters**: Users frequently re-include the same file via `@` syntax. Deduplication removes redundant copies.

### REQ-HD-007.1: Recency Window (stub)

**Full Text**: When `recencyPruning` is enabled in `DensityConfig`, the `optimize()` method shall count tool responses per tool name walking history in reverse. For each tool type, results beyond the `recencyRetention` count shall have their response content replaced with a pointer string.
**Behavior**:
- GIVEN: History with many tool responses of the same type
- WHEN: `optimize()` is called with `recencyPruning: true`
- THEN: Old results beyond the retention window are replaced with pointer strings
**Why This Matters**: Most tool results become stale over time. Keeping only the N most recent per tool type preserves context relevance.

## Implementation Tasks

### Files to Create

- `packages/core/src/core/compression/HighDensityStrategy.ts`
  - MUST include: `@plan:PLAN-20260211-HIGHDENSITY.P09`
  - MUST include: `@requirement:REQ-HD-004.3, REQ-HD-005.1, REQ-HD-006.1, REQ-HD-007.1`
  - MUST include: `@pseudocode high-density-optimize.md`

### Files to Modify

- `packages/core/src/core/compression/index.ts`
  - ADD export: `HighDensityStrategy`
  - ADD comment: `@plan:PLAN-20260211-HIGHDENSITY.P09`

### Stub Outline

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P09
 * @requirement REQ-HD-004.3
 * @pseudocode high-density-optimize.md lines 20-53
 */
export class HighDensityStrategy implements CompressionStrategy {
  readonly name = 'high-density' as const;
  readonly requiresLLM = false;
  readonly trigger: StrategyTrigger = { mode: 'continuous', defaultThreshold: 0.85 };

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P09
   * @requirement REQ-HD-005.1, REQ-HD-006.1, REQ-HD-007.1
   * @pseudocode high-density-optimize.md lines 20-53
   */
  optimize(history: readonly IContent[], config: DensityConfig): DensityResult {
    throw new Error('NotYetImplemented: optimize');
  }

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P09
   * @pseudocode high-density-compress.md lines 10-91
   */
  async compress(context: CompressionContext): Promise<CompressionResult> {
    throw new Error('NotYetImplemented: compress');
  }

  /**
   * @pseudocode high-density-optimize.md lines 60-209
   */
  private pruneReadWritePairs(
    history: readonly IContent[],
    config: DensityConfig,
  ): { removals: Set<number>; replacements: Map<number, IContent>; prunedCount: number } {
    throw new Error('NotYetImplemented: pruneReadWritePairs');
  }

  /**
   * @pseudocode high-density-optimize.md lines 280-359
   */
  private deduplicateFileInclusions(
    history: readonly IContent[],
    config: DensityConfig,
    existingRemovals: Set<number>,
  ): { replacements: Map<number, IContent>; prunedCount: number } {
    throw new Error('NotYetImplemented: deduplicateFileInclusions');
  }

  /**
   * @pseudocode high-density-optimize.md lines 400-464
   */
  private pruneByRecency(
    history: readonly IContent[],
    config: DensityConfig,
    existingRemovals: Set<number>,
  ): { replacements: Map<number, IContent>; prunedCount: number } {
    throw new Error('NotYetImplemented: pruneByRecency');
  }
}
```

### Constants (from pseudocode lines 10–15)

```typescript
const READ_TOOLS = ['read_file', 'read_line_range', 'read_many_files', 'ast_read_file'] as const;
const WRITE_TOOLS = ['write_file', 'ast_edit', 'replace', 'insert_at_line', 'delete_line_range'] as const;
const PRUNED_POINTER = '[Result pruned — re-run tool to retrieve]';
const FILE_INCLUSION_OPEN_REGEX = /^--- (.+) ---$/m;
const FILE_INCLUSION_CLOSE = '--- End of content ---';
```

### Stub Rules

- `optimize()` — throws NotYetImplemented. Complex multi-phase pruning logic cannot be trivially stubbed.
- `compress()` — throws NotYetImplemented. Will be implemented in Phase 14.
- `pruneReadWritePairs()` — throws NotYetImplemented. Private, called by `optimize()`.
- `deduplicateFileInclusions()` — throws NotYetImplemented. Private, called by `optimize()`.
- `pruneByRecency()` — throws NotYetImplemented. Private, called by `optimize()`.
- Constants MUST be defined in this phase (they establish the contract).
- NO implementation logic — just class skeleton, method signatures, throws.

### Import Requirements

```typescript
import * as path from 'node:path';
import type { IContent } from '../../services/history/IContent.js';
import type {
  CompressionStrategy,
  CompressionContext,
  CompressionResult,
  DensityResult,
  DensityConfig,
  DensityResultMetadata,
  StrategyTrigger,
} from './types.js';
```

## Verification Commands

```bash
# 1. TypeScript compiles cleanly
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. File created
test -f packages/core/src/core/compression/HighDensityStrategy.ts && echo "PASS" || echo "FAIL"

# 3. Class exported
grep "export class HighDensityStrategy" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: 1 match

# 4. Strategy properties present
grep "name.*=.*'high-density'" packages/core/src/core/compression/HighDensityStrategy.ts
grep "requiresLLM.*=.*false" packages/core/src/core/compression/HighDensityStrategy.ts
grep "mode.*:.*'continuous'" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: 1 match each

# 5. All method stubs present
grep -c "NotYetImplemented" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: 5 (optimize, compress, pruneReadWritePairs, deduplicateFileInclusions, pruneByRecency)

# 6. Constants defined
grep "READ_TOOLS" packages/core/src/core/compression/HighDensityStrategy.ts
grep "WRITE_TOOLS" packages/core/src/core/compression/HighDensityStrategy.ts
grep "PRUNED_POINTER" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: 1 match each

# 7. Plan markers present
grep -c "@plan.*HIGHDENSITY.P09" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: ≥ 2

# 8. Exported from index
grep "HighDensityStrategy" packages/core/src/core/compression/index.ts
# Expected: ≥ 1

# 9. Existing tests still pass
npm run test -- --run 2>&1 | tail -10
# Expected: All pass
```

## Success Criteria

- `npx tsc --noEmit` passes with 0 errors
- `HighDensityStrategy.ts` created with class skeleton
- All 5 method stubs throw NotYetImplemented
- Strategy properties: name='high-density', requiresLLM=false, trigger.mode='continuous'
- Constants defined (READ_TOOLS, WRITE_TOOLS, PRUNED_POINTER, etc.)
- Exported from compression/index.ts
- Plan and requirement markers present
- Existing tests pass unchanged

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/compression/HighDensityStrategy.ts`
2. `git checkout -- packages/core/src/core/compression/index.ts`
3. Cannot proceed to Phase 10 until fixed

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P09.md`
Contents:
```markdown
Phase: P09
Completed: [timestamp]
Files Created:
  - packages/core/src/core/compression/HighDensityStrategy.ts [N lines]
Files Modified:
  - packages/core/src/core/compression/index.ts [+M lines]
Tests Added: 0 (stub phase)
Verification: [paste verification output]
```
