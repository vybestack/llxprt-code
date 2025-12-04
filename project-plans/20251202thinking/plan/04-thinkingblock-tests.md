# Phase 04: ThinkingBlock Tests

## Phase ID

`PLAN-20251202-THINKING.P04`

## Prerequisites

- Required: Phase 03a completed
- Verification: `cat project-plans/20251202thinking/.completed/P03a.md`

## Requirements Implemented (Expanded)

### REQ-THINK-001: ThinkingBlock Interface Testing

**Full Text**: ThinkingBlock interface enhancements must be validated through type tests
**Behavior**:

- GIVEN: ThinkingBlock interface with new properties
- WHEN: Creating ThinkingBlock instances
- THEN: TypeScript accepts valid instances and rejects invalid ones

**Why This Matters**: Type safety ensures providers create valid ThinkingBlocks

## Implementation Tasks

### Files to Create

#### `packages/core/src/services/history/__tests__/ThinkingBlock.test.ts`

```typescript
/**
 * @plan PLAN-20251202-THINKING.P04
 * @requirement REQ-THINK-001
 */
import { describe, it, expect } from 'vitest';
import type { ThinkingBlock, ContentBlock } from '../IContent';

describe('ThinkingBlock @plan:PLAN-20251202-THINKING.P04', () => {
  describe('REQ-THINK-001.1: sourceField property', () => {
    it('accepts reasoning_content as sourceField', () => {
      const block: ThinkingBlock = {
        type: 'thinking',
        thought: 'test thought',
        sourceField: 'reasoning_content',
      };
      expect(block.sourceField).toBe('reasoning_content');
    });

    it('accepts thinking as sourceField', () => {
      const block: ThinkingBlock = {
        type: 'thinking',
        thought: 'test thought',
        sourceField: 'thinking',
      };
      expect(block.sourceField).toBe('thinking');
    });

    it('accepts thought as sourceField', () => {
      const block: ThinkingBlock = {
        type: 'thinking',
        thought: 'test thought',
        sourceField: 'thought',
      };
      expect(block.sourceField).toBe('thought');
    });

    it('allows sourceField to be undefined (backward compat)', () => {
      const block: ThinkingBlock = {
        type: 'thinking',
        thought: 'test thought',
      };
      expect(block.sourceField).toBeUndefined();
    });
  });

  describe('REQ-THINK-001.2: signature property', () => {
    it('accepts signature string', () => {
      const block: ThinkingBlock = {
        type: 'thinking',
        thought: 'test thought',
        signature: 'abc123signature',
      };
      expect(block.signature).toBe('abc123signature');
    });

    it('allows signature to be undefined (backward compat)', () => {
      const block: ThinkingBlock = {
        type: 'thinking',
        thought: 'test thought',
      };
      expect(block.signature).toBeUndefined();
    });
  });

  describe('REQ-THINK-001.3: ContentBlock union', () => {
    it('ThinkingBlock is assignable to ContentBlock', () => {
      const thinkingBlock: ThinkingBlock = {
        type: 'thinking',
        thought: 'test',
        sourceField: 'reasoning_content',
      };
      // This assignment should compile
      const contentBlock: ContentBlock = thinkingBlock;
      expect(contentBlock.type).toBe('thinking');
    });
  });

  describe('backward compatibility', () => {
    it('existing ThinkingBlock shape still works', () => {
      // This is what existing code creates
      const legacyBlock: ThinkingBlock = {
        type: 'thinking',
        thought: 'existing thought',
        isHidden: false,
      };
      expect(legacyBlock.type).toBe('thinking');
      expect(legacyBlock.thought).toBe('existing thought');
      expect(legacyBlock.isHidden).toBe(false);
    });

    it('full ThinkingBlock with all properties', () => {
      const fullBlock: ThinkingBlock = {
        type: 'thinking',
        thought: 'complete thought',
        isHidden: true,
        sourceField: 'reasoning_content',
        signature: 'sig123',
      };
      expect(fullBlock).toMatchObject({
        type: 'thinking',
        thought: 'complete thought',
        isHidden: true,
        sourceField: 'reasoning_content',
        signature: 'sig123',
      });
    });
  });
});
```

### Required Code Markers

Every test must include plan marker in describe block name or comment.

## Verification Commands

### Automated Checks

```bash
# Check test file exists
ls packages/core/src/services/history/__tests__/ThinkingBlock.test.ts

# Check plan markers
grep -r "@plan.*THINKING.P04" packages/core/src/services/history/__tests__/

# Run the tests
npm test -- --run packages/core/src/services/history/__tests__/ThinkingBlock.test.ts

# Expected: All tests pass
```

### Deferred Implementation Detection

**Purpose**: Ensure no stub/placeholder code remains after implementation

**Check**: Run tests and verify all assertions execute real logic (no `throw "Not implemented"` errors)

**Recovery**: If stubs detected, complete Phase 03 implementation before marking this phase done

### Semantic Verification Checklist (MANDATORY)

**Behavioral Verification Questions**:

1. **Can I create a ThinkingBlock with sourceField='reasoning_content'?**
   - Expected: Yes, type system and tests accept it

2. **Can I create a ThinkingBlock with sourceField='thinking'?**
   - Expected: Yes, type system and tests accept it

3. **Can I create a ThinkingBlock without sourceField?**
   - Expected: Yes, backward compatibility maintained

4. **Can I create a ThinkingBlock with signature property?**
   - Expected: Yes, type system and tests accept it

5. **Can I assign a ThinkingBlock to a ContentBlock variable?**
   - Expected: Yes, union type compatibility works

6. **Do legacy ThinkingBlocks still work?**
   - Expected: Yes, all existing code patterns compile and pass tests

### Structural Verification Checklist

- [ ] Test file created
- [ ] Tests cover sourceField property
- [ ] Tests cover signature property
- [ ] Tests cover ContentBlock union compatibility
- [ ] Tests cover backward compatibility
- [ ] Plan markers present
- [ ] All tests pass
- [ ] All behavioral questions answered "Yes"

## Success Criteria

- All tests pass
- Tests validate type safety of new properties
- Backward compatibility confirmed

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/core/src/services/history/__tests__/`
2. Review Phase 03 implementation
3. Re-attempt with corrected tests

## Phase Completion Marker

Create: `project-plans/20251202thinking/.completed/P04.md`
