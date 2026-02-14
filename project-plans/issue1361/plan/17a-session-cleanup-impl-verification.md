# Phase 17a: Session Cleanup Implementation Verification

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P17a`

## Prerequisites
- Required: Phase 17 completed
- Verification: `grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P17" packages/`

## Verification Commands

```bash
# All tests pass
npm run test -- --grep "cleanup\|sessionCleanup"

# No test modifications
git diff packages/cli/src/utils/sessionCleanup.test.ts

# Deferred implementation detection
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/cli/src/utils/sessionCleanup.ts | grep -v ".test.ts"
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/cli/src/utils/sessionCleanup.ts
grep -rn -E "return \[\]$|return \{\}$|return null$|return undefined$" packages/cli/src/utils/sessionCleanup.ts

# Full typecheck
npm run typecheck
```

### Holistic Functionality Assessment

```markdown
## What was implemented?
[Describe: Session cleanup that handles .jsonl files, uses lock-aware protection via SessionLockManager, cleans up stale/orphaned locks]

## Does it satisfy the requirements?
- REQ-CLN-001: [How .jsonl pattern scanning works]
- REQ-CLN-002: [How lock-aware protection prevents active session deletion]
- REQ-CLN-003: [How stale lock cleanup works with dead PID detection]
- REQ-CLN-004: [How orphaned lock cleanup works]

## What is the data flow?
[Trace: cleanupExpiredSessions → cleanupStaleLocks → getAllSessionFiles → shouldDeleteSession → delete or skip]

## What could go wrong?
[Identify: race condition between lock check and delete, readSessionHeader failure, permission issues]

## Verdict
[PASS/FAIL]
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Does the code DO what the requirement says?**
   - [ ] Read REQ-CLN-001 through REQ-CLN-004
   - [ ] Read the implementation
   - [ ] Can explain HOW each is fulfilled
2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests verify actual file deletion/preservation
4. **Is the feature REACHABLE by users?**
   - [ ] Cleanup runs at startup (existing trigger)
   - [ ] No user action needed — automatic
5. **What's MISSING?**
   - [ ] [List gaps]

### Feature Actually Works
```bash
# Manual verification: create temp session files and run cleanup
node -e "
const os = require('os');
const path = require('path');
const fs = require('fs');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-verify-'));
// Create a fake stale .lock file (dead PID)
const sessionPath = path.join(tmpDir, 'session-test.jsonl');
const lockPath = sessionPath + '.lock';
fs.writeFileSync(sessionPath, '{"v":1,"seq":1,"ts":"2026-01-01","type":"session_start","payload":{}}');
fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999999, timestamp: new Date().toISOString() }));
console.log('Before cleanup:', fs.readdirSync(tmpDir));
// Verify stale lock detection
const { SessionLockManager } = require('./packages/core/dist/recording/index.js');
SessionLockManager.isStale(sessionPath).then(stale => {
  console.log('Is stale:', stale);
  fs.rmSync(tmpDir, { recursive: true });
});
"
```

## Failure Recovery
```bash
git checkout -- packages/cli/src/utils/sessionCleanup.ts
# Re-implement Phase 17 from pseudocode
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P17a.md`
