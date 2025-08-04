# Task 13: Final Integration and Migration

## Objective

Create the main PromptService that integrates all components and update the existing system to use it.

## Context

This is the final phase that brings together all implemented components and migrates from the old hardcoded system.

## Requirements to Implement

- **[REQ-003]** Prompt Assembly requirements
- **[REQ-009]** Migration requirements

## Files to Create/Update

1. `packages/core/src/prompt-config/PromptService.ts` - Main service
2. `packages/core/src/prompt-config/index.ts` - Public exports
3. Update `packages/core/src/core/prompts.ts` - Use new system
4. Update provider files to use PromptService

## PromptService Implementation

The service coordinates all components:

```typescript
export class PromptService {
  constructor(
    private resolver: PromptResolver,
    private loader: PromptLoader,
    private cache: PromptCache,
    private templateEngine: TemplateEngine,
    private installer: PromptInstaller
  ) {}

  async initialize(baseDir: string): Promise<void> {
    // Install default files if missing
    await this.installer.install(baseDir);
  }

  async getPrompt(context: PromptContext, userMemory?: string): Promise<string> {
    // Check cache first
    // If miss, resolve and load files
    // Apply template substitution
    // Assemble in correct order
    // Cache result
    // Return assembled prompt
  }
}
```

## Migration Steps

1. Update `getCoreSystemPrompt()` to use PromptService
2. Create singleton instance of PromptService
3. Initialize on startup
4. Update providers to pass correct context

## Testing

Create integration tests that verify:
- Old and new systems produce equivalent output
- All components work together
- Performance is acceptable

## Success Criteria

- All unit tests still pass
- Integration tests pass
- Existing functionality preserved
- Token reduction achieved
- System initializes correctly