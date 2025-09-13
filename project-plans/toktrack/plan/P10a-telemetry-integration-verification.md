# Telemetry Integration Verification

## Phase ID
`PLAN-20250909-TOKTRACK.P10a`

## Purpose
Verify that token tracking metrics are properly integrated with the telemetry system and correctly logged.

## Verification Requirements

### Telemetry Checks
- [ ] Token metrics included in telemetry events
- [ ] TPM recorded in telemetry logs
- [ ] Throttle wait times logged
- [ ] Session token breakdown in telemetry

### Log Verification
```bash
# Check telemetry logs for new metrics
grep -r "tokensPerMinute" packages/core/src/telemetry/
grep -r "throttleWaitTimeMs" packages/core/src/telemetry/
grep -r "sessionTokenUsage" packages/core/src/telemetry/

# Test telemetry integration
npm test packages/core/src/telemetry/
```

### Event Structure
- [ ] EnhancedTokenMetricsEvent properly formatted
- [ ] All token types included in events
- [ ] Metrics aggregated correctly
- [ ] No missing fields in telemetry

### OpenTelemetry Integration
- [ ] Metrics exported to OpenTelemetry
- [ ] Custom metrics properly registered
- [ ] Metric names follow conventions
- [ ] Units specified correctly

### Phase Markers
```bash
grep -r "@plan:PLAN-20250909-TOKTRACK.P10" packages/core/src/telemetry/ | wc -l
# Expected: 6+ occurrences
```

## Success Criteria
- All metrics flow through telemetry
- Logs contain token tracking data
- OpenTelemetry integration working
- No data loss in telemetry pipeline

## Next Phase
Proceed to P11 (Migration) only after verification passes