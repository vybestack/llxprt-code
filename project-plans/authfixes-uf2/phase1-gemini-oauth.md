# Phase 1: Fix Gemini OAuth Flow

## Problem
Gemini OAuth is forced into fallback mode for everyone because of hardcoded `isBrowserLaunchSuppressed: () => true`

## Solution

### 1. Fix Browser Detection
**File**: `packages/cli/src/auth/gemini-oauth-provider.ts`

**Current** (line ~135):
```typescript
const config = {
  getProxy: () => undefined,
  isBrowserLaunchSuppressed: () => true, // ALWAYS suppresses browser
} as unknown as Parameters<typeof getOauthClient>[1];
```

**Fixed**:
```typescript
// Import browser detection utility
import { shouldLaunchBrowser } from '@vybestack/llxprt-code-core';

// In initiateAuth():
const config = {
  getProxy: () => undefined,
  isBrowserLaunchSuppressed: () => !shouldLaunchBrowser(), // Properly detect
} as unknown as Parameters<typeof getOauthClient>[1];
```

### 2. Handle USE_EXISTING_GEMINI_OAUTH
The Gemini provider has special handling for using existing Google OAuth. This should be preserved but with proper browser detection.

## Testing
1. Run in normal terminal → browser should open
2. Run with `LLXPRT_NO_BROWSER=1` → fallback flow
3. Run over SSH → fallback flow
4. Verify Google OAuth integration still works