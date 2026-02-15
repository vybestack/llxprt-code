# Phase 09a: Concurrency + Lifecycle Stub Verification

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P09a`

## Prerequisites
- Required: Phase 09 completed
- Verification: `grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P09" packages/core/src/recording/`

## Verification Commands

```bash
# Stub exists and compiles
test -f packages/core/src/recording/SessionLockManager.ts
cd packages/core && npx tsc --noEmit

# Exports work
grep -q "SessionLockManager" packages/core/src/recording/index.ts

# Method signatures correct — static class pattern
grep -q "static.*acquire" packages/core/src/recording/SessionLockManager.ts || echo "FAIL: acquire not static"
grep -q "static.*checkStale" packages/core/src/recording/SessionLockManager.ts || echo "FAIL: checkStale not static"
grep -q "static.*isLocked" packages/core/src/recording/SessionLockManager.ts || echo "FAIL: isLocked not static"
grep -q "static.*isStale" packages/core/src/recording/SessionLockManager.ts || echo "FAIL: isStale not static"
grep -q "static.*removeStaleLock" packages/core/src/recording/SessionLockManager.ts || echo "FAIL: removeStaleLock not static"
grep -q "static.*getLockPath" packages/core/src/recording/SessionLockManager.ts || echo "FAIL: getLockPath not static"

# Return types reference LockHandle
grep -q "LockHandle" packages/core/src/recording/SessionLockManager.ts || echo "FAIL: LockHandle not referenced"

# No TODO comments
grep -r "TODO" packages/core/src/recording/SessionLockManager.ts && echo "FAIL"
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Does the static class design match pseudocode?** — [ ]
   - [ ] SessionLockManager is a utility class with static methods, not instantiated
2. **Are all method signatures correct?** — [ ]
   - [ ] acquire, checkStale, isLocked, isStale, removeStaleLock, getLockPath
   - [ ] Return types match interface contracts
3. **Is LockHandle interface defined correctly?** — [ ]
   - [ ] lockPath: string and release(): Promise<void>
4. **Are exports correct?** — [ ]
   - [ ] SessionLockManager exported from index.ts
5. **What's MISSING?** — [ ]
   - [ ] [gap 1]

#### Holistic Functionality Assessment

```markdown
## What was created?
[Describe: SessionLockManager.ts stub with static methods, LockHandle interface]

## Are signatures correct?
[Verify all static method signatures against pseudocode]

## Verdict
[PASS/FAIL]
```

#### Feature Actually Works
```bash
# Verify stub compiles and is importable
node -e "
const recording = require('./packages/core/dist/recording/index.js');
console.log('SessionLockManager exists:', typeof recording.SessionLockManager === 'function' || typeof recording.SessionLockManager === 'object');
console.log('getLockPath exists:', typeof recording.SessionLockManager.getLockPath === 'function');
console.log('acquire exists:', typeof recording.SessionLockManager.acquire === 'function');
"
```

- [ ] Static class design — matches pseudocode
- [ ] getLockPath is the only non-async method (deterministic string manipulation)
- [ ] acquire returns Promise<LockHandle> matching the interface contract
- [ ] LockHandle interface defined with lockPath: string and release(): Promise<void>
- [ ] No implementation logic present (just stub throws/returns)

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/SessionLockManager.ts
# Re-implement Phase 09 stub
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P09a.md`
