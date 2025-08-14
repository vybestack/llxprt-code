# Proposed Mock Rules for PLAN.md and RULES.md

## The Problem

Current tests often mock the very components they're testing, leading to tests that pass but features that don't work. Example: Our emoji filter tests passed but the feature was completely broken.

## Prohibited Mock Patterns

### 1. ❌ FORBIDDEN: Self-Mocking Pattern

**Never mock the component under test**

```typescript
// ❌ FORBIDDEN - Mocking the thing being tested
vi.mock('./EmojiFilter', () => ({
  EmojiFilter: MockEmojiFilter, // Testing MockEmojiFilter, not EmojiFilter!
}));

test('EmojiFilter filters emojis', () => {
  const filter = new EmojiFilter(); // This is MockEmojiFilter!
  expect(filter.filter('✅')).toBe('[OK]'); // Testing the mock!
});
```

### 2. ❌ FORBIDDEN: Direct Value Mock Pattern

**Never mock with the expected output directly**

```typescript
// ❌ FORBIDDEN - Mock returns exactly what test expects
const mockFilter = {
  filterText: vi.fn().mockReturnValue('[OK] Done'),
};

test('filters text', () => {
  expect(mockFilter.filterText('✅ Done')).toBe('[OK] Done'); // Worthless!
});
```

### 3. ❌ FORBIDDEN: Mock Verification Pattern

**Never test that mocks were called**

```typescript
// ❌ FORBIDDEN - Testing mock invocations
test('calls filter method', () => {
  mockService.process('data');
  expect(mockFilter.filter).toHaveBeenCalledWith('data'); // Mock theater!
});
```

## Allowed Mock Patterns

### 1. ✅ ALLOWED: Infrastructure Mocking

**Mock filesystem, network, databases - NOT business logic**

```typescript
// ✅ ALLOWED - Mock infrastructure, test real component
const mockFs = createMockFilesystem({
  '/test.txt': 'Initial content',
});

const tool = new WriteFileTool({ fs: mockFs }); // REAL tool
const result = await tool.execute({
  file_path: '/test.txt',
  content: 'New ✅ content',
});

// Test REAL transformation by REAL component
expect(mockFs.readFile('/test.txt')).toBe('New [OK] content');
```

### 2. ✅ ALLOWED: Irrelevant Service Mocking

**Mock services unrelated to what's being tested**

```typescript
// ✅ ALLOWED - Mock unrelated services
const mockAuthService = { isAuthenticated: () => true };
const mockLogger = { log: vi.fn() };

// Testing EmojiFilter, not auth or logging
const processor = new ContentProcessor({
  auth: mockAuthService, // Irrelevant to emoji filtering
  logger: mockLogger, // Irrelevant to emoji filtering
  filter: new EmojiFilter(), // REAL component under test!
});

const result = processor.process('Hello ✅');
expect(result).toBe('Hello [OK]'); // Testing REAL filtering
```

### 3. ✅ ALLOWED: Test Data Builders

**Create test data, don't mock behavior**

```typescript
// ✅ ALLOWED - Build test data, not mock behavior
class TestDataBuilder {
  static createFileWithEmojis(): string {
    return 'function test() {\n  console.log("✅ Done!");\n}';
  }
}

const tool = new EditTool(); // REAL tool
const result = await tool.edit({
  content: TestDataBuilder.createFileWithEmojis(),
});

expect(result).not.toContain('✅'); // Test REAL filtering
```

## Proposed Updates to PLAN.md

Add section "Test Authenticity Requirements":

````markdown
### Test Authenticity Requirements

**CRITICAL**: Tests must test REAL components, not mocks of those components.

#### The Component Under Test Rule

If you're testing `EmojiFilter`, you must use the REAL `EmojiFilter`:

- ❌ WRONG: `vi.mock('./EmojiFilter')` then test the mock
- ✅ RIGHT: `import { EmojiFilter } from './EmojiFilter'` and test it

#### The Infrastructure Mock Rule

Only mock infrastructure that's external to your business logic:

- ✅ ALLOWED: Mock filesystem, network, database
- ✅ ALLOWED: Mock unrelated services (auth when testing emoji filtering)
- ❌ FORBIDDEN: Mock the component you're testing
- ❌ FORBIDDEN: Mock direct collaborators doing the work being tested

#### The Transformation Test Rule

Every test must verify a REAL transformation:

- ✅ RIGHT: Input → Component → Output (verify output)
- ❌ WRONG: Mock → Test → Mock verification
- ❌ WRONG: Component → Mock → Expected value from mock

### Example Test Patterns

```typescript
// ✅ GOOD: Testing real transformation
test('WriteFileTool filters emojis', async () => {
  const mockFs = createMockFilesystem(); // Mock infrastructure
  const tool = new WriteFileTool({ fs: mockFs }); // REAL tool

  await tool.write('/test.md', 'Hello ✅');

  const actual = mockFs.readFile('/test.md');
  expect(actual).toBe('Hello [OK]'); // Verify REAL transformation
});

// ❌ BAD: Testing mock behavior
test('WriteFileTool filters emojis', async () => {
  const mockTool = { write: vi.fn().mockResolvedValue('Hello [OK]') };

  await mockTool.write('/test.md', 'Hello ✅');

  expect(mockTool.write).toHaveBeenCalledWith('/test.md', 'Hello ✅');
  // This tests NOTHING about the real WriteFileTool!
});
```
````

````

## Proposed Updates to RULES.md

Add section "Mock Hygiene":

```markdown
## Mock Hygiene

### The Fundamental Rule

**You cannot test a component by mocking that component.**

This seems obvious but is constantly violated. If you mock `EmojiFilter` to test `EmojiFilter`, you're not testing `EmojiFilter` at all.

### Mock Decision Tree

When deciding whether to mock something:

````

Is it the component you're testing?
├─ Yes → ❌ NEVER MOCK IT
└─ No → Is it doing the core work being tested?
├─ Yes → ❌ DON'T MOCK IT
└─ No → Is it infrastructure (FS, network, DB)?
├─ Yes → ✅ OK to mock
└─ No → Is it completely unrelated to the test?
├─ Yes → ✅ OK to mock
└─ No → ⚠️ Probably shouldn't mock

````

### Anti-Patterns to Detect

1. **The Circular Mock**: Mocking A to test A
2. **The Expected Value Mock**: Mock returns exactly what test expects
3. **The Mock Verification**: Testing that mocks were called
4. **The Mock Chain**: A calls MockB calls MockC (no real code tested)
5. **The Mock Implementation**: Mock has complex logic (should be testing real code)

### Valid Mock Patterns

1. **Infrastructure Mocks**: Filesystem, network, database
2. **Time Mocks**: Date.now(), setTimeout for deterministic tests
3. **Random Mocks**: Math.random() for deterministic tests
4. **External Service Mocks**: Third-party APIs, auth services
5. **Error Injection**: Mock to simulate infrastructure failures

### Red Flags in Tests

If you see these, the test is probably worthless:

```typescript
// 🚨 Mocking the component under test
vi.mock('./ComponentUnderTest');

// 🚨 Mock returns expected value
mockThing.method.mockReturnValue('expected value');
expect(thing.method()).toBe('expected value');

// 🚨 Verifying mock was called
expect(mockService.method).toHaveBeenCalledWith(args);

// 🚨 No real component in test
const mock1 = vi.fn();
const mock2 = vi.fn();
mock1.mockReturnValue(mock2);

// 🚨 Mock with implementation (why not test real code?)
vi.mock('./Filter', () => ({
  filter: (text) => text.replace(/✅/g, '[OK]') // Just use real Filter!
}));
````

### The Litmus Test

After writing a test, ask:

1. **If I delete the real implementation, will this test fail?**
   - If NO: Your test is worthless

2. **If I break the real implementation, will this test catch it?**
   - If NO: Your test is worthless

3. **Am I testing my mock or my code?**
   - If MOCK: Your test is worthless

4. **Could I replace the component with `return 'expected'` and pass?**
   - If YES: Your test is worthless

````

## Verification Script

Add to test verification:

```bash
#!/bin/bash
# detect-mock-violations.sh

echo "=== Detecting Self-Mocking ==="
# Find tests that mock the component they're testing
for test_file in $(find . -name "*.test.ts" -o -name "*.spec.ts"); do
  component=$(basename $test_file .test.ts | sed 's/.spec$//')
  if grep -l "mock.*$component" "$test_file" > /dev/null; then
    echo "❌ $test_file mocks $component (the component it's testing!)"
  fi
done

echo "=== Detecting Mock Verification ==="
# Find tests that only verify mocks were called
grep -r "toHaveBeenCalled\|toBeCalledWith" --include="*.test.ts" --include="*.spec.ts" . | head -20

echo "=== Detecting Expected Value Mocks ==="
# Find mocks that return hardcoded expected values
grep -r "mockReturnValue\|mockResolvedValue" --include="*.test.ts" --include="*.spec.ts" . | grep "expect.*toBe\|toEqual" | head -20

echo "=== Component Usage Check ==="
# Ensure real components are imported in tests
for component in EmojiFilter WriteFileTool EditTool ConfigurationManager; do
  echo "Checking $component usage in tests..."
  grep -r "new $component\|$component\." --include="*.test.ts" . | grep -v mock | wc -l
done
````

## Summary

The core principle: **Test the REAL component doing REAL work**.

- Mock infrastructure (filesystem) ✅
- Mock unrelated services (auth service when testing emoji filter) ✅
- Mock the component you're testing ❌
- Mock what you're verifying ❌
- Test mock invocations ❌

Tests should prove that `Input → RealComponent → Output` produces the correct output, not that `Mock → Test → ExpectedValue` equals ExpectedValue.
