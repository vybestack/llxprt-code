# Acceptance Test Plan: Issue #489 - Advanced Failover with Metrics

**Issue:** #489
**Branch:** issue489
**Date:** 2025-12-12

## Overview

This document outlines the acceptance test plan for Issue #489, which adds advanced failover capabilities with TPM thresholds, timeouts, and circuit breakers to the load balancing system.

## Test Profile Configuration

### File: `profiles/testlb489.json`

```json
{
  "name": "testlb489",
  "type": "loadbalancer",
  "policy": "failover",
  "profiles": ["synthetic", "chutes", "groqgpt"],
  "ephemeralSettings": {
    "tpm_threshold": 500,
    "timeout_ms": 30000,
    "circuit_breaker_enabled": true,
    "circuit_breaker_failure_threshold": 3,
    "circuit_breaker_failure_window_ms": 60000,
    "circuit_breaker_recovery_timeout_ms": 30000,
    "failover_retry_count": 2,
    "failover_retry_delay_ms": 1000
  }
}
```

### Configuration Explanation

- **Backends**: `synthetic`, `chutes`, `groqgpt` (in priority order)
- **TPM Threshold**: 500 tokens/minute minimum (triggers failover if below)
- **Timeout**: 30 seconds maximum per request (triggers failover if exceeded)
- **Circuit Breaker**:
  - Opens after 3 failures within 60 seconds
  - Waits 30 seconds before attempting recovery
  - Transitions through: closed → open → half-open → closed
- **Retry Settings**:
  - 2 retry attempts per backend before moving to next
  - 1 second delay between retries

## Automated Acceptance Test

### Test Setup

**IMPORTANT:** This automated test creates the profile by **writing the JSON file directly**. Slash commands like `/profile save` are interactive commands that cannot be executed by a script.

### Test Command

```bash
#!/bin/bash
# File: scripts/test-issue489.sh

set -e

echo "=== Acceptance Test for Issue #489 ==="
echo "Testing: Advanced Failover with Metrics, Timeouts, and Circuit Breakers"
echo ""

# Step 1: Create the profile by writing JSON file directly
echo "Creating test profile..."
mkdir -p ~/.llxprt/profiles

cat > ~/.llxprt/profiles/testlb489.json << 'EOF'
{
  "name": "testlb489",
  "version": 1,
  "type": "loadbalancer",
  "policy": "failover",
  "profiles": ["synthetic", "chutes", "groqgpt"],
  "provider": "",
  "model": "",
  "modelParams": {},
  "ephemeralSettings": {
    "tpm_threshold": 500,
    "timeout_ms": 30000,
    "circuit_breaker_enabled": true,
    "circuit_breaker_failure_threshold": 3,
    "circuit_breaker_failure_window_ms": 60000,
    "circuit_breaker_recovery_timeout_ms": 30000,
    "failover_retry_count": 2,
    "failover_retry_delay_ms": 1000
  }
}
EOF

echo "✓ Profile created at ~/.llxprt/profiles/testlb489.json"
echo ""

# Enable debug logging
export LLXPRT_DEBUG=llxprt:*

# Test 1: Basic load balancer execution
echo "Test 1: Running basic load balancer test..."
node scripts/start.js --profile-load testlb489 --prompt "write me a haiku about testing" 2>&1 | tee test-output.log

# Verify logs contain expected markers
echo ""
echo "Verifying debug logs..."

# Check for load balancer initialization
if grep -q "\[LB:failover\]" test-output.log; then
  echo "✓ Load balancer failover strategy active"
else
  echo "✗ ERROR: Load balancer failover strategy not detected"
  exit 1
fi

# Check for backend selection
if grep -q "Selected sub-profile:" test-output.log || grep -q "Trying backend:" test-output.log; then
  echo "✓ Backend selection working"
else
  echo "✗ ERROR: Backend selection not detected"
  exit 1
fi

echo ""
echo "=== Test Passed ==="
echo "Manual verification steps:"
echo "1. Review test-output.log for circuit breaker state transitions"
echo "2. Run '/stats lb' command to verify metrics collection"
echo "3. Test timeout trigger by using slow backend"
echo "4. Test TPM trigger by configuring high threshold"
```

## Manual Test Scenarios

### Scenario 1: Timeout Trigger

**Objective:** Verify timeout mechanism triggers failover

**Steps:**
1. Create profile with `timeout_ms: 5000` (5 seconds)
2. Use a slow backend (e.g., local ollama with large model)
3. Run test prompt
4. Observe logs for timeout messages

**Expected Results:**
```
[LB:timeout] synthetic: Request exceeded 5000ms
[LB:failover] synthetic: Backend timeout (5500ms > 5000ms), failing over
[LB:failover] Trying backend: chutes (attempt 1/2)
```

**Success Criteria:**
- Timeout detected after 5 seconds
- Failover to next backend triggered
- No partial responses from timed-out backend

---

### Scenario 2: Circuit Breaker - Open State

**Objective:** Verify circuit breaker opens after consecutive failures

**Setup:**
1. Use profile with invalid authentication for primary backend
2. Configure `circuit_breaker_failure_threshold: 2`
3. Configure `circuit_breaker_failure_window_ms: 60000`

**Steps:**
1. Run first request (fails authentication)
2. Run second request (fails authentication)
3. Observe circuit breaker opens
4. Run third request
5. Verify primary backend skipped

**Expected Results:**
```
[LB:failover] Trying backend: synthetic (attempt 1/2)
[LB:failover] synthetic failed: 401 Unauthorized
[LB:failover] Trying backend: synthetic (attempt 1/2)
[LB:failover] synthetic failed: 401 Unauthorized
[circuit-breaker] synthetic: Marked unhealthy (2 failures in window)
[circuit-breaker] synthetic: State = open
[LB:failover] Skipping unhealthy backend: synthetic
[LB:failover] Trying backend: chutes (attempt 1/2)
```

**Success Criteria:**
- Circuit opens after 2 failures
- Subsequent requests skip unhealthy backend
- Failover to healthy backend succeeds

---

### Scenario 3: Circuit Breaker - Recovery

**Objective:** Verify circuit breaker recovers after cooldown

**Setup:**
1. Open circuit as in Scenario 2
2. Configure `circuit_breaker_recovery_timeout_ms: 10000` (10 seconds)
3. Fix authentication issue

**Steps:**
1. Wait 10 seconds after circuit opens
2. Run new request
3. Observe circuit goes half-open
4. Verify successful request closes circuit
5. Run another request
6. Verify circuit remains closed

**Expected Results:**
```
[circuit-breaker] synthetic: Testing recovery (half-open)
[LB:failover] Trying backend: synthetic (attempt 1/2)
[LB:failover] Success on backend: synthetic
[circuit-breaker] synthetic: Recovered (state = closed)
```

**Success Criteria:**
- Circuit transitions to half-open after cooldown
- Successful request closes circuit
- Backend available for subsequent requests

---

### Scenario 4: TPM Tracking and Trigger

**Objective:** Verify TPM tracking and failover on low TPM

**Setup:**
1. Configure `tpm_threshold: 10000` (high threshold to trigger easily)
2. Use backend that returns minimal tokens (e.g., very short responses)

**Steps:**
1. Run 5 requests with short prompts
2. Observe TPM calculation in logs
3. Verify failover triggered when TPM < threshold
4. Run `/stats lb` to view TPM metrics

**Expected Results:**
```
[LB:tpm] synthetic: Current TPM = 4200
[LB:failover] synthetic: TPM (4200) below threshold (10000), failing over
[LB:failover] Trying backend: chutes (attempt 1/2)
```

**Stats output:**
```
Backend Metrics:
  synthetic
    Requests: 5
    Success Rate: 100.0%
    Avg Latency: 1234ms
    Tokens: 1050
    TPM: 4200

  chutes
    Requests: 1
    Success Rate: 100.0%
    Avg Latency: 890ms
    Tokens: 250
    TPM: 12500
```

**Success Criteria:**
- TPM calculated from 5-minute rolling window
- Failover triggered when TPM < threshold
- Stats command displays accurate TPM values

---

### Scenario 5: Stats Command Integration

**Objective:** Verify `/stats lb` displays all metrics correctly

**Setup:**
1. Run multiple requests using load balancer
2. Cause some failures (circuit breaker opens)
3. Have some timeouts

**Steps:**
1. Execute several requests with testlb489 profile
2. Run command: `/stats lb`
3. Verify all metrics displayed

**Expected Output:**
```
Load Balancer Statistics
Profile: testlb489
Total Requests: 12

Backend Metrics:
  synthetic
    Requests: 8
    Success Rate: 75.0%
    Avg Latency: 1456ms
    Tokens: 3200
    TPM: 640

  chutes
    Requests: 4
    Success Rate: 100.0%
    Avg Latency: 980ms
    Tokens: 1800
    TPM: 900

  groqgpt
    Requests: 0
    Success Rate: N/A
    Avg Latency: N/A
    Tokens: 0
    TPM: 0

Circuit Breaker States:
  synthetic: open
  chutes: closed
  groqgpt: closed
```

**Success Criteria:**
- All backends listed with metrics
- Success rate calculated correctly
- Average latency accurate
- Token counts match actual usage
- TPM values reflect recent activity
- Circuit breaker states correct
- Unused backends show zero metrics

---

### Scenario 6: Set Command Integration

**Objective:** Verify all ephemeral settings accessible via `/set` command

**Steps:**
1. Test each load balancer setting:
   ```
   /set tpm_threshold 1000
   /set timeout_ms 30000
   /set circuit_breaker_enabled true
   /set circuit_breaker_failure_threshold 3
   /set circuit_breaker_failure_window_ms 60000
   /set circuit_breaker_recovery_timeout_ms 30000
   ```
2. Verify settings accepted and stored
3. Test invalid values:
   ```
   /set tpm_threshold -500    # Should error: must be positive
   /set timeout_ms abc        # Should error: must be number
   /set circuit_breaker_enabled maybe  # Should error: must be boolean
   ```
4. Test `/set unset` for each setting
5. Verify help text:
   ```
   /set tpm_threshold  # Should show help for this setting
   ```

**Expected Results:**
- All settings accept valid values
- Invalid values rejected with clear error messages
- Help text displayed for each setting
- `/set unset <key>` clears each setting

**Success Criteria:**
- All 6 settings accessible via `/set`
- Validation works correctly for each type
- Help text accurate and informative
- Unset works for all settings

---

### Scenario 7: Profile Save/Load with Ephemeral Settings

**Objective:** Verify ephemeral settings persist with load balancer profiles

**IMPORTANT DISTINCTION:**
- **Manual/Interactive Testing**: Use `/profile save` and `/profile load` slash commands to verify the interactive workflow works correctly
- **Automated Testing**: Create profile JSON files directly using file writes (slash commands cannot be executed by scripts)

**Steps (Manual Interactive Testing):**
1. Set ephemeral settings via `/set` commands:
   ```
   /set tpm_threshold 1000
   /set timeout_ms 30000
   /set circuit_breaker_enabled true
   /set circuit_breaker_failure_threshold 5
   ```
2. Save load balancer profile via slash command:
   ```
   /profile save loadbalancer testlb489save failover synthetic chutes
   ```
3. Verify profile file contains settings:
   ```bash
   cat ~/.llxprt/profiles/testlb489save.json
   ```
   Should contain:
   ```json
   {
     "version": 1,
     "type": "loadbalancer",
     "policy": "failover",
     "profiles": ["synthetic", "chutes"],
     "ephemeralSettings": {
       "tpm_threshold": 1000,
       "timeout_ms": 30000,
       "circuit_breaker_enabled": true,
       "circuit_breaker_failure_threshold": 5,
       "circuit_breaker_failure_window_ms": 60000,
       "circuit_breaker_recovery_timeout_ms": 30000
     }
   }
   ```
4. Clear settings via slash commands:
   ```
   /set unset tpm_threshold
   /set unset timeout_ms
   /set unset circuit_breaker_enabled
   /set unset circuit_breaker_failure_threshold
   ```
5. Load profile via slash command:
   ```
   /profile load testlb489save
   ```
6. Verify settings restored (check runtime ephemeral settings)
7. Test with CLI `--profile-load` argument:
   ```bash
   node scripts/start.js --profile-load testlb489save --prompt "test"
   ```

**Alternative (Automated Testing):**
- Create profile JSON file directly by writing to `~/.llxprt/profiles/testlb489save.json`
- Test loading with `--profile-load` CLI argument
- Verify settings applied correctly

**Expected Results:**
- Profile JSON contains all ephemeral settings
- Settings restored after `/profile load` (interactive)
- Settings restored after `--profile-load` (CLI)
- Protected settings (auth-key, etc.) NOT in profile
- All Phase 2 and Phase 3 settings preserved

**Success Criteria:**
- Ephemeral settings saved to profile JSON (when using `/profile save`)
- Settings restored correctly on load (both interactive and CLI)
- Works with both interactive slash commands and CLI arguments
- No protected settings leaked to profile
- Profile JSON files can be created manually and loaded successfully

---

### Scenario 8: End-to-End Integration

**Objective:** Verify all features work together in realistic scenario

**Test Profile:** Use `testlb489.json` from above

**Steps:**
1. Start with fresh session
2. Enable debug logging: `export LLXPRT_DEBUG=llxprt:*`
3. Run complex prompt:
   ```bash
   node scripts/start.js --profile-load testlb489 --prompt "analyze this codebase and tell me what it does. do not use a subagent."
   ```
4. Observe backend selection and failover logic
5. Run `/stats lb` to view metrics
6. Run second complex prompt
7. Verify circuit breaker state management
8. Run `/stats lb` again to see updated metrics

**Expected Behavior:**
1. Initial request to `synthetic` backend
2. If successful, TPM tracked and metrics recorded
3. If timeout/failure, failover to `chutes`
4. Circuit breaker tracks failures per backend
5. Stats command shows comprehensive metrics
6. Subsequent requests respect circuit breaker states
7. TPM monitoring continues across requests

**Success Criteria:**
- All failover triggers work correctly
- Circuit breaker state persists across requests
- TPM calculated from rolling window
- Metrics accurate and comprehensive
- Stats command displays all data
- Debug logs show all decision points
- No memory leaks (metrics cleanup working)

---

## Verification Checklist

### Functionality
- [ ] Timeout trigger activates correctly
- [ ] Circuit breaker opens after threshold failures
- [ ] Circuit breaker closes after successful recovery
- [ ] TPM tracking accurate (5-minute rolling window)
- [ ] TPM trigger activates when below threshold
- [ ] Backend metrics collected correctly
- [ ] `/stats lb` command displays all metrics
- [ ] All backends tracked independently
- [ ] All ephemeral settings accessible via `/set` command
- [ ] Validation works for each setting type
- [ ] Profile save includes all ephemeral settings
- [ ] Profile load restores all ephemeral settings

### Code Quality
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] No TypeScript errors (`npm run typecheck`)
- [ ] No linting errors (`npm run lint`)
- [ ] No `any` types used
- [ ] No TODO/STUB comments in code
- [ ] All functions have proper type signatures
- [ ] Debug logging comprehensive

### Performance
- [ ] No memory leaks (metrics cleanup verified)
- [ ] TPM buckets cleaned up after 5 minutes
- [ ] Circuit breaker state pruning works
- [ ] No performance degradation with many requests
- [ ] Timeout promises properly cleaned up

### Documentation
- [ ] Code comments explain complex logic
- [ ] All public APIs documented
- [ ] Test files have clear descriptions
- [ ] Debug logs are informative

---

## Debug Log Analysis

### Key Log Patterns to Verify

**Circuit Breaker:**
```
[circuit-breaker] <backend>: Marked unhealthy (N failures in window)
[circuit-breaker] <backend>: State = open
[circuit-breaker] <backend>: Testing recovery (half-open)
[circuit-breaker] <backend>: Recovered (state = closed)
```

**Timeout:**
```
[LB:timeout] <backend>: Request exceeded <N>ms
[LB:failover] <backend>: Backend timeout (<actual>ms > <limit>ms), failing over
```

**TPM:**
```
[LB:tpm] <backend>: Current TPM = <value>
[LB:failover] <backend>: TPM (<current>) below threshold (<limit>), failing over
```

**Failover:**
```
[LB:failover] Trying backend: <name> (attempt N/M)
[LB:failover] Success on backend: <name>
[LB:failover] <name> failed after N attempts: <error>
[LB:failover] Skipping unhealthy backend: <name>
```

---

## Known Limitations

1. **Circuit Breaker State**: Not persisted across sessions (ephemeral)
2. **TPM Calculation**: Requires at least one completed request
3. **Timeout Granularity**: Minimum 1ms, controlled by JavaScript setTimeout
4. **Memory Usage**: TPM buckets stored for 5 minutes per backend

---

## Troubleshooting

### Issue: Timeout not triggering
- Verify `timeout_ms` configured in ephemeral settings
- Check if backend actually taking longer than timeout
- Review debug logs for timeout wrapper activation

### Issue: Circuit breaker not opening
- Verify `circuit_breaker_enabled: true`
- Check failure count vs threshold
- Confirm failures within configured time window
- Review failure timestamps in debug logs

### Issue: TPM trigger not activating
- Verify `tpm_threshold` configured
- Check if requests returning enough tokens
- Ensure 5-minute window has data
- Review TPM calculation in logs

### Issue: Stats command shows no data
- Verify load balancer profile active
- Check if any requests completed
- Ensure provider is LoadBalancingProvider instance
- Review metrics initialization in code

---

## Success Declaration

This acceptance test is **COMPLETE** when:

1. ✅ All automated tests pass
2. ✅ All manual scenarios verified
3. ✅ All verification checklist items checked
4. ✅ No lint/typecheck/test errors
5. ✅ Debug logging shows all features working
6. ✅ Stats command displays accurate metrics
7. ✅ Performance requirements met
8. ✅ Code review approved (RULES.md compliant)

---

## Test Report Template

After completing tests, fill out this report:

```
=== Issue #489 Acceptance Test Report ===
Date: [DATE]
Tester: [NAME]
Branch: issue489
Commit: [HASH]

AUTOMATED TESTS:
[ ] Basic load balancer execution
[ ] Backend selection
[ ] Failover strategy active
[ ] Debug logging present

MANUAL SCENARIOS:
[ ] Scenario 1: Timeout Trigger
[ ] Scenario 2: Circuit Breaker - Open
[ ] Scenario 3: Circuit Breaker - Recovery
[ ] Scenario 4: TPM Tracking
[ ] Scenario 5: Stats Command
[ ] Scenario 6: Set Command Integration
[ ] Scenario 7: Profile Save/Load with Ephemeral Settings
[ ] Scenario 8: End-to-End Integration

CODE QUALITY:
[ ] Unit tests: [PASS/FAIL] - [X/Y passing]
[ ] Integration tests: [PASS/FAIL]
[ ] Typecheck: [PASS/FAIL]
[ ] Lint: [PASS/FAIL]
[ ] Build: [PASS/FAIL]

ISSUES FOUND:
[List any issues or bugs discovered]

ADDITIONAL NOTES:
[Any observations or recommendations]

STATUS: [PASS/FAIL]
```

---

**End of Acceptance Test Plan**
