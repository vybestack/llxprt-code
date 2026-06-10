# Phase 09a: Move Map Verification

## Phase ID

`PLAN-20260608-ISSUE1585.P09a`

## Purpose

Verify every current file under packages/core/src/tools is classified exactly once with no omissions or duplicates.

## Prerequisites

- Required: P09 completed with move-map-final.md.
- Artifacts: move-map-final.md, current-tools-files-final.txt.

## Verification Tasks

### Step 1: Count Verification

```bash
WC_TOOLS=$(find packages/core/src/tools -type f | wc -l)
WC_MAP=$(grep -c "^packages/core/src/tools" project-plans/issue1585/analysis/move-map-final.md)
echo "Tools TS files: $WC_TOOLS, Map entries: $WC_MAP"
# Must match
```

### Step 2: Omission Check

```bash
# Find files not in move map
comm -23 <(find packages/core/src/tools -type f | sort) <(grep "^packages/core/src/tools" project-plans/issue1585/analysis/move-map-final.md | awk '{print $1}' | sort)
# Expected: empty
```

### Step 3: Duplicate Check

```bash
grep "^packages/core/src/tools" project-plans/issue1585/analysis/move-map-final.md | awk '{print $1}' | sort | uniq -d
# Expected: empty
```

### Step 4: Verify Retained File Rationale

```bash
grep "STAY_CORE_INFRASTRUCTURE\|STAY_UNTIL_FUTURE_PKG" project-plans/issue1585/analysis/move-map-final.md
# Each must have rationale
# tool-key-storage.ts must explicitly document: class stays (SecureStore), pure functions move
```

### Step 5: Verify tool-key-storage Ownership

```bash
# Verify tool-key-storage is classified correctly in move-map
grep -A5 "tool-key-storage" project-plans/issue1585/analysis/move-map-final.md
# Must show: ToolKeyStorage class STAYS in core (imports SecureStore)
# Must show: maskKeyForDisplay/getSupportedToolNames/isValidToolKeyName move to packages/tools/src/utils/
# Must show: CoreToolKeyStorageAdapter owns lifecycle, MUST NOT import moved class
```

## Verification Commands

```bash
npm run typecheck
```

## Semantic Verification Checklist

- [ ] Every file classified exactly once.
- [ ] Zero omissions or duplicates.
- [ ] Retained files have rationale.
- [ ] tool-key-storage ownership is explicit (class stays in core, pure functions move, adapter owns lifecycle and does NOT import moved class).
- [ ] No code changed (analysis verification, no code markers required).

## Success Criteria

- File counts match.
- No omissions or duplicates.

## Failure Recovery

Return to P09 to classify missing files.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P09a.md` with classification verification.
