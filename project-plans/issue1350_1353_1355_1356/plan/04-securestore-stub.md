# Phase 04: SecureStore Stub

## Phase ID

`PLAN-20260211-SECURESTORE.P04`

## Prerequisites

- Required: Phase 03a completed
- Verification: `ls .completed/P03a.md`
- Expected files from previous phase: All pseudocode files in `analysis/pseudocode/`
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### R1.1: SecureStore Keyring Access

**Full Text**: SecureStore shall dynamically import `@napi-rs/keyring` and wrap `AsyncEntry` instances to provide `getPassword`, `setPassword`, `deletePassword`, and optionally `findCredentials` operations against the OS keyring.
**Behavior (stub)**: Method signatures exist, throw `NotYetImplemented`.
**Why This Matters**: This is the foundation class that all other components depend on.

### R1.3: keytarLoader Injection

**Full Text**: SecureStore shall accept a `keytarLoader` option in its constructor to allow injection of a mock keyring adapter for testing.
**Behavior (stub)**: Constructor accepts options with keytarLoader field.

## Implementation Tasks

### Files to Create

- `packages/core/src/storage/secure-store.ts` — SecureStore class stub
  - MUST include: `@plan:PLAN-20260211-SECURESTORE.P04`
  - MUST include: `@requirement:R1.1, R1.3, R2.1, R3.1a, R3.1b, R3.2-R3.8, R4.1-R4.8, R5.1-R5.2, R6.1`
  - Classes: `SecureStore`, `SecureStoreError`
  - Interface: `KeytarAdapter`, `SecureStoreOptions`
  - Export: `SecureStore`, `SecureStoreError`, `KeytarAdapter`, `SecureStoreOptions`
  - Methods throw `new Error('NotYetImplemented')` or return empty values of correct type
  - Maximum ~100 lines

### Stub Implementation Rules

```typescript
// Methods can either throw:
async set(key: string, value: string): Promise<void> {
  throw new Error('NotYetImplemented');
}

// OR return empty values:
async get(key: string): Promise<string | null> {
  throw new Error('NotYetImplemented');
}
async list(): Promise<string[]> {
  throw new Error('NotYetImplemented');
}
async has(key: string): Promise<boolean> {
  throw new Error('NotYetImplemented');
}
async delete(key: string): Promise<boolean> {
  throw new Error('NotYetImplemented');
}
async isKeychainAvailable(): Promise<boolean> {
  throw new Error('NotYetImplemented');
}
```

### Required Code Markers

Every function/class MUST include:
```typescript
/**
 * @plan PLAN-20260211-SECURESTORE.P04
 * @requirement R1.1
 */
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check file created
ls packages/core/src/storage/secure-store.ts
# Expected: file exists

# Check plan markers
grep -r "@plan:PLAN-20260211-SECURESTORE.P04\|@plan PLAN-20260211-SECURESTORE.P04" packages/core/src/storage/secure-store.ts | wc -l
# Expected: 2+ occurrences

# TypeScript compiles
npm run typecheck
# Expected: passes

# No TODO comments in production code
grep "TODO" packages/core/src/storage/secure-store.ts
# Expected: no matches

# No version duplication
find packages/core/src -name "*SecureStoreV2*" -o -name "*SecureStoreNew*"
# Expected: no matches

# Tests don't EXPECT NotYetImplemented
grep -r "expect.*NotYetImplemented\|toThrow.*NotYetImplemented" packages/core/src/storage/
# Expected: no matches (no tests yet, but verify)
```

### Structural Verification Checklist

- [ ] `secure-store.ts` created in `packages/core/src/storage/`
- [ ] `SecureStore` class exported
- [ ] `SecureStoreError` class exported
- [ ] `KeytarAdapter` interface exported
- [ ] `SecureStoreOptions` interface exported
- [ ] All six public methods present (set, get, delete, list, has, isKeychainAvailable)
- [ ] Constructor accepts serviceName and options
- [ ] Plan markers present
- [ ] TypeScript compiles
- [ ] No TODO comments

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/storage/secure-store.ts | grep -v ".test.ts"
# Expected: No matches (NotYetImplemented in stub bodies is OK but not as comments)

grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/storage/secure-store.ts | grep -v ".test.ts"
# Expected: No matches
```

## Semantic Verification Checklist (MANDATORY)

1. **Does the stub have the correct API surface?**
   - [ ] SecureStore class exported with correct constructor signature (`serviceName: string, options?: SecureStoreOptions`)
   - [ ] All six public methods present with correct TypeScript signatures (`set`, `get`, `delete`, `list`, `has`, `isKeychainAvailable`)
   - [ ] SecureStoreError class exported with `code` and `remediation` properties
   - [ ] KeytarAdapter interface matches expected adapter shape (`getPassword`, `setPassword`, `deletePassword`, `findCredentials?`)
   - [ ] SecureStoreOptions interface has `fallbackDir`, `fallbackPolicy`, `keytarLoader`

2. **Is this a valid stub (not empty shell)?**
   - [ ] Methods throw `NotYetImplemented` (not return `undefined` silently)
   - [ ] TypeScript strict mode satisfied (no `any` escapes, correct return types)
   - [ ] Imports compile correctly

3. **Would TDD tests be writable against this stub?**
   - [ ] Tests can import all public types (`SecureStore`, `SecureStoreError`, `KeytarAdapter`, `SecureStoreOptions`)
   - [ ] Tests can construct SecureStore with custom `keytarLoader`
   - [ ] Tests would fail with `NotYetImplemented` (not compile error)

## Success Criteria

- SecureStore class stub compiles with strict TypeScript
- All public API methods present with correct signatures
- No more than ~100 lines
- No TODO comments, no version duplications

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/storage/secure-store.ts`
2. Re-run Phase 04

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P04.md`
Contents:
```markdown
Phase: P04
Completed: [timestamp]
Files Created: packages/core/src/storage/secure-store.ts [line count]
Tests Added: 0
Verification: [paste outputs]
```
