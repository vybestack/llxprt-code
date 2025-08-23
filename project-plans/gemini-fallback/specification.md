# Feature Specification: Gemini OAuth Fallback

## Purpose

The purpose of this feature is to improve the authentication flow for the Gemini provider when OAuth is required. Currently, when a user needs to authenticate with Google OAuth for the Gemini provider, the authorization URL is printed to the debug console. This URL often wraps across multiple lines and is surrounded by decoration characters, making it extremely difficult or impossible for users to copy and paste in constrained terminal environments like VSCode's debug console.

This feature addresses that problem by implementing a fallback mechanism that:
1. Copies the clean OAuth URL to the system clipboard automatically
2. Displays a dialog with clear instructions for manual authentication
3. Provides a secure way for users to paste the verification code

## Architectural Decisions

- **Pattern**: OAuth flow enhancement with clipboard integration
- **Technology Stack**: TypeScript (strict mode), Node.js, React (cli UI)
- **Data Flow**: Authorization URL generated → URL copied to clipboard → Dialog displayed → User pastes verification code → Code exchanged for tokens
- **Integration Points**: 
  - `packages/core/src/providers/gemini/GeminiProvider.ts` - Provider OAuth integration
  - `packages/cli/src/ui/App.tsx` - UI state management and dialog display
  - `packages/cli/src/ui/components/OAuthCodeDialog.tsx` - Dialog component enhancement

## Project Structure

```text
src/
  providers/
    gemini/
      GeminiProvider.ts # Enhanced OAuth integration
  ui/
    App.tsx # OAuth state detection and dialog display
    components/
      OAuthCodeDialog.tsx # Provider-specific messaging
```

## Technical Environment

- **Type**: CLI Tool with IDE Extension capabilities
- **Runtime**: Node.js 20.x with React-based terminal UI
- **Dependencies**: 
  - `@vybestack/llxprt-code-core` for core OAuth functionality
  - System clipboard utilities (pbcopy/xclip/clip) for cross-platform support

## Integration Points

### Existing Code That Will Use This Feature
- `packages/core/src/providers/gemini/GeminiProvider.ts` - Will call clipboard utilities and set global state variables
- `packages/cli/src/ui/App.tsx` - Will detect OAuth state and show dialog
- `packages/cli/src/ui/components/OAuthCodeDialog.tsx` - Will display provider-specific instructions

### Existing Code To Be Replaced
- `packages/core/src/code_assist/oauth2.ts` - Legacy OAuth URL display implementation to be wrapped with clipboard functionality

### User Access Points
- CLI: Any command requiring Gemini provider authentication
- UI: OAuthCodeDialog component when triggered by Gemini provider

### Migration Requirements
- No data migration required as this is purely behavioral enhancement
- Configuration files: No schema update required
- Existing flows that printed OAuth URL to console will be enhanced with clipboard functionality

## Formal Requirements

[REQ-001] OAuth URL to Clipboard Copying
  [REQ-001.1] OAuth URL must be copied cleanly to system clipboard without additional formatting characters
  [REQ-001.2] Clipboard copy should work cross-platform: macOS (pbcopy), Linux (xclip/wl-clipboard), Windows (clip)
  [REQ-001.3] Fallback to console display if clipboard utilities aren't available

[REQ-002] Provider-specific OAuth Code Dialog
  [REQ-002.1] Dialog should show provider-specific instructions for Gemini OAuth flow
  [REQ-002.2] Input field should accept paste operations for security code
  [REQ-002.3] Dialog should support cancellation with Escape key

[REQ-003] Global State Management
  [REQ-003.1] Provider should set `__oauth_needs_code = true` to trigger dialog
  [REQ-003.2] Provider should set `__oauth_provider = 'gemini'` for provider identification
  [REQ-003.3] State should be reset after successful authentication or cancellation

[REQ-004] Integration Requirements
  [REQ-004.1] Replace existing OAuth flow in `llxprt-code-core` that prints URL to console
  [REQ-004.2] Update CLI to handle Gemini provider OAuth state properly
  [REQ-004.3] Deprecate and remove legacy URL formatting without affecting other flows

[REQ-005] Error Handling
  [REQ-005.1] Handle invalid verification codes gracefully
  [REQ-005.2] Support cancellation during OAuth authentication
  [REQ-005.3] Properly handle clipboard copy failures with fallback to console

[REQ-006] User Experience
  [REQ-006.1] User should be informed easily about clipboard copy
  [REQ-006.2] User should be guided through authentication steps clearly
  [REQ-006.3] Input field should only accept pasted content (not typed) for security

## Constraints

- No external HTTP calls in unit tests
- OAuth URL must be generated through existing `@vybestack/llxprt-code-core` methods
- Console URL display should maintain current behavior when clipboard copy fails
- Dialog component should continue to work with Anthropic/Qwen providers
- All changes must be backward compatible

## Performance Requirements

- Clipboard copy operation: <100ms
- Dialog display response: <50ms
- OAuth token exchange: <2000ms