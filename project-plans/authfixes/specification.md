# Feature Specification: OAuth Authentication Fixes

## Purpose

Fix critical OAuth authentication issues that force users to re-authenticate on every CLI restart and provide no way to logout without exiting the application. The implementation will integrate OAuth token persistence, add logout functionality, and improve token lifecycle management across all three OAuth providers (Qwen, Anthropic, Gemini).

## Architectural Decisions

- **Pattern**: Repository Pattern with existing `MultiProviderTokenStore`
- **Technology Stack**: TypeScript, Node.js, existing OAuth libraries
- **Data Flow**: Provider → TokenStore → FileSystem (atomic operations)
- **Integration Points**: OAuth Manager, Auth Commands, Provider Instances

## Project Structure

```
packages/
  cli/
    src/
      auth/
        qwen-oauth-provider.ts      # UPDATE: Add TokenStore integration
        anthropic-oauth-provider.ts # UPDATE: Add TokenStore integration  
        gemini-oauth-provider.ts    # REWRITE: Replace placeholder
        oauth-manager.ts            # UPDATE: Add logout, fix registration
      ui/
        commands/
          authCommand.ts            # UPDATE: Add logout command
  core/
    src/
      auth/
        token-store.ts              # EXISTING: Already implemented
        types.ts                    # EXISTING: OAuth types defined
      providers/
        anthropic/AnthropicProvider.ts # UPDATE: Better error messages
        gemini/GeminiProvider.ts      # UPDATE: Remove magic strings
        openai/OpenAIProvider.ts      # NO CHANGE: Works with Qwen
```

## Technical Environment

- **Type**: CLI Tool OAuth Integration
- **Runtime**: Node.js 20.x
- **Dependencies**: 
  - `@anthropic-ai/sdk` (existing)
  - `@google/genai` (existing)
  - `zod` (existing - for validation)
  - No new dependencies required

## Integration Points (MANDATORY SECTION)

### Existing Code That Will Use This Feature

1. **OAuth Manager** (`/packages/cli/src/auth/oauth-manager.ts`)
   - Lines 68-80: `registerProviders()` - Pass TokenStore to providers
   - Lines 97-128: `authenticate()` - Already saves tokens
   - Lines 249-301: `getOAuthToken()` - Already handles refresh

2. **Auth Command** (`/packages/cli/src/ui/commands/authCommand.ts`)
   - Lines 47-56: `execute()` - Add logout action handling
   - Lines 84-172: Add new `logoutProvider()` method

3. **Provider Instances** 
   - `AnthropicProvider.ts:99-131` - Uses resolved tokens
   - `GeminiProvider.ts:117-156` - Checks for OAuth tokens
   - `OpenAIProvider.ts:176-240` - Handles Qwen OAuth

### Existing Code To Be Replaced

1. **In-Memory Token Storage**
   - `qwen-oauth-provider.ts:17` - `private currentToken` variable
   - `anthropic-oauth-provider.ts:17` - `private currentToken` variable
   - `gemini-oauth-provider.ts:16` - `private currentToken` variable

2. **Magic String Usage**
   - `oauth-manager.ts:214-220` - `USE_LOGIN_WITH_GOOGLE` return
   - `GeminiProvider.ts:125-129` - Magic string check

3. **Placeholder Implementation**
   - `gemini-oauth-provider.ts:15-41` - Entire class throws errors

### User Access Points

1. **CLI Commands**
   - `/auth qwen` - Show auth status
   - `/auth qwen enable` - Start OAuth flow
   - `/auth qwen logout` - NEW: Clear session
   - Same for anthropic and gemini

2. **Automatic Loading**
   - On CLI startup from `~/.llxprt/oauth/*.json`
   - Tokens validated and refreshed if needed

### Migration Requirements

1. **First-Run Migration**
   - Check for in-memory tokens
   - Save to persistent storage if found
   - Clear in-memory storage

2. **Settings Preservation**
   - OAuth enablement state in settings
   - Provider configurations maintained

## Formal Requirements

[REQ-001] Token Persistence
  [REQ-001.1] Provider constructor accepts optional TokenStore parameter
  [REQ-001.2] initializeToken() loads from storage on startup
  [REQ-001.3] Tokens saved after successful authentication
  [REQ-001.4] Refreshed tokens update persistent storage

[REQ-002] Logout Functionality  
  [REQ-002.1] logout() method clears tokens from storage
  [REQ-002.2] OAuth enablement state updated in settings
  [REQ-002.3] /auth [provider] logout command in CLI
  [REQ-002.4] Graceful handling if no session exists

[REQ-003] Token Lifecycle Management
  [REQ-003.1] isTokenExpired() checks with 30-second buffer
  [REQ-003.2] refreshIfNeeded() updates storage on success
  [REQ-003.3] Invalid tokens removed from storage
  [REQ-003.4] Expired refresh tokens trigger re-authentication

[REQ-004] Integration Requirements
  [REQ-004.1] All providers registered with TokenStore in OAuthManager
  [REQ-004.2] Backward compatibility with existing auth flows
  [REQ-004.3] Magic strings replaced with real OAuth tokens
  [REQ-004.4] Integration tests verify end-to-end flows

## Data Schemas

```typescript
// OAuth Token (existing in types.ts)
export const OAuthTokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expiry: z.number(), // Unix timestamp in seconds
  scope: z.string().nullable().optional(),
  token_type: z.literal('Bearer'),
  resource_url: z.string().optional(), // For Qwen
});

// Provider Interface Update
interface OAuthProvider {
  name: string;
  initiateAuth(): Promise<void>;
  getToken(): Promise<OAuthToken | null>;
  refreshIfNeeded(): Promise<OAuthToken | null>;
  logout(): Promise<void>; // NEW METHOD
}

// Constructor Signature Update
class QwenOAuthProvider implements OAuthProvider {
  constructor(private tokenStore?: TokenStore) {
    // Initialize with optional token store
  }
}
```

## Example Data

```json
{
  "validToken": {
    "access_token": "sk-ant-oat-abc123...",
    "refresh_token": "refresh-xyz789...",
    "expiry": 1735689600,
    "token_type": "Bearer",
    "scope": "model.completion"
  },
  "expiredToken": {
    "access_token": "sk-ant-oat-old456...",
    "refresh_token": "refresh-old...",
    "expiry": 1735603200,
    "token_type": "Bearer"
  },
  "qwenToken": {
    "access_token": "qwen-access-123...",
    "refresh_token": "qwen-refresh-456...",
    "expiry": 1735689600,
    "token_type": "Bearer",
    "resource_url": "https://api.qwen.ai/v1"
  }
}
```

## Constraints

- No breaking changes to existing auth flows
- File permissions must be 0600 for token files
- Atomic file operations for concurrent access safety
- Token validation without unnecessary API calls
- Graceful degradation if token store unavailable

## Performance Requirements

- Token load from disk: <10ms
- Token validation: <1ms (local check)
- Token refresh: <500ms (includes network)
- Logout operation: <50ms

## Error Handling

- Corrupted token files: Return null, trigger re-auth
- Missing refresh token: Clear token, require re-auth
- Network failures during refresh: Retry with backoff
- Concurrent access: Last write wins with atomic operations

## Testing Requirements

- Unit tests for each provider's persistence logic
- Integration tests for full OAuth flow with persistence
- Tests for logout functionality
- Tests for token migration from in-memory
- Tests for concurrent access scenarios
- Property-based tests for token validation logic