# Phase 15: Auth Command Multi-Provider Stub

## Objective
Modify auth command to support provider-specific OAuth flows.

## Input
- specification.md [REQ-001]
- analysis/pseudocode/auth-command.md
- Existing auth command implementation

## Tasks
1. Modify packages/cli/src/commands/auth.ts
2. Add provider-specific OAuth support
3. New functionality throws NotYetImplemented

## Required Modifications
```typescript
class AuthCommand {
  private oauthManager: OAuthManager
  
  // Modified execute to support provider argument
  async execute(provider?: string): Promise<void> {
    if (provider) {
      // Direct provider authentication
      throw new Error('NotYetImplemented')
    } else {
      // Show OAuth provider menu
      throw new Error('NotYetImplemented')
    }
  }
  
  // New method for OAuth menu
  private async showOAuthMenu(): Promise<string> {
    throw new Error('NotYetImplemented')
  }
  
  // New method for provider auth
  private async authenticateProvider(provider: string): Promise<void> {
    throw new Error('NotYetImplemented')
  }
  
  // Remove API key setup methods
  // These move to documentation/config only
}
```

## Command Patterns
- `/auth` - Shows OAuth provider menu
- `/auth gemini` - Direct Gemini OAuth
- `/auth qwen` - Direct Qwen OAuth

## Menu Structure (REQ-001.1)
```
Available OAuth providers:
1. Gemini (Google OAuth)
2. Qwen (OAuth)

Select provider to authenticate:
```

## Files to Modify
- packages/cli/src/commands/auth.ts

## Verification
- TypeScript compiles
- Command registration updated
- OAuth-only focus clear
- No API key options in menu