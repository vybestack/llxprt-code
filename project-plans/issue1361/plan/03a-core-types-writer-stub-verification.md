# Phase 03a: Core Types + Writer Stub Verification

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P03a`

## Prerequisites
- Required: Phase 03 completed
- Verification: `grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P03" packages/core/src/recording/`

## Verification Commands

```bash
# TypeScript compiles
cd packages/core && npx tsc --noEmit

# All type exports work
grep -q "SessionRecordLine" packages/core/src/recording/types.ts
grep -q "SessionEventType" packages/core/src/recording/types.ts
grep -q "SessionStartPayload" packages/core/src/recording/types.ts
grep -q "ContentPayload" packages/core/src/recording/types.ts
grep -q "CompressedPayload" packages/core/src/recording/types.ts
grep -q "RewindPayload" packages/core/src/recording/types.ts
grep -q "ProviderSwitchPayload" packages/core/src/recording/types.ts
grep -q "SessionEventPayload" packages/core/src/recording/types.ts
grep -q "DirectoriesChangedPayload" packages/core/src/recording/types.ts
grep -q "SessionMetadata" packages/core/src/recording/types.ts
grep -q "ReplayResult" packages/core/src/recording/types.ts

# Service class exists with correct methods
grep -q "enqueue" packages/core/src/recording/SessionRecordingService.ts
grep -q "flush" packages/core/src/recording/SessionRecordingService.ts
grep -q "isActive" packages/core/src/recording/SessionRecordingService.ts
grep -q "initializeForResume" packages/core/src/recording/SessionRecordingService.ts
grep -q "recordContent" packages/core/src/recording/SessionRecordingService.ts
grep -q "recordCompressed" packages/core/src/recording/SessionRecordingService.ts

# No reverse testing
grep -r "expect.*NotYetImplemented\|toThrow.*NotYetImplemented" packages/core/src/recording/ && echo "FAIL"

# Barrel export works
grep -q "recording" packages/core/src/index.ts
```

### Deferred Implementation Detection
```bash
grep -rn "TODO\|FIXME\|HACK" packages/core/src/recording/ --include="*.ts" | grep -v ".test.ts"
# Expected: No matches (stubs use NotYetImplemented throws, not TODO)
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Do the types correctly define all 7 event payload interfaces?** — [ ]
   - [ ] SessionStartPayload, ContentPayload, CompressedPayload, RewindPayload, ProviderSwitchPayload, SessionEventPayload, DirectoriesChangedPayload
2. **Does SessionRecordingService have the correct public API surface?** — [ ]
   - [ ] enqueue, flush, isActive, getFilePath, getSessionId, initializeForResume, dispose, plus convenience methods
3. **Are the types COMPLETE (not stubs)?** — [ ]
   - [ ] All fields defined with correct TypeScript types
   - [ ] No `any` types
4. **Does the barrel export work end-to-end?** — [ ]
   - [ ] `packages/core/src/recording/index.ts` re-exports types and classes
   - [ ] `packages/core/src/index.ts` exports from `./recording/index.js`
5. **What's MISSING?** — [ ]
   - [ ] [gap 1]

#### Holistic Functionality Assessment

The verifier MUST write a documented assessment:

```markdown
## What was created?
[List all files and their contents: types.ts (type definitions), SessionRecordingService.ts (stub), index.ts (barrel)]

## Are the types complete?
[For each of the 7 event types: verify all fields are defined with correct types]

## Is the stub API correct?
[Verify constructor signature, method signatures, return types match specification]

## Verdict
[PASS/FAIL]
```

#### Feature Actually Works
```bash
# Verify types compile and service can be instantiated (even as stub)
node -e "
const recording = require('./packages/core/dist/recording/index.js');
console.log('Exports:', Object.keys(recording));
// Verify SessionRecordingService constructor exists
const svc = new recording.SessionRecordingService({
  sessionId: 'test',
  projectHash: 'hash',
  chatsDir: '/tmp',
  workspaceDirs: ['/test'],
  provider: 'test',
  model: 'model'
});
console.log('Service created:', svc.getSessionId());
"
```

- [ ] Types import IContent correctly from `../services/history/IContent.js`
- [ ] All 7 event payload types are fully defined with correct fields
- [ ] SessionRecordingService constructor accepts correct config
- [ ] Stub methods have correct return types (not `any`)
- [ ] Barrel export re-exports all public types and classes

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/
rm -rf packages/core/src/recording/
# Re-implement Phase 03 from scratch
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P03a.md`
