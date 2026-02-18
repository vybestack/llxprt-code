# Phase 23: Session Management Implementation

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P23`

## Prerequisites
- Required: Phase 22a completed
- Verification: `test -f project-plans/issue1361/.completed/P22a.md`
- Expected: Tests in sessionManagement.test.ts exist and fail

## Requirements Implemented (Expanded)

Implements all REQ-MGT-001 through REQ-MGT-004 to make Phase 22 tests pass.

## Implementation Tasks

### Files to Modify
- `packages/core/src/recording/sessionManagement.ts` — Full implementation
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P23`
  - MUST reference pseudocode lines from `analysis/pseudocode/session-management.md`

### Implementation from Pseudocode (session-management.md — MANDATORY line references)

#### handleListSessions (Lines 75-98)
- **Lines 76**: Call SessionDiscovery.listSessions(chatsDir, projectHash)
- **Lines 78-81**: Handle empty sessions → print "No sessions found", exit 0
- **Lines 84**: Print table header
- **Lines 86-95**: For each session: format index (padded), truncated ID (first 8 chars), formatted dates, provider/model, formatted size
- **Line 97**: Exit 0

#### handleDeleteSession (Lines 105-150)
- **Lines 106-111**: Call SessionDiscovery.listSessions, handle empty
- **Lines 113-118**: Resolve ref via SessionDiscovery.resolveSessionRef
- **Lines 122-132**: Check advisory lock:
  - isLocked → check if stale → stale: remove stale lock and proceed; active: error
- **Lines 134-149**: Delete session file + sidecar lock, print confirmation, handle errors

#### Helper Functions (Lines 170-179)
- **Lines 170-173**: formatDate — Date → locale string
- **Lines 175-179**: formatSize — bytes → human-readable (B/KB/MB)

### Do NOT Modify
- `packages/core/src/recording/sessionManagement.test.ts` — Tests must not be changed

## Required Code Markers

Every function/method in the implementation MUST include:
```typescript
/**
 * @plan PLAN-20260211-SESSIONRECORDING.P23
 * @requirement REQ-MGT-001 (or appropriate REQ-MGT-*)
 * @pseudocode session-management.md lines X-Y
 */
```

## Verification Commands

```bash
# All tests pass
cd packages/core && npx vitest run src/recording/sessionManagement.test.ts
# Expected: All pass

# No test modifications
git diff packages/core/src/recording/sessionManagement.test.ts | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL"

# Plan markers
grep -c "@plan:PLAN-20260211-SESSIONRECORDING.P23" packages/core/src/recording/sessionManagement.ts
# Expected: 1+

# Pseudocode references
grep -c "@pseudocode" packages/core/src/recording/sessionManagement.ts
# Expected: 1+

# No debug code
grep -rn "console\.\|TODO\|FIXME\|XXX" packages/core/src/recording/sessionManagement.ts && echo "FAIL"

# TypeScript compiles
cd packages/core && npx tsc --noEmit
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY)" packages/core/src/recording/sessionManagement.ts
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/recording/sessionManagement.ts
grep -rn -E "return \[\]$|return \{\}$|return null$|return undefined$" packages/core/src/recording/sessionManagement.ts
# Expected: No matches
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Does handleListSessions actually print a formatted table?** — [ ]
2. **Does handleDeleteSession actually delete the file from disk?** — [ ]
3. **Does lock checking actually prevent deletion of active sessions?** — [ ]
4. **Does stale lock detection actually allow deletion?** — [ ]
5. **Does formatSize produce correct human-readable output?** — [ ]

#### Feature Actually Works
```bash
# Manual verification: create sessions and list them
node -e "
const { SessionRecordingService, handleListSessions } = require('./packages/core/dist/recording/index.js');
const os = require('os');
const path = require('path');
const fs = require('fs');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mgmt-test-'));
// Create 2 sessions
const svc1 = new SessionRecordingService({
  sessionId: 'sess-001',
  projectHash: 'hash-abc',
  chatsDir: tmpDir,
  workspaceDirs: ['/project'],
  provider: 'anthropic',
  model: 'claude-4'
});
svc1.recordContent({ speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] });
svc1.flush().then(async () => {
  await svc1.dispose();
  // Note: handleListSessions calls process.exit, so this is illustrative
  console.log('Files:', fs.readdirSync(tmpDir));
  fs.rmSync(tmpDir, { recursive: true });
});
"
```

#### Integration Points Verified
- [ ] Uses SessionDiscovery.listSessions for session enumeration
- [ ] Uses SessionDiscovery.resolveSessionRef for ref resolution
- [ ] Uses SessionLockManager.isLocked / isStale for deletion safety
- [ ] Uses fs.unlink for actual file deletion

#### Edge Cases Verified
- [ ] Empty directory → appropriate message
- [ ] Invalid ref → clear error
- [ ] Active lock → refuses deletion
- [ ] Stale lock → allows deletion

## Success Criteria
- All Phase 22 tests pass without modification
- Implementation follows pseudocode
- No deferred implementation patterns
- TypeScript compiles cleanly

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/sessionManagement.ts
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P23.md`


---

## Addendum: Core/CLI Boundary for Session Management Implementation

### Implementation Constraint
When implementing `SessionDiscovery` and session management operations in this phase:

1. **`listSessions()` returns data, not display strings.** The return type is `SessionSummary[]` — an array of plain data objects. No string formatting, no padding, no ANSI codes.

2. **`deleteSession()` returns a result object**, not a formatted confirmation message. Example: `{ deleted: true, sessionId: string, filePath: string }` or `{ deleted: false, reason: string }`.

3. **Table rendering belongs in the CLI.** The `--list-sessions` command handler in `packages/cli/` calls `SessionDiscovery.listSessions()`, then formats the result using CLI-layer utilities (e.g., a table renderer). The table renderer is NOT part of this phase — it is a CLI concern wired in Phase 26 (integration).

4. **Verification**: After implementation, grep for formatting leaks:
```bash
# Must find NO matches in core session management code:
grep -rn "chalk\|ansi\|column\|padStart\|padEnd\|table\|─\|│\|┌\|└" packages/core/src/recording/sessionManagement.ts packages/core/src/recording/SessionDiscovery.ts
# Expected: No matches
```
