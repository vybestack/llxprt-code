# Phase 12a: useSessionBrowser Hook — Stub Verification

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P12a`

## Prerequisites
- Required: Phase 12 completed
- Verification: `test -f project-plans/issue1385/.completed/P12.md`

## Verification Commands

```bash
# File exists
test -f packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "FAIL"

# Plan markers
grep -c "@plan PLAN-20260214-SESSIONBROWSER.P12" packages/cli/src/ui/hooks/useSessionBrowser.ts
# Expected: 3+

# Types exported
grep "export.*EnrichedSessionSummary" packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "FAIL"
grep "export.*PreviewState" packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "FAIL"
grep "export.*UseSessionBrowserResult" packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "FAIL"

# All critical state fields
for field in searchTerm sortOrder selectedIndex page isSearching isLoading isResuming deleteConfirmIndex conversationConfirmActive error skippedCount; do
  grep "$field" packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "FAIL: missing $field"
done

# Derived state
grep "totalPages" packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "FAIL: totalPages"
grep "pageItems" packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "FAIL: pageItems"
grep "selectedSession" packages/cli/src/ui/hooks/useSessionBrowser.ts || echo "FAIL: selectedSession"

# No V2/duplicate files
find packages/cli/src/ui/hooks -name "*SessionBrowser*V2*" | head -1
# Expected: no output

# TypeScript compiles
cd packages/cli && npx tsc --noEmit 2>&1 | grep -i error | head -5
```

### Semantic Verification Checklist
- [ ] EnrichedSessionSummary extends SessionSummary with previewState, isLocked, firstUserMessage
- [ ] PreviewState is a string literal union
- [ ] Hook takes props (chatsDir, projectHash, currentSessionId, onSelect, onClose)
- [ ] Hook returns all state + derived + actions
- [ ] handleKeypress has correct signature (input: string, key: Key)

## Failure Recovery
```bash
git checkout -- packages/cli/src/ui/hooks/useSessionBrowser.ts
rm -f packages/cli/src/ui/hooks/useSessionBrowser.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P12a.md`
