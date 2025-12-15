# Old UI tmux harness (legacy Ink UI)

`scripts/oldui-tmux-harness.js` is an automation harness for the legacy Ink-based terminal UI (the “old UI” in `packages/cli`).

It runs `node scripts/start.js` inside a tmux session (a real TTY), sends keystrokes, and captures both the rendered screen and scrollback to artifact files. This lets us reproduce UI-only bugs (like scrollback redraw spam) without manually launching the app and eyeballing it.

This harness is **not intended** for the new OpenTUI UI in `packages/ui`.

## Why tmux

- Keeps stdin as a TTY (so LLXPRT stays in interactive mode; piping stdin forces non-interactive mode).
- Provides key injection (`tmux send-keys`) and capture (`tmux capture-pane`).
- Does not require macOS Accessibility permissions (no GUI automation).

## Quickstart

- Haiku smoke test: `node scripts/oldui-tmux-harness.js`
- Scrollback redraw reproduction: `node scripts/oldui-tmux-harness.js --scenario scrollback`
- Scripted run: `node scripts/oldui-tmux-harness.js --script scripts/oldui-tmux-script.example.json`
- Scripted run (macros): `node scripts/oldui-tmux-harness.js --script scripts/oldui-tmux-script.macros.example.json`

## Artifacts

The harness writes artifacts to a temp directory like:

- `/var/folders/.../T/llxprt-oldui-tmux-harness-<timestamp>/` (macOS)

On success it prints the artifacts directory. On failure it also prints the artifacts directory and writes:

- `error.json` (failure message)
- `error-final-screen.txt` and `error-final-scrollback.txt`
- `NNN-error-<step>-screen.txt` / `NNN-error-<step>-scrollback.txt` (per-step failure capture)

## Script format (JSON)

Scripted mode loads a JSON file with these top-level keys:

- `tmux`: `{ cols, rows, historyLimit, scrollbackLines, initialWaitMs }`
- `yolo`: boolean (if true, starts `node scripts/start.js --yolo`)
- `startCommand`: array of argv (defaults to `["node","scripts/start.js"]`)
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
  - If a field’s value is exactly `"${foo}"`, it is replaced with the raw arg value (including numbers/booleans).

Macros are the recommended place to encode **LLXPRT/old-UI-specific behavior**, so a future UI can add new macros without modifying the runner.

## Step types (runner primitives)

- `wait`: `{ "type": "wait", "ms": 1000 }`
- `line`: `{ "type": "line", "text": "...", "submitKeys": ["Escape","Enter"], "postTypeMs": 600 }`
- `key`: `{ "type": "key", "key": "Enter" }`
- `keys`: `{ "type": "keys", "keys": ["Down","Enter"] }`
- `waitFor`: `{ "type": "waitFor", "scope": "screen"|"scrollback", "contains": "..." | "regex": "...", "timeoutMs": 15000, "pollMs": 250 }`
- `waitForNot`: like `waitFor`, but asserts absence until timeout.
- `expect`: like `waitFor`, but checks immediately (no polling).
- `expectCount`: counts matches in `screen|scrollback` and asserts `{ equals | atLeast | atMost }`.
- `copyMode`: `{ "type": "copyMode", "enter": true, "pageUp": 5, "exit": true }`
- `capture`: `{ "type": "capture", "label": "name", "scope": "screen"|"scrollback" }` (or omit `scope` to capture both)
- `historySample`: `{ "type": "historySample", "label": "optional" }` (records tmux `#{history_size}` to `history-samples.json`)
- `waitForExit`: `{ "type": "waitForExit", "timeoutMs": 15000 }`

Keys are tmux key names (examples: `Enter`, `Escape`, `Up`, `Down`, `C-s`, `C-c`).

## LLXPRT old-UI convenience steps

The runner currently includes a few convenience step types that are tuned to the legacy LLXPRT UI:

- `approveTool` / `approveShell` / `selectToolOption`

These are expected to be brittle across UI changes; prefer macros + runner primitives for anything meant to be portable.

## Gotchas

- **Completions can intercept `Enter`.** For slash commands the runner defaults to `["Escape","Enter"]` to dismiss suggestions before submitting. For other inputs, set `submitKeys` explicitly if needed.
- **Escape cancels requests.** If you cancel and the previous prompt text reappears in the input buffer, `Ctrl+C` clears the input in the legacy UI.
- **LLM-driven scripts can be flaky** with real models (stalling in “esc to cancel” or not emitting the expected tool call). For UI regressions, prefer deterministic scenarios (like `--scenario scrollback`) or a deterministic/mock provider (future work).
