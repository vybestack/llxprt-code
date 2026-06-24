## Consolidate the agentic turn loop into the engine (agents package) with policy + approval injection points (Parent #1568)

### Summary

The **agentic turn loop** — send message to model, stream the turn, if the model requested tools run them (subject to policy/approval), feed the results back, repeat until the model stops requesting tools — is currently **hand-rolled in clients**, not owned by the engine. It exists as (at least) two independent implementations:

1. In the CLI, spread across the `packages/cli/src/ui/hooks/geminiStream/` hooks (continuation, submit, scheduler bridge).
2. In a2a-server, hand-rolled again inside `packages/a2a-server/src/agent/task.ts`.

This is concern leakage: the loop is core engine behavior, but each client reimplements the continuation state machine. The two copies can and do drift, and any subtle ordering bug (e.g. mark-submitted vs re-submit) has to be fixed in every copy.

This issue moves the loop into the engine — specifically `packages/agents`, which already owns `AgentClient` (the single-turn `sendMessageStream` primitive), the tool scheduler, and the confirmation coordinator — and exposes exactly two injection points so that different clients can drive the **same** loop:

- **Policy** (automatic decision): the existing `PolicyEngine` + `ApprovalMode` decide ALLOW / DENY / ASK_USER for each tool call. Pure engine logic, no UI.
- **Approval** (only on ASK_USER): an injected handler resolves a `ToolConfirmationOutcome`. This is the one place clients differ.

After this change there is **one** loop implementation. Clients provide a policy and an approval handler and otherwise just consume the event stream.

This is a **prerequisite for #1594** (the public createAgent/Agent API) and a **peer of #2033** (relocate provider/profile composition). #2033 makes a provider reachable headlessly; this issue makes a *turn* runnable headlessly. Both feed #1594.

### Scope boundary vs #1594 (read this first)

This issue is deliberately limited to making the loop **exist in the right place as an engine primitive** with the policy/approval injection points wired. Its internal entry point may stay internal/unpolished.

It does NOT design the public-facing shape. The public `createAgent`/`Agent` surface, the `AgentEvent` union, the `stream()` signature, and re-exporting the policy/outcome enums as public api are all **#1594's** job and must not be pre-empted here. The discipline: this issue's tests drive whatever internal entry exists; #1594's tests drive `createAgent`.

### Why this is needed (the duplication, with evidence)

- The single-turn primitive already lives in the engine: `AgentClient.sendMessageStream` (`packages/agents/src/core/client.ts:676`). It yields one turn's events. It does NOT run the multi-turn tool loop.
- The CLI builds the loop on top of that primitive across `packages/cli/src/ui/hooks/geminiStream/`:
  - `toolCompletionHandler.ts` (352 lines) — the loop body: split completed tool calls by agent id, build functionResponse parts, mark tools submitted (ordered before re-submit to prevent reprocessing), handle cancelled-tool history, then re-submit.
  - `useSubmitQuery.ts` (453 lines) — the submit/continuation entry.
  - `useGeminiStreamOrchestration.ts` (287 lines) — wires submit to the scheduler.
  - `../useReactToolScheduler.ts` (799 lines) — the scheduler bridge.
  - Plus engine-flavored logic inside `useStreamEventHandlers.ts` (716) and `streamEventDispatcher.ts` (384).
- a2a-server reimplements the same loop in `packages/a2a-server/src/agent/task.ts` (901 lines), including its own auto-execute approval shortcut (`task.ts:450` checks `ApprovalMode.YOLO` and resolves `ToolConfirmationOutcome.ProceedOnce` at `task.ts:466`). That is a second, independent copy of the exact policy/approval pattern this issue centralizes.

### The primitives already exist (this issue assembles, it does not invent)

- `PolicyDecision` (`packages/policy/src/types.ts`): `ALLOW | DENY | ASK_USER`.
- `ApprovalMode` (`packages/core/src/config/configTypes.ts`): `DEFAULT | AUTO_EDIT | YOLO`.
- `ToolConfirmationOutcome` (`packages/tools/src/types/tool-confirmation-types.ts`): `ProceedOnce | ProceedAlways | ProceedAlwaysAndSave | ProceedAlwaysServer | ProceedAlwaysTool | ModifyWithEditor | SuggestEdit | Cancel`.
- The confirmation pathway already lives engine-side: `packages/agents/src/scheduler/confirmation-coordinator.ts` (routes confirmation requests/responses over the `MessageBus` by correlationId) plus the rest of `packages/agents/src/scheduler/`.

The two-tier model: **policy** returns the automatic decision; **only** on `ASK_USER` does the loop call the injected **approval** handler, which returns a `ToolConfirmationOutcome`.

### Target design

Move the loop into `packages/agents` as an engine-owned orchestration that, given an input message, runs to turn completion and yields a flat event stream (including tool-execution events). It takes two injection points:

1. **Policy** — `PolicyEngine` + `ApprovalMode` (config-level). a2a "yolo" == policy never returns ASK_USER; CLI DEFAULT == policy returns ASK_USER for risky tools.
2. **Approval handler** — invoked only on ASK_USER. Recommended shape: the loop is **bus-native internally** (publishes a confirmation request to the `MessageBus` and awaits the correlated response, exactly as the CLI works today), and a thin `onApproval(request) => Promise<ToolConfirmationOutcome>` callback is offered as sugar implemented by attaching a default responder to the bus. This keeps the CLI's existing bus-based confirmation untouched while giving a2a/scripts a simple callback. The implementer confirms the precise shape, but the constraint is firm: exactly one loop and one approval pathway underneath.

Default with no approval handler and a policy that can return ASK_USER: treat ASK_USER as DENY (safe), or require the caller to set a non-asking policy.

Cancellation/disposal belong to the loop: an `AbortSignal` in, clean teardown out — not hand-managed by each client.

### Out of scope (do NOT do these here)

- The public `createAgent`/`Agent` api, `AgentEvent` union, `stream()` signature, and public re-export of the policy/outcome enums — that is #1594.
- The CLI thin-UI rewrite — that is #1595.
- Migrating a2a-server onto the loop. Note: a2a is largely pulled from upstream and is known to be partly broken (e.g. no multi-provider support); it will be fixed/migrated in a later dedicated issue. a2a here is **evidence of duplication and a future beneficiary**, not a migration target and not a gate on this issue's acceptance.
- Re-homing or consolidating `ApprovalMode` / `PolicyEngine` / `ToolConfirmationOutcome` across packages (a possible later cleanup; out of scope here).
- Any change to tool *behavior*, approval *semantics*, or the user-visible CLI confirmation flow.

### Constraints (per dev-docs/RULES.md and #1568)

- **No backward-compatibility shims / re-export stubs** to dodge migration. Update import sites directly. (#1568 requirement.)
- **CLI behavior is unchanged.** The CLI keeps its confirmation dialog, ModifyWithEditor, keypress handling, spinner, and pending-history rendering. What it loses is the hand-rolled continuation plumbing (submitQuery / functionResponse assembly / markToolsAsSubmitted), which moves into the engine. Genuine UI logic stays in the hooks.
- Behavior-preserving: existing CLI streaming/tool tests must pass unchanged; move/realign tests with the code.
- TDD: integration-first behavioral tests drive a multi-turn tool loop through the new engine entry point. No mock theater; assert event sequences, history contents, and outcomes — not "method was called." No new `any`; respect strict lint/complexity rules.

### Acceptance criteria

- [ ] A single loop implementation lives in `packages/agents` and runs send → stream → policy → (ASK_USER → approval) → execute → feed-back → repeat, to turn completion, yielding a flat event stream including tool-execution events.
- [ ] The loop takes a **policy** (PolicyEngine/ApprovalMode) and an **approval handler** as injection points; the approval handler is invoked only on ASK_USER and resolves a `ToolConfirmationOutcome`.
- [ ] The CLI consumes this single loop. The CLI no longer contains its own continuation state machine (`toolCompletionHandler.ts` continuation logic, `useSubmitQuery` re-submit, scheduler-bridge loop logic collapse onto the engine loop). CLI user-visible behavior is identical.
- [ ] No client contains a second loop implementation. (a2a is not migrated here but is documented as the next beneficiary.)
- [ ] A headless behavioral harness drives the loop end-to-end with no CLI import, proving both modes over the **same** loop:
  - CLI-style: policy returns ASK_USER, approval handler returns ProceedOnce / Cancel / ModifyWithEditor, loop continues/aborts/edits accordingly.
  - a2a-style: policy never asks (auto), loop runs tools without invoking the approval handler.
  - In both, the consumer never builds functionResponse parts, never calls submitQuery, never calls markToolsAsSubmitted.
- [ ] Cancellation via AbortSignal cleanly stops the loop and tears down, exercised by a test.
- [ ] No dependency cycles introduced (agents already depends on core/tools/policy via existing edges; verify the build).
- [ ] Full verification passes: test, lint, typecheck, format, build, and the profile smoke command.

### Suggested sequencing for the implementer

1. Write the headless multi-turn loop harness first (CLI-style ASK_USER and a2a-style auto), against the intended engine entry point — RED.
2. Extract the continuation/loop logic from the CLI hooks into an `agents`-owned loop primitive with the policy + approval injection points; keep it bus-native internally.
3. Re-point the CLI hooks to drive the engine loop; delete the duplicated continuation plumbing; keep all CLI streaming/tool tests green and behavior identical.
4. Confirm the approval seam: CLI bus-based confirmation untouched; the `onApproval` sugar resolves correctly for headless callers.
5. Run full verification + smoke.

Parent: #1568. Blocks: #1594. Pairs with: #2033 (provider/profile composition relocation).
