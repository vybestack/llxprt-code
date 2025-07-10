# Phase 08e – Verify Text-Based Tool Call Parsing (multi-provider)

**STOP**
This phase is for verification only.

## Goal

To verify that the text-based tool call parsing implementation correctly handles models like gemma-3-12b that output tool calls as formatted text.

## Verification Steps

### 1. Code Review

- [ ] Verify TextToolCallParser implementation:
  - [ ] Correctly parses `[TOOL_REQUEST]...[TOOL_REQUEST_END]` format
  - [ ] Handles JSON parsing errors gracefully
  - [ ] Returns cleaned content without tool call markers
  - [ ] Supports multiple tool calls in one response

- [ ] Verify OpenAIProvider integration:
  - [ ] Model detection logic is correct
  - [ ] Parser is only used for known text-based models
  - [ ] Standard OpenAI format still works for other models
  - [ ] Tool calls are properly converted to standard format

### 2. Unit Tests

Create test file `packages/cli/src/providers/parsers/TextToolCallParser.test.ts`:

```typescript
describe('GemmaToolCallParser', () => {
  it('should parse single tool call', () => {
    const content =
      'Here is the result:\n[TOOL_REQUEST]\nlist_directory {"path": "/home"}\n[TOOL_REQUEST_END]';
    const { cleanedContent, toolCalls } = parser.parse(content);

    expect(cleanedContent).toBe('Here is the result:\n');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe('list_directory');
    expect(toolCalls[0].arguments).toEqual({ path: '/home' });
  });

  it('should parse multiple tool calls', () => {
    // Test with multiple tool calls
  });

  it('should handle malformed JSON', () => {
    // Test with invalid JSON in arguments
  });
});
```

### 3. Integration Tests

Test with actual models:

```bash
# Test with gemma model
/provider openai
/baseurl http://localhost:8080  # Or your local LLM endpoint
/model gemma-3-12b-it
"List files in /tmp directory"

# Expected: Tool call should be parsed and executed

# Test with standard OpenAI model
/model gpt-4
"List files in /tmp directory"

# Expected: Should work as before, using standard tool_calls format
```

### 4. Edge Case Testing

- [ ] Test with incomplete tool call markers
- [ ] Test with nested brackets in JSON arguments
- [ ] Test with special characters in tool names
- [ ] Test with empty arguments `{}`
- [ ] Test with tool call at start/end of content
- [ ] Test with no tool calls (regular response)

### 5. Performance Verification

- [ ] Ensure parsing doesn't significantly slow down streaming
- [ ] Verify memory usage is reasonable for large responses
- [ ] Check that non-text-based models have zero overhead

### 6. Configuration Testing

- [ ] Test disabling text tool parsing via settings
- [ ] Test adding custom models to the text-based list
- [ ] Verify settings are properly loaded and respected

## Success Criteria

- [ ] gemma-3-12b can successfully make tool calls
- [ ] Other models continue to work unchanged
- [ ] No performance regression for standard models
- [ ] Error handling prevents crashes from malformed input
- [ ] Feature can be disabled if needed
- [ ] Logs provide clear debugging information

## Known Limitations to Document

1. Only supports `[TOOL_REQUEST]...[TOOL_REQUEST_END]` format
2. Other text-based formats would need additional parsers
3. Tool call IDs are generated, not preserved from model
4. Streaming shows full content at once for text-based models

**STOP. Phase 08e is complete when all verification steps pass.**
