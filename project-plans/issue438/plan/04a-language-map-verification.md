# Phase 04a: Language Map Verification

## Phase ID
`PLAN-20250212-LSP.P04a`

## Prerequisites
- Required: Phase 04 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P04" packages/lsp/`
- Expected files: `packages/lsp/src/service/language-map.ts`, `packages/lsp/test/language-map.test.ts`

## Verification Commands

### Automated Checks

```bash
# 1. Tests pass
cd packages/lsp && bunx vitest run test/language-map.test.ts
# Expected: All pass

# 2. Plan markers present
grep -r "@plan:PLAN-20250212-LSP.P04" packages/lsp/ | wc -l
# Expected: 2+

# 3. Requirement markers present
grep -r "@requirement:REQ-LANG-010" packages/lsp/ | wc -l
# Expected: 2+

# 4. No deferred implementation
grep -rn -E "(TODO|FIXME|HACK|STUB|placeholder)" packages/lsp/src/service/language-map.ts
# Expected: No output

# 5. Core language extensions covered
for ext in ts tsx js jsx py go rs java c cpp; do
  grep -q "\"\.${ext}\"" packages/lsp/src/service/language-map.ts && echo "PASS: .${ext}" || echo "FAIL: .${ext} missing"
done

# 6. TypeScript compiles
cd packages/lsp && bunx tsc --noEmit
# Expected: Success

# 7. Property-based tests exist
grep -c "fc\.\|fast-check\|prop\[" packages/lsp/test/language-map.test.ts
# Expected: > 0
```

### Semantic Verification Checklist (MANDATORY)

#### Holistic Functionality Assessment

##### What was implemented?
[Describe the language map: number of extensions, export functions, immutability approach]

##### Does it satisfy REQ-LANG-010?
- [ ] Extensible mapping architecture exists
- [ ] File extension to LSP language ID mapping works
- [ ] Common languages covered: TypeScript, JavaScript, Python, Go, Rust, Java, C, C++
- [ ] Unknown extensions return undefined gracefully

##### Verdict
[PASS/FAIL with explanation]

## Success Criteria
- All tests pass
- Core extensions covered
- Property-based tests present
- No deferred implementation

## Failure Recovery
1. Return to Phase 04
2. Fix specific issues
3. Re-run Phase 04a


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
Create: `project-plans/issue438/.completed/P04a.md`
