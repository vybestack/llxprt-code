# Phase 4a: Settings Service TDD Verification

## Objective

Verify that TDD tests are behavioral and comprehensive before implementation.

## Verification Task

```bash
#!/bin/bash
# Execute verification for TDD phase

echo "=== Phase 4a: TDD Verification ==="

# 1. Check tests exist and compile
echo "Checking test compilation..."
npm run typecheck packages/core/test/settings/SettingsService.spec.ts
if [ $? -ne 0 ]; then
  echo "FAIL: Tests don't compile"
  exit 1
fi

# 2. Run tests - all should fail with NotYetImplemented
echo "Running tests (should fail with NotYetImplemented)..."
npm test packages/core/test/settings/SettingsService.spec.ts 2>&1 | grep "NotYetImplemented"
if [ $? -ne 0 ]; then
  echo "FAIL: Tests not failing with NotYetImplemented - may have implementation"
  exit 1
fi

# 3. Check for behavioral assertions
echo "Checking for behavioral assertions..."
ASSERTIONS=$(grep -c "toBe\|toEqual\|toThrow\|toMatch\|toContain" packages/core/test/settings/SettingsService.spec.ts)
if [ $ASSERTIONS -lt 15 ]; then
  echo "FAIL: Only $ASSERTIONS behavioral assertions found (minimum 15)"
  exit 1
fi

# 4. Check for mock theater
echo "Checking for mock theater anti-patterns..."
npx tsx project-plans/verification/mock-theater-detector.ts packages/core/test/settings/SettingsService.spec.ts
if [ $? -ne 0 ]; then
  echo "FAIL: Mock theater detected"
  exit 1
fi

# 5. Verify behavioral contracts
echo "Verifying behavioral contracts..."
npx tsx project-plans/verification/behavioral-contract.ts packages/core/test/settings/SettingsService.spec.ts
if [ $? -ne 0 ]; then
  echo "FAIL: Behavioral contracts invalid"
  exit 1
fi

# 6. Check property-based test percentage
echo "Checking property-based test coverage..."
TOTAL_TESTS=$(grep -c "test\\(" packages/core/test/settings/SettingsService.spec.ts)
PROPERTY_TESTS=$(grep -c "test\\.prop\\(" packages/core/test/settings/SettingsService.spec.ts)
PERCENTAGE=$(echo "scale=2; $PROPERTY_TESTS / $TOTAL_TESTS * 100" | bc)
REQUIRED=30

if (( $(echo "$PERCENTAGE < $REQUIRED" | bc -l) )); then
  echo "FAIL: Only $PERCENTAGE% property-based tests (minimum 30%)"
  exit 1
fi

# 7. Verify requirement coverage
echo "Checking requirement coverage..."
REQUIREMENTS="REQ-001.1 REQ-001.2 REQ-001.3 REQ-001.4 REQ-002.1 REQ-002.2 REQ-002.3 REQ-002.4 REQ-003.1 REQ-003.2 REQ-003.3 REQ-003.4 REQ-004.1 REQ-004.2 REQ-004.3 REQ-004.4"
MISSING=""

for req in $REQUIREMENTS; do
  grep -q "@requirement $req" packages/core/test/settings/SettingsService.spec.ts
  if [ $? -ne 0 ]; then
    MISSING="$MISSING $req"
  fi
done

if [ -n "$MISSING" ]; then
  echo "FAIL: Missing requirement coverage for:$MISSING"
  exit 1
fi

# 8. Check for test implementation coupling
echo "Checking for implementation coupling..."
grep -E "private|_internal|#private" packages/core/test/settings/SettingsService.spec.ts
if [ $? -eq 0 ]; then
  echo "FAIL: Tests coupled to private implementation"
  exit 1
fi

# 9. Generate verification report
echo "Generating verification report..."
cat > workers/phase-04a.json <<EOF
{
  "status": "pass",
  "phase": "04a-settings-service-tdd-verification",
  "metrics": {
    "total_tests": $TOTAL_TESTS,
    "property_tests": $PROPERTY_TESTS,
    "property_percentage": $PERCENTAGE,
    "behavioral_assertions": $ASSERTIONS,
    "requirements_covered": 16,
    "mock_theater_detected": false,
    "behavioral_contracts_valid": true
  },
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo "=== Phase 4a Verification PASSED ==="
echo "Tests are properly behavioral and ready for implementation"
```

## Manual Review Checklist

Before proceeding to implementation:

- [ ] Each test has clear Given/When/Then structure
- [ ] Tests verify actual data transformations
- [ ] No tests that just verify mocks were called
- [ ] Property tests cover edge cases effectively
- [ ] All requirements have corresponding tests
- [ ] Tests would fail with empty implementations
- [ ] Tests don't depend on implementation details