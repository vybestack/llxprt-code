# REIMPLEMENT Playbook: 0fa9a54 — fix(patch): auth failure handling

## Upstream Change Summary

**Commit:** 0fa9a5408878a6af9d314ef55c2ea19a035f950c
**Author:** gemini-cli-robot (cherry-pick)
**PR:** #17317

### Problem
When authentication failed during startup, the CLI would immediately exit with `FATAL_AUTHENTICATION_ERROR`. However, if running in a sandbox, this exit happened before the sandbox was properly set up, causing issues with cleanup and error reporting.

### Solution
Changed the auth failure handling:
1. Store auth failure in a flag (`initialAuthFailed = true`) instead of immediate exit
2. Only exit with `FATAL_AUTHENTICATION_ERROR` after sandbox config is confirmed
3. This ensures proper cleanup in sandboxed environments

### Files Changed (Upstream)
- `packages/cli/src/gemini.test.tsx` — Added mock for getRemoteAdminSettings and isInteractive
- `packages/cli/src/gemini.tsx` — Added initialAuthFailed flag, delayed exit

---

## LLxprt Current State

### Key Differences

1. **Multi-provider auth:** LLxprt uses `providerManager`, `switchActiveProvider`, and `config.refreshAuth()` — not upstream's early single-auth `process.exit(FATAL_AUTHENTICATION_ERROR)` block
2. **No remoteAdminSettings / no CCPA:** LLxprt does not have `getRemoteAdminSettings`. Do NOT reference it unless LLxprt code actually calls it.
3. **No `security.auth.selectedType` / `useExternal` gating:** LLxprt auth is provider-agnostic; auth failure is handled by `validateNonInteractiveAuth` (non-interactive path) and by `providerManager` activation (interactive path)
4. **`FATAL_AUTHENTICATION_ERROR` already used** in `validateNonInteractiveAuth.ts` line 69 — this is the LLxprt equivalent of the upstream exit point

### Files to Check

1. `packages/cli/src/validateNonInterActiveAuth.ts` — Non-interactive auth with `FATAL_AUTHENTICATION_ERROR`
2. `packages/cli/src/config/config.ts` — `refreshAuth()` implementation
3. `packages/cli/src/config/sandboxConfig.ts` — `loadSandboxConfig` / `SandboxConfig`
4. `packages/cli/src/gemini.provider-init.test.ts` — Existing provider init test patterns

---

## Adaptation Plan

### Step 1: Locate the auth failure point

**File:** `packages/cli/src/validateNonInterActiveAuth.ts`

The LLxprt equivalent of the upstream exit-on-auth-failure is at line 69:
```typescript
process.exit(ExitCodes.FATAL_AUTHENTICATION_ERROR);
```

This fires in non-interactive mode when no provider and no env-var auth is found. For interactive mode, `refreshAuth()` is called later in startup.

**Find whether `refreshAuth()` is called during startup before sandbox resolution.** Check `packages/cli/src/config/config.ts` around the `loadSandboxConfig` call (line 1274) to understand the ordering: is sandbox loaded before or after auth initialization?

### Step 2: Implement provider-agnostic delayed exit

The upstream pattern (store failure, defer exit until after sandbox decision) applies to LLxprt's non-interactive path. The adaptation is:

**Current pattern in `validateNonInteractiveAuth`:**
```typescript
if (!hasProvider && !hasEnvAuth) {
  reportNonInteractiveAuthError(...);
  process.exit(ExitCodes.FATAL_AUTHENTICATION_ERROR);  // immediate exit
}
```

**If sandbox is not yet resolved when this runs,** defer the exit:
```typescript
let initialAuthFailed = false;

if (!hasProvider && !hasEnvAuth) {
  reportNonInteractiveAuthError(...);
  initialAuthFailed = true;
}

// ... after sandbox config is known:
if (initialAuthFailed) {
  await runExitCleanup?.();
  process.exit(ExitCodes.FATAL_AUTHENTICATION_ERROR);
}
```

**Only apply this change if** sandbox config is resolved after the auth check. If sandbox is already determined before `validateNonInteractiveAuth` is called, the existing immediate exit is correct and no change is needed.

### Step 3: Provider activation auth failure

For the interactive path, if `switchActiveProvider` fails during startup (provider-specific auth failure) and sandbox is configured, the same defer-exit pattern applies:

```typescript
let initialAuthFailed = false;

try {
  await config.refreshAuth();
} catch (err) {
  debugLogger.error('Error authenticating:', err);
  initialAuthFailed = true;
}

// After sandbox config determination:
if (sandboxConfig && initialAuthFailed) {
  await runExitCleanup?.();
  process.exit(ExitCodes.FATAL_AUTHENTICATION_ERROR);
}
```

Do NOT gate this on `security.auth.selectedType` or `useExternal` — those are upstream-only constructs.

### Step 4: Update tests

**File:** `packages/cli/src/gemini.provider-init.test.ts` (existing test file)

Add tests for:
1. Provider activation auth failure with sandbox configured → exit deferred until after sandbox decision
2. Default provider lazy-auth path (no early auth) with sandbox → no premature exit

```typescript
// Simulate provider activation auth failure with sandbox
vi.mocked(loadCliConfig).mockResolvedValue({
  refreshAuth: vi.fn().mockRejectedValue(new Error('Auth failed')),
  getProviderManager: vi.fn(() => mockProviderManager),
  // ... other required mocks
} as unknown as Config);
```

Do NOT mock `getRemoteAdminSettings` unless it appears in actual LLxprt startup code.

---

## Files to Read

| File | Purpose |
|------|---------|
| `packages/cli/src/validateNonInterActiveAuth.ts` | Primary auth exit point |
| `packages/cli/src/config/config.ts` | `refreshAuth()` and `loadSandboxConfig` ordering |
| `packages/cli/src/config/sandboxConfig.ts` | `SandboxConfig` type, `loadSandboxConfig` |
| `packages/cli/src/gemini.provider-init.test.ts` | Existing provider init test patterns |
| `packages/core/src/utils/exitCodes.ts` | `FATAL_AUTHENTICATION_ERROR` exit code |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/cli/src/validateNonInterActiveAuth.ts` | Add deferred exit if sandbox not yet resolved (only if ordering requires it) |
| `packages/cli/src/gemini.provider-init.test.ts` | Add auth-failure-with-sandbox test cases |

---

## Specific Verification

```bash
# 1. Run provider init tests
npm run test -- packages/cli/src/gemini.provider-init.test.ts

# 2. Run validateNonInteractiveAuth tests
npm run test -- packages/cli/src/validateNonInterActiveAuth.test.ts

# 3. Run full test suite
npm run test

# 4. Manual test:
# - Configure invalid/missing auth credentials
# - Run LLxprt with sandbox enabled (e.g., --sandbox)
# - Verify proper error exit (code 41) and cleanup before sandbox launch
```

---

## LLxprt-Specific Notes

### Provider-Agnostic Auth Failure

LLxprt's auth is not tied to a single provider. The sandbox-safe exit behavior must be provider-agnostic:
- `refreshAuth()` in `config.ts` dispatches to the active provider
- Auth failure from any provider (anthropic, openai, gemini, etc.) should follow the same deferred-exit pattern when sandbox is configured

### Do NOT Use

- `getRemoteAdminSettings` — not in LLxprt codebase
- `security.auth.selectedType` — upstream-only; LLxprt uses `providerManager.getActiveProviderName()`
- `security.auth.useExternal` — upstream-only; LLxprt uses `useExternalAuth` parameter in `validateNonInteractiveAuth`
- Google/CCPA-specific references

### Testing Notes

For testing auth failure with sandbox:
1. Mock `refreshAuth()` to throw error  
2. Ensure `sandboxConfig` is defined (mock `loadSandboxConfig` to return a config)
3. Verify exit code is `ExitCodes.FATAL_AUTHENTICATION_ERROR` (41)
4. Verify cleanup runs before sandbox launch
5. Use `gemini.provider-init.test.ts` patterns for mock structure (already has `refreshAuth` and `getProviderManager` mocks)
