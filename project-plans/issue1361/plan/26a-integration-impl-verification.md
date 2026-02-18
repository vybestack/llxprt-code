# Phase 26a: System Integration Implementation Verification

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P26a`

## Prerequisites
- Required: Phase 26 completed
- Verification: `grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P26" packages/cli/src/gemini.tsx packages/cli/src/ui/AppContainer.tsx packages/cli/src/ui/hooks/useGeminiStream.ts`

## Verification Commands

```bash
# Integration tests pass
cd packages/core && npx vitest run src/recording/integration.test.ts

# Full test suite passes
npm run test 2>&1 | tail -20

# TypeScript compiles
npm run typecheck

# Build succeeds
npm run build

# Lint passes
npm run lint

# No test modifications
git diff packages/core/src/recording/integration.test.ts | head -5
# Expected: No changes

# Deferred implementation detection
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/cli/src/gemini.tsx packages/cli/src/ui/AppContainer.tsx packages/cli/src/ui/hooks/useGeminiStream.ts | grep -v ".test.ts"
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/cli/src/gemini.tsx packages/cli/src/ui/AppContainer.tsx packages/cli/src/ui/hooks/useGeminiStream.ts
grep -rn -E "return \[\]$|return \{\}$|return null$|return undefined$" packages/cli/src/gemini.tsx packages/cli/src/ui/AppContainer.tsx packages/cli/src/ui/hooks/useGeminiStream.ts

# Verify wiring exists in all expected files
grep -q "SessionRecordingService" packages/cli/src/gemini.tsx && echo "OK: Recording service in gemini.tsx"
grep -q "flushAtTurnBoundary" packages/cli/src/ui/hooks/useGeminiStream.ts && echo "OK: Flush in useGeminiStream"
grep -q "RecordingIntegration\|recordingIntegration" packages/cli/src/ui/AppContainer.tsx && echo "OK: Integration in AppContainer"
grep -q "isContinueSession\|getContinueSessionRef" packages/cli/src/gemini.tsx && echo "OK: Continue flag in gemini.tsx"
grep -q "dispose" packages/cli/src/gemini.tsx && echo "OK: Dispose in gemini.tsx"
```

### Holistic Functionality Assessment

The verifier MUST write a documented assessment:

```markdown
## What was wired?
[Describe the actual integration: which files changed, what was connected]

## End-to-End Data Flow
[Trace: user types message → HistoryService.addInternal() → emits 'contentAdded' → RecordingIntegration handler → SessionRecordingService.recordContent() → enqueue → drain → appendFile]

## Resume Flow Trace
[Trace: --continue flag → config.isContinueSession() → SessionDiscovery.findSession() → SessionLockManager.acquire() → ReplayEngine.replay() → SessionRecordingService.initializeForResume() → RecordingIntegration.subscribeToHistory()]

## Flush Flow Trace
[Trace: submitQuery completes → finally block → flushAtTurnBoundary() → recording.flush() → drain remaining queue → appendFile]

## Dispose Flow Trace
[Trace: session exit → integration.dispose() → unsubscribeFromHistory() → recording.flush() → recording.dispose() → lock.release()]

## What could go wrong?
[Identify risks: race between flush and next message, compression mid-flush, crash between enqueue and flush]

## Smoke Test Results
[Paste actual output from running: node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"]
[Paste JSONL file content showing valid recording]

## Verdict
[PASS/FAIL]
```

### Semantic Verification — Feature Actually Reachable

```bash
# Verify that a user can actually trigger recording by starting the CLI
npm run build
touch /tmp/before-test
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"

# Check for JSONL files created after the test
JSONL_FILES=$(find ~/.llxprt -name "*.jsonl" -newer /tmp/before-test -type f 2>/dev/null)
echo "JSONL files created: $JSONL_FILES"
[ -z "$JSONL_FILES" ] && echo "FAIL: No JSONL files created during session"

# Validate JSONL structure
FIRST_FILE=$(echo "$JSONL_FILES" | head -1)
if [ -n "$FIRST_FILE" ]; then
  echo "=== First 10 lines of JSONL ==="
  head -10 "$FIRST_FILE"
  echo "=== Event types ==="
  cat "$FIRST_FILE" | while read line; do echo "$line" | python3 -c "import sys,json; print(json.load(sys.stdin).get('type','?'))" 2>/dev/null; done
  echo "=== Validation ==="
  LINES=$(wc -l < "$FIRST_FILE")
  VALID=$(cat "$FIRST_FILE" | while read line; do echo "$line" | python3 -m json.tool > /dev/null 2>&1 && echo "ok"; done | wc -l)
  echo "Total lines: $LINES, Valid JSON: $VALID"
  [ "$LINES" -eq "$VALID" ] && echo "OK: All lines valid JSON" || echo "FAIL: Invalid JSON lines"
fi

rm -f /tmp/before-test
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Does the code DO what the requirements say?** — [ ]
   - [ ] I read REQ-INT-WIRE-001 through REQ-INT-WIRE-006
   - [ ] I read the implementation in gemini.tsx, AppContainer.tsx, useGeminiStream.ts
   - [ ] I can explain HOW each requirement is fulfilled
2. **Is this REAL implementation, not placeholder?** — [ ]
   - [ ] Deferred implementation detection passed
   - [ ] No empty returns in implementation
   - [ ] No "will be implemented" comments
3. **Would the integration tests FAIL if implementation was removed?** — [ ]
   - [ ] Tests verify actual JSONL file content
   - [ ] Tests verify resume produces correct history
4. **Is the feature REACHABLE by users?** — [ ]
   - [ ] `llxprt` starts and records (smoke test)
   - [ ] `llxprt --continue` triggers resume flow
   - [ ] JSONL file appears on disk after session
5. **What's MISSING?** — [ ]
   - [ ] [gap 1]
   - [ ] [gap 2]

## Success Criteria
- All integration tests pass
- Full test suite passes
- Smoke test produces valid JSONL file
- --continue flag triggers resume flow
- No deferred implementation patterns
- Holistic assessment verdict is PASS

## Failure Recovery
```bash
git checkout -- packages/cli/src/gemini.tsx
git checkout -- packages/cli/src/ui/AppContainer.tsx
git checkout -- packages/cli/src/ui/hooks/useGeminiStream.ts
# Return to P26 and re-implement
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P26a.md`
