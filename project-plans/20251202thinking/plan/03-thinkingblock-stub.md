# Phase 03: ThinkingBlock Interface Enhancement

## Phase ID

`PLAN-20251202-THINKING.P03`

## Prerequisites

- Required: Phase 00a (Preflight Verification) completed
- Verification: `cat project-plans/20251202thinking/.completed/P00a.md`
- Expected: Preflight verification passed

## Requirements Implemented (Expanded)

### REQ-THINK-001.1: sourceField Property

**Full Text**: ThinkingBlock MUST include sourceField property for round-trip serialization
**Behavior**:

- GIVEN: An API response with `reasoning_content` field
- WHEN: Parsed into ThinkingBlock
- THEN: ThinkingBlock has `sourceField: 'reasoning_content'` to enable correct egress formatting

**Why This Matters**: Different APIs use different field names (reasoning_content, thinking, thought). We need to track the source to serialize back correctly.

### REQ-THINK-001.2: signature Property

**Full Text**: ThinkingBlock MUST include optional signature property for Anthropic compatibility
**Behavior**:

- GIVEN: An Anthropic API response with thinking block signature
- WHEN: Parsed into ThinkingBlock
- THEN: ThinkingBlock preserves the signature for round-trip

**Why This Matters**: Anthropic's extended thinking feature requires passing back the signature.

## Implementation Tasks

### Files to Modify

#### `packages/core/src/services/history/IContent.ts`

Current ThinkingBlock (lines ~175-183):

```typescript
interface ThinkingBlock {
  type: 'thinking';
  thought: string;
  isHidden?: boolean;
}
```

Modified ThinkingBlock:

```typescript
/**
 * @plan PLAN-20251202-THINKING.P03
 * @requirement REQ-THINK-001.1, REQ-THINK-001.2
 */
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

### Required Code Markers

```typescript
/**
 * @plan PLAN-20251202-THINKING.P03
 * @requirement REQ-THINK-001.1, REQ-THINK-001.2
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan.*THINKING.P03" packages/core/src/services/history/IContent.ts
# Expected: 1 occurrence

# Check requirement markers
grep -r "@requirement.*REQ-THINK-001" packages/core/src/services/history/IContent.ts
# Expected: 1 occurrence

# Check sourceField property exists
grep "sourceField" packages/core/src/services/history/IContent.ts
# Expected: Match showing the new property

# Check signature property exists
grep "signature" packages/core/src/services/history/IContent.ts
# Expected: Match showing the new property

# Typecheck passes
npm run typecheck
# Expected: No errors
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Run ALL of these checks - if ANY match, phase FAILS:

# Check for TODO/FIXME/HACK markers left in implementation
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/services/history/IContent.ts | grep -v ".test.ts"
# Expected: No matches (or only in comments explaining WHY, not WHAT to do)

# Check for "cop-out" comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/services/history/IContent.ts | grep -v ".test.ts"
# Expected: No matches

# Check interface is not empty
grep -A 10 "interface ThinkingBlock" packages/core/src/services/history/IContent.ts
# Expected: Properties sourceField and signature are present
```

### Semantic Verification Checklist (MANDATORY)

**Go beyond markers. Actually verify the behavior exists.**

#### Behavioral Verification Questions (answer ALL before proceeding)

1. **Does the code DO what the requirement says?**
   - [ ] I read REQ-THINK-001.1 and verified sourceField property exists with correct type
   - [ ] I read REQ-THINK-001.2 and verified signature property exists as optional string
   - [ ] sourceField union type includes 'reasoning_content', 'thinking', 'thought'
   - [ ] Both properties are truly optional (backward compatible)

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed (no TODO/HACK/STUB)
   - [ ] Properties have concrete types, not 'any' or 'unknown'
   - [ ] JSDoc comments explain purpose, not just "will be added"

3. **Would the test FAIL if implementation was removed?**
   - [ ] TypeScript would fail if sourceField property was removed
   - [ ] TypeScript would fail if signature property was removed
   - [ ] Union type constraint would catch invalid sourceField values

4. **Is the feature REACHABLE by users?**
   - [ ] ThinkingBlock is exported from IContent.ts
   - [ ] Properties accessible to all code importing ThinkingBlock
   - [ ] No private/internal barriers preventing usage

5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] [gap 1]
   - [ ] [gap 2]

#### Feature Actually Works

```bash
# Manual verification: Show the actual interface definition
grep -A 10 "interface ThinkingBlock" packages/core/src/services/history/IContent.ts
# Expected: Properties sourceField and signature are present with correct types
```

### Structural Verification Checklist

- [ ] ThinkingBlock interface has sourceField property
- [ ] ThinkingBlock interface has signature property
- [ ] Both properties are optional (backward compatible)
- [ ] Plan marker added
- [ ] Requirement markers added
- [ ] TypeScript compiles without errors

## Success Criteria

- ThinkingBlock interface enhanced with new optional properties
- No breaking changes to existing code
- TypeScript compilation passes
- Plan and requirement markers in place

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/core/src/services/history/IContent.ts`
2. Review preflight verification results
3. Re-attempt with corrected approach

## Phase Completion Marker

Create: `project-plans/20251202thinking/.completed/P03.md`
