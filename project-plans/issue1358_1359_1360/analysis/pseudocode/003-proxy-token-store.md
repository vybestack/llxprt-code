# Pseudocode: ProxyTokenStore

Plan ID: PLAN-20250214-CREDPROXY
Component: `packages/core/src/auth/proxy/proxy-token-store.ts`

---

## Contract

### Inputs
```typescript
// Implements TokenStore interface from packages/core/src/auth/token-store.ts
interface TokenStore {
  saveToken(provider: string, token: OAuthToken, bucket?: string): Promise<void>;
  getToken(provider: string, bucket?: string): Promise<OAuthToken | null>;
  removeToken(provider: string, bucket?: string): Promise<void>;
  listProviders(): Promise<string[]>;
  listBuckets(provider: string): Promise<string[]>;
  getBucketStats(provider: string, bucket: string): Promise<BucketStats | null>;
  acquireRefreshLock(provider: string, options?: { bucket?: string; staleMs?: number }): Promise<boolean>;
  releaseRefreshLock(provider: string, bucket?: string): Promise<void>;
}
```

### Outputs
- Same as TokenStore interface — returns/throws same types as KeyringTokenStore

### Dependencies (NEVER stubbed)
```typescript
import { ProxySocketClient } from './proxy-socket-client.js'; // Real socket client
```

---

## Integration Points

- Line 8: Uses `ProxySocketClient.request()` for ALL operations
- Line 53: Translates proxy error codes to KeyringTokenStore-compatible error semantics
- Instantiation: Created by `createTokenStore()` factory when `LLXPRT_CREDENTIAL_SOCKET` is set

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Implement refresh logic in ProxyTokenStore
[OK]    DO: Lock methods are no-ops; refresh goes through refresh_token proxy operation

[ERROR] DO NOT: Create a new socket connection per method call
[OK]    DO: Share a single ProxySocketClient instance

[ERROR] DO NOT: Auto-reconnect on connection error
[OK]    DO: Throw hard error on connection loss
```

---

## Pseudocode

```
 1: CLASS ProxyTokenStore IMPLEMENTS TokenStore
 2:   STATE client: ProxySocketClient
 3:
 4:   CONSTRUCTOR(socketPath: string)
 5:     SET this.client = new ProxySocketClient(socketPath)
 6:
 7:   METHOD async getToken(provider: string, bucket?: string): Promise<OAuthToken | null>
 8:     SET response = AWAIT this.client.request('get_token', { provider, bucket })
 9:     IF response.ok IS false
10:       IF response.code === 'NOT_FOUND'
11:         RETURN null
12:       CALL this.handleError(response)
13:     RETURN response.data as OAuthToken  // Already sanitized by server
14:
15:   METHOD async saveToken(provider: string, token: OAuthToken, bucket?: string): Promise<void>
16:     SET response = AWAIT this.client.request('save_token', { provider, bucket, token })
17:     IF response.ok IS false
18:       CALL this.handleError(response)
19:
20:   METHOD async removeToken(provider: string, bucket?: string): Promise<void>
21:     SET response = AWAIT this.client.request('remove_token', { provider, bucket })
22:     IF response.ok IS false
23:       IF response.code === 'NOT_FOUND'
24:         RETURN  // Best-effort, same as KeyringTokenStore
25:       CALL this.handleError(response)
26:
27:   METHOD async listProviders(): Promise<string[]>
28:     SET response = AWAIT this.client.request('list_providers', {})
29:     IF response.ok IS false
30:       CALL this.handleError(response)
31:     RETURN response.data.providers
32:
33:   METHOD async listBuckets(provider: string): Promise<string[]>
34:     SET response = AWAIT this.client.request('list_buckets', { provider })
35:     IF response.ok IS false
36:       CALL this.handleError(response)
37:     RETURN response.data.buckets
38:
39:   METHOD async getBucketStats(provider: string, bucket: string): Promise<BucketStats | null>
40:     // Implemented via get_token round-trip (no dedicated proxy operation)
41:     SET response = AWAIT this.client.request('get_token', { provider, bucket })
42:     IF response.ok IS false
43:       IF response.code === 'NOT_FOUND'
44:         RETURN null
45:       CALL this.handleError(response)
46:     // Return placeholder stats matching KeyringTokenStore.getBucketStats() behavior
47:     RETURN { bucket, requestCount: 0, percentage: 0, lastUsed: undefined }
48:
49:   METHOD async acquireRefreshLock(provider: string, options?: object): Promise<boolean>
50:     RETURN true  // No-op: refresh coordination happens on host
51:
52:   METHOD async releaseRefreshLock(provider: string, bucket?: string): Promise<void>
53:     // No-op: refresh coordination happens on host
54:
55:   METHOD handleError(response: ProxyResponse): never
56:     IF response.code === 'UNAUTHORIZED'
57:       THROW Error('Provider not available for this profile: ' + response.error)
58:     IF response.code === 'RATE_LIMITED'
59:       THROW Error('Rate limited. Retry after ' + response.retryAfter + 's')
60:     IF response.code === 'INTERNAL_ERROR'
61:       THROW Error(response.error || 'Host-side operation failed')
62:     THROW Error('Proxy error [' + response.code + ']: ' + response.error)
63:
64:   METHOD getClient(): ProxySocketClient
65:     RETURN this.client  // Shared by ProxyOAuthAdapter and ProxyProviderKeyStorage
66:
67:   METHOD async close(): Promise<void>
68:     this.client.close()
```
