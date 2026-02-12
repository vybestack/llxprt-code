# Pseudocode: SecureStore

Plan ID: PLAN-20260211-SECURESTORE
Requirements: R1, R2, R3, R4, R5, R6, R7B, R8

---

## Interface Contracts

```typescript
// INPUTS this component receives:
interface SecureStoreOptions {
  fallbackDir?: string;           // Directory for AES-256-GCM fallback files
  fallbackPolicy?: 'allow' | 'deny'; // What to do when keyring unavailable
  keytarLoader?: () => Promise<KeytarAdapter | null>; // Injectable for testing
}

// OUTPUTS this component produces:
// set(): Promise<void> — stores value, throws on failure
// get(): Promise<string | null> — retrieves value or null
// delete(): Promise<boolean> — true if deleted, false if not found
// list(): Promise<string[]> — array of key names
// has(): Promise<boolean> — true if exists, throws on error (not NOT_FOUND)
// isKeychainAvailable(): Promise<boolean> — cached probe result

// DEPENDENCIES this component requires:
interface Dependencies {
  keytarAdapter: KeytarAdapter | null;  // Injected via keytarLoader, NEVER hardcoded
  fs: typeof import('node:fs/promises');  // Real filesystem, injected in tests via temp dirs
  crypto: typeof import('node:crypto');   // Real crypto, never mocked
  os: typeof import('node:os');           // For hostname/username in key derivation
}
```

---

## KeytarAdapter Interface

```
1:  INTERFACE KeytarAdapter
2:    METHOD getPassword(service: string, account: string) → Promise<string | null>
3:    METHOD setPassword(service: string, account: string, password: string) → Promise<void>
4:    METHOD deletePassword(service: string, account: string) → Promise<boolean>
5:    METHOD findCredentials?(service: string) → Promise<Array<{account, password}>>
6:  END INTERFACE
```

---

## SecureStore Error Class

```
7:   CLASS SecureStoreError EXTENDS Error
8:     PROPERTY code: 'UNAVAILABLE' | 'LOCKED' | 'DENIED' | 'CORRUPT' | 'TIMEOUT' | 'NOT_FOUND'
9:     PROPERTY remediation: string
10:    CONSTRUCTOR(message, code, remediation)
11:      CALL super(message)
12:      SET this.code = code
13:      SET this.remediation = remediation
14:      SET this.name = 'SecureStoreError'
15:    END CONSTRUCTOR
16:  END CLASS
```

---

## Constructor

```
17:  CLASS SecureStore
18:    PRIVATE serviceName: string
19:    PRIVATE fallbackDir: string
20:    PRIVATE fallbackPolicy: 'allow' | 'deny'
21:    PRIVATE keytarLoader: () → Promise<KeytarAdapter | null>
22:    PRIVATE keytarInstance: KeytarAdapter | null | undefined = undefined
23:    PRIVATE keytarLoadAttempted: boolean = false
24:    PRIVATE probeCache: { available: boolean, timestamp: number } | null = null
25:    PRIVATE PROBE_TTL_MS: number = 60000
25a:   PRIVATE consecutiveKeyringFailures: number = 0
25b:   PRIVATE KEYRING_FAILURE_THRESHOLD: number = 3  // Invalidate probe cache after N failures
26:
27:    CONSTRUCTOR(serviceName: string, options?: SecureStoreOptions)
28:      VALIDATE serviceName is non-empty string
29:      SET this.serviceName = serviceName
30:      SET this.fallbackDir = options?.fallbackDir ?? path.join(os.homedir(), '.llxprt', 'secure-store', serviceName)
31:      SET this.fallbackPolicy = options?.fallbackPolicy ?? 'allow'
32:      SET this.keytarLoader = options?.keytarLoader ?? defaultKeytarLoader
33:    END CONSTRUCTOR
```

---

## Keytar Loading (R1.1, R1.2, R1.3)

```
34:    PRIVATE ASYNC METHOD getKeytar() → KeytarAdapter | null
35:      IF this.keytarLoadAttempted THEN
36:        RETURN this.keytarInstance ?? null
37:      END IF
38:      SET this.keytarLoadAttempted = true
39:      TRY
40:        SET adapter = AWAIT this.keytarLoader()
41:        SET this.keytarInstance = adapter
42:        RETURN adapter
43:      CATCH error
44:        LOG debug: 'Failed to load keytar adapter', error.message
45:        SET this.keytarInstance = null
46:        RETURN null
47:      END TRY
48:    END METHOD
```

Integration point — Line 40: `this.keytarLoader()` MUST be injected, not hardcoded.

---

## Default Keytar Loader (R1.1, R1.2)

```
49:  ASYNC FUNCTION defaultKeytarLoader() → KeytarAdapter | null
50:    TRY
51:      SET module = AWAIT dynamic import('@napi-rs/keyring')
52:      SET keyring = module.default ?? module
53:      RETURN {
54:        getPassword: ASYNC (service, account) →
55:          SET entry = new keyring.AsyncEntry(service, account)
56:          RETURN AWAIT entry.getPassword()
57:        setPassword: ASYNC (service, account, password) →
58:          SET entry = new keyring.AsyncEntry(service, account)
59:          AWAIT entry.setPassword(password)
60:        deletePassword: ASYNC (service, account) →
61:          SET entry = new keyring.AsyncEntry(service, account)
62:          RETURN AWAIT entry.deleteCredential()
63:        findCredentials: ASYNC (service) →
64:          TRY
65:            SET creds = AWAIT keyring.findCredentials(service)
66:            RETURN creds
67:          CATCH
68:            RETURN []    // findCredentials may not be available
69:          END TRY
70:      }
71:    CATCH error
72:      IF error.code IN ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_DLOPEN_FAILED']
73:         OR error.message CONTAINS '@napi-rs/keyring'
74:      THEN
75:        LOG debug: 'Keyring module not available'
76:        RETURN null
77:      END IF
78:      LOG debug: 'Unexpected keytar load error', error
79:      RETURN null
80:    END TRY
81:  END FUNCTION
```

Anti-pattern warnings:
```
[ERROR] DO NOT: hardcode `require('@napi-rs/keyring')` — must use dynamic import
[OK]    DO: const module = await import('@napi-rs/keyring')

[ERROR] DO NOT: return a fake adapter when module is missing
[OK]    DO: return null to indicate keyring unavailable

[ERROR] DO NOT: catch all errors silently — log at debug level
[OK]    DO: catch, classify (module-not-found vs unexpected), log, return null
```

---

## Availability Probe (R2.1, R2.2, R2.3)

```
82:    PUBLIC ASYNC METHOD isKeychainAvailable() → boolean
83:      // Check cache (R2.2)
84:      IF this.probeCache IS NOT null THEN
85:        SET elapsed = Date.now() - this.probeCache.timestamp
86:        IF elapsed < this.PROBE_TTL_MS THEN
87:          RETURN this.probeCache.available
88:        END IF
89:      END IF
90:
91:      // Perform probe (R2.1)
92:      SET adapter = AWAIT this.getKeytar()
93:      IF adapter IS null THEN
94:        SET this.probeCache = { available: false, timestamp: Date.now() }
95:        RETURN false
96:      END IF
97:
98:      SET testAccount = '__securestore_probe__' + crypto.randomUUID().substring(0, 8)
99:      SET testValue = 'probe-' + Date.now()
100:     TRY
101:       AWAIT adapter.setPassword(this.serviceName, testAccount, testValue)
102:       SET retrieved = AWAIT adapter.getPassword(this.serviceName, testAccount)
103:       AWAIT adapter.deletePassword(this.serviceName, testAccount)
104:       SET available = (retrieved === testValue)
105:       SET this.probeCache = { available, timestamp: Date.now() }
106:       RETURN available
107:     CATCH error
108:       // Transient error → invalidate cache (R2.3)
109:       IF isTransientError(error) THEN
110:         SET this.probeCache = null
111:       ELSE
112:         SET this.probeCache = { available: false, timestamp: Date.now() }
113:       END IF
114:       RETURN false
115:     END TRY
116:   END METHOD
```

---

## CRUD: set() (R3.1a, R3.1b, R4.1, R4.2)

```
117:   PUBLIC ASYNC METHOD set(key: string, value: string) → void
118:     VALIDATE key is non-empty string
119:     VALIDATE value is string
120:     LOG debug: 'SecureStore.set', { service: this.serviceName, key: hashForLog(key) }
121:
122:     SET available = AWAIT this.isKeychainAvailable()
123:
124:     IF available THEN
125:       TRY
126:         SET adapter = AWAIT this.getKeytar()
127:         AWAIT adapter!.setPassword(this.serviceName, key, value)
128:         LOG debug: 'Stored in keyring', { key: hashForLog(key) }
128a:       SET this.consecutiveKeyringFailures = 0  // Reset on success
129:         RETURN
130:       CATCH error
131:         LOG debug: 'Keyring write failed, trying fallback', { error: error.message }
131a:       SET this.consecutiveKeyringFailures += 1
131b:       // Invalidate probe cache after repeated failures (mid-session keyring lock/unlock)
131c:       IF this.consecutiveKeyringFailures >= this.KEYRING_FAILURE_THRESHOLD THEN
131d:         SET this.probeCache = null
131e:         LOG debug: 'Probe cache invalidated after repeated keyring failures'
131f:       END IF
132:         // Fall through to fallback if policy allows (R7B.1)
133:       END TRY
134:     END IF
135:
136:     // Keyring unavailable or write failed — check fallback policy
137:     IF this.fallbackPolicy === 'deny' THEN
138:       THROW new SecureStoreError(
139:         'Keyring is unavailable and fallback is denied',
140:         'UNAVAILABLE',
141:         'Use --key, install a keyring backend, or change fallbackPolicy to allow'
142:       )
143:     END IF
144:
145:     // Write to fallback file (R4.1)
146:     AWAIT this.writeFallbackFile(key, value)
147:     LOG debug: 'Stored in fallback file', { key: hashForLog(key) }
148:   END METHOD
```

---

## CRUD: get() (R3.2, R3.3, R3.4, R3.5)

```
149:   PUBLIC ASYNC METHOD get(key: string) → string | null
150:     VALIDATE key is non-empty string
151:     LOG debug: 'SecureStore.get', { service: this.serviceName, key: hashForLog(key) }
152:
153:     // Try keyring first (R3.5 — keyring wins when both exist)
154:     SET adapter = AWAIT this.getKeytar()
155:     IF adapter IS NOT null THEN
156:       TRY
157:         SET value = AWAIT adapter.getPassword(this.serviceName, key)
158:         IF value IS NOT null THEN
159:           LOG debug: 'Found in keyring', { key: hashForLog(key) }
159a:         SET this.consecutiveKeyringFailures = 0  // Reset on success
160:           RETURN value
161:         END IF
162:       CATCH error
163:         LOG debug: 'Keyring read failed, trying fallback', { error: error.message }
163a:       SET this.consecutiveKeyringFailures += 1
163b:       IF this.consecutiveKeyringFailures >= this.KEYRING_FAILURE_THRESHOLD THEN
163c:         SET this.probeCache = null
163d:         LOG debug: 'Probe cache invalidated after repeated keyring failures'
163e:       END IF
164:         // Fall through to fallback
165:       END TRY
166:     END IF
167:
168:     // Try fallback file (R3.3)
169:     SET fallbackValue = AWAIT this.readFallbackFile(key)
170:     IF fallbackValue IS NOT null THEN
171:       LOG debug: 'Found in fallback file', { key: hashForLog(key) }
172:       RETURN fallbackValue
173:     END IF
174:
175:     // Not found anywhere (R3.4)
176:     LOG debug: 'Key not found', { key: hashForLog(key) }
177:     RETURN null
178:   END METHOD
```

---

## CRUD: delete() (R3.6)

```
179:   PUBLIC ASYNC METHOD delete(key: string) → boolean
180:     VALIDATE key is non-empty string
181:     LOG debug: 'SecureStore.delete', { service: this.serviceName, key: hashForLog(key) }
182:
183:     SET deletedFromKeyring = false
184:     SET deletedFromFile = false
185:
186:     // Delete from keyring
187:     SET adapter = AWAIT this.getKeytar()
188:     IF adapter IS NOT null THEN
189:       TRY
190:         SET deletedFromKeyring = AWAIT adapter.deletePassword(this.serviceName, key)
191:       CATCH error
192:         LOG debug: 'Keyring delete failed', { error: error.message }
193:       END TRY
194:     END IF
195:
196:     // Delete fallback file
197:     SET filePath = this.getFallbackFilePath(key)
198:     TRY
199:       AWAIT fs.unlink(filePath)
200:       SET deletedFromFile = true
201:     CATCH error
202:       IF error.code !== 'ENOENT' THEN
203:         LOG debug: 'Fallback file delete failed', { error: error.message }
204:       END IF
205:     END TRY
206:
207:     SET deleted = deletedFromKeyring OR deletedFromFile
208:     LOG debug: 'Delete result', { key: hashForLog(key), deleted }
209:     RETURN deleted
210:   END METHOD
```

---

## CRUD: list() (R3.7)

```
211:   PUBLIC ASYNC METHOD list() → string[]
212:     LOG debug: 'SecureStore.list', { service: this.serviceName }
213:
214:     SET keys = new Set<string>()
215:
216:     // Enumerate from keyring (if findCredentials available)
217:     SET adapter = AWAIT this.getKeytar()
218:     IF adapter IS NOT null AND adapter.findCredentials IS defined THEN
219:       TRY
220:         SET creds = AWAIT adapter.findCredentials(this.serviceName)
221:         FOR EACH cred IN creds
222:           IF NOT cred.account.startsWith('__securestore_probe__') THEN
223:             ADD cred.account TO keys
224:           END IF
225:         END FOR
226:       CATCH error
227:         LOG debug: 'Keyring enumeration failed', { error: error.message }
228:       END TRY
229:     END IF
230:
231:     // Enumerate from fallback directory
232:     TRY
233:       SET files = AWAIT fs.readdir(this.fallbackDir)
234:       FOR EACH file IN files
235:         IF file.endsWith('.enc') THEN
236:           SET keyName = file.slice(0, -4)  // Remove .enc suffix
237:           // Validate filename against key rules before including
238:           TRY
239:             CALL this.validateKey(keyName)
 240:             ADD keyName TO keys
 241:           CATCH
 242:             LOG debug: 'Skipping malformed fallback filename', { file }
 243:           END TRY
 244:         END IF
 245:       END FOR
 246:     CATCH error
 247:       IF error.code !== 'ENOENT' THEN
 248:         LOG debug: 'Fallback dir scan failed', { error: error.message }
 249:       END IF
 250:     END TRY
 251:
 252:     RETURN Array.from(keys).sort()
 253:   END METHOD
```

---

## CRUD: has() (R3.8)

```
 254:   PUBLIC ASYNC METHOD has(key: string) → boolean
 255:     VALIDATE key is non-empty string
 256:
 257:     // Try keyring first
 258:     SET adapter = AWAIT this.getKeytar()
 259:     IF adapter IS NOT null THEN
 260:       TRY
 261:         SET value = AWAIT adapter.getPassword(this.serviceName, key)
 262:         IF value IS NOT null THEN
 263:           RETURN true
 264:         END IF
 265:       CATCH error
 266:         // Rethrow non-NOT_FOUND errors (R3.8)
 267:         SET classified = classifyError(error)
 268:         IF classified !== 'NOT_FOUND' THEN
 269:           THROW new SecureStoreError(error.message, classified, getRemediation(classified))
 270:         END IF
 271:       END TRY
 272:     END IF
 273:
 274:     // Try fallback file
 275:     SET filePath = this.getFallbackFilePath(key)
 276:     TRY
 277:       AWAIT fs.access(filePath, fs.constants.F_OK)
 278:       RETURN true
 279:     CATCH
 280:       RETURN false
 281:     END TRY
 282:   END METHOD
```

---

## Encrypted File Fallback: Write (R4.3, R4.4, R4.5, R4.7, R4.8)

```
 283:   PRIVATE ASYNC METHOD writeFallbackFile(key: string, value: string) → void
 284:     // Ensure fallback directory exists (R4.8)
 285:     AWAIT fs.mkdir(this.fallbackDir, { recursive: true, mode: 0o700 })
 286:
 287:     // Derive encryption key (R4.3 — hostname + username HASH, not raw)
 288:     SET salt = crypto.randomBytes(16)
 289:     SET machineId = crypto.createHash('sha256').update(os.hostname() + os.userInfo().username).digest('hex')
 290:     SET kdfInput = this.serviceName + '-' + machineId
 291:     SET encKey = AWAIT scryptAsync(kdfInput, salt, 32, { N: 16384, r: 8, p: 1 })
 292:
 293:     // Encrypt with AES-256-GCM
 294:     SET iv = crypto.randomBytes(12)
 295:     SET cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv)
 296:     SET encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
 297:     SET authTag = cipher.getAuthTag()
 298:
 299:     // Build versioned envelope (R4.5)
 300:     SET ciphertext = Buffer.concat([salt, iv, authTag, encrypted])
 301:     SET envelope = {
 302:       v: 1,
 303:       crypto: { alg: 'aes-256-gcm', kdf: 'scrypt', N: 16384, r: 8, p: 1, saltLen: 16 },
 304:       data: ciphertext.toString('base64')
 305:     }
 306:
 307:     // Atomic write (R4.7)
 308:     SET finalPath = this.getFallbackFilePath(key)
 309:     SET tempPath = finalPath + '.tmp.' + crypto.randomUUID().substring(0, 8)
 310:     SET fd = AWAIT fs.open(tempPath, 'w', 0o600)
 311:     TRY
 312:       AWAIT fd.writeFile(JSON.stringify(envelope))
 313:       AWAIT fd.sync()                          // fsync (R4.7)
 314:       AWAIT fd.close()
 315:       AWAIT fs.rename(tempPath, finalPath)     // atomic rename (R4.7)
 316:       AWAIT fs.chmod(finalPath, 0o600)         // set permissions (R4.7)
 317:     CATCH error
 318:       AWAIT fd.close().catch(() => {})
 319:       AWAIT fs.unlink(tempPath).catch(() => {})  // cleanup temp file
 320:       THROW error
 321:     END TRY
 322:   END METHOD
```

---

## Encrypted File Fallback: Read (R4.5, R4.6, R5.1, R5.2)

```
 323:   PRIVATE ASYNC METHOD readFallbackFile(key: string) → string | null
 324:     SET filePath = this.getFallbackFilePath(key)
 325:
 326:     TRY
 327:       SET content = AWAIT fs.readFile(filePath, 'utf8')
 328:     CATCH error
 329:       IF error.code === 'ENOENT' THEN
 330:         RETURN null
 331:       END IF
 332:       THROW error
 333:     END TRY
 334:
 335:     // Parse envelope
 336:     TRY
 337:       SET envelope = JSON.parse(content)
 338:     CATCH
 339:       // Not valid JSON — could be legacy format (R5.2)
 340:       THROW new SecureStoreError(
 341:         'Fallback file is corrupt or uses an unrecognized format',
 342:         'CORRUPT',
 343:         'Re-save the key or re-authenticate'
 344:       )
 345:     END TRY
 346:
 347:     // Check envelope version (R4.6)
 348:     IF envelope.v !== 1 THEN
 349:       THROW new SecureStoreError(
 350:         'Unrecognized envelope version: ' + envelope.v + '. This file may require a newer version.',
 351:         'CORRUPT',
 352:         'Upgrade to the latest version or re-save the key'
 353:       )
 354:     END IF
 355:
 356:     // Validate envelope structure
 357:     IF NOT isValidEnvelope(envelope) THEN
 358:       THROW new SecureStoreError(
 359:         'Fallback file envelope is malformed',
 360:         'CORRUPT',
 361:         'Re-save the key or re-authenticate'
 362:       )
 363:     END IF
 364:
 365:     // Decrypt
 366:     SET ciphertext = Buffer.from(envelope.data, 'base64')
 367:     SET salt = ciphertext.subarray(0, 16)
 368:     SET iv = ciphertext.subarray(16, 28)
 369:     SET authTag = ciphertext.subarray(28, 44)
 370:     SET encrypted = ciphertext.subarray(44)
 371:
 372:     // Derive decryption key (same KDF params — R4.3 hostname + username HASH)
 373:     SET machineId = crypto.createHash('sha256').update(os.hostname() + os.userInfo().username).digest('hex')
 374:     SET kdfInput = this.serviceName + '-' + machineId
 375:     SET decKey = AWAIT scryptAsync(kdfInput, salt, 32, { N: 16384, r: 8, p: 1 })
 376:
 377:     TRY
 378:       SET decipher = crypto.createDecipheriv('aes-256-gcm', decKey, iv)
 379:       decipher.setAuthTag(authTag)
 380:       SET decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
 381:       RETURN decrypted.toString('utf8')
 382:     CATCH error
 383:       THROW new SecureStoreError(
 384:         'Failed to decrypt fallback file',
 385:         'CORRUPT',
 386:         'Re-save the key or re-authenticate. The file may have been created on a different machine.'
 387:       )
 388:     END TRY
 389:   END METHOD
```

---

## Helper Functions

```
 390:   PRIVATE METHOD validateKey(key: string) → void
 391:     // Reject keys with path separators, null bytes, or relative-path components
 392:     // This protects SecureStore regardless of what callers pass
 393:     IF key CONTAINS '/' OR key CONTAINS '\' THEN
 394:       THROW new SecureStoreError(
 395:         'Key contains path separator: ' + key,
 396:         'CORRUPT',
 397:         'Key names must not contain path separators'
 398:       )
 399:     END IF
 400:     IF key CONTAINS '\0' THEN
 401:       THROW new SecureStoreError(
 402:         'Key contains null byte',
 403:         'CORRUPT',
 404:         'Key names must not contain null bytes'
 405:       )
 406:     END IF
 407:     IF key === '.' OR key === '..' OR key.startsWith('./') OR key.startsWith('../') THEN
 408:       THROW new SecureStoreError(
 409:         'Key contains relative-path component: ' + key,
 410:         'CORRUPT',
 411:         'Key names must not be "." or ".." or start with "./" or "../"'
 412:       )
 413:     END IF
 414:   END METHOD
 415:
 416:   PRIVATE METHOD getFallbackFilePath(key: string) → string
 417:     CALL this.validateKey(key)
 418:     RETURN path.join(this.fallbackDir, key + '.enc')    // R4.4
 419:   END METHOD
 420:
 421:   PRIVATE METHOD hashForLog(key: string) → string
 422:     // Hash key for privacy in debug logs (R8.1)
 423:     RETURN crypto.createHash('sha256').update(key).digest('hex').substring(0, 8)
 424:   END METHOD
 425:
 426:   PRIVATE FUNCTION classifyError(error: Error) → ErrorTaxonomyCode
 427:     IF error.message CONTAINS 'locked' OR error.message CONTAINS 'Locked' THEN
 428:       RETURN 'LOCKED'
 429:     ELSE IF error.message CONTAINS 'denied' OR error.message CONTAINS 'permission' THEN
 430:       RETURN 'DENIED'
 431:     ELSE IF error.message CONTAINS 'timeout' OR error.message CONTAINS 'timed out' THEN
 432:       RETURN 'TIMEOUT'
 433:     ELSE IF error.message CONTAINS 'not found' OR error.code === 'ENOENT' THEN
 434:       RETURN 'NOT_FOUND'
 435:     ELSE
 436:       RETURN 'UNAVAILABLE'
 437:     END IF
 438:   END FUNCTION
 439:
 440:   PRIVATE FUNCTION isTransientError(error: Error) → boolean
 441:     SET classified = classifyError(error)
 442:     RETURN classified === 'TIMEOUT'
 443:   END FUNCTION
 444:
 445:   PRIVATE FUNCTION isValidEnvelope(envelope: unknown) → boolean
 446:     RETURN typeof envelope === 'object'
 447:       AND envelope !== null
 448:       AND envelope.v === 1
 449:       AND typeof envelope.crypto === 'object'
 450:       AND envelope.crypto.alg === 'aes-256-gcm'
 451:       AND envelope.crypto.kdf === 'scrypt'
 452:       AND typeof envelope.data === 'string'
 453:   END FUNCTION
 454:
 455:   PRIVATE FUNCTION getRemediation(code: ErrorTaxonomyCode) → string
 456:     MATCH code
 457:       'UNAVAILABLE' → 'Use --key, install a keyring backend, or use seatbelt mode'
 458:       'LOCKED'      → 'Unlock your keyring'
 459:       'DENIED'      → 'Check permissions, run as correct user'
 460:       'CORRUPT'     → 'Re-save the key or re-authenticate'
 461:       'TIMEOUT'     → 'Retry, check system load'
 462:       'NOT_FOUND'   → 'Save the key first'
 463:     END MATCH
 464:   END FUNCTION
 465:
 466:   PRIVATE ASYNC FUNCTION scryptAsync(password, salt, keyLen, options) → Buffer
 467:     // Promisified scrypt (R4.3 — async, not scryptSync)
 468:     RETURN new Promise((resolve, reject) →
 469:       crypto.scrypt(password, salt, keyLen, options, (err, key) →
 470:         IF err THEN reject(err) ELSE resolve(key)
 471:       )
 472:     )
 473:   END FUNCTION
 474:
 475:  END CLASS
```

---

## Startup Legacy Messaging (R7C.1)

This helper runs once at startup, outside the SecureStore class. It checks for the
existence of legacy plaintext credential files and logs an actionable warning.
It does NOT read, migrate, or delete the legacy files.

```
476:  ASYNC FUNCTION checkForLegacyCredentialFiles() → void
477:    SET legacyPaths = [
478:      { glob: path.join(os.homedir(), '.llxprt', 'oauth', '*.json'), label: 'OAuth tokens' },
479:      { glob: path.join(os.homedir(), '.llxprt', 'keys', '*'), label: 'API keys' },
480:    ]
481:
482:    SET foundLegacy: string[] = []
483:
484:    FOR EACH entry IN legacyPaths
485:      TRY
486:        SET parentDir = path.dirname(entry.glob)
487:        SET pattern = path.basename(entry.glob)
488:        SET files = AWAIT fs.readdir(parentDir)
489:        SET matches = files.filter(f → matchesGlob(f, pattern))
490:        IF matches.length > 0 THEN
491:          ADD entry.label + ' (' + matches.length + ' file(s) in ' + parentDir + ')' TO foundLegacy
492:        END IF
493:      CATCH error
494:        IF error.code === 'ENOENT' THEN
495:          // Directory does not exist — no legacy data here
496:          CONTINUE
497:        END IF
498:        LOG debug: 'Error checking legacy path', { path: parentDir, error: error.message }
499:      END TRY
500:    END FOR
501:
502:    IF foundLegacy.length > 0 THEN
503:      LOG warn: ' Legacy credential files detected:'
504:      FOR EACH description IN foundLegacy
505:        LOG warn: '  • ' + description
506:      END FOR
507:      LOG warn: 'These files are no longer used. Credentials are now stored in the OS keyring.'
508:      LOG warn: 'To migrate: re-authenticate (OAuth) or re-save keys (/key save <name> <key>).'
509:      LOG warn: 'You may then safely delete the legacy files.'
510:    END IF
511:  END FUNCTION
```

Note: `matchesGlob` uses a simple glob pattern match (e.g., `*.json` or `*`).
This function should be called during application startup (e.g., in the session
initialization path) and is NOT part of the SecureStore class.

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: use scryptSync — must use async scrypt (R4.3)
[OK]    DO: crypto.scrypt(password, salt, keyLen, options, callback)

[ERROR] DO NOT: write directly to final path — must use atomic write (R4.7)
[OK]    DO: write temp → fsync → rename → chmod

[ERROR] DO NOT: cache probe permanently (like existing implementations)
[OK]    DO: 60-second TTL with immediate invalidation on transient errors

[ERROR] DO NOT: attempt to read legacy encrypted file formats (R5.1)
[OK]    DO: treat unrecognized format as CORRUPT

[ERROR] DO NOT: log actual key values (R8.2)
[OK]    DO: log hashed key identifiers via hashForLog()

[ERROR] DO NOT: swallow errors silently
[OK]    DO: classify errors into taxonomy and throw with remediation

[ERROR] DO NOT: hardcode keytar import path
[OK]    DO: use injected keytarLoader for testability (R1.3)
```
