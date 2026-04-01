# Phase 01: Domain Analysis

## Phase ID

`PLAN-20260325-HOOKSPLIT.P01`

## Prerequisites

- Required: Phase 00a (Preflight Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P00a.md`
- Preflight verification: Phase 0.5 MUST be completed

## Requirements Implemented (Expanded)

This phase produces the domain analysis artifact that informs all subsequent phases. It does not directly implement requirements but provides the foundation for:

- All REQ-211-S* (Schema Changes) — by analyzing current schema structure
- All REQ-211-M* (Migration) — by analyzing settings lifecycle and scope handling
- All REQ-211-CC* (Config Class) — by analyzing Config constructor and field types
- All REQ-211-HD* (Hook Dispatch) — by analyzing hook registry patterns

## Implementation Tasks

### Files to Create

- `project-plans/gmerge-0.26.0/211d2c5-plan/analysis/domain-model.md`
  - Entity relationships (Settings Schema, Config, Hook Registry, CLI Config Loader)
  - State transitions (settings lifecycle from disk to runtime)
  - Business rules (precedence, migration, merge strategies)
  - Edge cases (empty settings, mixed formats, scope conflicts)
  - Error scenarios (missing migration, wrong key paths)

### Analysis Must Cover

1. **Entity inventory**: All types, interfaces, and classes involved in hooks settings
2. **Data flow**: How hooks config flows from disk → schema → merge → Config → HookRegistry
3. **Current workarounds**: The destructuring hack, post-construction setDisabledHooks, disabled-key guard
4. **Migration pattern**: How `migrateLegacyInteractiveShellSetting` works as a template
5. **Scope handling**: System, system-defaults, user, workspace — merge order and precedence
6. **Type safety gaps**: Where types diverge from runtime reality

## Verification Commands

### Automated Checks

```bash
# Verify domain model file exists
test -f project-plans/gmerge-0.26.0/211d2c5-plan/analysis/domain-model.md && echo "OK" || echo "FAIL"

# Verify it covers all entities
grep -c "Settings Schema\|Config Parameters\|Config Class\|Hook Registry\|CLI Config\|Migration" \
  project-plans/gmerge-0.26.0/211d2c5-plan/analysis/domain-model.md
# Expected: 6+
```


### Structural Verification Checklist

- [ ] Previous phase markers present
- [ ] No skipped phases
- [ ] All listed files created/modified
- [ ] Plan markers added to all changes
- [ ] Tests pass for this phase
- [ ] No "TODO" or "NotImplemented" in phase code

### Semantic Verification Checklist

- [ ] All entities from the specification are documented
- [ ] State transitions cover the full settings lifecycle
- [ ] Business rules are explicit and verifiable
- [ ] Edge cases include empty, null, mixed-format scenarios
- [ ] No implementation code — analysis only

## Success Criteria

- Domain model document exists with all required sections
- All entities from specification are covered
- No implementation details leaked into analysis

## Failure Recovery

If this phase fails:
1. Re-read the specification (`specification.md`)
2. Re-examine the codebase at the specific line numbers
3. Recreate the domain model

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P01.md`
