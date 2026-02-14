# Pseudocode: ProviderKeyStorage

Plan ID: PLAN-20260211-SECURESTORE
Requirements: R9, R10, R11

---

## Interface Contracts

```typescript
// INPUTS this component receives:
interface ProviderKeyStorageOptions {
  secureStore?: SecureStore;  // Injectable for testing
}

// OUTPUTS this component produces:
// saveKey(name, apiKey): Promise<void> — stores key after validation and trimming
// getKey(name): Promise<string | null> — retrieves key or null
// deleteKey(name): Promise<boolean> — true if deleted, false if not found
// listKeys(): Promise<string[]> — sorted, deduplicated key names
// hasKey(name): Promise<boolean> — true if exists

// DEPENDENCIES this component requires (NEVER stubbed):
interface Dependencies {
  secureStore: SecureStore;  // Real SecureStore instance, injected
}
```

---

## Key Name Validation (R10.1, R10.2)

```
1:   CONSTANT KEY_NAME_REGEX = /^[a-zA-Z0-9._-]{1,64}$/
2:
3:   FUNCTION validateKeyName(name: string) → void
4:     IF NOT KEY_NAME_REGEX.test(name) THEN
5:       THROW new Error(
6:         "Key name '" + name + "' is invalid. " +
7:         "Use only letters, numbers, dashes, underscores, and dots (1-64 chars)."
8:       )
9:     END IF
10:  END FUNCTION
```

---

## Constructor

```
11:  CLASS ProviderKeyStorage
12:    PRIVATE secureStore: SecureStore
13:    CONSTANT SERVICE_NAME = 'llxprt-code-provider-keys'
14:    CONSTANT FALLBACK_DIR = path.join(os.homedir(), '.llxprt', 'provider-keys')
15:
16:    CONSTRUCTOR(options?: ProviderKeyStorageOptions)
17:      IF options?.secureStore IS defined THEN
18:        SET this.secureStore = options.secureStore
19:      ELSE
20:        SET this.secureStore = new SecureStore(SERVICE_NAME, {
21:          fallbackDir: FALLBACK_DIR,
22:          fallbackPolicy: 'allow'
23:        })
24:      END IF
25:    END CONSTRUCTOR
```

---

## saveKey (R9.2)

```
26:    PUBLIC ASYNC METHOD saveKey(name: string, apiKey: string) → void
27:      // Validate name (R10.1, R10.2)
28:      CALL validateKeyName(name)
29:
30:      // Trim and normalize input (R9.2)
31:      SET trimmedKey = apiKey.trim()
32:      SET normalizedKey = trimmedKey.replace(/[\r\n]+$/, '')
33:
34:      IF normalizedKey.length === 0 THEN
35:        THROW new Error('API key value cannot be empty.')
36:      END IF
37:
38:      // Store via SecureStore (R9.1)
39:      AWAIT this.secureStore.set(name, normalizedKey)
40:    END METHOD
```

Integration point — Line 39: `this.secureStore.set()` MUST be the real SecureStore, not a mock.

---

## getKey (R9.3)

```
41:    PUBLIC ASYNC METHOD getKey(name: string) → string | null
42:      // Validate name
43:      CALL validateKeyName(name)
44:
45:      // Retrieve via SecureStore (R9.3)
46:      RETURN AWAIT this.secureStore.get(name)
47:    END METHOD
```

---

## deleteKey (R9.4)

```
48:    PUBLIC ASYNC METHOD deleteKey(name: string) → boolean
49:      // Validate name
50:      CALL validateKeyName(name)
51:
52:      // Delete via SecureStore (R9.4)
53:      RETURN AWAIT this.secureStore.delete(name)
54:    END METHOD
```

---

## listKeys (R9.5)

```
55:    PUBLIC ASYNC METHOD listKeys() → string[]
56:      // List via SecureStore — already sorted and deduplicated (R9.5)
57:      RETURN AWAIT this.secureStore.list()
58:    END METHOD
```

---

## hasKey (R9.6)

```
59:    PUBLIC ASYNC METHOD hasKey(name: string) → boolean
60:      // Validate name
61:      CALL validateKeyName(name)
62:
63:      // Check via SecureStore (R9.6)
64:      RETURN AWAIT this.secureStore.has(name)
65:    END METHOD
66:
67:  END CLASS
```

---

## Module-Level Singleton

```
68:  LET providerKeyStorageInstance: ProviderKeyStorage | null = null
69:
70:  FUNCTION getProviderKeyStorage() → ProviderKeyStorage
71:    IF providerKeyStorageInstance IS null THEN
72:      SET providerKeyStorageInstance = new ProviderKeyStorage()
73:    END IF
74:    RETURN providerKeyStorageInstance
75:  END FUNCTION
76:
77:  FUNCTION resetProviderKeyStorage() → void
78:    // For testing only
79:    SET providerKeyStorageInstance = null
80:  END FUNCTION
```

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: store keys without validation — always call validateKeyName first
[OK]    DO: validateKeyName(name) before any operation

[ERROR] DO NOT: normalize key names (case-folding, trimming, etc.) — R10.1 says case-sensitive, as-is
[OK]    DO: store names exactly as provided after regex validation

[ERROR] DO NOT: trim or normalize the key NAME (only the API key VALUE is trimmed)
[OK]    DO: apiKey.trim().replace(/[\r\n]+$/, '') for the value only

[ERROR] DO NOT: create a separate encryption/storage mechanism — use SecureStore
[OK]    DO: delegate all storage to this.secureStore

[ERROR] DO NOT: catch and swallow SecureStore errors — let them propagate
[OK]    DO: let SecureStoreError propagate to the caller (command handler handles display)

[ERROR] DO NOT: attempt case normalization for Windows compatibility (R11.1)
[OK]    DO: document the limitation, store as-is
```
