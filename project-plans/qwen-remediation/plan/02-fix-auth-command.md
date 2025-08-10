# Phase 02: Fix Auth Command

## Objective

Modify the `/auth` command to toggle OAuth enablement per provider instead of triggering OAuth flows. Add warning system for when OAuth won't be used due to existing authentication methods.

## Context

The current auth command likely calls OAuth manager to start flows. It needs to be changed to toggle enablement state and provide user feedback about the auth precedence.

## Implementation Changes

### 1. Update Auth Command Logic

**Core changes:**
- Remove OAuth flow triggering
- Add OAuth enablement toggling
- Add enablement state persistence
- Add warning detection for existing auth methods
- Improve user feedback

### 2. Add Config Management

**Enablement storage:**
- Store OAuth enablement state per provider
- Persist state to configuration file
- Load state on startup

### 3. Add Warning System

**Warning scenarios:**
- OAuth enabled but API key exists (via `/key`)
- OAuth enabled but keyfile exists (via `/keyfile`)
- OAuth enabled but CLI args will override
- OAuth enabled but ENV vars exist
- OpenAI OAuth enabled but baseURL isn't Qwen

### 4. Enhance User Feedback

**Status display:**
- Show current enablement state
- Show which auth method will actually be used
- Provide clear warnings about precedence
- Confirm toggle actions

## Files to Modify

### Primary Files
- `packages/cli/src/commands/auth.ts` - Main command logic
- `packages/core/src/config/auth-config.ts` - Auth configuration management
- `packages/core/src/types/auth.ts` - Auth-related types

### Supporting Files
- Any slash command processor that handles `/auth`
- Configuration loading/saving utilities

## Implementation Details

### Auth Command Structure
```typescript
export class AuthCommand {
  async execute(provider: string): Promise<string> {
    // Toggle enablement state
    const newState = this.toggleOAuthEnabledment(provider);
    
    // Check for warnings
    const warnings = this.checkAuthPrecedenceWarnings(provider);
    
    // Provide feedback
    return this.formatResponse(provider, newState, warnings);
  }
  
  private checkAuthPrecedenceWarnings(provider: string): string[] {
    const warnings: string[] = [];
    
    // Check for higher priority auth methods
    if (this.hasApiKey(provider)) {
      warnings.push(`API key configured - OAuth will not be used`);
    }
    
    // Check for OpenAI/Qwen endpoint mismatch
    if (provider === 'qwen' && this.isOpenAIEndpointMismatch()) {
      warnings.push(`OpenAI baseURL is not Qwen - OAuth will not work`);
    }
    
    return warnings;
  }
}
```

### Config Structure
```typescript
interface OAuthConfig {
  [provider: string]: {
    enabled: boolean;
    lastToggled: Date;
  };
}

export class AuthConfig {
  setOAuthEnabled(provider: string, enabled: boolean): void;
  getOAuthEnabled(provider: string): boolean;
  save(): Promise<void>;
  load(): Promise<void>;
}
```

## Expected Behavior Changes

### Before (Current - Incorrect)
```bash
$ /auth qwen
Starting Qwen OAuth flow...
[Opens browser for OAuth]
```

### After (Fixed - Correct)
```bash
$ /auth qwen
✓ Qwen OAuth enabled
⚠️  API key is configured - OAuth will not be used
Current auth method: API key (/key command)

$ /auth qwen
✓ Qwen OAuth disabled
```

## Verification Steps

1. **Toggle Functionality**
   - Command toggles enablement on/off correctly
   - State persists across CLI restarts
   - Multiple providers can have different states

2. **Warning System**
   - Warns when API keys exist
   - Warns about OpenAI endpoint mismatches
   - Shows actual auth method that will be used

3. **User Experience**
   - Clear feedback about current state
   - Helpful warnings about precedence
   - No unexpected OAuth flows triggered

## Success Criteria

- [ ] `/auth <provider>` toggles OAuth enablement
- [ ] No OAuth flows triggered by command
- [ ] Enablement state persists to config file
- [ ] Warnings shown for auth precedence conflicts
- [ ] Clear user feedback about current state
- [ ] OpenAI/Qwen endpoint validation warnings