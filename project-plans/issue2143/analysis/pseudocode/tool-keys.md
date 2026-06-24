<!-- @plan:PLAN-20260622-COREAPIGAP.P02 @requirement:REQ-007 -->
# Pseudocode: Tool-Key Storage (`agent.tools.keys`)

Plan ID: PLAN-20260622-COREAPIGAP
Component: G7 — `AgentToolKeyControl` exposed as `agent.tools.keys` (new, masked).
Source of truth: specification.md REQ-007; domain-model.md R-NO-RAW-SECRETS, R-KEYS-DISTINCT.
Analysis only — NO implementation code is written in this document.

> DISTINCT from `Agent.auth.keys` (provider-auth keys at `agent.ts:241-258`). This is built-in
> TOOL key storage (Exa, etc.) backed by `ToolKeyStorage` — REQ-007 / R-KEYS-DISTINCT.

---

## Interface Contracts

```typescript
// Declared in packages/agents/src/api/agent.ts. ADD `readonly keys` to the EXISTING
// AgentToolControl interface (:223-230) — non-breaking (REQ-009):
interface AgentToolControl {
  // ...existing members unchanged (list/enabled/confirmation/update/editor)...
  readonly keys: AgentToolKeyControl;
}

interface AgentToolKeyControl {
  supported(): readonly ToolKeyInfo[];
  status(toolName: string): Promise<ToolKeyStatus>;   // MASKED only — never the raw key
  save(toolName: string, key: string): Promise<void>;
  delete(toolName: string): Promise<void>;
  setKeyFile(toolName: string, path: string | null): Promise<void>;  // null => clear
  getKeyFile(toolName: string): Promise<string | null>;
}

// Projected public types (specification.md Data Schemas).
interface ToolKeyInfo {
  readonly toolName: string;       // = ToolKeyRegistryEntry.toolKeyName
  readonly displayName: string;
  readonly description?: string;
}
interface ToolKeyStatus {
  readonly toolName: string;
  readonly hasKey: boolean;
  readonly maskedKey?: string;     // maskKeyForDisplay(rawKey); present ONLY when hasKey
  readonly keyFile?: string;       // configured keyfile path, if any
}
```

### Dependencies (NEVER stubbed)

```typescript
// packages/agents/src/api/control/toolKeysControl.ts
export interface ToolKeysControlDeps {
  // The shared ToolKeyStorage instance (core lazy singleton getToolKeyStorage(), tool-key-storage.ts:81).
  readonly getStorage: () => ToolKeyStorage;
}
// Wired by AgentImpl: getStorage: () => getToolKeyStorage()
// AgentToolControl gains `keys: new ToolKeysControl({ getStorage: () => getToolKeyStorage() })`.
```

All symbols are re-exported through the core barrel `@vybestack/llxprt-code-core`
(`ToolKeyStorage`/`getToolKeyStorage` at `index.ts:466-467`; `getSupportedToolNames`/`getToolKeyEntry`/
`isValidToolKeyName`/`maskKeyForDisplay`/`ToolKeyRegistryEntry` at `index.ts:472-475`) — no deep import.

---

## Numbered Pseudocode

### METHOD supported(): readonly ToolKeyInfo[]

```
1: // @pseudocode REQ-007.1 — registry projection from the tool-key registry helpers
2: METHOD supported() RETURNS readonly ToolKeyInfo[]
3:   SET names = getSupportedToolNames()                  // tool-key-storage-types.ts:72
4:   SET out = empty array
5:   FOR EACH name IN names
6:     SET entry = getToolKeyEntry(name)                  // tool-key-storage-types.ts:62
7:     IF entry IS undefined THEN CONTINUE                // defensive; registry is the source
8:     APPEND { toolName: entry.toolKeyName, displayName: entry.displayName, description: entry.description } TO out
9:   END FOR
10:  RETURN out
11: END METHOD
```

### METHOD status(toolName): Promise<ToolKeyStatus>  (MASKED)

```
20: // @pseudocode REQ-007.2 — masked status; raw key NEVER returned (R-NO-RAW-SECRETS)
21: METHOD status(toolName) RETURNS Promise<ToolKeyStatus>
22:   SET storage = this.deps.getStorage()
23:   SET rawKey = AWAIT storage.getKey(toolName)         // tool-key-storage.ts:299 (string | null)
24:   SET keyFile = AWAIT storage.getKeyfilePath(toolName) // tool-key-storage.ts:248 (string | null)
25:   IF rawKey IS NOT null THEN
26:     RETURN {
27:       toolName,
28:       hasKey: true,
29:       maskedKey: maskKeyForDisplay(rawKey),           // tool-key-storage-types.ts:82
30:       keyFile: keyFile ?? undefined,
31:     }
32:   END IF
33:   RETURN { toolName, hasKey: false, keyFile: keyFile ?? undefined }
34: END METHOD
```

### METHOD save(toolName, key): Promise<void>

```
40: // @pseudocode REQ-007.3 — persist; ToolKeyStorage validates the name (throws on invalid)
41: METHOD save(toolName, key) RETURNS Promise<void>
42:   AWAIT this.deps.getStorage().saveKey(toolName, key)  // tool-key-storage.ts:280
43: END METHOD
```

### METHOD delete(toolName): Promise<void>

```
50: // @pseudocode REQ-007.4
51: METHOD delete(toolName) RETURNS Promise<void>
52:   AWAIT this.deps.getStorage().deleteKey(toolName)     // tool-key-storage.ts:314
53: END METHOD
```

### METHOD setKeyFile(toolName, path): Promise<void>  (null => clear)

```
60: // @pseudocode REQ-007.5 — set or clear; CLI-side path expansion/existence stays UI-level
61: METHOD setKeyFile(toolName, path) RETURNS Promise<void>
62:   IF path IS null THEN
63:     AWAIT this.deps.getStorage().clearKeyfilePath(toolName)  // tool-key-storage.ts:254
64:   ELSE
65:     AWAIT this.deps.getStorage().setKeyfilePath(toolName, path)  // tool-key-storage.ts:241
66:   END IF
67: END METHOD
```

### METHOD getKeyFile(toolName): Promise<string | null>

```
70: // @pseudocode REQ-007.6
71: METHOD getKeyFile(toolName) RETURNS Promise<string | null>
72:   RETURN AWAIT this.deps.getStorage().getKeyfilePath(toolName)  // tool-key-storage.ts:248
73: END METHOD
```

---

## Integration Points (Line-by-Line, REAL symbols)

| Pseudocode line | Real symbol / call | File:line (verified) |
|---|---|---|
| 3 | `getSupportedToolNames(): string[]` | `packages/tools/src/utils/tool-key-storage-types.ts:72`; barrel `core/src/index.ts:473` |
| 6 | `getToolKeyEntry(name): ToolKeyRegistryEntry \| undefined` | `tool-key-storage-types.ts:62`; barrel `index.ts:472` |
| 8 | `ToolKeyRegistryEntry { toolKeyName, displayName, urlParamName, description }` | `tool-key-storage-types.ts:22` |
| 23 | `ToolKeyStorage.getKey(toolName): Promise<string \| null>` | `packages/core/src/tools/tool-key-storage.ts:299` |
| 24/72 | `ToolKeyStorage.getKeyfilePath(toolName): Promise<string \| null>` | `tool-key-storage.ts:248` |
| 29 | `maskKeyForDisplay(key): string` (≤8 → fully masked; else first2+stars+last2) | `tool-key-storage-types.ts:82`; barrel `index.ts:475` |
| 42 | `ToolKeyStorage.saveKey(toolName, key): Promise<void>` | `tool-key-storage.ts:280` |
| 52 | `ToolKeyStorage.deleteKey(toolName): Promise<void>` | `tool-key-storage.ts:314` |
| 63 | `ToolKeyStorage.clearKeyfilePath(toolName): Promise<void>` | `tool-key-storage.ts:254` |
| 65 | `ToolKeyStorage.setKeyfilePath(toolName, filePath): Promise<void>` | `tool-key-storage.ts:241` |
| n/a | `getToolKeyStorage(): ToolKeyStorage` (lazy singleton) | `tool-key-storage.ts:81`; barrel `index.ts:467` |

CLI consumers this unblocks (#1595): `toolkeyCommand.ts` (`new ToolKeyStorage()` → `getKey/saveKey/
deleteKey`) and `toolkeyfileCommand.ts` (`getKeyfilePath/setKeyfilePath/clearKeyfilePath`). CLI-side
`~`-expansion / `path.resolve` / existence / non-empty checks (`toolkeyfileCommand.ts:124-150`) stay
UI-level prevalidation BEFORE calling `setKeyFile(...)`.

---

## Anti-Pattern Warnings

- [ERROR] DO NOT: return the raw key from `status()` (or any method).
  [OK] DO: return `maskKeyForDisplay(rawKey)` as `maskedKey`; raw key never crosses the API boundary
  (R-NO-RAW-SECRETS).
- [ERROR] DO NOT: reuse / alias `Agent.auth.keys` for tool keys.
  [OK] DO: expose a SEPARATE `agent.tools.keys` controller (R-KEYS-DISTINCT).
- [ERROR] DO NOT: re-implement tool-name validation in the controller.
  [OK] DO: let `ToolKeyStorage.assertValidToolName` (invoked inside save/get/delete/keyfile) own it;
  let its throw propagate.
- [ERROR] DO NOT: do `~`-expansion / `fs.access` existence / non-empty validation inside `setKeyFile`.
  [OK] DO: keep those CLI-side (UI prevalidation); the Agent method just persists the given path.
- [ERROR] DO NOT: cache a `ToolKeyStorage` instance field that bypasses the shared singleton.
  [OK] DO: resolve `this.deps.getStorage()` (the shared `getToolKeyStorage()` singleton) per call.
- [ERROR] DO NOT: construct `maskedKey` when `hasKey` is false.
  [OK] DO: omit `maskedKey` entirely when there is no stored key.

---

## Behavior Decision Table

| GIVEN | Method | Result |
|---|---|---|
| registry has Exa | `supported()` | includes `{toolName:"exa", displayName:"Exa Search", description:...}` |
| key stored "abcd1234efgh" | `status("exa")` | `{toolName:"exa", hasKey:true, maskedKey:"ab********gh"}` (first2+stars+last2) |
| key stored "short" (≤8) | `status("exa")` | `maskedKey:"*****"` (fully masked) |
| no key, no keyfile | `status("exa")` | `{toolName:"exa", hasKey:false}` (no maskedKey, no keyFile) |
| keyfile set, no stored key | `status("exa")` | `{toolName:"exa", hasKey:false, keyFile:"/path/key"}` |
| valid name + key | `save("exa","k")` | persists via storage.saveKey |
| invalid name | `save("nope","k")` | storage throws (assertValidToolName) — propagates |
| `setKeyFile("exa", null)` | clear | `clearKeyfilePath("exa")` |
| `setKeyFile("exa","/p")` | set | `setKeyfilePath("exa","/p")` |
| keyfile "/p" configured | `getKeyFile("exa")` | `"/p"` |
| none configured | `getKeyFile("exa")` | `null` |
