# Phase 01a: Analysis Verification

## Phase ID
`PLAN-20250212-LSP.P01a`

## Prerequisites
- Required: Phase 01 completed
- Verification: `test -f project-plans/issue438/analysis/domain-model.md`
- Expected files from previous phase: `analysis/domain-model.md`

## Verification Commands

### Automated Checks

```bash
# Domain model exists and has substantive content
wc -l project-plans/issue438/analysis/domain-model.md
# Expected: > 200 lines

# All requirement areas covered
for area in DIAG FMT TIME SCOPE KNOWN NAV LIFE ARCH GRACE CFG LANG BOUNDARY STATUS OBS PKG EXCL; do
  count=$(grep -c "REQ-${area}" project-plans/issue438/analysis/domain-model.md 2>/dev/null || echo 0)
  echo "REQ-${area}: ${count} references"
  [ "$count" -eq 0 ] && echo "FAIL: Missing coverage for REQ-${area}"
done

# No implementation details leaked into analysis
grep -E "import |export |class |function |interface " project-plans/issue438/analysis/domain-model.md
# Expected: No matches (analysis should not contain TypeScript code)
```

### Semantic Verification Checklist (MANDATORY)

#### Holistic Functionality Assessment

##### What was analyzed?
[Describe the entities, states, rules, and edge cases identified in the domain model]

##### Does it cover all specification behaviors?
- [ ] B1 (Diagnostic feedback after edits): Covered in entity relationships and data flow
- [ ] B2 (Multi-file awareness): Covered in business rules for known-files set
- [ ] B3 (Navigation tools via MCP): Covered in entity relationships
- [ ] B4 (Lazy server startup): Covered in state transitions
- [ ] B5 (Configuration): Covered in business rules and edge cases
- [ ] B6 (Status visibility): Covered in state definitions
- [ ] B7 (Session lifecycle): Covered in state transitions and cleanup rules
- [ ] B8 (Bun unavailability): Covered in error scenarios

##### What could go wrong?
[List risks identified during analysis verification]

##### Verdict
[PASS/FAIL with explanation]

## Success Criteria
- All REQ-* areas have at least one reference in domain model
- No TypeScript implementation code in analysis
- All B1-B8 behaviors covered
- State transitions are complete (every state reachable, every state has exit)

## Failure Recovery
If verification fails:
1. Identify missing areas
2. Re-run Phase 01 to update domain model
3. Cannot proceed to Phase 02 until verified


### Deferred Implementation Detection (MANDATORY)

```bash
# Check for TODO/FIXME/HACK markers left in implementation:
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" [modified-files] | grep -v ".test.ts"
# Expected: No matches

# Check for cop-out comments:
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" [modified-files] | grep -v ".test.ts"
# Expected: No matches

# Check for empty/trivial implementations:
grep -rn -E "return \[\]|return \{\}|return null|return undefined" [modified-files] | grep -v ".test.ts"
# Expected: No matches in main logic paths (OK in error guards)
```


### Feature Actually Works

```bash
# Verify all tests pass with real implementation:
npm test
# Expected: All tests pass

# Run specific phase tests:
cd packages/lsp && bunx vitest run
cd packages/core && npx vitest run
# Expected: All pass
```


## Phase Completion Marker
Create: `project-plans/issue438/.completed/P01a.md`
