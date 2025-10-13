# Phase 11: Legacy Completion Removal

## Phase ID
`PLAN-20251013-AUTOCOMPLETE.P11`

## Prerequisites
- `/subagent` and `/set` schema migrations verified (P08a, P10a)

## Implementation Tasks
- Audit and remove any remaining references to legacy completion helpers:
  - Delete obsolete functions in `packages/cli/src/ui/hooks/useSlashCompletion.tsx` (original manual completion branches).
  - Remove unused exports/imports from individual command files (e.g., `/profile`, `/tools`) that referenced old helpers.
  - Ensure `subagentCommand.ts` and `setCommand.ts` rely solely on schema definitions.
- Update tests to drop references to removed helpers while keeping behavioral coverage intact (no structural assertions).
- Update documentation comments pointing to new schema path only.

### Compliance Notes
- Confirm no duplicate completion systems remain; schema resolver is the single source.
- All deletions must be reflected in phase comments referencing integration analysis.

### Required Comment Example
```typescript
/**
 * @plan:PLAN-20251013-AUTOCOMPLETE.P11
 * @requirement:REQ-004
 * @requirement:REQ-006
 * Deprecation: Removed legacy completion branch (see specification Integration Analysis).
 */
```

## Verification Commands

```bash
# Ensure no legacy keywords remain
rg "legacyCompletion\|manualCompletion\|OLD_COMPLETION" packages/cli/src/ui | grep -v "schema" && echo "FAIL: Legacy logic present"

# Run full CLI test suite
npm test -- --filter "@plan:PLAN-20250214-AUTOCOMPLETE"
```

## Manual Verification Checklist
- [ ] All old completion code removed
- [ ] Tests still green
- [ ] Execution tracker updated

## Success Criteria
- Single completion system remains for CLI commands.

## Failure Recovery
- If functionality regresses, reintroduce minimal schema-based fix rather than restoring legacy code.

## Phase Completion Marker
- Create `project-plans/autocomplete/.completed/P11.md` summarizing deletions and verification commands.
