## Old Ink UI: automated interactive testing strategy (2025-12-15)

### Why we need a harness
- The scrollback/redraw bug is visible only in a real interactive terminal session.
- Piping stdin (`echo "x" | node ...`) is not usable because LLxprt treats non-TTY stdin as non-interactive and follows the `runNonInteractive(...)` path (see `packages/cli/src/gemini.tsx`).
- We need a way for the agent to:
  - launch LLxprt in interactive mode,
  - send keystrokes (including Enter/Ctrl combos),
  - capture “what the screen looks like” and/or scrollback,
  - repeat scenarios deterministically to validate fixes without manual human testing.

### Approach A (first): tmux-driven PTY automation
tmux gives us:
- A PTY/TTY environment (so LLxprt stays interactive).
- Key injection via `tmux send-keys`.
- Screen + scrollback capture via `tmux capture-pane`.

Key mechanics:
- Start the app:
  - `tmux new-session -d -s <name> -x <cols> -y <rows> 'node scripts/start.js'`
- Type text realistically:
  - Use `tmux send-keys -l 'literal text'` (not a single token) so Ink’s input state updates like real typing.
  - Sleep briefly before `Enter`; some submissions were flaky when typed+entered too quickly.
  - Caveat: when the suggestions list is visible, `Enter` can be interpreted as “accept suggestion” rather than “submit”. A practical workaround is sending `Enter` twice (first may accept/autocomplete, second submits once the input is stable), or `Esc` then `Enter`.
- Send special keys:
  - Enter: `tmux send-keys Enter` (or `C-m`)
  - Ctrl combos: `tmux send-keys C-s`, `C-c`, etc.
- Capture output:
  - Visible screen: `tmux capture-pane -p -t <name>`
  - Include scrollback: `tmux capture-pane -p -t <name> -S -2000`
  - Optional raw stream capture (for detecting redraw spam): `tmux pipe-pane -o -t <name> 'cat >> /tmp/raw.log'`

What we can assert from captures (initially):
- Presence of expected echoed commands (e.g. `/help`, `/profile load synthetic`).
- Presence/absence of known UI markers (“Tips for getting started”, “Using:”, command output blocks).
- For scrollback/redraw work: detect repetitive full-frame patterns in captured scrollback or raw logs.

Mac permissions:
- tmux-based control does not require Accessibility permissions (no GUI automation).
- No sudo needed.

### Approach B (later): node-pty + headless xterm.js
This becomes valuable when we need more precise, automated “scrolling while streaming” checks:
- Spawn LLxprt via `@lydell/node-pty`.
- Feed output into a headless terminal emulator (xterm.js headless) so we can:
  - programmatically change viewport scrollTop while the process keeps rendering,
  - snapshot the *viewport* separately from the backing buffer,
  - compute objective metrics (e.g., “frames per second while scrolled up”, “buffer growth rate while scrolled up”).

This is more work than tmux, but can yield reliable “no human needed” regression tests.

### Immediate proof-of-concept scenario (requested)
Run `node scripts/start.js` in a tmux session and inject:
1) `/profile load synthetic` + Enter
2) `write me a haiku` + Enter
3) `/quit` + Enter

With explicit sleeps between steps and a final capture of the pane output.

### Scripted runner (JSON)
To avoid rewriting Node code for each new reproduction, the harness also supports running a JSON script:
- Example: `node scripts/oldui-tmux-harness.js --script scripts/oldui-tmux-script.example.json`

Script primitives:
- `line`: type text and submit with configurable `submitKeys` (defaults to `["Escape","Enter"]`).
- `waitFor` / `expect` / `expectCount`: verify screen or scrollback contains (or matches regex) and optionally assert counts.
- `waitForNot`: wait until a matcher is absent (useful for “spinner gone” / “idle again” checks).
- `approveShell`: detect the Shell approval dialog and choose `once|always|no`.
- `approveTool`: approve a tool confirmation prompt (e.g. `run_shell_command`) with `once|always|no`.
- `copyMode`: enter/exit and scroll (`pageUp`, `pageDown`, `up`, `down`).
- `capture`: write labeled `*-screen.txt` / `*-scrollback.txt` artifacts mid-run.

### Scrollback/redraw reproduction (automated)
To “see” the scrollback redraw problem without a human staring at the terminal, we can:
- launch the interactive Ink UI in tmux,
- run a long-ish shell command that emits output incrementally,
- enter tmux copy-mode (simulates user scrolling up),
- capture scrollback and compute objective metrics (duplicate sentinel lines, tmux history growth).

Command:
- `node scripts/oldui-tmux-harness.js --scenario scrollback --rows 20 --cols 100`

Artifacts:
- `scrollback.txt` – includes repeated “frames” if redraw spam happens (look for repeated headers/tool blocks).
- `metrics.json` – summarizes duplicate sentinel counts and tmux history growth during copy-mode.
- `history-samples.json` – time series of `#{history_size}` while in copy-mode.

Quick interpretation:
- `metrics.json.counts.sentinelCount` should ideally be `1`. If it’s `>1`, we reprinted the same output multiple times into scrollback (the bug symptom).
- `metrics.json.history.deltaDuringCopyMode` should be small for “stable UI”; a large delta indicates scrollback growth while the user is “scrolled up”.

Pass/fail mode:
- Add `--assert` to make the harness exit non-zero when `sentinelCount !== 1` (baseline: with `--rows 20 --cols 100` it currently fails; with larger heights it may pass).

### Known flakiness: LLM-driven flows
When scripts depend on a real model to reliably emit tool calls (e.g., “ask model to call `run_shell_command` twice, approve both”), we currently see frequent stalls in an “`esc to cancel` (Xm)” state and/or the model simply not emitting the tool call on the next prompt.

For repeatable UI regressions, prefer:
- “pure UI” scripts that don’t depend on the model (e.g., shell mode commands for long output + scrollback reproduction), and/or
- a deterministic/mock provider for harness runs (future work).
