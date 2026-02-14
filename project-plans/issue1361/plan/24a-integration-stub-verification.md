# Phase 24a: System Integration Stub Verification

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P24a`

## Prerequisites
- Required: Phase 24 completed
- Verification: `grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P24" packages/cli/src/ packages/core/src/config/`

## Verification Commands

```bash
# TypeScript compiles
npm run typecheck

# All existing tests pass
npm run test 2>&1 | tail -10

# Build succeeds
npm run build

# Plan markers present in integration files
grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P24" packages/cli/src/gemini.tsx && echo "OK"
grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P24" packages/core/src/config/config.ts && echo "OK"

# Config methods exist
grep -q "getContinueSessionRef" packages/core/src/config/config.ts || echo "FAIL"

# Recording imports present in gemini.tsx
grep -q "SessionRecordingService\|RecordingIntegration\|recording" packages/cli/src/gemini.tsx || echo "WARNING: imports missing"

# No broken existing behavior
npm run lint 2>&1 | tail -5
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Do all stub imports reference actual exports?** — [ ]
   - [ ] No import errors
   - [ ] Compilation clean
2. **Does Config.isContinueSession() handle the new string type?** — [ ]
   - [ ] Returns boolean correctly for both bare --continue and --continue <id>
3. **Are all existing tests still passing?** — [ ]
   - [ ] npm run test shows no regressions
4. **Does build produce valid output?** — [ ]
   - [ ] npm run build succeeds
5. **What's MISSING?** — [ ]
   - [ ] [gap 1]

#### Holistic Functionality Assessment

```markdown
## What was wired (as stubs)?
[Describe: stub imports and placeholders added to gemini.tsx, AppContainer.tsx, useGeminiStream.ts, config.ts]

## Does everything still compile and pass tests?
[Verify existing tests pass, build works, lint clean]

## Verdict
[PASS/FAIL]
```

#### Feature Actually Works
```bash
# Verify existing app still starts and works
npm run build
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"
# Expected: Session completes without errors (recording may not yet produce output in stub phase)
```

- [ ] All stub imports reference actual exports
- [ ] Config.isContinueSession() handles new string type correctly
- [ ] No existing tests broken
- [ ] Build produces valid output
- [ ] Lint passes

## Failure Recovery
```bash
git checkout -- packages/cli/src/gemini.tsx
git checkout -- packages/cli/src/ui/AppContainer.tsx
git checkout -- packages/cli/src/ui/hooks/useGeminiStream.ts
git checkout -- packages/core/src/config/config.ts
# Re-implement Phase 24 stubs
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P24a.md`
