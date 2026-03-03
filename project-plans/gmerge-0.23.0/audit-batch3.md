# Gemini CLI Cherry-Pick Audit - Batch 3 of 7

Date: 2026-02-26
Auditor: LLxprt Code AI
Upstream commits: 739c02bd6d through 322232e514

## 11. 739c02bd6d — "fix(cli): correct initial history length handling for chat commands (#15223)"

**Verdict:** REIMPLEMENT

**Confidence:** HIGH

**Evidence:**
- Upstream changes:
  - Added `INITIAL_HISTORY_LENGTH = 1` constant in `packages/core/src/utils/environmentContext.ts`
  - Exported it from `packages/core/src/index.ts`
  - Modified `chatCommand.ts` to use constant instead of hardcoded `2`
  - Changed logic from checking `history.length > 2` to `history.length > INITIAL_HISTORY_LENGTH`
  - Updated `/resume` to skip initial entries: `conversation.slice(INITIAL_HISTORY_LENGTH)`
  - Simplified loop logic by removing manual system prompt detection
- LLxprt current state:
  - `chatCommand.ts` at lines 158, 268, 441: uses hardcoded `history.length > 2` and `history.length <= 2`
  - `environmentContext.ts` exists but has NO `INITIAL_HISTORY_LENGTH` constant
  - Our history includes initial context setup (similar concept but different count)

**Rationale:**
This is a bug fix addressing confusion about how many "setup" messages are in initial history. Upstream changed from 2 to 1 because their system prompt is a single user message. We need to verify our actual initial history length. Looking at our `chatCommand.ts`:
- Line 158: `if (history.length > 2)` - checking if conversation has content beyond setup
- Line 268: `if (history.length <= 2)` - checking if conversation is empty
- Line 441: Similar empty check

Our `getEnvironmentContext()` returns `Part[]` which gets converted to Content. Need to trace how many initial history entries we actually create. The constant-based approach is superior to magic numbers regardless.

**Action Required:**
1. Determine our actual `INITIAL_HISTORY_LENGTH` (likely 1 like upstream, not 2)
2. Add constant to `environmentContext.ts`
3. Export from `core/src/index.ts`
4. Replace all hardcoded `2` with `INITIAL_HISTORY_LENGTH` in `chatCommand.ts`
5. Audit the `/resume` logic to ensure we skip initial history correctly

**Conflicts expected:** NO - straightforward constant replacement

---

## 12. bc168bbae4 — "Change detailed model stats to use a new shared Table class (#15208)"

**Verdict:** SKIP

**Confidence:** HIGH

**Evidence:**
- Upstream changes:
  - Created new `packages/cli/src/ui/components/Table.tsx` (87 lines) - generic table component
  - Refactored `ModelStatsDisplay.tsx` to use Table instead of custom StatRow layout
  - Table uses column definitions with `width`, `flexGrow`, `flexShrink`, `renderCell`
  - Data format changed from row-based rendering to columnar data structure
- LLxprt current state:
  - `ModelStatsDisplay.tsx` uses custom `StatRow` component with hardcoded widths
  - NO `Table.tsx` component exists
  - Our version has theme violations fixed (issue #684) using `Colors.*` constants
  - Works fine with current hardcoded column widths

**Rationale:**
This is a REFACTORING for code quality and handling long model names (e.g., "gemini-3-pro-preview"). The new Table component is generic and reusable, but:
1. We don't have multiple places needing table rendering yet
2. Our ModelStatsDisplay works correctly with current model names
3. The refactor is purely structural, not functional
4. If we need it later (e.g., multi-provider stats, long provider names), we can implement then
5. The test changes show it handles long names better, but we don't have that problem yet

**Action Required:** None. Mark as potential future enhancement if we add multi-provider stats or encounter layout issues.

**Conflicts expected:** N/A (skipping)

---

## 13. 7da060c149 — "(docs): Add reference section to hooks documentation (#15159)"

**Verdict:** NO_OP

**Confidence:** HIGH

**Evidence:**
- Upstream changes:
  - Added `docs/hooks/reference.md` (168 lines) - technical specification
  - Updated `docs/hooks/index.md` to link to reference
  - Added entry to `docs/sidebar.json`
- LLxprt current state:
  - `docs/hooks/api-reference.md` (exists) - comprehensive API documentation
  - `docs/hooks/index.md` (exists) - overview and links
  - Our `api-reference.md` ALREADY covers:
    - Communication protocol (exit codes, stdin/stdout)
    - Input/output schemas
    - Event-specific fields
    - LLM stable model API (LLMRequest/LLMResponse)
  - Content overlap is ~90%

**Rationale:**
We already have equivalent documentation in `api-reference.md`. The upstream `reference.md` adds:
- More detailed exit code table
- Slightly different formatting (markdown tables vs code blocks)
- Some examples we don't have

But our existing `api-reference.md` is MORE comprehensive (623 lines vs 168 lines) and covers the same ground plus additional detail. No need to duplicate or replace.

**Action Required:** None. Our documentation is already superior.

**Conflicts expected:** N/A (already have this)

---

## 14. 54466a3ea8 — "feat(hooks): add support for friendly names and descriptions (#15174)"

**Verdict:** REIMPLEMENT

**Confidence:** HIGH

**Evidence:**
- Upstream changes:
  - Added `name?: string` and `description?: string` to `CommandHookConfig` type
  - Updated `HookRegistry` to use `config.name || config.command` for identification
  - Modified `HookPlanner` deduplication key to use both name and command: `${name}:${command}`
  - Updated UI (`HooksList.tsx`) to display friendly name and description
  - Modified `hooksCommand.ts` to use friendly names in enable/disable commands
  - Updated settings schema with name/description fields
  - Changed docs: name is now "recommended" not "required"
- LLxprt current state:
  - `packages/core/src/hooks/types.ts` - CommandHookConfig has NO `name` or `description` fields
  - Our `hookRegistry.ts` uses `config.command` for identification (line ~103)
  - Our `HookPlanner` deduplication uses only command
  - Our docs and examples don't mention friendly names

**Rationale:**
This is a FEATURE that improves usability:
1. Better UX for `/hooks enable/disable` - use friendly names instead of paths
2. Helps users understand what hooks do (descriptions in UI)
3. Proper deduplication when same hook is in multiple config layers
4. Backward compatible - name/description are optional

We should implement this since hooks are a core feature. The implementation is clean and isolated to:
- Type definitions
- Registry/Planner identification logic
- UI display
- Settings schema

**Action Required:**
1. Add `name?: string; description?: string;` to `CommandHookConfig` in types.ts
2. Update `hookRegistry.ts` `getHookName()` to prefer name over command
3. Update `hookPlanner.ts` deduplication to use `name:command` key
4. Update settings schema (if we have it - check `settingsSchema.ts`)
5. Update hook UI components to display name/description
6. Update docs to mention friendly names
7. Add tests for name-based identification

**Conflicts expected:** NO - additive changes, backward compatible

---

## 15. 322232e514 — "feat: Detect background color (#15132)"

**Verdict:** SKIP

**Confidence:** MEDIUM

**Evidence:**
- Upstream changes (28 files):
  - Added `packages/cli/src/utils/terminalTheme.ts` - theme detection/setup logic
  - Added `packages/cli/src/ui/utils/terminalCapabilityManager.ts` (237 lines) - detects Kitty protocol AND background color via escape sequences
  - Removed `kittyProtocolDetector.ts` (replaced by above)
  - Modified `theme.ts` - added `pickDefaultThemeName()` function
  - Modified `color-utils.ts` - added `getThemeTypeFromBackgroundColor()` 
  - Updated `ThemeDialog.tsx` - shows background color detection info
  - Updated `theme-manager.ts` - integration with detection
  - Multiple test files for new functionality
- LLxprt current state:
  - NO `terminalCapabilityManager.ts` - we have `terminalContract.ts`, `terminalSetup.ts`
  - Our `theme-manager.ts` has no background detection
  - Our theme system works differently (uses `Colors.*` constants, not semantic tokens system)
  - We have manual theme selection via `/theme` command

**Rationale:**
This is a COMPLEX feature that:
1. Sends escape sequences to terminal to query background color (OSC 11)
2. Parses response in format `rgb:RRRR/GGGG/BBBB`
3. Auto-selects light/dark theme based on detected background
4. Shows warnings if theme doesn't match background

**Why SKIP:**
1. **Architectural divergence**: Our theme system is fundamentally different (Colors vs semantic tokens)
2. **Terminal compatibility risk**: Escape sequences don't work in all terminals, can break non-TTY usage
3. **Complexity**: 28 files, extensive testing needed, escape sequence parsing
4. **Limited value**: Users can manually select theme with `/theme` command
5. **Our theme system works well**: No user complaints about theme detection
6. **Time investment**: Would require reimplementing terminalCapabilityManager, theme detection, and integration

**Action Required:** None. Document as "intentionally skipped - architectural differences, manual theme selection sufficient"

**Conflicts expected:** N/A (skipping)

**Notes for future:**
- If users request auto theme detection, revisit
- Consider simpler approach: check `$COLORFGBG` env var or terminal type
- Could implement just `getThemeTypeFromBackgroundColor()` helper if useful elsewhere

---

## Summary

| Commit | Verdict | Complexity | Priority |
|--------|---------|------------|----------|
| 739c02bd6d | REIMPLEMENT | Low | High - Bug fix |
| bc168bbae4 | SKIP | Medium | None - Works fine |
| 7da060c149 | NO_OP | N/A | None - Already have |
| 54466a3ea8 | REIMPLEMENT | Medium | Medium - UX improvement |
| 322232e514 | SKIP | High | None - Architectural differences |

**Next Steps:**
1. Fix #11 (INITIAL_HISTORY_LENGTH) first - it's a bug fix
2. Implement #14 (friendly names) - good UX improvement, clean implementation
3. Skip #12, #13, #15 - document rationale

**Total effort estimate:**
- Commit 11: ~50 lines changed, 2 hours (verify history length, add constant, update references)
- Commit 14: ~150 lines changed, 6 hours (types, registry, planner, UI, docs, tests)
- Total: ~8 hours
