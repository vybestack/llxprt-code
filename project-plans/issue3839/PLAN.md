# Issues #3839 and #3840: session list flags and continuation output in `-p` mode

One branch (`issue3839`) and one PR fix both issues. They are independent; each
has its own section.

## #3839: `--list-sessions` / `--delete-session` do nothing useful outside a TTY

### Observed

From a non-TTY shell, `llxprt --list-sessions` prints

```
No input provided via stdin. Input can be provided by piping data into llxprt or using the --prompt option.
```

and exits without listing anything.

### Root cause

1. `main()` in `packages/cli/src/cli.tsx` runs `ensureStdinOrPrompt` (which
   calls `ensureStdinOrPromptProvided` in `cliBootstrap.tsx` and exits 1) long
   before `setupSessionRecording` reaches `handleSessionListAndDelete`
   (`packages/cli/src/cliSessionBootstrap.ts`). The flags are also behind the
   unconfigured-provider guard, provider activation, sandbox hop and agent
   construction, none of which listing or deleting a local file needs.
2. `handleSessionListAndDelete` prints with `debugLogger.log` /
   `debugLogger.error`. `DebugLogger` (`packages/telemetry/src/debug/DebugLogger.ts`)
   prints only when debug logging is enabled, so even when the handler runs a
   normal user sees nothing.

### Required behavior

- `--list-sessions` and `--delete-session <ref>` work with no prompt, no
  piped input, no TTY, and no configured provider. They do not construct an
  agent, activate a provider, hop into a sandbox, or start a session recording.
- They use the same chats dir and project hash derivation as
  `setupSessionRecording` (one shared helper; no second copy of the rule).
- Output: the list (or "No recorded sessions for this project.") and the
  delete confirmation go to stdout; errors go to stderr. Exit code 0 on
  success, 1 on a delete error.
- Unreadable recordings (from the #3732 discovery diagnostics) are reported on
  stderr as a single "Skipped N unreadable session recording(s)" block with
  path and reason, matching the startup `--continue` warning, without
  changing the exit code.
- `--help`/`--version` behavior and every other startup path are unchanged.
  Running with a prompt plus `--list-sessions` still lists and exits.

### Tests (behavioral, real temp dirs, real recordings)

1. Non-TTY, no prompt, no stdin data, two recorded sessions: the list (both
   sessions) is written to stdout, exit 0, and the stdin error is not printed.
2. No sessions: "No recorded sessions for this project." on stdout, exit 0.
3. `--delete-session <id>`: the file is deleted, confirmation on stdout, exit
   0; unknown ref: error on stderr, exit 1, nothing deleted.
4. An unreadable recording next to a healthy one: the healthy one is listed on
   stdout and the skipped block appears on stderr.
5. No provider configured: listing still works (no unconfigured-provider exit).
6. The list/delete path does not construct an agent or call provider
   activation (assert through the narrowest real seam, e.g. that `main()`
   returns/exits before those steps, using the existing cli test harness
   conventions).

## #3840: continuation turns in `-p` output run together

### Observed

With active todos, a `-p` run printed several model replies back to back with
no separator. Minimal reproduction with the installed nightly:

```
llxprt --profile-load lunahigh --yolo -p "Call todo_write once to create exactly one todo: id '1', content 'write the quarterly report', status 'pending'. After that tool call, do NOT do any work and do NOT call any more tools. Reply with exactly the single word READY."
```

stdout ends with `READY<think>...</think>` followed by the next attempt's text
on the same line.

### Root cause

`MessageStreamOrchestrator._runRetryLoop`
(`packages/agents/src/core/MessageStreamOrchestrator.ts`) re-prompts the model
up to `MAX_RETRIES` times when a turn ends with text only while todos are
still active (`_evaluateTodoContinuation`), and on thinking-only turns. Each
attempt's `Content` events are yielded into the same stream, so consumers
concatenate them. The non-interactive printer (`packages/cli/src/nonInteractiveCli.ts`)
writes content chunks to stdout as they arrive, so attempt N+1 starts
immediately after attempt N's last character.

The continuation loop itself is intended agent behavior (headless workers rely
on it) and stays.

### Required behavior

- When a continuation attempt produces visible output after an earlier
  attempt in the same prompt already produced visible output, the new
  attempt's output starts on a new paragraph (a blank line between them) in
  `-p` text output. The final stdout still ends with exactly one trailing
  newline, as today.
- Implement the boundary once, at the layer that knows attempts begin
  (prefer a single, explicit signal from the orchestrator over guessing in
  each consumer). Whatever is chosen must not change the conversation history
  sent to the provider or recorded in the session file: a separator is a
  presentation concern, not model content.
- Check the interactive UI path as well: if continuation attempts are also
  rendered into one message without separation, apply the same boundary
  there through the same signal. If the UI already separates them, leave it.
- JSON output mode (`--output-format json`, if present): the aggregated
  response text separates attempts the same way.
- Single-attempt runs are byte-for-byte unchanged.

### Tests (behavioral)

7. Orchestrator-level: a scripted provider that answers attempt 1 with text
   while a todo is active, then answers attempt 2 with text. The consumer-
   visible output separates the two attempts; the provider-facing history
   and the recording contain each attempt's text without the separator.
8. Non-interactive CLI: the same scenario through the non-interactive runner
   writes `attempt1\n\nattempt2\n` (or the equivalent defined by the chosen
   boundary) to stdout.
9. Single attempt: output identical to the current behavior.
10. Thinking-only retry followed by visible text: no leading blank line before
    the first visible output.
11. Interactive path, if changed: the rendered message shows the boundary.

## Verification

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load lunahigh "write me a haiku and nothing else"
```

Manual:

- From a scratch project with recorded sessions, run the dev CLI
  (`DEV=true bun <repo>/packages/cli/index.ts --list-sessions`) from a non-TTY
  shell: the list prints. Repeat with `--delete-session` on a scratch copy.
- Rerun the #3840 reproduction above with the dev CLI and confirm the attempts
  are separated.

## Decisions made during implementation

- #3839: list/delete run after Config bootstrap and take the chats dir and
  project hash from Config through `resolveSessionStorageLocation`, the helper
  session recording uses. A plain `new Storage(cwd)` can resolve a different
  directory when a user-global `.env` sets `LLXPRT_LOG_HOME` and folder trust
  is enabled in an untrusted workspace. Malformed settings and sandbox
  credential startup still run first and fail fast; that is intended.
- #3840: the orchestrator emits a public `attempt-boundary` event before the
  first output of every later retry attempt in one `sendMessageStream` call.
  Consumers decide whether a break is needed from what they actually
  displayed (after emoji filtering), so hidden or filtered output never
  produces a leading or doubled separator. The interactive UI starts a new
  assistant item instead of inserting text; Zed ACP tracks the message and
  thought channels separately.
- Quiet `-p` mode now runs text through the same streaming emoji filter as
  plain mode instead of filtering the whole buffer once at the end.
