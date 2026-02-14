# Pseudocode: Wiring & Legacy Elimination

Plan ID: `PLAN-20260213-KEYRINGTOKENSTORE`
Component: Integration wiring + MultiProviderTokenStore deletion

---

## Interface Contracts

### Inputs this component receives:

```typescript
// No new interfaces — this is a wiring change.
// All call sites already program against TokenStore interface.
// We swap the concrete implementation from MultiProviderTokenStore → KeyringTokenStore.
```

### Outputs this component produces:

```typescript
// Same TokenStore interface behaviors — no functional changes visible to callers.
// The only change is WHERE tokens are stored (keyring/encrypted fallback vs plaintext files).
```

### Dependencies this component requires:

```typescript
interface Dependencies {
  KeyringTokenStore: class;   // From packages/core/src/auth/keyring-token-store.ts (created in earlier phases)
  TokenStore: interface;       // From packages/core/src/auth/token-store.ts (preserved, not modified)
  SecureStore: class;          // From packages/core/src/storage/secure-store.ts (existing)
}
```

---

## Pseudocode: Wiring Changes

### Phase 1: Update Core Exports

```
1:  FILE packages/core/index.ts
2:    REMOVE: export { MultiProviderTokenStore } from './src/auth/token-store.js'
3:    ADD:    export { KeyringTokenStore } from './src/auth/keyring-token-store.js'
4:  END FILE
```

### Phase 2: Update CLI Re-exports

```
5:  FILE packages/cli/src/auth/types.ts
6:    REMOVE: export { MultiProviderTokenStore } from '@vybestack/llxprt-code-core'
7:    ADD:    export { KeyringTokenStore } from '@vybestack/llxprt-code-core'
8:  END FILE
```

### Phase 3: Update runtimeContextFactory (Shared Instance)

```
9:  FILE packages/cli/src/runtime/runtimeContextFactory.ts
10:   REMOVE import: MultiProviderTokenStore from token-store or types
11:   ADD import: KeyringTokenStore from '@vybestack/llxprt-code-core' (or from types re-export)
12:
13:   CHANGE shared instance declaration:
14:     REMOVE: let sharedTokenStore: MultiProviderTokenStore | null = null;
15:     ADD:    let sharedTokenStore: KeyringTokenStore | null = null;
16:
17:   CHANGE instantiation site:
18:     REMOVE: sharedTokenStore ?? (sharedTokenStore = new MultiProviderTokenStore())
19:     ADD:    sharedTokenStore ?? (sharedTokenStore = new KeyringTokenStore())
20:
21:   NOTE: This is the primary shared instance — satisfies probe-once constraint (R14.1)
22: END FILE
```

### Phase 4: Update authCommand

```
23: FILE packages/cli/src/ui/commands/authCommand.ts
24:   REMOVE import: MultiProviderTokenStore
25:   ADD import: KeyringTokenStore
26:
27:   CHANGE line ~40:
28:     REMOVE: const tokenStore = new MultiProviderTokenStore()
29:     ADD:    const tokenStore = new KeyringTokenStore()
30:
31:   CHANGE line ~662:
32:     REMOVE: const tokenStore = new MultiProviderTokenStore()
33:     ADD:    const tokenStore = new KeyringTokenStore()
34: END FILE
```

### Phase 5: Update profileCommand

```
35: FILE packages/cli/src/ui/commands/profileCommand.ts
36:   REMOVE import: MultiProviderTokenStore
37:   ADD import: KeyringTokenStore
38:
39:   CHANGE line ~100:
40:     REMOVE: const tokenStore = new MultiProviderTokenStore()
41:     ADD:    const tokenStore = new KeyringTokenStore()
42:
43:   CHANGE line ~347:
44:     REMOVE: const tokenStore = new MultiProviderTokenStore()
45:     ADD:    const tokenStore = new KeyringTokenStore()
46: END FILE
```

### Phase 6: Update providerManagerInstance

```
47: FILE packages/cli/src/providers/providerManagerInstance.ts
48:   REMOVE import: MultiProviderTokenStore
49:   ADD import: KeyringTokenStore
50:
51:   CHANGE line ~242:
52:     REMOVE: const tokenStore = new MultiProviderTokenStore()
53:     ADD:    const tokenStore = new KeyringTokenStore()
54: END FILE
```

### Phase 7: Update oauth-provider-registration

```
55: FILE packages/cli/src/providers/oauth-provider-registration.ts
56:   REMOVE import: MultiProviderTokenStore from '../auth/types.js'
57:   ADD import: KeyringTokenStore (or TokenStore if only type is used)
58:
59:   CHANGE parameter type if applicable:
60:     REMOVE: tokenStore?: MultiProviderTokenStore
61:     ADD:    tokenStore?: TokenStore
62:   NOTE: Prefer interface type (TokenStore) over concrete class for parameters
63: END FILE
```

---

## Pseudocode: Legacy Elimination

### Phase 8: Delete MultiProviderTokenStore Class

```
64: FILE packages/core/src/auth/token-store.ts
65:   PRESERVE: TokenStore interface (lines 1-85 approximately)
66:   PRESERVE: All imports used by TokenStore interface
67:   DELETE: LockInfo interface
68:   DELETE: MultiProviderTokenStore class (entire class body)
69:   DELETE: Unused imports (fs, join, homedir — if only used by MultiProviderTokenStore)
70:   KEEP: Import of OAuthTokenSchema, BucketStats, OAuthToken (used by interface)
71:
72:   RESULT: token-store.ts contains ONLY the TokenStore interface and necessary type imports
73: END FILE
```

### Phase 9: Clean Up Residual Imports

```
74: FOR EACH file that previously imported MultiProviderTokenStore:
75:   IF file now uses KeyringTokenStore → import already updated in wiring phase
76:   IF file only used MultiProviderTokenStore as a type → switch to TokenStore interface
77:   IF file is a test → update to use KeyringTokenStore (see test update phase)
78: END FOR
```

### Phase 10: Update Existing Tests

```
79: FILE packages/core/src/auth/token-store.spec.ts
80:   CHANGE: import { MultiProviderTokenStore } → import { KeyringTokenStore }
81:   CHANGE: describe('MultiProviderTokenStore') → describe('KeyringTokenStore')
82:   CHANGE: new MultiProviderTokenStore(path) → new KeyringTokenStore({ secureStore: testSecureStore })
83:   NOTE: Tests need rewrite since storage mechanism changed (no longer plaintext files)
84:   NOTE: New tests created in TDD phase; these old tests are updated or replaced
85: END FILE
86:
87: FILE packages/core/src/auth/token-store.refresh-race.spec.ts
88:   CHANGE: Same pattern as above — update class references
89:   NOTE: Lock mechanism is preserved but lock dir changes to ~/.llxprt/oauth/locks/
90: END FILE
91:
92: FILE packages/cli/src/auth/types.ts
93:   Already updated in Phase 2 above
94: END FILE
95:
96: FILE packages/cli/src/integration-tests/oauth-timing.integration.test.ts
97:   CHANGE: import { MultiProviderTokenStore } → import { KeyringTokenStore }
98:   CHANGE: All instantiation sites
99: END FILE
100:
101: FILE packages/cli/src/integration-tests/__tests__/oauth-buckets.integration.spec.ts
102:   CHANGE: import { MultiProviderTokenStore } → import { KeyringTokenStore }
103:   CHANGE: new MultiProviderTokenStore(oauthDir) → new KeyringTokenStore({ secureStore: testSecureStore })
104: END FILE
105:
106: FILE packages/cli/src/auth/oauth-manager-initialization.spec.ts
107:   CHANGE: import + instantiation
108: END FILE
109:
110: FILE packages/cli/src/auth/oauth-manager.refresh-race.spec.ts
111:   CHANGE: import + instantiation
112: END FILE
113:
114: FILE packages/cli/test/auth/gemini-oauth-fallback.test.ts
115:   CHANGE: import + type references
116: END FILE
117:
118: FILE packages/cli/test/ui/commands/authCommand-logout.test.ts
119:   CHANGE: import + instantiation (multiple sites)
120: END FILE
121:
122: FILE packages/cli/src/auth/__tests__/codex-oauth-provider.test.ts
123:   CHANGE: import + instantiation
124: END FILE
125:
126: FILE packages/cli/src/ui/commands/__tests__/profileCommand.bucket.spec.ts
127:   CHANGE: Mock from MultiProviderTokenStore → KeyringTokenStore
128: END FILE
```

---

## Integration Points (Line-by-Line)

| Line(s) | Change | Risk |
|---|---|---|
| 2-3 | Core export swap | All downstream consumers affected |
| 6-7 | CLI re-export swap | CLI-internal consumers affected |
| 14-19 | Shared instance type+construction | Probe-once constraint depends on this |
| 28-33 | authCommand construction (2 sites) | Login/logout/status functionality |
| 40-45 | profileCommand construction (2 sites) | Profile token operations |
| 52-53 | providerManagerInstance construction | Provider initialization |
| 60-61 | oauth-provider-registration type | Registration parameter |
| 64-72 | Delete MultiProviderTokenStore class | Irreversible — git history only reference |
| 79-128 | Test updates | All existing tests must pass after update |

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Keep MultiProviderTokenStore "just in case"         // Clean cut, no dead code
[OK]    DO:     Delete it entirely from token-store.ts               // Git history is the archive

[ERROR] DO NOT: Create KeyringTokenStoreV2 or similar                // No parallel versions
[OK]    DO:     KeyringTokenStore is the ONLY TokenStore impl        // Single implementation

[ERROR] DO NOT: Add feature flag to switch between old and new       // No toggles
[OK]    DO:     Unconditional replacement everywhere                  // Clean swap

[ERROR] DO NOT: Leave MultiProviderTokenStore import in any file     // Dead imports
[OK]    DO:     grep -r "MultiProviderTokenStore" to verify zero hits // Complete elimination

[ERROR] DO NOT: Change the TokenStore interface                      // Interface is stable
[OK]    DO:     Only change the implementation and consumers          // Interface preserved

[ERROR] DO NOT: Create new instantiation sites for KeyringTokenStore  // Avoid instance sprawl
[OK]    DO:     Replace existing sites 1:1, prefer shared instance    // Same pattern as before

[ERROR] DO NOT: Update test assertions to match new error messages    // Tests should test behavior
[OK]    DO:     Tests verify token operations work regardless of backend // Implementation-agnostic tests
```
