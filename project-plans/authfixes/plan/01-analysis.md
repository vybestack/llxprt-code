# Phase 01: Domain Analysis

## Phase ID
`PLAN-20250823-AUTHFIXES.P01`

## Prerequisites
- Required: specification.md exists
- Verification: `test -f project-plans/authfixes/specification.md`

## Analysis Tasks

### Domain Model Identification

#### Core Entities

1. **OAuthToken**
   - Properties: access_token, refresh_token, expiry, scope, token_type
   - Behaviors: isExpired(), needsRefresh(), toJSON()
   - Persistence: JSON file per provider

2. **OAuthProvider**
   - Properties: name, tokenStore
   - Behaviors: initiateAuth(), getToken(), refreshIfNeeded(), logout()
   - State transitions: Unauthenticated → Authenticating → Authenticated → LoggedOut

3. **TokenStore**
   - Properties: basePath
   - Behaviors: saveToken(), getToken(), removeToken(), listProviders()
   - Constraints: Atomic operations, secure permissions

4. **OAuthManager**
   - Properties: providers, tokenStore, settingsService
   - Behaviors: authenticate(), getOAuthToken(), logout(), isAuthenticated()
   - Orchestrates provider operations

### State Transitions

```
Unauthenticated
    ↓ (initiateAuth)
Authenticating
    ↓ (pollForToken)
Authenticated
    ↓ (expiry approaching)
Refreshing
    ↓ (refreshToken)
Authenticated
    ↓ (logout)
LoggedOut/Unauthenticated
```

### Business Rules

1. **Token Expiry**
   - Tokens expire at Unix timestamp `expiry`
   - Refresh triggered when `expiry - now < 30 seconds`
   - Expired tokens removed from storage

2. **Token Persistence**
   - Saved immediately after obtaining
   - Updated after refresh
   - Removed on logout or refresh failure

3. **Provider Registration**
   - Each provider registered once in OAuthManager
   - Providers receive TokenStore on construction
   - Provider name must be unique

4. **Authentication Precedence**
   - OAuth is lowest priority after keys/env vars
   - OAuth only used if explicitly enabled
   - Fallback to re-auth if token invalid

### Edge Cases

1. **Corrupted Token File**
   - JSON parse error → return null
   - Schema validation failure → return null
   - Trigger re-authentication

2. **Missing Refresh Token**
   - Cannot refresh → clear token
   - Require full re-authentication
   - Log warning to user

3. **Concurrent Access**
   - Multiple CLI instances
   - Atomic file operations prevent corruption
   - Last write wins

4. **Network Failures**
   - Refresh attempt fails → retry with backoff
   - Max 3 retries → clear token
   - User notified of failure

### Error Scenarios

1. **Invalid Token on API Call**
   - 401 Unauthorized → attempt refresh
   - Refresh fails → clear and re-auth
   - User sees helpful error message

2. **Logout Without Session**
   - Check if authenticated first
   - Return success if already logged out
   - No error thrown

3. **Provider Not Found**
   - Validate provider name
   - Show list of valid providers
   - Return error message

## Integration Analysis

### Touch Points

1. **CLI Initialization**
   - `packages/cli/src/index.ts`
   - OAuth Manager instantiated with TokenStore
   - Providers registered on startup

2. **Command Processing**
   - `packages/cli/src/ui/commands/authCommand.ts`
   - New logout action handling
   - Status shows token expiry

3. **API Calls**
   - Provider.getAuthToken() checks OAuth
   - Token refreshed if needed
   - Errors trigger re-auth flow

### Data Flow

```
User Command → AuthCommand → OAuthManager → Provider → TokenStore → FileSystem
                                ↓                           ↑
                            Settings Service ←──────────────┘
```

### Dependencies

- **Internal**: TokenStore, SettingsService, Providers
- **External**: File system, OAuth endpoints
- **No new npm packages required**

## Verification Checklist

- [ ] All entities have clear responsibilities
- [ ] State transitions are complete
- [ ] Business rules are unambiguous
- [ ] Edge cases are identified
- [ ] Error scenarios have recovery paths
- [ ] Integration points are mapped
- [ ] No implementation details included

## Output

Create: `project-plans/authfixes/analysis/domain-model.md`