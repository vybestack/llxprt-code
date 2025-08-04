# Prompt Configuration System - Architectural Design

## 1. System Overview

The Prompt Configuration System replaces hardcoded TypeScript prompts with a flexible, file-based configuration system that supports provider/model-specific customization while maintaining performance through intelligent caching.

## 2. Component Architecture

### 2.1 Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                        Application                           │
├─────────────────────────────────────────────────────────────┤
│                    PromptService (API)                       │
├─────────────────────────────────────────────────────────────┤
│  PromptResolver  │  PromptLoader  │  PromptCache           │
├──────────────────┼────────────────┼────────────────────────┤
│  FileSystem      │  TemplateEngine │  PromptInstaller       │
└──────────────────┴────────────────┴────────────────────────┘
```

### 2.2 Component Responsibilities

#### PromptService (Public API)
- Primary interface for the application
- Coordinates between components
- Manages initialization and lifecycle

#### PromptResolver
- Implements file resolution algorithm
- Determines which files to load based on provider/model
- Handles fallback hierarchy

#### PromptLoader
- Reads files from filesystem
- Applies compression to reduce token usage
- Handles file I/O errors gracefully
- Detects environment conditions

#### PromptCache
- Stores assembled prompts in memory
- Provides O(1) lookup
- Manages cache keys and invalidation

#### TemplateEngine
- Performs variable substitution
- Validates template syntax
- Handles malformed templates gracefully

#### PromptInstaller
- Creates missing directories
- Installs default files from built-in content
- Preserves existing user customizations

## 3. Data Structures

### 3.1 Core Types

```typescript
interface PromptContext {
  provider: string;
  model: string;
  enabledTools: string[];
  environment: {
    isGitRepository: boolean;
    isSandboxed: boolean;
    hasIdeCompanion: boolean;
  };
}

interface PromptFile {
  path: string;
  content: string;
  type: 'core' | 'env' | 'tool';
}

interface ResolvedPrompt {
  files: PromptFile[];
  assembledContent: string;
  metadata: {
    totalTokens?: number;
    loadTimeMs: number;
  };
}

interface TemplateVariables {
  TOOL_NAME?: string;
  MODEL: string;
  PROVIDER: string;
  [key: string]: string | undefined;
}
```

### 3.2 File System Structure

```typescript
interface PromptFileSystem {
  baseDir: string; // ~/.llxprt/prompts
  structure: {
    'core.md': string;
    'env/': {
      'git-repository.md': string;
      'sandbox.md': string;
      'ide-mode.md': string;
    };
    'tools/': {
      [toolName: string]: string; // e.g., 'read-file.md'
    };
    'providers/': {
      [provider: string]: {
        'core.md'?: string;
        'env/'?: Record<string, string>;
        'tools/'?: Record<string, string>;
        'models/'?: {
          [model: string]: {
            'core.md'?: string;
            'env/'?: Record<string, string>;
            'tools/'?: Record<string, string>;
          };
        };
      };
    };
  };
}
```

## 4. Key Algorithms

### 4.1 File Resolution Algorithm

```typescript
function resolveFilePath(
  relativePath: string,
  context: PromptContext
): string | null {
  const searchPaths = [
    `providers/${context.provider}/models/${context.model}/${relativePath}`,
    `providers/${context.provider}/${relativePath}`,
    relativePath
  ];
  
  // Return first existing file
  for (const path of searchPaths) {
    if (fileExists(path)) return path;
  }
  return null;
}
```

### 4.2 Prompt Assembly Algorithm

```typescript
function assemblePrompt(context: PromptContext): string {
  const parts: string[] = [];
  
  // 1. Core prompt
  parts.push(loadAndProcess('core.md', context));
  
  // 2. Environment-specific prompts
  if (context.environment.isGitRepository) {
    parts.push(loadAndProcess('env/git-repository.md', context));
  }
  if (context.environment.isSandboxed) {
    parts.push(loadAndProcess('env/sandbox.md', context));
  }
  if (context.environment.hasIdeCompanion) {
    parts.push(loadAndProcess('env/ide-mode.md', context));
  }
  
  // 3. Tool-specific prompts
  for (const tool of context.enabledTools) {
    const toolFile = `tools/${kebabCase(tool)}.md`;
    parts.push(loadAndProcess(toolFile, context));
  }
  
  // 4. User memory (passed separately, not from files)
  
  return parts.filter(Boolean).join('\n\n');
}
```

### 4.3 Compression Algorithm

```typescript
function compressPrompt(content: string): string {
  const lines = content.split('\n');
  const compressed: string[] = [];
  let inCodeBlock = false;
  
  for (const line of lines) {
    // Detect code block boundaries
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      compressed.push(line);
      continue;
    }
    
    // Preserve code blocks exactly
    if (inCodeBlock) {
      compressed.push(line);
      continue;
    }
    
    // Compress prose sections
    let compressedLine = line
      .replace(/^#{2,}\s+/, '# ')  // Simplify headers
      .replace(/^-\s+\*\*(.+?)\*\*:\s*/, '- $1: ')  // Simplify bold lists
      .trim();
    
    // Skip multiple blank lines
    if (compressedLine || compressed[compressed.length - 1] !== '') {
      compressed.push(compressedLine);
    }
  }
  
  return compressed.join('\n');
}
```

### 4.4 Cache Key Generation

```typescript
function generateCacheKey(context: PromptContext): string {
  return [
    context.provider,
    context.model,
    context.enabledTools.sort().join(','),
    context.environment.isGitRepository ? 'git' : '',
    context.environment.isSandboxed ? 'sandbox' : '',
    context.environment.hasIdeCompanion ? 'ide' : ''
  ].filter(Boolean).join(':');
}
```

## 5. Integration Points

### 5.1 Application Integration

```typescript
interface IPromptService {
  initialize(): Promise<void>;
  getPrompt(context: PromptContext, userMemory?: string): string;
  getDefaultFiles(): Record<string, string>;
}
```

### 5.2 Provider Integration

Each provider will call the PromptService with appropriate context:

```typescript
// In GeminiProvider
const prompt = this.promptService.getPrompt({
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  enabledTools: this.enabledTools,
  environment: {
    isGitRepository: await isGitRepository(),
    isSandboxed: process.env.SANDBOX === '1',
    hasIdeCompanion: this.ideCompanion.isConnected()
  }
});
```

## 6. Default Content Management

### 6.1 Built-in Defaults

Default content is maintained as TypeScript constants:

```typescript
const DEFAULT_PROMPTS: Record<string, string> = {
  'core.md': '...extracted from current getCoreSystemPrompt()...',
  'env/git-repository.md': '...git-specific instructions...',
  'env/sandbox.md': '...sandbox warnings...',
  'env/ide-mode.md': '...IDE context handling...',
  'tools/read-file.md': '...read file instructions...',
  // ... all other defaults
};

const PROVIDER_DEFAULTS: Record<string, Record<string, string>> = {
  'providers/gemini/models/gemini-2.5-flash/core.md': '...flash-specific...'
};
```

### 6.2 Installation Process

```typescript
class PromptInstaller {
  async install(baseDir: string): Promise<void> {
    // 1. Create directory structure
    await this.createDirectories(baseDir);
    
    // 2. Install missing files
    for (const [path, content] of Object.entries(ALL_DEFAULTS)) {
      const fullPath = path.join(baseDir, path);
      if (!await fileExists(fullPath)) {
        await writeFile(fullPath, content);
      }
    }
  }
}
```

## 7. Error Handling Strategy

### 7.1 File System Errors

- **Missing ~/.llxprt**: Fatal error, clear message to user
- **Permission denied**: Fatal error with remediation instructions
- **Missing prompt file**: Use fallback in hierarchy
- **Corrupted file**: Log warning, use fallback

### 7.2 Template Errors

- **Malformed variable**: Leave as-is in output
- **Missing variable value**: Use empty string
- **Circular references**: Not supported, document limitation

## 8. Performance Characteristics

### 8.1 Startup Performance

- **File I/O**: One-time cost at startup
- **Compression**: Minimal overhead during loading
- **Parsing**: Linear time based on file count
- **Caching**: O(1) HashMap storage

### 8.2 Runtime Performance

- **Prompt retrieval**: O(1) cache lookup
- **No file I/O**: All operations from memory
- **Memory usage**: ~100KB for typical setup

## 9. Migration Path

### 9.1 Backward Compatibility

- No backward compatibility mode
- Clean cutover from old to new system
- One-time extraction of hardcoded prompts

### 9.2 Testing Strategy

- Side-by-side comparison of outputs
- Regression tests for all provider/model combinations
- Performance benchmarks

## 10. Security Considerations

### 10.1 File System Security

- Read files only from ~/.llxprt/prompts
- No path traversal allowed
- No execution of prompt content

### 10.2 Template Security

- No code evaluation in templates
- Simple string substitution only
- Sanitize variable values

## 11. Future Extensibility

### 11.1 Potential Extensions

- Dynamic prompt reloading (file watcher)
- Prompt validation and linting
- Version control integration
- Sharing prompt configurations

### 11.2 Non-Goals

- Complex template logic (conditionals, loops)
- Remote prompt loading
- Prompt compilation or preprocessing
- Multi-language prompt support

## 12. Dependencies

- Node.js fs module (file system operations)
- No external dependencies for core functionality
- Optional: Token counting library for metrics