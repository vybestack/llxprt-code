# Phase 17a: E2E Performance Verification

## Phase ID
`PLAN-20251118-ISSUE533.P17a`

## Prerequisites
- Required: Phase 16 completed (security verified)
- Verification: Security tests pass
- Expected: Performance acceptable for CI/CD use

## Performance Test Scenarios

### Scenario 1: Startup Time Comparison

```bash
# @plan PLAN-20251118-ISSUE533.P17a
# @requirement REQ-PERF-001

# Measure startup time with --profile vs --profile-load

# Test 1: With --profile (inline)
PROFILE='{"provider":"openai","model":"gpt-4","key":"sk-test"}'
time llxprt --profile "$PROFILE" --prompt "hi" --dry-run

# Test 2: With --profile-load (file)
time llxprt --profile-load test-profile --prompt "hi" --dry-run

# Test 3: No profile (baseline)
time llxprt --provider openai --model gpt-4 --key sk-test --prompt "hi" --dry-run
```

**Expected**:
- --profile startup: ≤ 200ms overhead vs --profile-load
- No significant performance degradation
- Parsing overhead minimal (<50ms)

**Measurement**:
```bash
# Run 10 times and average
for i in {1..10}; do
  /usr/bin/time -p llxprt --profile "$PROFILE" --prompt "hi" --dry-run 2>&1 | grep real
done | awk '{sum+=$2; count++} END {print "Avg:", sum/count, "sec"}'
```

### Scenario 2: Large Profile Parsing

```bash
# @plan PLAN-20251118-ISSUE533.P17a
# @requirement REQ-PERF-001

# Test with maximum allowed profile size (~10KB)
LARGE_PROFILE='{"provider":"openai","model":"gpt-4","key":"sk-test"'
for i in {1..100}; do
  LARGE_PROFILE+=',  "param'$i'":"'$(head -c 80 /dev/urandom | base64)'"'
done
LARGE_PROFILE+='}'

# Measure parsing time
time llxprt --profile "$LARGE_PROFILE" --prompt "hi" --dry-run
```

**Expected**:
- Parsing time: <100ms for 10KB profile
- No memory issues
- No noticeable lag

### Scenario 3: Repeated Invocations (CI/CD Simulation)

```bash
# @plan PLAN-20251118-ISSUE533.P17a
# @requirement REQ-PERF-001

# Simulate CI/CD pipeline with multiple CLI calls
PROFILE='{"provider":"openai","model":"gpt-4","key":"sk-test"}'

START=$(date +%s)
for i in {1..20}; do
  llxprt --profile "$PROFILE" --prompt "Task $i" --dry-run > /dev/null 2>&1
done
END=$(date +%s)

TOTAL=$((END - START))
AVG=$(echo "scale=2; $TOTAL / 20" | bc)

echo "Total time: ${TOTAL}s"
echo "Average per invocation: ${AVG}s"
```

**Expected**:
- Total time: <40 seconds (20 invocations)
- Average per invocation: <2 seconds
- Consistent performance (no degradation over time)

### Scenario 4: Memory Usage

```bash
# @plan PLAN-20251118-ISSUE533.P17a
# @requirement REQ-PERF-001

# Measure memory usage with --profile
PROFILE='{"provider":"openai","model":"gpt-4","key":"sk-test"}'

# Run with memory profiling (macOS)
/usr/bin/time -l llxprt --profile "$PROFILE" --prompt "hi" --dry-run 2>&1 | grep "maximum resident set size"

# Or use GNU time (Linux)
# /usr/bin/time -v llxprt --profile "$PROFILE" --prompt "hi" --dry-run 2>&1 | grep "Maximum resident set size"
```

**Expected**:
- Memory usage: Similar to --profile-load
- No memory leaks
- Reasonable memory footprint (<200MB)

### Scenario 5: JSON Parsing Edge Cases

```bash
# @plan PLAN-20251118-ISSUE533.P17a
# @requirement REQ-PERF-001

# Test performance with deeply nested (but valid) structures
PROFILE='{"provider":"openai","model":"gpt-4","key":"sk-test","config":{"level1":{"level2":{"level3":{"level4":{"value":"test"}}}}}}'

# Measure parsing time
time llxprt --profile "$PROFILE" --prompt "hi" --dry-run

# Test with many top-level keys
MANY_KEYS='{"provider":"openai","model":"gpt-4","key":"sk-test"'
for i in {1..100}; do
  MANY_KEYS+=',"key'$i'":"value'$i'"'
done
MANY_KEYS+='}'

time llxprt --profile "$MANY_KEYS" --prompt "hi" --dry-run
```

**Expected**:
- Nesting parsing: <50ms
- Many keys parsing: <100ms
- No performance cliff with valid structures

### Scenario 6: Validation Performance

```bash
# @plan PLAN-20251118-ISSUE533.P17a
# @requirement REQ-PERF-001

# Test validation time for complex profiles
COMPLEX_PROFILE='{"provider":"openai","model":"gpt-4","key":"sk-test","temperature":0.7,"maxTokens":2000,"topP":0.9,"presencePenalty":0.5,"frequencyPenalty":0.5,"stop":["END","STOP"],"user":"test-user","seed":12345}'

# Measure validation time
time llxprt --profile "$COMPLEX_PROFILE" --prompt "hi" --dry-run
```

**Expected**:
- Validation time: <50ms
- No significant overhead from Zod schema validation

## Performance Acceptance Criteria

### Benchmarks

| Operation | Target | Acceptable |
|-----------|--------|------------|
| Profile parsing (1KB) | <20ms | <50ms |
| Profile parsing (10KB) | <50ms | <100ms |
| Validation (complex) | <30ms | <50ms |
| Startup overhead | <100ms | <200ms |
| Memory footprint | <150MB | <200MB |

## Verification Checklist

- [ ] Startup time acceptable
- [ ] Large profile parsing within limits
- [ ] Repeated invocations perform well
- [ ] Memory usage reasonable
- [ ] JSON parsing edge cases handled
- [ ] Validation performance acceptable
- [ ] No performance regressions vs --profile-load

## Success Criteria

- All benchmarks within acceptable range
- No performance degradation vs existing --profile-load
- CI/CD use case performs well (fast repeated invocations)
- Memory usage stable

## Phase Completion Marker

Create: `project-plans/20251118-issue533/.completed/P17a.md`

```markdown
Phase: P17a
Completed: [YYYY-MM-DD HH:MM]
Performance Results:
  - Startup time: [Xms] [PASS/FAIL]
  - Large profile parsing: [Xms] [PASS/FAIL]
  - Repeated invocations avg: [Xs] [PASS/FAIL]
  - Memory usage: [XMB] [PASS/FAIL]
  - JSON parsing edge cases: [PASS/FAIL]
  - Validation performance: [Xms] [PASS/FAIL]
All Benchmarks: [PASS/FAIL]
Performance vs --profile-load: [Better/Same/Worse by X%]
```
