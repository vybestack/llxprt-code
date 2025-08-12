# Phase 5a: Settings Service Implementation Verification

## Objective

Verify implementation follows pseudocode and passes all behavioral tests.

## Verification Task

```bash
#!/bin/bash
# Execute verification for implementation phase

echo "=== Phase 5a: Implementation Verification ==="

# 1. Run all tests - must pass
echo "Running tests..."
npm test packages/core/test/settings/SettingsService.spec.ts
if [ $? -ne 0 ]; then
  echo "FAIL: Tests not passing"
  exit 1
fi
echo "✅ All tests passing"

# 2. Check no test modifications
echo "Checking for test modifications..."
git diff packages/core/test/settings/SettingsService.spec.ts | grep -E "^[+-]" | grep -v "^[+-]{3}"
if [ $? -eq 0 ]; then
  echo "FAIL: Tests were modified during implementation"
  exit 1
fi
echo "✅ No test modifications"

# 3. Verify pseudocode was followed
echo "Verifying pseudocode compliance..."
claude --dangerously-skip-permissions -p "
Compare the implementation in packages/core/src/settings/SettingsService.ts
with the pseudocode in analysis/pseudocode/settings-service.md

Verify:
1. Constructor implements all 3 steps:
   - LOAD settings from repository
   - INITIALIZE validators for each provider  
   - SETUP file watcher for external changes

2. getSettings method:
   - Has IF/ELSE logic for provider parameter
   - Returns deep clone (not reference)

3. updateSettings method has all steps:
   - VALIDATE changes with provider validator
   - BEGIN transaction block
   - CLONE current settings
   - MERGE changes into clone
   - PERSIST clone to repository
   - UPDATE memory with clone
   - EMIT 'settings-update' event
   - ON ERROR: ROLLBACK to original settings

4. switchProvider method:
   - VALIDATE provider exists
   - Special case for 'qwen' provider
   - Transaction with all steps

Output JSON to workers/pseudocode-check.json:
{
  \"pseudocode_followed\": true/false,
  \"deviations\": [],
  \"constructor_steps\": 3,
  \"methods_implemented\": 4
}
" &

CLAUDE_PID=$!
sleep 30
wait $CLAUDE_PID

# Parse pseudocode check result
PSEUDOCODE_FOLLOWED=$(jq -r '.pseudocode_followed' workers/pseudocode-check.json)
if [ "$PSEUDOCODE_FOLLOWED" != "true" ]; then
  echo "FAIL: Implementation doesn't follow pseudocode"
  jq '.deviations' workers/pseudocode-check.json
  exit 1
fi
echo "✅ Pseudocode followed correctly"

# 4. Check no stub code remains
echo "Checking for stub code..."
grep -r "NotYetImplemented" packages/core/src/settings/
if [ $? -eq 0 ]; then
  echo "FAIL: Stub code remains in implementation"
  exit 1
fi
echo "✅ No stub code remains"

# 5. Run mutation testing
echo "Running mutation testing..."
npx stryker run --mutate packages/core/src/settings/SettingsService.ts
MUTATION_SCORE=$(jq -r '.metrics.mutationScore' .stryker-tmp/reports/mutation-report.json)
echo "Mutation score: $MUTATION_SCORE%"

if (( $(echo "$MUTATION_SCORE < 80" | bc -l) )); then
  echo "FAIL: Mutation score $MUTATION_SCORE% is below 80%"
  echo "Tests don't adequately verify implementation"
  exit 1
fi
echo "✅ Mutation score above 80%"

# 6. Check code coverage
echo "Checking code coverage..."
npm test -- --coverage packages/core/test/settings/SettingsService.spec.ts
COVERAGE=$(jq -r '.total.lines.pct' coverage/coverage-summary.json)

if (( $(echo "$COVERAGE < 90" | bc -l) )); then
  echo "FAIL: Code coverage $COVERAGE% is below 90%"
  exit 1
fi
echo "✅ Code coverage above 90%"

# 7. Verify no debug code
echo "Checking for debug code..."
grep -r "console\.\|debugger\|TODO\|FIXME\|XXX" packages/core/src/settings/
if [ $? -eq 0 ]; then
  echo "FAIL: Debug code or TODOs found"
  exit 1
fi
echo "✅ No debug code"

# 8. Type safety check
echo "Checking TypeScript strict mode..."
npm run typecheck packages/core/src/settings/
if [ $? -ne 0 ]; then
  echo "FAIL: TypeScript errors"
  exit 1
fi
echo "✅ TypeScript strict mode passing"

# 9. Performance check
echo "Testing performance..."
node -e "
const { SettingsService } = require('./packages/core/dist/settings/SettingsService.js');
const repo = { load: () => ({}), save: () => {} };
const service = new SettingsService(repo);

const start = Date.now();
for(let i = 0; i < 10000; i++) {
  service.getSettings('openai');
}
const time = (Date.now() - start) / 10000;
console.log('Average getSettings time:', time, 'ms');
if (time > 1) {
  console.error('FAIL: Performance requirement not met');
  process.exit(1);
}
"

# 10. Generate final report
echo "Generating verification report..."
cat > workers/phase-05a.json <<EOF
{
  "status": "pass",
  "phase": "05a-settings-service-impl-verification",
  "metrics": {
    "tests_passing": true,
    "pseudocode_followed": true,
    "mutation_score": $MUTATION_SCORE,
    "code_coverage": $COVERAGE,
    "no_debug_code": true,
    "typescript_valid": true,
    "performance_met": true
  },
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo "=== Phase 5a Verification PASSED ==="
echo "Implementation complete and verified"
```

## Next Steps

If verification passes:
1. Commit the implementation
2. Proceed to next component (Repository)

If verification fails:
1. Review failure reasons
2. Fix implementation to match pseudocode
3. Re-run verification