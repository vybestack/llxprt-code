# Phase 12a: Recording Integration Stub Verification

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P12a`

## Prerequisites
- Required: Phase 12 completed
- Verification: `grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P12" packages/core/src/recording/`

## Verification Commands

```bash
# Stub exists and compiles
test -f packages/core/src/recording/RecordingIntegration.ts
cd packages/core && npx tsc --noEmit

# Exports work
grep -q "RecordingIntegration" packages/core/src/recording/index.ts

# Constructor takes SessionRecordingService
grep -q "SessionRecordingService" packages/core/src/recording/RecordingIntegration.ts || echo "FAIL: Constructor dependency missing"

# Method signatures — instance methods (not static)
grep -q "subscribeToHistory" packages/core/src/recording/RecordingIntegration.ts
grep -q "unsubscribeFromHistory" packages/core/src/recording/RecordingIntegration.ts
grep -q "onHistoryServiceReplaced" packages/core/src/recording/RecordingIntegration.ts
grep -q "recordProviderSwitch" packages/core/src/recording/RecordingIntegration.ts
grep -q "recordDirectoriesChanged" packages/core/src/recording/RecordingIntegration.ts
grep -q "recordSessionEvent" packages/core/src/recording/RecordingIntegration.ts
grep -q "flushAtTurnBoundary" packages/core/src/recording/RecordingIntegration.ts
grep -q "dispose" packages/core/src/recording/RecordingIntegration.ts

# No TODO comments
grep -r "TODO" packages/core/src/recording/RecordingIntegration.ts && echo "FAIL"
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Is RecordingIntegration an instance class (not static)?** — [ ]
   - [ ] Each session gets its own RecordingIntegration
2. **Does the constructor store SessionRecordingService reference?** — [ ]
   - [ ] Constructor parameter types match pseudocode
3. **Does subscribeToHistory accept HistoryService parameter?** — [ ]
   - [ ] Correct import from history module
4. **Are exports correct?** — [ ]
   - [ ] RecordingIntegration exported from index.ts
5. **What's MISSING?** — [ ]
   - [ ] [gap 1]

#### Holistic Functionality Assessment

```markdown
## What was created?
[Describe: RecordingIntegration.ts stub with instance methods]

## Are signatures correct?
[Verify constructor, subscribeToHistory, delegate methods, dispose]

## Verdict
[PASS/FAIL]
```

#### Feature Actually Works
```bash
# Verify stub compiles and is instantiable
node -e "
const recording = require('./packages/core/dist/recording/index.js');
console.log('RecordingIntegration exists:', typeof recording.RecordingIntegration === 'function');
"
```

- [ ] Instance class (not static) — each session gets its own RecordingIntegration
- [ ] Constructor stores SessionRecordingService reference
- [ ] subscribeToHistory takes HistoryService parameter (with correct import)
- [ ] Stub methods are no-ops or return Promise.resolve()
- [ ] No implementation logic present

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/RecordingIntegration.ts
# Re-implement Phase 12 stub
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P12a.md`
