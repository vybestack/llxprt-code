# Testing Strategy for Gemini OAuth Fallback Implementation

## Test Environments

We need to test the implementation in various environments where the OAuth URL might be difficult to copy from console:

1. **Debug Console Environments**:
   - VSCode Debug Console
   - IDE integrated terminals with line wrapping
   - Constrained terminal windows

2. **NO_BROWSER Settings**:
   - Environment with `NO_BROWSER=true`
   - Systems where browser opening fails or is not available

3. **Cross-Platform Testing**:
   - macOS
   - Linux (with both X11 and Wayland)
   - Windows
   - Docker container environments

## Test Cases

### 1. Successful Clipboard Copy
- **Setup**: Normal system with clipboard utilities available
- **Action**: Initiate Gemini OAuth with `NO_BROWSER=true`
- **Expected**: 
  - OAuth URL is copied to clipboard
  - OAuthCodeDialog is displayed with Gemini-specific instructions
  - User can paste verification code to complete authentication

### 2. Clipboard Copy Failure
- **Setup**: System without clipboard utilities or with clipboard errors
- **Action**: Initiate Gemini OAuth with `NO_BROWSER=true`
- **Expected**:
  - Cleanly formatted URL is displayed in console
  - OAuthCodeDialog is still displayed with fallback instructions
  - User can manually copy URL and paste verification code

### 3. Normal Browser Flow (Regression Test)
- **Setup**: Normal system without `NO_BROWSER` setting
- **Action**: Initiate Gemini OAuth without constraints
- **Expected**:
  - Browser automatically opens for OAuth
  - No dialog displayed
  - Authentication completes normally

### 4. Dialog Cancellation
- **Setup**: Any system where OAuthCodeDialog is displayed
- **Action**: User cancels dialog (Escape key)
- **Expected**:
  - OAuth flow is properly cancelled
  - Appropriate error message is displayed
  - System returns to normal state

### 5. Invalid Verification Code
- **Setup**: OAuthCodeDialog displayed after clipboard copy
- **Action**: User enters invalid verification code
- **Expected**:
  - Appropriate error handling for invalid code
  - Dialog remains open for retry or cancellation
  - System gracefully handles OAuth failure

## Implementation Verification Points

### 1. Clipboard Copy Functionality
- Verify clipboard utilities are called with correct URL
- Test fallback when clipboard is not available
- Ensure clipboard content is clean and unwrapped

### 2. Global State Management
- Verify `__oauth_needs_code` is properly set when required
- Verify `__oauth_provider` is set to 'gemini' for provider identification
- Verify state is properly cleared after OAuth completion or cancellation

### 3. Dialog Display and User Experience
- Verify OAuthCodeDialog appears when needed
- Verify provider-specific instructions are shown correctly
- Verify dialog can be closed with Escape key
- Verify verification code can be pasted into input field

### 4. OAuth Flow Completion
- Verify verification code is properly submitted to OAuth implementation
- Verify tokens are properly exchanged and cached
- Verify normal processing continues after successful OAuth

## Test Data Preparation

1. **Mock OAuth URLs**:
   - Generate sample URLs for testing clipboard functionality
   - Ensure URLs are long enough to potentially wrap in constrained environments

2. **Mock Verification Codes**:
   - Test with valid-like verification codes
   - Test with invalid or malformed codes

3. **Cross-Platform Utilities**:
   - Prepare test environments with different clipboard utilities
   - Test with missing or broken clipboard tools

## Automation Considerations

1. **Unit Tests**:
   - Test clipboard functionality in isolation
   - Test provider-specific dialog messaging
   - Mock global state variables for predictable testing

2. **Integration Tests**:
   - Test complete OAuth flow with UI dialog
   - Verify state transitions between components

3. **E2E Tests**:
   - Test in actual constrained terminal environments
   - Verify user experience improvements

## Manual Testing Scenarios

1. **VSCode Debug Console**:
   - Run app with `NO_BROWSER=true` in VSCode debugger
   - Verify URL is properly copied to clipboard
   - Verify dialog instructions are clear

2. **Terminal Width Testing**:
   - Resize terminal window to various widths
   - Verify dialog and instructions remain readable

3. **Environment Variable Testing**:
   - Test with `NO_BROWSER=true`
   - Test with `NO_BROWSER=false`
   - Test without `NO_BROWSER` set

4. **Error Handling Manual Tests**:
   - Test with invalid verification codes
   - Test with dialog cancellation
   - Verify appropriate error messages and behaviors