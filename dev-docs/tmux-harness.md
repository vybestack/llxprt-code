# tmux harness

`scripts/tmux-harness.ts` is an automation harness for the Ink-based terminal UI (in `packages/cli`).

It runs `bun scripts/start.ts` inside a tmux session (a real TTY), sends keystrokes, and captures both the rendered screen and scrollback to artifact files. This lets us reproduce UI-only bugs (like scrollback redraw spam) without manually launching the app and eyeballing it.

## Why tmux

- Keeps stdin as a TTY (so LLXPRT stays in interactive mode; piping stdin forces non-interactive mode).
- Provides key injection (`tmux send-keys`) and capture (`tmux capture-pane`).
- Does not require macOS Accessibility permissions (no GUI automation).

## Quickstart

- Haiku smoke test: `bun scripts/tmux-harness.ts`
- Scrollback redraw reproduction: `bun scripts/tmux-harness.ts --scenario scrollback`
- Scrollback redraw baseline (asserts): `bun scripts/tmux-harness.ts --scenario scrollback --rows 20 --cols 100 --assert`
- LLM/tool scrollback baseline (LLXPRT): `bun scripts/tmux-harness.ts --script scripts/tmux-script.llm-tool-scrollback-realistic.llxprt.json`
- LLM/tool scrollback baseline (Gemini CLI, expected to pass): `bun scripts/tmux-harness.ts --script scripts/tmux-script.llm-tool-scrollback-realistic.gemini.json`
- Scroll gap regression (LLXPRT): `bun scripts/tmux-harness.ts --script scripts/tmux-script.llm-scroll-gap-regression.llxprt.json`
- `/clear` regression (LLXPRT): `bun scripts/tmux-harness.ts --script scripts/tmux-script.clear-keeps-input.llxprt.json`
- Scripted run: `bun scripts/tmux-harness.ts --script scripts/tmux-script.example.json`
- Scripted run (macros): `bun scripts/tmux-harness.ts --script scripts/tmux-script.macros.example.json`

## Artifacts

The harness writes artifacts to a temp directory like:

- `/var/folders/.../T/llxprt-tmux-harness-<timestamp>/` (macOS)

On success it prints the artifacts directory. On failure it also prints the artifacts directory and writes:

- `error.json` (failure message)
- `error-final-screen.txt` and `error-final-scrollback.txt`
- `NNN-error-<step>-screen.txt` / `NNN-error-<step>-scrollback.txt` (per-step failure capture)

## Script format (JSON)

Scripted mode loads a JSON file with these top-level keys:

- `tmux`: `{ cols, rows, historyLimit, scrollbackLines, initialWaitMs }`
- `yolo`: boolean (if true, starts `bun scripts/start.ts --yolo`)
- `startCommand`: array of argv (defaults to `["bun","scripts/start.ts"]`)
- `macros`: optional object mapping macro name → array of steps
- `steps`: array of steps (expanded after macro expansion)

### Macros (generic)

Macros are runner-supported and UI-agnostic: they expand to step arrays.

- Define:
  - `"macros": { "myMacro": [ { "type": "line", "text": "..." } ] }`
- Invoke:
  - `{ "type": "macro", "name": "myMacro", "args": { "foo": "bar" } }`
- Substitution:
  - Strings can reference args via `${foo}`.
  - If a field's value is exactly `"${foo}"`, it is replaced with the raw arg value (including numbers/booleans).

Macros are the recommended place to encode **UI-specific behavior**, so scripts remain portable and maintainable.

## Step types (runner primitives)

- `wait`: `{ "type": "wait", "ms": 1000 }`
- `line`: `{ "type": "line", "text": "...", "submitKeys": ["Escape","Enter"], "postTypeMs": 600 }`
- `key`: `{ "type": "key", "key": "Enter" }`
- `keys`: `{ "type": "keys", "keys": ["Down","Enter"] }`
- `resize`: `{ "type": "resize", "cols": 58, "rows": 24, "settleMs": 600 }`
- `waitFor`: `{ "type": "waitFor", "scope": "screen"|"scrollback", "contains": "..." | "regex": "...", "timeoutMs": 15000, "pollMs": 250 }`
- `waitForNot`: like `waitFor`, but asserts absence until timeout.
- `expect`: like `waitFor`, but checks immediately (no polling).
- `expectCount`: counts matches in `screen|scrollback` and asserts `{ equals | atLeast | atMost }`.
- `expectHistoryDelta`: `{ "type": "expectHistoryDelta", "fromLabel": "...", "toLabel": "...", "equals|atLeast|atMost": N }`
- `copyMode`: `{ "type": "copyMode", "enter": true, "pageUp": 5, "exit": true }`
- `capture`: `{ "type": "capture", "label": "name", "scope": "screen"|"scrollback" }` (or omit `scope` to capture both)
- `historySample`: `{ "type": "historySample", "label": "optional" }` (records tmux `#{history_size}` to `history-samples.json`)
- `waitForExit`: `{ "type": "waitForExit", "timeoutMs": 15000 }`

Keys are tmux key names (examples: `Enter`, `Escape`, `Up`, `Down`, `C-s`, `C-c`).

### Resize step

The `resize` step changes the real tmux terminal size so Ink receives a genuine
resize event and reflows (standard terminal, not a mocked React width).

- `cols` and `rows` must be positive integers. Non-integer, zero, negative,
  or non-finite values fail the step before any tmux command runs.
- `settleMs` is optional and defaults to `600`; it must be a finite
  nonnegative number. The default covers the current resize debounce and deferred
  refresh in the Ink UI.
- The step targets the active window in the harness's isolated tmux session via
  the session-only target (`<session>`), so a resize never touches other sessions.
- Use `waitFor`/`waitForNot` after a resize to assert that the UI reflowed
  into the new dimensions, with `capture` recording the before and after screens.
  This is how real-terminal reflow behavior (for example the session browser
  hiding its standard-width sort bar at narrow widths) is asserted.

## UI convenience steps

The runner includes a few convenience step types tuned to the Ink UI:

- `approveTool` / `approveShell` / `selectToolOption`

These may be brittle across UI changes; prefer macros + runner primitives for anything meant to be portable.

## Gotchas

- **Completions can intercept `Enter`.** For slash commands the runner defaults to `["Escape","Enter"]` to dismiss suggestions before submitting. For other inputs, set `submitKeys` explicitly if needed.
- **Escape cancels requests.** If you cancel and the previous prompt text reappears in the input buffer, `Ctrl+C` clears the input in the UI.
- **LLM-driven scripts can be flaky** with real models (stalling in "esc to cancel" or not emitting the expected tool call). For UI regressions, prefer deterministic scenarios (like `--scenario scrollback`) or a deterministic/mock provider (future work).
- **Alternate-buffer UIs may not leave tool output in terminal scrollback after `/quit`.** The scrollback scenario snapshots `during-run-screen.txt` and `during-run-scrollback.txt` before quitting for assertions.

## Scrollback load generator

The `--scenario scrollback` scenario uses `scripts/scrollback-load.ts` to emit a predictable stream of lines over time.
