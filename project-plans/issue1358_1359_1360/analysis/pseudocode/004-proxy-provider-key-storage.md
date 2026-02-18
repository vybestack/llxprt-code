# Pseudocode: ProxyProviderKeyStorage

Plan ID: PLAN-20250214-CREDPROXY
Component: `packages/core/src/auth/proxy/proxy-provider-key-storage.ts`

---

## Contract

### Inputs
```typescript
// Implements extracted ProviderKeyStorageInterface
interface ProviderKeyStorageInterface {
  getKey(name: string): Promise<string | null>;
  listKeys(): Promise<string[]>;
  hasKey(name: string): Promise<boolean>;
  saveKey(name: string, apiKey: string): Promise<void>;
  deleteKey(name: string): Promise<void>;
}
```

### Outputs
- Same as ProviderKeyStorage for read operations
- Throws for write operations (saveKey, deleteKey)

### Dependencies (NEVER stubbed)
```typescript
import { ProxySocketClient } from './proxy-socket-client.js'; // Real socket client
```

---

## Integration Points

- Line 3: Shares `ProxySocketClient` with `ProxyTokenStore` via constructor injection
- Instantiation: Created by `createProviderKeyStorage()` factory when `LLXPRT_CREDENTIAL_SOCKET` is set
- Prerequisite: `ProviderKeyStorageInterface` must be extracted from concrete `ProviderKeyStorage` class

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Silently ignore saveKey/deleteKey calls in proxy mode
[OK]    DO: Throw with actionable error message directing user to manage keys on host

[ERROR] DO NOT: Create a new socket client (reuse the one from ProxyTokenStore)
[OK]    DO: Accept ProxySocketClient in constructor
```

---

## Pseudocode

```
 1: CLASS ProxyProviderKeyStorage IMPLEMENTS ProviderKeyStorageInterface
 2:   STATE client: ProxySocketClient
 3:
 4:   CONSTRUCTOR(client: ProxySocketClient)
 5:     SET this.client = client
 6:
 7:   METHOD async getKey(name: string): Promise<string | null>
 8:     SET response = AWAIT this.client.request('get_api_key', { name })
 9:     IF response.ok IS false
10:       IF response.code === 'NOT_FOUND'
11:         RETURN null
12:       THROW Error('Proxy error [' + response.code + ']: ' + response.error)
13:     RETURN response.data.key
14:
15:   METHOD async listKeys(): Promise<string[]>
16:     SET response = AWAIT this.client.request('list_api_keys', {})
17:     IF response.ok IS false
18:       THROW Error('Proxy error [' + response.code + ']: ' + response.error)
19:     RETURN response.data.keys
20:
21:   METHOD async hasKey(name: string): Promise<boolean>
22:     SET result = AWAIT this.getKey(name)
23:     RETURN result IS NOT null
24:
25:   METHOD async saveKey(name: string, apiKey: string): Promise<void>
26:     THROW Error('API key management is not available in sandbox mode. Manage keys on the host.')
27:
28:   METHOD async deleteKey(name: string): Promise<void>
29:     THROW Error('API key management is not available in sandbox mode. Manage keys on the host.')
```
