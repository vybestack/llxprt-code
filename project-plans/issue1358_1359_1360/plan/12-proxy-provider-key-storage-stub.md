# Phase 12: ProxyProviderKeyStorage — Stub

## Phase ID
`PLAN-20250214-CREDPROXY.P12`

## Prerequisites
- Required: Phase 11a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P11" packages/core/src/auth/proxy/`
- Expected files from previous phase: `proxy-token-store.ts` (fully implemented)

## Requirements Implemented (Expanded)

### R9.1: getKey via Proxy
**Full Text**: When `ProxyProviderKeyStorage.getKey(name)` is called, it shall send a `get_api_key` request. The server shall return the key from `ProviderKeyStorage`.
**Behavior**:
- GIVEN: An API key "OPENAI_API_KEY" stored on the host
- WHEN: `getKey("OPENAI_API_KEY")` is called in the inner process
- THEN: Sends `{op: "get_api_key", payload: {name: "OPENAI_API_KEY"}}` and returns the key value
**Why This Matters**: Inner process needs API keys for provider authentication.

### R9.2: listKeys via Proxy
**Full Text**: When `ProxyProviderKeyStorage.listKeys()` is called, it shall send a `list_api_keys` request.
**Behavior**:
- GIVEN: Keys "OPENAI_API_KEY" and "ANTHROPIC_API_KEY" stored on the host
- WHEN: `listKeys()` is called
- THEN: Returns `["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]`
**Why This Matters**: Allows key enumeration for status/config display.

### R9.3: hasKey via get_api_key Round-Trip
**Full Text**: When `ProxyProviderKeyStorage.hasKey(name)` is called, it shall use a `get_api_key` round-trip and return `true` if non-null.
**Behavior**:
- GIVEN: An API key exists on the host
- WHEN: `hasKey("OPENAI_API_KEY")` is called
- THEN: Returns `true`
**Why This Matters**: Quick existence check without retrieving the full key value.

### R9.4: Write Operations Throw
**Full Text**: If `ProxyProviderKeyStorage.saveKey()` or `deleteKey()` is called in proxy mode, then it shall throw an error.
**Behavior**:
- GIVEN: ProxyProviderKeyStorage in sandbox mode
- WHEN: `saveKey("KEY", "value")` is called
- THEN: Throws "API key management is not available in sandbox mode. Manage keys on the host."
**Why This Matters**: API key management is a host-side administrative action.

### R9.5: Interface Extraction
**Full Text**: A `ProviderKeyStorageInterface` shall be extracted so `ProxyProviderKeyStorage` is substitutable.
**Behavior**:
- GIVEN: Code that uses `ProviderKeyStorage`
- WHEN: `createProviderKeyStorage()` factory returns `ProxyProviderKeyStorage`
- THEN: The code works without modification (structural typing)
**Why This Matters**: Seamless substitution at instantiation sites.

## Implementation Tasks

### Files to Create
- `packages/core/src/auth/proxy/proxy-provider-key-storage.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P12`
  - Methods: `getKey`, `listKeys`, `hasKey`, `saveKey` (throws), `deleteKey` (throws)
  - All read methods throw `new Error('NotYetImplemented')`
  - Write methods throw with sandbox error message
  - Maximum 30 lines

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P12
 * @requirement R9.1-R9.5
 * @pseudocode analysis/pseudocode/004-proxy-provider-key-storage.md
 */
```

## Verification Commands

```bash
test -f packages/core/src/auth/proxy/proxy-provider-key-storage.ts || echo "FAIL"
grep -r "@plan:PLAN-20250214-CREDPROXY.P12" packages/core/src/auth/proxy/ | wc -l
npm run typecheck
```

## Success Criteria
- File created with proper plan markers
- TypeScript compiles cleanly
- Write methods throw with correct error message

## Failure Recovery
1. `git checkout -- packages/core/src/auth/proxy/proxy-provider-key-storage.ts`
2. Re-read pseudocode 004 and retry

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P12.md`
