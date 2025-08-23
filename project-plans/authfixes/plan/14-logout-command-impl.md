# Phase 14: Logout Command Implementation

## Phase ID
`PLAN-20250823-AUTHFIXES.P14`

## Prerequisites
- Required: Phase 13 completed
- Verification: Logout tests exist and fail
- Expected: oauth-manager-logout.test.ts failing

## Implementation Tasks

### Files to Modify

1. **`/packages/cli/src/auth/oauth-manager.ts`**
   - IMPLEMENT logout following pseudocode lines 4-37
   - IMPLEMENT logoutAll following lines 39-49
   - IMPLEMENT isAuthenticated following lines 51-68
   - UPDATE registerProviders following lines 70-79
   - MUST include: `@plan:PLAN-20250823-AUTHFIXES.P14`

2. **`/packages/cli/src/ui/commands/authCommand.ts`**
   - IMPLEMENT execute update following lines 4-24
   - IMPLEMENT logoutProvider following lines 26-63
   - UPDATE showProviderStatus following lines 65-90
   - MUST include: `@plan:PLAN-20250823-AUTHFIXES.P14`

### Implementation Following Pseudocode

OAuthManager logout (lines 4-37):
```typescript
/**
 * @plan PLAN-20250823-AUTHFIXES.P14
 * @requirement REQ-002.1
 * @pseudocode lines 4-37
 */
async logout(providerName: string): Promise<void> {
  // Line 5-8: VALIDATE providerName
  if (!providerName || typeof providerName !== 'string') {
    throw new Error('Provider name must be a non-empty string');
  }
  
  // Line 10-13: Get provider
  const provider = this.providers.get(providerName);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerName}`);
  }
  
  // Lines 16-26: Call provider logout if exists
  if ('logout' in provider && typeof provider.logout === 'function') {
    try {
      await provider.logout();
    } catch (error) {
      console.warn(`Provider logout failed:`, error);
    }
  } else {
    await this.tokenStore.removeToken(providerName);
  }
  
  // Lines 28-30: Update settings
  const settingsService = getSettingsService();
  await settingsService.updateSetting(
    `auth.${providerName}.oauth.enabled`,
    false
  );
}
```

## Verification Commands

```bash
# All logout tests pass
npm test packages/cli/test/auth/oauth-manager-logout.test.ts
npm test packages/cli/test/ui/commands/auth-command-logout.test.ts
# Expected: All passing

# Verify pseudocode references
grep -c "@pseudocode" packages/cli/src/auth/oauth-manager.ts
# Expected: 4+ references

grep -c "@pseudocode" packages/cli/src/ui/commands/authCommand.ts  
# Expected: 3+ references

# Integration test
echo "/auth qwen logout" | npm run cli
# Expected: Logout successful or not authenticated message
```

## Success Criteria

- All logout tests pass
- Pseudocode followed exactly
- Integration works end-to-end
- Settings updated on logout

## Phase Completion Marker

Create: `project-plans/authfixes/.completed/P14.md`