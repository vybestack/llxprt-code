# Phase 16: auth-key-name + --key-name Stub

## Phase ID

`PLAN-20260211-SECURESTORE.P16`

## Prerequisites

- Required: Phase 15a completed
- Verification: `ls .completed/P15a.md`
- Expected: ProviderKeyStorage implemented, /key commands working

## Requirements Implemented (Expanded)

### R21.1: auth-key-name Profile Resolution

**Full Text**: When a profile containing `auth-key-name` is loaded, the system shall resolve the named key via `ProviderKeyStorage.getKey(name)` during `applyCliArgumentOverrides()`.
**Behavior (stub)**: Field recognized and passed through but not yet resolved.

### R22.1: --key-name CLI Flag

**Full Text**: When `--key-name <name>` is provided on the CLI, the system shall resolve the named key via `ProviderKeyStorage.getKey(name)` during `applyCliArgumentOverrides()`.
**Behavior (stub)**: Flag parsed and passed through but not yet resolved.

### R22.2: Bootstrap Arg Parsing

**Full Text**: `--key-name` shall be parsed by the bootstrap argument parser alongside `--key` and `--keyfile`, and stored in `BootstrapProfileArgs` as `keyNameOverride`.
**Behavior (stub)**: Parsing structure added.

## Implementation Tasks

### Files to Modify

#### 1. `packages/cli/src/config/profileBootstrap.ts`
- ADD `keyNameOverride: string | null` to `BootstrapProfileArgs` interface
- ADD `case '--key-name':` in argument parsing switch
- MUST include: `@plan:PLAN-20260211-SECURESTORE.P16`

#### 2. `packages/cli/src/config/config.ts`
- ADD `'auth-key-name'` to `VALID_EPHEMERAL_SETTINGS` / `ephemeralKeys` array
- ADD handling for `keyNameOverride` in synthetic profile creation
- MUST include: `@plan:PLAN-20260211-SECURESTORE.P16`

#### 3. `packages/cli/src/runtime/runtimeSettings.ts`
- ADD stub handler in `applyCliArgumentOverrides()` for `--key-name` / `auth-key-name`
- Position: between `--key` and `--keyfile` in precedence order
- Stub: throw NotYetImplemented or pass-through without resolution
- MUST include: `@plan:PLAN-20260211-SECURESTORE.P16`

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-SECURESTORE.P16
 * @requirement R21.1, R22.1, R22.2
 */
```

## Verification Commands

```bash
# 1. Bootstrap args interface updated
grep "keyNameOverride" packages/cli/src/config/profileBootstrap.ts

# 2. --key-name parsing added
grep "key-name" packages/cli/src/config/profileBootstrap.ts

# 3. auth-key-name recognized as ephemeral setting
grep "auth-key-name" packages/cli/src/config/config.ts

# 4. runtimeSettings stub added
grep "keyName\|key-name\|auth-key-name" packages/cli/src/runtime/runtimeSettings.ts

# 5. TypeScript compiles
npm run typecheck

# 6. Full test suite still passes
npm test

# 7. Plan markers
grep -rn "@plan.*SECURESTORE.P16" packages/cli/src/config/ packages/cli/src/runtime/
```

## Structural Verification Checklist

- [ ] profileBootstrap.ts: `keyNameOverride` in interface, `--key-name` in parsing
- [ ] config.ts: `auth-key-name` in ephemeral settings
- [ ] runtimeSettings.ts: stub handler for key-name resolution
- [ ] TypeScript compiles
- [ ] Existing tests pass

## Semantic Verification Checklist (MANDATORY)

1. **Is `--key-name` case added to bootstrap arg parser?**
   - [ ] `case '--key-name':` exists in the argument parsing switch/if-chain
   - [ ] Next argument is consumed as the key name value
   - [ ] Missing value after `--key-name` produces an error (not silent null)

2. **Is `auth-key-name` added to VALID_EPHEMERAL_SETTINGS?**
   - [ ] `'auth-key-name'` is in the ephemeral settings array/set
   - [ ] Profile validation accepts `auth-key-name` without errors
   - [ ] No typos (`auth-key-name` not `auth-keyname` or `authKeyName`)

3. **Is `keyNameOverride` field added to BootstrapProfileArgs?**
   - [ ] `keyNameOverride: string | null` in the interface definition
   - [ ] Default value is `null` in initialization
   - [ ] Field is populated from `--key-name` parsing

4. **Is precedence resolution stub in applyCliArgumentOverrides?**
   - [ ] Stub code exists between `--key` handling and `--keyfile` handling (correct precedence position)
   - [ ] Stub throws NotYetImplemented or contains clear placeholder
   - [ ] Stub does NOT silently skip/no-op (must be detectable by tests)

5. **Is existing --key/--keyfile behavior unchanged?**
   - [ ] `--key` parsing code is not modified
   - [ ] `--keyfile` parsing code is not modified
   - [ ] `auth-key` and `auth-keyfile` profile handling unchanged
   - [ ] Existing tests for these features still pass

6. **Are TDD tests writable against this stub?**
   - [ ] `keyNameOverride` field is accessible for assertion
   - [ ] `--key-name` parsing produces testable output
   - [ ] `auth-key-name` in profile produces testable output
   - [ ] Stub behavior in applyCliArgumentOverrides is predictable (throws specific error)

## Failure Recovery

1. `git checkout -- packages/cli/src/config/profileBootstrap.ts packages/cli/src/config/config.ts packages/cli/src/runtime/runtimeSettings.ts`
2. Re-run Phase 16

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P16.md`
