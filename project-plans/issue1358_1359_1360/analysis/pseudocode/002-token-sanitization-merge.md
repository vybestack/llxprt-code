# Pseudocode: Token Sanitization & Merge

Plan ID: PLAN-20250214-CREDPROXY
Component: `packages/core/src/auth/token-sanitization.ts`, `packages/core/src/auth/token-merge.ts`

---

## Contract

### Inputs
```typescript
interface OAuthToken {
  access_token: string;
  expiry: number;
  token_type: string;
  refresh_token?: string;
  scope?: string;
  [key: string]: unknown; // Provider-specific fields (account_id, id_token, resource_url)
}

type OAuthTokenWithExtras = OAuthToken & Record<string, unknown>;
```

### Outputs
```typescript
type SanitizedOAuthToken = Omit<OAuthToken, 'refresh_token'> & Record<string, unknown>;
```

### Dependencies (NEVER stubbed)
- None — pure functions with no external dependencies

---

## Integration Points

- Line 5: Called by `CredentialProxyServer` for ALL socket-crossing token responses
- Line 20: Called by `CredentialProxyServer.refresh_token` handler and `OAuthManager`
- Both functions imported from `packages/core/src/auth/`

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Delete refresh_token in place (mutate the token object)
[OK]    DO: Destructure to create a new object without refresh_token

[ERROR] DO NOT: Create multiple sanitization functions for different operations
[OK]    DO: Use a SINGLE sanitizeTokenForProxy function for ALL socket-crossing tokens

[ERROR] DO NOT: Merge by mutating the stored token
[OK]    DO: Create a new merged object via spread
```

---

## Pseudocode: Token Sanitization

```
 1: FUNCTION sanitizeTokenForProxy(token: OAuthToken): SanitizedOAuthToken
 2:   DESTRUCTURE { refresh_token, ...sanitized } FROM token
 3:   // refresh_token is discarded; spread preserves ALL other fields
 4:   // including provider-specific fields (account_id, id_token, resource_url)
 5:   RETURN sanitized
```

## Pseudocode: Token Merge (extracted from OAuthManager)

```
 6: // NOTE: Extracted from oauth-manager.ts lines 78-99
 7: // Both OAuthManager and CredentialProxyServer import this
 8:
 9: FUNCTION mergeRefreshedToken(
10:   currentToken: OAuthTokenWithExtras,
11:   newToken: Partial<OAuthTokenWithExtras>
12: ): OAuthTokenWithExtras
13:
14:   // Start with current as base, overlay new fields
15:   SET merged = { ...currentToken, ...newToken }
16:
17:   // Preserve existing refresh_token if new is missing or empty
18:   IF newToken.refresh_token IS undefined OR newToken.refresh_token IS ''
19:     SET merged.refresh_token = currentToken.refresh_token
20:
21:   // access_token and expiry ALWAYS use new value (guaranteed by spread)
22:   // scope, token_type, resource_url: new if provided (spread handles this)
23:   // Provider-specific fields: new if provided (spread handles this)
24:
25:   RETURN merged
```

## Pseudocode: Incoming Token Sanitization (save_token handler)

```
26: // Used by save_token handler to strip refresh_token from INCOMING payloads
27: // before merging with stored token
28:
29: FUNCTION stripRefreshTokenFromPayload(token: Record<string, unknown>): Record<string, unknown>
30:   DESTRUCTURE { refresh_token, ...cleaned } FROM token
31:   RETURN cleaned
```

## Pseudocode: Gemini Credentials Conversion

```
32: // Converts google-auth-library Credentials to OAuthToken format
33: // Used in: oauth_exchange handler (Gemini login), refresh_token handler (Gemini refresh)
34:
35: FUNCTION convertGeminiCredentials(credentials: Credentials): OAuthToken
36:   RETURN {
37:     access_token: credentials.access_token!,
38:     // CRITICAL: expiry_date is milliseconds; expiry is seconds
39:     expiry: Math.floor(credentials.expiry_date! / 1000),
40:     token_type: credentials.token_type ?? 'Bearer',
41:     refresh_token: credentials.refresh_token ?? undefined,
42:     scope: credentials.scope ?? undefined,
43:   }
```
