# Phase 09: Gemini OAuth Stub

## Phase ID
`PLAN-20250823-AUTHFIXES.P09`

## Prerequisites
- Required: Phase 08 completed
- Verification: `grep -r "@plan:PLAN-20250823-AUTHFIXES.P08" .`
- Expected: Anthropic implementation complete

## Implementation Tasks

### Files to REWRITE Completely

1. **`/packages/cli/src/auth/gemini-oauth-provider.ts`**
   - COMPLETE REWRITE (current is placeholder)
   - Create proper OAuth provider class
   - Add Google OAuth device flow stubs
   - MUST include: `@plan:PLAN-20250823-AUTHFIXES.P09`
   - MUST include: `@requirement:REQ-001, REQ-003`

### Stub Structure

```typescript
/**
 * @plan PLAN-20250823-AUTHFIXES.P09
 * @requirement REQ-001.1
 * Gemini OAuth Provider - Complete rewrite from placeholder
 */
export class GeminiOAuthProvider implements OAuthProvider {
  name = 'gemini';
  private tokenStore?: TokenStore;
  
  constructor(tokenStore?: TokenStore) {
    this.tokenStore = tokenStore;
    throw new Error('NotYetImplemented');
  }
  
  async initiateAuth(): Promise<void> {
    // No longer throws USE_EXISTING_GEMINI_OAUTH
    throw new Error('NotYetImplemented');
  }
  
  async getToken(): Promise<OAuthToken | null> {
    return null;
  }
  
  async refreshIfNeeded(): Promise<OAuthToken | null> {
    return null;
  }
  
  async logout(): Promise<void> {
    throw new Error('NotYetImplemented');
  }
}
```

### Important Changes

- REMOVE error throwing `USE_EXISTING_GEMINI_OAUTH`
- REMOVE magic string returns
- Add proper OAuth structure
- Prepare for Google OAuth implementation

## Verification Commands

```bash
# Check old placeholder removed
grep -r "USE_EXISTING_GEMINI_OAUTH" packages/cli/src/auth/gemini-oauth-provider.ts
# Expected: No results

# Check plan markers
grep -r "@plan:PLAN-20250823-AUTHFIXES.P09" packages/cli/src/auth/
# Expected: 5+ occurrences

# TypeScript compiles
npm run typecheck
# Expected: Success
```

## Success Criteria

- Placeholder completely replaced
- Proper OAuth provider structure
- No magic strings
- TypeScript compiles

## Phase Completion Marker

Create: `project-plans/authfixes/.completed/P09.md`