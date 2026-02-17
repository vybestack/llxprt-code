# Phase 21a: Integration Wiring — Stub Verification

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P21a`

## Prerequisites
- Required: Phase 21 completed
- Verification: `test -f project-plans/issue1385/.completed/P21.md`

## Verification Commands

```bash
# UIState extended
grep "isSessionBrowserDialogOpen" packages/cli/src/ui/contexts/UIStateContext.tsx || echo "FAIL: UIState missing"

# UIActions extended
grep "openSessionBrowserDialog" packages/cli/src/ui/contexts/UIActionsContext.tsx || echo "FAIL: UIActions missing open"
grep "closeSessionBrowserDialog" packages/cli/src/ui/contexts/UIActionsContext.tsx || echo "FAIL: UIActions missing close"

# Dialog processor handles sessionBrowser
grep "sessionBrowser" packages/cli/src/ui/hooks/slashCommandProcessor.ts || echo "FAIL: processor missing"

# BuiltinCommandLoader registers resume
grep "continueCommand" packages/cli/src/services/BuiltinCommandLoader.ts || echo "FAIL: loader missing"

# DialogManager imports and renders
grep "SessionBrowserDialog\|sessionBrowser" packages/cli/src/ui/components/DialogManager.tsx || echo "FAIL: DialogManager missing"

# Metadata type
grep "interface SessionRecordingMetadata" packages/cli/src/ui/types/SessionRecordingMetadata.ts || echo "FAIL: type missing"

# SessionRecordingMetadata fields
grep "sessionId" packages/cli/src/ui/types/SessionRecordingMetadata.ts || echo "FAIL"
grep "filePath" packages/cli/src/ui/types/SessionRecordingMetadata.ts || echo "FAIL"
grep "startTime" packages/cli/src/ui/types/SessionRecordingMetadata.ts || echo "FAIL"
grep "isResumed" packages/cli/src/ui/types/SessionRecordingMetadata.ts || echo "FAIL"

# No duplicate files
find packages/cli/src -name "*SessionBrowserDialog*V2*" -o -name "*DialogManager*V2*" | head -1
# Expected: no output

# TypeScript compiles
cd packages/cli && npx tsc --noEmit 2>&1 | grep -i error | head -5

# Existing tests still pass (integration didn't break anything)
npm run test 2>&1 | tail -5
```

### Semantic Verification Checklist (YES/NO)
- [ ] YES/NO: UIState interface change follows existing dialog pattern (e.g., isModelsDialogOpen)?
- [ ] YES/NO: UIActions interface change follows existing open/close pattern?
- [ ] YES/NO: slashCommandProcessor case follows existing dialog cases (e.g., 'models', 'subagent')?
- [ ] YES/NO: BuiltinCommandLoader registration follows existing pattern (import + array add)?
- [ ] YES/NO: DialogManager rendering follows existing priority cascade?
- [ ] YES/NO: SessionRecordingMetadata has all 4 fields (sessionId, filePath, startTime, isResumed)?

## Failure Recovery
```bash
git checkout -- packages/cli/src/ui/contexts/UIStateContext.tsx
git checkout -- packages/cli/src/ui/contexts/UIActionsContext.tsx
git checkout -- packages/cli/src/ui/hooks/slashCommandProcessor.ts
git checkout -- packages/cli/src/services/BuiltinCommandLoader.ts
git checkout -- packages/cli/src/ui/components/DialogManager.tsx
rm -f packages/cli/src/ui/types/SessionRecordingMetadata.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P21a.md`
