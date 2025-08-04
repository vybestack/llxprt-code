# Task 10: PromptLoader Component - Implementation

## Objective

Implement the PromptLoader to make all file loading and compression tests pass.

## Context

Implement the actual file I/O and compression logic following the pseudocode from analysis/pseudocode/prompt-loader.md.

## Requirements to Implement

- **[REQ-011]** All compression requirements
- **[REQ-007.4]** Error handling for file operations

## Implementation Guidelines

### File Loading
1. Read file using fs.promises.readFile with UTF-8 encoding
2. Pass content to compression function
3. Return compressed content
4. Handle ENOENT and other fs errors

### Compression Algorithm
1. Split content into lines
2. Track code block state (between ```)
3. For each line:
   - If ```: toggle code block state
   - If in code block: preserve exactly
   - If not in code block: apply compression rules
4. Join lines back together

### Compression Rules (prose only)
- Simplify headers: `##+ ` → `# `
- Simplify bold lists: `- **text**: ` → `- text: `
- Trim whitespace from lines
- Remove multiple blank lines

### File Existence Check
- Use fs.promises.access with fs.constants.F_OK
- Return boolean based on success/failure

## Key Implementation Details

```typescript
// Compression implementation
private compressContent(content: string): string {
  const lines = content.split('\n');
  const compressed: string[] = [];
  let inCodeBlock = false;
  
  for (const line of lines) {
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      compressed.push(line);
      continue;
    }
    
    if (inCodeBlock) {
      compressed.push(line);
    } else {
      const compressedLine = this.compressLine(line);
      if (compressedLine || compressed[compressed.length - 1] !== '') {
        compressed.push(compressedLine);
      }
    }
  }
  
  return compressed.join('\n');
}
```

## Commands to Run

```bash
cd packages/core

# Test
npm test PromptLoader.spec.ts

# All should pass after implementation
npm run typecheck
npm run lint
```

## Success Criteria

- All tests pass
- TypeScript compiles
- Linting passes
- Handles all edge cases from tests
- Follows compression algorithm exactly