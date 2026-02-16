# Phase 02a: Pseudocode Verification

## Phase ID
`PLAN-20250212-LSP.P02a`

## Prerequisites
- Required: Phase 02 completed
- Verification: All 12 pseudocode files exist under `analysis/pseudocode/`
- Expected files: lsp-service-client.md, orchestrator.md, lsp-client.md, diagnostics.md, server-registry.md, language-map.md, rpc-channel.md, mcp-channel.md, main-entry.md, edit-integration.md, write-integration.md, config-integration.md

## Verification Commands

### Automated Checks

```bash
# All files exist
EXPECTED_FILES="lsp-service-client orchestrator lsp-client diagnostics server-registry language-map rpc-channel mcp-channel main-entry edit-integration write-integration config-integration"
MISSING=0
for file in $EXPECTED_FILES; do
  if [ ! -f "project-plans/issue438/analysis/pseudocode/${file}.md" ]; then
    echo "MISSING: ${file}.md"
    MISSING=$((MISSING + 1))
  fi
done
[ $MISSING -eq 0 ] && echo "ALL FILES PRESENT" || echo "FAIL: $MISSING files missing"

# Numbered lines present in each
for file in project-plans/issue438/analysis/pseudocode/*.md; do
  LINES=$(grep -c "^[0-9][0-9]:" "$file" 2>/dev/null || echo 0)
  echo "$(basename $file): $LINES numbered lines"
  [ "$LINES" -lt 5 ] && echo "WARNING: Very few numbered lines in $(basename $file)"
done

# Three required sections present
for file in project-plans/issue438/analysis/pseudocode/*.md; do
  BASENAME=$(basename "$file")
  HAS_IC=$(grep -c "Interface Contracts" "$file" 2>/dev/null || echo 0)
  HAS_IP=$(grep -c "Integration Points" "$file" 2>/dev/null || echo 0)
  HAS_AP=$(grep -c "Anti-Pattern" "$file" 2>/dev/null || echo 0)
  [ "$HAS_IC" -eq 0 ] && echo "FAIL: $BASENAME missing Interface Contracts"
  [ "$HAS_IP" -eq 0 ] && echo "FAIL: $BASENAME missing Integration Points"
  [ "$HAS_AP" -eq 0 ] && echo "FAIL: $BASENAME missing Anti-Pattern Warnings"
done

# No actual TypeScript in pseudocode (allow type definitions in Interface Contracts)
for file in project-plans/issue438/analysis/pseudocode/*.md; do
  IMPORTS=$(grep -c "^import " "$file" 2>/dev/null || echo 0)
  [ "$IMPORTS" -gt 0 ] && echo "WARNING: $(basename $file) may contain real TypeScript imports"
done
```

### Semantic Verification Checklist (MANDATORY)

#### Holistic Functionality Assessment

##### What was created?
[Describe the pseudocode files created — what each covers, how they interrelate]

##### Does pseudocode cover all requirements?
Check each requirement area:
- [ ] REQ-DIAG-* (diagnostic feedback): Covered in edit-integration, write-integration, diagnostics
- [ ] REQ-FMT-* (output format): Covered in diagnostics
- [ ] REQ-TIME-* (timing): Covered in lsp-client (debounce), orchestrator (parallel collection)
- [ ] REQ-SCOPE-* (scope restrictions): Covered in edit-integration, write-integration
- [ ] REQ-KNOWN-* (known-files): Covered in orchestrator
- [ ] REQ-NAV-* (navigation tools): Covered in mcp-channel
- [ ] REQ-LIFE-* (lifecycle): Covered in orchestrator, lsp-client, lsp-service-client
- [ ] REQ-ARCH-* (architecture): Covered in main-entry, rpc-channel, mcp-channel
- [ ] REQ-GRACE-* (graceful degradation): Covered in lsp-service-client, edit-integration, write-integration
- [ ] REQ-CFG-* (configuration): Covered in config-integration, server-registry
- [ ] REQ-LANG-* (multi-language): Covered in language-map, server-registry
- [ ] REQ-BOUNDARY-* (workspace boundary): Covered in orchestrator
- [ ] REQ-STATUS-* (status visibility): Covered in orchestrator
- [ ] REQ-OBS-* (observability): Covered in orchestrator, lsp-client
- [ ] REQ-PKG-* (packaging): Covered in config-integration (type duplication)

##### Are components properly decomposed?
- [ ] Each pseudocode file represents one clear component
- [ ] Integration points explicitly show where components connect
- [ ] No component does too much (check against max-lines: 800 constraint)

##### Verdict
[PASS/FAIL with explanation]

## Success Criteria
- All 12 pseudocode files exist with numbered lines
- All three required sections present in every file
- All REQ-* areas covered across the pseudocode set
- Pseudocode is implementable without ambiguity

## Failure Recovery
If verification fails:
1. Identify specific files or sections that need correction
2. Return to Phase 02 to fix specific files
3. Re-run Phase 02a verification


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
Create: `project-plans/issue438/.completed/P02a.md`
