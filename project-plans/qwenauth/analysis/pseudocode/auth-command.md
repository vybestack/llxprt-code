# Auth Command Pseudocode

## Class: AuthCommand

### Function: execute(args: CommandArgs) -> Result<CommandResult, CommandError>

**Purpose**: Main entry point for /auth command execution with OAuth-only focus

**Algorithm**:
1. Parse command arguments
   - Check if specific provider argument provided (/auth qwen, /auth gemini)
   - Parse optional flags: --force, --status, --logout
   - Return ArgumentError if invalid arguments
2. Determine command mode
   - If provider specified: Execute provider-specific authentication
   - If --status flag: Display authentication status
   - If --logout flag: Execute logout flow
   - If no arguments: Display OAuth provider menu
3. Validate OAuth-only constraint (REQ-001.1)
   - Ensure no API key setup options presented
   - Filter providers to OAuth-enabled only
   - Return ConfigurationError if non-OAuth options detected
4. Route to appropriate handler
   - Provider authentication: Call authenticateProvider()
   - Status display: Call displayAuthenticationStatus()
   - Logout: Call logoutProvider()
   - Menu display: Call displayOAuthMenu()
5. Handle command results
   - Success: Display success message and return
   - Error: Display error message with helpful suggestions
   - User cancellation: Display cancellation acknowledgment

**Error Handling**:
- ArgumentError: Invalid command arguments
- ConfigurationError: Invalid OAuth configuration
- ProviderError: Provider-specific execution error
- UserCancelledError: User cancelled operation

**Data Transformations**:
- Raw command args -> Parsed CommandArgs object
- Command execution -> User-friendly output messages
- Error conditions -> Helpful error messages with next steps

---

### Function: displayOAuthMenu() -> Result<string, MenuError>

**Purpose**: Show interactive menu for OAuth providers only (REQ-001.2)

**Algorithm**:
1. Get registered OAuth providers
   - Query OAuthManager for registered providers
   - Filter for providers supporting OAuth (gemini, qwen)
   - Return EmptyMenuError if no OAuth providers available
2. Build OAuth provider menu
   - Create menu entries for each OAuth provider:
     - Provider name (e.g., "Qwen", "Gemini")
     - Current authentication status indicator
     - OAuth-specific description
   - Add menu options:
     - "View Status" - show detailed auth status
     - "Logout All" - revoke all OAuth authentications
     - "Exit" - cancel operation
3. Display interactive menu
   - Use consistent CLI menu formatting
   - Show keyboard shortcuts (1-9 for providers, s for status, l for logout)
   - Display current auth indicators:
     - ✓ Authenticated and valid
     - ⚠ Authenticated but expiring soon
     - ✗ Not authenticated
     - ? Authentication status unknown
4. Handle user selection
   - Validate user input (number, letter, or q for quit)
   - Return UserCancelledError if user quits
   - Route selection to appropriate handler:
     - Provider number: Call authenticateProvider()
     - 's': Call displayAuthenticationStatus()
     - 'l': Call logoutAll()
5. Return selection result
   - Return selected provider name for authentication
   - Return special action indicators for status/logout

**Error Handling**:
- EmptyMenuError: No OAuth providers configured
- MenuDisplayError: Unable to display menu
- InvalidSelectionError: User made invalid menu choice

**Data Transformations**:
- Provider configurations -> Menu display items
- Authentication states -> Status indicators
- User input -> Menu selection routing
- Menu selection -> Action dispatching

---

### Function: authenticateProvider(provider: string, options: AuthOptions) -> Result<AuthenticationResult, AuthError>

**Purpose**: Execute provider-specific OAuth authentication flow

**Algorithm**:
1. Validate provider and options
   - Check provider is supported OAuth provider
   - Validate provider is registered with OAuthManager
   - Return UnsupportedProviderError if invalid
   - Validate options format and required fields
2. Check existing authentication
   - Get current authentication status for provider
   - If already authenticated and not force mode:
     - Display current status and ask for confirmation
     - Return if user chooses to keep existing auth
   - If force mode or not authenticated:
     - Proceed with new authentication flow
3. Display pre-authentication information
   - Show provider name and authentication method (OAuth)
   - Display what permissions will be requested
   - Show expected flow (device code, browser redirect, etc.)
   - Allow user to cancel before starting
4. Execute provider-specific OAuth flow
   - For Qwen provider:
     - Call OAuthManager.authenticateProvider("qwen", "oauth")
     - Display QR code and device code instructions
     - Show polling progress with spinner/progress bar
     - Handle device flow completion or timeout
   - For Gemini provider:
     - Use existing Gemini OAuth implementation
     - Display browser redirect instructions
     - Handle authorization code flow
5. Process authentication result
   - If successful:
     - Display success message with provider name
     - Show token expiration information
     - Update CLI authentication state cache
     - Return success result
   - If failed:
     - Display error message with troubleshooting steps
     - Suggest alternative authentication methods if applicable
     - Return failure result with error details
6. Post-authentication validation
   - Test authentication with simple API call
   - Verify provider integration is working
   - Display warning if test fails but token is valid

**Error Handling**:
- UnsupportedProviderError: Provider not supported for OAuth
- AuthenticationFailedError: OAuth flow failed
- NetworkError: Network connectivity issues
- UserCancelledError: User cancelled during flow
- ValidationError: Post-auth validation failed

**Data Transformations**:
- Provider name -> OAuth configuration lookup
- Authentication options -> Flow parameters
- OAuth flow result -> User success/error messages
- Authentication tokens -> Stored credentials

---

### Function: displayAuthenticationStatus() -> Result<void, StatusError>

**Purpose**: Show comprehensive authentication status with OAuth focus

**Algorithm**:
1. Get authentication status summary
   - Call OAuthManager.getAuthenticationStatus()
   - Get status for all registered OAuth providers
   - Calculate overall authentication health
2. Build status display
   - Create formatted status table with columns:
     - Provider Name
     - Auth Status (✓/⚠/✗)
     - Auth Method (OAuth/API Key)
     - Token Expiry (if applicable)
     - Last Authenticated
3. Display overall status summary
   - Total OAuth providers configured
   - Number successfully authenticated
   - Number requiring attention (expired, errors)
   - Overall authentication health indicator
4. Display per-provider details
   - For each provider show:
     - Authentication method used
     - Token expiry information with human-readable format
     - Last successful authentication timestamp
     - Any warnings or required actions
5. Show actionable recommendations
   - List providers needing re-authentication
   - Show commands to fix authentication issues
   - Provide next steps for unauthenticated providers
6. Display OAuth-specific information
   - Show OAuth scope information for authenticated providers
   - Display refresh token availability
   - Show automatic refresh status and timing

**Error Handling**:
- StatusError: Unable to retrieve status information
- DisplayError: Unable to format or display status

**Data Transformations**:
- Authentication states -> Formatted status table
- Timestamps -> Human-readable time displays
- Token health -> Status indicators and warnings
- Provider configurations -> User-friendly descriptions

---

### Function: logoutProvider(provider: string) -> Result<void, LogoutError>

**Purpose**: Logout from specific OAuth provider with cleanup

**Algorithm**:
1. Validate logout request
   - Check provider is valid OAuth provider
   - Get current authentication status
   - Return NotAuthenticatedError if already logged out
2. Confirm logout intent
   - Display current provider authentication status
   - Show what will be logged out (tokens, cached auth)
   - Ask for user confirmation unless --force flag used
   - Return UserCancelledError if user cancels
3. Execute provider logout
   - Call OAuthManager.revokeAuthentication(provider)
   - This includes:
     - Server-side token revocation (if supported)
     - Local token storage deletion
     - Authentication state cache clearing
4. Display logout result
   - Show successful logout message
   - Confirm what was cleaned up
   - Provide re-authentication instructions if needed
5. Validate logout completion
   - Verify tokens are removed from storage
   - Confirm authentication state updated
   - Clear any cached provider configurations

**Error Handling**:
- NotAuthenticatedError: Provider not currently authenticated
- LogoutError: Logout operation failed
- ValidationError: Unable to verify logout completion
- UserCancelledError: User cancelled logout

**Data Transformations**:
- Provider name -> Authentication state lookup
- Logout request -> Cleanup operations
- Cleanup results -> User confirmation messages

---

### Function: handleProviderSpecificAuth(provider: string) -> Result<void, ProviderAuthError>

**Purpose**: Handle provider-specific OAuth authentication with custom flows

**Algorithm**:
1. Route to provider-specific handler
   - Switch on provider name:
     - "qwen": Call handleQwenAuth()
     - "gemini": Call handleGeminiAuth()
     - Default: Return UnsupportedProviderError
2. Qwen authentication handling
   - Initialize QwenDeviceAuthorizationFlow
   - Display Qwen-specific instructions:
     - QR code for mobile authentication
     - Web URL for desktop authentication
     - User code for manual entry
   - Start device flow polling with progress indicators
   - Handle Qwen-specific error conditions
3. Gemini authentication handling
   - Use existing Gemini OAuth implementation
   - Display Google OAuth consent screen instructions
   - Handle browser redirect flow
   - Process Google-specific error responses
4. Common post-authentication steps
   - Store received tokens securely
   - Test API connectivity with new tokens
   - Update authentication status cache
   - Display provider-specific success message

**Error Handling**:
- UnsupportedProviderError: Provider not supported
- ProviderAuthError: Provider-specific authentication failure
- NetworkError: Connectivity issues during auth
- TokenStorageError: Unable to store authentication tokens

**Data Transformations**:
- Provider name -> Provider-specific auth flow
- OAuth responses -> Stored authentication tokens
- Authentication success -> User success messages

---

## Data Structures

### CommandArgs
```
struct CommandArgs {
    provider?: string            // Specific provider (qwen, gemini)
    flags: CommandFlags         // Command flags and options
    rawArgs: string[]           // Original command arguments
}

struct CommandFlags {
    force: boolean              // Force re-authentication
    status: boolean             // Show status only
    logout: boolean             // Logout mode
    verbose: boolean            // Verbose output
    help: boolean               // Show help
}
```

### AuthOptions
```
struct AuthOptions {
    force: boolean              // Force new authentication
    timeout: number             // Authentication timeout in seconds
    displayQR: boolean          // Show QR code for mobile auth
    verbose: boolean            // Verbose progress display
    testConnection: boolean     // Test connection after auth
}
```

### AuthenticationResult
```
struct AuthenticationResult {
    provider: string            // Provider that was authenticated
    success: boolean            // Authentication success status
    authMethod: AuthMethod      // Method used for authentication
    tokenExpiry?: number        // Token expiration timestamp
    warnings: string[]          // Any authentication warnings
    testResult?: TestResult     // Connection test result
}

struct TestResult {
    success: boolean            // API test successful
    responseTime: number        // Test response time in ms
    error?: string             // Test error if failed
}
```

### CommandResult
```
struct CommandResult {
    success: boolean            // Overall command success
    action: CommandAction       // Action that was performed
    message: string             // Result message for user
    data?: any                 // Additional result data
}

enum CommandAction {
    Authentication = "auth",    // Provider authentication performed
    StatusDisplay = "status",   // Status information displayed
    Logout = "logout",         // Logout performed
    MenuDisplay = "menu",      // Menu displayed
    Help = "help"              // Help information shown
}
```

## Error Types

### CommandError
```
enum CommandError {
    ArgumentError,              // Invalid command arguments
    ConfigurationError,         // Invalid configuration
    ProviderError,             // Provider-specific error
    UserCancelledError         // User cancelled operation
}
```

### MenuError
```
enum MenuError {
    EmptyMenuError,            // No providers available
    MenuDisplayError,          // Cannot display menu
    InvalidSelectionError      // Invalid user selection
}
```

### AuthError
```
enum AuthError {
    UnsupportedProviderError,  // Provider not supported
    AuthenticationFailedError, // Auth flow failed
    NetworkError,              // Network issues
    ValidationError            // Validation failed
}
```

### StatusError
```
enum StatusError {
    StatusRetrievalError,      // Cannot get status
    DisplayError               // Cannot display status
}
```

## User Experience Features

### Visual Indicators
1. **Authentication Status Icons**:
   - ✓ (green): Authenticated and valid
   - ⚠ (yellow): Authenticated but expiring soon
   - ✗ (red): Not authenticated
   - ? (gray): Status unknown

2. **Progress Indicators**:
   - Spinner for OAuth polling
   - Progress bars for multi-step flows
   - Countdown timers for device code expiry

3. **Interactive Elements**:
   - Numbered menu options
   - Keyboard shortcuts
   - Confirmation prompts
   - Cancellation handling (Ctrl+C)

### Error Recovery
1. **Network Error Recovery**:
   - Retry prompts with exponential backoff
   - Offline mode detection and handling
   - Alternative authentication suggestions

2. **User Error Recovery**:
   - Clear error messages with next steps
   - Help text for common issues
   - Links to documentation and support

3. **Authentication Error Recovery**:
   - Token refresh retry logic
   - Fallback to alternative auth methods
   - Clear instructions for manual resolution

## OAuth-Only Compliance (REQ-001)

1. **Menu Filtering**: Only show OAuth-enabled providers in menu
2. **Command Validation**: Reject non-OAuth authentication options
3. **Help Text**: Focus help content on OAuth flows only
4. **Error Messages**: Guide users to OAuth solutions, not API keys
5. **Status Display**: Emphasize OAuth authentication status

## Provider-Specific Extensions

### Qwen Provider Support
1. **Device Flow UI**: Specialized QR code and user code display
2. **Polling Progress**: Real-time polling status updates
3. **Error Handling**: Qwen-specific error message translations
4. **Connection Testing**: Qwen API endpoint validation

### Gemini Provider Support
1. **Browser Integration**: Automatic browser launching
2. **Redirect Handling**: Local server for redirect capture
3. **Scope Management**: Google OAuth scope explanation
4. **Integration**: Seamless integration with existing Gemini auth