# Phase 28a: Deprecation & Cleanup — Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P28a`

## Purpose

Verify the codebase is clean after P28 cleanup: no stub artifacts, no deprecated code, no dangling references, all tests pass.

## Structural Checks

```bash
# 1. TypeScript compiles cleanly
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. Comprehensive artifact scan — ALL HD-related files
find packages/core/src -name "*.ts" -not -name "*.test.ts" -not -path "*__tests__*" -not -path "*node_modules*" | \
  xargs grep -l -i "density\|high.density\|HighDensity\|DensityConfig\|DensityResult\|activeTodos\|transcriptPath" 2>/dev/null | \
  xargs grep -n -E "(NotYetImplemented|STUB|TEMPORARY|WIP|XXX|TODO.*P[0-9])" 2>/dev/null
# Expected: 0 matches

# 3. No empty/trivial implementations in HD production code
grep -rn -E "return \[\]|return \{\}|return null|return undefined" \
  packages/core/src/core/compression/HighDensityStrategy.ts \
  packages/core/src/core/compression/density/ \
  2>/dev/null
# Expected: 0 matches (except intentional undefined returns like getTranscriptPath)
```

## Behavioral Verification

### Production Code Cleanliness

The verifier MUST scan each HD production file:

#### packages/core/src/core/compression/HighDensityStrategy.ts
- [ ] No NotYetImplemented
- [ ] No STUB/TEMPORARY markers
- [ ] optimize() has real implementation
- [ ] compress() has real implementation

#### packages/core/src/core/compression/density/ (all files)
- [ ] No NotYetImplemented
- [ ] No placeholder returns
- [ ] All exported functions have real implementations

#### packages/core/src/core/compression/types.ts
- [ ] No TODO markers referencing future phases
- [ ] DensityResult, DensityConfig, DensityResultMetadata fully defined
- [ ] CompressionContext has activeTodos and transcriptPath

#### packages/core/src/core/compression/compressionStrategyFactory.ts
- [ ] `'high-density'` case returns real HighDensityStrategy (not throwing NotYetImplemented)
- [ ] No stub code

#### packages/core/src/core/geminiChat.ts
- [ ] ensureDensityOptimized() is fully implemented
- [ ] buildCompressionContext() includes activeTodos and transcriptPath
- [ ] No density-related TODOs

#### packages/core/src/core/prompts.ts
- [ ] 9 XML sections in getCompressionPrompt() (5 original + 4 new)
- [ ] No TODO markers in new sections

#### packages/core/src/core/compression/MiddleOutStrategy.ts
- [ ] Todo injection code is real (not stub)
- [ ] Existing compress() behavior preserved

#### packages/core/src/core/compression/OneShotStrategy.ts
- [ ] Todo injection code is real (not stub)
- [ ] Existing compress() behavior preserved

### All Tests Pass

```bash
# Full test suite
npm run test -- --run 2>&1 | tail -10
# Expected: All pass, 0 failures

# Full verification cycle
npm run lint && npm run typecheck && npm run format && npm run build
# Expected: All pass

# Manual test
node scripts/start.js --profile-load syntheticglm47 "write me a haiku"
# Expected: Runs successfully
```

### Plan Marker Audit

```bash
# Count plan markers across all HD files
grep -rn "@plan.*HIGHDENSITY" packages/core/src/ | grep -v test | grep -v __tests__ | grep -v node_modules | wc -l
# Expected: ≥ 8 (one per major production file)

# Count requirement markers
grep -rn "@requirement.*REQ-HD" packages/core/src/ | grep -v node_modules | wc -l
# Expected: ≥ 15 (across production + test files)
```

## Success Criteria

- Zero stub artifacts in production code
- All HD production files have real implementations
- Plan markers present and consistent
- Requirement markers traceable
- All tests pass
- Full verification cycle passes
- Code is clean and ready for final verification (P29)

## Failure Recovery

If verification fails:
1. Document which artifact was found and in which file
2. Return to P28 to clean it up
3. Re-run P28a
