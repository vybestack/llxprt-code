# Phase 15a: SessionBrowserDialog — Stub Verification

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P15a`

## Prerequisites
- Required: Phase 15 completed
- Verification: `test -f project-plans/issue1385/.completed/P15.md`

## Verification Commands

```bash
# File exists
test -f packages/cli/src/ui/components/SessionBrowserDialog.tsx || echo "FAIL"

# Plan markers
grep -c "@plan PLAN-20260214-SESSIONBROWSER.P15" packages/cli/src/ui/components/SessionBrowserDialog.tsx
# Expected: 2+

# Props are complete
grep "chatsDir" packages/cli/src/ui/components/SessionBrowserDialog.tsx || echo "FAIL"
grep "projectHash" packages/cli/src/ui/components/SessionBrowserDialog.tsx || echo "FAIL"
grep "currentSessionId" packages/cli/src/ui/components/SessionBrowserDialog.tsx || echo "FAIL"
grep "hasActiveConversation" packages/cli/src/ui/components/SessionBrowserDialog.tsx || echo "FAIL"
grep "onSelect" packages/cli/src/ui/components/SessionBrowserDialog.tsx || echo "FAIL"
grep "onClose" packages/cli/src/ui/components/SessionBrowserDialog.tsx || echo "FAIL"

# Exported
grep "export.*SessionBrowserDialog" packages/cli/src/ui/components/SessionBrowserDialog.tsx || echo "FAIL"

# No duplicate files
find packages/cli/src/ui/components -name "*SessionBrowser*V2*" | head -1
# Expected: no output

# TypeScript compiles
cd packages/cli && npx tsc --noEmit 2>&1 | grep -i error | head -5
```

### Semantic Verification Checklist
- [ ] Component takes all required props
- [ ] Component is a valid React functional component
- [ ] Uses correct Ink imports
- [ ] TypeScript compiles cleanly

## Failure Recovery
```bash
git checkout -- packages/cli/src/ui/components/SessionBrowserDialog.tsx
rm -f packages/cli/src/ui/components/SessionBrowserDialog.tsx
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P15a.md`
