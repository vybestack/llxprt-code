# Task: Resolve packages/cli/src/config/auth.ts Conflict

## Objective

Resolve the merge conflict in the authentication configuration file, preserving multi-provider auth support and any new auth improvements from main.

## File

`packages/cli/src/config/auth.ts`

## Context

- **multi-provider branch**: Added support for multiple provider API keys (OpenAI, Anthropic)
- **main branch**: May have auth improvements or new validation

## Resolution Strategy

1. Examine the conflict markers in the file
2. Preserve the multi-provider authentication structure
3. Include any new validation or error handling from main
4. Ensure all provider types are properly typed

## Key Items to Preserve

### From multi-provider:

- `OPENAI_API_KEY` support
- `ANTHROPIC_API_KEY` support
- Provider-specific auth validation
- Multi-provider auth interfaces

### From main:

- Improved error messages
- New validation logic
- Security improvements
- Better type safety

## Code Structure to Maintain

```typescript
// Should support multiple providers
interface AuthConfig {
  gemini?: { apiKey: string };
  openai?: { apiKey: string };
  anthropic?: { apiKey: string };
  // ... other providers
}
```

## Commands to Execute

```bash
# After resolution:
git add packages/cli/src/config/auth.ts
```

## Validation

1. TypeScript compilation: `npx tsc --noEmit packages/cli/src/config/auth.ts`
2. All provider auth methods work
3. Backward compatibility maintained
