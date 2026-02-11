# Phase 02: Types & Constants

## Phase ID

`PLAN-20260211-COMPRESSION.P02`

## Prerequisites

- Required: Phase 01 (preflight) completed
- Verification: Preflight verification gate passed
- Expected: All type assumptions confirmed, blocking issues resolved

## Requirements Implemented (Expanded)

### REQ-CS-001.1: Strategy Interface

**Full Text**: The system shall define a `CompressionStrategy` interface with a `name` property (typed as `CompressionStrategyName`), a `requiresLLM` property, and a `compress(context)` method that accepts a `CompressionContext` and returns a `CompressionResult`.
**Behavior**:
- GIVEN: A developer needs to implement a compression strategy
- WHEN: They implement the `CompressionStrategy` interface
- THEN: TypeScript enforces `name: CompressionStrategyName`, `requiresLLM: boolean`, and `compress(context: CompressionContext): Promise<CompressionResult>`
**Why This Matters**: The interface is the contract that all strategies must follow — without it, the factory and dispatcher have no type safety.

### REQ-CS-001.4: Compression Result Metadata

**Full Text**: The system shall include metadata in every `CompressionResult` containing: original message count, compressed message count, strategy used, whether an LLM call was made, and (where applicable) counts of top-preserved, bottom-preserved, and middle-compressed messages.
**Behavior**:
- GIVEN: A strategy completes compression
- WHEN: It returns a `CompressionResult`
- THEN: The `metadata` field contains `originalMessageCount`, `compressedMessageCount`, `strategyUsed`, `llmCallMade`, and optional `topPreserved`, `bottomPreserved`, `middleCompressed`
**Why This Matters**: Metadata enables logging, debugging, and future telemetry of compression effectiveness.

### REQ-CS-001.5: Centralized Strategy Names

**Full Text**: The system shall define strategy names as a single `const COMPRESSION_STRATEGIES` tuple. The `CompressionStrategyName` type, settings registry `enumValues`, and factory validation shall all derive from this constant. Strategy name strings shall not be duplicated across modules.
**Behavior**:
- GIVEN: `COMPRESSION_STRATEGIES` is defined as `['middle-out', 'top-down-truncation'] as const`
- WHEN: Any module needs strategy names (types, settings, factory)
- THEN: It imports and derives from this single constant — never hardcodes strategy strings
**Why This Matters**: Prevents drift between type definitions, settings, and factory. Adding a new strategy means changing one line.

### REQ-CS-001.6: Strategy Context Boundary

**Full Text**: The `CompressionContext` shall not include the `HistoryService` instance. Strategies receive immutable inputs (history snapshot, token counts, settings, provider resolver, prompt resolver) and return a `CompressionResult`. The dispatcher owns all history service mutation (locking, clearing, adding).
**Behavior**:
- GIVEN: A strategy's `compress()` method is called
- WHEN: It needs to work with history
- THEN: It uses `context.history` (read-only array) and `context.estimateTokens()` (read-only function), NOT `historyService.add()` / `historyService.clear()`
**Why This Matters**: Strategies that mutate history directly would create race conditions and break the compression lock semantics.

### REQ-CS-010.3: CompressionStrategyName

**Full Text**: The `CompressionStrategyName` type shall be derived from the `COMPRESSION_STRATEGIES` const tuple, not independently declared as a string union.
**Behavior**:
- GIVEN: `COMPRESSION_STRATEGIES = ['middle-out', 'top-down-truncation'] as const`
- WHEN: `CompressionStrategyName` is used anywhere
- THEN: It equals `(typeof COMPRESSION_STRATEGIES)[number]`, not a manually written `'middle-out' | 'top-down-truncation'`
**Why This Matters**: Single source of truth — if we add `'sliding-window'` to the tuple, the type automatically includes it.

## Implementation Tasks

### Files to Create

- `packages/core/src/core/compression/types.ts`
  - MUST include: `@plan PLAN-20260211-COMPRESSION.P02`
  - MUST include: `@requirement REQ-CS-001.1, REQ-CS-001.4, REQ-CS-001.5, REQ-CS-001.6, REQ-CS-010.3`
  - Contents:
    - `COMPRESSION_STRATEGIES` const tuple
    - `CompressionStrategyName` derived type
    - `CompressionStrategy` interface
    - `CompressionContext` interface (NO `historyService`) — all fields MUST use `readonly` modifiers:
      ```typescript
      export interface CompressionContext {
        readonly history: readonly IContent[];
        readonly runtimeContext: AgentRuntimeContext;
        readonly runtimeState: AgentRuntimeState;
        readonly estimateTokens: (contents: readonly IContent[]) => Promise<number>;
        readonly currentTokenCount: number;
        readonly logger: Logger;
        readonly resolveProvider: (profileName?: string) => IProvider;
        readonly promptResolver: PromptResolver;
        readonly promptContext: Readonly<Partial<PromptContext>>;
        readonly promptId: string;
      }
      ```
    - `CompressionResult` interface with `metadata`
    - Typed error classes: `CompressionStrategyError` (base), with subclasses or specific constructors for unknown strategy, prompt resolution failure, and execution failure. Each should include actionable context (strategy name, profile name, etc.)

- `packages/core/src/core/compression/index.ts`
  - Barrel export file for the compression module

### Files to Modify

- None in this phase (pure new types, no integration yet)

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-COMPRESSION.P02
 * @requirement REQ-CS-001.1, REQ-CS-001.5, REQ-CS-001.6, REQ-CS-010.3
 */
```

## Verification Commands

```bash
# Check plan markers exist
grep -r "@plan PLAN-20260211-COMPRESSION.P02" packages/core/src/core/compression/
# Expected: 2+ occurrences

# Check types compile
npm run typecheck

# Verify COMPRESSION_STRATEGIES is a const tuple
grep "COMPRESSION_STRATEGIES.*as const" packages/core/src/core/compression/types.ts

# Verify CompressionStrategyName is derived
grep "typeof COMPRESSION_STRATEGIES" packages/core/src/core/compression/types.ts

# Verify no historyService in CompressionContext
grep "historyService" packages/core/src/core/compression/types.ts
# Expected: 0 matches
```

## Success Criteria

- `types.ts` compiles with strict TypeScript
- `CompressionStrategyName` is derived from `COMPRESSION_STRATEGIES` tuple
- `CompressionContext` has `estimateTokens` and `currentTokenCount` but NOT `historyService`
- All `CompressionContext` fields are `readonly`; `history` uses `readonly IContent[]`
- `CompressionResult.metadata` has all required fields
- `CompressionStrategyError` base class and specific subclasses are defined with actionable context fields
- Barrel export works: `import { CompressionStrategy, COMPRESSION_STRATEGIES } from './compression/index.js'`

## Failure Recovery

```bash
git checkout -- packages/core/src/core/compression/
```

## Phase Completion Marker

Create: `project-plans/issue170/.completed/P02.md`
Contents:
```
Phase: P02
Completed: [timestamp]
Files Created: [list]
Files Modified: [list]
Tests Added: [count]
Verification: [paste verification command outputs]
```
