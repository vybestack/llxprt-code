# Behavioral Test Examples for Prompt Configuration System

## Overview

This document provides concrete examples of BEHAVIORAL tests that verify the system's actual behavior through input/output transformations, NOT implementation details or mock interactions.

## Key Testing Principles

1. **Test behavior, not implementation** - Verify what the system does, not how
2. **Use real objects** - Mocks only to isolate the unit under test
3. **Verify transformations** - Input → Output with specific values
4. **Test observable effects** - File creation, cache state, returned values

## 1. File Resolution Behavior Tests

### Test: Resolution follows hierarchy order

```typescript
describe('PromptResolver', () => {
  let resolver: PromptResolver;
  let mockLoader: PromptLoader;
  
  beforeEach(() => {
    // Mock ONLY external dependencies (file system)
    mockLoader = {
      fileExists: jest.fn(),
      loadFile: jest.fn()
    };
    resolver = new PromptResolver(mockLoader);
  });

  it('should resolve model-specific file when it exists', async () => {
    /**
     * @requirement REQ-002.1, REQ-002.2
     * @scenario Model-specific override exists
     * @given File exists at model-specific path
     * @when resolveFile('core.md', context) is called
     * @then Returns model-specific file path and content
     */
    const context = {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      enabledTools: [],
      environment: { isGitRepository: false, isSandboxed: false, hasIdeCompanion: false }
    };
    
    // Setup file system state
    mockLoader.fileExists.mockImplementation((path) => 
      path === 'providers/gemini/models/gemini-2.5-flash/core.md'
    );
    mockLoader.loadFile.mockResolvedValue('Flash-specific content');
    
    // Act - test REAL behavior
    const result = await resolver.resolveFile('core.md', context);
    
    // Assert - verify actual output
    expect(result).toEqual({
      requestedPath: 'core.md',
      resolvedPath: 'providers/gemini/models/gemini-2.5-flash/core.md',
      content: 'Flash-specific content',
      source: 'model'
    });
  });

  it('should fall back through hierarchy when files missing', async () => {
    /**
     * @requirement REQ-002.4
     * @scenario Model and provider files missing, base exists
     * @given Only base file exists
     * @when resolveFile('env/git-repository.md', context) is called  
     * @then Returns base file with correct metadata
     */
    const context = {
      provider: 'ollama',
      model: 'llama-3-70b',
      enabledTools: [],
      environment: { isGitRepository: true, isSandboxed: false, hasIdeCompanion: false }
    };
    
    // Only base file exists
    mockLoader.fileExists.mockImplementation((path) => 
      path === 'env/git-repository.md'
    );
    mockLoader.loadFile.mockResolvedValue('Git instructions for all providers');
    
    const result = await resolver.resolveFile('env/git-repository.md', context);
    
    expect(result).toEqual({
      requestedPath: 'env/git-repository.md',
      resolvedPath: 'env/git-repository.md',
      content: 'Git instructions for all providers',
      source: 'base'
    });
  });
});
```

### Test: Tool file name conversion

```typescript
describe('PromptResolver tool name conversion', () => {
  it('should convert PascalCase tool names to kebab-case files', async () => {
    /**
     * @requirement REQ-008.1
     * @scenario Tool class name needs file path
     * @given Tool name 'ReadFileTool'
     * @when resolving tool prompt file
     * @then Looks for 'tools/read-file.md'
     */
    const resolver = new PromptResolver(mockLoader);
    
    mockLoader.fileExists.mockImplementation((path) => 
      path === 'tools/read-file.md'
    );
    mockLoader.loadFile.mockResolvedValue('Read file instructions');
    
    const result = await resolver.resolveToolFile('ReadFileTool', defaultContext);
    
    expect(result.resolvedPath).toBe('tools/read-file.md');
    expect(result.content).toBe('Read file instructions');
  });
});
```

## 2. Prompt Assembly Behavior Tests

### Test: Assembly follows correct order

```typescript
describe('PromptService assembly', () => {
  it('should assemble prompts in correct order with environment conditions', async () => {
    /**
     * @requirement REQ-003.1, REQ-003.2
     * @scenario Git repository with enabled tools
     * @given Context indicates git repo and specific tools enabled
     * @when getPrompt() is called
     * @then Returns assembled prompt with sections in correct order
     */
    const service = new PromptService(resolver, cache, templateEngine);
    
    const context = {
      provider: 'anthropic',
      model: 'claude-3-opus',
      enabledTools: ['ReadFileTool', 'EditTool'],
      environment: {
        isGitRepository: true,
        isSandboxed: false,
        hasIdeCompanion: false
      }
    };
    
    // Mock resolved content
    mockResolver.resolveFile.mockImplementation(async (path) => {
      const contents = {
        'core.md': { content: 'CORE_CONTENT', source: 'base' },
        'env/git-repository.md': { content: 'GIT_CONTENT', source: 'base' },
        'tools/read-file.md': { content: 'READ_TOOL', source: 'base' },
        'tools/edit.md': { content: 'EDIT_TOOL', source: 'base' }
      };
      return contents[path] || { content: null, source: 'not-found' };
    });
    
    const result = await service.getPrompt(context, 'USER_MEMORY');
    
    // Verify order and content
    expect(result).toBe(
      'CORE_CONTENT\n\n' +
      'GIT_CONTENT\n\n' +
      'READ_TOOL\n\n' +
      'EDIT_TOOL\n\n' +
      'USER_MEMORY'
    );
  });

  it('should exclude environment sections when conditions not met', async () => {
    /**
     * @requirement REQ-003.2
     * @scenario Not in git repository
     * @given environment.isGitRepository = false
     * @when getPrompt() is called
     * @then Git section is not included in output
     */
    const context = {
      ...defaultContext,
      environment: {
        isGitRepository: false,
        isSandboxed: false,
        hasIdeCompanion: false
      }
    };
    
    const result = await service.getPrompt(context);
    
    expect(result).not.toContain('GIT_CONTENT');
    expect(resolver.resolveFile).not.toHaveBeenCalledWith('env/git-repository.md', expect.any(Object));
  });
});
```

## 3. Template Processing Behavior Tests

### Test: Variable substitution

```typescript
describe('TemplateEngine', () => {
  it('should substitute known variables with actual values', () => {
    /**
     * @requirement REQ-004.1, REQ-004.2
     * @scenario Template contains variable placeholders
     * @given Template with {{MODEL}} and {{PROVIDER}} variables
     * @when processTemplate() is called with variable values
     * @then Returns template with substituted values
     */
    const engine = new TemplateEngine();
    
    const template = 'You are running on {{PROVIDER}} using model {{MODEL}}';
    const variables = {
      PROVIDER: 'anthropic',
      MODEL: 'claude-3-opus'
    };
    
    const result = engine.processTemplate(template, variables);
    
    expect(result).toBe('You are running on anthropic using model claude-3-opus');
  });

  it('should leave malformed variables unchanged', () => {
    /**
     * @requirement REQ-004.3
     * @scenario Template contains malformed variable syntax
     * @given Template with invalid variable syntax
     * @when processTemplate() is called
     * @then Returns template with malformed parts unchanged
     */
    const engine = new TemplateEngine();
    
    const template = 'Valid {{MODEL}} but {{BROKEN and {{UNCLOSED';
    const variables = { MODEL: 'gpt-4' };
    
    const result = engine.processTemplate(template, variables);
    
    expect(result).toBe('Valid gpt-4 but {{BROKEN and {{UNCLOSED');
  });
});
```

## 4. Cache Behavior Tests

### Test: Cache key generation and retrieval

```typescript
describe('PromptCache', () => {
  it('should cache assembled prompts with correct keys', () => {
    /**
     * @requirement REQ-006.2, REQ-006.4
     * @scenario Same context requested multiple times
     * @given Context with specific provider, model, and tools
     * @when set() then get() with same context
     * @then Returns cached prompt without reassembly
     */
    const cache = new PromptCache();
    
    const context = {
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      enabledTools: ['ShellTool', 'ReadFileTool'],
      environment: {
        isGitRepository: true,
        isSandboxed: false,
        hasIdeCompanion: true
      }
    };
    
    const prompt = 'Assembled prompt content';
    
    // Store in cache
    cache.set(context, prompt, { files: ['core.md'], assemblyTimeMs: 5 });
    
    // Retrieve from cache
    const cached = cache.get(context);
    
    expect(cached).toEqual({
      assembledPrompt: 'Assembled prompt content',
      metadata: {
        files: ['core.md'],
        assemblyTimeMs: 5
      }
    });
  });

  it('should generate different keys for different contexts', () => {
    /**
     * @requirement REQ-006.4
     * @scenario Different enabled tools
     * @given Two contexts differing only in enabled tools
     * @when Caching prompts for both
     * @then Each gets its own cache entry
     */
    const cache = new PromptCache();
    
    const context1 = { ...defaultContext, enabledTools: ['ToolA'] };
    const context2 = { ...defaultContext, enabledTools: ['ToolB'] };
    
    cache.set(context1, 'Prompt A', { files: [], assemblyTimeMs: 1 });
    cache.set(context2, 'Prompt B', { files: [], assemblyTimeMs: 1 });
    
    expect(cache.get(context1).assembledPrompt).toBe('Prompt A');
    expect(cache.get(context2).assembledPrompt).toBe('Prompt B');
  });
});
```

## 5. Installation Behavior Tests

### Test: Directory and file creation

```typescript
describe('PromptInstaller', () => {
  it('should create missing directories and files', async () => {
    /**
     * @requirement REQ-005.1, REQ-005.2
     * @scenario Fresh installation with no existing files
     * @given Empty ~/.llxprt directory
     * @when install() is called
     * @then Creates all directories and default files
     */
    const mockFs = {
      exists: jest.fn().mockResolvedValue(false),
      mkdir: jest.fn().mockResolvedValue(undefined),
      writeFile: jest.fn().mockResolvedValue(undefined)
    };
    
    const installer = new PromptInstaller(mockFs, DEFAULT_CONTENT);
    
    await installer.install('/home/user/.llxprt/prompts');
    
    // Verify directories created
    expect(mockFs.mkdir).toHaveBeenCalledWith('/home/user/.llxprt/prompts', { recursive: true });
    expect(mockFs.mkdir).toHaveBeenCalledWith('/home/user/.llxprt/prompts/env', { recursive: true });
    expect(mockFs.mkdir).toHaveBeenCalledWith('/home/user/.llxprt/prompts/tools', { recursive: true });
    
    // Verify files created with correct content
    expect(mockFs.writeFile).toHaveBeenCalledWith(
      '/home/user/.llxprt/prompts/core.md',
      expect.stringContaining('You are an AI assistant')
    );
  });

  it('should preserve existing user files', async () => {
    /**
     * @requirement REQ-005.3
     * @scenario User has customized files
     * @given Existing core.md with user content
     * @when install() is called
     * @then Does not overwrite existing file
     */
    const mockFs = {
      exists: jest.fn().mockImplementation(path => 
        path.endsWith('core.md') // core.md exists
      ),
      mkdir: jest.fn().mockResolvedValue(undefined),
      writeFile: jest.fn().mockResolvedValue(undefined)
    };
    
    const installer = new PromptInstaller(mockFs, DEFAULT_CONTENT);
    
    await installer.install('/home/user/.llxprt/prompts');
    
    // Should NOT write core.md
    expect(mockFs.writeFile).not.toHaveBeenCalledWith(
      '/home/user/.llxprt/prompts/core.md',
      expect.anything()
    );
    
    // Should still create missing files
    expect(mockFs.writeFile).toHaveBeenCalledWith(
      '/home/user/.llxprt/prompts/env/git-repository.md',
      expect.anything()
    );
  });
});
```

## 6. Integration Tests

### Test: Full prompt generation flow

```typescript
describe('Prompt System Integration', () => {
  it('should generate correct prompt for Gemini Flash model', async () => {
    /**
     * @requirement REQ-002.1, REQ-003.1, REQ-004.2
     * @scenario Gemini Flash in git repo with tools
     * @given Complete context for Gemini Flash
     * @when Full prompt generation flow executes
     * @then Returns properly assembled and processed prompt
     */
    // Use real objects, only mock file system
    const mockFs = createMockFileSystem({
      'core.md': 'Base instructions for {{PROVIDER}}',
      'env/git-repository.md': 'Git commands available',
      'tools/shell.md': 'Use {{TOOL_NAME}} carefully',
      'providers/gemini/models/gemini-2.5-flash/core.md': 
        'IMPORTANT: Use tools directly for {{MODEL}}'
    });
    
    const loader = new PromptLoader(mockFs);
    const resolver = new PromptResolver(loader);
    const engine = new TemplateEngine();
    const cache = new PromptCache();
    const service = new PromptService(resolver, cache, engine);
    
    const context = {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      enabledTools: ['ShellTool'],
      environment: {
        isGitRepository: true,
        isSandboxed: false,
        hasIdeCompanion: false
      }
    };
    
    const result = await service.getPrompt(context);
    
    // Verify complete output
    expect(result).toBe(
      'IMPORTANT: Use tools directly for gemini-2.5-flash\n\n' +
      'Git commands available\n\n' +
      'Use ShellTool carefully'
    );
  });
});
```

## Key Behavioral Testing Patterns

1. **Always test transformations**: Input → Processing → Output
2. **Mock only boundaries**: File system, network, external services
3. **Verify actual values**: Not just presence or structure
4. **Test edge cases behaviorally**: What happens when X occurs?
5. **Integration over isolation**: Test components working together

## Anti-Patterns to Avoid

```typescript
// ❌ BAD: Testing mocks
it('should call loadFile', () => {
  service.getPrompt(context);
  expect(mockLoader.loadFile).toHaveBeenCalled();
});

// ✅ GOOD: Testing behavior
it('should return assembled prompt content', () => {
  const result = service.getPrompt(context);
  expect(result).toBe('Expected prompt content');
});

// ❌ BAD: Testing structure
it('should have content property', () => {
  const result = resolver.resolveFile('core.md', context);
  expect(result).toHaveProperty('content');
});

// ✅ GOOD: Testing values
it('should resolve to base file content', () => {
  const result = resolver.resolveFile('core.md', context);
  expect(result.content).toBe('Actual file content');
  expect(result.source).toBe('base');
});
```