# Migration Strategy: Hardcoded to File-Based Prompts

## Overview

This document details the strategy for migrating from the current hardcoded TypeScript prompt system to the new file-based configuration system.

## Current State Analysis

### Source Files to Migrate

1. **Core Prompts**: `/packages/core/src/core/prompts.ts`
   - `getCoreSystemPrompt()` function contains ~350 lines of hardcoded prompt
   - Dynamic sections based on environment detection
   - Model-specific logic (Flash models)

2. **Tool Descriptions**: Various tool files in `/packages/core/src/tools/`
   - Each tool has embedded descriptions
   - Need to extract and convert to markdown files

3. **Provider Integration**: Provider files that use prompts
   - `/packages/core/src/providers/gemini/GeminiProvider.ts`
   - `/packages/core/src/providers/anthropic/AnthropicProvider.ts`
   - `/packages/core/src/providers/openai/OpenAIProvider.ts`

## Migration Steps

### Phase 1: Content Extraction

#### 1.1 Extract Core Prompt Sections

From `getCoreSystemPrompt()`, extract:

```typescript
// Current structure to extract:
const basePrompt = `...main instructions...`; // → core.md
const gitSection = `...git-specific...`;      // → env/git-repository.md
const sandboxSection = `...sandbox...`;       // → env/sandbox.md
const ideSection = `...ide-specific...`;      // → env/ide-mode.md
```

#### 1.2 Extract Model-Specific Content

Flash-specific instructions:
```typescript
// From line ~250 in prompts.ts
if (model?.includes('flash')) {
  prompt += `\n\nIMPORTANT: When asked to perform a task...`;
}
// → providers/gemini/models/gemini-2.5-flash/core.md
```

#### 1.3 Extract Tool Instructions

From the core prompt, extract tool-specific sections:
- Shell/Bash usage instructions → `tools/shell.md`
- File reading instructions → `tools/read-file.md`
- Editing instructions → `tools/edit.md`
- Todo management → `tools/todo-write.md`

### Phase 2: File Structure Creation

```bash
~/.llxprt/prompts/
├── core.md                                    # Base prompt without env/tool sections
├── env/
│   ├── git-repository.md                     # Git-specific instructions
│   ├── sandbox.md                            # Sandbox warnings
│   └── ide-mode.md                           # IDE companion instructions
├── tools/
│   ├── shell.md                              # Bash command instructions
│   ├── read-file.md                          # File reading instructions
│   ├── edit.md                               # File editing instructions
│   ├── write.md                              # File writing instructions
│   ├── todo-write.md                         # Todo management instructions
│   └── ...                                   # One per tool
└── providers/
    └── gemini/
        └── models/
            └── gemini-2.5-flash/
                └── core.md                    # Flash-specific tool usage
```

### Phase 3: Code Transformation

#### 3.1 Replace getCoreSystemPrompt()

```typescript
// OLD: packages/core/src/core/prompts.ts
export function getCoreSystemPrompt(userMemory?: string, model?: string): string {
  // 350+ lines of hardcoded prompt
}

// NEW: packages/core/src/core/prompts.ts
export function getCoreSystemPrompt(userMemory?: string, model?: string): string {
  const context = {
    provider: getCurrentProvider(),
    model: model || getCurrentModel(),
    enabledTools: getEnabledTools(),
    environment: {
      isGitRepository: isGitRepository(),
      isSandboxed: process.env.SANDBOX === '1',
      hasIdeCompanion: hasIdeCompanion()
    }
  };
  
  const prompt = promptService.getPrompt(context);
  return userMemory ? `${prompt}\n\n${userMemory}` : prompt;
}
```

#### 3.2 Update Provider Integration

```typescript
// Example: GeminiProvider.ts
class GeminiProvider {
  async completeChat(request: ChatCompletionRequest): Promise<Response> {
    // OLD
    const systemInstruction = getCoreSystemPrompt(userMemory, model);
    
    // NEW
    const systemInstruction = this.promptService.getPrompt({
      provider: 'gemini',
      model: request.model,
      enabledTools: this.enabledTools,
      environment: await this.detectEnvironment()
    }, userMemory);
  }
}
```

### Phase 4: Default Content Management

#### 4.1 Create Default Constants

```typescript
// packages/core/src/prompt-config/defaults/core.ts
export const CORE_DEFAULTS = {
  'core.md': `# Core System Prompt
You are an AI assistant...
[extracted from current getCoreSystemPrompt base content]
`,
  
  'env/git-repository.md': `# Git Repository Instructions
When working in a git repository...
[extracted from git-specific sections]
`,
  
  'env/sandbox.md': `# Sandbox Environment
You are running in a sandboxed environment...
[extracted from sandbox sections]
`,
  
  // ... all other defaults
};
```

#### 4.2 Provider-Specific Defaults

```typescript
// packages/core/src/prompt-config/defaults/providers.ts
export const PROVIDER_DEFAULTS = {
  'providers/gemini/models/gemini-2.5-flash/core.md': `
IMPORTANT: When asked to perform a task that requires the use of tools, you should directly use the tool instead of describing what the tool would do.
[extracted from flash-specific logic]
`
};
```

### Phase 5: Testing Strategy

#### 5.1 Regression Testing

Create tests that compare old vs new output:

```typescript
describe('Migration Compatibility', () => {
  it('should produce identical prompts for default configuration', () => {
    const oldPrompt = getCoreSystemPromptLegacy();
    const newPrompt = promptService.getPrompt(defaultContext);
    
    // Normalize whitespace for comparison
    expect(normalize(newPrompt)).toBe(normalize(oldPrompt));
  });
  
  it('should handle Flash model specifics correctly', () => {
    const oldPrompt = getCoreSystemPromptLegacy('', 'gemini-2.5-flash');
    const newPrompt = promptService.getPrompt({
      ...defaultContext,
      provider: 'gemini',
      model: 'gemini-2.5-flash'
    });
    
    expect(newPrompt).toContain('directly use the tool');
  });
});
```

#### 5.2 Environment Detection Testing

```typescript
describe('Environment Detection Migration', () => {
  it('should include git instructions when in git repo', () => {
    mockIsGitRepository(true);
    const prompt = promptService.getPrompt(context);
    expect(prompt).toContain('git repository instructions');
  });
});
```

### Phase 6: Rollout Plan

1. **Development Phase**
   - Implement new system alongside old
   - Add feature flag: `USE_FILE_PROMPTS`
   - Run both systems in parallel for testing

2. **Testing Phase**
   - A/B test with team members
   - Verify identical behavior
   - Performance benchmarks

3. **Migration Phase**
   - Enable for new installations
   - Provide migration command for existing users
   - Keep old system for 1 release cycle

4. **Cleanup Phase**
   - Remove old getCoreSystemPrompt implementation
   - Remove feature flag
   - Update documentation

## Rollback Strategy

If issues are discovered:

1. **Immediate**: Feature flag to disable new system
2. **Patch Release**: Revert to old implementation
3. **User Files**: Preserved in ~/.llxprt/prompts for manual recovery

## Success Metrics

- [ ] All regression tests pass
- [ ] No change in prompt token count for same configuration
- [ ] Performance improvement (<100ms assembly time)
- [ ] Zero user-reported prompt behavior changes
- [ ] Successful customization by early adopters