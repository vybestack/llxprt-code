# Phase 27a: Old System Removal Verification

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P27a`

## Prerequisites
- Required: Phase 27 completed
- Verification: `grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P27" packages/`
- Expected: Old files deleted, no dangling references

## Verification Commands

```bash
# === DELETION VERIFICATION ===

# Old files must not exist
test ! -f packages/core/src/storage/SessionPersistenceService.ts && echo "OK: Service deleted" || echo "FAIL"
test ! -f packages/core/src/storage/SessionPersistenceService.test.ts && echo "OK: Test deleted" || echo "FAIL"

# === DANGLING REFERENCE VERIFICATION (comprehensive) ===

# Old class/type names
grep -rn "SessionPersistenceService" packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" && echo "FAIL" || echo "OK: No SessionPersistenceService refs"
grep -rn "PersistedSession[^R]" packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" && echo "FAIL" || echo "OK: No PersistedSession refs"
grep -rn "PersistedUIHistoryItem" packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" && echo "FAIL" || echo "OK: No PersistedUIHistoryItem refs"
grep -rn "PersistedToolCall" packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" && echo "FAIL" || echo "OK: No PersistedToolCall refs"
grep -rn "PERSISTED_SESSION_PREFIX" packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" && echo "FAIL" || echo "OK: No PERSISTED_SESSION_PREFIX refs"

# Old function/variable names
grep -rn "loadMostRecent" packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" && echo "FAIL" || echo "OK: No loadMostRecent refs"
grep -rn "restoredSession" packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" && echo "FAIL" || echo "OK: No restoredSession refs"
grep -rn "sessionRestoredRef" packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" && echo "FAIL" || echo "OK: No sessionRestoredRef refs"
grep -rn "coreHistoryRestoredRef" packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" && echo "FAIL" || echo "OK: No coreHistoryRestoredRef refs"
grep -rn "validateUIHistory" packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" && echo "FAIL" || echo "OK: No validateUIHistory refs"

# WIP stubs
grep -rn "ChatRecordingService" packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" && echo "FAIL" || echo "OK: No ChatRecordingService refs"
grep -rn "initializeChatRecording\|getChatRecordingService" packages/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" && echo "FAIL" || echo "OK: No ChatRecording stubs"

# === BUILD VERIFICATION ===

# TypeScript compiles with no errors
npm run typecheck
# Expected: Exit 0

# Build produces output
npm run build
# Expected: Exit 0

# All tests pass
npm run test 2>&1 | tail -20
# Expected: All pass, no failures

# Lint clean
npm run lint
# Expected: Exit 0

# Format check
npm run format
# Expected: No changes needed

# === NEW SYSTEM STILL WORKS ===

# New recording exports exist in core/index.ts
grep -q "SessionRecordingService" packages/core/src/index.ts && echo "OK: SessionRecordingService exported"
grep -q "ReplayEngine" packages/core/src/index.ts && echo "OK: ReplayEngine exported"
grep -q "SessionDiscovery" packages/core/src/index.ts && echo "OK: SessionDiscovery exported"
grep -q "SessionLockManager" packages/core/src/index.ts && echo "OK: SessionLockManager exported"

# New recording tests still pass
cd packages/core && npx vitest run src/recording/ 2>&1 | tail -20

# convertToUIHistory preserved
grep -q "convertToUIHistory" packages/cli/src/ui/AppContainer.tsx && echo "OK: convertToUIHistory preserved" || echo "FAIL: convertToUIHistory missing"
```

### Holistic Functionality Assessment

The verifier MUST write a documented assessment:

```markdown
## What was removed?
[List every file deleted, every function removed, every type removed, every export removed]

## What was preserved?
[List functions/types that were intentionally kept: convertToUIHistory, new system components]

## Dangling Reference Scan Results
[Paste actual grep output — every grep should return zero matches]

## Build + Test Results
[Paste actual output from: npm run typecheck, npm run build, npm run test, npm run lint]

## New System Smoke Test
[Paste actual output from smoke test showing JSONL file still created]

## Risk Assessment
[Any remaining code that references patterns similar to old system? Any conditional imports? Any dynamic requires?]

## Verdict
[PASS/FAIL]
```

### Semantic Verification — Feature Still Reachable After Removal

```bash
# Full smoke test: verify the new system works without the old system
npm run build
touch /tmp/before-removal-verify
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"

# Verify recording happened
JSONL_FILES=$(find ~/.llxprt -name "*.jsonl" -newer /tmp/before-removal-verify -type f 2>/dev/null)
echo "JSONL files after removal: $JSONL_FILES"
[ -z "$JSONL_FILES" ] && echo "FAIL: No recording after old system removal" || echo "OK: Recording works"

# Validate JSONL structure
FIRST_FILE=$(echo "$JSONL_FILES" | head -1)
if [ -n "$FIRST_FILE" ]; then
  echo "=== Event types in JSONL ==="
  cat "$FIRST_FILE" | while read line; do echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('type','?'), d.get('seq','?'))" 2>/dev/null; done
  echo "=== Line count ==="
  wc -l < "$FIRST_FILE"
fi

rm -f /tmp/before-removal-verify
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Is ALL old code actually gone (not just commented out)?** — [ ]
   - [ ] No `// old:` or `/* old */` comment blocks wrapping old code
   - [ ] No conditional flags like `USE_OLD_PERSISTENCE`
2. **Does the application still start and run?** — [ ]
   - [ ] Smoke test completes without crash
   - [ ] JSONL file produced
3. **Are there any orphaned imports?** — [ ]
   - [ ] No unused import warnings from lint
   - [ ] No import of deleted modules
4. **Are the storage/ directory files still sensible?** — [ ]
   - [ ] storage/ directory still contains other necessary files
   - [ ] No empty directories left behind
5. **What's MISSING?** — [ ]
   - [ ] [gap 1]

## Success Criteria
- Zero dangling references to old system (all grep checks pass)
- TypeScript compiles cleanly
- Build succeeds
- All tests pass
- Lint passes
- Smoke test produces valid JSONL recording
- New system exports verified in core/index.ts
- convertToUIHistory preserved

## Failure Recovery
```bash
# If dangling references found:
# 1. Identify the file and line
# 2. Remove or update the reference
# 3. Re-run typecheck
# 4. Re-run tests
# If build broken:
git checkout -- packages/
# Return to P27 and re-execute removal more carefully
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P27a.md`
