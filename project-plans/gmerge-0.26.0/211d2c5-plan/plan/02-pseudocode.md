# Phase 02: Pseudocode Development

## Phase ID

`PLAN-20260325-HOOKSPLIT.P02`

## Prerequisites

- Required: Phase 01a (Analysis Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P01a.md`
- Expected files from previous phase: `analysis/domain-model.md`

## Requirements Implemented (Expanded)

This phase produces numbered pseudocode that will be referenced line-by-line in implementation phases. Covers all four implementation domains:

1. **Schema Split** (REQ-211-S01, S02, S03, C01) — Schema changes and helper function updates
2. **Migration** (REQ-211-M01, M02, M03, M04) — Migration function and call-site integration
3. **Config Types** (REQ-211-CC01, CC02, CC03) — Core Config class type and behavior fixes
4. **CLI Loading** (REQ-211-C02, C03, HD03, CMD02, MIG01) — CLI config loader, commands, trust scan

## Implementation Tasks

### Files to Create

- `analysis/pseudocode/schema-split.md` — Numbered pseudocode for schema changes
  - SETTINGS_SCHEMA.hooksConfig definition
  - SETTINGS_SCHEMA.hooks modification (remove config fields)
  - getEnableHooks() update

- `analysis/pseudocode/migration.md` — Numbered pseudocode for migration
  - migrateHooksConfig() function
  - Call sites in loadSettings()
  - Precedence and idempotency logic

- `analysis/pseudocode/config-types.md` — Numbered pseudocode for Config class
  - Private field type fix
  - Constructor wiring
  - getProjectHooks() return type fix
  - getDisabledHooks()/setDisabledHooks() key changes

- `analysis/pseudocode/cli-loading.md` — Numbered pseudocode for CLI changes
  - Config loading simplification
  - disabledHooks parameter addition
  - Post-construction hack removal
  - hooksCommand message update
  - migrate command guard removal
  - hookRegistry trust scan cleanup

### Pseudocode Requirements

1. Every line MUST be numbered
2. No actual TypeScript implementation — algorithmic steps only
3. Interface contracts defined for each component
4. Integration points documented with line references
5. Anti-pattern warnings included

## Verification Commands

### Automated Checks

```bash
# Verify all pseudocode files exist
for f in schema-split migration config-types cli-loading; do
  test -f "project-plans/gmerge-0.26.0/211d2c5-plan/analysis/pseudocode/$f.md" && \
    echo "OK: $f.md" || echo "FAIL: $f.md missing"
done

# Verify line numbering exists in each file
for f in schema-split migration config-types cli-loading; do
  grep -cE "^[0-9]{2}:" "project-plans/gmerge-0.26.0/211d2c5-plan/analysis/pseudocode/$f.md"
done
# Expected: Each file has numbered lines

# Verify no TypeScript implementation
for f in schema-split migration config-types cli-loading; do
  grep -c "import \|export \|function " "project-plans/gmerge-0.26.0/211d2c5-plan/analysis/pseudocode/$f.md" || true
done
# Expected: Only in Interface Contracts sections, not in pseudocode blocks
```


### Structural Verification Checklist

- [ ] Previous phase markers present
- [ ] No skipped phases
- [ ] All listed files created/modified
- [ ] Plan markers added to all changes
- [ ] Tests pass for this phase
- [ ] No "TODO" or "NotImplemented" in phase code

### Semantic Verification Checklist

- [ ] Schema-split pseudocode covers hooksConfig definition, hooks modification, getEnableHooks update
- [ ] Migration pseudocode covers function logic, call sites, precedence, idempotency
- [ ] Config-types pseudocode covers field type, constructor, return type, persistence keys
- [ ] CLI-loading pseudocode covers config loading, hooksCommand, migrate command, hookRegistry
- [ ] All pseudocode has numbered lines
- [ ] Interface contracts defined for each component
- [ ] Anti-pattern warnings present

## Success Criteria

- All 4 pseudocode files created with numbered lines
- Each covers all relevant requirements
- No implementation code — pseudocode only
- Interface contracts and integration points documented

## Failure Recovery

If this phase fails:
1. Re-read domain model and specification
2. Recreate pseudocode files individually
3. Verify line numbering

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P02.md`
