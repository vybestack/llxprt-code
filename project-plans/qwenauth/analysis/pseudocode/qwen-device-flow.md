# Qwen Device Flow Pseudocode

## Class: QwenDeviceAuthorizationFlow

### Function: initiateDeviceFlow() -> Result<DeviceFlowSession, DeviceFlowError>

**Purpose**: Start OAuth device authorization flow for Qwen

**Algorithm**:
1. Generate PKCE parameters
   - Create cryptographically random code_verifier (128 bits entropy)
   - Generate code_challenge = BASE64URL(SHA256(code_verifier))
   - Store code_verifier securely in memory
2. Prepare device authorization request
   - URL = "https://chat.qwen.ai/api/v1/oauth2/device/code"
   - Parameters:
     - client_id = "f0304373b74a44d2b584a3fb70ca9e56"
     - scope = "openai"
     - code_challenge = generated_code_challenge
     - code_challenge_method = "S256"
3. Make HTTP POST request
   - Set Content-Type: application/x-www-form-urlencoded
   - Set User-Agent with tool identification
   - Timeout: 30 seconds
   - Return NetworkError on failure
4. Parse response
   - Validate HTTP 200 status
   - Parse JSON response body
   - Validate required fields: device_code, user_code, verification_uri, expires_in, interval
   - Return ResponseError on validation failure
5. Create and return session
   - Initialize DeviceFlowSession with response data
   - Set session expiry = current_time + expires_in
   - Store PKCE code_verifier in session

**Error Handling**:
- NetworkError: HTTP request failed or timed out
- ResponseError: Invalid response format or missing fields
- SecurityError: PKCE generation failed

**Data Transformations**:
- Random bytes -> Base64URL code_verifier
- Code_verifier -> SHA256 -> Base64URL code_challenge
- HTTP form data -> JSON response -> DeviceFlowSession

---

### Function: displayUserInstructions(session: DeviceFlowSession) -> Result<void, DisplayError>

**Purpose**: Show authentication instructions to user

**Algorithm**:
1. Generate QR code
   - Create QR code from verification_uri_complete or verification_uri + user_code
   - Use ASCII art QR code for terminal display
   - Return DisplayError if QR generation fails
2. Format instruction message
   - Display user_code prominently
   - Show verification_uri for manual entry
   - Include expiration time (expires_in converted to minutes)
   - Add mobile-friendly QR code
3. Display instructions
   - Print formatted message to stdout
   - Use colors/formatting for better visibility
   - Show progress indicator for polling phase
4. Log session initiation
   - Log device flow start (no sensitive data)
   - Record session expiry time

**Error Handling**:
- DisplayError: QR code generation failed
- FormatError: Cannot format instructions properly

**Data Transformations**:
- URL string -> QR code binary -> ASCII art
- Unix timestamp -> Human readable time
- Session data -> Formatted text output

---

### Function: pollForTokens(session: DeviceFlowSession) -> Result<TokenResponse, DeviceFlowError>

**Purpose**: Poll for token completion with exponential backoff

**Algorithm**:
1. Initialize polling parameters
   - base_interval = session.interval (from server response)
   - max_interval = 60 seconds (cap for exponential backoff)
   - current_interval = base_interval
   - max_duration = session.expires_in seconds
   - start_time = current_time
2. Start polling loop
   - While (current_time - start_time) < max_duration:
     - Sleep for current_interval seconds
     - Make token request
     - Handle response based on status
3. Make token exchange request
   - URL = "https://chat.qwen.ai/api/v1/oauth2/token"
   - Method = POST
   - Headers:
     - Content-Type: application/x-www-form-urlencoded
     - User-Agent: tool identification
   - Body parameters:
     - grant_type = "urn:ietf:params:oauth:grant-type:device_code"
     - device_code = session.device_code
     - client_id = "f0304373b74a44d2b584a3fb70ca9e56"
     - code_verifier = session.code_verifier
4. Handle polling responses
   - HTTP 200 + access_token -> Success, return tokens
   - HTTP 400 + "authorization_pending" -> Continue polling
   - HTTP 400 + "slow_down" -> Increase interval by 5 seconds
   - HTTP 400 + "access_denied" -> Return UserDeniedError
   - HTTP 400 + "expired_token" -> Return ExpiredError
   - Other errors -> Apply exponential backoff
5. Apply exponential backoff on errors
   - current_interval = min(current_interval * 1.5, max_interval)
   - Continue polling with increased interval
6. Timeout handling
   - If max_duration exceeded -> Return TimeoutError
   - Clean up session resources

**Error Handling**:
- NetworkError: HTTP request failed
- UserDeniedError: User rejected authorization
- ExpiredError: Device code expired
- TimeoutError: Polling duration exceeded
- ResponseError: Invalid server response

**Data Transformations**:
- Session data -> HTTP form parameters
- JSON response -> TokenResponse object
- Error codes -> Appropriate exception types

---

### Function: exchangeCodeForTokens(session: DeviceFlowSession, authorizationCode: string) -> Result<TokenResponse, DeviceFlowError>

**Purpose**: Exchange authorization code for access tokens (alternative to polling)

**Algorithm**:
1. Validate input parameters
   - Check session is still valid (not expired)
   - Check authorizationCode is non-empty
   - Return ValidationError if invalid
2. Prepare token exchange request
   - URL = "https://chat.qwen.ai/api/v1/oauth2/token"
   - Method = POST
   - Headers:
     - Content-Type: application/x-www-form-urlencoded
     - User-Agent: tool identification
   - Body parameters:
     - grant_type = "authorization_code"
     - code = authorizationCode
     - client_id = "f0304373b74a44d2b584a3fb70ca9e56"
     - code_verifier = session.code_verifier
3. Make HTTP request
   - Execute POST with timeout = 30 seconds
   - Return NetworkError on failure
4. Process response
   - Validate HTTP 200 status
   - Parse JSON response
   - Validate required fields: access_token, token_type
   - Optional fields: refresh_token, expires_in, scope
5. Create token response
   - Build TokenResponse object
   - Calculate expiry timestamp if expires_in provided
   - Set default expiry if not provided (1 hour)
   - Validate token_type is "Bearer"

**Error Handling**:
- ValidationError: Invalid input parameters
- NetworkError: HTTP request failed
- ResponseError: Invalid response format
- TokenError: Invalid token data

---

### Function: refreshToken(refreshToken: string) -> Result<TokenResponse, RefreshError>

**Purpose**: Refresh access token using refresh token with 30-second buffer

**Algorithm**:
1. Validate refresh token
   - Check refreshToken is non-empty string
   - Return ValidationError if invalid
2. Check refresh timing
   - Apply 30-second buffer before actual expiry
   - If current_time + 30 seconds < token_expiry:
     - Log early refresh attempt
     - Consider returning current token instead
3. Prepare refresh request
   - URL = "https://chat.qwen.ai/api/v1/oauth2/token"
   - Method = POST
   - Headers:
     - Content-Type: application/x-www-form-urlencoded
     - User-Agent: tool identification
   - Body parameters:
     - grant_type = "refresh_token"
     - refresh_token = refreshToken
     - client_id = "f0304373b74a44d2b584a3fb70ca9e56"
     - scope = "openai"
4. Execute refresh request
   - Make HTTP POST with timeout = 30 seconds
   - Return NetworkError on failure
   - Apply retry logic for transient failures (3 attempts max)
5. Process refresh response
   - Validate HTTP 200 status
   - Parse JSON response
   - Validate required fields: access_token, token_type
   - Handle optional new refresh_token
   - Calculate new expiry timestamp
6. Handle refresh errors
   - HTTP 400 "invalid_grant" -> Return InvalidRefreshTokenError
   - HTTP 401 -> Return AuthenticationError
   - Other 4xx -> Return RefreshError with details
   - 5xx -> Apply retry logic

**Error Handling**:
- ValidationError: Invalid refresh token format
- NetworkError: HTTP request failed
- InvalidRefreshTokenError: Refresh token expired/invalid
- AuthenticationError: Client authentication failed
- RefreshError: General refresh failure

**Data Transformations**:
- Refresh token string -> HTTP form parameters
- JSON response -> New TokenResponse
- expires_in -> Unix timestamp calculation

---

### Function: validateTokenResponse(response: any) -> Result<TokenResponse, ValidationError>

**Purpose**: Validate and normalize token response from Qwen OAuth server

**Algorithm**:
1. Validate response structure
   - Check response is object (not null/undefined)
   - Validate required field presence: access_token, token_type
   - Return StructureError if invalid
2. Validate access_token
   - Check is non-empty string
   - Validate format (should be JWT or opaque token)
   - Check minimum length (> 10 characters)
3. Validate token_type
   - Must be "Bearer" (case-insensitive)
   - Normalize to "Bearer" with proper case
4. Process optional fields
   - expires_in: Convert to Unix timestamp (current_time + expires_in)
   - refresh_token: Validate if present (non-empty string)
   - scope: Validate matches requested scope ("openai")
5. Create normalized TokenResponse
   - Build validated TokenResponse object
   - Apply default expiry if none provided (3600 seconds)
   - Set token_type to "Bearer"
   - Include all validated fields

**Error Handling**:
- StructureError: Invalid response structure
- ValidationError: Field validation failed
- FormatError: Token format invalid

**Data Transformations**:
- Raw JSON response -> Validated TokenResponse object
- expires_in (seconds) -> Unix timestamp
- Case normalization for token_type

---

## Data Structures

### DeviceFlowSession
```
struct DeviceFlowSession {
    device_code: string           // Server-generated device code
    user_code: string            // Human-readable user code
    verification_uri: string     // Base verification URL
    verification_uri_complete?: string  // URL with embedded user code
    expires_in: number           // Session expiry in seconds
    interval: number             // Polling interval in seconds
    code_verifier: string        // PKCE code verifier
    session_start: number        // Unix timestamp of session start
}
```

### TokenResponse
```
struct TokenResponse {
    access_token: string         // OAuth access token
    token_type: string          // Always "Bearer"
    expires_in?: number         // Token lifetime in seconds
    refresh_token?: string      // Optional refresh token
    scope?: string              // Granted scope
    expiry: number              // Calculated Unix timestamp
}
```

### DeviceFlowError
```
enum DeviceFlowError {
    NetworkError,               // HTTP request failed
    ResponseError,              // Invalid server response
    SecurityError,              // PKCE or security issue
    UserDeniedError,           // User rejected authorization
    ExpiredError,              // Device code expired
    TimeoutError,              // Polling timeout reached
    ValidationError            // Input validation failed
}
```

### RefreshError
```
enum RefreshError {
    InvalidRefreshTokenError,   // Refresh token invalid/expired
    AuthenticationError,        // Client authentication failed
    NetworkError,              // HTTP request failed
    ValidationError,           // Input validation failed
    RefreshError               // General refresh failure
}
```

## Security Considerations

1. **PKCE Implementation**: Use cryptographically secure random code_verifier
2. **Memory Management**: Clear sensitive data (code_verifier, tokens) after use
3. **Network Security**: Enforce HTTPS, validate certificates
4. **Rate Limiting**: Respect server polling intervals, implement backoff
5. **Token Security**: Never log or expose tokens in error messages
6. **Session Expiry**: Enforce device code expiration times

## Performance Considerations

1. **Polling Optimization**: Implement exponential backoff for resilience
2. **Network Timeouts**: Use appropriate timeouts for all HTTP requests
3. **Resource Cleanup**: Ensure sessions are properly cleaned up
4. **Concurrent Safety**: Handle multiple simultaneous refresh attempts
5. **Caching**: Cache validation results where appropriate