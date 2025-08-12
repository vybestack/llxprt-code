# Phase 3: Settings Service Stub Implementation

## Objective

Create minimal skeleton of SettingsService that compiles but has no implementation.

## Worker Task

```bash
claude --dangerously-skip-permissions -p "
Create stub implementation of SettingsService based on specification and pseudocode.

UPDATE packages/core/src/settings/types.ts:
(Create if doesn't exist, otherwise ADD to existing file)
- Define ISettingsService interface
- Define GlobalSettings type from specification schemas
- Define SettingsChangeEvent type
- Export all types

UPDATE packages/core/src/settings/SettingsService.ts:
(Create if doesn't exist, otherwise MODIFY existing class)
- Implement ISettingsService interface
- Constructor takes repository parameter
- All methods exist but have EMPTY BODIES (no throw statements)
- Methods return dummy values of correct type:
  - getSettings: return {} as any
  - updateSettings: return Promise.resolve()
  - switchProvider: return Promise.resolve({} as any)
- Include proper TypeScript types from types.ts

Requirements:
1. Must compile with strict TypeScript
2. All methods return proper types (even if empty)
3. NO 'NotYetImplemented' errors - just empty implementations
4. Include all methods from specification
5. Tests will fail naturally when calling these empty methods

CRITICAL: Do NOT throw errors in stubs. Let tests fail naturally.

Output completion status to workers/phase-03.json
"
```

## Verification

```bash
# Check compilation
npm run typecheck

# Verify NO NotYetImplemented patterns
grep -r "NotYetImplemented\|not.*implemented\|TODO\|stub" packages/core/src/settings/
if [ $? -eq 0 ]; then
  echo "FAIL: Found stub markers or NotYetImplemented"
  exit 1
fi

# Check methods exist but are minimal
wc -l packages/core/src/settings/SettingsService.ts
# Should be < 100 lines (minimal skeleton)

# Verify tests fail naturally (not with NotYetImplemented)
npm test packages/core/test/settings/SettingsService.spec.ts 2>&1 | grep -i "notyet"
if [ $? -eq 0 ]; then
  echo "FAIL: Tests failing with NotYetImplemented error"
  exit 1
fi
```