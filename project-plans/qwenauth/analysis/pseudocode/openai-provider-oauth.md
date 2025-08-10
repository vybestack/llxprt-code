# OpenAI Provider OAuth Integration Pseudocode

## Class: EnhancedOpenAIProvider (extends OpenAIProvider)

### Function: resolveApiKey(context: AuthContext) -> Result<string, AuthResolutionError>

**Purpose**: Resolve API key using fallback chain with OAuth token support

**Algorithm**:
1. Apply authentication precedence hierarchy (REQ-004.1)
   - Check for explicit --key parameter (highest precedence)
   - Check OPENAI_API_KEY environment variable
   - Check for valid OAuth token (lowest precedence)
   - Return NoAuthenticationError if none available
2. Explicit key parameter resolution
   - If context.explicitKey is provided:
     - Validate key format (starts with "sk-" for OpenAI keys)
     - Return explicit key if valid
     - Return InvalidKeyError if format invalid
3. Environment variable resolution
   - If OPENAI_API_KEY environment variable set:
     - Get value from process.env.OPENAI_API_KEY
     - Validate key format
     - Return environment key if valid
4. OAuth token resolution
   - Call OAuthManager.getTokenWithRefresh("qwen") for Qwen provider
   - If token available and valid:
     - Return OAuth access token as API key
   - If token expired or refresh failed:
     - Log OAuth authentication failure
     - Return OAuthUnavailableError
5. No authentication available
   - Log authentication resolution failure
   - Return NoAuthenticationError with fallback suggestions

**Error Handling**:
- InvalidKeyError: Provided key format invalid
- OAuthUnavailableError: OAuth token unavailable or expired
- NoAuthenticationError: No authentication method available
- ValidationError: Input validation failed

**Data Transformations**:
- Command line parameters -> Validated API key
- Environment variables -> Validated API key
- OAuth access token -> API key format
- Error conditions -> Appropriate error types

---

### Function: createOpenAIClient(apiKey: string, options?: ClientOptions) -> Result<OpenAI, ClientError>

**Purpose**: Create OpenAI SDK client with OAuth token as API key

**Algorithm**:
1. Validate API key parameter
   - Check apiKey is non-empty string
   - Log API key source (explicit/env/oauth) without exposing key value
   - Return ValidationError if invalid
2. Prepare client configuration
   - Set apiKey = provided apiKey (OAuth token or traditional key)
   - Apply default baseURL for OpenAI API
   - Override baseURL if Qwen-specific endpoint needed:
     - For Qwen OAuth tokens: baseURL = "https://chat.qwen.ai/v1/"
   - Set appropriate headers:
     - Authorization: "Bearer {apiKey}"
     - User-Agent: "llxprt-code/{version}"
3. Configure client options
   - Apply timeout settings (default: 60 seconds)
   - Set retry policy (3 attempts with exponential backoff)
   - Configure error handling for OAuth-specific errors
   - Enable debug logging if debug mode active
4. Initialize OpenAI client
   - Create new OpenAI() instance with configuration
   - Validate client initialization succeeded
   - Return ClientInitializationError on failure
5. Test client connectivity (optional)
   - Make lightweight API call (e.g., list models)
   - Validate authentication is accepted
   - Return AuthenticationError if API key rejected

**Error Handling**:
- ValidationError: Invalid input parameters
- ClientInitializationError: OpenAI client creation failed
- AuthenticationError: API key rejected by server
- NetworkError: Connectivity issues during initialization

**Data Transformations**:
- API key string -> OpenAI client configuration
- Client options -> OpenAI SDK parameters
- OAuth token -> Bearer authentication header
- Provider-specific settings -> Client configuration

---

### Function: handleAuthenticationError(error: OpenAIError) -> Result<string, AuthError>

**Purpose**: Handle authentication errors with OAuth token refresh fallback

**Algorithm**:
1. Analyze authentication error
   - Check if error is HTTP 401 Unauthorized
   - Check if error message indicates invalid/expired token
   - Return NotAuthenticationError if different error type
2. Determine authentication source
   - Get current authentication method from context
   - If using explicit key or environment variable:
     - Return AuthenticationError (no recovery possible)
   - If using OAuth token:
     - Proceed with refresh attempt
3. Attempt OAuth token refresh
   - Get current provider from context (likely "qwen")
   - Call OAuthManager.getTokenWithRefresh(provider)
   - If refresh successful:
     - Update cached API key with new token
     - Return new token for retry
   - If refresh failed:
     - Clear cached authentication
     - Return RefreshFailedError
4. Update client configuration
   - If new token obtained:
     - Update OpenAI client apiKey configuration
     - Clear any cached authentication errors
     - Log successful token refresh (no sensitive data)
5. Handle refresh failure scenarios
   - If refresh token expired:
     - Clear stored authentication
     - Return ReAuthenticationRequiredError
   - If network error during refresh:
     - Return NetworkError with retry suggestion
   - If server rejects refresh:
     - Return InvalidRefreshTokenError

**Error Handling**:
- NotAuthenticationError: Error not authentication-related
- RefreshFailedError: Token refresh attempt failed
- ReAuthenticationRequiredError: User must re-authenticate
- NetworkError: Network issues during refresh
- InvalidRefreshTokenError: Refresh token invalid/expired

**Data Transformations**:
- OpenAI error object -> Error type classification
- Authentication context -> Refresh strategy selection
- Refreshed token -> Updated client configuration
- Error recovery -> Appropriate error response

---

### Function: validateQwenTokenCompatibility(token: string) -> Result<boolean, CompatibilityError>

**Purpose**: Validate OAuth token compatibility with OpenAI SDK usage

**Algorithm**:
1. Perform basic token format validation
   - Check token is non-empty string
   - Validate token length (minimum reasonable length)
   - Check for common token prefixes or patterns
2. Test token with lightweight API call
   - Make GET request to models endpoint with token
   - Use Qwen-specific API base URL if needed
   - Timeout after 10 seconds to avoid hanging
3. Analyze API response
   - HTTP 200: Token valid and compatible
   - HTTP 401: Token invalid or expired
   - HTTP 403: Token valid but insufficient permissions
   - HTTP 404: Endpoint not found (possible base URL issue)
   - Other errors: Network or server issues
4. Validate response format compatibility
   - Check response follows OpenAI API format
   - Validate required fields are present
   - Test basic JSON parsing and structure
5. Return compatibility assessment
   - Return true if fully compatible
   - Return false with specific compatibility issues
   - Include suggested fixes for common problems

**Error Handling**:
- CompatibilityError: Token incompatible with expected usage
- NetworkError: Unable to test token due to network issues
- ValidationError: Invalid token format

**Data Transformations**:
- OAuth token -> HTTP Authorization header
- API response -> Compatibility assessment
- Error responses -> Specific compatibility issues

---

### Function: createProviderWithFallback(context: AuthContext) -> Result<OpenAIProvider, ProviderError>

**Purpose**: Create OpenAI provider instance with complete fallback chain

**Algorithm**:
1. Initialize fallback chain attempt tracking
   - Create attempt log for debugging
   - Set fallback chain: [explicit-key, env-var, oauth]
   - Initialize failure collection for reporting
2. Attempt each authentication method in order
   - For each method in fallback chain:
     - Try to resolve authentication credentials
     - If successful, attempt to create provider
     - If provider creation successful, return provider
     - If failed, log failure and continue to next method
3. Explicit key fallback attempt
   - Check context.explicitKey parameter
   - If present:
     - Validate key format and create provider
     - Return provider if successful
     - Add failure to attempt log if failed
4. Environment variable fallback attempt
   - Check OPENAI_API_KEY environment variable
   - If present and valid:
     - Create provider with environment key
     - Return provider if successful
     - Add failure to attempt log if failed
5. OAuth token fallback attempt
   - Query OAuthManager for valid token
   - If token available:
     - Validate token compatibility
     - Create provider with OAuth token as API key
     - Return provider if successful
     - Add OAuth failure to attempt log
6. All fallbacks failed
   - Compile comprehensive failure report
   - Include suggestions for each failed method
   - Return NoValidAuthenticationError with full context
   - Log fallback chain failure for debugging

**Error Handling**:
- NoValidAuthenticationError: All fallback methods failed
- ProviderError: Provider creation failed for specific reason
- ConfigurationError: Invalid configuration preventing provider creation

**Data Transformations**:
- AuthContext -> Fallback method parameters
- Multiple auth attempts -> Consolidated failure report
- Successful auth method -> Configured OpenAI provider
- Failure chain -> User-actionable error messages

---

## Data Structures

### AuthContext
```
struct AuthContext {
    explicitKey?: string          // --key parameter value
    environmentKey?: string       // Cached environment variable value
    oauthProvider?: string        // OAuth provider to use ("qwen")
    baseURL?: string             // Override base URL for provider
    timeout?: number             // Request timeout in seconds
    debug: boolean               // Debug logging enabled
    retryAttempts: number        // Number of retry attempts
}
```

### ClientOptions
```
struct ClientOptions {
    baseURL?: string             // API base URL override
    timeout?: number             // Request timeout
    maxRetries?: number          // Maximum retry attempts
    headers?: Record<string, string>  // Additional headers
    debug?: boolean              // Enable debug logging
}
```

### AuthResolutionResult
```
struct AuthResolutionResult {
    method: AuthMethod           // Authentication method used
    credential: string           // Resolved credential/key
    source: AuthSource          // Source of authentication
    isOAuth: boolean            // Whether using OAuth token
    expiresAt?: number          // Expiration time if applicable
}

enum AuthMethod {
    ExplicitKey = "explicit-key",
    EnvironmentVariable = "env-var",
    OAuthToken = "oauth-token"
}

enum AuthSource {
    CommandLineParameter = "cli-param",
    EnvironmentVariable = "env-var",
    QwenOAuth = "qwen-oauth"
}
```

### ProviderCreationResult
```
struct ProviderCreationResult {
    provider: OpenAIProvider     // Created provider instance
    authMethod: AuthMethod       // Authentication method used
    warnings: string[]           // Any configuration warnings
    capabilities: ProviderCapabilities  // Provider capabilities
}

struct ProviderCapabilities {
    supportsStreaming: boolean   // Streaming response support
    supportsTools: boolean       // Function calling support
    maxTokens: number           // Maximum token limit
    supportedModels: string[]    // Available model names
}
```

## Error Types

### AuthResolutionError
```
enum AuthResolutionError {
    InvalidKeyError,             // Provided key format invalid
    OAuthUnavailableError,       // OAuth token not available
    NoAuthenticationError,       // No auth method available
    ValidationError              // Input validation failed
}
```

### ClientError
```
enum ClientError {
    ClientInitializationError,   // OpenAI client creation failed
    AuthenticationError,         // API key rejected
    NetworkError,               // Connectivity issues
    ConfigurationError          // Invalid client configuration
}
```

### AuthError
```
enum AuthError {
    NotAuthenticationError,      // Error not auth-related
    RefreshFailedError,         // Token refresh failed
    ReAuthenticationRequiredError, // Must re-authenticate
    InvalidRefreshTokenError     // Refresh token invalid
}
```

## Integration Points

### OpenAI SDK Integration
1. **API Key Injection**: OAuth tokens used directly as API keys
2. **Base URL Override**: Support for Qwen-specific API endpoints
3. **Error Handling**: OAuth-aware error recovery and retry logic
4. **Authentication Flow**: Seamless fallback between auth methods

### OAuth Manager Integration
1. **Token Retrieval**: Automatic token refresh and validation
2. **State Management**: Authentication state tracking and updates
3. **Error Coordination**: Shared error handling and recovery strategies
4. **Event Integration**: Authentication status change notifications

## Security Considerations

1. **Token Protection**: Never log or expose OAuth tokens in error messages
2. **Secure Storage**: Leverage existing secure token storage mechanisms
3. **Network Security**: Enforce HTTPS for all API communications
4. **Error Information**: Limit sensitive information in error responses
5. **Token Rotation**: Support automatic token refresh without interruption

## Performance Optimizations

1. **Authentication Caching**: Cache resolved authentication for request batches
2. **Client Reuse**: Reuse OpenAI client instances when possible
3. **Lazy Loading**: Initialize providers only when needed
4. **Connection Pooling**: Reuse HTTP connections for multiple requests
5. **Error Recovery**: Fast fallback to alternative auth methods