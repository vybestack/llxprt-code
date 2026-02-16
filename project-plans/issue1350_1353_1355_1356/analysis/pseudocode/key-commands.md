# Pseudocode: /key Commands

Plan ID: PLAN-20260211-SECURESTORE
Requirements: R12, R13, R14, R15, R16, R17, R18, R19, R20

---

## Interface Contracts

```typescript
// INPUTS this component receives:
interface KeyCommandInput {
  args: string;         // Raw argument string after "/key "
  context: CommandContext; // CLI session context with runtime, interactive mode, etc.
}

// OUTPUTS this component produces:
// Displays messages to the user via context output methods
// Sets session API key via runtime.updateActiveProviderApiKey()
// Returns void (output is side-effect via display)

// DEPENDENCIES this component requires (NEVER stubbed):
interface Dependencies {
  providerKeyStorage: ProviderKeyStorage;  // Real instance, injected or singleton
  runtime: Runtime;                        // Real runtime for API key updates
  maskKeyForDisplay: (key: string) => string; // From tool-key-storage.ts
  isInteractive: boolean;                  // From session context
}
```

---

## Subcommand Constants

```
1:   CONSTANT SUBCOMMANDS = ['save', 'load', 'show', 'list', 'delete']
```

---

## Main Command Handler (R12.1, R12.2, R12.3, R12.4, R12.5, R12.6)

```
2:   ASYNC FUNCTION keyCommandAction(args: string, context: CommandContext) → void
3:     // Trim input (R12.6)
4:     SET trimmedArgs = args.trim()
5:
6:     // No args → show status (R12.4)
7:     IF trimmedArgs.length === 0 THEN
8:       AWAIT showKeyStatus(context)
9:       RETURN
10:    END IF
11:
12:    // Split by whitespace
13:    SET tokens = trimmedArgs.split(/\s+/)
14:    SET subcommand = tokens[0]
15:
16:    // Check for subcommand match (R12.1, R12.2, R12.5 — case-sensitive)
17:    IF SUBCOMMANDS.includes(subcommand) THEN
18:      MATCH subcommand
19:        'save'   → AWAIT handleSave(tokens.slice(1), context)
20:        'load'   → AWAIT handleLoad(tokens.slice(1), context)
21:        'show'   → AWAIT handleShow(tokens.slice(1), context)
22:        'list'   → AWAIT handleList(context)
23:        'delete' → AWAIT handleDelete(tokens.slice(1), context)
24:      END MATCH
25:      RETURN
26:    END IF
27:
28:    // No subcommand match → legacy behavior (R12.3)
29:    AWAIT handleLegacyKey(trimmedArgs, context)
30:  END FUNCTION
```

---

## /key save (R13.1, R13.2, R13.3, R13.4, R13.5)

```
31:  ASYNC FUNCTION handleSave(tokens: string[], context: CommandContext) → void
32:    // Missing name and key (R13.5)
33:    IF tokens.length === 0 THEN
34:      DISPLAY error: 'Usage: /key save <name> <api-key>'
35:      RETURN
36:    END IF
37:
38:    SET name = tokens[0]
39:
40:    // Validate name (delegates to ProviderKeyStorage validation)
41:    TRY
42:      // We'll validate via saveKey, but check proactively for better UX
43:      // Name validation regex: ^[a-zA-Z0-9._-]{1,64}$
44:    END TRY
45:
46:    // Missing API key (R13.4)
47:    SET apiKey = tokens.slice(1).join(' ')
48:    IF apiKey.trim().length === 0 THEN
49:      DISPLAY error: 'API key value cannot be empty.'
50:      RETURN
51:    END IF
52:
53:    SET storage = getProviderKeyStorage()
54:
55:    // Check for existing key — prompt overwrite (R13.2, R13.3)
56:    TRY
57:      SET exists = AWAIT storage.hasKey(name)
58:      IF exists THEN
59:        IF NOT context.isInteractive THEN
60:          // Non-interactive: fail (R13.3)
61:          DISPLAY error: "Key '" + name + "' already exists. Overwriting requires interactive confirmation."
62:          RETURN
63:        END IF
64:        // Interactive: prompt confirmation (R13.2)
65:        SET confirmed = AWAIT context.promptConfirm("Key '" + name + "' already exists. Overwrite?")
66:        IF NOT confirmed THEN
67:          DISPLAY: 'Cancelled.'
68:          RETURN
69:        END IF
70:      END IF
71:    CATCH error
72:      // Storage check failed — proceed with save attempt
73:      LOG debug: 'hasKey check failed, proceeding with save', { error: error.message }
74:    END TRY
75:
76:    // Save the key (R13.1)
77:    TRY
78:      AWAIT storage.saveKey(name, apiKey)
79:      SET masked = maskKeyForDisplay(apiKey.trim())
80:      DISPLAY: "Saved key '" + name + "' (" + masked + ")"
81:    CATCH error
82:      DISPLAY error: formatStorageError(error)
83:    END TRY
84:  END FUNCTION
```

Integration point — Line 78: `storage.saveKey()` MUST be real ProviderKeyStorage.

---

## /key load (R14.1, R14.2, R14.3)

```
85:  ASYNC FUNCTION handleLoad(tokens: string[], context: CommandContext) → void
86:    // Missing name (R14.3)
87:    IF tokens.length === 0 THEN
88:      DISPLAY error: 'Usage: /key load <name>'
89:      RETURN
90:    END IF
91:
92:    SET name = tokens[0]
93:    SET storage = getProviderKeyStorage()
94:
95:    TRY
96:      SET key = AWAIT storage.getKey(name)
97:
98:      // Key not found (R14.2)
99:      IF key IS null THEN
100:       DISPLAY error: "Key '" + name + "' not found. Use '/key list' to see saved keys."
101:       RETURN
102:     END IF
103:
104:     // Set as active session key (R14.1 — same effect as /key <raw-key>)
105:     AWAIT context.runtime.updateActiveProviderApiKey(key)
106:     SET masked = maskKeyForDisplay(key)
107:     DISPLAY: "Loaded key '" + name + "' (" + masked + ") — active for this session"
108:   CATCH error
109:     DISPLAY error: formatStorageError(error)
110:   END TRY
111: END FUNCTION
```

---

## /key show (R15.1, R15.2)

```
112: ASYNC FUNCTION handleShow(tokens: string[], context: CommandContext) → void
113:   // Missing name
114:   IF tokens.length === 0 THEN
115:     DISPLAY error: 'Usage: /key show <name>'
116:     RETURN
117:   END IF
118:
119:   SET name = tokens[0]
120:   SET storage = getProviderKeyStorage()
121:
122:   TRY
123:     SET key = AWAIT storage.getKey(name)
124:
125:     // Key not found (R15.2)
126:     IF key IS null THEN
127:       DISPLAY error: "Key '" + name + "' not found. Use '/key list' to see saved keys."
128:       RETURN
129:     END IF
130:
131:     // Display masked preview (R15.1)
132:     SET masked = maskKeyForDisplay(key)
133:     DISPLAY: name + ': ' + masked + ' (' + key.length + ' chars)'
134:   CATCH error
135:     DISPLAY error: formatStorageError(error)
136:   END TRY
137: END FUNCTION
```

---

## /key list (R16.1, R16.2)

```
138: ASYNC FUNCTION handleList(context: CommandContext) → void
139:   SET storage = getProviderKeyStorage()
140:
141:   TRY
142:     SET names = AWAIT storage.listKeys()
143:
144:     // No keys stored (R16.2)
145:     IF names.length === 0 THEN
146:       DISPLAY: "No saved keys. Use '/key save <name> <api-key>' to store one."
147:       RETURN
148:     END IF
149:
150:     // Display each key with masked value (R16.1)
151:     DISPLAY: 'Saved keys:'
152:     FOR EACH name IN names
153:       SET key = AWAIT storage.getKey(name)
154:       IF key IS NOT null THEN
155:         SET masked = maskKeyForDisplay(key)
156:         DISPLAY: '  ' + name + '  ' + masked
157:       ELSE
158:         DISPLAY: '  ' + name + '  (unable to retrieve)'
159:       END IF
160:     END FOR
161:   CATCH error
162:     DISPLAY error: formatStorageError(error)
163:   END TRY
164: END FUNCTION
```

**N+1 retrieval tradeoff**: `/key list` performs one `listKeys()` call followed by one
`getKey()` per name (for masking). This N+1 pattern is acceptable because:
1. The number of saved provider keys is typically small (single digits).
2. The `SecureStore` keyring API does not support batch retrieval — `findCredentials`
   returns account names but not all backends reliably return values with them.
3. Keyring operations are local OS calls and fast on all supported platforms (macOS
   Keychain, Linux Secret Service, Windows Credential Vault).

---

## /key delete (R17.1, R17.2, R17.3, R17.4)

```
165: ASYNC FUNCTION handleDelete(tokens: string[], context: CommandContext) → void
166:   // Missing name (R17.4)
167:   IF tokens.length === 0 THEN
168:     DISPLAY error: 'Usage: /key delete <name>'
169:     RETURN
170:   END IF
171:
172:   SET name = tokens[0]
173:
174:   // Non-interactive check (R17.2)
175:   IF NOT context.isInteractive THEN
176:     DISPLAY error: "Deleting keys requires interactive confirmation."
177:     RETURN
178:   END IF
179:
180:   SET storage = getProviderKeyStorage()
181:
182:   TRY
183:     // Check if key exists (R17.3)
184:     SET exists = AWAIT storage.hasKey(name)
185:     IF NOT exists THEN
186:       DISPLAY error: "Key '" + name + "' not found. Use '/key list' to see saved keys."
187:       RETURN
188:     END IF
189:
190:     // Prompt for confirmation (R17.1)
191:     SET confirmed = AWAIT context.promptConfirm("Delete key '" + name + "'?")
192:     IF NOT confirmed THEN
193:       DISPLAY: 'Cancelled.'
194:       RETURN
195:     END IF
196:
197:     // Delete (R17.1)
198:     AWAIT storage.deleteKey(name)
199:     DISPLAY: "Deleted key '" + name + "'"
200:   CATCH error
201:     DISPLAY error: formatStorageError(error)
202:   END TRY
203: END FUNCTION
```

---

## Legacy Behavior and Status

```
204: ASYNC FUNCTION handleLegacyKey(rawKey: string, context: CommandContext) → void
205:   // Existing behavior — set ephemeral session key (R12.3)
206:   AWAIT context.runtime.updateActiveProviderApiKey(rawKey)
207:   SET masked = maskKeyForDisplay(rawKey)
208:   DISPLAY: 'API key set for this session (' + masked + ')'
209: END FUNCTION
210:
211: ASYNC FUNCTION showKeyStatus(context: CommandContext) → void
212:   // Show current key status for active provider (R12.4)
213:   SET provider = context.runtime.getActiveProvider()
214:   SET hasKey = context.runtime.hasActiveProviderApiKey()
215:   IF hasKey THEN
216:     DISPLAY: 'Current provider: ' + provider.name + ' — API key is set'
217:   ELSE
218:     DISPLAY: 'Current provider: ' + provider.name + ' — No API key set'
219:   END IF
220: END FUNCTION
```

---

## Error Formatting (R18.1)

```
221: FUNCTION formatStorageError(error: Error) → string
222:   IF error IS SecureStoreError THEN
223:     IF error.code === 'UNAVAILABLE' THEN
224:       RETURN "Cannot access keyring. Keys cannot be saved. Use '/key <raw-key>' for ephemeral session key."
225:     ELSE
226:       RETURN error.message + ' — ' + error.remediation
227:     END IF
228:   ELSE IF error.message CONTAINS 'invalid' THEN
229:     // Key name validation error
230:     RETURN error.message
231:   ELSE
232:     RETURN 'Key operation failed: ' + error.message
233:   END IF
234: END FUNCTION
```

---

## Autocomplete (R19.1, R19.2, R19.3)

```
235: ASYNC FUNCTION getKeyCompletions(partial: string) → string[]
236:   SET tokens = partial.trim().split(/\s+/)
237:
238:   // First token completion (subcommand names)
239:   IF tokens.length <= 1 THEN
240:     SET prefix = tokens[0] ?? ''
241:     RETURN SUBCOMMANDS.filter(cmd → cmd.startsWith(prefix))
242:   END IF
243:
244:   SET subcommand = tokens[0]
245:
246:   // Second token completion (key names for load/show/delete/save)
247:   IF tokens.length === 2 AND ['load', 'show', 'delete', 'save'].includes(subcommand) THEN
248:     SET prefix = tokens[1]
249:     TRY
250:       SET names = AWAIT getProviderKeyStorage().listKeys()
251:       RETURN names.filter(name → name.startsWith(prefix))
252:     CATCH
253:       // Keyring unavailable during autocomplete (R19.3)
254:       RETURN []
255:     END TRY
256:   END IF
257:
258:   RETURN []
259: END FUNCTION
```

---

## Secure Input Masking Update (R20.1, R20.2)

```
260: // Update secureInputHandler.ts regex patterns
261: // BEFORE: /^(\/key\s+)(.+)$/  — masks everything after /key
262: // AFTER: Add specific patterns for subcommands
263:
264: FUNCTION maskSecureInput(input: string) → { display: string, original: string }
265:   // /key save <name> <api-key> — mask only the api-key (R20.1)
266:   SET saveMatch = input.match(/^(\/key\s+save\s+\S+\s+)(.+)$/)
267:   IF saveMatch THEN
268:     RETURN { display: saveMatch[1] + '****', original: input }
269:   END IF
270:
271:   // /key <raw-key> — legacy masking (R20.2)
272:   SET legacyMatch = input.match(/^(\/key\s+)(.+)$/)
273:   IF legacyMatch AND NOT isSubcommand(legacyMatch[2].split(/\s+/)[0]) THEN
274:     RETURN { display: legacyMatch[1] + '****', original: input }
275:   END IF
276:
277:   RETURN { display: input, original: input }
278: END FUNCTION
279:
280: FUNCTION isSubcommand(token: string) → boolean
281:   RETURN SUBCOMMANDS.includes(token)
282: END FUNCTION
```

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: match subcommands case-insensitively (R12.5)
[OK]    DO: exact case-sensitive match against lowercase subcommand names

[ERROR] DO NOT: proceed with overwrite without confirmation in interactive mode (R13.2)
[OK]    DO: check exists → prompt confirmation → then save

[ERROR] DO NOT: silently skip confirmation in non-interactive mode (R13.3, R17.2)
[OK]    DO: return error explaining confirmation is required

[ERROR] DO NOT: display raw API key values in output (R8.2)
[OK]    DO: always use maskKeyForDisplay() for any key shown to user

[ERROR] DO NOT: create a new masking function — reuse existing maskKeyForDisplay
[OK]    DO: import from tool-key-storage.ts

[ERROR] DO NOT: throw errors on autocomplete failure (R19.3)
[OK]    DO: return empty array when keyring is unavailable during autocomplete

[ERROR] DO NOT: treat "SAVE" or "Load" as subcommands (R12.5)
[OK]    DO: only recognize lowercase: save, load, show, list, delete
```
