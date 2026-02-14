# Phase 16a: auth-key-name + --key-name Stub Verification

## Phase ID

`PLAN-20260211-SECURESTORE.P16a`

## Prerequisites

- Required: Phase 16 completed
- Verification: `grep -r "@plan.*SECURESTORE.P16" packages/cli/src/config/ packages/cli/src/runtime/`

## Verification Commands

```bash
# 1. keyNameOverride in BootstrapProfileArgs
grep "keyNameOverride" packages/cli/src/config/profileBootstrap.ts

# 2. --key-name case in arg parser
grep "'--key-name'" packages/cli/src/config/profileBootstrap.ts

# 3. auth-key-name as ephemeral setting
grep "auth-key-name" packages/cli/src/config/config.ts

# 4. Stub in runtimeSettings
grep -A 5 "keyName\|key.name\|auth-key-name" packages/cli/src/runtime/runtimeSettings.ts | head -20

# 5. TypeScript compiles
npm run typecheck

# 6. All tests pass
npm test
```

## Semantic Verification Checklist (MANDATORY)

1. **Is the argument parsing correct?**
   - [ ] `--key-name` parsed alongside `--key` and `--keyfile`
   - [ ] Value stored as `keyNameOverride`
   - [ ] Null when not provided

2. **Is auth-key-name recognized?**
   - [ ] Added to valid ephemeral settings list
   - [ ] Included in synthetic profile creation

3. **Is the precedence position correct?**
   - [ ] In runtimeSettings: after `--key`, before `--keyfile`

## Holistic Functionality Assessment

### Verdict
[PASS/FAIL]

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P16a.md`
