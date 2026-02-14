# Phase 21a: Session Management Stub Verification

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P21a`

## Prerequisites
- Required: Phase 21 completed
- Verification: `grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P21" packages/core/src/recording/`

## Verification Commands

```bash
# Stub exists and compiles
test -f packages/core/src/recording/sessionManagement.ts
cd packages/core && npx tsc --noEmit

# Exports work
grep -q "handleListSessions\|handleDeleteSession" packages/core/src/recording/index.ts

# Function signatures correct
grep -q "handleListSessions" packages/core/src/recording/sessionManagement.ts
grep -q "handleDeleteSession" packages/core/src/recording/sessionManagement.ts

# No TODO
grep -r "TODO" packages/core/src/recording/sessionManagement.ts && echo "FAIL"
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Are function signatures correct?** — [ ]
   - [ ] handleListSessions, handleDeleteSession are async
   - [ ] Parameter types match pseudocode
2. **Does the stub compile without errors?** — [ ]
   - [ ] npx tsc --noEmit passes
3. **Does the stub preserve existing build?** — [ ]
   - [ ] npm run build succeeds
4. **Are imports prepared?** — [ ]
   - [ ] References SessionDiscovery and SessionLockManager
5. **What's MISSING?** — [ ]
   - [ ] [gap 1]

#### Holistic Functionality Assessment

```markdown
## What was created?
[Describe: sessionManagement.ts stub with handleListSessions, handleDeleteSession]

## Are signatures correct?
[Verify against pseudocode session-management.md]

## Verdict
[PASS/FAIL]
```

#### Feature Actually Works
```bash
# Verify stubs compile and are importable
node -e "
const recording = require('./packages/core/dist/recording/index.js');
console.log('handleListSessions exists:', typeof recording.handleListSessions === 'function');
console.log('handleDeleteSession exists:', typeof recording.handleDeleteSession === 'function');
"
```

- [ ] Functions are async (return Promise)
- [ ] Parameter types match pseudocode (session-management.md lines 75-98, 105-150)
- [ ] Stub doesn't break existing build
- [ ] Imports reference SessionDiscovery and SessionLockManager

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/sessionManagement.ts
# Re-implement Phase 21 stub
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P21a.md`
