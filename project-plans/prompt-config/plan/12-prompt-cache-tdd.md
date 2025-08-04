# Task 12: PromptCache Component - TDD Phase

## Objective

Write comprehensive behavioral tests for the PromptCache component.

## Requirements to Test

- **[REQ-006.2]** Assembled prompts SHALL be cached with O(1) lookup
- **[REQ-006.4]** Cache keys SHALL include provider, model, tools, and environment

## File to Create

```
packages/core/test/prompt-config/PromptCache.spec.ts
```

## Required Behavioral Tests

```typescript
describe('PromptCache', () => {
  let cache: PromptCache;

  beforeEach(() => {
    cache = new PromptCache();
  });

  it('should store and retrieve prompts by context', () => {
    /**
     * @requirement REQ-006.2
     * @scenario Basic cache storage and retrieval
     * @given A context and assembled prompt
     * @when set() then get() with same context
     * @then Returns stored prompt and metadata
     */
    const context: PromptContext = {
      provider: 'anthropic',
      model: 'claude-3',
      enabledTools: ['ReadFileTool', 'EditTool'],
      environment: {
        isGitRepository: true,
        isSandboxed: false,
        hasIdeCompanion: false
      }
    };
    
    const prompt = 'Assembled prompt content here';
    const metadata = {
      files: ['core.md', 'tools/read-file.md'],
      assemblyTimeMs: 25
    };
    
    cache.set(context, prompt, metadata);
    const result = cache.get(context);
    
    expect(result).toEqual({
      assembledPrompt: prompt,
      metadata
    });
  });

  it('should generate different keys for different contexts', () => {
    /**
     * @requirement REQ-006.4
     * @scenario Different contexts get different cache entries
     * @given Two contexts differing in one property
     * @when Both cached
     * @then Each retrieves its own value
     */
    const context1: PromptContext = {
      provider: 'gemini',
      model: 'gemini-pro',
      enabledTools: ['ShellTool'],
      environment: { isGitRepository: false, isSandboxed: false, hasIdeCompanion: false }
    };
    
    const context2: PromptContext = {
      ...context1,
      enabledTools: ['ShellTool', 'ReadFileTool'] // Different tools
    };
    
    cache.set(context1, 'Prompt 1', { files: [], assemblyTimeMs: 10 });
    cache.set(context2, 'Prompt 2', { files: [], assemblyTimeMs: 15 });
    
    expect(cache.get(context1)?.assembledPrompt).toBe('Prompt 1');
    expect(cache.get(context2)?.assembledPrompt).toBe('Prompt 2');
  });

  it('should include all context properties in cache key', () => {
    /**
     * @requirement REQ-006.4
     * @scenario Cache key includes all required properties
     * @given Context with all properties
     * @when generateKey() called
     * @then Key contains provider, model, tools, environment
     */
    const context: PromptContext = {
      provider: 'ollama',
      model: 'llama2',
      enabledTools: ['EditTool', 'WriteFileTool'],
      environment: {
        isGitRepository: true,
        isSandboxed: true,
        hasIdeCompanion: true
      }
    };
    
    const key = cache.generateKey(context);
    
    expect(key).toContain('ollama');
    expect(key).toContain('llama2');
    expect(key).toContain('EditTool');
    expect(key).toContain('WriteFileTool');
    expect(key).toContain('git');
    expect(key).toContain('sandbox');
    expect(key).toContain('ide');
  });

  // Add 12+ more behavioral tests for:
  // - Empty cache returns null
  // - has() method behavior
  // - clear() empties cache
  // - size() returns count
  // - Tool order doesn't affect key
  // - Missing optional properties
  // - Cache overwrites on same key
  // - etc.
});
```

## Success Criteria

- 15+ behavioral tests
- Tests verify actual cache behavior
- All requirements covered
- No mock verification