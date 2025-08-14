# Phase 16: Comprehensive Verification

## Worker Command
```bash
claude --dangerously-skip-permissions -p "
Perform comprehensive verification of emoji filter implementation:

1. PSEUDOCODE COMPLIANCE
Compare all implementations with pseudocode files
Report any deviations line by line

2. REQUIREMENT COVERAGE
Verify all REQ tags are tested
Map each requirement to specific tests

3. MUTATION TESTING
Run mutation tests on all filter code
Verify 80% mutation score minimum

4. PROPERTY TEST COVERAGE
Count property-based tests
Verify 30% minimum coverage

5. INTEGRATION VERIFICATION
Confirm feature is accessible through:
- /set emojifilter command
- Stream processing pipeline
- Tool execution pipeline
- File modification tools

6. NO ISOLATED FEATURE CHECK
Verify the feature CANNOT work in isolation
List all files that were modified
Confirm integration with existing system

Output comprehensive report to verification-report.md
"
```

## Verification Script
```bash
#!/bin/bash
# Full verification suite

echo "=== Pseudocode Compliance ==="
for impl in EmojiFilter config-integration stream-integration tool-integration; do
  echo "Checking $impl..."
  diff -u analysis/pseudocode/$impl.md packages/core/src/*/$impl.ts
done

echo "=== Requirement Coverage ==="
grep -r "@requirement" packages/*/test/ | cut -d: -f3 | sort -u

echo "=== Mutation Testing ==="
npx stryker run --mutate "packages/core/src/filters/**/*.ts"
SCORE=$(jq -r '.metrics.mutationScore' .stryker-tmp/reports/mutation-report.json)
[ $SCORE -lt 80 ] && echo "FAIL: Mutation score $SCORE%"

echo "=== Property Test Coverage ==="
TOTAL=$(grep -c "test(" packages/*/test/**/*emojifilter*.test.ts)
PROPERTY=$(grep -c "test.prop(" packages/*/test/**/*emojifilter*.test.ts)
PERCENTAGE=$((PROPERTY * 100 / TOTAL))
[ $PERCENTAGE -lt 30 ] && echo "FAIL: Only $PERCENTAGE% property tests"

echo "=== Integration Points ==="
echo "Modified files:"
git diff --name-only main..HEAD | grep -v test

echo "=== User Access ==="
echo "1. /set emojifilter command:"
grep -n "emojifilter" packages/cli/src/ui/commands/setCommand.ts

echo "2. Stream integration:"
grep -n "EmojiFilter" packages/cli/src/ui/hooks/useGeminiStream.ts

echo "3. Tool integration:"
grep -n "filterToolArgs\|filterFileContent" packages/core/src/core/nonInteractiveToolExecutor.ts

echo "=== Cannot Work in Isolation ==="
echo "Dependencies on existing system:"
grep -l "import.*Config\|SettingsService\|useGeminiStream\|nonInteractiveToolExecutor" packages/core/src/filters/*.ts
```

## Success Criteria
- [ ] All pseudocode lines implemented
- [ ] All REQ tags have tests
- [ ] 80% mutation score achieved
- [ ] 30% property tests present
- [ ] Feature integrated with existing code
- [ ] Cannot work in isolation
- [ ] User can access feature