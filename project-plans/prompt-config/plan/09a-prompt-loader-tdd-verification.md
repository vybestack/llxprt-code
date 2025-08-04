# Task 09a: Verify PromptLoader TDD Tests

## Objective

Verify that PromptLoader tests are behavioral and properly test file I/O with compression.

## Verification Steps

### 1. Test File Exists

```bash
test -f packages/core/test/prompt-config/PromptLoader.spec.ts || echo "FAIL: Test file missing"
```

### 2. Test Count

```bash
TEST_COUNT=$(grep -c "it(" packages/core/test/prompt-config/PromptLoader.spec.ts)
if [ $TEST_COUNT -lt 15 ]; then
  echo "FAIL: Only $TEST_COUNT tests (minimum 15)"
fi
```

### 3. Real File I/O Testing

```bash
# Should use temp directory
grep -q "mkdtemp\|tmpdir" test/prompt-config/PromptLoader.spec.ts || echo "FAIL: Not using temp directory"

# Should write test files
grep -q "writeFile" test/prompt-config/PromptLoader.spec.ts || echo "FAIL: Not creating test files"

# Should clean up
grep -q "afterEach.*rm\|cleanup" test/prompt-config/PromptLoader.spec.ts || echo "WARNING: No cleanup"
```

### 4. Compression Testing

```bash
# Tests code block preservation
grep -q "```" test/prompt-config/PromptLoader.spec.ts || echo "FAIL: Not testing code blocks"

# Tests whitespace reduction
grep -q "blank lines\|whitespace\|spaces" test/prompt-config/PromptLoader.spec.ts || echo "FAIL: Not testing compression"

# Tests header simplification
grep -q "##\|###" test/prompt-config/PromptLoader.spec.ts || echo "FAIL: Not testing headers"
```

### 5. Requirements Coverage

```bash
# Each compression requirement tested
for req in "REQ-011.1" "REQ-011.2" "REQ-011.3" "REQ-011.4" "REQ-011.5"; do
  grep -q "@requirement $req" test/prompt-config/PromptLoader.spec.ts || echo "FAIL: $req not tested"
done

# Error handling requirement
grep -q "REQ-007.4" test/prompt-config/PromptLoader.spec.ts || echo "FAIL: Error handling not tested"
```

### 6. No Mock File System

```bash
# Should not mock fs
grep -q "jest.mock.*fs\|mockFs" test/prompt-config/PromptLoader.spec.ts && echo "FAIL: Mocking file system"

# Should use real file operations
grep -q "fs.writeFile\|writeFile" test/prompt-config/PromptLoader.spec.ts || echo "FAIL: Not using real fs"
```

### 7. Edge Case Coverage

```bash
# Empty files
grep -q "empty file\|empty\.md" test/prompt-config/PromptLoader.spec.ts || echo "FAIL: Empty files not tested"

# Large files
grep -q "large file\|10000\|many lines" test/prompt-config/PromptLoader.spec.ts || echo "FAIL: Large files not tested"

# Unicode
grep -q "UTF-8\|unicode\|emoji" test/prompt-config/PromptLoader.spec.ts || echo "FAIL: Unicode not tested"

# Unclosed code blocks
grep -q "unclosed.*code" test/prompt-config/PromptLoader.spec.ts || echo "WARNING: Unclosed blocks not tested"
```

### 8. Run Tests

```bash
cd packages/core

# All should fail
npm test PromptLoader.spec.ts 2>&1 | grep -c "NotYetImplemented" || echo "FAIL: Not failing correctly"
```

## Success Criteria

- 15+ tests
- Real file I/O (no mocks)
- All compression rules tested
- Requirements covered
- Edge cases tested
- Tests fail with NotYetImplemented