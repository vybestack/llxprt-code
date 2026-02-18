# Phase 00a: Preflight Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P00a`

## Purpose
Verify ALL assumptions before writing any code. This phase prevents the most common planning failures: missing dependencies, wrong types, and impossible call patterns.

## Dependency Verification

| Dependency | npm ls Command | Status |
|------------|---------------|--------|
| `node:net` | Built-in Node.js module | Verify: `node -e "require('net')"` |
| `node:crypto` | Built-in Node.js module | Verify: `node -e "require('crypto')"` |
| `node:os` | Built-in Node.js module | Verify: `node -e "require('os')"` |
| `node:fs` | Built-in Node.js module | Verify: `node -e "require('fs')"` |
| `google-auth-library` | `npm ls google-auth-library` | Needed for Gemini OAuth2Client |
| `vitest` | `npm ls vitest` | Test framework |
| `zod` | `npm ls zod` | Schema validation |

## Type/Interface Verification

| Type Name | Expected Definition | File to Check | Match? |
|-----------|---------------------|---------------|--------|
| `TokenStore` | Interface with `getToken`, `saveToken`, `removeToken`, `listProviders`, `listBuckets`, `getBucketStats`, `acquireRefreshLock`, `releaseRefreshLock` | `packages/core/src/auth/token-store.ts` | |
| `OAuthToken` | Zod-derived type with `access_token`, `expiry`, `token_type`, `scope?`, `refresh_token?` | `packages/core/src/auth/oauth-schemas.ts` or similar | |
| `OAuthTokenSchema` | Zod schema with `.passthrough()` support | Same file as OAuthToken | |
| `KeyringTokenStore` | Class implementing `TokenStore`, with `acquireRefreshLock`/`releaseRefreshLock` methods | `packages/core/src/auth/keyring-token-store.ts` | |
| `ProviderKeyStorage` | Concrete class with `getKey`, `saveKey`, `deleteKey`, `listKeys`, `hasKey` | `packages/core/src/storage/provider-key-storage.ts` | |
| `OAuthProvider` | Interface with `refreshToken(currentToken: OAuthToken)` method | `packages/core/src/auth/` or `packages/cli/src/providers/` | |
| `AnthropicDeviceFlow` | Class with `initiateDeviceFlow()`, `exchangeCodeForToken()` | `packages/cli/src/providers/anthropic/` | |
| `CodexDeviceFlow` | Class with `buildAuthorizationUrl()`, `requestDeviceCode()`, `exchangeCodeForToken()`, `pollForDeviceToken()`, `completeDeviceAuth()` | `packages/cli/src/providers/codex/` | |
| `QwenDeviceFlow` | Class with `initiateDeviceFlow()`, `pollForToken()` | `packages/cli/src/providers/qwen/` | |
| `mergeRefreshedToken` | Module-private function in OAuthManager (needs extraction) | `packages/cli/src/auth/oauth-manager.ts` line ~78 | |
| `OAuthTokenWithExtras` | Type alias = `OAuthToken & Record<string, unknown>` | Same file as mergeRefreshedToken | |

## Call Path Verification

| Function | Expected Caller | Evidence Command |
|----------|-----------------|------------------|
| `KeyringTokenStore.getToken()` | OAuthManager, authCommand, runtimeContextFactory | `grep -r "getToken" packages/cli/src --include="*.ts" \| head -20` |
| `KeyringTokenStore.saveToken()` | OAuthManager, authCommand | `grep -r "saveToken" packages/cli/src --include="*.ts" \| head -20` |
| `KeyringTokenStore.acquireRefreshLock()` | OAuthManager | `grep -r "acquireRefreshLock" packages/ --include="*.ts" \| head -10` |
| `new KeyringTokenStore()` | 5+ instantiation sites per technical-overview.md §2 | `grep -rn "new KeyringTokenStore" packages/cli/src --include="*.ts"` |
| `getProviderKeyStorage()` | keyCommand.ts | `grep -rn "getProviderKeyStorage" packages/cli/src --include="*.ts"` |
| `start_sandbox()` | sandbox.ts entry point | `grep -rn "start_sandbox\|startSandbox" packages/cli/src --include="*.ts"` |
| `mergeRefreshedToken` | OAuthManager internal | `grep -rn "mergeRefreshedToken" packages/ --include="*.ts"` |
| `os.tmpdir()` volume mount in sandbox.ts | sandbox.ts line ~1025 | `grep -rn "tmpdir" packages/cli/src/utils/sandbox.ts` |
| `scheduleProactiveRenewal` | OAuthManager | `grep -rn "scheduleProactiveRenewal\|proactiveRenew" packages/ --include="*.ts"` |
| `isBrowserLaunchSuppressed` | Gemini OAuth config | `grep -rn "isBrowserLaunchSuppressed" packages/ --include="*.ts"` |

## Test Infrastructure Verification

| Component | Test File Exists? | Check Command |
|-----------|-------------------|---------------|
| KeyringTokenStore | | `ls packages/core/src/auth/__tests__/ 2>/dev/null \|\| ls packages/core/src/auth/*.test.ts 2>/dev/null` |
| OAuthManager | | `find packages/cli/src -path "*oauth*test*" -o -path "*oauth*.spec.*"` |
| ProviderKeyStorage | | `find packages/core/src/storage -name "*.test.ts" -o -name "*.spec.ts"` |
| sandbox.ts | | `find packages/cli/src/utils -name "*sandbox*test*" -o -name "*sandbox*.spec.*"` |
| Vitest config | | `find packages/ -name "vitest*" -maxdepth 3` |

## Blocking Issues to Investigate

1. **`mergeRefreshedToken` extraction**: Currently module-private in `oauth-manager.ts`. Must be exported/extracted to `packages/core/src/auth/token-merge.ts`. Verify it can be extracted without circular dependencies.
2. **`ProviderKeyStorage` interface**: No extracted interface exists. Verify structural typing sufficiency or plan interface extraction.
3. **Gemini `authWithUserCode()` decomposition**: Currently monolithic. Need to verify the PKCE generation + auth URL + code exchange steps can be decomposed into importable utilities.
4. **macOS `os.tmpdir()` symlink resolution**: Verify that `sandbox.ts` line ~1025 uses raw `os.tmpdir()` (needs change to `realpathSync`).
5. **Docker Desktop macOS UDS support**: Verify whether Unix domain sockets traverse VirtioFS VM boundary.

## Verification Gate

- [ ] All dependencies verified (npm ls or built-in check)
- [ ] All types match expectations (grep + read actual definitions)
- [ ] All call paths are possible (grep evidence gathered)
- [ ] Test infrastructure ready (vitest config, existing test patterns observed)
- [ ] Blocking issues documented with resolution plans

**IF ANY CHECKBOX IS UNCHECKED: STOP and update plan before proceeding to Phase 01.**

## Verification Commands

```bash
# Run all verifications in one pass:
echo "=== Dependency Verification ===" && \
node -e "require('net'); require('crypto'); require('os'); require('fs'); console.log('Built-ins OK')" && \
cd packages/core && npm ls google-auth-library 2>/dev/null && cd ../.. && \
echo "=== Type Verification ===" && \
grep -rn "interface TokenStore" packages/core/src --include="*.ts" | head -5 && \
grep -rn "OAuthTokenSchema\|OAuthToken " packages/core/src --include="*.ts" | head -5 && \
grep -rn "class KeyringTokenStore" packages/core/src --include="*.ts" | head -3 && \
grep -rn "class ProviderKeyStorage" packages/core/src --include="*.ts" | head -3 && \
echo "=== Call Path Verification ===" && \
grep -rn "new KeyringTokenStore" packages/cli/src --include="*.ts" && \
grep -rn "getProviderKeyStorage" packages/cli/src --include="*.ts" | head -5 && \
grep -rn "mergeRefreshedToken" packages/ --include="*.ts" | head -5 && \
echo "=== Test Infrastructure ===" && \
find packages/ -name "vitest*" -maxdepth 3 2>/dev/null
```


## Anti-Fake / Anti-Fraud Verification (MANDATORY)
- [ ] No test-environment branching in production code (for example: NODE_ENV checks, JEST_WORKER_ID, VITEST, process.env.TEST, isTest guards) unless explicitly required by specification.
- [ ] No fixture-hardcoded behavior in production code for known test values, providers, buckets, or session IDs.
- [ ] No mock theater: tests verify semantic outputs, state transitions, or externally visible side effects; not only call counts.
- [ ] No structure-only assertions as sole proof (toHaveProperty/toBeDefined without value-level behavior assertions).
- [ ] No deferred implementation artifacts in non-stub phases (TODO/FIXME/HACK/placeholder/NotYetImplemented/empty return shortcuts).
- [ ] Security invariants are actively checked where relevant: refresh_token and auth artifacts are never returned across proxy boundaries or logged in full.
- [ ] Failure-path assertions exist (invalid request, unauthorized, timeout, rate limit, session errors) to prevent happy-path-only implementations from passing.

### Anti-Fraud Command Checks
- Run: grep -rn -E "(NODE_ENV|JEST_WORKER_ID|VITEST|process\.env\.TEST|isTest\()" packages --include="*.ts" | grep -v ".test.ts"
- Run: grep -rn -E "(toHaveBeenCalled|toHaveBeenCalledWith)" [phase-test-files]
- Run: grep -rn -E "(toHaveProperty|toBeDefined|toBeUndefined)" [phase-test-files]
- Run: grep -rn -E "(TODO|FIXME|HACK|placeholder|NotYetImplemented|return \[\]|return \{\}|return null|return undefined)" [phase-impl-files] | grep -v ".test.ts"
- Run: grep -rn "refresh_token" packages/cli/src/auth/proxy packages/core/src/auth --include="*.ts" | grep -v ".test.ts"

## Phase Completion Marker

Create: `project-plans/issue1358_1359_1360/.completed/P00a.md`
Contents:
```markdown
Phase: P00a
Completed: YYYY-MM-DD HH:MM
Dependencies Verified: [list]
Types Verified: [list with match status]
Call Paths Verified: [list with evidence]
Blocking Issues: [list with resolution status]
```
