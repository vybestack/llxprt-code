# Task 02a: Verify Default Constants Creation

## Objective

Verify that the TypeScript constants were created correctly from the markdown files, with no content loss or corruption.

## Verification Checklist

### 1. File Structure Verification

```bash
# Check all required TypeScript files exist
test -f packages/core/src/prompt-config/defaults/index.ts || echo "FAIL: index.ts missing"
test -f packages/core/src/prompt-config/defaults/core-defaults.ts || echo "FAIL: core-defaults.ts missing"
test -f packages/core/src/prompt-config/defaults/tool-defaults.ts || echo "FAIL: tool-defaults.ts missing"
test -f packages/core/src/prompt-config/defaults/provider-defaults.ts || echo "FAIL: provider-defaults.ts missing"
```

### 2. TypeScript Compilation

```bash
# Verify files compile without errors
cd packages/core
npm run typecheck || echo "FAIL: TypeScript compilation errors"
```

### 3. Content Integrity Verification

```typescript
// Create a verification script to run
// verify-defaults.ts
import { ALL_DEFAULTS } from './packages/core/src/prompt-config/defaults';
import * as fs from 'fs';
import * as path from 'path';

// Check each constant matches its source file
for (const [key, content] of Object.entries(ALL_DEFAULTS)) {
  const mdPath = path.join('packages/core/src/prompt-config/defaults', key);
  if (fs.existsSync(mdPath)) {
    const mdContent = fs.readFileSync(mdPath, 'utf-8');
    if (content !== mdContent) {
      console.error(`FAIL: Content mismatch for ${key}`);
      console.error(`Length in constant: ${content.length}`);
      console.error(`Length in markdown: ${mdContent.length}`);
    }
  }
}
```

### 4. Export Structure Verification

```typescript
// Verify exports are properly structured
import { ALL_DEFAULTS, CORE_DEFAULTS, TOOL_DEFAULTS, PROVIDER_DEFAULTS } from './defaults';

// Check that ALL_DEFAULTS contains all individual exports
const allKeys = Object.keys(ALL_DEFAULTS);
const expectedKeys = [
  ...Object.keys(CORE_DEFAULTS),
  ...Object.keys(TOOL_DEFAULTS),
  ...Object.keys(PROVIDER_DEFAULTS)
];

if (allKeys.length !== expectedKeys.length) {
  console.error('FAIL: ALL_DEFAULTS missing keys');
}
```

### 5. Key Format Verification

```bash
# All keys should follow the correct path format
node -e "
const { ALL_DEFAULTS } = require('./packages/core/dist/prompt-config/defaults');
for (const key of Object.keys(ALL_DEFAULTS)) {
  // Keys should not start with /
  if (key.startsWith('/')) {
    console.error('FAIL: Key starts with /:', key);
  }
  // Keys should use forward slashes
  if (key.includes('\\\\')) {
    console.error('FAIL: Key uses backslashes:', key);
  }
  // Tool keys should be in tools/ directory
  if (key.includes('tool') && !key.startsWith('tools/')) {
    console.error('FAIL: Tool file not in tools/ directory:', key);
  }
}
"
```

### 6. Escape Sequence Verification

Check that special characters are properly escaped:
```bash
# Check for unescaped backticks that would break template literals
grep -n '`' packages/core/src/prompt-config/defaults/*.ts | grep -v '\\`' | grep -v '^[^:]*:[^:]*:`' && echo "FAIL: Unescaped backticks found"

# Check for proper backslash escaping
node -e "
const { ALL_DEFAULTS } = require('./packages/core/dist/prompt-config/defaults');
// Try to detect potential escape issues by looking for common patterns
for (const [key, content] of Object.entries(ALL_DEFAULTS)) {
  if (content.includes('\\\\n') && !content.includes('\\\\\\\\n')) {
    console.warn('WARNING: Possible escape issue in', key);
  }
}
"
```

### 7. Content Completeness

```bash
# Verify all expected default files are included
EXPECTED_FILES=(
  "core.md"
  "env/git-repository.md"
  "env/sandbox.md"
  "env/ide-mode.md"
  "tools/shell.md"
  "tools/read-file.md"
  "tools/edit.md"
  "tools/write-file.md"
  "tools/grep.md"
  "tools/glob.md"
  "tools/ls.md"
  "tools/read-many-files.md"
  "tools/web-fetch.md"
  "tools/web-search.md"
  "tools/memory.md"
  "tools/todo-write.md"
  "tools/todo-read.md"
  "providers/gemini/models/gemini-2.5-flash/core.md"
)

node -e "
const { ALL_DEFAULTS } = require('./packages/core/dist/prompt-config/defaults');
const expected = ${JSON.stringify(EXPECTED_FILES)};
for (const file of expected) {
  if (!ALL_DEFAULTS[file]) {
    console.error('FAIL: Missing default for', file);
  }
}
"
```

### 8. Fraud Detection

Look for signs of incorrect implementation:

1. **Stub content**: Constants containing placeholder text like "TODO" or "PLACEHOLDER"
2. **Empty constants**: Keys with empty string values
3. **Truncated content**: Suspiciously short content compared to source
4. **Wrong content**: Content that doesn't match the key (e.g., shell content in read-file.md)
5. **Missing escaping**: Template literals that won't compile due to unescaped backticks

## Success Criteria

- All TypeScript files compile without errors
- Content exactly matches markdown sources
- All exports properly structured
- No escape sequence issues
- All expected files included in constants
- Keys follow correct path format