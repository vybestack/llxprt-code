## Old Ink UI scrollback redraw (#456) — findings (2025-12-15)

### Problem statement (issue #456)
- When LLxprt is running and the user scrolls back in the terminal, the UI keeps redrawing “under” the scrollback view, continuously filling the buffer.
- Desired behavior: when the user scrolls back, the screen should not keep repainting underneath (either because the app uses an alternate screen with in-app scrolling, or because output is appended in a way that doesn’t fight terminal scrollback).

Issue link: `vybestack/llxprt-code#456` (viewed via `gh issue view 456`).

### Current llxprt-code “old UI” architecture (Ink)
Key files (current branch `fix-oldui` at time of writing):
- `packages/cli/src/ui/layouts/DefaultAppLayout.tsx`
  - Supports two render paths:
    - legacy `<Static>` history path (fallback / non-alternate-buffer mode)
    - alternate-buffer path that renders a single scroll-managed main content region using `ScrollableList`
  - The overall root `<Box>` is `width="90%"`, and there is a large “mainControlsRef” footer stack (notifications/todo/dialogs/composer/footer).
- `packages/cli/src/ui/AppContainer.tsx`
  - Maintains:
    - `history` (persisted/trimmed; rendered via `<Static>`)
    - `pendingHistoryItems` (streaming/tool exec; rendered live below Static)
    - `constrainHeight` toggle (Ctrl+S flips it to allow more lines)
  - `refreshStatic()` clears terminal (`ansiEscapes.clearTerminal`) and increments a `staticKey` to remount `<Static>` in legacy mode.
  - In alternate-buffer mode, `refreshStatic()` is a no-op (prevents full-history reprints).
- `packages/cli/src/ui/hooks/useStaticHistoryRefresh.ts`
  - Forces `refreshStatic()` if history shrinks (Ink `<Static>` only appends; shrinking needs a remount).
- `packages/cli/src/ui/components/shared/MaxSizedBox.tsx` + `packages/cli/src/ui/contexts/OverflowContext.tsx`
  - Content-aware height truncation + overflow tracking.
  - `ShowMoreLines` uses overflow state to display “Press ctrl-s to show more lines”.
- `packages/cli/src/ui/hooks/useFlickerDetector.ts`
  - Telemetry-only: measures `rootUiRef` height vs `terminalHeight` and emits `AppEvent.Flicker` when overflow is detected.
  - `AppContainer.tsx` listens for this event and re-enables `constrainHeight` as a corrective “feedback loop”.

Operational consequence:
- The UI is fundamentally a React tree that re-renders frequently while streaming and while tools execute.
- In normal terminal buffer mode, these re-renders can create the “redraw spam into scrollback” symptom: each frame is effectively additional terminal output while the user is in scrollback.

### Tool output and “Ctrl+S” are not true “terminal scrollback”
Even when `constrainHeight` is disabled via Ctrl+S, long outputs are still frequently truncated at render-time:
- Tool outputs (e.g. shell tool) are rendered via `ToolGroupMessage` → `ToolMessage` using `MaxSizedBox` height budgets.
- History items rendered in `<Static>` use `staticAreaMaxItemHeight = max(terminalHeight * 4, 100)` (see `DefaultAppLayout.tsx`), which still caps long tool outputs and causes “... first N lines hidden ...” behavior for big outputs.

This matters because a “use terminal scrollback” UX only works if large outputs are actually printed fully (append-only) rather than being kept inside a constrained React view.

### Upstream gemini-cli: what changed in newer releases (why it “feels fixed”)
I cloned upstream to `tmp/gemini-cli` at commit `d030a1f62f83807dd2945cb1ded2e5e5bddcd296` to inspect the approach.

High-level architecture upstream uses to avoid scrollback redraw issues:
- Prefer **alternate screen buffer** + **in-app scrolling** rather than relying on terminal scrollback.
- When alternate buffer is enabled, the entire “history + pending” region is rendered in a **virtualized scrollable list**, so React updates don’t continuously append frames into the user’s scrollback buffer.

Concrete upstream implementation pieces (from the clone):
- `tmp/gemini-cli/packages/cli/src/gemini.tsx`
  - Ink `render(..., { alternateBuffer: useAlternateBuffer, incrementalRendering: ... })`.
  - `incrementalRendering` is enabled only when alternate buffer is enabled.
- `tmp/gemini-cli/packages/cli/src/ui/components/MainContent.tsx`
  - In alternate buffer mode, replaces `<Static>` with `<ScrollableList>` that renders `[header, ...history, pending]` as list items.
  - In non-alternate mode, still uses `<Static>` (similar to our current structure).
- `tmp/gemini-cli/packages/cli/src/ui/components/shared/ScrollableList.tsx`
  - Wraps a `VirtualizedList` and provides keyboard scrolling (scroll up/down, page up/down, home/end) and mouse scrolling via a `ScrollProvider`.
- `tmp/gemini-cli/packages/cli/src/ui/contexts/ScrollProvider.tsx`
  - Central scroll registry; routes mouse wheel/drag interactions to the active scrollable component (smallest focused bounding box wins).
- `tmp/gemini-cli/packages/cli/src/ui/components/CopyModeWarning.tsx` + logic in `tmp/gemini-cli/packages/cli/src/ui/AppContainer.tsx`
  - “Copy mode” disables mouse events so the user can select/copy without the UI intercepting scroll/mouse.
- Dependency detail:
  - Upstream pins Ink via an npm alias: `ink: "npm:@jrichman/ink@6.4.6"` (see `tmp/gemini-cli/packages/cli/package.json`).
  - This is relevant because their approach relies on Ink behavior/flags not present in older Ink builds.

### Divergence / prior cherry-pick attempts
- llxprt-code currently depends on `ink@^6.5.1`, and also has an optional dependency on `@x70102/ink@^6.4.0-hotfix-flicker-scroll-merge` (`package.json`), but the current UI code does not implement upstream’s alternate-buffer + virtualized history path.
- The codebase has significantly diverged from the fork point, so wholesale cherry-picks from later gemini-cli releases are not straightforward.
- Related external effort:
  - `e2720pjk/llxprt-code#22` (merged in their fork) includes a “Hybrid UI Architecture” plus `VirtualizedList`/`ScrollableList`/`ScrollProvider`-style components, but it targets their fork’s structure and doesn’t drop into our current tree without non-trivial adaptation.

### New non-Ink UI in progress
- `packages/ui` is an experimental UI built on OpenTUI React with `<scrollbox>` and explicit scroll management (see `packages/ui/src/ui/components/ChatLayout.tsx`, `packages/ui/src/hooks/useScrollManagement.ts`).
- This is likely a longer-term replacement, but it doesn’t solve the immediate “old Ink UI” scrollback issue unless we accelerate that migration.

### Local automation experiments done during this session (tmux)
Goal: prove we can drive the interactive Ink UI without piping stdin (which forces non-interactive mode).

Key takeaways:
- Starting the app inside **tmux** keeps stdin as a **TTY**, so `node scripts/start.js` runs the interactive Ink UI.
- We can send keys reliably with:
  - `tmux send-keys -l '...'` (literal typing; important so the input buffer state updates like real typing)
  - small sleeps between typing and `Enter` (some commands didn’t submit reliably when sent “instantaneously”).
- We can capture what a user sees + scrollback via:
  - `tmux capture-pane -p -t <session> > file.txt`
  - `tmux capture-pane -p -t <session> -S -2000 > scrollback.txt`
- Example verified command: enabling shell mode and running `seq 1 50` produced a rendered tool output block in capture output.

#### Scrollback/redraw “symptom” can be made machine-checkable
Using `scripts/oldui-tmux-harness.js --scenario scrollback`, we run a deterministic shell command that prints `SCROLLTEST LINE ....` over ~15s, then:
- enter tmux copy-mode (simulated “user scrollback view”),
- sample tmux `#{history_size}` while in copy-mode.

If tmux history grows while the user is scrolled up (`deltaDuringCopyMode > 0`), we have objective evidence that the UI is printing/re-printing into scrollback (redraw spam).

Practical baseline:
- `node scripts/oldui-tmux-harness.js --scenario scrollback --rows 20 --cols 100 --assert`
  - Asserts that output was visible during-run and that `deltaDuringCopyMode == 0`.

#### Apples-to-apples (model-driven) repro + Gemini comparison (flash-lite)
We now have an “as a user” scenario that:
- starts an interactive TUI (real TTY),
- prompts the model to run a long-ish command via the `run_shell_command` tool,
- approves it (non-YOLO),
- enters tmux copy-mode (simulated “user scrollback”) while the tool is still running,
- and asserts that tmux history does not grow while in copy-mode (`deltaDuringCopyMode == 0`).

Scripts:
- LLXPRT (runs `node scripts/start.js` with `--provider gemini --model gemini-2.5-flash-lite`):
  - `scripts/oldui-tmux-script.llm-tool-scrollback-realistic.llxprt.json`
- Gemini CLI (runs `gemini --model gemini-2.5-flash-lite`):
  - `scripts/oldui-tmux-script.llm-tool-scrollback-realistic.gemini.json`

Behavior observed (current old UI):
 - LLXPRT script passes with `deltaDuringCopyMode == 0`.
 - Gemini CLI script passes with `deltaDuringCopyMode == 0`.

Important nuance:
- In alternate-buffer mode, tool output may not remain in terminal scrollback after `/quit`; capture/metrics are taken while the output is still visible during-run.

### LLM-driven UI automation is currently flaky (tool approval flows)
I attempted to script an “agent prompts -> tool call -> approve -> next prompt” sequence using `scripts/oldui-tmux-script.approvals.json` (run via `node scripts/oldui-tmux-harness.js --script ...`). It is not reliably completing end-to-end yet due to UI/runtime behavior with real model calls.

Observed issues:
- After a tool finishes, the UI often stays in an “`esc to cancel` (Xm)” streaming state for minutes with `TPM: 0`, even though the input prompt is visible. This blocks deterministic “step 2, step 3…” scripting.
- Sending `Escape` cancels the in-flight request, but it commonly restores the previous prompt text into the input buffer.
  - Clearing restored input can be done with `Ctrl+C` (InputPrompt binds this to “clear input”).
- `Enter` is frequently intercepted by the suggestions/completion UI (accept suggestion vs submit), which makes submission flaky if we don’t use a stable “submit” key sequence.

Conclusion:
- tmux gives us all the right primitives (TTY, key injection, screen + scrollback capture).
- Multi-step “agent does many tools in sequence” flows can still be flaky, but a single-tool, flash-lite script is now stable enough to serve as a regression harness for #456.
