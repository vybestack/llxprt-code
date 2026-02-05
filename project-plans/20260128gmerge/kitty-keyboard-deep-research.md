# Kitty keyboard protocol handling revamp (upstream gemini-cli)

## Sources consulted
- Local upstream repo: `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/tmp/gemini-cli`
- Commit `9e4ae214a`: `Revamp KeypressContext (#12746)`
- Commit `c0b766ad7`: `Simplify switch case (#12798)`
- `git log --all --oneline --grep="kitty" --grep="keyboard" -i | head -20`
- PR #12746 description on GitHub
- Issue #12613 (ESC + mouse-scroll garbage input)
- Issue #12040 (ESC no longer works when Kitty protocol enabled)
- Current HEAD KeypressContext.tsx (still present) in upstream repo
- @jrichman/ink README from npm registry (for useInput overview; no evidence of Ink absorbing gemini-cli key parsing)

## Executive summary
Upstream’s KeypressContext revamp (9e4ae214a, PR #12746) was driven by a specific bug: ESC + mouse scrolling in alternate buffer produced garbage input (issue #12613). The change replaces a readline-based pipeline + kitty-specific buffering with a custom state machine that parses raw stdin directly, and filters non-keyboard sequences (mouse + focus). The PR explicitly says the goal was to eliminate duplicate work and remove readline. There is no sign this was a move to Ink to handle keyboard input. In fact, KeypressContext.tsx still exists at HEAD and continues to parse keyboard input itself.

## What changed (9e4ae214a / PR #12746)
### PR summary (from GitHub PR #12746)
- “Refactor and simplify KeypressContext to eliminate duplicate work and remove use of readline.”
- “Introduces a new state machine modeled off readline to directly parse character streams for ANSI escape codes, replacing the previous, more complex kitty protocol-specific parsing.”
- “Debug logging has been simplifies and telemetry for kitty sequence overflows has been removed as it is no longer relevant with the new implementation.”
- **Related Issues:** “Fixes #12613” (ESC + mouse-scrolling garbage input).

### Architectural changes
- **Old approach:**
  - `readline.emitKeypressEvents` + a secondary passthrough parser for paste/kitty.
  - A large kitty-specific buffer (`inputBuffer`) with custom parsing for Kitty sequences + mouse handling.
  - Kitty parsing toggled by `kittyProtocolEnabled` flag.
  - Extra telemetry `KittySequenceOverflowEvent` for buffer overflow.

- **New approach (9e4ae214a):**
  - **Direct data listener** on `stdin` emitting UTF-8 strings.
  - A **state machine** (`emitKeys`) modeled after readline parsing ANSI escapes directly.
  - **Composable filters/buffers:**
    - `nonKeyboardEventFilter` drops mouse + focus sequences.
    - `bufferBackslashEnter` handles backslash+enter as Shift+Enter.
    - `bufferPaste` collects bracketed paste content; flushes on timeout.
  - Kitty parsing is no longer special-cased: CSI-u sequences are handled alongside other escapes.
  - Removes Kitty overflow telemetry (no longer buffering long kitty sequences in a separate buffer).

### Behavior changes that align with the bug
- **Mouse sequences are now detected via `parseMouseEvent` and filtered** before keyboard handling, preventing mouse scroll from leaking into input.
- **Focus sequences (FOCUS_IN/FOCUS_OUT)** are similarly filtered from keyboard handling.

### Tests updated
- Tests now rely on fake timers and validate ESC timeouts deterministically.
- Removed tests that assume kitty on/off toggle.
- Added tests for double ESC and multi-language character input.

## Commit c0b766ad7 (Simplify switch case)
This is a follow-up cleanup: replaces an inlined switch with a key map (`KEY_INFO_MAP`) to simplify the key mapping logic. No behavioral shift besides code clarity. Not connected to a migration to Ink.

## What issues drove the change?
### Issue #12613 (explicitly fixed)
- **Title:** “ESC + mouse-scrolling leads to garbage input characters.”
- **Observed behavior:** In alternate buffer mode, ESC + mouse scroll produced garbage input.
- **PR linkage:** PR #12746 explicitly says “Fixes #12613.”
- **Likely root cause:** Old kitty buffer + readline layering was not correctly filtering mouse sequences before keyboard parsing, causing scroll events to be interpreted as input.

### Issue #12040 (ESC in kitty mode)
- **Title:** “ESC no longer works when KITTY protocol is enabled.”
- **Status:** Closed as “not planned,” but it highlights ESC handling problems in kitty mode.
- **Connection:** The revamp includes a simplified ESC timeout mechanism. While the PR doesn’t cite #12040, the new state machine and test updates for double-ESC improve deterministic ESC handling.

### Historical kitty/keyboard issues (from git log)
- Multiple keyboard/kitty fixes preceding this change indicate a pattern of fragility:
  - “Fix Arrow Keys and make Kitty Protocol more robust” (#7118)
  - “Implement Tab and Backspace handling for Kitty Protocol” (#7006)
  - “Fix shift+tab keybinding when not in kitty mode” (#12552)
- The revamp can be seen as a **consolidation** to reduce the ongoing fragility of kitty-specific parsing.

## Was this a move to Ink for keyboard handling?
**No.** Evidence:
- `packages/cli/src/ui/contexts/KeypressContext.tsx` still exists at HEAD.
- The file itself does the raw stdin parsing; no switch to Ink-level `useInput` for parsing.
- Ink is used as the UI framework (via `useStdin`), but the keyboard parser is custom.
- The PR explicitly calls out “remove use of readline” and “new state machine modeled off readline,” not “move to Ink.”

## Ink handling check
- The project depends on `@jrichman/ink`, but there is **no indication** that Ink now handles the parsing of kitty sequences or mouse filtering for gemini-cli.
- Ink’s README documents `useInput`, but it’s a higher-level hook that still depends on raw input parsing in the app for these terminal-specific behaviors.

## Motivation assessment
### Not about Ink migration
- No refactor into Ink’s `useInput` or removing KeypressContext.
- Instead: **local parser** and direct stdin data events.

### Primary motivations
1. **Fix a specific bug:** ESC + mouse scroll garbage input (issue #12613).
2. **Simplify and stabilize keyboard parsing:** remove complex kitty-specific buffer, remove `readline` dependency, use a single state machine.
3. **Reduce fragility of overlapping parsers:** stop double parsing (readline + kitty buffer) and unstructured buffering.

### Secondary motivations
- Clean up tests and add deterministic timeouts (fake timers).
- Remove telemetry for kitty buffer overflow because it’s no longer relevant.

## Current architecture (HEAD)
- KeypressContext still active and central.
- Uses:
  - `useStdin` from Ink for raw access.
  - `process.stdin.setEncoding('utf8')`.
  - `createDataListener` + `emitKeys` state machine.
  - Filters for mouse/focus, paste, and backslash+enter.
- Kitty protocol enabled/disabled flows are now derived from `terminalCapabilityManager` rather than a prop toggle (earlier refactor after #12746).

## Direct answers to mission questions
- **Why did upstream make these changes?**
  - To fix ESC + mouse scroll garbage input (#12613) and to simplify/robustify keyboard parsing by removing readline and kitty-specific buffering.

- **Was it a move to Ink for keyboard handling?**
  - No. KeypressContext remains; it just uses Ink’s `useStdin` for raw stdin access.

- **Was readline causing bugs?**
  - Indirectly: multiple parsing layers (readline + kitty buffer) made input brittle and mishandled mouse sequences. The PR explicitly removes readline to avoid duplicate work and complexity.

- **Was Kitty-specific timeout/overflow handling the issue?**
  - The kitty buffer/timeout logic was removed. It was likely contributing to edge cases with ESC and mouse sequences, and it required overflow telemetry. The new approach avoids large kitty-specific buffering.

- **Simplification or bug fixes?**
  - Both. The PR’s stated goal is simplification and removal of readline, but it explicitly fixes #12613 and improves ESC handling tests. So bug-driven simplification.

## Appendix: Evidence snippets
- PR #12746 summary (GitHub): “Refactor and simplify KeypressContext to eliminate duplicate work and remove use of readline.” / “Fixes #12613.”
- Issue #12613: ESC + mouse-scrolling garbage input in alternate buffer mode.
- Issue #12040: ESC not working with kitty protocol; not referenced directly but relevant to ESC handling.
- KeypressContext still present at HEAD: `packages/cli/src/ui/contexts/KeypressContext.tsx`.
