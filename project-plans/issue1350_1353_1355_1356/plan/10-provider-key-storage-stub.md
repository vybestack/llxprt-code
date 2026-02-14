# Phase 10: ProviderKeyStorage Stub

## Phase ID

`PLAN-20260211-SECURESTORE.P10`

## Prerequisites

- Required: Phase 09a completed
- Verification: `ls .completed/P09a.md`
- Expected: SecureStore implemented, wrappers refactored, legacy eliminated

## Requirements Implemented (Expanded)

### R9.1: ProviderKeyStorage Backed by SecureStore

**Full Text**: ProviderKeyStorage shall be backed by a SecureStore instance with service name `llxprt-code-provider-keys` and fallback directory `~/.llxprt/provider-keys/` with fallback policy `'allow'`.
**Behavior (stub)**: Class constructor creates SecureStore instance with correct config.

### R10.1: Key Name Validation

**Full Text**: ProviderKeyStorage shall validate key names against the regex `^[a-zA-Z0-9._-]{1,64}$`.
**Behavior (stub)**: Validation function exists with correct regex.

## Implementation Tasks

### Files to Create

- `packages/core/src/storage/provider-key-storage.ts` — ProviderKeyStorage class stub
  - MUST include: `@plan:PLAN-20260211-SECURESTORE.P10`
  - MUST include: `@requirement:R9.1, R10.1`
  - Class: `ProviderKeyStorage`
  - Functions: `validateKeyName`, `getProviderKeyStorage`, `resetProviderKeyStorage`
  - Constants: `KEY_NAME_REGEX`, `SERVICE_NAME`, `FALLBACK_DIR`
  - Methods: `saveKey`, `getKey`, `deleteKey`, `listKeys`, `hasKey` — all throw NotYetImplemented
  - Maximum ~60 lines

### Stub Structure

```typescript
/**
 * @plan PLAN-20260211-SECURESTORE.P10
 * @requirement R9.1
 */
export class ProviderKeyStorage {
  private readonly secureStore: SecureStore;

  constructor(options?: { secureStore?: SecureStore }) {
    this.secureStore = options?.secureStore ?? new SecureStore(SERVICE_NAME, {
      fallbackDir: FALLBACK_DIR,
      fallbackPolicy: 'allow',
    });
  }

  async saveKey(name: string, apiKey: string): Promise<void> {
    throw new Error('NotYetImplemented');
  }
  // ... etc
}
```

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-SECURESTORE.P10
 * @requirement R9.1
 */
```

## Verification Commands

```bash
# 1. File created
ls packages/core/src/storage/provider-key-storage.ts

# 2. Plan markers
grep -c "@plan.*SECURESTORE.P10" packages/core/src/storage/provider-key-storage.ts
# Expected: 2+

# 3. TypeScript compiles
npm run typecheck

# 4. Class exported
grep "export class ProviderKeyStorage" packages/core/src/storage/provider-key-storage.ts

# 5. All methods present
for method in "saveKey" "getKey" "deleteKey" "listKeys" "hasKey"; do
  grep -q "$method" packages/core/src/storage/provider-key-storage.ts && echo "OK: $method" || echo "MISSING: $method"
done

# 6. Key name validation present
grep "KEY_NAME_REGEX\|validateKeyName" packages/core/src/storage/provider-key-storage.ts

# 7. Singleton present
grep "getProviderKeyStorage" packages/core/src/storage/provider-key-storage.ts

# 8. No TODO comments
grep "TODO" packages/core/src/storage/provider-key-storage.ts
```

## Structural Verification Checklist

- [ ] File created at correct path
- [ ] ProviderKeyStorage class exported
- [ ] All 5 public methods present
- [ ] Constructor creates SecureStore with correct config
- [ ] Key name validation function present
- [ ] Singleton function present
- [ ] TypeScript compiles
- [ ] No TODO comments

## Semantic Verification Checklist (MANDATORY)

1. **Does the stub have the correct API surface?**
   - [ ] `ProviderKeyStorage` class exported with correct constructor signature (`options?: { secureStore?: SecureStore }`)
   - [ ] All five public methods present: `saveKey(name, apiKey)`, `getKey(name)`, `deleteKey(name)`, `listKeys()`, `hasKey(name)`
   - [ ] Constructor accepts optional `SecureStore` injection for testing
   - [ ] Singleton functions exported: `getProviderKeyStorage()`, `resetProviderKeyStorage()`
   - [ ] `KEY_NAME_REGEX` constant exported with pattern `^[a-zA-Z0-9._-]{1,64}$`
   - [ ] `validateKeyName()` function exported

2. **Is this a valid stub (not empty shell)?**
   - [ ] All five CRUD methods throw `NotYetImplemented` (not return `undefined` silently)
   - [ ] `validateKeyName()` has real regex validation (not a stub — this is needed for TDD tests)
   - [ ] TypeScript strict mode satisfied (correct return types, no `any` escapes)
   - [ ] Constructor creates `SecureStore` with service name `'llxprt-code-provider-keys'`, fallback dir `~/.llxprt/provider-keys/`, policy `'allow'`

3. **Would TDD tests be writable against this stub?**
   - [ ] Tests can import `ProviderKeyStorage`, `getProviderKeyStorage`, `resetProviderKeyStorage`, `validateKeyName`
   - [ ] Tests can construct with custom `SecureStore` injection
   - [ ] Tests would fail with `NotYetImplemented` (not compile error)
   - [ ] `getProviderKeyStorage()` returns the same instance on repeated calls
   - [ ] `resetProviderKeyStorage()` clears the singleton so tests get fresh instances

## Failure Recovery

1. `git checkout -- packages/core/src/storage/provider-key-storage.ts`
2. Re-run Phase 10

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P10.md`
