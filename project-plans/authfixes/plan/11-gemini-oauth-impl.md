# Phase 11: Gemini OAuth Implementation

## Phase ID
`PLAN-20250823-AUTHFIXES.P11`

## Prerequisites
- Required: Phase 10 completed
- Verification: Gemini tests exist and fail
- Expected: gemini-oauth-provider.test.ts failing

## Implementation Tasks

### Files to Modify

1. **`/packages/cli/src/auth/gemini-oauth-provider.ts`**
   - IMPLEMENT complete Google OAuth flow
   - Use actual Google OAuth endpoints
   - Handle token persistence
   - MUST include: `@plan:PLAN-20250823-AUTHFIXES.P11`

### Implementation Structure

```typescript
/**
 * @plan PLAN-20250823-AUTHFIXES.P11
 * @requirement REQ-001, REQ-003
 * Complete Gemini OAuth implementation
 */
import { OAuth2Client } from 'google-auth-library';

export class GeminiOAuthProvider implements OAuthProvider {
  name = 'gemini';
  private tokenStore?: TokenStore;
  private oauth2Client: OAuth2Client;
  
  constructor(tokenStore?: TokenStore) {
    this.tokenStore = tokenStore;
    
    // Initialize Google OAuth client
    this.oauth2Client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'urn:ietf:wg:oauth:2.0:oob'
    );
    
    this.initializeToken();
  }
  
  private async initializeToken(): Promise<void> {
    if (!this.tokenStore) return;
    
    const saved = await this.tokenStore.getToken('gemini');
    if (saved && !this.isTokenExpired(saved)) {
      this.oauth2Client.setCredentials({
        access_token: saved.access_token,
        refresh_token: saved.refresh_token,
        expiry_date: saved.expiry * 1000
      });
    }
  }
  
  // Implement remaining methods...
}
```

### Special Considerations

- Google OAuth uses different token format
- Scopes for Gemini API access
- Handle offline access for refresh tokens
- Device flow or authorization code flow

## Verification Commands

```bash
# All tests pass
npm test packages/cli/test/auth/gemini-oauth-provider.test.ts
# Expected: All passing

# No magic strings remain
grep -r "USE_LOGIN_WITH_GOOGLE" packages/cli/src/auth/gemini-oauth-provider.ts
# Expected: No results

# Check Google OAuth integration
grep -r "googleapis\|OAuth2Client" packages/cli/src/auth/gemini-oauth-provider.ts
# Expected: Proper Google OAuth usage

# Mutation testing
npx stryker run --mutate packages/cli/src/auth/gemini-oauth-provider.ts
# Expected: >80% mutation score
```

## Success Criteria

- All Gemini tests pass
- Google OAuth properly integrated
- No magic strings
- Token persistence works
- >80% mutation score

## Phase Completion Marker

Create: `project-plans/authfixes/.completed/P11.md`