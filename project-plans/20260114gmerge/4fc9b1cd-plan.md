# REIMPLEMENT Plan: Alternate Buffer Support

**Upstream SHA:** `4fc9b1cde298f7681beb93485c1c9993482ed717`  
**Subject:** alternate buffer support (#12471)

## Overview

This is a LARGE commit (1887 additions, 251 deletions) that adds terminal alternate buffer support - allows scrollback preservation when using the TUI.

## Files Changed (Upstream)

**Docs:**
- `docs/cli/keyboard-shortcuts.md` (+1)
- `docs/get-started/configuration.md` (+6)

**Settings:**
- `packages/cli/src/config/keyBindings.ts` (+2)
- `packages/cli/src/config/settingsSchema.ts` (+10)
- `schemas/settings.schema.json` (+7)

**Core UI Changes:**
- `packages/cli/src/gemini.tsx` (+52)
- `packages/cli/src/ui/AppContainer.tsx` (+31)
- `packages/cli/src/ui/components/InputPrompt.tsx` (+31)
- `packages/cli/src/ui/components/MainContent.tsx` (+98)
- `packages/cli/src/ui/contexts/KeypressContext.tsx` (+374 significant refactor)

**New Mouse Support:**
- `packages/cli/src/ui/contexts/MouseContext.tsx` (+149 - new)
- `packages/cli/src/ui/hooks/useMouse.ts` (+36 - new)
- `packages/cli/src/ui/utils/mouse.ts` (+214 - new)

**Input Utilities:**
- `packages/cli/src/ui/utils/input.ts` (+58 - new)
- `packages/cli/src/ui/utils/kittyProtocolDetector.ts` (+20)

**Tests:**
- Multiple test files (~600 lines)

## LLxprt Considerations

1. **KeypressContext.tsx** - LLxprt has KITTY_SEQUENCE_TIMEOUT_MS handling already
2. **gemini.tsx** - This is LLxprt's main entry, heavy conflicts expected
3. **Mouse Support** - New feature, likely clean but verify cursor handling
4. **Terminal Compatibility** - Test on various terminals

## Implementation Steps

1. Review LLxprt's current KeypressContext.tsx for timeout handling
2. Cherry-pick and handle conflicts in gemini.tsx carefully
3. New mouse files should be clean
4. Verify settings don't conflict with LLxprt's ephemeral system
5. Run full test suite

## High-Risk Areas

- `gemini.tsx` - Main entry point
- `KeypressContext.tsx` - Large refactor, LLxprt has own changes
- `MainContent.tsx` - UI structure

## Verification

```bash
npm run lint && npm run typecheck
npm run test
npm run build
# Manual test in different terminals (iTerm, kitty, VS Code integrated)
node scripts/start.js --profile-load synthetic --prompt "test alt buffer"
```

## Decision

- [ ] Careful cherry-pick with significant conflict resolution
- [ ] Test alternate buffer behavior manually

---

*Plan to be executed during Batch 17*
