# Phase 16a: E2E Security Verification

## Phase ID
`PLAN-20251118-ISSUE533.P16a`

## Prerequisites
- Required: Phase 15 completed (provider verification done)
- Verification: Basic E2E scenarios work
- Expected: Security validations working

## Security Test Scenarios

### Scenario 1: Size Limit Enforcement

```bash
# @plan PLAN-20251118-ISSUE533.P16a
# @requirement REQ-PROF-003.3

# Create oversized profile (>10KB)
LARGE_DATA=$(python3 -c "print('x' * 10241)")
PROFILE='{"provider":"openai","model":"gpt-4","key":"sk-test","data":"'$LARGE_DATA'"}'

llxprt --profile "$PROFILE" --prompt "test"
```

**Expected**:
- Error: "Profile JSON exceeds maximum size of 10KB"
- Exit code: 1
- No profile applied
- No API call made

### Scenario 2: Nesting Depth Limit

```bash
# @plan PLAN-20251118-ISSUE533.P16a
# @requirement REQ-PROF-003.3

# Create deeply nested profile (>5 levels)
PROFILE='{"provider":"openai","model":"gpt-4","key":"sk-test","a":{"b":{"c":{"d":{"e":{"f":"too deep"}}}}}}'

llxprt --profile "$PROFILE" --prompt "test"
```

**Expected**:
- Error: "Profile nesting depth exceeds maximum of 5"
- Exit code: 1
- No profile applied

### Scenario 3: Prototype Pollution Protection

```bash
# @plan PLAN-20251118-ISSUE533.P16a
# @requirement REQ-PROF-003.3

# Attempt __proto__ injection
PROFILE='{"provider":"openai","model":"gpt-4","key":"sk-test","__proto__":{"polluted":true}}'

llxprt --profile "$PROFILE" --prompt "test"
```

**Expected**:
- Error: "Disallowed field '__proto__'"
- Exit code: 1
- No prototype pollution
- Object.prototype unchanged

**Verification**:
```bash
# After running, verify no pollution
node -e "console.log(Object.prototype.polluted)" # Should be undefined
```

### Scenario 4: Constructor Field Protection

```bash
# @plan PLAN-20251118-ISSUE533.P16a
# @requirement REQ-PROF-003.3

# Attempt constructor injection
PROFILE='{"provider":"openai","model":"gpt-4","key":"sk-test","constructor":{"polluted":true}}'

llxprt --profile "$PROFILE" --prompt "test"
```

**Expected**:
- Error: "Disallowed field 'constructor'"
- Exit code: 1
- No object pollution

### Scenario 5: Malicious JSON Structures

```bash
# @plan PLAN-20251118-ISSUE533.P16a
# @requirement REQ-PROF-003.1

# Test various malicious payloads
PROFILES=(
  '{"provider":"openai","model":"gpt-4","key":"sk-test","eval":"require(\"child_process\").exec(\"whoami\")"}'
  '{"provider":"openai","model":"gpt-4","key":"sk-test","__dirname":"/etc"}'
  '{"provider":"openai","model":"gpt-4","key":"sk-test","process":{"env":{"PATH":"malicious"}}}'
)

for PROFILE in "${PROFILES[@]}"; do
  echo "Testing: $PROFILE"
  llxprt --profile "$PROFILE" --prompt "test" 2>&1 | grep -i "error\|disallowed"
done
```

**Expected**:
- All malicious payloads rejected
- No code execution
- No file system access
- No environment pollution

### Scenario 6: Key Exposure in Logs

```bash
# @plan PLAN-20251118-ISSUE533.P16a
# @requirement REQ-SEC-001

PROFILE='{"provider":"openai","model":"gpt-4","key":"sk-secret-key-12345"}'

llxprt --profile "$PROFILE" --prompt "test" --verbose 2>&1 | tee output.log

# Check logs for key exposure
grep -i "sk-secret-key-12345" output.log
```

**Expected**:
- API key NOT visible in logs
- Key should be redacted or not logged
- Exit code may be 0 or 1 (depending on API availability)

**Verification**:
```bash
# No key in output
! grep "sk-secret-key-12345" output.log
```

### Scenario 7: Key Exposure in Error Messages

```bash
# @plan PLAN-20251118-ISSUE533.P16a
# @requirement REQ-SEC-001

# Invalid profile to trigger error
PROFILE='{"provider":"openai","key":"sk-secret-12345"}' # Missing model

llxprt --profile "$PROFILE" --prompt "test" 2>&1 | tee error.log

# Check error message doesn't contain key
grep "sk-secret-12345" error.log
```

**Expected**:
- Error about missing model
- Key NOT in error message
- No key exposure

### Scenario 8: Environment Variable Security

```bash
# @plan PLAN-20251118-ISSUE533.P16a
# @requirement REQ-INT-003.2

# Test that env var doesn't leak in process listing
export LLXPRT_PROFILE='{"provider":"openai","model":"gpt-4","key":"sk-env-secret"}'

llxprt --prompt "test" &
PID=$!

# Check if key visible in process listing
ps aux | grep $PID | grep -v grep

kill $PID 2>/dev/null || true
unset LLXPRT_PROFILE
```

**Expected**:
- Process listing does not show full profile
- Key not visible in ps output
- (May still show --profile flag, but not full JSON)

## Verification Checklist

- [ ] Size limit (10KB) enforced
- [ ] Nesting depth limit (5) enforced
- [ ] __proto__ injection blocked
- [ ] constructor injection blocked
- [ ] Malicious JSON rejected
- [ ] API keys not in logs
- [ ] API keys not in error messages
- [ ] Environment variables secure

## Success Criteria

- All security validations work
- No prototype pollution possible
- No key exposure in logs/errors
- Size and nesting limits enforced
- Malicious payloads rejected

## Phase Completion Marker

Create: `project-plans/20251118-issue533/.completed/P16a.md`

```markdown
Phase: P16a
Completed: [YYYY-MM-DD HH:MM]
Security Verification:
  - Size limit: [PASS/FAIL]
  - Nesting depth: [PASS/FAIL]
  - __proto__ protection: [PASS/FAIL]
  - constructor protection: [PASS/FAIL]
  - Malicious JSON: [PASS/FAIL]
  - Key exposure in logs: [PASS/FAIL]
  - Key exposure in errors: [PASS/FAIL]
  - Env var security: [PASS/FAIL]
Issues Found: [None / List issues]
All Security Checks: [PASS/FAIL]
```
