# Behavioral Test Remediation Plan

## Problem Statement

The emoji filter feature appears complete but doesn't work because:
1. Tests mock the components being tested (MockEmojiFilter->Test pattern)
2. Missing integration tests that verify tools actually USE the filter
3. No end-to-end tests proving users can access the feature
4. Property-based test requirement (30%) not met

## Remediation Phases

### Phase R01: Delete Structural/Mock Tests
**Goal**: Remove tests that violate RULES.md

```bash
# Identify and delete:
- Tests that mock EmojiFilter itself
- Tests that mock WriteFileTool/EditTool when testing those tools
- Tests that only verify structure (expect(thing).toBeDefined())
- Tests checking mock invocations (toHaveBeenCalled)
```

**Files to Review**:
- `packages/core/src/tools/write-file.test.ts` - Keep, mocks infrastructure only
- `packages/core/src/filters/EmojiFilter.test.ts` - Keep, behavioral tests
- `packages/core/src/filters/integration.test.ts` - Review, may have issues

### Phase R02: WriteFileTool Integration Tests
**Goal**: Prove WriteFileTool actually filters emojis

```typescript
/**
 * REAL behavioral test - NO mocking of components under test
 * Mock ONLY filesystem (infrastructure)
 */
describe('WriteFileTool Emoji Integration', () => {
  let tool: WriteFileTool; // REAL tool
  let config: Config; // REAL config
  let configManager: ConfigurationManager; // REAL manager
  
  beforeEach(() => {
    // Mock filesystem ONLY
    const mockFs = createMockFilesystem();
    
    // Use REAL components
    config = new Config({ fs: mockFs });
    configManager = ConfigurationManager.getInstance();
    tool = new WriteFileTool(config);
  });
  
  it('should filter emojis in auto mode', async () => {
    configManager.setSessionOverride('auto');
    
    const result = await tool.execute({
      file_path: '/test.md',
      content: '# Hello! 🎉 Task ✅ done!'
    });
    
    // Verify ACTUAL file content
    const written = mockFs.readFileSync('/test.md');
    expect(written).toBe('# Hello!  Task [OK] done!');
    expect(result.systemFeedback).toBeUndefined(); // Auto is silent
  });
});
```

### Phase R03: EditTool Integration Tests
**Goal**: Prove EditTool filters emojis in edits

```typescript
describe('EditTool Emoji Integration', () => {
  let tool: EditTool; // REAL tool
  let mockFs: MockFilesystem;
  
  beforeEach(() => {
    mockFs = createMockFilesystem({
      '/code.ts': 'console.log("Hello");'
    });
    
    // REAL components with mock filesystem
    const config = new Config({ fs: mockFs });
    ConfigurationManager.getInstance().initialize(config);
    tool = new EditTool(config);
  });
  
  it('should filter emojis from new_string in warn mode', async () => {
    ConfigurationManager.getInstance().setSessionOverride('warn');
    
    const result = await tool.execute({
      file_path: '/code.ts',
      old_string: 'console.log("Hello");',
      new_string: 'console.log("✅ Success! 🎉");'
    });
    
    const content = mockFs.readFileSync('/code.ts');
    expect(content).toBe('console.log("[OK] Success! ");');
    expect(result.systemFeedback).toContain('Emojis were detected');
  });
  
  it('should block edit with emojis in error mode', async () => {
    ConfigurationManager.getInstance().setSessionOverride('error');
    
    const result = await tool.execute({
      file_path: '/code.ts',
      old_string: 'console.log("Hello");',
      new_string: 'console.log("🚀 Launch");'
    });
    
    // File should be unchanged
    const content = mockFs.readFileSync('/code.ts');
    expect(content).toBe('console.log("Hello");');
    expect(result.error).toContain('emoji');
  });
});
```

### Phase R04: Tool Executor Integration Tests
**Goal**: Verify nonInteractiveToolExecutor filters tool arguments

```typescript
describe('Tool Executor Emoji Filtering', () => {
  let executor: ToolExecutor; // REAL executor
  let toolRegistry: ToolRegistry; // REAL registry
  
  beforeEach(() => {
    const mockFs = createMockFilesystem();
    const config = new Config({ fs: mockFs });
    
    // REAL components
    toolRegistry = new ToolRegistry(config);
    toolRegistry.registerTool(new WriteFileTool(config));
    toolRegistry.registerTool(new EditTool(config));
    
    executor = new ToolExecutor(config, toolRegistry);
  });
  
  it('should filter tool arguments before execution', async () => {
    ConfigurationManager.getInstance().setSessionOverride('auto');
    
    const result = await executor.execute({
      name: 'write_file',
      args: {
        file_path: '/test.md',
        content: 'Task ✅ complete! 🎉'
      }
    });
    
    // Verify filtered content reached the tool
    const written = mockFs.readFileSync('/test.md');
    expect(written).toBe('Task [OK] complete! ');
  });
  
  it('should NOT filter search tool arguments', async () => {
    const grepTool = new GrepTool(config);
    toolRegistry.registerTool(grepTool);
    
    const spy = vi.spyOn(grepTool, 'execute');
    
    await executor.execute({
      name: 'grep',
      args: {
        pattern: '✅|🎉',  // Searching FOR emojis
        path: '/src'
      }
    });
    
    // Verify pattern passed through unchanged
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        pattern: '✅|🎉'  // NOT filtered
      })
    );
  });
});
```

### Phase R05: CLI End-to-End Tests
**Goal**: Verify complete user flows

```typescript
describe('CLI Emoji Filter E2E', () => {
  let cli: TestCLI;
  
  beforeEach(() => {
    cli = new TestCLI({
      mockFs: createMockFilesystem(),
      mockStdin: new MockStdin(),
      mockStdout: new MockStdout()
    });
  });
  
  it('should filter streaming response in auto mode', async () => {
    await cli.start();
    await cli.sendCommand('/set emojifilter auto');
    
    // Simulate LLM response with emojis
    cli.simulateLLMResponse('Task ✅ completed! 🎉');
    
    // Verify filtered output
    expect(cli.stdout.getOutput()).toContain('Task [OK] completed! ');
    expect(cli.stdout.getOutput()).not.toContain('🎉');
  });
  
  it('should respect mode changes mid-session', async () => {
    await cli.start();
    
    // Start in allowed mode
    await cli.sendCommand('/set emojifilter allowed');
    cli.simulateLLMResponse('First: ✅');
    expect(cli.stdout.getOutput()).toContain('First: ✅');
    
    // Switch to auto mode
    await cli.sendCommand('/set emojifilter auto');
    cli.simulateLLMResponse('Second: ✅');
    expect(cli.stdout.getLastLine()).toContain('Second: [OK]');
  });
  
  it('should persist settings in profile', async () => {
    await cli.start();
    await cli.sendCommand('/set emojifilter warn');
    await cli.sendCommand('/profile save test-profile');
    
    // New session
    await cli.restart();
    await cli.sendCommand('/profile load test-profile');
    
    // Verify warn mode is active
    cli.simulateLLMResponse('Test ✅');
    expect(cli.stdout.getOutput()).toContain('Test [OK]');
    expect(cli.stdout.getOutput()).toContain('Emojis were detected');
  });
});
```

### Phase R06: Property-Based Tests (30% requirement)
**Goal**: Add property tests to meet 30% threshold

```typescript
import * as fc from 'fast-check';

describe('EmojiFilter Property Tests', () => {
  const filter = new EmojiFilter({ mode: 'warn' });
  
  test.prop([fc.string()])('never crashes on any Unicode input', (input) => {
    const result = filter.filterText(input);
    expect(result).toBeDefined();
    expect(result.filtered === null || typeof result.filtered === 'string').toBe(true);
  });
  
  test.prop([fc.unicode()])('preserves non-emoji Unicode', (text) => {
    const withoutEmojis = text.replace(/[\u{1F300}-\u{1F9FF}]/gu, '');
    const result = filter.filterText(withoutEmojis);
    expect(result.filtered).toBe(withoutEmojis);
  });
  
  test.prop([fc.object()])('filters nested objects consistently', (obj) => {
    const result = filter.filterToolArgs(obj);
    expect(result.filtered).toBeDefined();
    
    // If emojis detected, verify they're gone
    if (result.emojiDetected) {
      const serialized = JSON.stringify(result.filtered);
      expect(serialized).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u);
    }
  });
  
  test.prop([
    fc.array(fc.string(), { minLength: 1, maxLength: 10 })
  ])('handles stream chunks without data loss', (chunks) => {
    const filter = new EmojiFilter({ mode: 'allowed' });
    const input = chunks.join('');
    
    let output = '';
    for (const chunk of chunks) {
      const result = filter.filterStreamChunk(chunk);
      output += result.filtered;
    }
    output += filter.flushBuffer();
    
    expect(output).toBe(input); // Allowed mode preserves everything
  });
  
  test.prop([
    fc.record({
      mode: fc.constantFrom('allowed', 'auto', 'warn', 'error'),
      text: fc.string()
    })
  ])('mode consistency property', ({ mode, text }) => {
    const filter = new EmojiFilter({ mode });
    const result = filter.filterText(text);
    
    // Mode-specific invariants
    if (mode === 'allowed') {
      expect(result.filtered).toBe(text);
      expect(result.blocked).toBe(false);
    }
    if (mode === 'error' && result.emojiDetected) {
      expect(result.blocked).toBe(true);
      expect(result.filtered).toBeNull();
    }
    if (mode === 'warn' || mode === 'auto') {
      expect(result.blocked).toBe(false);
      expect(result.filtered).not.toBeNull();
    }
  });
});
```

### Phase R07: Configuration Hierarchy Tests
**Goal**: Verify Session > Profile > Default priority

```typescript
describe('Configuration Hierarchy', () => {
  let settingsService: SettingsService;
  let configManager: ConfigurationManager;
  
  beforeEach(() => {
    // Mock settings file
    const mockFs = createMockFilesystem({
      '~/.llxprt/settings.json': JSON.stringify({
        emojiFilter: { mode: 'warn' }
      })
    });
    
    settingsService = new SettingsService({ fs: mockFs });
    configManager = ConfigurationManager.getInstance();
    configManager.initialize(config, settingsService);
  });
  
  it('should use default from settings.json', () => {
    expect(configManager.getCurrentMode()).toBe('warn');
  });
  
  it('should override with profile setting', async () => {
    await configManager.loadProfile('test-profile', {
      emojiFilter: { mode: 'error' }
    });
    
    expect(configManager.getCurrentMode()).toBe('error');
  });
  
  it('should override everything with session setting', async () => {
    // Has default (warn) and profile (error)
    await configManager.loadProfile('test-profile', {
      emojiFilter: { mode: 'error' }
    });
    
    // Session overrides all
    configManager.setSessionOverride('allowed');
    expect(configManager.getCurrentMode()).toBe('allowed');
  });
  
  it('should revert to profile when session cleared', () => {
    configManager.setSessionOverride('allowed');
    configManager.clearSessionOverride();
    
    expect(configManager.getCurrentMode()).toBe('error'); // Back to profile
  });
});
```

## Verification Script

```bash
#!/bin/bash
# verify-behavioral-tests.sh

echo "=== Checking for forbidden mock patterns ==="

# Check for mocking components under test
echo "Checking for MockEmojiFilter..."
grep -r "mock.*EmojiFilter" packages/*/src/**/*.test.ts

echo "Checking for MockWriteFileTool..."
grep -r "mock.*WriteFileTool" packages/*/src/**/*.test.ts

echo "Checking for toHaveBeenCalled..."
grep -r "toHaveBeenCalled" packages/*/src/**/*.test.ts

echo "=== Checking test coverage ==="

# Count behavioral vs structural tests
BEHAVIORAL=$(grep -r "expect.*toBe\|toEqual\|toMatch" packages/*/src/**/*.test.ts | wc -l)
STRUCTURAL=$(grep -r "expect.*toBeDefined\|toBeInstanceOf" packages/*/src/**/*.test.ts | wc -l)

echo "Behavioral assertions: $BEHAVIORAL"
echo "Structural assertions: $STRUCTURAL"

# Check property test percentage
TOTAL_TESTS=$(grep -r "^[ ]*it\(\|^[ ]*test\(" packages/*/src/**/*.test.ts | wc -l)
PROPERTY_TESTS=$(grep -r "test\.prop\(" packages/*/src/**/*.test.ts | wc -l)
PERCENTAGE=$((PROPERTY_TESTS * 100 / TOTAL_TESTS))

echo "Property tests: $PROPERTY_TESTS / $TOTAL_TESTS ($PERCENTAGE%)"
[ $PERCENTAGE -lt 30 ] && echo "WARNING: Need more property tests!"

echo "=== Running behavioral tests ==="
npm test -- --grep "Integration|E2E|Behavioral"
```

## Success Criteria

1. **No Mock Theater**: Zero instances of mocking the component being tested
2. **30% Property Tests**: At least 30% of tests use property-based testing
3. **Integration Coverage**: Every tool that modifies files has integration tests
4. **E2E Coverage**: User flows are tested from CLI input to filtered output
5. **All Tests Pass**: Including the new WriteFileTool emoji test that currently fails

## Timeline

- R01-R02: Immediate - Fix critical WriteFileTool bug
- R03-R04: Day 1 - Tool integration coverage
- R05: Day 2 - CLI end-to-end tests  
- R06: Day 2 - Property test requirement
- R07: Day 3 - Configuration hierarchy tests