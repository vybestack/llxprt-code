# Pseudocode: RefreshCoordinator

Plan ID: PLAN-20250214-CREDPROXY
Component: RefreshCoordinator (Host-Side, internal to CredentialProxyServer)

## Interface Contracts

```typescript
// INPUTS
interface RefreshRequest {
  provider: string;
  bucket?: string;
}

// OUTPUTS
interface RefreshResult {
  token: SanitizedOAuthToken;
}

// DEPENDENCIES (NEVER stubbed)
interface Dependencies {
  tokenStore: KeyringTokenStore;
  providers: Map<string, OAuthProvider>;
}
```

## Integration Points

```
Line 20: CALL tokenStore.getToken(provider, bucket) — reads full token with refresh_token
Line 30: CALL tokenStore.acquireRefreshLock(provider, {bucket}) — file-based advisory lock
Line 40: CALL provider.refreshToken(currentToken) — provider-specific refresh
         - Anthropic/Qwen/Codex: calls OAuthProvider.refreshToken(OAuthToken)
         - Gemini: uses OAuth2Client.getAccessToken() path (see Gemini exception)
Line 55: CALL mergeRefreshedToken(stored, newToken) — shared utility from token-merge.ts
Line 60: CALL tokenStore.saveToken(provider, merged, bucket) — persists merged token
Line 65: CALL tokenStore.releaseRefreshLock(provider, bucket) — releases advisory lock
Line 70: CALL sanitizeTokenForProxy(merged) — strips refresh_token before returning
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: await provider.refreshToken(token.refresh_token)  // Wrong signature
[OK]    DO: await provider.refreshToken(currentToken)  // Full OAuthToken object

[ERROR] DO NOT: return mergedToken  // Returns refresh_token to inner process
[OK]    DO: return sanitizeTokenForProxy(mergedToken)

[ERROR] DO NOT: if (error.status === 401) { retry() }  // Auth errors should not retry
[OK]    DO: if (isTransientError(error)) { retry() } else { throw }
```

## Pseudocode

```
 10: CLASS RefreshCoordinator
 11:   PRIVATE tokenStore: KeyringTokenStore
 12:   PRIVATE providers: Map<string, OAuthProvider>
 13:   PRIVATE rateLimitMap: Map<string, number>  // provider:bucket → last refresh timestamp
 14:   PRIVATE RATE_LIMIT_COOLDOWN = 30_000  // 30 seconds in ms
 15:   PRIVATE MAX_RETRIES = 2
 16:   PRIVATE RETRY_DELAYS = [1000, 3000]  // 1s, 3s exponential backoff
 17:
 18:   CONSTRUCTOR(tokenStore, providers)
 19:     STORE tokenStore, providers
 20:     SET rateLimitMap = new Map()
 21:
 22:   ASYNC METHOD handleRefreshToken(provider: string, bucket?: string): SanitizedOAuthToken
 23:     LET key = `${provider}:${bucket ?? 'default'}`
 24:
 25:     // Step 1: Check rate limit
 26:     LET lastRefresh = rateLimitMap.get(key) ?? 0
 27:     LET elapsed = Date.now() - lastRefresh
 28:     IF elapsed < RATE_LIMIT_COOLDOWN
 29:       // Within cooldown — check if current token is still valid
 30:       LET current = AWAIT tokenStore.getToken(provider, bucket)
 31:       IF current === null
 32:         THROW NOT_FOUND
 33:       IF current.expiry > (Date.now() / 1000)
 34:         RETURN sanitizeTokenForProxy(current)  // Token still valid, return it
 35:       ELSE
 36:         LET retryAfter = Math.ceil((RATE_LIMIT_COOLDOWN - elapsed) / 1000)
 37:         THROW RATE_LIMITED with { retryAfter }
 38:
 39:     // Step 2: Read full token (including refresh_token)
 40:     LET token = AWAIT tokenStore.getToken(provider, bucket)
 41:     IF token === null
 42:       THROW NOT_FOUND
 43:     IF NOT token.refresh_token
 44:       THROW error "Cannot refresh: no refresh_token stored"
 45:
 46:     // Step 3: Acquire lock
 47:     LET locked = AWAIT tokenStore.acquireRefreshLock(provider, { bucket })
 48:     IF NOT locked
 49:       THROW INTERNAL_ERROR "Could not acquire refresh lock"
 50:
 51:     TRY
 52:       // Step 4: Double-check after acquiring lock
 53:       LET reread = AWAIT tokenStore.getToken(provider, bucket)
 54:       IF reread AND reread.expiry > (Date.now() / 1000) + 60
 55:         // Another process already refreshed — token is valid
 56:         RETURN sanitizeTokenForProxy(reread)
 57:
 58:       // Step 5: Get provider and refresh
 59:       LET providerInstance = providers.get(provider)
 60:       IF NOT providerInstance
 61:         THROW PROVIDER_NOT_FOUND
 62:
 63:       LET newToken: OAuthToken | null = null
 64:
 65:       // Step 5a: Gemini exception — use OAuth2Client path
 66:       IF provider === 'gemini'
 67:         newToken = AWAIT refreshGeminiToken(reread ?? token)
 68:       ELSE
 69:         newToken = AWAIT refreshWithRetry(providerInstance, reread ?? token)
 70:
 71:       IF newToken === null
 72:         THROW INTERNAL_ERROR "Refresh returned null"
 73:
 74:       // Step 6: Merge new token with stored
 75:       LET stored = reread ?? token
 76:       LET merged = mergeRefreshedToken(stored, newToken)
 77:
 78:       // Step 7: Save merged token
 79:       AWAIT tokenStore.saveToken(provider, merged, bucket)
 80:
 81:       // Step 8: Update rate limit timestamp
 82:       rateLimitMap.set(key, Date.now())
 83:
 84:       // Step 9: Return sanitized
 85:       RETURN sanitizeTokenForProxy(merged)
 86:
 87:     FINALLY
 88:       // Step 10: Release lock
 89:       AWAIT tokenStore.releaseRefreshLock(provider, bucket)
 90:
 91:   ASYNC METHOD refreshWithRetry(provider: OAuthProvider, token: OAuthToken): OAuthToken
 92:     FOR attempt = 0 TO MAX_RETRIES
 93:       TRY
 94:         LET result = AWAIT provider.refreshToken(token)
 95:         RETURN result
 96:       CATCH error
 97:         IF isAuthError(error)  // 401, invalid_grant
 98:           THROW error  // No retry for auth errors — force re-auth
 99:         IF attempt < MAX_RETRIES
100:           AWAIT sleep(RETRY_DELAYS[attempt])
101:         ELSE
102:           THROW INTERNAL_ERROR "Refresh failed after ${MAX_RETRIES + 1} attempts"
103:
104:   ASYNC METHOD refreshGeminiToken(storedToken: OAuthToken): OAuthToken
105:     // Gemini uses google-auth-library's OAuth2Client internal refresh
106:     CREATE client = new OAuth2Client(clientId, clientSecret, redirectUri)
107:     CALL client.setCredentials({
108:       access_token: storedToken.access_token,
109:       refresh_token: storedToken.refresh_token,
110:       expiry_date: storedToken.expiry * 1000,  // OAuthToken.expiry (s) → Credentials.expiry_date (ms)
111:       token_type: storedToken.token_type ?? 'Bearer'
112:     })
113:     CALL client.getAccessToken()  // Triggers internal refresh
114:     LET credentials = client.credentials
115:     // Convert Credentials → OAuthToken
116:     RETURN {
117:       access_token: credentials.access_token,
118:       expiry: Math.floor(credentials.expiry_date / 1000),
119:       token_type: credentials.token_type ?? 'Bearer',
120:       refresh_token: credentials.refresh_token ?? storedToken.refresh_token,
121:       scope: credentials.scope ?? storedToken.scope
122:     }
123:
124:   METHOD isAuthError(error: unknown): boolean
125:     IF error has status 401 → RETURN true
126:     IF error has code 'invalid_grant' → RETURN true
127:     RETURN false
128:
129:   METHOD isTransientError(error: unknown): boolean
130:     IF error is network error (ECONNREFUSED, ETIMEDOUT, etc.) → RETURN true
131:     IF error has status >= 500 → RETURN true
132:     RETURN false
```
