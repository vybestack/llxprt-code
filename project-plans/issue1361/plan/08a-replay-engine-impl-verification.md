# Phase 08a: Replay Engine Implementation Verification

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P08a`

## Prerequisites
- Required: Phase 08 completed
- Verification: `grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P08" packages/core/src/recording/`

## Verification Commands

```bash
# All tests pass
cd packages/core && npx vitest run src/recording/ReplayEngine.test.ts

# No test modifications
git diff packages/core/src/recording/ReplayEngine.test.ts

# Deferred implementation detection
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/recording/ReplayEngine.ts | grep -v ".test.ts"
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/recording/ReplayEngine.ts
grep -rn -E "return \[\]$|return \{\}$|return null$|return undefined$" packages/core/src/recording/ReplayEngine.ts

# Full typecheck
cd packages/core && npx tsc --noEmit

# Verify pseudocode compliance
grep -c "@pseudocode" packages/core/src/recording/ReplayEngine.ts
# Expected: 1+ references to pseudocode line numbers
```

### Holistic Functionality Assessment

The verifier MUST write a documented assessment:

```markdown
## What was implemented?
[Describe: streaming JSONL parser that accumulates IContent[], handles compression/rewind, validates project hash, handles corruption gracefully]

## Does it satisfy the requirements?
[For each REQ-RPL-*: explain HOW the implementation satisfies it with specific code references]
- REQ-RPL-001: [How replaySession returns ReplayResult]
- REQ-RPL-002: [How content events are accumulated]
- REQ-RPL-003: [How compressed events clear and reset history]
- REQ-RPL-002d: [How rewind events remove N items]
- REQ-RPL-005: [How corruption is handled per location in file]
- REQ-RPL-006: [How project hash validation works]

## What is the data flow?
[Trace: createReadStream → readline → parse JSON → switch on type → accumulate history → return ReplayResult]

## What could go wrong?
[Identify edge cases: very large files, concurrent reads during write, corrupted session_start, encoding issues]

## Verdict
[PASS/FAIL]
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Does the code DO what the requirement says?**
   - [ ] Read the requirement text for REQ-RPL-001 through REQ-RPL-005
   - [ ] Read the implementation code
   - [ ] Can explain HOW each requirement is fulfilled
2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] No empty returns in implementation
   - [ ] No "will be implemented" comments
3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests verify actual history contents, not just that code ran
   - [ ] Tests would catch a broken replay engine
4. **Is the feature REACHABLE by users?**
   - [ ] replaySession is exported from recording/index.ts
   - [ ] Will be called by resume flow in Phase 20
5. **What's MISSING?**
   - [ ] [List gaps that need fixing]

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/ReplayEngine.ts
# Re-implement Phase 08 from pseudocode
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P08a.md`
