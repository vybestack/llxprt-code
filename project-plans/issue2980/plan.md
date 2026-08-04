# Issue 2980: POSIX shell wrapper and PTY signal normalization

Plan ID: PLAN-20260804-ISSUE2980
Generated: 2026-08-04

## Accepted scope

This issue changes only the existing POSIX foreground command wrapper and the
node-pty exit-result boundary. It does not change managed background jobs,
security parsing, Windows execution, shell policy, dependencies, workflows,
quality configuration, or public APIs.

Current `main` already contains issue 1995. Its AST-based background promotion
removed the stale `endsWith('&')` branch named in the issue. Therefore the
escaped-ampersand case is accepted as a regression contract rather than a
currently failing reproduction. The single-line wrapper still causes the
comment and heredoc failures, leaves the temp-file redirect unsafe, and still
receives node-pty's clean-exit signal value `0` unchanged.

## Acceptance criteria

### REQ-2980-1: Shell grammar remains the user's grammar

- **GIVEN** a non-Windows shell command ending in an escaped literal ampersand,
  such as `printf foo\&`
- **WHEN** `buildCommandToExecute` generates a command and real Bash executes it
- **THEN** it exits 0 and prints `foo&`.

- **GIVEN** a command ending in a `#` comment
- **WHEN** the generated command is executed through real Bash
- **THEN** the comment does not consume wrapper syntax, the intended output and
  exit status are preserved, and the pgrep result file is written.

- **GIVEN** a command containing a heredoc
- **WHEN** the generated command is executed through real Bash
- **THEN** Bash accepts the heredoc, emits its content, preserves the command's
  exit status, and writes the pgrep result file.

- **GIVEN** a syntactically valid command body ending in a real `&` that reaches
  the foreground builder rather than managed-job promotion
- **WHEN** the generated command is executed through real Bash
- **THEN** the wrapper itself does not introduce a syntax error and pgrep can
  record a surviving process in the invocation's process group.

Relevant preservation boundaries are an ordinary successful command, `false`,
`exit 42`, `set -e; false`, and a command already ending in `;`. These prove
that the wrapper captures the body status before running pgrep and does not
silently rewrite the submitted body.

### REQ-2980-2: Temp-file paths are literal shell data

- **GIVEN** a pgrep temp-file path containing spaces, an apostrophe, and shell
  command-substitution syntax
- **WHEN** the generated command is executed through real Bash
- **THEN** redirection creates that exact path, no command substitution runs,
  and the body exit status is preserved.

The existing `singleQuoteForShell` helper must be reused and covered directly
for ordinary text, whitespace, apostrophes, consecutive apostrophes, and shell
metacharacters.

### REQ-2980-3: Wrapper consumers remain integrated

- **GIVEN** the standalone execution-service adapter receives a command produced
  by `buildCommandToExecute`
- **WHEN** it unwraps the generated form
- **THEN** the delegated command equals `strippedCommand.trim()`, including a
  caller-supplied trailing semicolon and multiline/heredoc content.

- **GIVEN** an input that is not in the generated wrapper form
- **WHEN** the standalone adapter handles it
- **THEN** the input is not rewritten.

- **GIVEN** Zed terminal integration compares the generated command with its raw
  command
- **WHEN** the wrapper format changes
- **THEN** terminal updates still correlate with the originating command.

- **GIVEN** `isWindows === true`
- **WHEN** `buildCommandToExecute` is called
- **THEN** the command remains a byte-identical pass-through.

### REQ-2980-4: Clean PTY exits do not report a signal

- **GIVEN** node-pty invokes its exit callback with `{ exitCode: 0, signal: 0 }`
- **WHEN** the PTY result is finalized
- **THEN** `ShellExecutionResult.signal` is `null`.

- **GIVEN** the normalized clean result reaches shell-tool formatting
- **WHEN** output is empty or normal
- **THEN** `llmContent` reports `Signal: (none)` and `returnDisplay` does not say
  `Command terminated by signal: 0`.

- **GIVEN** node-pty reports a nonzero signal such as 9 or 15
- **WHEN** the result is finalized and formatted
- **THEN** that signal remains unchanged and the termination display continues
  to identify it.

- **GIVEN** node-pty omits the signal
- **WHEN** the result is finalized
- **THEN** the signal remains normalized to `null`.

## Design

On POSIX, emit a trap before the body so no body comment, heredoc, or terminal
operator can consume an appended epilogue:

    trap '__code=$?; pgrep -g 0 >'<safely quoted path>' 2>&1; exit $__code' EXIT
    <trimmed command body, otherwise verbatim>

Construct both quoting layers with `singleQuoteForShell`: first quote the path
inside the trap action, then quote the complete action for `trap`. Capture `$?`
before `pgrep` and explicitly exit with the captured status. Keep `pgrep -g 0`
and `2>&1`; changing process discovery is outside this issue.

Update the private standalone-adapter unwrapping logic and Zed's private command
matcher to recognize the new generated grammar. These are required integration
changes, not new abstractions.

Normalize signal with the exact boundary mapping `signal === 0 ? null : signal
?? null` in PTY finalization. Do not add a second defensive normalization in
`CoreShellToolHostAdapter`.

## Test-first implementation sequence

1. Add real-Bash behavioral tests for REQ-2980-1 and REQ-2980-2. The tests must
   create isolated real temp directories, execute the generated string as one
   `bash -c` argument, and skip on Windows. Register any new tools test file in
   the existing Bun tools manifest.
2. Add wrapper round-trip/pass-through and `singleQuoteForShell` tests for
   REQ-2980-2/3. Keep the existing Zed integration test derived from the real
   builder as the integration drift guard.
3. Add a PTY harness case that drives the existing node-pty callback shape with
   signal 0, plus shell-tool formatting evidence. Preserve existing nonzero and
   null/undefined cases.
4. Run the targeted tests and capture their expected RED failures before
   changing production code.
5. Implement only the wrapper, required private consumers, and PTY boundary
   mapping described above; rerun targeted tests to GREEN.
6. Run complete project verification and required reviews.

## Explicit non-goals

- Do not change `is_background`, AST promotion, `ShellJobManager`, background
  spawn, process retention, or cancellation.
- Do not replace `pgrep -g 0` with `jobs -p`, and do not modify
  `parsePgrepFile`, `collectProcessInfo`, or PGID resolution.
- Do not fix the separate CLI `!`-mode wrapper in
  `shellCommandProcessor.ts`; it uses a different `pwd` protocol.
- Do not address the deferred standalone-adapter limitation that drops pgrep
  process information.
- Do not engineer around a command that replaces the wrapper's EXIT trap or
  uses `exec`; those are not requested behaviors and receive no new contract in
  this issue.
- Do not change Windows/PowerShell behavior, shell policy/security parsing,
  schemas/descriptions, dependencies, workflows, agent memory, lint rules, or
  complexity thresholds.

## Review-finding triage baseline

| Finding | Classification | Decision |
| --- | --- | --- |
| Current issue text references removed `endsWith('&')` logic | In-scope-Fix | Keep escaped `&` as behavioral regression evidence; fix the shared wrapper grammar rather than restoring heuristics. |
| Wrapper format is hardcoded by Zed command matching | Blocker-Fix | Update the existing private matcher and retain integration coverage. |
| Unwrapper currently strips a generated semicolon | Blocker-Fix | Preserve exact trimmed-body round trips under the new wrapper. |
| Separate CLI `!`-mode wrapper has similar grammar risks | Defer | Different protocol and outside issue 2980. |
| Standalone adapter does not collect pgrep process data | Defer | Previously recorded defect not listed in this issue. |
| Tests for user EXIT traps or `exec` degradation | Reject | They would add behavior/contracts outside the accepted issue. |
| Replace pgrep with upstream `jobs -p` | Reject | Changes process-discovery semantics outside the accepted behavior. |
| Add adjacent defensive signal normalization | Reject | Normalize once at the PTY source boundary. |

## Verification gates

Targeted behavioral evidence must pass first. Before commit and PR creation, run:

- `npm run test`
- `npm run lint`
- `npm run typecheck`
- `npm run format`
- `npm run build`
- `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`

Then complete DeepThinker review, local Open Code Review with test files included,
PR CI, CodeRabbit/PR review triage, conflict and ancestry checks. Completion
requires every accepted behavior to have evidence on the candidate head and all
Blocker-Fix/In-scope-Fix findings to be resolved.
