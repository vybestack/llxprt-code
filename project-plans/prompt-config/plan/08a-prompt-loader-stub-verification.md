# Task 08a: Verify PromptLoader Stub

## Objective

Verify that the PromptLoader stub was created correctly.

## Verification Steps

### 1. File Existence

```bash
test -f packages/core/src/prompt-config/PromptLoader.ts || echo "FAIL: PromptLoader.ts missing"
```

### 2. TypeScript Compilation

```bash
cd packages/core
npm run typecheck || echo "FAIL: TypeScript compilation failed"
```

### 3. Stub Verification

```bash
# Check all methods throw
grep -c "throw new Error('NotYetImplemented')" src/prompt-config/PromptLoader.ts || echo "FAIL: Missing throws"

# No implementation logic
grep -v "throw new Error('NotYetImplemented')" src/prompt-config/PromptLoader.ts | \
  grep -E "return [^;]+;|if\s*\(|for\s*\(|while\s*\(" && echo "FAIL: Logic found"

# File size check
LINE_COUNT=$(wc -l < src/prompt-config/PromptLoader.ts)
if [ $LINE_COUNT -gt 100 ]; then
  echo "FAIL: Exceeds 100 lines ($LINE_COUNT lines)"
fi
```

### 4. Required Methods

```bash
# Public methods
grep -q "loadFile" src/prompt-config/PromptLoader.ts || echo "FAIL: loadFile method missing"
grep -q "fileExists" src/prompt-config/PromptLoader.ts || echo "FAIL: fileExists method missing"

# Private compression methods
grep -q "compressContent\|compressLine" src/prompt-config/PromptLoader.ts || echo "WARNING: Compression methods missing"
```

### 5. Import Verification

```bash
# Should import fs
grep -q "import.*fs" src/prompt-config/PromptLoader.ts || echo "FAIL: fs import missing"
```

## Success Criteria

- File exists and compiles
- All methods throw NotYetImplemented
- No implementation logic
- Required methods present
- Under 100 lines