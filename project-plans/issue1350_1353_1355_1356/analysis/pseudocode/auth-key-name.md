# Pseudocode: auth-key-name Integration

Plan ID: PLAN-20260211-SECURESTORE
Requirements: R21, R22, R23, R24, R25, R26

---

## Interface Contracts

```typescript
// INPUTS this component receives:
interface BootstrapProfileArgs {
  // Existing fields:
  keyOverride: string | null;       // From --key
  keyfileOverride: string | null;   // From --keyfile
  // NEW field:
  keyNameOverride: string | null;   // From --key-name
}

// Profile ephemeral settings (in profile JSON):
interface ProfileEphemeralSettings {
  'auth-key'?: string;       // Existing: inline API key
  'auth-keyfile'?: string;   // Existing: path to key file
  'auth-key-name'?: string;  // NEW: named key reference
}

// OUTPUTS this component produces:
// API key resolved and set via updateActiveProviderApiKey()
// Debug logs showing auth source selection

// DEPENDENCIES this component requires (NEVER stubbed):
interface Dependencies {
  providerKeyStorage: ProviderKeyStorage;  // Real instance for key resolution
  runtime: Runtime;                        // Real runtime for API key updates
}
```

---

## Bootstrap Argument Parsing (R22.2)

```
1:   // In profileBootstrap.ts parseBootstrapArgs()
2:   // Add alongside existing --key and --keyfile parsing
3:
4:   FUNCTION parseBootstrapArgs(argv: string[]) → BootstrapProfileArgs
5:     SET result = { ...existingDefaults, keyNameOverride: null }
6:
7:     FOR EACH arg IN argv
8:       MATCH arg
9:         '--key-name' →
10:          SET result.keyNameOverride = NEXT_ARG()
11:          // DO NOT resolve the key here — just store the name
12:        // ... existing --key, --keyfile, --profile handling unchanged ...
13:      END MATCH
14:    END FOR
15:
16:    RETURN result
17:  END FUNCTION
```

Integration point — Line 10: `keyNameOverride` is stored as metadata only. Resolution happens in `applyCliArgumentOverrides()`.

---

## Profile Field Recognition (R21.2)

```
18:  // In config.ts VALID_EPHEMERAL_SETTINGS
19:  // Add 'auth-key-name' to the valid ephemeral keys array
20:
21:  CONSTANT VALID_EPHEMERAL_SETTINGS = [
22:    ...existingKeys,
23:    'auth-key-name'    // NEW (R21.2)
24:  ]
```

---

## Synthetic Profile Creation (R21.3, R22.2)

```
25:  // In config.ts, where synthetic profiles are created from bootstrap args
26:
27:  FUNCTION createSyntheticProfile(bootstrapArgs: BootstrapProfileArgs) → Profile
28:    SET profile = { ...existingProfileCreation }
29:
30:    // Pass keyNameOverride as ephemeral setting (R21.3)
31:    IF bootstrapArgs.keyNameOverride IS NOT null THEN
32:      SET profile.ephemeralSettings['auth-key-name'] = bootstrapArgs.keyNameOverride
33:    END IF
34:
35:    RETURN profile
36:  END FUNCTION
```

---

## API Key Precedence Resolution (R23.1, R23.2, R23.3)

```
37:  // In runtimeSettings.ts applyCliArgumentOverrides()
38:  // This is the SINGLE authoritative stage for all key resolution
39:
40:  ASYNC FUNCTION applyCliArgumentOverrides(
41:    runtime: Runtime,
42:    bootstrapArgs: BootstrapProfileArgs,
43:    profile: Profile | null
44:  ) → void
45:
46:    // === API KEY RESOLUTION (R23.1 precedence order) ===
47:
48:    // 1. --key (highest precedence) (R23.1, R23.2)
49:    IF bootstrapArgs.keyOverride IS NOT null THEN
50:      AWAIT runtime.updateActiveProviderApiKey(bootstrapArgs.keyOverride)
51:      LOG debug: '[auth] Using API key from: --key (raw CLI flag)'
52:      // Log overridden sources (R25.2)
53:      IF bootstrapArgs.keyNameOverride IS NOT null THEN
54:        LOG debug: '[auth] Ignoring --key-name (overridden by --key)'
55:      END IF
56:      IF profile?.ephemeralSettings?.['auth-key-name'] THEN
57:        LOG debug: '[auth] Ignoring profile auth-key-name (overridden by --key)'
58:      END IF
59:      RETURN
60:    END IF
61:
62:    // 2. --key-name (CLI flag, named key from keyring) (R22.1)
63:    IF bootstrapArgs.keyNameOverride IS NOT null THEN
64:      SET resolvedKey = AWAIT resolveNamedKey(bootstrapArgs.keyNameOverride)
65:      AWAIT runtime.updateActiveProviderApiKey(resolvedKey)
66:      LOG debug: "[auth] Using API key from: --key-name '" + bootstrapArgs.keyNameOverride + "' (keyring)"
67:      // Log overridden sources (R25.2)
68:      IF profile?.ephemeralSettings?.['auth-key-name'] THEN
69:        LOG debug: '[auth] Ignoring profile auth-key-name (overridden by --key-name)'
70:      END IF
71:      RETURN
72:    END IF
73:
74:    // 3. auth-key-name (profile field, named key from keyring) (R21.1)
75:    SET profileKeyName = profile?.ephemeralSettings?.['auth-key-name'] ?? null
76:    IF profileKeyName IS NOT null THEN
77:      SET resolvedKey = AWAIT resolveNamedKey(profileKeyName)
78:      AWAIT runtime.updateActiveProviderApiKey(resolvedKey)
79:      LOG debug: "[auth] Using API key from: profile auth-key-name '" + profileKeyName + "' (keyring)"
80:      // Log overridden sources (R25.2)
81:      IF profile?.ephemeralSettings?.['auth-keyfile'] THEN
82:        LOG debug: '[auth] Ignoring profile auth-keyfile (overridden by auth-key-name)'
83:      END IF
84:      IF profile?.ephemeralSettings?.['auth-key'] THEN
85:        LOG debug: '[auth] Ignoring profile auth-key (overridden by auth-key-name)'
86:      END IF
87:      RETURN
88:    END IF
89:
90:    // 4. auth-keyfile (profile field, read from file path) — EXISTING, UNCHANGED (R26.1)
91:    // 5. auth-key (profile field, inline in profile JSON) — EXISTING, UNCHANGED (R26.1)
92:    // 6. Environment variables — EXISTING, UNCHANGED (R26.1)
93:    // ... existing resolution logic continues unchanged ...
94:
95:  END FUNCTION
```

---

## Named Key Resolution with Error Handling (R24.1, R24.2)

```
96:  ASYNC FUNCTION resolveNamedKey(name: string) → string
97:    SET storage = getProviderKeyStorage()
98:
99:    TRY
100:     SET key = AWAIT storage.getKey(name)
101:   CATCH error
102:     // Storage access error — fail with actionable message
103:     THROW new Error(
104:       "Failed to access keyring while resolving named key '" + name + "': " + error.message +
105:       ". Use '/key save " + name + " <key>' to store it, or use --key to provide the key directly."
106:     )
107:   END TRY
108:
109:   // Key not found — fail fast (R24.1)
110:   IF key IS null THEN
111:     THROW new Error(
112:       "Named key '" + name + "' not found. " +
113:       "Use '/key save " + name + " <key>' to store it."
114:     )
115:   END IF
116:
117:   // R24.1: Do NOT silently fall through to lower-precedence auth sources
118:   RETURN key
119: END FUNCTION
```

Integration point — Line 100: `storage.getKey()` MUST be real ProviderKeyStorage, not mocked.

---

## Startup Diagnostics (R25.1, R25.2)

```
120: // Debug log format (R25.1)
121: // These are emitted inline within applyCliArgumentOverrides (see lines 51-88 above)
122: //
123: // Format: '[auth] Using API key from: <source>'
124: // Format: '[auth] Ignoring <source> (overridden by <winner>)'
125: //
126: // NEVER log the actual key value (R8.2)
127: // ONLY log the source type and name/path identifiers
```

---

## Non-Interactive Failure (R24.2)

```
128: // In the calling code that invokes applyCliArgumentOverrides:
129: // When resolveNamedKey throws and the session is non-interactive:
130:
131: FUNCTION handleKeyResolutionError(error: Error, isInteractive: boolean) → void
132:   IF NOT isInteractive THEN
133:     // Fail fast with exit code (R24.2)
134:     STDERR: error.message
135:     EXIT with code 1
136:   ELSE
137:     // Interactive — display error but allow session to continue
138:     DISPLAY error: error.message
139:   END IF
140: END FUNCTION
```

---

## Integration Points Summary

```
Files modified:
  1. packages/cli/src/config/profileBootstrap.ts
     - Line 19-28: Add keyNameOverride to BootstrapProfileArgs
     - Line ~222-232: Add --key-name case to argument parsing

  2. packages/cli/src/config/config.ts
     - Line 1710-1721: Add 'auth-key-name' to VALID_EPHEMERAL_SETTINGS
     - Line 1461-1476: Add keyNameOverride handling in synthetic profile

  3. packages/cli/src/runtime/runtimeSettings.ts
     - Line 2289-2345: Add --key-name / auth-key-name resolution in applyCliArgumentOverrides

Files that remain unchanged by the auth-key-name integration (this pseudocode):
  - keyCommand.ts legacy behavior (`/key <raw-key>` ephemeral session set) is unchanged
    by the auth-key-name integration. Note: keyCommand.ts IS modified by Phase P13-P15
    (/key commands) to add subcommand dispatch — that work is separate from the
    auth-key-name integration.
  - --key handling (R26.1)
  - --keyfile handling (R26.1)
  - auth-key handling (R26.1)
  - auth-keyfile handling (R26.1)
  - Environment variable handling (R26.1)
```

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: resolve named keys in profileBootstrap.ts (R21.3, R23.3)
[OK]    DO: pass keyNameOverride as metadata, resolve in applyCliArgumentOverrides

[ERROR] DO NOT: silently fall through to lower-precedence auth on key-not-found (R24.1)
[OK]    DO: throw with actionable error message

[ERROR] DO NOT: log API key values in startup diagnostics (R8.2)
[OK]    DO: log source type and name only ('[auth] Using API key from: --key-name "mykey" (keyring)')

[ERROR] DO NOT: deprecate --key or --keyfile (R26.1)
[OK]    DO: keep all existing auth mechanisms fully supported

[ERROR] DO NOT: allow --key-name to override --key (R23.2)
[OK]    DO: --key always wins when both are specified

[ERROR] DO NOT: duplicate key resolution logic in multiple places (R23.3)
[OK]    DO: single authoritative resolution stage in applyCliArgumentOverrides

[ERROR] DO NOT: resolve auth-key-name in profile bootstrap (R21.3)
[OK]    DO: profile bootstrap passes metadata only; runtimeSettings resolves
```
