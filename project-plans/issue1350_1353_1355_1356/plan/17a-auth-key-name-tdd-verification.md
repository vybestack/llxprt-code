# Phase 17a: auth-key-name + --key-name TDD Verification

## Phase ID

`PLAN-20260211-SECURESTORE.P17a`

## Prerequisites

- Required: Phase 17 completed
- Verification: `grep -r "@plan.*SECURESTORE.P17" packages/cli/src/`

## Verification Commands

```bash
# 1. Test files exist
grep -rl "@plan.*SECURESTORE.P17" packages/cli/src/

# 2. Test count
grep -c "it(" packages/cli/src/runtime/runtimeSettings.test.ts 2>/dev/null

# 3. Precedence matrix completeness
grep -c "winner\|sources\|precedence" packages/cli/src/runtime/runtimeSettings.test.ts 2>/dev/null

# 4. Requirement coverage
for req in R21 R22 R23 R24 R25 R26 R27.3; do
  grep -rl "$req" packages/cli/src/ | head -1
done

# 5. Tests fail naturally
npm test -- runtimeSettings 2>&1 | tail -15
```

## Semantic Verification Checklist (MANDATORY)

1. **Is every precedence level tested?**
   - [ ] `--key` > `--key-name` > `auth-key-name` > `auth-keyfile` > `auth-key` > env

2. **Are error conditions tested?**
   - [ ] Named key not found → specific error message
   - [ ] Non-interactive failure

3. **Are diagnostics tested?**
   - [ ] Log format matches spec
   - [ ] No secret values in logs

4. **No deprecation regressions?**
   - [ ] `--key`, `--keyfile`, `auth-key`, `auth-keyfile` all tested

## Holistic Functionality Assessment

### Verdict
[PASS/FAIL]

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P17a.md`
