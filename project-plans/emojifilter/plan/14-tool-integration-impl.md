# Phase 14: Tool Integration Implementation

## Worker Command
```bash
claude --dangerously-skip-permissions -p "
Implement tool filtering following pseudocode:

UPDATE packages/core/src/core/nonInteractiveToolExecutor.ts

Based on tool-integration.md:
- Lines 7-14: Get or create filter
  → Line 10: Get mode from config
  → Line 12: Create EmojiFilter instance
  
- Lines 17-68: Wrap executeToolCall
  → Line 22: Check if file modification tool
  → Line 25-33: Filter file mod args specially
  → Line 36-49: Handle blocking in error mode
  → Line 53-56: Create filtered request
  → Line 61-64: Add system feedback for warn

UPDATE packages/core/src/tools/edit.ts
Based on tool-integration.md lines 72-94:
- Filter old_string and new_string parameters

UPDATE packages/core/src/tools/write-file.ts
Based on tool-integration.md lines 97-112:
- Filter content parameter

Import EmojiFilter and use filterFileModificationArgs

Requirements:
1. Follow pseudocode line numbers
2. All tests must pass
3. Maintain tool functionality
"
```

## Expected Implementation
- Tool argument filtering
- File content protection
- Error mode blocking
- Warn mode feedback

## Verification
```bash
# All tests pass
npm test packages/core/src/core/test/
npm test packages/core/src/tools/test/

# Tools still work
npm run test:integration:tools
```