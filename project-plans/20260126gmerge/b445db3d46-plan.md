# Reimplementation Plan: b445db3d46 - Make list dir less flaky

**Upstream commit:** `b445db3d46e75ab78dcdef41bdadabb786d37a64`  
**Subject:** fix(infra) - Make list dir less flaky (#12554)  
**Target file:** `integration-tests/list_directory.test.ts`

---

## Background

The upstream commit fixes flaky integration tests by:
1. Using `expectToolCallSuccess()` instead of `waitForToolCall()` + manual assertions
2. Wrapping in try-catch for better error diagnostics on failure

LLxprt already has the `expectToolCallSuccess()` helper (added in commit `10df51916`), but the `list_directory.test.ts` file still uses the old `waitForToolCall()` pattern.

---

## Why Not Cherry-Pick

Direct cherry-pick won't work because:
1. LLxprt's `rig.setup()` is async and awaited; upstream made it synchronous
2. Signature differences: LLxprt uses `string | string[]` vs upstream `string[]` for `expectToolCallSuccess`
3. Test structure uses old `waitForToolCall` pattern

---

## Implementation Steps

### Step 1: Read Current Test File

Examine `integration-tests/list_directory.test.ts` to understand current structure.

### Step 2: Identify Anti-Flakiness Pattern

The core fix is:
```typescript
// OLD (flaky):
const result = await rig.waitForToolCall('list_directory');
expect(result).toBeTruthy();

// NEW (stable):
try {
  await rig.expectToolCallSuccess('list_directory');
} catch (error) {
  // Add debug info
  console.error('Test failed with state:', rig.getDebugInfo());
  throw error;
}
```

### Step 3: Apply Pattern to All Tests

For each test in `list_directory.test.ts`:
1. Replace `waitForToolCall()` + `expect().toBeTruthy()` with `expectToolCallSuccess()`
2. Optionally add try-catch for better diagnostics on failure

### Step 4: Verify Helper Exists

Confirm `expectToolCallSuccess` is available in the test rig:
```bash
grep -r "expectToolCallSuccess" integration-tests/
```

### Step 5: Run Tests

```bash
npm run test -- integration-tests/list_directory.test.ts
```

---

## Expected Changes

The test file should be modified to use the more robust pattern. Example transformation:

**Before:**
```typescript
it('should list directory contents', async () => {
  await rig.setup();
  await rig.sendMessage('List the contents of the current directory');
  
  const result = await rig.waitForToolCall('list_directory');
  expect(result).toBeTruthy();
  expect(result.output).toContain('some-file.txt');
});
```

**After:**
```typescript
it('should list directory contents', async () => {
  await rig.setup();
  await rig.sendMessage('List the contents of the current directory');
  
  try {
    const result = await rig.expectToolCallSuccess('list_directory');
    expect(result.output).toContain('some-file.txt');
  } catch (error) {
    console.error('list_directory test failed');
    throw error;
  }
});
```

---

## Verification

1. Run the specific test multiple times to check for flakiness:
   ```bash
   for i in {1..5}; do npm run test -- integration-tests/list_directory.test.ts; done
   ```

2. Run full test suite:
   ```bash
   npm run test
   ```

---

## Commit Message

```
reimplement: make list dir test less flaky (upstream b445db3d46)

Migrates list_directory.test.ts to use expectToolCallSuccess() helper
instead of waitForToolCall() + manual assertions. This provides:
- Explicit success checking (not just tool detection)
- Better diagnostics on failure
- Reduced flakiness in CI

Upstream: b445db3d46e75ab78dcdef41bdadabb786d37a64
```
