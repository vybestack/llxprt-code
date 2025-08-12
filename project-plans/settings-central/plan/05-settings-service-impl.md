# Phase 5: Settings Service Implementation

## Objective

Implement SettingsService to make all behavioral tests pass by following pseudocode exactly.

## Worker Task

```bash
claude --dangerously-skip-permissions -p "
Implement SettingsService to pass all tests by following pseudocode.

UPDATE packages/core/src/settings/SettingsService.ts:
(MODIFY the existing stub - do not create new file)

MANDATORY: Follow analysis/pseudocode/settings-service.md EXACTLY:

1. Constructor (from pseudocode lines 10-14):
   - LOAD settings from repository
   - INITIALIZE validators for each provider
   - SETUP file watcher for external changes

2. getSettings method (from pseudocode lines 16-21):
   - IF provider specified
     - RETURN deep clone of settings.providers[provider]
   - ELSE
     - RETURN deep clone of all settings

3. updateSettings method (from pseudocode lines 23-34):
   - VALIDATE changes with provider validator
   - BEGIN transaction
     - CLONE current settings
     - MERGE changes into clone
     - PERSIST clone to repository
     - UPDATE memory with clone
     - EMIT 'settings-update' event
   - ON ERROR
     - ROLLBACK to original settings
     - THROW validation or persistence error

4. switchProvider method (from pseudocode lines 36-44):
   - VALIDATE provider exists in config
   - IF provider is 'qwen'
     - SET default baseUrl and model
   - BEGIN transaction
     - UPDATE activeProvider
     - PERSIST to repository
     - EMIT 'provider-switch' event
     - RETURN new provider settings

Requirements:
1. Do NOT modify any tests
2. Do NOT create new files - UPDATE existing SettingsService.ts
3. Follow pseudocode algorithm EXACTLY - no shortcuts
4. Each pseudocode step must be implemented
5. Use Zod schemas for validation as specified
6. Deep clone using structuredClone() or JSON parse/stringify

Run tests to ensure all pass:
npm test packages/core/test/settings/SettingsService.spec.ts

Output status to workers/phase-05.json with:
- tests_passed: number
- tests_failed: number  
- pseudocode_followed: boolean
- implementation_complete: boolean
"
```

## Verification

```bash
# All tests must pass
npm test packages/core/test/settings/SettingsService.spec.ts || exit 1

# Verify pseudocode was followed
claude --dangerously-skip-permissions -p "
Compare packages/core/src/settings/SettingsService.ts 
with analysis/pseudocode/settings-service.md

Check:
1. Constructor implements all 3 initialization steps
2. getSettings has conditional logic as specified  
3. updateSettings has transaction with all 7 steps
4. switchProvider has qwen special case
5. Error handling matches pseudocode

Report deviations to verification-report.txt
"

# Check NO stub code remains (no empty methods)
grep -E "return\s+\{\}\s+as\s+any|return\s+Promise\.resolve\(\)" packages/core/src/settings/SettingsService.ts
if [ $? -eq 0 ]; then
  echo "FAIL: Stub code remains (empty returns)"
  exit 1
fi

# Run mutation testing
npx stryker run --mutate packages/core/src/settings/SettingsService.ts
MUTATION_SCORE=$(jq -r '.metrics.mutationScore' .stryker-tmp/reports/mutation-report.json)
[ $(echo "$MUTATION_SCORE >= 80" | bc) -eq 1 ] || echo "FAIL: Mutation score below 80%"

# Verify no test modifications
git diff packages/core/test/settings/SettingsService.spec.ts
[ -z "$(git diff packages/core/test/settings/SettingsService.spec.ts)" ] || \
  echo "FAIL: Tests modified"
```