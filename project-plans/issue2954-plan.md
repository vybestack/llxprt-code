# Issue #2954: Prompts queue after a terminal stream error

## Issue evidence

The reported session shows this sequence:

1. The active model turn emits a first-response timeout API error.
2. The request is cancelled and the composer returns to an idle state.
3. The user submits `/profile load opus5`.
4. Instead of executing the command, the queued-messages panel contains that command.

The public Agent event contract emits terminal `error` or `idle-timeout` events followed by `done{error}`. The CLI submission hook separately tracks active turn ownership and currently holds it until the entire async stream/turn cleanup promise settles. A terminal error can therefore be visible while interactive submissions are still gated by stale turn ownership. Cancellation exposes that mismatch by making the rendered state idle immediately: the input permits the next submission, but `useSubmitQuery` still classifies it as queueable.

## Accepted behavior

### AC1 — Terminal stream errors release interactive submission gating immediately

When the current public Agent stream emits `error` or `idle-timeout`, that turn stops owning the interactive submission gate without waiting for trailing iterator or promise cleanup. The UI also leaves its responding state at that terminal event boundary.

### AC2 — Slash commands execute after a terminal error

Given an errored stream whose trailing cleanup remains unsettled, when the user submits a slash command such as `/profile load opus5`, the command is processed immediately and is not added to queued submissions. A behavioral test must observe a command-owned effect, not only a mock call count.

### AC3 — Ordinary prompts start as fresh submissions after a terminal error

Given the same unsettled cleanup boundary, when the user submits an ordinary prompt, it is accepted as a new turn rather than added to the queued-messages drawer. Provider stream execution may remain serialized by `useAgentEventStream`; this criterion concerns interactive acceptance and queue ownership, not concurrent provider requests.

### AC4 — Late stale cleanup cannot release a newer active turn

If the errored turn’s cleanup settles after a newer turn starts, the stale outer cleanup must not clear the newer turn’s active ownership, reset its state, or trigger queue draining on its behalf.

### AC5 — Existing behavior while genuinely active remains unchanged

Before a terminal error occurs, ordinary messages submitted while a turn is genuinely active remain queued. Slash and shell commands submitted while `StreamingState` is `Responding` remain rejected by the input with the existing “cannot be queued” behavior.

### AC6 — Existing queue error/cancellation distinctions remain unchanged

- An ordinary API `error` continues to clear queued submissions by default.
- An `idle-timeout` continues to preserve already queued submissions.
- Ctrl+C/ESC cancellation continues to preserve queued submissions and suppress automatic draining until explicit user action or a new submission.
- The fix must not silently send, clear, reorder, or duplicate pre-existing queued prompts outside those existing rules.

## Scope boundaries

### In scope

- Interactive active-turn ownership at terminal public Agent `error` and `idle-timeout` event boundaries.
- Ownership-safe stale cleanup after a newer turn starts.
- Behavioral regression tests for command execution, ordinary follow-up acceptance, queue contents, and stale cleanup.
- Terminal UI verification of the reported timeout/error and follow-up command sequence.

### Out of scope

- Changing first-response or inter-chunk timeout detection, thresholds, provider networking, or error text.
- Changing the public Agent event contract or adding a public abstraction.
- Changing profile command implementation itself.
- Redesigning queued-message storage, prompt serialization, cancellation behavior, or queue draining.
- Expanding the terminal-event set beyond public Agent `error` and `idle-timeout` for this fix.
- Adjacent refactors, dependencies, workflow/configuration changes, lint/complexity changes, or speculative defensive hardening.

## Test-first implementation plan

1. Add behavior-focused tests around the real `useSubmitQuery` event/submission path.
2. For both public terminal inputs (`error` and `idle-timeout`), keep the first run’s cleanup unresolved after delivering the event and prove the interactive gate is released.
3. Submit a slash command and prove a command-owned effect occurs while no queue entry is added and no model stream is started for the command.
4. Submit an ordinary prompt and prove it is accepted as a fresh turn rather than queued; allow the existing stream runner to serialize actual provider execution.
5. Start a newer unresolved turn, then settle the old errored turn and prove stale cleanup does not release ownership for the newer turn or incorrectly drain a third queued prompt.
6. Retain or add boundary assertions for ordinary active-turn queueing, active-response command rejection, error queue clearing, idle-timeout queue preservation, and cancellation drain suppression.
7. Run the new tests before production edits and confirm RED on the existing stale active-turn ownership behavior.
8. Apply the smallest internal fix: release interactive ownership/responding state on the two terminal error event types and guard outer cleanup with current-turn ownership.
9. Run focused tests to GREEN, refactor only if the tests expose duplication or unclear ownership, then run required full verification and the terminal tmux scenario.

## Behavioral evidence required for completion

- A regression test fails on the pre-fix code because a follow-up submission is queued while terminal-error cleanup remains unsettled.
- Slash-command behavior passes for both `error` and `idle-timeout` and observes command behavior rather than only invocation.
- Ordinary follow-up behavior passes and leaves the queued-submissions collection unchanged.
- Late stale-cleanup behavior passes while a newer turn is active.
- Existing active-stream queueing, queue clear/preserve distinctions, and cancellation suppression tests remain green.
- Terminal tmux validation confirms `/profile load …` executes after the error boundary without appearing in the queue.
- Full local verification and candidate-head CI pass.

## Review triage policy

Every review finding will be classified as one of:

- **Blocker-Fix** — required for correctness, safety, architecture, verification, or CI.
- **In-scope-Fix** — directly improves an accepted behavior or its behavioral evidence.
- **Reject** — factually incorrect, already covered, or contrary to accepted behavior.
- **Defer** — valid but outside this issue’s accepted behavior or requiring an unplanned subsystem/public abstraction/workflow/dependency change.

Only Blocker-Fix and In-scope-Fix findings authorize changes in this issue.