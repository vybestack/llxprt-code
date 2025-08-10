# Phase 17: Auth Command Implementation

## Objective
Implement multi-provider OAuth support in auth command.

## Input
- Failing tests from phase 16
- analysis/pseudocode/auth-command.md
- OAuth manager from phase 11

## Implementation Requirements

### Command Execution
```typescript
async execute(provider?: string): Promise<void> {
  if (provider) {
    // Direct provider authentication
    await this.authenticateProvider(provider)
  } else {
    // Show OAuth provider menu
    const selected = await this.showOAuthMenu()
    if (selected) {
      await this.authenticateProvider(selected)
    }
  }
}
```

### OAuth Menu
```typescript
private async showOAuthMenu(): Promise<string> {
  const providers = this.oauthManager.getSupportedProviders()
  const status = await this.oauthManager.getAuthStatus()
  
  console.log('Available OAuth providers:')
  providers.forEach((provider, index) => {
    const authStatus = status.find(s => s.provider === provider)
    const checkmark = authStatus?.authenticated ? ' ✓' : ''
    console.log(`${index + 1}. ${this.getProviderDisplay(provider)}${checkmark}`)
  })
  
  const choice = await prompt('Select provider to authenticate: ')
  return providers[parseInt(choice) - 1]
}
```

### Provider Authentication
```typescript
private async authenticateProvider(provider: string): Promise<void> {
  const supported = this.oauthManager.getSupportedProviders()
  
  if (!supported.includes(provider)) {
    console.error(`Provider '${provider}' not supported`)
    console.log(`Available providers: ${supported.join(', ')}`)
    return
  }
  
  try {
    await this.oauthManager.authenticate(provider)
    console.log(`Successfully authenticated with ${provider}`)
  } catch (error) {
    console.error(`Authentication failed: ${error.message}`)
  }
}
```

### Provider Display Names
```typescript
private getProviderDisplay(provider: string): string {
  const displays = {
    'gemini': 'Gemini (Google OAuth)',
    'qwen': 'Qwen (OAuth)'
  }
  return displays[provider] || provider
}
```

## Key Implementation Points
- Remove all API key setup code
- OAuth-only menu items
- Clear provider names in display
- Status indicators for authenticated providers
- Handle both direct and menu-based auth

## Error Handling
- Unknown provider: List available options
- Auth failure: Show user-friendly message
- Cancellation: Return gracefully

## Forbidden
- No API key prompts or options
- No console.log in tests
- No breaking existing OAuth flows

## Verification
- npm test packages/cli/src/commands/auth.spec.ts
- Menu shows only OAuth providers
- Direct auth works: /auth qwen
- Menu selection works
- Status indicators display correctly