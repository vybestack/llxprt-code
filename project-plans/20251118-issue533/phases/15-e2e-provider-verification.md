# Phase 15a: E2E Provider Verification

## Phase ID
`PLAN-20251118-ISSUE533.P15a`

## Prerequisites
- Required: Phase 14 completed (regression tests pass)
- Verification: All tests pass, build succeeds
- Expected: Feature ready for real provider testing

## End-to-End Test Scenarios

### Scenario 1: OpenAI Provider

```bash
# @plan PLAN-20251118-ISSUE533.P15a
# @requirement REQ-E2E-001

# Test with real OpenAI API (requires valid key)
OPENAI_KEY="sk-..." # Set real key
PROFILE='{"provider":"openai","model":"gpt-4","key":"'$OPENAI_KEY'"}'

llxprt --profile "$PROFILE" --prompt "Say 'Hello from inline profile'"
```

**Expected**:
- CLI starts without errors
- Profile parsed and applied
- API call to OpenAI succeeds
- Response contains "Hello from inline profile"
- Exit code 0

**Verification**:
```bash
# Check logs for profile application
# Verify provider initialized correctly
# Confirm API response received
```

### Scenario 2: Anthropic Provider

```bash
# @plan PLAN-20251118-ISSUE533.P15a
# @requirement REQ-E2E-001

ANTHROPIC_KEY="sk-ant-..." # Set real key
PROFILE='{"provider":"anthropic","model":"claude-sonnet-4","key":"'$ANTHROPIC_KEY'"}'

llxprt --profile "$PROFILE" --prompt "Say 'Anthropic works'"
```

**Expected**:
- Profile applied successfully
- Anthropic API called
- Response received
- Exit code 0

### Scenario 3: Google Provider

```bash
# @plan PLAN-20251118-ISSUE533.P15a
# @requirement REQ-E2E-001

GOOGLE_KEY="AIza..." # Set real key
PROFILE='{"provider":"google","model":"gemini-pro","key":"'$GOOGLE_KEY'"}'

llxprt --profile "$PROFILE" --prompt "Say 'Google works'"
```

**Expected**:
- Profile applied successfully
- Google API called
- Response received
- Exit code 0

### Scenario 4: Azure OpenAI Provider

```bash
# @plan PLAN-20251118-ISSUE533.P15a
# @requirement REQ-E2E-001

AZURE_KEY="..." # Set real key
AZURE_ENDPOINT="https://example.openai.azure.com"
PROFILE='{"provider":"azure","model":"gpt-4","key":"'$AZURE_KEY'","baseurl":"'$AZURE_ENDPOINT'"}'

llxprt --profile "$PROFILE" --prompt "Say 'Azure works'"
```

**Expected**:
- Profile applied with baseurl
- Azure endpoint called
- Response received
- Exit code 0

### Scenario 5: Override Precedence with Real API

```bash
# @plan PLAN-20251118-ISSUE533.P15a
# @requirement REQ-INT-002.1

PROFILE='{"provider":"openai","model":"gpt-3.5-turbo","key":"'$OPENAI_KEY'","temperature":0.5}'

llxprt --profile "$PROFILE" --model gpt-4 --temperature 0.9 --prompt "Test override"
```

**Expected**:
- Profile loaded
- Model override to gpt-4 applied
- Temperature override to 0.9 applied
- API called with gpt-4 and temp 0.9
- Exit code 0

## Verification Checklist

- [ ] OpenAI provider works with --profile
- [ ] Anthropic provider works with --profile
- [ ] Google provider works with --profile
- [ ] Azure provider works with --profile and baseurl
- [ ] Override flags work with real API calls
- [ ] API responses received correctly
- [ ] No errors in logs
- [ ] Exit codes correct (0 for success)

## Success Criteria

- All 4 providers work with --profile
- Override precedence verified with real APIs
- No crashes or unexpected errors
- Logs show correct provider initialization

## Manual Testing Notes

**IMPORTANT**: These tests require:
- Valid API keys for each provider
- Network access to provider APIs
- May incur small API costs

**Test Mode Alternative**:
- Use `--dry-run` flag if available
- Mock providers in test environment
- Verify profile parsing and application without API calls

## Phase Completion Marker

Create: `project-plans/20251118-issue533/.completed/P15a.md`

```markdown
Phase: P15a
Completed: [YYYY-MM-DD HH:MM]
E2E Provider Tests:
  - OpenAI: [PASS/SKIP/FAIL]
  - Anthropic: [PASS/SKIP/FAIL]
  - Google: [PASS/SKIP/FAIL]
  - Azure: [PASS/SKIP/FAIL]
Override Precedence: [PASS/SKIP/FAIL]
Notes:
  - Tests run with: [Real APIs / Mocked / Dry-run]
  - Issues found: [None / List issues]
```
