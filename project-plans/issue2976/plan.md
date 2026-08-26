# Issue 2976 — Cancellable slash commands with a live input prompt

Follow-up from #2128 / PR #2813. Reported against `/image`, but the defect is in
the slash-command execution model.

## Problem restated

1. `processSlashCommand` holds `isProcessing` true for the whole invocation,
   including the awaited command action. `useAppInput` folds `!isProcessing`
   into `isInputActive`, and `InlineContent` renders no `Composer` when
   `isInputActive` is false. The prompt disappears for the duration of the
   command.
2. `useCancellation.cancelOngoingRequest` early-returns unless `streamingState`
   is `Responding` or `WaitingForConfirmation`. A slash command sets neither, so
   Esc is a no-op.
3. `CommandContext` carries no `AbortSignal`, so commands invent their own:
   `imageCommand.ts` registers a one-shot `process.once('SIGINT', ...)`,
   `setupGithubCommand.ts` builds a private `AbortController`, and
   `services/prompt-processors/shellProcessor.ts` passes
   `new AbortController().signal` into `ShellExecutionService.execute`.

## Direction chosen

Option 1 from the issue: thread a real `AbortSignal` through `CommandContext`,
make the existing Esc handler aware of in-flight slash commands, and revisit
`isInputActive` so the prompt stays up while a command runs.

Option 2 (route long commands through the tool-call scheduler) is rejected for
this issue: it requires a product decision about slash commands synthesising
tool calls and how that renders in history, and it would not by itself give the
generic slash-command layer a cancellation signal. Option 3 (async-task
manager) has the same problem and adds a second lifecycle owner.

The fix is applied at the slash-command layer, not patched into `/image`.

## Acceptance criteria

AC1. While a slash-command action is in flight, the input prompt (Composer)
remains rendered.

AC2. While the slash-command pipeline is waiting on the *user* (the
`confirm_shell_commands` pending tool-group and the `confirm_action`
confirmation), the Composer stays hidden exactly as it is today. AC1 must not
regress this.

AC3. Pressing Esc while a slash-command action is in flight aborts it and adds a
single INFO history item reporting the cancellation.

AC4. Pressing Esc twice does not add a second cancellation item for the same
invocation.

AC5. Pressing Esc when no slash command is in flight behaves exactly as today
(turn cancellation when streaming, no-op when idle — no spurious history item).

AC6. Every slash-command action receives `context.signal`, an `AbortSignal` that
is aborted by AC3 and is not aborted otherwise. The non-interactive path
supplies its existing process-level `AbortController` signal.

AC7. The cancelled operation actually aborts the underlying work: the signal
reaches the image runner, the `/setup-github` downloads, and the shell
injection executed by `shellProcessor`.

AC8. When an action rejects *because* its invocation was aborted, the framework
does not add an error history item on top of the cancellation notice. When an
action rejects for any other reason, the existing error item is still added.

AC9. `imageCommand.ts` registers no `SIGINT` listener, `setupGithubCommand.ts`
threads the framework signal into its downloads, and `shellProcessor.ts` stops
manufacturing a throwaway `AbortController`.

### Out of scope

- What `/image` generates or how the Codex backend is called.
- The non-interactive CLI path's own SIGINT handling (`-O` / `-P`), which works.
- Any change to how tool calls, async tasks, or turn cancellation behave when no
  slash command is in flight.

## Design

### 1. `CommandContext.signal`

`packages/cli/src/ui/commands/types.ts`

```ts
export interface CommandContext {
  /**
   * Aborted when the user cancels this slash-command invocation (Esc in the
   * interactive UI, the process abort controller in non-interactive mode).
   * Long-running actions must forward it to whatever they await.
   */
  signal: AbortSignal;
  invocation?: { ... };
  ...
}
```

Required, not optional — commands should not have to write `context.signal?`.

Providers of the field:

- `slashCommandHandlers.buildInvocationContext` — the per-invocation controller's
  signal (see 2).
- `slashCommandProcessorSupport.useCommandContext` — the base context is used for
  completions and as the template for invocations; it gets a module-level
  never-aborted signal. Every real invocation overrides it.
- `nonInteractiveCliCommands.handleSlashCommand` — `abortController.signal`, which
  it already has in hand.
- `test-utils/mockCommandContext.ts` — a fresh `new AbortController().signal`,
  overridable through the existing deep-merge.

### 2. Slash-command cancellation registry

New file `packages/cli/src/ui/hooks/useSlashCommandCancellation.ts`:

```ts
export interface SlashCommandCancellation {
  /** Registers a new in-flight action and returns its controller. */
  beginSlashCommandAction: () => AbortController;
  /** Deregisters an action once it has settled. */
  endSlashCommandAction: (controller: AbortController) => void;
  /** Aborts every in-flight action. Returns true iff any was aborted. */
  cancelActiveSlashCommand: () => boolean;
}
```

Semantics:

- The registry holds a `Set` of every in-flight controller, not just the newest.
  Keeping the prompt live means the user can submit a second command while a
  long one runs; with a single slot the short command's completion would evict
  the long one and leave it uncancellable — the exact bug being fixed.
- `cancelActiveSlashCommand` aborts every controller that is not already
  aborted and returns whether it aborted any, so a second Esc is a no-op (AC4).
  It does not deregister: an aborted action that is still unwinding must not be
  mistaken for a new one.
- `endSlashCommandAction(controller)` removes that controller by identity.
- No React state, so it is a plain factory (`createSlashCommandCancellation`)
  with a `useMemo` wrapper. Nothing about the registry drives rendering.

Nesting: `confirm_shell_commands` / `confirm_action` re-enter
`processSlashCommand`. Because begin/end bracket only the action await, the
outer invocation has already ended before the inner one begins.

### 3. `processSlashCommand`

`executeParsedCommand` brackets only the action:

```ts
const controller = deps.beginSlashCommandAction();
const context = buildInvocationContext(..., controller.signal);
let result;
try {
  result = await commandToExecute.action(context, parsed.args);
} catch (error) {
  if (controller.signal.aborted) return { type: 'handled' }; // AC8
  throw error;
} finally {
  deps.endSlashCommandAction(controller);
}
return result ? handleActionResult(deps, context, result) : { type: 'handled' };
```

`setIsProcessing` / `setLocalIsProcessing` keep their current lifetimes; nothing
else about the pipeline changes.

### 4. Esc

`useCancellation` (packages/cli/src/ui/hooks/agentStream/useAgentStreamLifecycle.ts)
takes a new `cancelActiveSlashCommand: () => boolean = () => false` parameter,
mirroring the existing `cancelRunningAsyncTasks` parameter, and runs it *before*
the streaming-state gate:

```ts
const cancelOngoingRequest = useCallback(() => {
  if (cancelActiveSlashCommand()) {
    addItem({ type: MessageType.INFO, text: SLASH_COMMAND_CANCELLED }, Date.now());
  }
  if (streamingState !== Responding && streamingState !== WaitingForConfirmation) return;
  ... unchanged turn cancellation ...
}, [...]);
```

Message text: `Command cancelled.` (distinct from the existing turn-level
`Request cancelled.`). Reported immediately on Esc rather than when the aborted
work unwinds.

### 5. Input visibility

`useAppInput` extracts the predicate into a pure helper and stops keying it off
the slash-command pipeline being busy at all:

```ts
export function computeIsInputActive(p: {
  streamingState: StreamingState;
  initError: string | null;
  hasSlashCommands: boolean;
  isAwaitingSlashCommandConfirmation: boolean;
}): boolean;
```

Rule: `(streamingState is Idle or Responding) && !initError && hasSlashCommands
&& !isAwaitingSlashCommandConfirmation`.

`isProcessing` was only ever a proxy for "something else owns the keyboard",
and a bad one: it is a plain boolean shared by overlapping invocations, so
inferring the confirmation phase from it is not sound once concurrent commands
are possible. AC2 is instead satisfied directly:

- `confirm_action` renders through `hasActiveDialog`, which replaces the whole
  inline layout, so the Composer cannot appear regardless of this predicate.
- `confirm_shell_commands` parks a Confirming tool group in the processor's
  pending items, which `computeIsAwaitingSlashCommandConfirmation` detects.
  A pending item that is merely progress (any non-Confirming status) does not
  take the prompt away.

### 6. Wiring

`useSlashCommandProcessorCore` calls `useSlashCommandCancellation()`, passes
`beginSlashCommandAction` / `endSlashCommandAction` into the
`SlashCommandHandlerDeps`, and returns `cancelActiveSlashCommand` on its result
(so `useSlashCommandProcessor` forwards it unchanged).

`useAppInput`:

- `useInputFinish` derives `isAwaitingSlashCommandConfirmation` from
  `core.pendingHistoryItems` for `computeIsInputActive`.
- `useInputStreamSetup` passes `core.cancelActiveSlashCommand` into
  `useAgentStream` as a new trailing optional parameter, which forwards it via
  `AgentStreamOrchestrationDeps.cancelActiveSlashCommand` into `useCancellation`.

`core` is constructed before `stream` in `useAppInput`, so no new refs or
circular-dependency plumbing are needed.

### 7. Removing the workarounds

- `imageCommand.ts`: drop the `AbortController` + `process.once('SIGINT')` +
  `removeListener`; pass `context.signal` to the runner. In the catch, if
  `context.signal.aborted`, return without adding an error item (AC8 — the
  framework already reported the cancellation).
- `setupGithubCommand.ts`: `downloadSetupFiles` and `downloadFiles` take the
  command `signal` and include it in the existing
  `AbortSignal.any([...])`. The private controller stays only for its real
  purpose (aborting the shared timeout once all downloads settle).
- `services/prompt-processors/shellProcessor.ts`: replace
  `new AbortController().signal` with `context.signal` in the
  `ShellExecutionService.execute` call.

  In scope because it is the same defect in the same layer, it is a one-line
  change, and the issue asks for the fix to be applied to the slash-command
  layer generally rather than to `/image`. It is also what makes a deterministic
  tmux repro possible (a custom command containing `!{sleep N}`).

## Tests (write first, all `bun:test`, behavioural)

1. `packages/cli/src/ui/hooks/useSlashCommandCancellation.test.tsx` — begin sets
   running; cancel aborts the returned controller's signal and returns true;
   second cancel returns false and the signal stays aborted (AC4); cancel with
   nothing active returns false (AC5); end clears running; end with a stale
   controller does not clear a newer one.

2. `packages/cli/src/ui/hooks/slashCommandHandlers.test.ts` —
   - a command action observes a non-aborted `context.signal`, and aborting the
     registry mid-action fires the action's own `signal` abort listener (AC6);
   - `isSlashCommandRunning` is true only while the action is pending and false
     during a `confirm_shell_commands` round-trip (AC2);
   - an action that rejects after its invocation was aborted adds no ERROR item
     (AC8);
   - an action that rejects without an abort still adds the ERROR item.

3. `packages/cli/src/ui/hooks/agentStream/__tests__/useCancellation.slashCommand.test.tsx`
   (mirrors the existing `useCancellation.asyncTasks.test.tsx`) — Esc with an
   in-flight slash command and `streamingState` Idle aborts it and adds exactly
   one `Command cancelled.` INFO item (AC3); a second Esc adds none (AC4); Esc
   with nothing in flight adds none and leaves turn cancellation untouched
   (AC5).

4. `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.inputActive.test.ts`
   — table over `computeIsInputActive`: visible while a slash command runs
   (AC1), hidden while processing without a running action (AC2), plus the
   pre-existing streaming/initError/no-commands cases as regression guards.

5. `packages/cli/src/ui/commands/imageCommand.test.ts` — the runner receives the
   context signal (aborting `context.signal` aborts the signal the runner saw,
   AC7); `process.listenerCount('SIGINT')` is unchanged across the invocation
   (AC9); a runner rejection after abort adds no error item.

6. `packages/cli/src/ui/commands/setupGithubCommand.test.ts` — aborting
   `context.signal` aborts the in-flight download (AC7) with `fetch` stubbed at
   the network boundary only.

7. `packages/cli/src/services/prompt-processors/shellProcessor.test.ts` —
   aborting `context.signal` terminates the injected shell command (AC7).

No mock theater: the hook, the handler, and the commands under test are all
real; only the network (`fetch`) and the image runner are stubbed, and they are
stubbed as boundaries that record the signal they were handed rather than
returning the assertion's literal.

## Manual verification (tmux harness)

The issue requires harness verification, not just unit tests. `/image` needs
Codex OAuth, which is not available in this checkout, so the deterministic repro
uses a custom command with a shell injection.

`scripts/tmux-script.issue2976-slash-cancel.llxprt.json` runs against the fake
provider (`scripts/fixtures/issue2976-slash-cancel.responses.jsonl`). It writes
a temporary user command whose prompt embeds `!{sleep 90}`, removes it on exit,
and asserts:

1. after `/issue2976-slowtest` is submitted, the composer is still on screen
   while the sleep runs (AC1);
2. Esc produces `Command cancelled.` (AC3);
3. the fake model's marker never appears afterwards, i.e. the cancelled command
   did not go on to submit its prompt (AC7);
4. the session is still usable (`/quit` exits normally).

Harness gotcha worth recording: a literal `!` does not survive the harness's
argument quoting into the tmux pane (it arrives as `\!`, which is an invalid
TOML escape and silently drops the command), so the script builds the shell
injection trigger from its octal code.

### What the harness caught that the unit tests did not

The first green-on-AC1/AC3 run still showed the fake model replying after Esc.
`shellProcessor` handles an aborted execution gracefully rather than throwing,
so the command action resolved normally with `submit_prompt` and the framework
went on to submit it. Discarding a rejection was therefore not enough:
`runCommandAction` now discards the outcome whenever the invocation was
aborted, resolved or rejected. Covered by "discards the result of an action
that resolves after being cancelled".

## Review triage

Findings from the independent design review, with dispositions.

### Fixed

- **Concurrent invocations orphaned the first controller.** The single-slot
  registry was overwritten by a second command, so a short `/help` submitted
  during a long `/image` left the long one uncancellable — the reported bug,
  reintroduced by the fix, and reachable precisely because the prompt is now
  live. The registry now holds every in-flight controller. Covered by "cancels
  every concurrently running action, not just the newest" and "keeps the
  long-running action cancellable after a short one finishes".
- **The AC2 invariant was a comment, not a property.** `isProcessing` is a plain
  boolean shared by overlapping invocations, so "processing and no action in
  flight" does not reliably mean "waiting on the user". Replaced with a direct
  test for a Confirming tool group (design section 5).
- **An unrelated error landing in the abort window vanished silently.**
  `runCommandAction` now logs the discarded error through the slash-command
  debug logger before dropping it.
- **`shellProcessor` kept spawning later `!{...}` injections after an abort.**
  The loop now breaks on `signal.aborted`.
- **A test passed with the production change reverted.** "hands the action the
  signal of the controller registered for it" now asserts identity against the
  registered controller rather than merely that a non-aborted signal exists.
- **The tmux script leaked its temporary command on a failed run.** It now
  removes it from a `trap ... EXIT INT TERM`.
- **`CommandContext.signal`'s doc overstated non-interactive behaviour.**
  Reworded: the non-interactive path aborts its run-level controller on its own
  terms; it is not a SIGINT-to-abort bridge.

### Rejected

- **"Discarding a resolved-after-abort result is wrong."** It is deliberate and
  is what the tmux run proved necessary: `shellProcessor` handles an aborted
  execution by returning a status suffix rather than throwing, so without the
  resolve-side discard a cancelled command still submitted its prompt to the
  model.

### Fixed after the open-code review

- **The loop guard that stops spawning injections after an abort had no test.**
  Covered by "stops spawning later injections once the invocation is cancelled".
- **A controller could stay registered if context construction threw** between
  `beginSlashCommandAction` and the try block, so a later Esc would report a
  cancellation that never happened. Registration and context construction now
  live inside the same try/finally. Covered by "deregisters even when the
  invocation fails before the action runs".
- **A discarded result left no trace** while a discarded error did. Both are
  logged now.
- **The abort-discard rule read as abort-error sniffing.** The `/image` test now
  rejects with an unrelated provider error to make the uniform rule explicit:
  once the invocation is cancelled, its outcome is discarded whatever it was.
  Narrowing the suppression to `AbortError` was considered and rejected —
  reporting a provider failure for a request the user just abandoned is noise,
  and the framework already applies the same rule one level up.

### Deferred (follow-up, not this issue)

- **Esc does not dismiss a pending shell-expansion confirmation.** By the time
  the confirmation is on screen the action has settled and its controller is
  deregistered, so Esc is a no-op there (it neither aborts nor reports, so the
  single-command case shows no misleading notice). The confirmation carries its
  own Cancel option, and this is unchanged from before: Esc did nothing during a
  slash-command confirmation previously either. Closing it means keeping the
  controller registered across the confirmation and racing the confirmation
  promise against the signal, which is its own behavioural change.

- **Only `/image`, `/setup-github` and the shell processor honour
  `context.signal`.** Long-running built-ins such as `/compress` and
  `/extensions update` keep running after Esc, so for them "Command cancelled."
  describes the invocation rather than the underlying work. This issue's scope
  is the mechanism plus the two named workarounds; migrating the remaining
  commands is separate work.
- **Telemetry cannot distinguish a cancelled invocation from a completed one.**
  `finalizeCommand` still emits a plain `SlashCommandEvent`. Changing the event
  shape is outside this issue.
- **`hasActiveDialog` omits `confirmUpdateLlxprtExtensionRequests`** even though
  `DialogManager` renders it. Pre-existing and unrelated to this change.

## Verification cycle

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, then
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
