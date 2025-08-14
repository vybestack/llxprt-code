# Phase 13: Tool Integration TDD

## Worker Command
```bash
claude --dangerously-skip-permissions -p "
Write tests for tool filtering integration:
- specification.md requirements [REQ-001.2, REQ-002]
- analysis/pseudocode/tool-integration.md

UPDATE packages/core/src/core/test/nonInteractiveToolExecutor.test.ts
ADD emoji filtering tests

CREATE packages/core/src/tools/test/edit.emojifilter.test.ts
CREATE packages/core/src/tools/test/write-file.emojifilter.test.ts

Test scenarios:

/**
 * @requirement REQ-001.2
 * @scenario Filter tool arguments
 * @given Tool call with args { text: '✅ Done!' }
 * @when executeToolCall in auto mode
 * @then Tool receives { text: '[OK] Done!' }
 */

/**
 * @requirement REQ-002.1
 * @scenario Block file edit with emojis in error mode
 * @given edit_file with new_string: 'console.log(\"🚀\")'
 * @when executeToolCall in error mode
 * @then Returns error 'Cannot write emojis to code files'
 */

/**
 * @requirement REQ-002.2
 * @scenario Filter write_file content
 * @given write_file with content: '# 🎉 Title'
 * @when executeToolCall in auto mode
 * @then File written with '# Title'
 */

/**
 * @requirement REQ-004.2
 * @scenario Warn mode provides feedback after tool
 * @given Tool with emojis in warn mode
 * @when Tool executes successfully
 * @then System feedback 'Emojis were detected and removed'
 */

Property tests:
test.prop([fc.object()])('filters any tool arguments', (args) => {
  const result = filterToolArgs(args);
  expect(result).toBeDefined();
});

FORBIDDEN:
- Mocking tool execution
- Testing tool internals
"
```

## Expected Tests
- Tool argument filtering
- File content protection
- Error mode blocking
- Warn mode feedback
- Property tests for args

## Verification
```bash
# Run tests - should fail
npm test packages/core/src/core/test/
npm test packages/core/src/tools/test/
```