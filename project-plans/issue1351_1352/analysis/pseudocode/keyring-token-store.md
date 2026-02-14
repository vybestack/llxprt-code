# Pseudocode: KeyringTokenStore

Plan ID: `PLAN-20260213-KEYRINGTOKENSTORE`
Component: `packages/core/src/auth/keyring-token-store.ts`

---

## Interface Contracts

### Inputs this component receives:

```typescript
// Constructor input
interface KeyringTokenStoreOptions {
  secureStore?: SecureStore;  // Optional injection for testing
}

// Method inputs — all from TokenStore interface
// saveToken(provider: string, token: OAuthToken, bucket?: string): Promise<void>
// getToken(provider: string, bucket?: string): Promise<OAuthToken | null>
// removeToken(provider: string, bucket?: string): Promise<void>
// listProviders(): Promise<string[]>
// listBuckets(provider: string): Promise<string[]>
// getBucketStats(provider: string, bucket: string): Promise<BucketStats | null>
// acquireRefreshLock(provider: string, options?: { waitMs?: number; staleMs?: number; bucket?: string }): Promise<boolean>
// releaseRefreshLock(provider: string, bucket?: string): Promise<void>
```

### Outputs this component produces:

```typescript
// saveToken → void (or throws SecureStoreError)
// getToken → OAuthToken | null (corrupt → null with warning log)
// removeToken → void (errors swallowed, logged)
// listProviders → string[] (sorted, unique providers; empty on error)
// listBuckets → string[] (sorted buckets for provider; empty on error)
// getBucketStats → BucketStats | null
// acquireRefreshLock → boolean (true = acquired, false = timeout)
// releaseRefreshLock → void (idempotent)
```

### Dependencies this component requires (NEVER stubbed):

```typescript
interface Dependencies {
  secureStore: SecureStore;         // Real dependency, injected or constructed
  OAuthTokenSchema: z.ZodObject;   // From packages/core/src/auth/types.ts
  crypto: NodeCrypto;              // For SHA-256 hashing in warning logs
  fs: NodeFS;                      // For lock file operations
  DebugLogger: DebugLogger;        // For warning/debug logging
}
```

---

## Pseudocode

### Constants and Constructor

```
1:  CONSTANT SERVICE_NAME = 'llxprt-code-oauth'
2:  CONSTANT NAME_REGEX = /^[a-zA-Z0-9_-]+$/
3:  CONSTANT DEFAULT_BUCKET = 'default'
4:  CONSTANT LOCK_DIR = path.join(homedir(), '.llxprt', 'oauth', 'locks')
5:  CONSTANT DEFAULT_LOCK_WAIT_MS = 10000
6:  CONSTANT DEFAULT_STALE_THRESHOLD_MS = 30000
7:  CONSTANT LOCK_POLL_INTERVAL_MS = 100
8:
9:  CLASS KeyringTokenStore IMPLEMENTS TokenStore
10:   FIELD secureStore: SecureStore
11:   FIELD logger: DebugLogger
12:
13:   CONSTRUCTOR(options?: { secureStore?: SecureStore })
14:     IF options?.secureStore IS provided
15:       SET this.secureStore = options.secureStore
16:     ELSE
17:       SET this.secureStore = NEW SecureStore(SERVICE_NAME, {
18:         fallbackDir: path.join(homedir(), '.llxprt', 'secure-store', SERVICE_NAME),
19:         fallbackPolicy: 'allow'
20:       })
21:     END IF
22:     SET this.logger = NEW DebugLogger('llxprt:keyring-token-store')
23:   END CONSTRUCTOR
```

### Name Validation

```
24:   PRIVATE METHOD validateName(name: string, label: string): void
25:     IF NOT NAME_REGEX.test(name)
26:       THROW Error("Invalid {label} name: \"{name}\". Allowed: letters, numbers, dashes, underscores.")
27:     END IF
28:   END METHOD
```

### Account Key Formation

```
29:   PRIVATE METHOD accountKey(provider: string, bucket?: string): string
30:     SET resolvedBucket = bucket ?? DEFAULT_BUCKET
31:     CALL this.validateName(provider, 'provider')
32:     CALL this.validateName(resolvedBucket, 'bucket')
33:     RETURN "{provider}:{resolvedBucket}"
34:   END METHOD
```

### SHA-256 Hashing for Logs

```
35:   PRIVATE METHOD hashIdentifier(accountKey: string): string
36:     RETURN crypto.createHash('sha256').update(accountKey).digest('hex').substring(0, 16)
37:   END METHOD
```

### saveToken

```
38:   ASYNC METHOD saveToken(provider: string, token: OAuthToken, bucket?: string): Promise<void>
39:     SET key = CALL this.accountKey(provider, bucket)
40:     SET validatedToken = OAuthTokenSchema.passthrough().parse(token)
41:     SET serialized = JSON.stringify(validatedToken)
42:     AWAIT this.secureStore.set(key, serialized)
43:     // SecureStoreError propagates: UNAVAILABLE, LOCKED, DENIED, TIMEOUT
44:   END METHOD
```

### getToken

```
45:   ASYNC METHOD getToken(provider: string, bucket?: string): Promise<OAuthToken | null>
46:     SET key = CALL this.accountKey(provider, bucket)
47:
48:     TRY
49:       SET raw = AWAIT this.secureStore.get(key)
50:     CATCH error
51:       IF error IS SecureStoreError AND error.code IS 'CORRUPT'
52:         CALL this.logger.warn("Corrupt token envelope for [{hashIdentifier(key)}]: {error.message}")
53:         RETURN null
54:       END IF
55:       // UNAVAILABLE, LOCKED, DENIED, TIMEOUT → propagate
56:       THROW error
57:     END TRY
58:
59:     IF raw IS null
60:       RETURN null
61:     END IF
62:
63:     TRY
64:       SET parsed = JSON.parse(raw)
65:     CATCH parseError
66:       CALL this.logger.warn("Corrupt token JSON for [{hashIdentifier(key)}]: {parseError.message}")
67:       RETURN null
68:     END TRY
69:
70:     TRY
71:       SET validatedToken = OAuthTokenSchema.passthrough().parse(parsed)
72:       RETURN validatedToken
73:     CATCH zodError
74:       CALL this.logger.warn("Invalid token schema for [{hashIdentifier(key)}]: {zodError.message}")
75:       RETURN null
76:     END TRY
77:   END METHOD
```

### removeToken

```
78:   ASYNC METHOD removeToken(provider: string, bucket?: string): Promise<void>
79:     SET key = CALL this.accountKey(provider, bucket)
80:     TRY
81:       AWAIT this.secureStore.delete(key)
82:     CATCH error
83:       CALL this.logger.warn("Failed to remove token for [{hashIdentifier(key)}]: {error.message}")
84:       // Best-effort — do not propagate
85:     END TRY
86:   END METHOD
```

### listProviders

```
87:   ASYNC METHOD listProviders(): Promise<string[]>
88:     TRY
89:       SET allKeys = AWAIT this.secureStore.list()
90:       SET providerSet = NEW Set<string>()
91:       FOR EACH key IN allKeys
92:         IF key.includes(':')
93:           SET provider = key.split(':')[0]
94:           providerSet.add(provider)
95:         END IF
96:       END FOR
97:       RETURN Array.from(providerSet).sort()
98:     CATCH error
99:       CALL this.logger.warn("Failed to list providers: {error.message}")
100:      RETURN []
101:    END TRY
102:  END METHOD
```

### listBuckets

```
103:  ASYNC METHOD listBuckets(provider: string): Promise<string[]>
104:    TRY
105:      SET allKeys = AWAIT this.secureStore.list()
106:      SET prefix = "{provider}:"
107:      SET buckets: string[] = []
108:      FOR EACH key IN allKeys
109:        IF key.startsWith(prefix)
110:          SET bucket = key.substring(prefix.length)
111:          buckets.push(bucket)
112:        END IF
113:      END FOR
114:      RETURN buckets.sort()
115:    CATCH error
116:      CALL this.logger.warn("Failed to list buckets for [{hashIdentifier(provider + ':')}]: {error.message}")
117:      RETURN []
118:    END TRY
119:  END METHOD
```

### getBucketStats

```
120:  ASYNC METHOD getBucketStats(provider: string, bucket: string): Promise<BucketStats | null>
121:    // Validation happens inside getToken via accountKey
122:    SET token = AWAIT this.getToken(provider, bucket)
123:    IF token IS null
124:      RETURN null
125:    END IF
126:    RETURN {
127:      bucket: bucket,
128:      requestCount: 0,
129:      percentage: 0,
130:      lastUsed: undefined
131:    }
132:  END METHOD
```

### Lock File Path

```
133:  PRIVATE METHOD lockFilePath(provider: string, bucket?: string): string
134:    SET resolvedBucket = bucket ?? DEFAULT_BUCKET
135:    IF resolvedBucket IS DEFAULT_BUCKET
136:      RETURN path.join(LOCK_DIR, "{provider}-refresh.lock")
137:    ELSE
138:      RETURN path.join(LOCK_DIR, "{provider}-{resolvedBucket}-refresh.lock")
139:    END IF
140:  END METHOD
```

### Ensure Lock Directory

```
141:  PRIVATE ASYNC METHOD ensureLockDir(): Promise<void>
142:    AWAIT fs.mkdir(LOCK_DIR, { recursive: true, mode: 0o700 })
143:  END METHOD
```

### acquireRefreshLock

```
144:  ASYNC METHOD acquireRefreshLock(provider: string, options?: { waitMs?: number; staleMs?: number; bucket?: string }): Promise<boolean>
145:    IF options?.bucket IS provided
146:      CALL this.validateName(options.bucket, 'bucket')
147:    END IF
148:    CALL this.validateName(provider, 'provider')
149:
150:    SET lockPath = CALL this.lockFilePath(provider, options?.bucket)
151:    SET waitMs = options?.waitMs ?? DEFAULT_LOCK_WAIT_MS
152:    SET staleMs = options?.staleMs ?? DEFAULT_STALE_THRESHOLD_MS
153:    SET startTime = Date.now()
154:
155:    AWAIT this.ensureLockDir()
156:
157:    LOOP WHILE (Date.now() - startTime) < waitMs
158:      TRY
159:        // Attempt exclusive write
160:        SET lockInfo = { pid: process.pid, timestamp: Date.now() }
161:        AWAIT fs.writeFile(lockPath, JSON.stringify(lockInfo), { flag: 'wx', mode: 0o600 })
162:        RETURN true  // Lock acquired
163:      CATCH writeError
164:        IF writeError.code IS NOT 'EEXIST'
165:          THROW writeError  // Unexpected error
166:        END IF
167:      END TRY
168:
169:      // Lock file exists — read it
170:      TRY
171:        SET content = AWAIT fs.readFile(lockPath, 'utf8')
172:        SET existing = JSON.parse(content)
173:        SET lockAge = Date.now() - existing.timestamp
174:
175:        IF lockAge > staleMs
176:          // Stale lock — break it
177:          TRY
178:            AWAIT fs.unlink(lockPath)
179:          CATCH unlinkError
180:            // Ignore ENOENT (another process may have broken it)
181:          END TRY
182:          CONTINUE  // Retry acquisition
183:        END IF
184:      CATCH readError
185:        // Lock file unreadable or corrupt — break it
186:        TRY
187:          AWAIT fs.unlink(lockPath)
188:        CATCH unlinkError
189:          // Ignore ENOENT
190:        END TRY
191:        CONTINUE  // Retry acquisition
192:      END TRY
193:
194:      // Lock is fresh — wait and retry
195:      AWAIT sleep(LOCK_POLL_INTERVAL_MS)
196:    END LOOP
197:
198:    RETURN false  // Timeout
199:  END METHOD
```

### releaseRefreshLock

```
200:  ASYNC METHOD releaseRefreshLock(provider: string, bucket?: string): Promise<void>
201:    CALL this.validateName(provider, 'provider')
202:    IF bucket IS provided
203:      CALL this.validateName(bucket, 'bucket')
204:    END IF
205:    SET lockPath = CALL this.lockFilePath(provider, bucket)
206:    TRY
207:      AWAIT fs.unlink(lockPath)
208:    CATCH error
209:      IF error.code IS NOT 'ENOENT'
210:        THROW error
211:      END IF
212:      // ENOENT is fine — release is idempotent
213:    END TRY
214:  END METHOD
215: END CLASS
```

---

## Integration Points (Line-by-Line)

| Line(s) | Call | Notes |
|---|---|---|
| 17-20 | `new SecureStore(SERVICE_NAME, {...})` | Only when no injected instance. Must match ProviderKeyStorage pattern. |
| 22 | `new DebugLogger('llxprt:keyring-token-store')` | For warning logs. Must use existing DebugLogger from project. |
| 25 | `NAME_REGEX.test(name)` | Validation before any storage operation. |
| 36 | `crypto.createHash('sha256')` | For log-safe identifier hashing. |
| 40 | `OAuthTokenSchema.passthrough().parse(token)` | MUST use `.passthrough()` — preserves Codex fields. Import from `../auth/types.js`. |
| 42 | `this.secureStore.set(key, serialized)` | Delegates to SecureStore. Error propagates. |
| 49 | `this.secureStore.get(key)` | Returns `string | null`. SecureStore handles keyring+fallback internally. |
| 51 | Check `SecureStoreError.code` | Must import `SecureStoreError` from `../storage/secure-store.js`. |
| 71 | `OAuthTokenSchema.passthrough().parse(parsed)` | Second validation on read path. Same `.passthrough()` requirement. |
| 81 | `this.secureStore.delete(key)` | Returns `boolean`, but we ignore it. Errors caught. |
| 89 | `this.secureStore.list()` | Returns `string[]` of all account keys for this service. |
| 142 | `fs.mkdir(LOCK_DIR, { recursive: true, mode: 0o700 })` | Lock dir created on demand. |
| 161 | `fs.writeFile(lockPath, ..., { flag: 'wx' })` | Exclusive create — fails with EEXIST if file exists. |

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: OAuthTokenSchema.parse(token)                    // Strips extra fields
[OK]    DO:     OAuthTokenSchema.passthrough().parse(token)       // Preserves Codex account_id, id_token

[ERROR] DO NOT: console.warn(`Corrupt token for ${provider}:${bucket}`)   // Leaks provider name
[OK]    DO:     this.logger.warn(`Corrupt token for [${hashIdentifier(key)}]`)  // SHA-256 hash only

[ERROR] DO NOT: await this.secureStore.delete(key) in getToken    // Don't delete corrupt data
[OK]    DO:     return null after logging warning                  // Preserve for inspection

[ERROR] DO NOT: throw error in removeToken                        // Deletion is best-effort
[OK]    DO:     catch and log, return normally                     // User sees logout succeed

[ERROR] DO NOT: throw error in listProviders/listBuckets          // Lists degrade gracefully
[OK]    DO:     catch and return []                                // UI stays functional

[ERROR] DO NOT: new MultiProviderTokenStore() anywhere             // Legacy class
[OK]    DO:     new KeyringTokenStore() or inject via constructor  // New implementation

[ERROR] DO NOT: use {provider}-{bucket} format for SecureStore keys  // Ambiguous with lock files
[OK]    DO:     use {provider}:{bucket} for SecureStore account keys  // Colon separator

[ERROR] DO NOT: store lock files in ~/.llxprt/oauth/ root           // Mix with inert data
[OK]    DO:     store lock files in ~/.llxprt/oauth/locks/          // Dedicated subdirectory

[ERROR] DO NOT: validate provider/bucket AFTER storage operation    // Side effects before validation
[OK]    DO:     validate in accountKey() BEFORE any storage call    // Fail fast

[ERROR] DO NOT: fire-and-forget lock directory creation             // Race condition
[OK]    DO:     AWAIT ensureLockDir() before lock operations        // Guaranteed exists
```
