# Gemini OAuth Fallback Implementation Plan

## Problem Statement

When using the Gemini provider without an API key, the current OAuth flow prints a very long authorization URL to the debug console. This URL often wraps across multiple lines and contains extra decoration characters, making it impossible for users to copy and paste directly into a browser. This prevents completion of the OAuth authentication process in constrained terminal environments.

## Solution Overview

Implement a user-friendly OAuth code dialog for the Gemini provider that replicates the pattern already used for Anthropic/Qwen providers:

1. **Automatic Clipboard Copy**:
   - Instead of printing the OAuth URL to the console, automatically copy the clean URL to the system clipboard
   - This ensures the user gets the complete, unwrapped URL without extra characters

2. **OAuth Code Dialog**:
   - Show a dialog component with clear instructions for the OAuth flow:
     - Inform the user that the authorization URL has been copied to their clipboard
     - Provide step-by-step guidance for completing the OAuth process in their browser
     - Include an input field for pasting the verification code received from Google's OAuth page
   - This dialog should be consistent with the existing Anthropic/Qwen OAuth flow experience

3. **UX Flow**:
   - When the Gemini provider needs to authenticate via OAuth (no API key available)
   - System automatically copies the authorization URL to clipboard
   - Shows dialog with instructions for pasting URL in browser
   - Provides input field for verification code from Google's OAuth page
   - Handles code submission and cancellation gracefully

## Implementation Approach

### UI Integration
1. Modify `packages/cli/src/ui/App.tsx` to detect when Gemini provider needs OAuth authentication
2. Display the OAuth Code Dialog when this condition is met
3. Hook into existing OAuth flow state management
4. Ensure proper global state handling for OAuth flow (`__oauth_needs_code`, `__oauth_provider`)

### Dialog Component Enhancement
1. Update `packages/cli/src/ui/components/OAuthCodeDialog.tsx` to handle provider-specific messaging
2. Maintain ability to handle both Anthropic/Qwen and Gemini OAuth flows
3. Add provider-specific instructions for the Gemini OAuth process
4. Ensure verification code input field works with Google's OAuth flow

### Gemini Provider OAuth Integration
1. Modify `packages/core/src/providers/gemini/GeminiProvider.ts` to better integrate with the CLI's OAuth flow handling
2. Ensure the provider properly signals when OAuth authentication is needed
3. Implement clean OAuth URL generation and handling
4. Handle OAuth token exchange and verification code submission

## Files to Modify

1. `packages/cli/src/ui/App.tsx` - Handle OAuth flow state and display dialog
2. `packages/cli/src/ui/components/OAuthCodeDialog.tsx` - Update to handle provider-specific instructions
3. `packages/core/src/providers/gemini/GeminiProvider.ts` - Improve OAuth initiation and completion flow

## Distinction from Auth Dialog

This implementation is distinct from the `/auth` command dialog:
- **Auth Dialog**: Toggles OAuth enablement for providers (ON/OFF) and allows provider selection
- **OAuth Code Dialog**: Handles the actual OAuth authentication flow when a provider is actively trying to authenticate

The OAuth Code Dialog appears automatically when the system detects that OAuth authentication is needed for Gemini, providing a better user experience than printing complex URLs to the console.

## Existing Patterns to Follow

### Anthropic/Qwen Flow
1. Provider sets `__oauth_needs_code = true` and `__oauth_provider = 'provider_name'`
2. CLI UI catches this state and displays the OAuthCodeDialog
3. User pastes the verification code into the dialog
4. Provider receives code via `submitAuthCode` method

### Google OAuth Flow
1. When Gemini provider has no API key, it returns 'USE_LOGIN_WITH_GOOGLE' from `getAuthToken()`
2. This triggers the OAuth flow in `generateChatCompletion`
3. Currently prints URL to console which is problematic in debug console environments
4. Need to intercept this flow to copy URL to clipboard and show dialog instead

## Implementation Steps

1. Create provider-specific messaging for OAuthCodeDialog
2. Implement clipboard copy functionality for OAuth URLs
3. Modify Gemini provider to set proper global state for OAuth flow
4. Update CLI UI to catch and handle Gemini OAuth states
5. Test implementation in various terminal environments