# Phase 14a: /key Commands TDD Verification

## Phase ID

`PLAN-20260211-SECURESTORE.P14a`

## Prerequisites

- Required: Phase 14 completed
- Verification: `grep -r "@plan.*SECURESTORE.P14" packages/cli/src/ui/commands/keyCommand.test.ts`

## Verification Commands

```bash
# 1. Test file exists
wc -l packages/cli/src/ui/commands/keyCommand.test.ts

# 2. Test count
grep -c "it(" packages/cli/src/ui/commands/keyCommand.test.ts
# Expected: 25+

# 3. Table-driven tests present
grep -c "testCases\|cases\|\.each" packages/cli/src/ui/commands/keyCommand.test.ts

# 4. No mock theater
grep -c "toHaveBeenCalled\b" packages/cli/src/ui/commands/keyCommand.test.ts

# 5. Requirement coverage
for req in R12 R13 R14 R15 R16 R17 R18 R19 R20; do
  grep -q "$req" packages/cli/src/ui/commands/keyCommand.test.ts && echo "COVERED" || echo "MISSING"
done

# 6. Tests fail naturally
npm test -- packages/cli/src/ui/commands/keyCommand.test.ts 2>&1 | tail -20
```

## Semantic Verification Checklist (MANDATORY)

1. **Are all five subcommands tested?**
   - [ ] save (with variations)
   - [ ] load (with variations)
   - [ ] show (with variations)
   - [ ] list (empty and non-empty)
   - [ ] delete (with variations)

2. **Is the legacy path tested?**
   - [ ] Non-subcommand token → legacy behavior
   - [ ] Case sensitivity verified (SAVE ≠ save)

3. **Are error messages verified?**
   - [ ] Each error condition has a specific message check
   - [ ] Messages match requirements specification

## Holistic Functionality Assessment

### Verdict
[PASS/FAIL]

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P14a.md`
