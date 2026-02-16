# Phase 08: Thin Wrapper Refactoring

## Phase ID

`PLAN-20260211-SECURESTORE.P08`

## Prerequisites

- Required: Phase 07a completed
- Verification: `ls .completed/P07a.md`
- Expected files: Contract tests from P07 passing

## Requirements Implemented (Expanded)

### R7.1: ToolKeyStorage → SecureStore Wrapper

**Full Text**: ToolKeyStorage shall be refactored into a thin wrapper around `SecureStore('llxprt-code-tool-keys')`. It shall retain its registry validation, keyfile path resolution, and `resolveKey()` chain. All keyring loading, probing, encryption, and file I/O logic shall be removed.
**Behavior**:
- GIVEN: ToolKeyStorage with existing API
- WHEN: saveKey('exa', 'key123') is called
- THEN: Delegates to SecureStore.set('exa', 'key123') internally
- AND: Registry validation still rejects invalid tool names
- AND: All existing tests still pass

### R7.2: KeychainTokenStorage → SecureStore Wrapper

**Full Text**: KeychainTokenStorage shall be refactored into a thin wrapper around `SecureStore('llxprt-cli-mcp-oauth')`. It shall retain JSON serialization, credential validation, and `sanitizeServerName()` logic.
**Behavior**:
- GIVEN: KeychainTokenStorage with existing API
- WHEN: setCredentials(server, creds) is called
- THEN: JSON.stringify(creds) is stored via SecureStore
- AND: sanitizeServerName still applied

### R7.5: ExtensionSettingsStorage → SecureStore

**Full Text**: ExtensionSettingsStorage shall be refactored to use SecureStore for sensitive settings storage. Its module-level keytar loading code shall be removed.
**Behavior**:
- GIVEN: ExtensionSettingsStorage
- WHEN: A sensitive setting is stored
- THEN: Uses SecureStore internally
- AND: Non-sensitive .env logic unchanged

### R7.7: No Duplicate Keyring Imports

**Full Text**: After refactoring, no duplicate @napi-rs/keyring import/wrapping code shall remain outside of SecureStore.

## Implementation Tasks

### Files to Modify

#### `packages/core/src/tools/tool-key-storage.ts` — Major refactoring
- REMOVE: `getKeytar()`, `checkKeychainAvailability()`, `deriveEncryptionKey()`, `encrypt()`, `decrypt()`, `ensureToolsDir()`, `saveToKeychain()`, `getFromKeychain()`, `deleteFromKeychain()`, `getEncryptedFilePath()`, `saveToFile()`, `getFromFile()`, `deleteFile()`, `defaultKeytarLoader()` (~300 lines removed)
- KEEP: `ToolKeyStorage` class, `TOOL_KEY_REGISTRY`, `isValidToolKeyName()`, `getToolKeyEntry()`, `getSupportedToolNames()`, `maskKeyForDisplay()`, keyfile operations, `resolveKey()`
- ADD: `SecureStore` import, constructor creates `SecureStore('llxprt-code-tool-keys', { fallbackDir, keytarLoader })`
- ADD: `@plan:PLAN-20260211-SECURESTORE.P08` marker
- Public methods delegate to `this.secureStore.set/get/delete/has`

#### `packages/core/src/mcp/token-storage/keychain-token-storage.ts` — Major refactoring
- REMOVE: Keytar loading logic, probe logic, module-level loader
- KEEP: `sanitizeServerName()`, `validateCredentials()`, JSON serialization, `listServers()`, `getAllCredentials()`
- ADD: `SecureStore` import, internal SecureStore instance
- ADD: `@plan:PLAN-20260211-SECURESTORE.P08` marker

#### `packages/cli/src/config/extensions/settingsStorage.ts` — Moderate refactoring
- REMOVE: Module-level `keytarModule`, `keytarLoadAttempted`, `getKeytar()` (~60 lines)
- KEEP: Non-sensitive .env file logic
- ADD: `SecureStore` usage for sensitive settings
- ADD: `@plan:PLAN-20260211-SECURESTORE.P08` marker

#### `packages/core/src/index.ts` (or barrel export) — Add exports
- ADD: Export `SecureStore`, `SecureStoreError`, `KeytarAdapter`, `SecureStoreOptions` from storage/secure-store

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-SECURESTORE.P08
 * @requirement R7.1
 */
```

## Verification Commands

```bash
# 1. ALL existing tests still pass
npm test
# Expected: ALL PASS

# 2. ToolKeyStorage tests specifically
npm test -- packages/core/src/tools/tool-key-storage.test.ts
# Expected: ALL PASS

# 3. Contract tests from P07 pass
npm test -- packages/core/src/storage/secure-store-integration.test.ts
# Expected: ALL PASS

# 4. No duplicate keyring imports (R7.7)
grep -rn "@napi-rs/keyring" packages/core/src packages/cli/src --include="*.ts" | grep -v "secure-store.ts" | grep -v ".test.ts" | grep -v "node_modules"
# Expected: 0 matches (only SecureStore should import keyring)

# 5. Removed code actually gone
grep -c "scryptSync\|deriveEncryptionKey\|defaultKeytarLoader" packages/core/src/tools/tool-key-storage.ts
# Expected: 0

# 6. Plan markers
grep -c "@plan.*SECURESTORE.P08" packages/core/src/tools/tool-key-storage.ts
# Expected: 1+

# 7. SecureStore exports present
grep "SecureStore\|SecureStoreError" packages/core/src/index.ts 2>/dev/null || echo "Check barrel export location"

# 8. TypeScript compiles
npm run typecheck

# 9. Deferred implementation detection
grep -rn -E "(TODO|FIXME|HACK|STUB)" packages/core/src/tools/tool-key-storage.ts packages/core/src/mcp/token-storage/keychain-token-storage.ts packages/cli/src/config/extensions/settingsStorage.ts
# Expected: no matches
```

## Structural Verification Checklist

- [ ] ToolKeyStorage refactored to use SecureStore
- [ ] KeychainTokenStorage refactored to use SecureStore
- [ ] ExtensionSettingsStorage refactored to use SecureStore
- [ ] ~300 lines removed from ToolKeyStorage
- [ ] Keytar loading removed from all wrappers
- [ ] SecureStore exported from core package
- [ ] All existing tests pass
- [ ] No duplicate keyring imports (R7.7)
- [ ] TypeScript compiles

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/tools/tool-key-storage.ts packages/core/src/mcp/token-storage/keychain-token-storage.ts
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/tools/tool-key-storage.ts
```

## Semantic Verification Checklist (MANDATORY)

1. **Do thin wrappers actually delegate to SecureStore?**
   - [ ] ToolKeyStorage.saveKey calls SecureStore.set
   - [ ] ToolKeyStorage.getKey calls SecureStore.get
   - [ ] KeychainTokenStorage.setCredentials calls SecureStore.set with JSON
   - [ ] ExtensionSettingsStorage uses SecureStore for sensitive data

2. **Are behavioral differences preserved?**
   - [ ] ToolKeyStorage: registry validation before storage
   - [ ] KeychainTokenStorage: JSON serialization wrapping
   - [ ] ExtensionSettingsStorage: no fallback behavior

3. **Is the feature reachable?**
   - [ ] Existing code paths still work (keyCommand → ToolKeyStorage → SecureStore)
   - [ ] MCP OAuth flow still works (HybridTokenStorage → KeychainTokenStorage → SecureStore)

## Failure Recovery

1. `git checkout -- packages/core/src/tools/tool-key-storage.ts`
2. `git checkout -- packages/core/src/mcp/token-storage/keychain-token-storage.ts`
3. `git checkout -- packages/cli/src/config/extensions/settingsStorage.ts`
4. Re-run Phase 08

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P08.md`
