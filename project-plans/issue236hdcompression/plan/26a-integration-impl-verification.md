# Phase 26a: Integration — Implementation Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P26a`

## Purpose

Verify all integration issues from P26 are resolved, all integration tests pass, the full high-density feature is wired end-to-end, and no regressions exist.

## Structural Checks

```bash
# 1. TypeScript compiles cleanly
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. No remaining stubs in production code
grep -rn -E "(NotYetImplemented|STUB|TODO.*implement)" \
  packages/core/src/core/compression/HighDensityStrategy.ts \
  packages/core/src/core/compression/density/ \
  packages/core/src/core/compression/compressionStrategyFactory.ts \
  2>/dev/null
# Expected: No matches

# 3. No cop-out implementations
grep -rn -E "(placeholder|not yet|will be|should be)" \
  packages/core/src/core/compression/HighDensityStrategy.ts \
  packages/core/src/core/compression/density/ \
  2>/dev/null
# Expected: No matches
```

## Behavioral Verification

### All Integration Tests Pass

```bash
# Integration tests — the main gate
npm run test -- --run packages/core/src/core/compression/__tests__/integration-high-density.test.ts
# Expected: All pass, 0 failures
```

### All HD Unit Tests Pass

```bash
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-settings.test.ts
npm run test -- --run packages/core/src/core/__tests__/geminiChat-density.test.ts
npm run test -- --run packages/core/src/core/__tests__/compression-prompts.test.ts
npm run test -- --run packages/core/src/core/compression/__tests__/compression-todos.test.ts
# Expected: All pass
```

### Full Verification Cycle

```bash
npm run test -- --run 2>&1 | tail -10
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load syntheticglm47 "write me a haiku"
# Expected: All pass
```

### End-to-End Feature Trace

The verifier MUST trace the complete user journey:

1. **Strategy Selection**
   - [ ] `COMPRESSION_STRATEGIES` tuple includes `'high-density'`
   - [ ] `/set compression.strategy` accepts `'high-density'`
   - [ ] Setting persists to profile via `persistToProfile: true`

2. **Strategy Resolution**
   - [ ] `parseCompressionStrategyName('high-density')` returns `'high-density'`
   - [ ] `getCompressionStrategy('high-density')` returns HighDensityStrategy instance
   - [ ] Instance has `optimize` method and `trigger.mode === 'continuous'`

3. **Density Settings**
   - [ ] 4 density settings in SETTINGS_REGISTRY with correct defaults
   - [ ] 4 runtime accessors wired in ephemerals
   - [ ] DensityConfig constructed from ephemeral values

4. **Orchestration**
   - [ ] `ensureCompressionBeforeSend()` calls `ensureDensityOptimized()`
   - [ ] `ensureDensityOptimized()` builds DensityConfig from settings
   - [ ] `optimize()` called with raw history and config
   - [ ] Non-empty result → `applyDensityResult()` + `waitForTokenUpdates()`
   - [ ] Token recheck → `shouldCompress()` → conditionally `performCompression()`

5. **Enriched Prompts**
   - [ ] `getCompressionPrompt()` has 9 XML sections (5 original + 4 new)
   - [ ] `compression.md` has matching new sections
   - [ ] LLM strategies include `activeTodos` in request when present
   - [ ] Non-LLM strategies ignore `activeTodos`

### Integration Points Cross-Reference

| Component | Created In | Wired In | Tested In | Status |
|-----------|-----------|----------|-----------|--------|
| HighDensityStrategy class | P05 | P17 (factory) | P11, P14 | [ ] |
| applyDensityResult | P08 | P20 (geminiChat) | P08, P20 | [ ] |
| getRawHistory | P08 | P20 (geminiChat) | P08, P20 | [ ] |
| 4 density settings | P15 | P17 (ephemerals) | P17, P25 | [ ] |
| Factory case | P17 | P17 | P25 | [ ] |
| ensureDensityOptimized | P20 | P18 (hook) | P19, P25 | [ ] |
| Enriched prompts | P21 | P21 | P22 | [ ] |
| Todo-aware summarization | P23 | P23 | P22 | [ ] |
| Integration tests | P25 | N/A | P25 | [ ] |

## Success Criteria

- ALL integration tests pass
- ALL HD unit tests pass
- Full verification cycle passes (test, lint, typecheck, format, build)
- Manual integration test passes
- No remaining stubs in production code
- End-to-end feature trace verified
- All integration cross-references checked

## Failure Recovery

If verification fails:
1. Document which checks failed
2. Return to P26 to fix
3. Re-run P26a
