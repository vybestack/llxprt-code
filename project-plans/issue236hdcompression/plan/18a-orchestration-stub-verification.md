# Phase 18a: Orchestration — Stub Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P18a`

## Purpose

Verify the orchestration stubs from P18 compile correctly, hook points are wired in the correct locations, the no-op stub is safe for all strategies, and existing behavior is unaffected.

## Structural Checks

```bash
# 1. TypeScript compiles cleanly
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. Plan markers include P18
grep -c "@plan.*HIGHDENSITY.P18" packages/core/src/core/geminiChat.ts
# Expected: ≥ 2

# 3. Requirement markers for REQ-HD-002
grep -c "@requirement.*REQ-HD-002" packages/core/src/core/geminiChat.ts
# Expected: ≥ 2

# 4. No forbidden patterns in new code
grep -rn -E "(TODO|FIXME|HACK|XXX)" packages/core/src/core/geminiChat.ts | grep -i density | grep -v "NotYetImplemented"
# Expected: No matches (stub comments are acceptable but not TODO markers)
```

## Behavioral Verification

### Field Verification

The verifier MUST read `geminiChat.ts` and confirm:

- [ ] `private densityDirty: boolean = true;` — field declared with initial value `true`
- [ ] Field is a class-level property, not a local variable
- [ ] No other places set `densityDirty` yet (stub phase — the flag is declared but not wired to content adds)

### Method Verification

- [ ] `private async ensureDensityOptimized(): Promise<void>` — exists as a method on GeminiChat
- [ ] Method body is a no-op (returns immediately or has only a return statement)
- [ ] Method has `@plan` and `@requirement` markers
- [ ] Method has `@pseudocode orchestration.md lines 50-99` reference

### Hook Point Verification — ensureCompressionBeforeSend

The verifier MUST read the `ensureCompressionBeforeSend` method and confirm the call order:

- [ ] Step 1: Wait for compression promise (existing)
- [ ] Step 2: `await this.historyService.waitForTokenUpdates()` (existing)
- [ ] Step 3: `await this.ensureDensityOptimized()` — **NEW, after step 2, before step 4**
- [ ] Step 4: `if (this.shouldCompress(pendingTokens))` (existing)

The hook MUST be between waitForTokenUpdates and shouldCompress. If it's anywhere else, the phase FAILS.

### Hook Point Verification — enforceContextWindow

The verifier MUST read the `enforceContextWindow` method and confirm:

- [ ] `await this.ensureDensityOptimized()` is called BEFORE `await this.performCompression(promptId)`
- [ ] `await this.historyService.waitForTokenUpdates()` follows the optimization call
- [ ] Re-check logic exists: `postOptProjected` is calculated after optimization
- [ ] Early return if `postOptProjected <= marginAdjustedLimit`
- [ ] If not early-returned, flow continues to `performCompression()`

### Safety Verification

- [ ] The no-op stub does NOT modify history
- [ ] The no-op stub does NOT set densityDirty
- [ ] The no-op stub does NOT call any methods on historyService
- [ ] The no-op stub does NOT import any new dependencies
- [ ] The emergency path re-check computes `postOptProjected` correctly (same formula as `projected`)

### Regression Verification

```bash
# All existing tests pass (stub is no-op)
npm run test -- --run 2>&1 | tail -10
# Expected: All pass

# HD-specific tests pass
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts 2>&1 | tail -5
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts 2>&1 | tail -5
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-settings.test.ts 2>&1 | tail -5
# Expected: All pass

# Lint passes
npm run lint
# Expected: 0 errors

# Typecheck passes
npm run typecheck
# Expected: 0 errors
```

### No Behavioral Change Verification

- [ ] `ensureCompressionBeforeSend` still compresses when `shouldCompress()` is true (stub doesn't affect this)
- [ ] `enforceContextWindow` still compresses when projected > limit (stub doesn't prevent this)
- [ ] `performCompression` is unchanged
- [ ] `shouldCompress` is unchanged
- [ ] History add paths are unchanged (no densityDirty = true wiring yet)

## Success Criteria

- TypeScript compilation passes
- `densityDirty` field declared correctly
- `ensureDensityOptimized()` exists as no-op stub
- Hook in `ensureCompressionBeforeSend` is in the correct position (after waitForTokenUpdates, before shouldCompress)
- Hook in `enforceContextWindow` is in the correct position (before performCompression, with re-check)
- ALL existing tests pass (no regression)
- No behavioral changes (stub is a no-op)
- Plan and requirement markers present

## Failure Recovery

If verification fails:
1. Document which checks failed
2. Return to P18 to fix
3. Re-run P18a
