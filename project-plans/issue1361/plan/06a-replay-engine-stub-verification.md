# Phase 06a: Replay Engine Stub Verification

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P06a`

## Prerequisites
- Required: Phase 06 completed
- Verification: `grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P06" packages/core/src/recording/`

## Verification Commands

```bash
# Stub exists and compiles
test -f packages/core/src/recording/ReplayEngine.ts
cd packages/core && npx tsc --noEmit

# Exports work
grep -q "replaySession\|readSessionHeader" packages/core/src/recording/index.ts

# Function signatures correct
grep -q "filePath.*string" packages/core/src/recording/ReplayEngine.ts
grep -q "expectedProjectHash.*string" packages/core/src/recording/ReplayEngine.ts
grep -q "ReplayResult\|ReplayError" packages/core/src/recording/ReplayEngine.ts
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Do function signatures match the specification?** — [ ]
   - [ ] `replaySession(filePath: string, expectedProjectHash: string)` returns `Promise<ReplayResult | ReplayError>`
   - [ ] `readSessionHeader(filePath: string)` returns `Promise<SessionStartPayload | null>`
2. **Are return types correctly referencing types.ts?** — [ ]
   - [ ] ReplayResult, ReplayError (or ReplayOutcome) from types.ts
   - [ ] SessionStartPayload from types.ts
3. **Is the stub correctly minimal?** — [ ]
   - [ ] No implementation logic present
   - [ ] Throws NotYetImplemented or returns empty value
4. **Are exports correct?** — [ ]
   - [ ] replaySession and readSessionHeader exported from index.ts
5. **What's MISSING?** — [ ]
   - [ ] [gap 1]

#### Holistic Functionality Assessment

```markdown
## What was created?
[Describe: ReplayEngine.ts stub with function signatures]

## Are signatures correct?
[Verify parameter types and return types match specification/pseudocode]

## Verdict
[PASS/FAIL]
```

#### Feature Actually Works
```bash
# Verify stub compiles and is importable
node -e "
const recording = require('./packages/core/dist/recording/index.js');
console.log('replaySession exists:', typeof recording.replaySession === 'function');
console.log('readSessionHeader exists:', typeof recording.readSessionHeader === 'function');
"
```

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/ReplayEngine.ts
# Re-implement Phase 06 stub
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P06a.md`
