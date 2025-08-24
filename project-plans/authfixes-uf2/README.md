# OAuth Authentication Fixes - Unfuck Round 2

## Problem Statement

The OAuth authentication system has multiple critical failures:

1. **Gemini OAuth** - Forces everyone into manual fallback mode (no browser launch)
2. **OAuth Fallback Flow** - Incomplete implementation, no user input mechanism
3. **Anthropic Logout** - Doesn't actually log out due to auth caching and error suppression
4. **Gemini Logout** - May have similar issues to Anthropic

## Root Causes

### 1. Gemini Forced Fallback
- `gemini-oauth-provider.ts` hardcodes `isBrowserLaunchSuppressed: () => true`
- This forces ALL users into manual URL copy/paste flow
- The manual flow itself is broken (see #2)

### 2. Broken Fallback Flow
- `authWithUserCode()` in `oauth2.ts` prints message but has no input mechanism
- Uses `console.log()` instead of proper dialog UI
- Function returns immediately without waiting for user input
- No code exchange implementation

### 3. Anthropic Logout Failure
- BaseProvider has 1-minute auth cache that survives logout
- `errorHandler.handleGracefully()` swallows errors and returns success
- AnthropicProvider doesn't track cached auth key
- Client instance isn't recreated when auth changes to null

### 4. Architecture Issues
- Mixing interactive operations in non-interactive contexts
- "Graceful" error handling that hides failures
- No cache invalidation on logout
- Inconsistent client management between providers

## Success Criteria

1. ✅ Gemini OAuth opens browser automatically when possible
2. ✅ Fallback flow has working user input dialog for verification code
3. ✅ Anthropic logout actually stops authentication
4. ✅ Gemini logout properly cleans up all auth state
5. ✅ Errors fail fast and loud - no silent failures
6. ✅ Proper debug logging throughout

## Implementation Plan

See individual phase documents:
- [Phase 1: Fix Gemini OAuth Flow](./phase1-gemini-oauth.md)
- [Phase 2: Fix Fallback Flow UI](./phase2-fallback-ui.md)
- [Phase 3: Fix Anthropic Logout](./phase3-anthropic-logout.md)
- [Phase 4: Fix Gemini Logout](./phase4-gemini-logout.md)
- [Phase 5: Add Debug Logging](./phase5-logging.md)

## Testing Requirements

- Test with browser available → should auto-open
- Test with browser suppressed → should show dialog
- Test logout → should immediately fail auth
- Test re-login → should work again
- Test error cases → should fail loudly

## Notes

- Anthropic login flow is correct (manual only) - don't change
- Focus on logout and cache clearing
- Remove ALL "graceful" error handling in auth paths
- Fast fail is reliable software