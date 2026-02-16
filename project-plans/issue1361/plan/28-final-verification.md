# Phase 28: Final Verification

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P28`

## Prerequisites
- Required: Phase 27a completed
- Verification: `test -f project-plans/issue1361/.completed/P27a.md`
- Expected: Entire session recording feature implemented, old system removed, all prior phases passed

## Purpose

This is the FINAL verification phase for the entire Session Recording feature (PLAN-20260211-SESSIONRECORDING). It verifies the complete end-to-end functionality across all components, performs comprehensive regression testing, and confirms the feature is ready for production use.

## Requirements Verified (ALL)

This phase verifies ALL requirements from the entire plan:
- **REQ-REC-001 through REQ-REC-008**: Session recording (write, queue, flush, deferred materialization, ENOSPC, sequence numbers)
- **REQ-RPL-001 through REQ-RPL-005**: Replay engine (deserialize, reconstruct history, handle compression/rewind)
- **REQ-INT-001 through REQ-INT-007**: Recording integration (event subscription, flush at turn boundary, re-subscription on compression)
- **REQ-RSM-001 through REQ-RSM-006**: Resume flow (discover, lock, replay, re-initialize recording, continue from last seq)
- **REQ-MGT-001 through REQ-MGT-004**: Session management (list sessions, delete session, session metadata)
- **REQ-CON-001 through REQ-CON-006**: Concurrency and lifecycle (locks, cleanup, graceful shutdown)
- **REQ-CLN-001 through REQ-CLN-005**: Old system removal (no dangling references, clean build)
- **REQ-DEL-001 through REQ-DEL-007**: CLI flags (--continue, --list-sessions, --delete-session)

## Verification Commands

### Step 1: Full Automated Test Suite

```bash
# ALL tests must pass
npm run test
# Expected: Exit 0, all suites pass

# Recording-specific tests
cd packages/core && npx vitest run src/recording/ 2>&1 | tail -30
# Expected: All recording tests pass (unit + integration)

# Count total recording tests
TOTAL=$(grep -rc "it(\|test(" packages/core/src/recording/*.test.ts packages/core/src/recording/**/*.test.ts 2>/dev/null | awk -F: '{sum += $2} END {print sum}')
echo "Total recording tests: $TOTAL"
```

### Step 2: TypeScript + Lint + Build

```bash
# TypeScript compiles with zero errors
npm run typecheck
# Expected: Exit 0

# Lint passes
npm run lint
# Expected: Exit 0

# Format is clean
npm run format
# Expected: No changes

# Build succeeds
npm run build
# Expected: Exit 0
```

### Step 3: Plan Marker Traceability

```bash
# All plan phases have markers in code
for PHASE in P03 P04 P05 P06 P07 P08 P09 P10 P11 P12 P13 P14 P15 P16 P17 P18 P19 P20 P21 P22 P23 P24 P25 P26 P27; do
  COUNT=$(grep -rc "@plan:PLAN-20260211-SESSIONRECORDING.$PHASE" packages/ 2>/dev/null | awk -F: '{sum += $2} END {print sum}')
  echo "Phase $PHASE: $COUNT markers"
  [ "$COUNT" -eq 0 ] && echo "  WARNING: No markers for $PHASE"
done
```

### Step 4: No Deferred Implementation in Final Build

```bash
# No TODO/FIXME/HACK/STUB in recording code
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/recording/ --include="*.ts" | grep -v ".test.ts" | grep -v "node_modules"
# Expected: No matches

# No cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/recording/ --include="*.ts" | grep -v ".test.ts" | grep -v "node_modules"
# Expected: No matches

# No empty returns in implementation
grep -rn -E "return \[\]$|return \{\}$|return null$|return undefined$" packages/core/src/recording/ --include="*.ts" | grep -v ".test.ts"
# Expected: No matches (or justified with comment)
```

### Step 5: Old System Completely Removed

```bash
# Zero references to old persistence system
grep -rn "SessionPersistenceService" packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" && echo "FAIL" || echo "OK"
grep -rn "PersistedSession[^R]" packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" && echo "FAIL" || echo "OK"
grep -rn "PersistedUIHistoryItem" packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" && echo "FAIL" || echo "OK"
grep -rn "PersistedToolCall" packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" && echo "FAIL" || echo "OK"
grep -rn "ChatRecordingService" packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" && echo "FAIL" || echo "OK"
grep -rn "loadMostRecent" packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" && echo "FAIL" || echo "OK"
grep -rn "restoredSession" packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" && echo "FAIL" || echo "OK"

# Old files deleted
test ! -f packages/core/src/storage/SessionPersistenceService.ts && echo "OK" || echo "FAIL"
test ! -f packages/core/src/storage/SessionPersistenceService.test.ts && echo "OK" || echo "FAIL"
```

### Step 6: Smoke Test — New Session Recording

```bash
# Test 1: Basic session — verify recording happens
npm run build
touch /tmp/before-final-test
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"

JSONL_FILES=$(find ~/.llxprt -name "*.jsonl" -newer /tmp/before-final-test -type f 2>/dev/null)
echo "=== Test 1: New Session Recording ==="
echo "JSONL files created: $JSONL_FILES"
[ -z "$JSONL_FILES" ] && echo "FAIL: No JSONL files" || echo "PASS: JSONL file created"

FIRST_FILE=$(echo "$JSONL_FILES" | head -1)
if [ -n "$FIRST_FILE" ]; then
  echo "Event types:"
  cat "$FIRST_FILE" | while read line; do echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"  seq={d.get('seq','?')} type={d.get('type','?')}\")" 2>/dev/null; done
  LINE_COUNT=$(wc -l < "$FIRST_FILE")
  echo "Total events: $LINE_COUNT"
  [ "$LINE_COUNT" -lt 3 ] && echo "WARNING: Very few events (expected session_start + content)"
fi
rm -f /tmp/before-final-test
```

### Step 7: Smoke Test — --continue Flag

```bash
# Test 2: --continue should resume the most recent session
echo "=== Test 2: --continue Resume ==="
# This test verifies the resume path doesn't crash
# Note: May need adjustment based on actual CLI flag syntax
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key --continue "write another haiku" 2>&1 | head -20
echo "Exit code: $?"
# Expected: Session starts with resumed history, doesn't crash
```

### Step 8: Smoke Test — --list-sessions

```bash
# Test 3: --list-sessions should show recorded sessions
echo "=== Test 3: --list-sessions ==="
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key --list-sessions 2>&1
echo "Exit code: $?"
# Expected: Lists at least 1 session with ID, date, turn count
```

### Step 9: Smoke Test — --delete-session

```bash
# Test 4: --delete-session should remove a session
echo "=== Test 4: --delete-session ==="
# Get a session ID from --list-sessions first
SESSION_ID=$(node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key --list-sessions 2>&1 | grep -oE '[a-f0-9-]{8,}' | head -1)
if [ -n "$SESSION_ID" ]; then
  echo "Deleting session: $SESSION_ID"
  node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key --delete-session "$SESSION_ID" 2>&1
  echo "Exit code: $?"
else
  echo "WARNING: No session ID found to test deletion"
fi
```

### Semantic Verification Checklist

#### Behavioral Verification Questions — COMPLETE FEATURE
1. **Does recording actually happen during a normal session?** — [ ]
   - [ ] Smoke test produces JSONL file
   - [ ] JSONL contains session_start + content events
   - [ ] Sequence numbers are monotonic
2. **Does --continue actually resume a session?** — [ ]
   - [ ] Resumed session has previous history
   - [ ] New content is appended with continuing seq numbers
   - [ ] No crash, no data loss
3. **Does --list-sessions show sessions?** — [ ]
   - [ ] At least one session listed
   - [ ] Session ID, date, and metadata visible
4. **Does --delete-session remove a session?** — [ ]
   - [ ] Session file removed from disk
   - [ ] Lock file cleaned up
   - [ ] Subsequent --list-sessions doesn't show deleted session
5. **Is the old system completely gone?** — [ ]
   - [ ] Zero grep hits for old type/class names
   - [ ] Old files deleted
   - [ ] Clean typecheck and build

#### Cross-Component Integration Verified
- [ ] SessionRecordingService → JSONL file on disk (verified by reading file)
- [ ] ReplayEngine → reconstructed IContent[] from JSONL (verified by resume)
- [ ] SessionDiscovery → finds sessions by project hash (verified by --list-sessions)
- [ ] SessionLockManager → prevents concurrent access (verified by integration tests)
- [ ] RecordingIntegration → relays HistoryService events (verified by content in JSONL)
- [ ] Config → --continue/--list-sessions/--delete-session flags parsed (verified by smoke tests)

#### Full Lifecycle Verified
- [ ] New session: start → record → flush → exit → JSONL on disk
- [ ] Resume session: --continue → discover → lock → replay → re-subscribe → record more → flush → exit
- [ ] List sessions: --list-sessions → discover all → display metadata
- [ ] Delete session: --delete-session [id] → find → delete file → release lock
- [ ] Compression during session: compress → new HistoryService → re-subscribe → continue recording

### Final Assessment

```markdown
## Feature Summary
[What was built: JSONL-based session recording with replay, resume, management, and old system removal]

## Components Delivered
1. SessionRecordingService — queue-based async JSONL writer with deferred materialization
2. ReplayEngine — JSONL reader that reconstructs IContent history
3. SessionDiscovery — finds sessions by project hash
4. SessionLockManager — prevents concurrent session access
5. RecordingIntegration — bridges HistoryService events to recording
6. Session cleanup — age/count based cleanup adapted for new system
7. Resume flow — --continue flag triggers discover → lock → replay → resume
8. Session management — --list-sessions, --delete-session CLI flags
9. Old system removal — SessionPersistenceService and all references removed

## Test Coverage
- Unit tests per component: [count]
- Integration tests: [count]
- Property-based tests: [count]
- Total: [count]

## Risk Assessment
[Any known limitations, edge cases, or future work needed]

## Verdict
[PASS/FAIL — feature is/is not ready for production]
```

## Success Criteria
- ALL automated tests pass (npm run test)
- TypeScript compiles with zero errors
- Build succeeds
- Lint passes
- Format is clean
- All plan phases have code markers
- No deferred implementation patterns
- Old system completely removed (zero dangling references)
- Smoke test: new session produces valid JSONL
- Smoke test: --continue resumes without crash
- Smoke test: --list-sessions shows sessions
- Smoke test: --delete-session removes session
- Final assessment verdict is PASS

## Failure Recovery
```bash
# If any verification fails:
# 1. Identify the failing component
# 2. Return to the relevant phase (P03-P27)
# 3. Fix the issue
# 4. Re-run all verification from that phase forward
# 5. Return to P28 for final verification

# If smoke tests fail but unit tests pass:
# Integration wiring issue — return to P26 (integration impl)

# If old system references found:
# Return to P27 (old system removal)
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P28.md`
Contents:
```markdown
Phase: P28 — Final Verification
Completed: YYYY-MM-DD HH:MM
All Tests: PASS
TypeCheck: PASS
Build: PASS
Lint: PASS
Smoke Tests: PASS (new session, --continue, --list-sessions, --delete-session)
Old System: REMOVED (zero dangling references)
Plan Markers: All phases P03-P27 have markers
Final Verdict: PASS
```
