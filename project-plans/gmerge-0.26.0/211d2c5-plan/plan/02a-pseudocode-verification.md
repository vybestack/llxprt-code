# Phase 02a: Pseudocode Verification

## Phase ID

`PLAN-20260325-HOOKSPLIT.P02a`

## Prerequisites

- Required: Phase 02 completed
- Verification: `test -f project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P02.md`

## Verification Tasks

### 1. Pseudocode Completeness

```bash
# Verify all pseudocode files exist and are non-empty
for f in schema-split migration config-types cli-loading; do
  path="project-plans/gmerge-0.26.0/211d2c5-plan/analysis/pseudocode/$f.md"
  lines=$(wc -l < "$path" 2>/dev/null || echo 0)
  echo "$f.md: $lines lines"
  [ "$lines" -gt 20 ] && echo "  OK" || echo "  FAIL: too short"
done
```

### 2. Requirement Coverage Matrix

Verify each requirement is addressed by at least one pseudocode file:

| Requirement | Pseudocode File | Covered? |
|-------------|----------------|----------|
| REQ-211-S01 | schema-split.md | [ ] |
| REQ-211-S02 | schema-split.md | [ ] |
| REQ-211-S03 | schema-split.md | [ ] |
| REQ-211-M01 | migration.md | [ ] |
| REQ-211-M02 | migration.md | [ ] |
| REQ-211-M03 | migration.md | [ ] |
| REQ-211-M04 | migration.md | [ ] |
| REQ-211-C01 | schema-split.md | [ ] |
| REQ-211-CC01 | config-types.md | [ ] |
| REQ-211-CC02 | config-types.md | [ ] |
| REQ-211-CC03 | config-types.md | [ ] |
| REQ-211-C02 | cli-loading.md | [ ] |
| REQ-211-C03 | cli-loading.md | [ ] |
| REQ-211-HD03 | cli-loading.md | [ ] |
| REQ-211-CMD02 | cli-loading.md | [ ] |
| REQ-211-MIG01 | cli-loading.md | [ ] |

### 3. Cross-Reference Pseudocode ↔ Codebase

Verify pseudocode references actual file paths and line numbers from the codebase:

```bash
# Verify schema-split references settingsSchema.ts
grep -c "settingsSchema" project-plans/gmerge-0.26.0/211d2c5-plan/analysis/pseudocode/schema-split.md

# Verify migration references settings.ts
grep -c "settings.ts\|loadSettings" project-plans/gmerge-0.26.0/211d2c5-plan/analysis/pseudocode/migration.md

# Verify config-types references core/config/config.ts
grep -c "config.ts\|Config" project-plans/gmerge-0.26.0/211d2c5-plan/analysis/pseudocode/config-types.md

# Verify cli-loading references cli/config.ts and other CLI files
grep -c "cli\|hooksCommand\|hookRegistry\|migrate" project-plans/gmerge-0.26.0/211d2c5-plan/analysis/pseudocode/cli-loading.md
```

### 4. No Implementation Code

```bash
# Verify pseudocode blocks don't contain TypeScript imports/exports
for f in schema-split migration config-types cli-loading; do
  path="project-plans/gmerge-0.26.0/211d2c5-plan/analysis/pseudocode/$f.md"
  # Check inside pseudocode blocks (between ``` markers)
  awk '/^```$/,/^```$/' "$path" | grep -cE "^(import|export|const|let|var|function|class) " || echo "0"
done
# Expected: 0 for each (implementation code only in Interface Contracts sections)
```

## Success Criteria

- All 4 files present with 20+ lines each
- All requirements have coverage in at least one pseudocode file
- Pseudocode references real file paths
- No implementation code in pseudocode blocks

## Semantic Verification Checklist (MANDATORY)

### Behavioral Verification Questions (answer ALL before proceeding)

1. **Does the code DO what the requirement says?**
   - [ ] I read the requirement text
   - [ ] I read the implementation code (not just checked file exists)
   - [ ] I can explain HOW the requirement is fulfilled
2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed (no TODO/HACK/STUB)
   - [ ] No empty returns in implementation
   - [ ] No "will be implemented" comments
3. **Would the test FAIL if implementation was removed?**
   - [ ] Test verifies actual outputs, not just that code ran
   - [ ] Test would catch a broken implementation
4. **Is the feature REACHABLE by users?**
   - [ ] Code is called from existing code paths
   - [ ] There's a path from UI/CLI/API to this code
5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] [gap 1]
   - [ ] [gap 2]

### Feature Actually Works

```bash
# Manual test command (RUN THIS and paste actual output):
# Pseudocode phase — verify all pseudocode files exist with numbered lines
for f in schema-split migration config-types cli-loading; do
  path="project-plans/gmerge-0.26.0/211d2c5-plan/analysis/pseudocode/$f.md"
  lines=$(wc -l < "$path" 2>/dev/null || echo 0)
  numbered=$(grep -cE "^[0-9]{2}:" "$path" 2>/dev/null || echo 0)
  echo "$f.md: $lines lines, $numbered numbered"
done
# Expected behavior: All 4 files exist with 20+ lines and numbered pseudocode
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] Pseudocode references actual file paths in the codebase
- [ ] Interface contracts match actual TypeScript signatures
- [ ] Integration points between components are documented
- [ ] Anti-pattern warnings included

### Edge Cases Verified

- [ ] Empty input handling documented in pseudocode
- [ ] Null/undefined handling documented in pseudocode
- [ ] Error scenarios described in pseudocode
- [ ] Idempotency logic explicitly addressed

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P02a.md`
