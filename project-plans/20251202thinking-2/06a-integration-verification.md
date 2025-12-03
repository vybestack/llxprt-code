# Phase 06a: HistoryItem Type Extension Verification

## Phase ID

`PLAN-20251202-THINKING-UI.P06a`

## Prerequisites

- Required: Phase 06 completed
- Verification: Type extension added to HistoryItemGemini

---

## Structural Verification

### Plan Markers (Colon Syntax)

```bash
grep "@plan:PLAN-20251202-THINKING-UI.P06" packages/cli/src/ui/types.ts && echo "PASS" || echo "FAIL"
grep "@plan:PLAN-20251202-THINKING-UI.P06" packages/cli/src/ui/components/messages/GeminiMessage.tsx && echo "PASS" || echo "FAIL"
```

### ThinkingBlockDisplay Import

```bash
grep "import.*ThinkingBlockDisplay" packages/cli/src/ui/components/messages/GeminiMessage.tsx && echo "PASS" || echo "FAIL"
```

### ThinkingBlockDisplay Usage

```bash
grep "<ThinkingBlockDisplay" packages/cli/src/ui/components/messages/GeminiMessage.tsx && echo "PASS" || echo "FAIL"
```

### Type Extension

```bash
grep "thinkingBlocks.*ThinkingBlock" packages/cli/src/ui/types.ts && echo "PASS" || echo "FAIL"
```

### RuntimeApi Usage (NOT config prop)

```bash
grep "useRuntimeApi" packages/cli/src/ui/components/messages/GeminiMessage.tsx && echo "PASS" || echo "FAIL"
```

---

## Functional Verification

### TypeScript Compilation

```bash
npm run typecheck
# Expected: No errors
```

### All Tests Pass

```bash
# Full test suite
npm test -- packages/cli/src/ui/components/messages/ --run
# Expected: All tests pass
```

### Build Succeeds

```bash
npm run build
# Expected: Build completes without errors
```

---

## Semantic Verification

### Type Extension Points Verified

- [ ] ThinkingBlock type imported in types.ts
- [ ] thinkingBlocks added to HistoryItemGemini
- [ ] thinkingBlocks added to HistoryItemGeminiContent
- [ ] GeminiMessage props includes thinkingBlocks
- [ ] HistoryItemDisplay passes thinkingBlocks to GeminiMessage

### Settings Access Verified

- [ ] GeminiMessage uses `useRuntimeApi()` hook
- [ ] Does NOT use `config?.getEphemeralSetting?.(...)`
- [ ] Reads `reasoning.includeInResponse` setting correctly

---

## Holistic Functionality Assessment

### What was implemented?

[Describe the type extension and how ThinkingBlocks are now passed through the component hierarchy]

### Does the type extension enable the feature?

- [ ] HistoryItemGemini can now carry ThinkingBlock data
- [ ] GeminiMessage can receive and render ThinkingBlocks
- [ ] Settings control is wired correctly

### End-to-End Type Flow

```
HistoryItemGemini { ..., thinkingBlocks?: ThinkingBlock[] }
    |
    v
HistoryItemDisplay receives typed item
    |
    v
itemForDisplay.thinkingBlocks passed to GeminiMessage
    |
    v
GeminiMessage { ..., thinkingBlocks?: ThinkingBlock[] }
    |
    v
useRuntimeApi().getEphemeralSetting('reasoning.includeInResponse')
    |
    v
If enabled: render ThinkingBlockDisplay for each block
```

### What is NOT yet implemented?

- [ ] useGeminiStream does NOT yet populate thinkingBlocks (Phase 08)
- [ ] Streaming Thought events are NOT yet captured (Phase 08)
- [ ] End-to-end flow is NOT complete until Phase 08

### Verdict

[PASS/FAIL with explanation - this phase only validates types and rendering, not the full pipeline]

---

## Verification Checklist

- [ ] TypeScript compiles
- [ ] All tests pass
- [ ] Build succeeds
- [ ] ThinkingBlockDisplay imported in GeminiMessage
- [ ] ThinkingBlockDisplay rendered for thinking blocks
- [ ] Visibility controlled by ephemeral setting via useRuntimeApi
- [ ] No breaking changes to existing functionality
- [ ] Plan markers present (colon syntax)
- [ ] Types extended correctly

---

## Phase Completion Criteria

When all Phase 06a checkboxes are checked:

1. Proceed to Phase 07 (Stream Integration TDD)
2. This phase ONLY validates the type extension
3. Full integration is NOT complete until Phase 08a

---

## Next Phase

Phase 07: Stream Integration TDD

Write tests for:
- useGeminiStream accumulating ThinkingBlocks from Thought events
- thinkingBlocks included in flushed history items
- Settings control at stream level
