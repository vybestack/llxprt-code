# REIMPLEMENT Playbook: b288f12 — fix(cli): send CLI version as MCP client version

## Upstream Change Summary

**Commit:** b288f124b2cd58b8509481df5f9710ffff0ad716
**Author:** David Soria Parra
**PR:** #13407

### Problem
MCP clients were sending hardcoded version `'0.0.1'` instead of the actual CLI version when connecting to MCP servers. This made debugging and version tracking difficult.

### Solution
1. Added `clientVersion` parameter to `ConfigParameters` and `Config` class
2. Added `clientVersion` parameter to `McpClientManager` constructor
3. Added `clientVersion` parameter to `McpClient` constructor
4. Added `clientVersion` parameter to `connectToMcpServer()` function
5. Modified MCP client initialization to use `getVersion()` for actual version

### Files Changed (Upstream)
- `packages/cli/src/config/config.ts` — Get version, pass to Config and ExtensionManager
- `packages/cli/src/config/extension-manager.ts` — Accept and use clientVersion (**does not exist in LLxprt — see fork mapping below**)
- `packages/core/src/config/config.ts` — Add clientVersion field and pass to McpClientManager
- `packages/core/src/tools/mcp-client-manager.test.ts` — Update all test instantiations
- `packages/core/src/tools/mcp-client-manager.ts` — Add clientVersion param
- `packages/core/src/tools/mcp-client.test.ts` — Update all test instantiations
- `packages/core/src/tools/mcp-client.ts` — Add clientVersion param, use in Client init

---

## LLxprt Current State

### Key Differences from Upstream

1. **Package name:** LLxprt uses `llxprt-code` not `gemini-cli`
2. **Version source:** Need to verify how LLxprt gets its version
3. **Config architecture:** LLxprt has multi-provider auth, config structure may differ
4. **`extension-manager.ts` absent:** `packages/cli/src/config/extension-manager.ts` does **not** exist in LLxprt — skip that step entirely

### Current MCP Client State (Needs Fixing)

**File:** `packages/core/src/tools/mcp-client.ts`

The current LLxprt MCP client still uses hardcoded upstream values:
```typescript
name: 'gemini-cli-mcp-client'   // ← must change to 'llxprt-code-mcp-client'
version: '0.0.1'                 // ← must change to dynamic version from package.json
```

These **must** be updated as part of this playbook.

### Files to Examine

1. `packages/cli/src/config/config.ts` — Check for getVersion usage
2. `packages/core/src/config/config.ts` — Check Config class structure
3. `packages/core/src/tools/mcp-client.ts` — Verify hardcoded name/version (confirmed above)

---

## Fork Mapping: Upstream → LLxprt

| Upstream File | LLxprt Equivalent | Action |
|---------------|-------------------|--------|
| `packages/cli/src/config/config.ts` | `packages/cli/src/config/config.ts` | Locate `Config`/`ConfigParameters` — add `clientVersion` |
| `packages/cli/src/config/extension-manager.ts` | **Does not exist** | Skip — no equivalent |
| `packages/core/src/config/config.ts` | `packages/core/src/config/config.ts` | Add `clientVersion` to `ConfigParameters` interface + `Config` class |
| `packages/core/src/tools/mcp-client-manager.ts` | `packages/core/src/tools/mcp-client-manager.ts` | Add `clientVersion` param to constructor |
| `packages/core/src/tools/mcp-client.ts` | `packages/core/src/tools/mcp-client.ts` | Change hardcoded name + version; add `clientVersion` param |
| `packages/core/src/tools/mcp-client-manager.test.ts` | `packages/core/src/tools/mcp-client-manager.test.ts` | Update test instantiations |
| `packages/core/src/tools/mcp-client.test.ts` | `packages/core/src/tools/mcp-client.test.ts` | Update test instantiations |

### Key Classes / Constructors to Locate

Before editing, locate these in LLxprt source:

- `McpClientManager` constructor signature — `packages/core/src/tools/mcp-client-manager.ts`
- `McpClient` constructor signature — `packages/core/src/tools/mcp-client.ts`
- `connectToMcpServer` function signature — `packages/core/src/tools/mcp-client.ts`
- `ConfigParameters` interface — `packages/core/src/config/config.ts`
- `Config` class — `packages/core/src/config/config.ts`

### Config Threading Plan

```
ConfigParameters.clientVersion? (packages/core/src/config/config.ts)
  → Config stores this.clientVersion (same file)
  → Config.getClientVersion() or direct field access
  → McpClientManager constructor accepts clientVersion: string (mcp-client-manager.ts)
  → McpClientManager passes clientVersion to connectToMcpServer() calls
  → connectToMcpServer(clientVersion, ...) (mcp-client.ts)
  → McpClient constructor accepts clientVersion: string (mcp-client.ts)
  → new Client({ name: 'llxprt-code-mcp-client', version: clientVersion }, ...)
```

---

## Adaptation Plan

### Step 1: Add getVersion() import and usage in CLI config

**File:** `packages/cli/src/config/config.ts`

Search for where ExtensionManager is created. Add:
```typescript
import { getVersion } from '../utils/version.js'; // or similar path
```

Then pass `clientVersion: await getVersion()` to both:
1. `ExtensionManager` constructor (via params)
2. `Config` constructor (via ConfigParameters)

### Step 2: Update ExtensionManager

**File:** `packages/cli/src/config/extension-manager.ts` — **SKIP. This file does not exist in LLxprt.**

### Step 3: Update Core Config

**File:** `packages/core/src/config/config.ts`

1. Add `clientVersion?: string` to `ConfigParameters` interface
2. Add `private clientVersion: string` field to `Config` class
3. Initialize in constructor: `this.clientVersion = params.clientVersion ?? 'unknown'`
4. Pass to `McpClientManager` constructor

### Step 4: Update McpClientManager

**File:** `packages/core/src/tools/mcp-client-manager.ts`

Add `clientVersion: string` as first constructor parameter:
```typescript
constructor(
  clientVersion: string,
  toolRegistry: ToolRegistry,
  cliConfig: Config,
  eventEmitter?: EventEmitter,
) {
  this.clientVersion = clientVersion;
  // ... rest
}
```

Pass `this.clientVersion` to `connectToMcpServer()` calls.

### Step 5: Update McpClient and connectToMcpServer

**File:** `packages/core/src/tools/mcp-client.ts`

1. Add `clientVersion: string` parameter to `McpClient` constructor
2. Add `clientVersion: string` parameter to `connectToMcpServer()` function
3. Replace hardcoded version:
```typescript
const mcpClient = new Client(
  {
    name: 'llxprt-code-mcp-client',  // LLxprt branding!
    version: clientVersion,
  },
  { ... }
);
```

### Step 6: Update All Tests

Update all test files to include clientVersion parameter:
- `packages/core/src/tools/mcp-client-manager.test.ts`
- `packages/core/src/tools/mcp-client.test.ts`

Pattern: Add `'0.0.1'` (or actual test version) as first argument to constructor calls.

---

## Files to Read

| File | Purpose |
|------|---------|
| `packages/cli/src/config/config.ts` | Find ExtensionManager and Config creation |
| `packages/cli/src/utils/version.ts` (or similar) | Find getVersion function |
| `packages/core/src/config/config.ts` | Check Config class structure |
| `packages/core/src/tools/mcp-client.ts` | Check current MCP client version |
| `packages/core/src/tools/mcp-client-manager.ts` | Check McpClientManager constructor |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/cli/src/config/config.ts` | Add getVersion call, pass clientVersion |
| `packages/cli/src/config/extension-manager.ts` | **SKIP — does not exist in LLxprt** |
| `packages/core/src/config/config.ts` | Add clientVersion to interface and class |
| `packages/core/src/tools/mcp-client-manager.ts` | Add clientVersion param |
| `packages/core/src/tools/mcp-client.ts` | Add clientVersion, use in Client |
| `packages/core/src/tools/mcp-client-manager.test.ts` | Update tests |
| `packages/core/src/tools/mcp-client.test.ts` | Update tests |

---

## Specific Verification

```bash
# 1. Run MCP-related tests
npm run test -- packages/core/src/tools/mcp-client.test.ts
npm run test -- packages/core/src/tools/mcp-client-manager.test.ts

# 2. Run full test suite
npm run test

# 3. Verify MCP client sends correct version (integration test or manual)
# Start LLxprt with MCP server configured, check client info
```

---

## LLxprt Branding Notes

- Client name should be `'llxprt-code-mcp-client'` (not `'gemini-cli-mcp-client'`)
- Version should come from LLxprt's package.json
- Ensure version getter works with LLxprt's build system
