# Phase 01: Preflight Verification

## Phase ID

`PLAN-20260211-SECURESTORE.P01`

## Purpose

Verify ALL assumptions before writing any code. This phase prevents planning failures from missing dependencies, wrong types, impossible call patterns, and missing test infrastructure.

## Prerequisites

- Required: Plan documents exist (overview.md, technical-overview.md, requirements.md)
- Required: Pseudocode files exist in analysis/pseudocode/

---

## Dependency Verification

| Dependency | Command | Expected | Status |
|------------|---------|----------|--------|
| `@napi-rs/keyring` | `npm ls @napi-rs/keyring` | Installed (optional dep) | [ ] |
| `vitest` | `npm ls vitest` | Installed (dev dep) | [ ] |
| `node:crypto` | Built-in | Available | [ ] |
| `node:fs/promises` | Built-in | Available | [ ] |
| `node:os` | Built-in | Available | [ ] |

```bash
# Run these commands and paste output:
npm ls @napi-rs/keyring 2>&1 || echo "NOT FOUND (expected as optional)"
npm ls vitest 2>&1 | head -5
node -e "require('crypto'); require('fs'); require('os'); console.log('Built-ins OK')"
```

## Type/Interface Verification

| Type Name | Expected Location | Expected Shape | Actual Shape | Match? |
|-----------|-------------------|----------------|--------------|--------|
| `KeytarAdapter` | `packages/core/src/tools/tool-key-storage.ts` L130-138 | `getPassword`, `setPassword`, `deletePassword` | [verify] | [ ] |
| `findCredentials` in keytar | `packages/core/src/mcp/token-storage/keychain-token-storage.ts` L20-22 | `findCredentials(service): Promise<Array<{account, password}>>` | [verify] | [ ] |
| `CommandContext` | `packages/cli/src/ui/commands/` | Has runtime, isInteractive | [verify] | [ ] |
| `BootstrapProfileArgs` | `packages/cli/src/config/profileBootstrap.ts` L19-28 | Has keyOverride, keyfileOverride | [verify] | [ ] |
| `VALID_EPHEMERAL_SETTINGS` | `packages/cli/src/config/config.ts` L1710-1721 | Array of strings including auth-key, auth-keyfile | [verify] | [ ] |

```bash
# Verify types exist:
grep -n "interface KeytarAdapter\|type KeytarAdapter" packages/core/src/tools/tool-key-storage.ts
grep -n "findCredentials" packages/core/src/mcp/token-storage/keychain-token-storage.ts
grep -n "BootstrapProfileArgs" packages/cli/src/config/profileBootstrap.ts | head -5
grep -n "VALID_EPHEMERAL_SETTINGS\|ephemeralKeys\|validEphemeral" packages/cli/src/config/config.ts | head -5
```

## Call Path Verification

| Function | Expected Location | Expected Caller | Evidence |
|----------|-------------------|-----------------|----------|
| `updateActiveProviderApiKey` | Runtime class | keyCommand, runtimeSettings | [verify] |
| `applyCliArgumentOverrides` | runtimeSettings.ts L2289-2345 | Config/bootstrap flow | [verify] |
| `maskKeyForDisplay` | tool-key-storage.ts L104-110 | keyCommand, toolkeyCommand | [verify] |
| `getToolKeyStorage` | tool-key-storage.ts L114-125 | Module-level singleton | [verify] |

```bash
# Verify call paths:
grep -rn "updateActiveProviderApiKey" packages/cli/src --include="*.ts" | head -5
grep -rn "applyCliArgumentOverrides" packages/cli/src --include="*.ts" | head -5
grep -rn "maskKeyForDisplay" packages/core/src --include="*.ts" | head -5
grep -rn "getToolKeyStorage" packages/core/src --include="*.ts" | head -5
```

## File Existence Verification

| File | Expected | Purpose |
|------|----------|---------|
| `packages/core/src/storage/` | Directory exists | Target for SecureStore |
| `packages/core/src/tools/tool-key-storage.ts` | Exists | Refactoring target |
| `packages/core/src/tools/tool-key-storage.test.ts` | Exists | Must continue passing |
| `packages/core/src/mcp/token-storage/keychain-token-storage.ts` | Exists | Refactoring target |
| `packages/core/src/mcp/token-storage/file-token-storage.ts` | Exists | Elimination target |
| `packages/core/src/mcp/token-storage/hybrid-token-storage.ts` | Exists | Elimination target |
| `packages/cli/src/config/extensions/settingsStorage.ts` | Exists | Refactoring target |
| `packages/cli/src/ui/commands/keyCommand.ts` | Exists | Modification target |
| `packages/cli/src/config/profileBootstrap.ts` | Exists | Modification target |
| `packages/cli/src/runtime/runtimeSettings.ts` | Exists | Modification target |
| `packages/cli/src/ui/utils/secureInputHandler.ts` | Exists | Modification target |

```bash
# Verify all files exist:
ls -la packages/core/src/storage/
ls -la packages/core/src/tools/tool-key-storage.ts
ls -la packages/core/src/tools/tool-key-storage.test.ts
ls -la packages/core/src/mcp/token-storage/keychain-token-storage.ts
ls -la packages/core/src/mcp/token-storage/file-token-storage.ts
ls -la packages/core/src/mcp/token-storage/hybrid-token-storage.ts
ls -la packages/cli/src/config/extensions/settingsStorage.ts
ls -la packages/cli/src/ui/commands/keyCommand.ts
ls -la packages/cli/src/config/profileBootstrap.ts
ls -la packages/cli/src/runtime/runtimeSettings.ts
ls -la packages/cli/src/ui/utils/secureInputHandler.ts
```

## Test Infrastructure Verification

| Component | Test File | Patterns Work? |
|-----------|-----------|---------------|
| ToolKeyStorage | `tool-key-storage.test.ts` | [verify] |
| KeychainTokenStorage | `keychain-token-storage.test.ts` or similar | [verify] |
| Commands | `packages/cli/src/ui/commands/*.test.ts` pattern | [verify] |

```bash
# Verify test patterns:
find packages/core/src -name "*.test.ts" -path "*tool-key*" -o -name "*.test.ts" -path "*token-storage*" | head -10
find packages/cli/src -name "*.test.ts" -path "*command*" | head -10
npm test -- --listTests 2>&1 | grep -i "tool-key\|token-storage\|command" | head -10
```

## Core Export Verification

```bash
# Verify how existing exports are structured:
grep -n "ToolKeyStorage\|isValidToolKeyName\|maskKeyForDisplay" packages/core/src/index.ts 2>/dev/null || \
  find packages/core/src -name "index.ts" -exec grep -ln "export" {} \; | head -5
```

## Interactive Prompt Pattern Verification

```bash
# Verify how other commands handle user prompts/confirmation:
grep -rn "prompt\|confirm\|readline\|question" packages/cli/src/ui/commands/*.ts | head -10
grep -rn "isInteractive\|interactive" packages/cli/src --include="*.ts" | head -10
```

---

## Blocking Issues Found

[To be filled during execution]

## Verification Gate

- [ ] All dependencies verified (or documented as optional)
- [ ] All types match expectations (or plan updated)
- [ ] All call paths are possible (or plan redesigned)
- [ ] All files exist at expected locations
- [ ] Test infrastructure ready
- [ ] Core export pattern understood
- [ ] Interactive prompt pattern identified

**IF ANY CHECKBOX IS UNCHECKED**: STOP and update plan before proceeding to Phase 02.

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P01.md`
Contents: Paste of all verification command outputs and checklist results.
