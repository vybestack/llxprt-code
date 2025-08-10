# OAuth Manager Pseudocode

## Class: MultiProviderOAuthManager

### Function: registerProvider(config: ProviderOAuthConfig) -> Result<void, ManagerError>

**Purpose**: Register OAuth provider configuration for discovery and management

**Algorithm**:
1. Validate provider configuration
   - Check provider name is non-empty string
   - Validate provider name format (alphanumeric, no spaces)
   - Check clientId is non-empty string
   - Validate endpoint URLs are well-formed HTTPS URLs
   - Ensure scopes array is non-empty
   - Return ValidationError if any validation fails
2. Check for duplicate registration
   - Query internal provider registry
   - Return DuplicateProviderError if already registered
3. Validate provider endpoints
   - Test network connectivity to authorization endpoint (optional HEAD request)
   - Validate endpoint responses are JSON-capable
   - Log warnings for unreachable endpoints but don't fail registration
4. Store provider configuration
   - Add to internal provider registry
   - Index by provider name for fast lookup
   - Store configuration immutably (deep copy)
5. Initialize provider state
   - Create empty authentication state entry
   - Set initial status to "unauthenticated"
   - Initialize token cache entry (empty)

**Error Handling**:
- ValidationError: Invalid configuration parameters
- DuplicateProviderError: Provider already registered
- NetworkError: Endpoint validation failed (warning only)

**Data Transformations**:
- ProviderOAuthConfig -> Internal provider registry entry
- URL strings -> Validated URL objects
- Configuration validation -> Provider state initialization

---

### Function: getRegisteredProviders() -> ProviderInfo[]

**Purpose**: List all registered OAuth providers with their capabilities

**Algorithm**:
1. Query internal provider registry
   - Get all registered provider configurations
   - Sort by provider name alphabetically
2. Build provider info list
   - For each registered provider:
     - Extract basic info (name, scopes, OAuth support status)
     - Get current authentication state
     - Calculate token expiry information if authenticated
     - Determine availability status
3. Return provider information array

**Data Transformations**:
- Internal registry -> Public ProviderInfo array
- Provider configurations -> User-friendly information
- Authentication states -> Status summaries

---

### Function: authenticateProvider(provider: string, method: AuthMethod) -> Result<AuthenticationState, AuthError>

**Purpose**: Initiate authentication flow for specified provider

**Algorithm**:
1. Validate provider and method
   - Check provider is registered
   - Return UnknownProviderError if not found
   - Validate authentication method is supported by provider
   - Return UnsupportedMethodError if method not available
2. Check current authentication state
   - Get existing authentication state for provider
   - If already authenticated and not expired:
     - Return current state if force=false
     - Proceed with re-authentication if force=true
3. Dispatch to provider-specific flow
   - If provider == "gemini" && method == "oauth":
     - Delegate to existing Gemini OAuth implementation
   - If provider == "qwen" && method == "oauth":
     - Create QwenDeviceAuthorizationFlow instance
     - Call initiateDeviceFlow()
   - Return ProviderError if flow initiation fails
4. Execute authentication flow
   - Display user instructions (QR code, verification URL)
   - Start background token polling
   - Wait for flow completion or timeout
   - Handle user cancellation gracefully
5. Process successful authentication
   - Store received tokens via TokenStorage
   - Update authentication state cache
   - Trigger authentication success event
   - Return updated authentication state

**Error Handling**:
- UnknownProviderError: Provider not registered
- UnsupportedMethodError: Auth method not supported
- ProviderError: Provider-specific authentication failure
- UserCancelledError: User cancelled authentication flow
- TimeoutError: Authentication flow timed out

**Data Transformations**:
- Provider name -> Provider configuration lookup
- AuthMethod -> Provider-specific flow parameters
- OAuth tokens -> Stored token format
- Flow result -> AuthenticationState object

---

### Function: getTokenWithRefresh(provider: string) -> Result<string, TokenError>

**Purpose**: Retrieve valid access token with automatic refresh fallback

**Algorithm**:
1. Validate provider parameter
   - Check provider is non-empty string
   - Check provider is registered
   - Return UnknownProviderError if not registered
2. Attempt token retrieval from storage
   - Call TokenStorage.retrieveToken(provider)
   - If NotFoundError -> Return UnauthenticatedError
   - If other storage error -> Return StorageError
3. Check token expiry with buffer
   - Get current timestamp
   - Apply 30-second expiry buffer
   - If token_expiry <= (current_time + 30):
     - Token needs refresh
   - Else:
     - Return current access_token
4. Attempt token refresh
   - Check if refresh_token exists
   - If no refresh token -> Return TokenExpiredError
   - Call provider-specific refresh flow:
     - For qwen: QwenDeviceFlow.refreshToken()
     - For gemini: Use existing Gemini refresh logic
5. Handle refresh results
   - If refresh successful:
     - Store new tokens via TokenStorage
     - Update authentication state cache
     - Return new access_token
   - If refresh failed:
     - Clear stored tokens (invalid)
     - Update auth state to unauthenticated
     - Return RefreshFailedError
6. Cache token for performance
   - Cache valid tokens in memory with TTL
   - Use cached token if still valid
   - Reduce file I/O for frequent requests

**Error Handling**:
- UnknownProviderError: Provider not registered
- UnauthenticatedError: No stored token found
- StorageError: Token storage access failed
- TokenExpiredError: Token expired, no refresh available
- RefreshFailedError: Token refresh attempt failed

**Data Transformations**:
- Provider name -> Token storage lookup
- Stored token -> Expiry validation
- Refresh token -> New access token
- Token refresh result -> Updated storage

---

### Function: getAuthenticationStatus() -> AuthStatusSummary

**Purpose**: Get comprehensive authentication status for all providers

**Algorithm**:
1. Initialize status summary
   - Create empty AuthStatusSummary object
   - Get list of all registered providers
2. Check each provider status
   - For each registered provider:
     - Get current authentication state
     - Calculate token expiry information
     - Determine authentication method used
     - Assess token health (valid/expired/needs refresh)
3. Build status summary
   - Overall authentication status (any provider authenticated)
   - Per-provider detailed status
   - Authentication method breakdown
   - Expiry warnings for near-expired tokens
4. Calculate aggregated metrics
   - Total providers configured
   - Number authenticated successfully
   - Number requiring attention (expired, errors)
   - Next token expiry time across all providers
5. Return comprehensive status

**Data Transformations**:
- Provider registry -> Provider list
- Individual auth states -> Aggregated summary
- Token expiry times -> Human-readable warnings
- Authentication methods -> Status categorization

---

### Function: revokeAuthentication(provider: string) -> Result<void, RevokeError>

**Purpose**: Revoke authentication and clean up stored credentials

**Algorithm**:
1. Validate provider parameter
   - Check provider is registered
   - Return UnknownProviderError if not found
2. Get current authentication state
   - Check if provider is currently authenticated
   - If not authenticated, consider operation successful
3. Attempt server-side revocation (optional)
   - Get stored access_token and refresh_token
   - If revocation endpoint available:
     - Make HTTP POST to revocation endpoint
     - Include token and client credentials
     - Log revocation result (success/failure)
     - Continue with local cleanup regardless of server response
4. Clean up local storage
   - Delete stored token file via TokenStorage.deleteToken()
   - Clear memory cache entries
   - Update authentication state to unauthenticated
5. Notify of revocation
   - Trigger authentication revoked event
   - Log revocation completion
   - Clear any related UI state

**Error Handling**:
- UnknownProviderError: Provider not registered
- StorageError: Unable to delete token storage
- NetworkError: Server revocation failed (warning only)

**Data Transformations**:
- Provider name -> Stored token lookup
- Stored tokens -> Revocation request parameters
- Revocation result -> Updated authentication state

---

### Function: refreshAllTokens() -> Result<RefreshSummary, RefreshError>

**Purpose**: Proactively refresh all tokens nearing expiration

**Algorithm**:
1. Get all authenticated providers
   - Query authentication state cache
   - Filter for providers with stored tokens
2. Check token expiry status
   - For each authenticated provider:
     - Get token expiry timestamp
     - Apply 5-minute refresh threshold
     - Add to refresh queue if within threshold
3. Execute parallel token refresh
   - Create refresh tasks for each provider in queue
   - Execute refreshes in parallel (max 3 concurrent)
   - Use provider-specific refresh logic
   - Collect results with timeout handling
4. Process refresh results
   - For successful refreshes:
     - Update token storage
     - Update authentication state cache
   - For failed refreshes:
     - Log failure details
     - Update state to indicate refresh failure
     - Add to failed provider list
5. Build refresh summary
   - Total providers checked
   - Number needing refresh
   - Successful refresh count
   - Failed refresh count
   - Details of any failures

**Error Handling**:
- Individual refresh failures logged but don't stop batch
- Network timeouts handled per provider
- Storage errors logged with provider context
- Return partial success results

**Data Transformations**:
- Authentication states -> Refresh task queue
- Parallel refresh results -> Summary statistics
- Provider-specific errors -> Aggregated failure report

---

## Data Structures

### ProviderOAuthConfig
```
struct ProviderOAuthConfig {
    provider: string                    // Provider identifier
    clientId: string                   // OAuth client ID
    authorizationEndpoint: string      // Device auth endpoint
    tokenEndpoint: string              // Token exchange endpoint
    revocationEndpoint?: string        // Token revocation endpoint
    scopes: string[]                   // Required OAuth scopes
    pkceRequired: boolean              // PKCE enforcement flag
    refreshThreshold: number           // Seconds before expiry to refresh
}
```

### AuthenticationState
```
struct AuthenticationState {
    provider: string                   // Provider name
    authenticated: boolean             // Current auth status
    authType: AuthType                // Authentication method used
    tokenExpiry?: number              // Token expiration timestamp
    lastAuthenticated?: number        // Last successful auth timestamp
    refreshAvailable: boolean         // Whether refresh token exists
    healthStatus: TokenHealthStatus   // Token health assessment
}

enum AuthType {
    OAuth = "oauth",
    ApiKey = "api-key",
    VertexAI = "vertex-ai",
    None = "none"
}

enum TokenHealthStatus {
    Healthy = "healthy",               // Token valid, not near expiry
    NearExpiry = "near-expiry",       // Token expires within threshold
    Expired = "expired",              // Token past expiration
    RefreshNeeded = "refresh-needed", // Refresh token should be used
    Invalid = "invalid"               // Token validation failed
}
```

### AuthStatusSummary
```
struct AuthStatusSummary {
    overallStatus: OverallAuthStatus   // Aggregated authentication status
    providers: AuthenticationState[]   // Per-provider status details
    metrics: AuthMetrics              // Summary metrics
    warnings: AuthWarning[]           // Authentication warnings
}

enum OverallAuthStatus {
    AllAuthenticated = "all-authenticated",     // All providers authenticated
    PartiallyAuthenticated = "partial",        // Some providers authenticated
    NoneAuthenticated = "none",                // No providers authenticated
    AttentionRequired = "attention-required"   // Issues need resolution
}

struct AuthMetrics {
    totalProviders: number            // Total registered providers
    authenticatedProviders: number    // Successfully authenticated count
    expiredTokens: number            // Expired token count
    nextExpiryTime?: number          // Next token expiration timestamp
}

struct AuthWarning {
    provider: string                 // Provider with warning
    type: WarningType               // Warning category
    message: string                 // Human-readable warning
    severity: WarningSeverity       // Warning importance level
}
```

### RefreshSummary
```
struct RefreshSummary {
    totalChecked: number             // Providers examined
    refreshAttempted: number         // Refresh operations started
    refreshSuccessful: number        // Successful refresh count
    refreshFailed: number           // Failed refresh count
    failureDetails: RefreshFailure[] // Detailed failure information
}

struct RefreshFailure {
    provider: string                 // Provider that failed
    error: string                   // Error description
    retryable: boolean              // Whether retry might succeed
}
```

## Error Types

### ManagerError
```
enum ManagerError {
    ValidationError,          // Configuration validation failed
    DuplicateProviderError,   // Provider already registered
    UnknownProviderError,     // Provider not registered
    UnsupportedMethodError,   // Auth method not supported
    StorageError             // Token storage operation failed
}
```

### AuthError
```
enum AuthError {
    ProviderError,           // Provider-specific auth failure
    UserCancelledError,      // User cancelled auth flow
    TimeoutError,            // Authentication timed out
    NetworkError,            // Network connectivity issues
    SecurityError            // Security validation failed
}
```

### TokenError
```
enum TokenError {
    UnauthenticatedError,    // No valid authentication
    TokenExpiredError,       // Token expired, refresh needed
    RefreshFailedError,      // Token refresh failed
    StorageError            // Token storage access failed
}
```

## Provider Coordination Logic

1. **Provider Isolation**: Each provider maintains independent authentication state
2. **Fallback Chains**: Providers implement auth method precedence independently
3. **Cross-Provider Events**: Authentication changes trigger global state updates
4. **Resource Sharing**: Common token storage and refresh infrastructure
5. **Failure Isolation**: Provider-specific failures don't affect other providers

## Performance Optimizations

1. **State Caching**: Cache authentication states in memory with TTL
2. **Batch Operations**: Group related operations (refresh, status checks)
3. **Lazy Loading**: Load provider configurations on demand
4. **Connection Pooling**: Reuse HTTP connections for token operations
5. **Background Refresh**: Proactive token refresh before expiration