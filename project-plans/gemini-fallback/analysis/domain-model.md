# Domain Model Analysis: Gemini OAuth Fallback

## Entities

1. **OAuthProvider** - Abstract representation of an OAuth provider
   - Properties: providerName, authUrl, clientId, clientSecret
   - Methods: getAuthToken(), initiateOAuthFlow(), completeOAuthFlow()

2. **GeminiProvider** - Concrete implementation of OAuthProvider for Gemini
   - Extends OAuthProvider
   - Methods: generateChatCompletion() with OAuth integration

3. **AppUI** - Main CLI application UI component
   - Properties: globalState
   - Methods: detectOAuthState(), renderOAuthDialog()

4. **OAuthCodeDialog** - Dialog component for entering verification codes
   - Properties: provider, instructions, inputField
   - Methods: handleInput(), onSubmit(), onClose()

5. **ClipboardService** - Service for cross-platform clipboard operations
   - Methods: copyToClipboard(), isAvailable()

## Relationships

- GeminiProvider **uses** ClipboardService to copy OAuth URLs
- GeminiProvider **sets** global state variables to trigger OAuthCodeDialog
- AppUI **detects** global state variables set by providers
- AppUI **renders** OAuthCodeDialog when authentication is needed
- OAuthCodeDialog **displays** provider-specific instructions
- OAuthCodeDialog **submits** verification codes back to providers

## State Transitions

1. **Initial State**
   - No clipboard operation performed
   - No global state variables set
   - No dialog displayed

2. **OAuth Initiation**
   - GeminiProvider calls getAuthToken()
   - If no API key is available, returns 'USE_LOGIN_WITH_GOOGLE'
   - GeminiProvider initiates OAuth flow through llxprt-code-core

3. **Clipboard Copy Attempt**
   - OAuth URL is generated
   - ClipboardService attempts to copy URL to system clipboard
   - On success: URL is available in clipboard
   - On failure: Falls back to console print

4. **Dialog Trigger**
   - GeminiProvider sets `__oauth_needs_code = true`
   - GeminiProvider sets `__oauth_provider = 'gemini'`
   - AppUI detects these global state variables
   - AppUI renders OAuthCodeDialog with provider name

5. **User Interaction**
   - User pastes clean OAuth URL into browser
   - User completes Google OAuth process
   - User receives verification code
   - User pastes verification code into dialog input field

6. **Code Submission**
   - OAuthCodeDialog passes code to GeminiProvider
   - GeminiProvider exchanges code for OAuth tokens
   - Global state variables are reset
   - GeminiProvider returns authenticated client to consumer

7. **Cancellation/Errors**
   - User presses Escape to cancel dialog
   - GeminiProvider handles cancellation appropriately
   - Or invalid verification code is submitted
   - Error is handled and appropriate feedback provided to user
   - System returns to initial state

## Business Rules

1. **Clipboard Copying Rule**
   - OAuth URLs must be copied to clipboard if utilities are available
   - Decoration characters must not be included
   - URL should be in clean, copyable format

2. **Dialog Display Rule**
   - OAuthCodeDialog must be displayed when `__oauth_needs_code` is true
   - Dialog instructions must be provider-specific
   - Dialog must support paste-only input for security
   - Dialog must support cancellation with Escape key

3. **Global State Management Rule**
   - Providers must set `__oauth_needs_code = true` to trigger authentication dialog
   - Providers must set `__oauth_provider` with their name identity
   - State variables must be reset after authentication completion or cancellation

4. **Error Handling Rule**
   - Invalid verification codes must produce clear error messages
   - Cancelled dialogs must halt OAuth process cleanly
   - Clipboard failures must fallback to console display

## Edge Cases

1. **Unavailable Clipboard**
   - pbcopy/xclip/clip utilities not found
   - Process permissions do not allow clipboard access
   - Running in Docker/container environment without clipboard support

2. **Invalid Verification Code**
   - User pastes non-OAuth code
   - Code contains invalid characters
   - Code has expired or already been used

3. **Dialog Cancellation**
   - User presses Escape key before pasting code
   - User closes terminal window during OAuth process
   - System interruption during verification exchange

4. **Constrained Terminal Environments**
   - VSCode debug console with character width limitations
   - IDE integrated terminals with line wrapping issues
   - Remote terminal sessions with clipboard restrictions

5. **Multiple OAuth Flows**
   - User has multiple providers requiring authentication
   - Concurrent OAuth requests from different features

## Error Scenarios

1. **Clipboard Copy Failure**
   - Error when executing clipboard utility
   - Empty or malformed OAuth URL
   - System access restrictions

2. **OAuth Token Exchange Failure**
   - Invalid verification code from Google
   - Expired OAuth URL
   - Network issues during token exchange
   - Incorrect provider configuration

3. **Dialog Operation Error**
   - UI rendering issues
   - Input handling problems
   - State management inconsistencies

4. **System Compatibility Errors**
   - Unrecognized operating system
   - Missing system utilities
   - Incorrect process environment setup