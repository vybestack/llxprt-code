# Phase 18a: auth-key-name + --key-name Implementation Verification

## Phase ID

`PLAN-20260211-SECURESTORE.P18a`

## Prerequisites

- Required: Phase 18 completed
- Verification: `grep -r "@plan.*SECURESTORE.P18" packages/cli/src/config/ packages/cli/src/runtime/`

## Verification Commands

```bash
# 1. All tests pass
npm test

# 2. TypeScript compiles
npm run typecheck

# 3. Lint
npm run lint

# 4. Build succeeds
npm run build

# 5. Deferred implementation detection
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/cli/src/config/profileBootstrap.ts packages/cli/src/config/config.ts packages/cli/src/runtime/runtimeSettings.ts

# 6. Pseudocode compliance
grep -c "@pseudocode" packages/cli/src/config/profileBootstrap.ts packages/cli/src/config/config.ts packages/cli/src/runtime/runtimeSettings.ts
```

## Pseudocode Compliance Audit

| Pseudocode Section | Lines | Implemented? | Deviations |
|-------------------|-------|-------------|------------|
| Bootstrap arg parsing | 1–24 | [ ] | |
| Profile field recognition | 26–40 | [ ] | |
| Precedence resolution | 42–82 | [ ] | |
| Named key resolution | 84–108 | [ ] | |
| Startup diagnostics | 110–128 | [ ] | |
| Non-interactive failure | 130–140 | [ ] | |

## Semantic Verification Checklist (MANDATORY)

1. **End-to-end trace: --key-name**
   - [ ] CLI arg parsed → keyNameOverride set → passed to applyCliArgumentOverrides → ProviderKeyStorage.getKey called → key set as active

2. **End-to-end trace: auth-key-name in profile**
   - [ ] Profile loaded → auth-key-name extracted → passed as metadata → resolved in applyCliArgumentOverrides → key set as active

3. **Precedence verified**
   - [ ] --key wins over --key-name
   - [ ] --key-name wins over auth-key-name
   - [ ] No silent fallthrough on missing named key

4. **No regressions**
   - [ ] --key still works
   - [ ] --keyfile still works
   - [ ] auth-key still works
   - [ ] auth-keyfile still works
   - [ ] Environment variables still work

## Integration Verification

- [ ] profileBootstrap passes keyNameOverride to config layer
- [ ] config layer passes to runtimeSettings
- [ ] runtimeSettings resolves via ProviderKeyStorage
- [ ] ProviderKeyStorage uses SecureStore
- [ ] Full chain works end-to-end

## Holistic Functionality Assessment

### What was implemented?
[Full auth resolution pipeline description]

### Does it satisfy R21-R27?
[Requirement-by-requirement assessment]

### What could go wrong?
[Risks identified]

### Verdict
[PASS/FAIL]

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P18a.md`
