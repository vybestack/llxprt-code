# Phase 4a: Settings Service TDD Verification

## Verification Steps

```bash
# 1. Check for behavioral assertions
grep -r "toBe\|toEqual\|toMatch\|toContain" packages/core/test/settings/SettingsService.spec.ts
[ $? -ne 0 ] && echo "FAIL: No behavioral assertions found"

# 2. Check no async test patterns
grep -r "async.*it\|await.*expect" packages/core/test/settings/SettingsService.spec.ts
[ $? -eq 0 ] && echo "FAIL: Async test patterns found"

# 3. Check no file system mocks
grep -r "mock.*fs\|jest.mock.*fs" packages/core/test/settings/SettingsService.spec.ts
[ $? -eq 0 ] && echo "FAIL: File system mocks found"

# 4. Check no reverse testing
grep -r "NotYetImplemented\|toThrow.*NotYet" packages/core/test/settings/SettingsService.spec.ts
[ $? -eq 0 ] && echo "FAIL: Reverse testing found"

# 5. Run tests - should fail naturally with stub
npm test packages/core/test/settings/SettingsService.spec.ts 2>&1 | head -20
# Should see failures like "Expected undefined to be 'gpt-4'"
# NOT "Error: NotYetImplemented"

# 6. Count test coverage
TOTAL=$(grep -c "it(" packages/core/test/settings/SettingsService.spec.ts)
[ $TOTAL -lt 15 ] && echo "FAIL: Only $TOTAL tests (need 15+)"
```

## Expected Test Failures with Stub

```
✗ should store settings in memory only
  Expected: "gpt-4"
  Received: undefined
  
✗ should emit events on changes
  Expected: mock function to be called
  Received: 0 calls
  
✗ should clear settings on clear()
  Expected: undefined
  Received: undefined (passes accidentally)
```

## Verification Checklist

- ✅ Tests expect real behavior
- ✅ No async patterns
- ✅ No file mocks
- ✅ 15+ behavioral tests
- ✅ Tests fail with undefined/null errors