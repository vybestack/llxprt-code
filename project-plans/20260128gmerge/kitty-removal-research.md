# Gemini CLI Kitty protocol “removal” research (commits 9e4ae214a, c0b766ad7)

## Scope
Upstream repo: `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/tmp/gemini-cli`

Commits examined:
- `9e4ae214a` — **Revamp KeypressContext (#12746)**
- `c0b766ad7` — **Simplify switch case (#12798)**

Commands run:
- `git show 9e4ae214a --stat`
- `git show c0b766ad7 --stat`
- `git log --oneline --all --grep="kitty" --grep="keyboard" --grep="progressive" -i`
- Full diffs for both commits

## TL;DR
Kitty support was not moved into Ink and not entirely removed. The code was **re-architected** to eliminate `readline` and a Kitty-specific parser in favor of a **single ANSI/CSI parser** that treats Kitty CSI-u sequences as ordinary escape sequences. The explicit **kittyProtocolEnabled** prop was removed, and kitty parsing is now unconditional in the parser. Terminal capability detection and enabling (Kitty vs modifyOtherKeys) still exists in `terminalCapabilityManager`. So it’s not “removed,” but **kitty parsing is no longer gated** by a flag and some kitty-specific telemetry/overflow handling was removed.

## What changed in 9e4ae214a (Revamp KeypressContext, PR #12746)
### Primary changes
- **Removed `readline` dependency** and custom Kitty-specific sequence parsing logic.
- Introduced a **new state-machine parser** (`emitKeys`) modeled after readline that directly parses character streams and ANSI escape sequences.
- **Kitty protocol sequences are still parsed** in the new parser via CSI-u (e.g., `[13u`, `[27u`, `[127u`, `[57414u`), but handled alongside all other escape sequences.
- The **`kittyProtocolEnabled` prop was removed** from `KeypressProvider` and usage sites.
- **Kitty sequence overflow telemetry** (`KittySequenceOverflowEvent`) removed.
- Removed `platformConstants.ts` (which contained Kitty-related constants); some constants were moved to `terminalSetup.ts`.

### Evidence in diff
- `KeypressProvider` signature removes `kittyProtocolEnabled` prop and test callers updated accordingly.
- `KeypressContext.tsx` now has an `emitKeys` generator parsing ANSI sequences, and **kitty codes are handled in a shared code map**.
- `kittyProtocol` flags on `Key` are removed.
- Debug logging now logs raw stdin rather than Kitty buffer-specific logs.
- Removed buffer/timeout logic for Kitty input sequences (previously used to gate Kitty parsing and handle incomplete CSI sequences).

### PR #12746 summary (from GitHub)
> “Refactor and simplify KeypressContext to eliminate duplicate work and remove use of readline. Introduces a new state machine modeled off readline to directly parse character streams for ANSI escape codes, replacing the previous, more complex kitty protocol-specific parsing.”
> “Debug logging has been simplified and telemetry for kitty sequence overflows has been removed as it is no longer relevant with the new implementation.”
> Fixes issue **#12613** (“ESC + mouse-scrolling leads to garbage input characters”).

### PR review notes (useful context)
- Reviewers noted a **regression in the `kittyProtocolEnabled` flag** (was removed) and asked about Kitty handling.
- Author responded that existing ASCII range handling was intentional.

## What changed in c0b766ad7 (Simplify switch case, PR #12798)
- Pure refactor: large `switch` statement in `emitKeys` replaced by a map (`KEY_INFO_MAP`).
- **No removal of Kitty support**, just reorganization.
- One unrelated test was marked `it.skip` (integration-test flake).

## Where Kitty support is now
### 1) Parser still recognizes Kitty CSI-u sequences
In current `KeypressContext.tsx`:
- Map entries include `"[9u"`, `"[13u"`, `"[27u"`, `"[127u"`, `"[57414u"`.
- The parser also recognizes **modifyOtherKeys** (`CSI 27 ; modifier ; key ~`), mapping it to CSI-u equivalents.
- This means Kitty sequences are handled *as standard escape codes*.

### 2) Capability detection still exists
`packages/cli/src/ui/utils/terminalCapabilityManager.ts`:
- Detects Kitty support via `CSI ? u` response and sets `kittySupported` / `kittyEnabled`.
- If Kitty supported, enables Kitty keyboard protocol; else enables modifyOtherKeys.
- On exit, it disables Kitty/modifyOtherKeys/bracketed paste.

### 3) Some behavior still branches on Kitty support
Current `KeypressContext.tsx` uses:
- `if (!terminalCapabilityManager.isKittyProtocolEnabled()) { processor = bufferFastReturn(processor); }`
- So **Kitty is still a capability** that affects behavior (fast return buffering).

## Was Kitty support moved to Ink?
- **No.** Dependency is `npm:@jrichman/ink@6.4.8` (not `@anthropic-ai/ink`).
- No references to `@anthropic-ai/ink` or any anthropic Ink fork found in repo.

## Did Kitty support get replaced with something else?
- The parser now treats **Kitty and non-Kitty escape sequences uniformly**.
- **modifyOtherKeys** support is integrated into parser (CSI 27;…;…~ mapped to CSI-u style). This is a **fallback when Kitty isn’t supported**.
- Bracketed paste support remains.

## Commit message search (kitty/keyboard/progressive)
`git log --oneline --all --grep="kitty" --grep="keyboard" --grep="progressive" -i` shows a history of Kitty-related changes.
Relevant recent entries:
- `b51323b4 refactor(cli): keyboard handling and AskUserDialog (#17414)`
- `93da9817 feat(ui): Move keyboard handling into BaseSettingsDialog (#17404)`
- `c1401682 fix: handle Shift+Space in Kitty keyboard protocol terminals (#15767)`
- `d2849fda properly disable keyboard modes on exit (#16006)`
- `9ebf3217 Use synchronous writes when detecting keyboard modes (#13478)`
- ... plus older kitty protocol fixes.

This indicates **continued Kitty-related work after** the referenced commits.

## External discussions / issues
Web search (exa) surfaced general Kitty issues but nothing explicitly stating Kitty support was removed:
- Issues like **“Arrow key not useable when using kitty/ghostty terminal”** (issue #7921) and other keyboard handling bugs.
- No public discussion found indicating “Kitty support removed” outright.

## Conclusion
- **Kitty support was not removed.** It was **absorbed into a unified escape-sequence parser** and the gating flag was removed.
- **No move to Ink** (no anthropic Ink fork found). All parsing remains custom within `KeypressContext.tsx`.
- **Why it changed:** the upstream intent was to **simplify input parsing, remove readline dependency, and fix ESC/mouse-related garbage input** (issue #12613). As a result, Kitty handling was moved from a special-case parser to the general ANSI/CSI parser, and telemetry for kitty sequence overflow was removed.

## References
- PR #12746: https://github.com/google-gemini/gemini-cli/pull/12746
- PR #12798: https://github.com/google-gemini/gemini-cli/pull/12798
- Terminal capability detection: `packages/cli/src/ui/utils/terminalCapabilityManager.ts`
- Keypress parsing: `packages/cli/src/ui/contexts/KeypressContext.tsx`
