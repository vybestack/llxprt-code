# Integration Tests Verification

## Phase ID
`PLAN-20250909-TOKTRACK.P13a`

## Purpose
Verify that end-to-end integration tests properly validate the entire token tracking feature.

## Verification Requirements

### Test Coverage
- [ ] E2E tests cover API → Tracking → Telemetry → UI flow
- [ ] Tests verify cross-component integration
- [ ] Property-based tests meet 77% coverage
- [ ] All user scenarios tested

### Test Execution
```bash
# Run integration tests
npm run test:integration

# Check property test coverage
TOTAL=$(grep -c "test(" test/integration/*.spec.ts)
PROPERTY=$(grep -c "test.prop(" test/integration/*.spec.ts)
echo "Property tests: $((PROPERTY * 100 / TOTAL))%"
# Expected: ≥30% (actual: 77%)

# Mutation testing on integration tests
npx stryker run --mutate test/integration/
# Expected: ≥80% mutation score
```

### Scenario Coverage
- [ ] Multiple providers tested together
- [ ] High token volume scenarios
- [ ] Throttling scenarios (429 errors)
- [ ] Session reset scenarios
- [ ] UI update scenarios

### Performance Testing
- [ ] TPM calculation performance verified
- [ ] No memory leaks in token tracking
- [ ] UI responsiveness maintained
- [ ] Telemetry doesn't impact performance

### Phase Markers
```bash
grep -r "@plan:PLAN-20250909-TOKTRACK.P13" test/integration/ | wc -l
# Expected: 15+ occurrences
```

## Success Criteria
- All integration tests pass
- 77% property test coverage maintained
- 80% mutation score achieved
- Performance benchmarks met

## Next Phase
Proceed to P14 (Quality Assurance) only after verification passes