# Clipboard Functionality for Gemini OAuth Fallback

## Objective

Implement clipboard copying of OAuth URLs for the Gemini provider when browser opening fails or is suppressed, allowing users to easily paste the URL into a browser for authentication.

## Current Implementation

From examining the codebase, clipboard functionality is likely already implemented for other features. We need to:

1. Find the existing clipboard implementation
2. Use it to copy OAuth URLs for Gemini provider
3. Ensure it works across platforms (macOS, Linux, Windows)

## Existing Clipboard Functionality

The codebase already includes clipboard functionality for other purposes. This likely includes:

1. Platform-specific clipboard handling (pbcopy/xclip/clip)
2. Cross-platform clipboard module
3. Implementation in CLI utilities

## Required Implementation Points

### 1. URL Copying at OAuth Initiation

We need to modify the OAuth flow to automatically copy the URL to clipboard instead of printing it to console. This likely involves intercepting the code in either:

- `packages/core/src/providers/gemini/GeminiProvider.ts`
- `@vybestack/llxprt-code-core` package when it handles Google OAuth

### 2. Platform Compatibility

The implementation must handle:

- macOS: pbcopy utility
- Linux: xclip or wl-clipboard utilities
- Windows: clip utility
- Docker/Container environments

### 3. Fallback Behavior

If clipboard copying fails:

1. Fallback to display URL in console with clear formatting
2. Instructions for manual copying
3. Ensure URL is wrapped properly for different terminal widths

## Implementation Approaches

### Option 1: Core Implementation
Enhance the Google OAuth flow in `@vybestack/llxprt-code-core` to:
1. Set a flag when browser launch fails
2. Copy the URL to clipboard when flag is set
3. Display provider-specific instructions

### Option 2: Provider Implementation
Modify `GeminiProvider` to:
1. Catch when OAuth URL would normally be printed to console
2. Copy it to clipboard instead
3. Set global state variables to trigger dialog in CLI UI

### Option 3: UI Implementation
Modify the CLI UI to:
1. Detect when a Gemini OAuth URL is about to be printed
2. Automatically intercept and copy to clipboard
3. Show dialog with instructions

## Recommended Approach

Option 2 (Provider Implementation) is most consistent with the existing pattern:
- Anthropic/Qwen providers already handle their own OAuth dialog triggering
- Maintains separation between core and provider-specific behavior
- Uses existing global state mechanism (`__oauth_needs_code`, `__oauth_provider`)

## Key Integration Points

### 1. OAuth URL Generation
In `packages/core/src/code_assist/oauth2.ts`:
```typescript
// Currently prints URL to console:
console.log('Please visit the following URL to authorize the application:');
console.log('');
console.log(authUrl);
console.log('');
```

We need to:
1. Identify when we're in a context where clipboard copying would be beneficial
2. Add a flag for UI to intercept console writing
3. Or modify the calling code to handle URL copying

### 2. Clipboard Copy Implementation

Will likely use existing clipboard utilities from the codebase. If they don't exist, we'll need to implement:
1. Platform detection
2. Command execution for clipboard utilities
3. Error handling for unavailable clipboard tools

### 3. Global State Setting
```typescript
// In GeminiProvider when initiating OAuth and browser fails:
(global as any).__oauth_needs_code = true;
(global as any).__oauth_provider = 'gemini';
```

## Fallback to Console Display

If clipboard copying fails, we still need to display the URL to the user:
1. Format URL clearly without wrapping issues
2. Provide instructions for manual copying
3. Indicate that the OAuth process cannot proceed in constrained terminals

This fallback will ensure users can still authenticate when clipboard functionality is not available.