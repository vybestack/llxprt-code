# Phase 18: Extended Syntax for /todo delete - COMPLETED

**Plan ID**: PLAN-20260129-TODOPERSIST-EXT.P18  
**Date**: 2026-01-29  
**Status**: [OK] COMPLETED

## Summary

Successfully extended `/todo delete` command to support range deletion and "all" keyword while maintaining backward compatibility with single-position deletion.

## Changes Made

### 1. Extended todoCommand.ts Delete Handler

**File**: `packages/cli/src/ui/commands/todoCommand.ts`

**Changes**:
- Added "all" keyword support: `/todo delete all` → deletes all TODOs
- Added range syntax support: `/todo delete 2-4` → deletes TODOs 2, 3, 4 (inclusive)
- Range validation: start <= end, both indices in bounds
- Delete in REVERSE order (highest index first) to maintain index stability
- Consistent output: "Deleted X TODO(s)" for all deletion types
- Updated description to reflect new syntax: `<position|range|all>`

**Code Pattern**:
```typescript
// 1. Check for "all" keyword
if (posStr === 'all') {
  // Clear all TODOs
}

// 2. Check for range pattern (e.g., "2-4")
const rangeMatch = posStr.match(/^(\d+)-(\d+)$/);
if (rangeMatch) {
  // Validate and delete range in reverse
}

// 3. Fall back to single position parsing (existing logic)
const parsed = parsePosition(posStr, todos);
```

### 2. Added TDD Tests

**File**: `packages/cli/src/ui/commands/todoCommand.test.ts`

**New Tests**:
1. [OK] Delete range of TODOs (2-4) → deletes 3 items, 2 remain
2. [OK] Delete all TODOs with "all" keyword → deletes all, 0 remain
3. [OK] Delete single TODO with range syntax (1-1) → deletes 1 item
4. [OK] Error on invalid range (start > end, e.g., 5-2)
5. [OK] Error on out of bounds range (e.g., 1-99 when only 3 TODOs)
6. [OK] Property test: range deletion count equals (end - start + 1)

**Test Results**: All 31 tests passing [OK]

## Verification

```bash
[OK] cd packages/cli && npm test -- --run src/ui/commands/todoCommand.test.ts
   31 tests passed (31/31)
   
[OK] npm run typecheck
   No type errors
```

## Examples

### Range Deletion
```bash
/todo delete 2-4
# Deletes TODOs at positions 2, 3, 4
# Output: "Deleted 3 TODO(s)"
```

### Delete All
```bash
/todo delete all
# Deletes all TODOs (same as /todo clear)
# Output: "Deleted 5 TODO(s)"
```

### Single Position (Backward Compatible)
```bash
/todo delete 2
# Still works as before
# Output: "Deleted 1 TODO(s)"
```

### Edge Case: Single-Item Range
```bash
/todo delete 1-1
# Deletes only TODO 1
# Output: "Deleted 1 TODO(s)"
```

## Technical Details

### Range Deletion Algorithm
1. Parse range: `"2-4"` → start=2, end=4
2. Validate: start <= end && start >= 1 && end <= todos.length
3. **Delete in REVERSE order** (highest to lowest):
   - Delete index 3 (position 4)
   - Delete index 2 (position 3)
   - Delete index 1 (position 2)
4. This prevents index shifting issues during deletion

### Validation Rules
- Range format: `^\d+-\d+$` (e.g., "1-5")
- Start must be <= end
- Both indices must be in bounds (1 to todos.length)
- "all" is case-sensitive

### Backward Compatibility
- [OK] Single position deletion still works: `/todo delete 2`
- [OK] Subtask deletion still works: `/todo delete 1.1`
- [OK] "last" position still works (for add/delete single)
- [OK] Error messages maintain existing format

## Integration with Existing Features

### Works With:
- `/todo show` - Display current list with positions
- `/todo add <pos> <desc>` - Add at specific position
- `/todo set <pos>` - Set status
- `/todo clear` - Clear all (now equivalent to `/todo delete all`)

### Plan Markers
- All code marked with `@plan PLAN-20260129-TODOPERSIST-EXT.P18`
- Follows existing code style and patterns
- Integrates with existing parsePosition() for single deletions

## Next Steps

Phase 18 is complete. Ready for:
- Integration testing with other TODO commands
- User acceptance testing
- Documentation updates

## Files Modified
1. `/packages/cli/src/ui/commands/todoCommand.ts` - Extended delete handler
2. `/packages/cli/src/ui/commands/todoCommand.test.ts` - Added 7 new tests + 1 property test

## Compliance
- [OK] TDD approach (tests written first, then implementation)
- [OK] Property-based testing for range invariants
- [OK] All existing tests still passing (backward compatible)
- [OK] TypeScript type checking passes
- [OK] Code matches existing project style
- [OK] Plan markers added
