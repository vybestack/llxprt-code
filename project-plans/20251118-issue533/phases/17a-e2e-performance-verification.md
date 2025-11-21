# Phase 17a: E2E Performance Verification

## Phase ID
`PLAN-20251118-ISSUE533.P17a`

## Prerequisites
- Required: Phase 17 completed (performance tests executed)
- Verification: Performance benchmarks met
- Expected: Feature performs acceptably for CI/CD use

## Verification Commands

```bash
# 1. Check Phase 17 completion marker
test -f project-plans/20251118-issue533/.completed/P17.md
# Expected: File exists

# 2. Verify all tests pass
npm test
# Expected: All pass

# 3. TypeScript compiles
npm run typecheck
# Expected: 0 errors

# 4. Lint check
npm run lint
# Expected: No errors

# 5. Build succeeds
npm run build
# Expected: Success

# 6. Quick performance smoke test
PROFILE='{"provider":"openai","model":"gpt-4","key":"sk-test"}'
time llxprt --profile "$PROFILE" --prompt "hi" --dry-run
# Expected: Completes in < 2 seconds
```

## Manual Verification Checklist

### Performance Test Results
- [ ] Phase 17 completion marker exists
- [ ] Startup time: [Xms] ≤ 200ms overhead [PASS/FAIL]
- [ ] Large profile parsing (10KB): [Xms] ≤ 100ms [PASS/FAIL]
- [ ] Repeated invocations avg: [Xs] ≤ 2s per call [PASS/FAIL]
- [ ] Memory usage: [XMB] ≤ 200MB [PASS/FAIL]
- [ ] JSON parsing edge cases: [PASS/FAIL]
- [ ] Validation performance: [Xms] ≤ 50ms [PASS/FAIL]

### Benchmark Acceptance

| Operation | Target | Acceptable | Actual | Status |
|-----------|--------|------------|--------|--------|
| Profile parsing (1KB) | <20ms | <50ms | [X]ms | [OK/FAIL] |
| Profile parsing (10KB) | <50ms | <100ms | [X]ms | [OK/FAIL] |
| Validation (complex) | <30ms | <50ms | [X]ms | [OK/FAIL] |
| Startup overhead | <100ms | <200ms | [X]ms | [OK/FAIL] |
| Memory footprint | <150MB | <200MB | [X]MB | [OK/FAIL] |

### Code Quality
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] All performance tests pass
- [ ] TypeScript compiles
- [ ] Build succeeds
- [ ] Lint passes
- [ ] No performance regressions vs --profile-load

### Performance Comparison

```bash
# Compare --profile vs --profile-load startup time
PROFILE='{"provider":"openai","model":"gpt-4","key":"sk-test"}'

echo "=== --profile startup time ==="
time llxprt --profile "$PROFILE" --prompt "hi" --dry-run

echo "=== --profile-load startup time ==="
time llxprt --profile-load synthetic --prompt "hi" --dry-run

# Expected: Times should be similar (within 200ms)
```

### CI/CD Simulation

```bash
# Simulate repeated CI/CD calls
PROFILE='{"provider":"openai","model":"gpt-4","key":"sk-test"}'

START=$(date +%s)
for i in {1..10}; do
  llxprt --profile "$PROFILE" --prompt "Task $i" --dry-run > /dev/null 2>&1
done
END=$(date +%s)

TOTAL=$((END - START))
AVG=$(echo "scale=2; $TOTAL / 10" | bc)

echo "Total: ${TOTAL}s, Average: ${AVG}s per call"
# Expected: Average < 2s per call
```

## Exit Criteria

- All performance benchmarks within acceptable range
- No performance degradation vs --profile-load
- CI/CD use case performs well (<2s per invocation)
- Memory usage stable and reasonable
- All automated checks pass
- Ready for Phase 18 (final validation)

## Phase Completion Marker

Create: `project-plans/20251118-issue533/.completed/P17a.md`

```markdown
Phase: P17a
Completed: [YYYY-MM-DD HH:MM]
Performance Verification Results:
  - Startup time: [X]ms [PASS/FAIL]
  - Large profile parsing: [X]ms [PASS/FAIL]
  - Repeated invocations avg: [X]s [PASS/FAIL]
  - Memory usage: [X]MB [PASS/FAIL]
  - JSON parsing edge cases: PASS
  - Validation performance: [X]ms [PASS/FAIL]
All Benchmarks: [PASS/FAIL]
Performance vs --profile-load: [Better/Same/Worse by X%]
CI/CD Simulation: [X]s avg per call [PASS/FAIL]
Status: VERIFIED - Ready for Phase 18
```

## Notes

- Performance targets are for CI/CD suitability
- Acceptable range allows for system variance
- Memory usage should be monitored over time
- Repeated invocations simulate real-world CI/CD
- All benchmarks should be within acceptable limits
