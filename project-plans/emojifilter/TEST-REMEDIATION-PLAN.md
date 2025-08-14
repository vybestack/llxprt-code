# Emoji Filter Test Remediation Plan

## The Problem

Our tests FAILED to catch that emojis aren't being filtered when writing files because:
1. We mocked the very things we were testing
2. We never tested the ACTUAL tool execution pipeline
3. We focused on unit tests instead of behavioral integration tests

## Tests to Delete

None of the existing tests need deletion - they're actually mostly behavioral. The problem is what's MISSING.

## Missing Critical Tests

### 1. REAL Write File Tool Test
**File**: `packages/core/src/tools/write-file.test.ts`
```typescript
describe('WriteFileTool emoji filtering', () => {
  it('should filter emojis from file content in auto mode', async () => {
    // Set configuration to auto mode
    const configManager = ConfigurationManager.getInstance();
    configManager.setSessionOverride('auto');
    
    // Use REAL WriteFileTool with mock filesystem
    const mockFs = createMockFileSystem();
    const config = new Config();
    const tool = new WriteFileTool(config);
    
    // Execute with emoji content
    const result = await tool.execute({
      file_path: '/test/file.md',
      content: '# Hello! 🎉 Task ✅ completed! 🚀'
    });
    
    // Verify filtered content was written
    expect(mockFs.readFileSync('/test/file.md')).toBe('# Hello! Task [OK] completed!');
    expect(result.systemFeedback).toBeUndefined(); // Auto mode is silent
  });
  
  it('should provide feedback in warn mode', async () => {
    configManager.setSessionOverride('warn');
    // ... similar test with feedback verification
  });
  
  it('should block in error mode', async () => {
    configManager.setSessionOverride('error');
    // ... verify execution blocked
  });
});
```

### 2. Edit Tool Test (if it exists)
**File**: `packages/core/src/tools/edit.test.ts`
- Test that edit operations filter emojis from both old_string and new_string
- Test all modes (auto, warn, error)
- Use REAL EditTool with mock filesystem

### 3. NonInteractiveToolExecutor Test
**File**: `packages/core/src/core/nonInteractiveToolExecutor.test.ts`
```typescript
describe('NonInteractiveToolExecutor emoji filtering', () => {
  it('should filter tool arguments for file modification tools', async () => {
    // Use REAL executor, REAL filter, mock tool registry
    const executor = new NonInteractiveToolExecutor(config);
    
    const result = await executor.executeToolCall({
      name: 'write_file',
      args: {
        file_path: '/test.md',
        content: 'Hello 🎉 World!'
      }
    });
    
    // Verify the tool received filtered content
    expect(result.filteredArgs.content).toBe('Hello World!');
  });
  
  it('should NOT filter search tool arguments', async () => {
    const result = await executor.executeToolCall({
      name: 'grep',
      args: {
        pattern: '🎉',  // Should NOT be filtered
        path: '/test'
      }
    });
    
    expect(result.args.pattern).toBe('🎉'); // Unchanged
  });
});
```

### 4. Stream Processing Test (REAL)
**File**: `packages/cli/src/ui/hooks/useGeminiStream.test.tsx`
```typescript
describe('useGeminiStream emoji filtering', () => {
  it('should filter streaming content in auto mode', async () => {
    // Set up REAL ConfigurationManager
    ConfigurationManager.getInstance().setSessionOverride('auto');
    
    // Create REAL stream processor
    const { processGeminiStreamEvents } = useGeminiStream();
    
    // Simulate stream with emojis
    const events = [
      { type: 'content', value: 'Hello 🎉' },
      { type: 'content', value: ' World ✅!' }
    ];
    
    const output = await processStreamEvents(events);
    expect(output).toBe('Hello World [OK]!');
  });
});
```

### 5. End-to-End CLI Test
**File**: `packages/cli/test/e2e/emoji-filter.test.ts`
```typescript
describe('Emoji filter E2E', () => {
  it('should filter emojis when AI writes a file', async () => {
    // Start actual CLI instance
    const cli = await startCLI();
    
    // Set emoji filter mode
    await cli.execute('/set emojifilter auto');
    
    // Simulate AI response that writes a file
    await cli.mockAIResponse({
      toolCalls: [{
        name: 'write_file',
        args: {
          file_path: './test.md',
          content: '# Success! 🎉✅🚀'
        }
      }]
    });
    
    // Read actual file from filesystem
    const content = fs.readFileSync('./test.md', 'utf8');
    expect(content).toBe('# Success! [OK]');
  });
});
```

## Test Principles to Follow

1. **NO MOCKING the thing being tested**
   - Mock filesystem ✅
   - Mock network ✅  
   - Mock EmojiFilter ❌
   - Mock ConfigurationManager ❌
   - Mock WriteFileTool ❌

2. **Test the ACTUAL behavior**
   - Input: Text with emojis
   - Output: Filtered text in file/stream
   - NOT: "Was filterText() called?"

3. **Test at integration boundaries**
   - Where tools execute
   - Where streams process
   - Where configuration applies

4. **Test all modes in context**
   - Not just EmojiFilter in isolation
   - But how modes affect actual tool execution

## Implementation Order

1. **WriteFileTool test** - Most critical, directly tests the bug
2. **NonInteractiveToolExecutor test** - Tests the integration point
3. **Stream processing test** - Tests LLM response filtering
4. **Edit tool test** - If edit tool exists
5. **E2E test** - Final validation

## Success Criteria

- Can reproduce the bug (write file with emojis in auto mode)
- Test fails with current code
- Test passes when bug is fixed
- No mocking of components under test
- Tests actual file/stream output, not internal calls