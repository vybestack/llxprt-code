# Phase 17: Session Cleanup Implementation

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P17`

## Prerequisites
- Required: Phase 16a completed
- Verification: `test -f project-plans/issue1361/.completed/P16a.md`
- Expected: Tests in sessionCleanup.test.ts exist and fail against stub

## Requirements Implemented (Expanded)

Implements all REQ-CLN-001 through REQ-CLN-004 to make Phase 16 tests pass.

## Implementation Tasks

### Files to Modify
- `packages/cli/src/utils/sessionCleanup.ts` — Full implementation of .jsonl cleanup
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P17`
  - MUST reference pseudocode lines from `analysis/pseudocode/session-cleanup.md`

### Implementation from Pseudocode (MANDATORY line references)

- **Lines 13-38**: getAllSessionFiles function:
  - **Lines 14-19**: Read directory, handle ENOENT
  - **Lines 23-35**: Filter session-*.jsonl files, stat, readSessionHeader, build entry
  - **Line 37**: Return entries
- **Lines 50-74**: shouldDeleteSession function:
  - **Lines 54-65**: Check if .lock file exists
  - **Lines 63-64**: No lock → return 'delete'
  - **Lines 68-73**: Lock exists → check stale → return 'stale-lock-only' or 'skip'
- **Lines 85-130**: cleanupStaleLocks function:
  - **Lines 86-88**: Read dir, filter .lock files
  - **Lines 93-113**: For each lock: check if corresponding .jsonl exists; if orphaned, delete
  - **Lines 115-127**: If not orphaned, check stale → delete stale lock
  - **Line 129**: Return count of cleaned locks
- **Lines 170-180**: Updated cleanupExpiredSessions:
  - **Line 177**: Call cleanupStaleLocks(chatsDir) first
  - Then continue with existing age/count policy using updated getAllSessionFiles

### Do NOT Modify
- Session cleanup test file — Tests must not be changed

## Verification Commands

```bash
# All cleanup tests pass
npm run test -- --grep "cleanup\|sessionCleanup"
# Expected: All pass

# No test modifications
git diff packages/cli/src/utils/sessionCleanup.test.ts | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL"

# Plan markers present
grep -c "@plan:PLAN-20260211-SESSIONRECORDING.P17" packages/cli/src/utils/sessionCleanup.ts
# Expected: 1+

# Pseudocode references
grep -c "@pseudocode" packages/cli/src/utils/sessionCleanup.ts
# Expected: 1+

# No debug code
grep -rn "console\.\|TODO\|FIXME\|XXX" packages/cli/src/utils/sessionCleanup.ts && echo "FAIL"

# TypeScript compiles
npm run typecheck
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY)" packages/cli/src/utils/sessionCleanup.ts
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/cli/src/utils/sessionCleanup.ts
grep -rn -E "return \[\]$|return \{\}$|return null$|return undefined$" packages/cli/src/utils/sessionCleanup.ts
# Expected: No matches in new implementation code
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Does getAllSessionFiles scan for session-*.jsonl files only?** — [ ]
2. **Does shouldDeleteSession actually check lock file and PID liveness?** — [ ]
3. **Does cleanupStaleLocks actually delete orphaned and stale locks?** — [ ]
4. **Does the updated cleanup flow call cleanupStaleLocks before age/count policy?** — [ ]
5. **Does lock-aware protection actually prevent deletion of active sessions?** — [ ]

#### Feature Actually Works
```bash
# Manual verification: create session files and run cleanup
node -e "
const fs = require('fs');
const path = require('path');
const os = require('os');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-test-'));
// Create a fake .jsonl file
const jsonl = path.join(tmpDir, 'session-test123.jsonl');
fs.writeFileSync(jsonl, JSON.stringify({v:1,seq:1,ts:new Date().toISOString(),type:'session_start',payload:{sessionId:'test123',projectHash:'abc',workspaceDirs:[],provider:'test',model:'m',startTime:new Date().toISOString()}}) + '\n');
// Create an orphaned .lock file
fs.writeFileSync(path.join(tmpDir, 'session-orphan.jsonl.lock'), JSON.stringify({pid:999999999,timestamp:new Date().toISOString()}));
console.log('Before:', fs.readdirSync(tmpDir));
// Would test cleanup here after build
console.log('Created test fixtures');
fs.rmSync(tmpDir, { recursive: true });
"
```

#### Integration Points Verified
- [ ] Uses SessionLockManager for lock checking
- [ ] Uses readSessionHeader for .jsonl metadata
- [ ] Integrates with existing age/count retention policy

#### Lifecycle Verified
- [ ] Cleanup runs at startup (existing timing preserved)
- [ ] Stale lock cleanup runs before session file cleanup
- [ ] Errors in one file don't prevent cleanup of others

#### Edge Cases Verified
- [ ] Empty directory handled
- [ ] Non-existent directory handled
- [ ] Permission errors handled gracefully
- [ ] Concurrent cleanup (two processes) handled safely

## Success Criteria
- All Phase 16 tests pass without modification
- Implementation follows pseudocode
- Existing cleanup behavior preserved
- TypeScript compiles cleanly

## Failure Recovery
```bash
git checkout -- packages/cli/src/utils/sessionCleanup.ts
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P17.md`


---

## CORRECTION: Stale-Lock Cleanup Policy (Architecture Review FIX 5)

**The implementation MUST NOT auto-delete session data files solely because their lock is stale.**

### What Changed

The original pseudocode (session-cleanup.md lines 152-161) had:
```
IF shouldDelete OR action == 'stale-delete' THEN
  APPEND entry TO sessionsToDelete
```

This is WRONG. A stale lock means the owning process crashed — the session file itself may be perfectly valid and recoverable. The corrected logic:

1. `shouldDeleteSession()` returns `'stale-lock-only'` (not `'stale-delete'`) when a stale lock is detected
2. The stale lock FILE is removed immediately
3. The session DATA file is evaluated ONLY against the normal age/count retention policy
4. `IF shouldDelete THEN APPEND` — NO `OR action == 'stale-delete'` clause

### Implementation Requirements

- **File: `packages/cli/src/utils/sessionCleanup.ts`**
  - The `shouldDeleteSession()` function MUST return `'stale-lock-only'` (not `'stale-delete'`) for stale locks
  - The `identifySessionsToDelete()` loop MUST call `removeStaleLock()` for `'stale-lock-only'` entries, then evaluate retention policy WITHOUT special-casing stale lock status
  - The retention policy `evaluateRetentionPolicy(entry, config)` is the SOLE arbiter of data file deletion

### Verification

```bash
# After implementation, verify the corrected behavior:
# 1. Create a .jsonl file with a stale .lock (dead PID)
# 2. Set retention policy to keep recent files (e.g., maxAge=7d)
# 3. Run cleanup
# 4. Assert: .lock file removed, .jsonl file PRESERVED (it's recent)
```

