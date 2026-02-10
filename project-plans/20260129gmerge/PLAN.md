# Execution Plan: v0.15.4 → v0.16.0 Cherry-Pick

**Branch:** `20260129gmerge`
**Created:** 2026-01-29
**Upstream range:** `v0.15.4..v0.16.0`
**Tracking Issue:** TBD

---

## START HERE (If you were told to "DO this plan")

If you're reading this because someone said "DO @project-plans/20260129gmerge/PLAN.md", follow these steps:

### Step 1: Check current state

```bash
git branch --show-current  # Should be 20260129gmerge
git status                 # Check for uncommitted changes
```

### Step 2: Check or create the todo list

Call `todo_read()` first. If empty or doesn't exist, call `todo_write()` with the EXACT todo list from the "Todo List Management" section below.

### Step 3: Find where to resume

- Look at the todo list for the first `pending` item
- If an item is `in_progress`, restart that item
- If all items are `completed`, you're done

### Step 4: Execute using subagents

For each batch, you MUST use the `task` tool to invoke subagents:

- **For execution tasks (BN-exec):** Call `task` with `subagent_name: "cherrypicker"`
- **For review tasks (BN-review):** Call `task` with `subagent_name: "reviewer"`
- **For remediation (if review fails):** Call `task` with `subagent_name: "cherrypicker"`

- **DO NOT** do the cherry-picks yourself - use the cherrypicker subagent
- **DO NOT** do the reviews yourself - use the reviewer subagent
- Continue until todo list is empty or you hit a blocker

### Step 5: If blocked

- Call `todo_pause()` with the specific reason
- Wait for human intervention

---

## Non-Negotiables

See `dev-docs/cherrypicking.md` for full details:

- Privacy: No Clearcut telemetry, no Google-specific auth
- Multi-provider: Preserve provider abstraction
- Tool batching: Keep LLxprt's parallel tool execution
- Branding: Replace gemini -> llxprt in user-facing strings

---

## File Existence Pre-Check

Files that REIMPLEMENT plans reference that may differ in LLxprt:

| Upstream File | LLxprt Equivalent | Status |
|---------------|-------------------|--------|
| `StickyHeader.tsx` | Does not exist | Will be created |
| `ToolMessage.tsx` | Same path | Exists, will be modified |
| `ToolGroupMessage.tsx` | Same path | Exists, will be modified |
| `ThemedGradient.tsx` | Same path | Exists from v0.15.4 sync |
| `ScrollableList.tsx` | Same path | Exists |
| `keyBindings.ts` | Same path | Exists |

---

## Branding Substitutions

| Upstream | LLxprt |
|----------|--------|
| `gemini` | `llxprt` |
| `Gemini CLI` | `LLxprt Code` |
| `GEMINI_` env vars | `LLXPRT_` env vars |
| `@google/gemini-cli` | `@vybestack/llxprt-code` |

---

## Todo List Management

### EXACT todo_write call to use:

```typescript
todo_write({
  todos: [
    // Batch 1: PICK - First 7 commits
    { id: "B1-exec", content: "Batch 1 EXECUTE: cherry-pick e8038c727 d3cf28eb4 cab9b1f37 1c8fe92d0 1c87e7cd2 1ffb9c418 540f60696", status: "pending", priority: "high" },
    { id: "B1-review", content: "Batch 1 REVIEW: verify commits landed, lint, typecheck, qualitative check", status: "pending", priority: "high" },
    { id: "B1-commit", content: "Batch 1 COMMIT: git add -A && git commit", status: "pending", priority: "high" },
    
    // Batch 2: PICK - Remaining 7 commits + FULL VERIFY
    { id: "B2-exec", content: "Batch 2 EXECUTE: cherry-pick 4d85ce40b 0075b4f11 aa9922bc9 ad1f0d995 a810ca80b 43916b98a 13d8d9477", status: "pending", priority: "high" },
    { id: "B2-review", content: "Batch 2 REVIEW + FULL VERIFY: lint, typecheck, test, build, qualitative check", status: "pending", priority: "high" },
    { id: "B2-commit", content: "Batch 2 COMMIT: git add -A && git commit", status: "pending", priority: "high" },
    
    // Batch 3: REIMPLEMENT - Sticky Headers (3 commits together)
    { id: "B3-exec", content: "Batch 3 REIMPLEMENT: Sticky Headers (ee7065f66 + fb99b9537 + d30421630) - create StickyHeader.tsx, modify tool messages", status: "pending", priority: "high" },
    { id: "B3-review", content: "Batch 3 REVIEW: verify sticky headers work, lint, typecheck", status: "pending", priority: "high" },
    { id: "B3-commit", content: "Batch 3 COMMIT: git add -A && git commit", status: "pending", priority: "high" },
    
    // Batch 4: REIMPLEMENT - UI improvements + FULL VERIFY
    { id: "B4-exec", content: "Batch 4 REIMPLEMENT: 3cbb170aa (ThemedGradient) + 60fe5acd6 (animated scroll) + 2b8adf8cf (drag scrollbar)", status: "pending", priority: "high" },
    { id: "B4-review", content: "Batch 4 REVIEW + FULL VERIFY: lint, typecheck, test, build, verify scroll/drag works", status: "pending", priority: "high" },
    { id: "B4-commit", content: "Batch 4 COMMIT: git add -A && git commit", status: "pending", priority: "high" },
    
    // Batch 5: REIMPLEMENT - MALFORMED_FUNCTION_CALL handling
    { id: "B5-exec", content: "Batch 5 REIMPLEMENT: fb0324295 (MALFORMED_FUNCTION_CALL handling)", status: "pending", priority: "medium" },
    { id: "B5-review", content: "Batch 5 REVIEW: verify error handling works, lint, typecheck", status: "pending", priority: "medium" },
    { id: "B5-commit", content: "Batch 5 COMMIT: git add -A && git commit", status: "pending", priority: "medium" },
    
    // Final documentation
    { id: "FINAL-progress", content: "UPDATE PROGRESS.md with all commit hashes", status: "pending", priority: "medium" },
    { id: "FINAL-notes", content: "UPDATE NOTES.md with conflicts/deviations", status: "pending", priority: "medium" },
    { id: "FINAL-audit", content: "UPDATE AUDIT.md with all outcomes", status: "pending", priority: "medium" },
  ]
})
```

---

## Batch Schedule

### Batch 1: PICK - First 7 commits
**Type:** PICK
**Verify:** Quick (lint, typecheck)

| Order | SHA | Subject |
|-------|-----|---------|
| 1 | `e8038c727` | fix test to use faketimer (#12913) |
| 2 | `d3cf28eb4` | Use PascalCase for all tool display names (#12918) |
| 3 | `cab9b1f37` | Fix extensions disable/enable commands not awaiting handler (#12915) |
| 4 | `1c8fe92d0` | feat(hooks): Hook Result Aggregation (#9095) |
| 5 | `1c87e7cd2` | feat(core): enhance RipGrep tool with advanced search options (#12677) |
| 6 | `1ffb9c418` | fix(FileCommandLoader): Remove error logs if aborted (#12927) |
| 7 | `540f60696` | fix(docs): Release version for read many files removal (#12949) |

**Cherrypicker prompt:**
```
Execute cherry-pick batch 1 for LLxprt Code sync from upstream gemini-cli v0.15.4 to v0.16.0.

Cherry-pick these 7 commits in order:
1. e8038c727 - fix test to use faketimer (#12913)
2. d3cf28eb4 - Use PascalCase for all tool display names (#12918)
3. cab9b1f37 - Fix extensions disable/enable commands not awaiting handler (#12915)
4. 1c8fe92d0 - feat(hooks): Hook Result Aggregation (#9095)
5. 1c87e7cd2 - feat(core): enhance RipGrep tool with advanced search options (#12677)
6. 1ffb9c418 - fix(FileCommandLoader): Remove error logs if aborted (#12927)
7. 540f60696 - fix(docs): Release version for read many files removal (#12949)

Commands:
git cherry-pick e8038c727
git cherry-pick d3cf28eb4
git cherry-pick cab9b1f37
git cherry-pick 1c8fe92d0
git cherry-pick 1c87e7cd2
git cherry-pick 1ffb9c418
git cherry-pick 540f60696

If conflicts occur:
- Resolve following dev-docs/cherrypicking.md
- Apply branding substitutions (gemini -> llxprt, @google/gemini-cli -> @vybestack/llxprt-code)
- Continue with: git cherry-pick --continue

After all picks, run quick verify:
npm run lint && npm run typecheck
```

**Reviewer prompt:**
```
Review cherry-pick batch 1 for LLxprt Code sync.

MECHANICAL VERIFICATION:
1. Run: npm run lint
2. Run: npm run typecheck
3. Check for branding issues: grep -r "@google/gemini-cli\|USE_GEMINI" packages/

QUALITATIVE VERIFICATION (for each commit):
1. e8038c727 - Verify faketimer test fix applied
2. d3cf28eb4 - Verify PascalCase tool names (check tool displayName properties)
3. cab9b1f37 - Verify extensions await handler (check for await in enable/disable)
4. 1c8fe92d0 - Verify hookAggregator.ts created with test
5. 1c87e7cd2 - Verify RipGrep enhancements (new search options)
6. 1ffb9c418 - Verify FileCommandLoader abort fix (no error logs on abort)
7. 540f60696 - Verify docs fix applied

For each commit, verify:
- Code actually landed (not stubbed)
- Behavioral equivalence to upstream
- Integration correctness

Output format:
PASS/FAIL: [overall]
Per-commit:
- [sha]: LANDED=[yes/no] FUNCTIONAL=[yes/no] NOTES=[any issues]
```

---

### Batch 2: PICK - Remaining 7 commits + FULL VERIFY
**Type:** PICK
**Verify:** Full (lint, typecheck, test, build)

| Order | SHA | Subject |
|-------|-----|---------|
| 1 | `4d85ce40b` | Turns out console.clear() clears the buffer. (#12959) |
| 2 | `0075b4f11` | Always show the tool internal name in /tools (#12964) |
| 3 | `aa9922bc9` | feat: autogenerate keyboard shortcut docs (#12944) |
| 4 | `ad1f0d995` | refactor: move toml-loader.test.ts to use real filesystem (#12969) |
| 5 | `a810ca80b` | Allow users to reset to auto when in fallback mode (#12623) |
| 6 | `43916b98a` | Don't clear buffers on cleanup. (#12979) |
| 7 | `13d8d9477` | fix(editor): ensure preferred editor setting updates immediately (#12981) |

**Cherrypicker prompt:**
```
Execute cherry-pick batch 2 for LLxprt Code sync from upstream gemini-cli v0.15.4 to v0.16.0.

Cherry-pick these 7 commits in order:
1. 4d85ce40b - Turns out console.clear() clears the buffer. (#12959)
2. 0075b4f11 - Always show the tool internal name in /tools (#12964)
3. aa9922bc9 - feat: autogenerate keyboard shortcut docs (#12944)
4. ad1f0d995 - refactor: move toml-loader.test.ts to use real filesystem (#12969)
5. a810ca80b - Allow users to reset to auto when in fallback mode (#12623)
6. 43916b98a - Don't clear buffers on cleanup. (#12979)
7. 13d8d9477 - fix(editor): ensure preferred editor setting updates immediately (#12981)

Commands:
git cherry-pick 4d85ce40b
git cherry-pick 0075b4f11
git cherry-pick aa9922bc9
git cherry-pick ad1f0d995
git cherry-pick a810ca80b
git cherry-pick 43916b98a
git cherry-pick 13d8d9477

If conflicts occur:
- Resolve following dev-docs/cherrypicking.md
- Apply branding substitutions
- Continue with: git cherry-pick --continue

After all picks, run FULL verify:
npm run lint
npm run typecheck
npm run test
npm run build
```

**Reviewer prompt:**
```
Review cherry-pick batch 2 for LLxprt Code sync.

MECHANICAL VERIFICATION (FULL):
1. Run: npm run lint
2. Run: npm run typecheck
3. Run: npm run test
4. Run: npm run build
5. Check for branding issues: grep -r "@google/gemini-cli\|USE_GEMINI" packages/

QUALITATIVE VERIFICATION (for each commit):
1. 4d85ce40b - Verify console.clear() guard (check for isAlternateBuffer condition)
2. 0075b4f11 - Verify tool internal name shown (displayName + name format)
3. aa9922bc9 - Verify keyboard shortcuts docs autogeneration
4. ad1f0d995 - Verify toml-loader tests use real filesystem
5. a810ca80b - Verify reset to auto in fallback mode works
6. 43916b98a - Verify buffer cleanup removed (no backslashBufferer/pasteBufferer calls in cleanup)
7. 13d8d9477 - Verify editor setting updates immediately

For each commit, verify:
- Code actually landed (not stubbed)
- Behavioral equivalence to upstream
- Integration correctness

Output format:
PASS/FAIL: [overall]
Per-commit:
- [sha]: LANDED=[yes/no] FUNCTIONAL=[yes/no] NOTES=[any issues]
```

---

### Batch 3: REIMPLEMENT - Sticky Headers
**Type:** REIMPLEMENT
**Verify:** Quick (lint, typecheck)
**Upstream commits:** ee7065f66, fb99b9537, d30421630

**What to implement:**
1. Create `packages/cli/src/ui/components/StickyHeader.tsx` with:
   - Props: children, color, truncate (boolean)
   - Uses Ink's `sticky` prop on Box
   - Rounded border styling
   - Header truncation to 1 line when truncate=true

2. Modify `ToolMessage.tsx`:
   - Wrap tool header in StickyHeader component
   - Header stays visible when scrolling tool output

3. Modify `ToolGroupMessage.tsx`:
   - Same sticky header treatment

4. Modify `ToolConfirmationMessage.tsx`:
   - Same sticky header treatment

**Cherrypicker prompt:**
```
REIMPLEMENT sticky headers for LLxprt Code based on upstream commits ee7065f66 + fb99b9537 + d30421630.

This is a REIMPLEMENT, not a cherry-pick. You need to create/modify files manually.

STEP 1: Read upstream implementation
- git show ee7065f66 -- packages/cli/src/ui/components/StickyHeader.tsx
- git show ee7065f66 -- packages/cli/src/ui/components/messages/ToolMessage.tsx
- git show fb99b9537 (truncation)
- git show d30421630 (polish)

STEP 2: Create StickyHeader.tsx
Create packages/cli/src/ui/components/StickyHeader.tsx with:
- Box with sticky={true} prop
- Rounded border styling
- Optional truncation (truncate prop)
- Export component

STEP 3: Modify ToolMessage.tsx
- Import StickyHeader
- Wrap tool header in StickyHeader
- Header should be: tool name + status

STEP 4: Modify ToolGroupMessage.tsx
- Same treatment as ToolMessage

STEP 5: Modify ToolConfirmationMessage.tsx
- Same treatment

STEP 6: Quick verify
npm run lint && npm run typecheck

Apply LLxprt branding where needed.
```

**Reviewer prompt:**
```
Review REIMPLEMENT batch 3 (Sticky Headers) for LLxprt Code sync.

MECHANICAL VERIFICATION:
1. Run: npm run lint
2. Run: npm run typecheck
3. Verify StickyHeader.tsx exists and exports correctly

QUALITATIVE VERIFICATION:
1. StickyHeader.tsx:
   - Uses Box with sticky={true}
   - Has truncate prop support
   - Proper border styling

2. ToolMessage.tsx:
   - Imports StickyHeader
   - Tool header wrapped in StickyHeader
   - Truncation applied to long descriptions

3. ToolGroupMessage.tsx:
   - Same sticky treatment

4. ToolConfirmationMessage.tsx:
   - Same sticky treatment

Verify:
- All components import correctly
- No TypeScript errors
- Ink's sticky prop is used (not some custom implementation)

Output format:
PASS/FAIL: [overall]
Components:
- StickyHeader.tsx: [created/missing] [functional/broken]
- ToolMessage.tsx: [modified correctly/issues]
- ToolGroupMessage.tsx: [modified correctly/issues]
- ToolConfirmationMessage.tsx: [modified correctly/issues]
```

---

### Batch 4: REIMPLEMENT - UI Improvements + FULL VERIFY
**Type:** REIMPLEMENT
**Verify:** Full (lint, typecheck, test, build)
**Upstream commits:** 3cbb170aa, 60fe5acd6, 2b8adf8cf

**What to implement:**

1. **3cbb170aa - ThemedGradient usage sites:**
   - Check if ThemedGradient is already used in Footer.tsx, StatsDisplay.tsx
   - If not, add ThemedGradient usage where direct Gradient was used
   - Add regression test for empty gradient array

2. **60fe5acd6 - Animated scroll keyboard:**
   - Add SCROLL_UP, SCROLL_DOWN, SCROLL_HOME, SCROLL_END, PAGE_UP, PAGE_DOWN commands to keyBindings.ts
   - Add keyboard shortcuts (Shift+Arrow, Home, End, PageUp, PageDown)
   - Modify ScrollableList.tsx to handle these keys

3. **2b8adf8cf - Drag scrollbar:**
   - Check if ScrollProvider already has drag support from v0.15.4
   - If not, add mouse drag handling for scrollbar
   - Track drag state, calculate scroll position from mouse position

**Cherrypicker prompt:**
```
REIMPLEMENT UI improvements for LLxprt Code based on upstream commits 3cbb170aa + 60fe5acd6 + 2b8adf8cf.

This is a REIMPLEMENT, not a cherry-pick.

PART 1: ThemedGradient (3cbb170aa)
- Check packages/cli/src/ui/components/ThemedGradient.tsx exists (should from v0.15.4)
- Check if Footer.tsx, StatsDisplay.tsx use ThemedGradient or raw Gradient
- If raw Gradient, replace with ThemedGradient
- Add test for empty gradient array handling

PART 2: Animated Scroll (60fe5acd6)
- Read: git show 60fe5acd6
- Add scroll commands to keyBindings.ts:
  - SCROLL_UP, SCROLL_DOWN, SCROLL_HOME, SCROLL_END, PAGE_UP, PAGE_DOWN
- Add keyboard matchers for: Shift+Up, Shift+Down, Home, End, PageUp, PageDown
- Modify ScrollableList.tsx to handle these commands

PART 3: Drag Scrollbar (2b8adf8cf)
- Check if ScrollProvider.tsx already has drag support
- If not, read: git show 2b8adf8cf
- Add mouse drag handling:
  - Track drag state (active, startY, offset)
  - Handle mousedown on scrollbar thumb
  - Handle mousemove to update scroll position
  - Handle mouseup to end drag

Run FULL verify:
npm run lint
npm run typecheck
npm run test
npm run build
```

**Reviewer prompt:**
```
Review REIMPLEMENT batch 4 (UI Improvements) for LLxprt Code sync.

MECHANICAL VERIFICATION (FULL):
1. Run: npm run lint
2. Run: npm run typecheck
3. Run: npm run test
4. Run: npm run build

QUALITATIVE VERIFICATION:

1. ThemedGradient (3cbb170aa):
   - Footer.tsx uses ThemedGradient
   - StatsDisplay.tsx uses ThemedGradient
   - Empty gradient array test exists

2. Animated Scroll (60fe5acd6):
   - keyBindings.ts has SCROLL_* and PAGE_* commands
   - Keyboard matchers for Home, End, PageUp, PageDown
   - ScrollableList.tsx handles scroll commands

3. Drag Scrollbar (2b8adf8cf):
   - ScrollProvider has drag state management
   - Mouse event handlers for drag
   - Scroll position updates on drag

Output format:
PASS/FAIL: [overall]
Features:
- ThemedGradient: [already done/implemented/issues]
- Animated Scroll: [implemented/issues]
- Drag Scrollbar: [already exists/implemented/issues]
```

---

### Batch 5: REIMPLEMENT - MALFORMED_FUNCTION_CALL
**Type:** REIMPLEMENT
**Verify:** Quick (lint, typecheck)
**Upstream commit:** fb0324295

**What to implement:**
- Improve error handling for malformed function calls from the model
- Add better error messages
- Handle edge cases gracefully

**Cherrypicker prompt:**
```
REIMPLEMENT MALFORMED_FUNCTION_CALL handling for LLxprt Code based on upstream commit fb0324295.

STEP 1: Read upstream implementation
git show fb0324295

STEP 2: Identify where MALFORMED_FUNCTION_CALL is handled
- Likely in tool execution or model response parsing
- Check packages/core/src/tools/ or packages/core/src/model/

STEP 3: Apply improvements
- Better error messages for malformed function calls
- Handle edge cases (missing args, invalid tool names, etc.)
- Ensure errors don't crash the application

STEP 4: Quick verify
npm run lint && npm run typecheck

Apply LLxprt patterns (debugLogger instead of console.error where appropriate).
```

**Reviewer prompt:**
```
Review REIMPLEMENT batch 5 (MALFORMED_FUNCTION_CALL) for LLxprt Code sync.

MECHANICAL VERIFICATION:
1. Run: npm run lint
2. Run: npm run typecheck

QUALITATIVE VERIFICATION:
1. Find where MALFORMED_FUNCTION_CALL handling was added/improved
2. Verify error messages are user-friendly
3. Verify edge cases are handled (missing args, invalid names)
4. Verify no crashes on malformed input

Output format:
PASS/FAIL: [overall]
Changes:
- File(s) modified: [list]
- Error handling: [improved/same/broken]
- Edge cases: [handled/not handled]
```

---

## Failure Recovery

### Cherry-pick conflicts
```bash
# If conflict during cherry-pick:
git status  # See conflicted files
# Edit files to resolve conflicts
git add <resolved-files>
git cherry-pick --continue

# If need to abort batch:
git cherry-pick --abort
```

### Review-remediate loop
If review fails:
1. Call cherrypicker subagent with remediation prompt
2. Review again
3. Loop up to 5 times
4. If still failing after 5 iterations, call `todo_pause()` with reason

### Fix commits
If verification fails after batch:
```bash
# Fix the issues
git add -A
git commit -m "fix: post-batch N verification issues"
```

---

## Note-Taking Requirements

After each batch:
1. Update `PROGRESS.md` with batch status and LLxprt commit hash
2. Append to `NOTES.md` with conflicts, decisions, deviations
3. Update `AUDIT.md` with upstream SHA → outcome mapping

---

## Context Recovery

If you lose context and need to resume:

1. Check git state:
```bash
git branch --show-current  # Should be 20260129gmerge
git log --oneline -5       # See recent commits
git status                 # Check for uncommitted changes
```

2. Read todo list: `todo_read()`

3. Find first `pending` or `in_progress` item

4. Read this PLAN.md for batch details

5. Resume execution with appropriate subagent

**Summary:**
- Branch: `20260129gmerge`
- Range: `v0.15.4..v0.16.0`
- Counts: 14 PICK, 29 SKIP, 7 REIMPLEMENT
- Focus: Sticky headers, animated scroll, drag scrollbar, bug fixes
