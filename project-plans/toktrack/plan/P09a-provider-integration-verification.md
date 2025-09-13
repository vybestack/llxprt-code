# Provider Integration Verification

## Phase ID
`PLAN-20250909-TOKTRACK.P09a`

## Purpose
Verify that token tracking is properly integrated with all provider implementations (Gemini, OpenAI, Anthropic).

## Verification Requirements

### Provider-Specific Checks
- [ ] Gemini provider extracts tokens from API responses
- [ ] OpenAI provider extracts tokens from usage fields
- [ ] Anthropic provider extracts tokens from headers/response
- [ ] All providers call ProviderPerformanceTracker methods

### Integration Testing
```bash
# Test each provider
npm test packages/core/src/providers/gemini/
npm test packages/core/src/providers/openai/
npm test packages/core/src/providers/anthropic/

# Verify token extraction
grep -r "extractTokenCounts" packages/core/src/providers/
```

### End-to-End Testing
- [ ] Token counts flow from API response to tracker
- [ ] TPM updates correctly for each provider
- [ ] Throttle wait times tracked for 429 errors
- [ ] Session tokens accumulate across providers

### Cross-Provider Consistency
- [ ] All providers use same token tracking interface
- [ ] Metrics are consistent across providers
- [ ] No provider-specific bugs in tracking

### Phase Markers
```bash
grep -r "@plan:PLAN-20250909-TOKTRACK.P09" packages/core/src/providers/ | wc -l
# Expected: 12+ occurrences (across 3 providers)
```

## Success Criteria
- All providers correctly track tokens
- Metrics flow through entire system
- Cross-provider consistency verified
- No provider-specific issues

## Next Phase
Proceed to P10 (Telemetry Integration) only after verification passes