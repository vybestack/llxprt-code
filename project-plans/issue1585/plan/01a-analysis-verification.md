# Phase 01a: Analysis Verification

## Phase ID

`PLAN-20260608-ISSUE1585.P01a`

## Purpose

Verify the analysis covers every tool file, consumer group, missing prerequisite package, and release update.

## Prerequisites

- Required: P01 completed with extended consumer inventory.
- Artifacts from P01: all analysis files listed in P01.

## Requirements Implemented

### REQ-DEP-001, REQ-CLEAN-001

## Verification Tasks

### Step 1: Verify File Inventory Completeness

```bash
# Count matches
TOOL_COUNT=$(find packages/core/src/tools -type f -name '*.ts' | wc -l)
RECORDED=$(wc -l < project-plans/issue1585/analysis/current-tools-files.txt)
echo "Expected $TOOL_COUNT, recorded $RECORDED"
```

Every `.ts` file in `packages/core/src/tools/` must appear in current-tools-files.txt.

### Step 2: Verify Consumer Group Coverage

```bash
# Check each group has entries
for group in config runtime scheduler agents confirmation-bus telemetry prompts storage policy hooks runtime-services test-utils utils lsp-exports package-exports provider-test-mocks provider-production dynamic-imports; do
  echo "Group $group:"
  grep -ci "$group" project-plans/issue1585/analysis/dependency-audit.md || echo "  MISSING"
done
```

### Step 3: Verify Tools-to-Core Coverage

```bash
# Every production tools file that imports core should be listed
comm -23 <(rg -n "from ['\"]\.\./\(config\|confirmation-bus\|services\|core\|mcp\|ide\|lsp\|storage\|debug\|utils\)/" packages/core/src/tools -g "*.ts" | rg -v "__tests__|\.test\.|\.spec\." | sed 's/:.*//' | sort -u) <(cat project-plans/issue1585/analysis/tools-to-core-imports.txt | sed 's/:.*//' | sort -u)
```

No output means full coverage.

### Step 4: Verify Release Baseline

```bash
test -s project-plans/issue1585/analysis/release-baseline.txt
grep -c "release" project-plans/issue1585/analysis/release-baseline.txt
```

### Files To Create Or Modify

- Create: `project-plans/issue1585/.completed/P01a.md`

## Verification Commands

```bash
npm run typecheck
npm run test --workspaces --if-present
```

## Semantic Verification Checklist

- [ ] Every tool file appears in the inventory.
- [ ] All 18 consumer groups are covered.
- [ ] Tools-to-core imports are fully mapped.
- [ ] Package exports baseline is recorded.
- [ ] No production code was changed in this verification phase.

## Success Criteria

- Zero missing files or consumer groups.
- Release baseline is recorded.
- No code changed (analysis phase, no code markers required).

## Failure Recovery

Return to P01 to fill gaps before proceeding to P02.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P01a.md` with coverage assessment and any gaps found.
