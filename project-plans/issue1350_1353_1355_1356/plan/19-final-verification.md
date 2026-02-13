# Phase 19: Final Integration Verification

## Phase ID

`PLAN-20260211-SECURESTORE.P19`

## Prerequisites

- Required: ALL previous phases (P01–P18a) completed
- Verification: `ls .completed/P*.md | wc -l` should show all phase markers
- All 93 requirements implemented and tested

## Purpose

This phase performs comprehensive end-to-end verification across all components. It verifies that SecureStore, ProviderKeyStorage, /key commands, and auth-key-name integration work together as a cohesive system — not just as isolated components.

## Full Verification Suite

### 1. Complete Test Suite

```bash
# All tests pass
npm test
# Expected: ALL PASS, zero failures

# TypeScript compiles
npm run typecheck
# Expected: no errors

# Lint passes
npm run lint
# Expected: no errors

# Format check
npm run format
# Expected: no changes needed

# Build succeeds
npm run build
# Expected: clean build
```

### 2. Smoke Test

```bash
# Application starts and runs
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"
# Expected: haiku output, clean exit
```

### 3. Plan Marker Audit

```bash
# All plan phases have markers in code
for phase in P01 P04 P05 P06 P07 P08 P09 P10 P11 P12 P13 P14 P15 P16 P17 P18; do
  count=$(grep -r "@plan.*SECURESTORE.$phase\b" packages/ --include="*.ts" | wc -l)
  echo "$phase: $count markers"
done

# All requirements have markers
for req in R1 R2 R3 R4 R5 R6 R7 R8 R9 R10 R11 R12 R13 R14 R15 R16 R17 R18 R19 R20 R21 R22 R23 R24 R25 R26 R27; do
  count=$(grep -r "@requirement.*$req" packages/ --include="*.ts" | wc -l)
  echo "$req: $count markers"
done
```

### 4. Deferred Implementation Detection (ALL FILES)

```bash
# Scan ALL implementation files for deferred work
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" \
  packages/core/src/storage/ \
  packages/core/src/tools/tool-key-storage.ts \
  packages/core/src/mcp/token-storage/ \
  packages/cli/src/ui/commands/keyCommand.ts \
  packages/cli/src/config/profileBootstrap.ts \
  packages/cli/src/config/config.ts \
  packages/cli/src/runtime/runtimeSettings.ts \
  packages/cli/src/config/extensions/settingsStorage.ts \
  --include="*.ts" | grep -v ".test.ts" | grep -v node_modules

# Scan for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" \
  packages/core/src/storage/ \
  packages/core/src/tools/tool-key-storage.ts \
  packages/core/src/mcp/token-storage/ \
  packages/cli/src/ui/commands/keyCommand.ts \
  packages/cli/src/config/ \
  packages/cli/src/runtime/runtimeSettings.ts \
  --include="*.ts" | grep -v ".test.ts" | grep -v node_modules
```

### 5. No Duplicate Keyring Code

```bash
# Only SecureStore should import @napi-rs/keyring
grep -rn "napi-rs/keyring" packages/ --include="*.ts" | grep -v ".test.ts" | grep -v node_modules | grep -v "secure-store.ts"
# Expected: 0 matches (R7.7)

# No duplicate keytar loading outside SecureStore
grep -rn "getKeytar\|keytarLoadAttempted\|keytarModule" packages/ --include="*.ts" | grep -v ".test.ts" | grep -v node_modules | grep -v "secure-store.ts"
# Expected: 0 matches
```

### 6. Eliminated Code Verification

```bash
# FileTokenStorage eliminated (R7.3)
ls packages/core/src/mcp/token-storage/file-token-storage.ts 2>/dev/null && echo "FAIL: FileTokenStorage still exists" || echo "OK: FileTokenStorage removed"

# HybridTokenStorage eliminated (R7.4)
ls packages/core/src/mcp/token-storage/hybrid-token-storage.ts 2>/dev/null && echo "FAIL: HybridTokenStorage still exists" || echo "OK: HybridTokenStorage removed"

# No references to eliminated code
grep -rn "FileTokenStorage\|HybridTokenStorage" packages/ --include="*.ts" | grep -v ".test.ts" | grep -v node_modules
# Expected: 0 matches
```

### 7. Integration Chain Verification

```bash
# SecureStore is used by ProviderKeyStorage
grep "SecureStore" packages/core/src/storage/provider-key-storage.ts

# SecureStore is used by ToolKeyStorage
grep "SecureStore" packages/core/src/tools/tool-key-storage.ts

# SecureStore is used by KeychainTokenStorage
grep "SecureStore" packages/core/src/mcp/token-storage/keychain-token-storage.ts

# SecureStore is used by ExtensionSettingsStorage
grep "SecureStore" packages/cli/src/config/extensions/settingsStorage.ts

# ProviderKeyStorage is used by keyCommand
grep "ProviderKeyStorage\|getProviderKeyStorage" packages/cli/src/ui/commands/keyCommand.ts

# ProviderKeyStorage is used by runtimeSettings
grep "ProviderKeyStorage\|getProviderKeyStorage" packages/cli/src/runtime/runtimeSettings.ts

# keyNameOverride flows through bootstrap → config → runtime
grep "keyNameOverride" packages/cli/src/config/profileBootstrap.ts packages/cli/src/config/config.ts packages/cli/src/runtime/runtimeSettings.ts
```

### 8. Export Verification

```bash
# SecureStore exported from core
grep "SecureStore" packages/core/src/index.ts 2>/dev/null || echo "Check export barrel"

# ProviderKeyStorage exported from core
grep "ProviderKeyStorage\|getProviderKeyStorage" packages/core/src/index.ts 2>/dev/null || echo "Check export barrel"

# maskKeyForDisplay available for import
grep "maskKeyForDisplay" packages/core/src/index.ts 2>/dev/null || echo "Check export barrel"
```

### 9. Security Verification

```bash
# No secret values logged
grep -rn "console.log\|console.debug\|console.info" packages/core/src/storage/ packages/cli/src/ui/commands/keyCommand.ts --include="*.ts" | grep -v ".test.ts"
# Manual review: none of these log API keys or tokens

# Fallback files use 0o600 permissions
grep "0o600\|0600\|384" packages/core/src/storage/secure-store.ts

# Fallback directory uses 0o700 permissions
grep "0o700\|0700\|448" packages/core/src/storage/secure-store.ts
```

### 10. Pseudocode Compliance Summary

Verify each implementation phase referenced its pseudocode:

```bash
echo "=== SecureStore ==="
grep -c "@pseudocode" packages/core/src/storage/secure-store.ts

echo "=== ProviderKeyStorage ==="
grep -c "@pseudocode" packages/core/src/storage/provider-key-storage.ts

echo "=== keyCommand ==="
grep -c "@pseudocode" packages/cli/src/ui/commands/keyCommand.ts

echo "=== profileBootstrap ==="
grep -c "@pseudocode" packages/cli/src/config/profileBootstrap.ts

echo "=== runtimeSettings ==="
grep -c "@pseudocode" packages/cli/src/runtime/runtimeSettings.ts
```

## Full Requirement Traceability Audit

For each requirement group, verify implementation exists AND tests exist:

| Req Group | Implementation File | Test File | All Tests Pass? |
|-----------|-------------------|-----------|----------------|
| R1 (Keyring Access) | secure-store.ts | secure-store.test.ts | [ ] |
| R2 (Availability Probe) | secure-store.ts | secure-store.test.ts | [ ] |
| R3 (CRUD) | secure-store.ts | secure-store.test.ts | [ ] |
| R4 (Encrypted Fallback) | secure-store.ts | secure-store.test.ts | [ ] |
| R5 (No Backward Compat) | secure-store.ts | secure-store.test.ts | [ ] |
| R6 (Error Taxonomy) | secure-store.ts | secure-store.test.ts | [ ] |
| R7 (Thin Wrappers) | tool-key-storage.ts, keychain-token-storage.ts, settingsStorage.ts | respective test files | [ ] |
| R7A (Behavioral Audit) | analysis/domain-model.md | N/A | [ ] |
| R7B (Resilience) | secure-store.ts | secure-store.test.ts | [ ] |
| R7C (Legacy Messaging) | Thin wrappers (tool-key-storage.ts, keychain-token-storage.ts) | wrapper contract tests (P07) | [ ] |
| R8 (Observability) | secure-store.ts | secure-store.test.ts | [ ] |
| R9 (PKS CRUD) | provider-key-storage.ts | provider-key-storage.test.ts | [ ] |
| R10 (Name Validation) | provider-key-storage.ts | provider-key-storage.test.ts | [ ] |
| R11 (Platform) | provider-key-storage.ts | provider-key-storage.test.ts | [ ] |
| R12 (Parsing) | keyCommand.ts | keyCommand.test.ts | [ ] |
| R13 (/key save) | keyCommand.ts | keyCommand.test.ts | [ ] |
| R14 (/key load) | keyCommand.ts | keyCommand.test.ts | [ ] |
| R15 (/key show) | keyCommand.ts | keyCommand.test.ts | [ ] |
| R16 (/key list) | keyCommand.ts | keyCommand.test.ts | [ ] |
| R17 (/key delete) | keyCommand.ts | keyCommand.test.ts | [ ] |
| R18 (Storage Failure) | keyCommand.ts | keyCommand.test.ts | [ ] |
| R19 (Autocomplete) | keyCommand.ts | keyCommand.test.ts | [ ] |
| R20 (Secure Input) | secureInputHandler.ts, keyCommand.ts | keyCommand.test.ts | [ ] |
| R21 (auth-key-name) | profileBootstrap.ts, config.ts, runtimeSettings.ts | runtimeSettings.test.ts | [ ] |
| R22 (--key-name) | profileBootstrap.ts, runtimeSettings.ts | runtimeSettings.test.ts | [ ] |
| R23 (Precedence) | runtimeSettings.ts | runtimeSettings.test.ts | [ ] |
| R24 (Error Handling) | runtimeSettings.ts | runtimeSettings.test.ts | [ ] |
| R25 (Diagnostics) | runtimeSettings.ts | runtimeSettings.test.ts | [ ] |
| R26 (No Deprecations) | all auth files | runtimeSettings.test.ts | [ ] |
| R27 (Test Acceptance) | test files | self-referential | [ ] |

## Holistic Functionality Assessment (MANDATORY)

### System Architecture Summary

The verifier MUST write a complete description of:
1. How SecureStore works (keyring + fallback)
2. How each thin wrapper delegates to SecureStore
3. How /key commands provide user access
4. How auth-key-name / --key-name integrate with session bootstrap
5. The complete data flow from CLI arg → stored key → active session

### Integration Health

The verifier MUST confirm:
- [ ] SecureStore is the ONLY component that touches keyring or encrypted files
- [ ] All four original implementations are refactored (R7) or eliminated (R7.3, R7.4)
- [ ] ProviderKeyStorage provides the bridge between SecureStore and CLI/profile
- [ ] /key commands are accessible to users in the CLI
- [ ] auth-key-name and --key-name are accessible to users in profiles/CLI
- [ ] The feature cannot be built in isolation — it modifies existing code paths

### What Could Go Wrong?

- [ ] Keyring unavailable + fallback policy 'deny' → error path tested
- [ ] Concurrent access to fallback files → atomic write tested
- [ ] Platform differences (macOS vs Linux vs Windows) → documented
- [ ] Missing named key → error not silent fallthrough

### Final Verdict

[PASS/FAIL with comprehensive explanation]

## Success Criteria

- ALL tests pass (npm test, npm run typecheck, npm run lint, npm run format, npm run build)
- Smoke test succeeds
- No deferred implementation patterns found
- No duplicate keyring code outside SecureStore
- FileTokenStorage and HybridTokenStorage eliminated
- All 93 requirements traceable to implementation + tests
- Full integration chain verified
- No secret values in logs

## Failure Recovery

If final verification fails:
1. Identify which requirement/component is deficient
2. Return to the relevant implementation phase
3. Fix the issue following the Stub → TDD → Impl cycle
4. Re-run final verification

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P19.md`
Contents must include:
- Full holistic functionality assessment
- All verification command outputs
- Requirement traceability table (filled in)
- Final verdict with explanation
