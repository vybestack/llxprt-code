# Phase 07: Refresh Token Implementation

## Phase ID

`PLAN-20250217-CREDPROXY-REMEDIATION.P07`

## Purpose

Implement **REAL** `handleRefreshToken` that:
1. Uses RefreshCoordinator for rate limiting and deduplication
2. Calls real `provider.refreshToken()` through coordinator
3. Stores new token (including refresh_token) in backingStore
4. Returns sanitized token (without refresh_token)

---

## Prerequisites

- Phase 06 completed (TDD tests written)
- Phase 06a verification passed (tests fail against fake)

---

## Constructor Changes Required

### Add providers and RefreshCoordinator to CredentialProxyServerOptions

**File**: `packages/cli/src/auth/proxy/credential-proxy-server.ts`

```typescript
import { RefreshCoordinator } from './refresh-coordinator.js';

export interface CredentialProxyServerOptions {
  tokenStore: TokenStore;
  providerKeyStorage: ProviderKeyStorage;
  socketDir?: string;
  allowedProviders?: string[];
  allowedBuckets?: string[];
  flowFactories?: Map<string, () => OAuthFlowInterface>;
  // NEW: Required for refresh operations
  providers?: Map<string, OAuthProviderInterface>;
  refreshCoordinator?: RefreshCoordinator;
  oauthSessionTimeoutMs?: number;
}

// Provider interface for refresh operations
interface OAuthProviderInterface {
  refreshToken(refreshToken: string): Promise<OAuthToken>;
}
```

### Add refreshCoordinator field

```typescript
export class CredentialProxyServer {
  private readonly refreshCoordinator: RefreshCoordinator;
  
  constructor(options: CredentialProxyServerOptions) {
    this.options = options;
    this.refreshCoordinator = options.refreshCoordinator ?? new RefreshCoordinator(
      options.tokenStore,
      30 * 1000 // 30s cooldown
    );
  }
}
```

---

## Implementation

### handleRefreshToken - REAL Implementation

Replace the fake implementation with:

```typescript
/**
 * Handles token refresh - uses RefreshCoordinator for rate limiting/dedup.
 * 
 * CRITICAL: Token is stored in backingStore WITH refresh_token.
 *           Response is sanitized (refresh_token stripped).
 *           RefreshCoordinator handles rate limiting (30s) and deduplication.
 *
 * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P07
 */
private async handleRefreshToken(
  socket: net.Socket,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const provider = payload.provider as string | undefined;
  const bucket = payload.bucket as string | undefined;

  // Validate required fields
  if (!provider) {
    this.sendError(socket, id, 'INVALID_REQUEST', 'Missing provider');
    return;
  }

  // Check provider authorization
  if (!this.isProviderAllowed(provider)) {
    this.sendError(
      socket,
      id,
      'UNAUTHORIZED',
      `UNAUTHORIZED: Provider not allowed: ${provider}`,
    );
    return;
  }

  // Check bucket authorization
  if (!this.isBucketAllowed(bucket)) {
    this.sendError(
      socket,
      id,
      'UNAUTHORIZED',
      `UNAUTHORIZED: Bucket not allowed: ${bucket ?? 'default'}`,
    );
    return;
  }

  // Get existing token - must have one to refresh
  const existingToken = await this.options.tokenStore.getToken(provider, bucket);
  if (!existingToken) {
    this.sendError(
      socket,
      id,
      'NOT_FOUND',
      `No token found to refresh for provider: ${provider}`,
    );
    return;
  }

  // Must have refresh_token to refresh
  if (!existingToken.refresh_token) {
    this.sendError(
      socket,
      id,
      'REFRESH_NOT_AVAILABLE',
      `Token for ${provider} does not have a refresh_token`,
    );
    return;
  }

  // Get provider for refresh operation
  const oauthProvider = this.options.providers?.get(provider);
  if (!oauthProvider) {
    this.sendError(
      socket,
      id,
      'PROVIDER_NOT_CONFIGURED',
      `No OAuth provider configured for: ${provider}`,
    );
    return;
  }

  try {
    // Use RefreshCoordinator for rate limiting and deduplication
    const refreshResult = await this.refreshCoordinator.refresh(
      provider,
      bucket ?? 'default',
      async () => {
        // This is the REAL refresh call
        return await oauthProvider.refreshToken(existingToken.refresh_token!);
      },
    );

    // Check for rate limiting
    if (refreshResult.rateLimited) {
      this.sendError(socket, id, 'RATE_LIMITED', 'Refresh rate limited');
      // Add retryAfter to response
      const response = {
        id,
        ok: false,
        code: 'RATE_LIMITED',
        error: 'Refresh rate limited',
        retryAfter: refreshResult.retryAfter ?? 30,
      };
      socket.write(encodeFrame(response));
      return;
    }

    // Check for auth errors (invalid_grant, expired refresh_token)
    if (refreshResult.authError) {
      this.sendError(socket, id, 'REAUTH_REQUIRED', 'Refresh token expired or revoked');
      return;
    }

    // Get the refreshed token
    const newToken = refreshResult.token;
    if (!newToken) {
      this.sendError(socket, id, 'REFRESH_FAILED', 'Refresh did not return a token');
      return;
    }

    // Store FULL token in backing store (INCLUDING new refresh_token if provided)
    const tokenToStore = {
      ...newToken,
      // Preserve old refresh_token if new one not provided
      refresh_token: newToken.refresh_token ?? existingToken.refresh_token,
    };
    await this.options.tokenStore.saveToken(provider, tokenToStore, bucket);

    // Return SANITIZED token (WITHOUT refresh_token)
    const sanitized = sanitizeTokenForProxy(newToken);
    this.sendOk(socket, id, sanitized as unknown as Record<string, unknown>);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    
    // Detect auth errors (invalid_grant, etc.)
    if (this.isAuthError(err)) {
      this.sendError(socket, id, 'REAUTH_REQUIRED', message);
      return;
    }
    
    this.sendError(socket, id, 'REFRESH_FAILED', message);
  }
}

/**
 * Detects if an error is an authentication error requiring re-auth.
 *
 * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P07
 */
private isAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  
  const message = err.message.toLowerCase();
  const code = (err as unknown as Record<string, unknown>).code;
  
  // Check for common auth error patterns
  return (
    message.includes('invalid_grant') ||
    message.includes('refresh token expired') ||
    message.includes('refresh token revoked') ||
    message.includes('unauthorized') ||
    code === 'INVALID_GRANT' ||
    code === 'EXPIRED_TOKEN' ||
    code === 'REVOKED_TOKEN'
  );
}
```

---

## Semantic Behavior Requirement

The implementation MUST have all required method calls:

```bash
# Verify all required behaviors are present
grep -c "RefreshCoordinator\|coordinator.*refresh\|refreshToken\|RATE_LIMITED" packages/cli/src/auth/proxy/credential-proxy-server.ts
# Expected: 3+
```

---

## Real Provider Call Verification

The implementation MUST call `oauthProvider.refreshToken()`:

```bash
grep -n "oauthProvider.refreshToken\|provider.refreshToken" packages/cli/src/auth/proxy/credential-proxy-server.ts
# Expected: Find the call inside handleRefreshToken
```

---

## RefreshCoordinator Usage Verification

The implementation MUST use RefreshCoordinator:

```bash
grep -n "refreshCoordinator.refresh" packages/cli/src/auth/proxy/credential-proxy-server.ts
# Expected: Find in handleRefreshToken
```

---

## No Fake Patterns

```bash
grep -n "refreshed_\|Date.now()" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -i refresh | grep -v "^[0-9]*:.*//\|^[0-9]*:.*\*"
# Expected: 0 matches in actual code for fake refresh patterns
```

---

## Tests Should Now Pass

After implementation:

```bash
npm test -- packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts
# Expected: ALL PASS
```

---

## Success Criteria

1. [x] `handleRefreshToken` retrieves existing token with `refresh_token`
2. [x] `handleRefreshToken` uses RefreshCoordinator for rate limiting
3. [x] `handleRefreshToken` calls `oauthProvider.refreshToken()`
4. [x] New token (including refresh_token) stored in backingStore
5. [x] Response is sanitized (no refresh_token)
6. [x] Returns `RATE_LIMITED` with `retryAfter` when rate limited
7. [x] Returns `REFRESH_NOT_AVAILABLE` when no refresh_token
8. [x] Returns `REAUTH_REQUIRED` on auth errors
9. [x] Implementation has all required semantic behaviors
10. [x] All Phase 06 tests now PASS
11. [x] No fake patterns (`refreshed_${Date.now()}`)

---

## Phase Completion Marker

Create: `project-plans/issue1358_1359_1360_remediation/.completed/P07.md`

```markdown
Phase: P07
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/cli/src/auth/proxy/credential-proxy-server.ts

Changes:
- Added providers and refreshCoordinator to options
- Implemented handleRefreshToken (XX lines)
- Added isAuthError helper
- Uses RefreshCoordinator for rate limiting

Key Implementation Lines:
- Line XX: existingToken.refresh_token check
- Line YY: this.refreshCoordinator.refresh()
- Line ZZ: oauthProvider.refreshToken(existingToken.refresh_token)
- Line AA: tokenStore.saveToken with new token
- Line BB: sanitizeTokenForProxy(newToken)

Verification:
- Semantic behaviors: All required method calls present
- Tests: All Phase 06 tests PASS
- Fake patterns: 0 matches
- RefreshCoordinator: Used
```

ine YY: this.refreshCoordinator.refresh()
- Line ZZ: oauthProvider.refreshToken(existingToken.refresh_token)
- Line AA: tokenStore.saveToken with new token
- Line BB: sanitizeTokenForProxy(newToken)

Verification:
- Semantic behaviors: All required method calls present
- Tests: All Phase 06 tests PASS
- Fake patterns: 0 matches
- RefreshCoordinator: Used
```
