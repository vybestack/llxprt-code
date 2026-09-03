# Issue 3526 Plan

## Accepted behavior

1. A non-interactive subagent with declared outputs sends exactly one callable `self_emitvalue` declaration on every provider request while required outputs are missing.
2. `BeforeToolSelection` allowlists continue to filter ordinary tools, but cannot remove the required scope-local `self_emitvalue` declaration.
3. Four native `self_emitvalue` calls populate four declared outputs and terminate with `GOAL` without a follow-up nudge.
4. Supported textual Hermes `self_emitvalue` calls resolve to the same scope-local handler and complete a four-output task.
5. The runtime verifies that effective provider declarations contain `self_emitvalue` before sending a missing-output nudge.
6. If required outputs remain and internal provisioning leaves the effective emitter absent, execution terminates once with `ERROR`. The error identifies `self_emitvalue` and the missing keys, preserves partial `emitted_vars`, and sends no nudge or additional provider request.
7. A successful case-insensitive `todo_pause` stops immediately without a later provider request or nudge. If required outputs remain, termination uses the existing `ERROR` mode, includes the missing keys in `final_message`, and does not report `GOAL`. If the same batch completed all required outputs first, or no outputs are required, termination reports `GOAL`.
8. A failed or malformed `todo_pause` remains nonterminal and returns its failure to the model.

## Scope boundaries

- Exercise no whitelist, empty whitelist, a populated ordinary-tool whitelist, hooks disabled, a hook without `allowedFunctionNames`, an allowlist that omits `self_emitvalue`, and an empty allowlist where each case adds behavioral evidence.
- Preserve existing behavior when no outputs are declared or the output map is empty.
- Missing-output nudges identify only missing keys after partial emission.
- Support output calls received together or across provider turns.
- Do not treat shell output as declared output emission.
- Preserve cancellation, timeout, output-budget, and max-turn behavior.
- Do not change unknown-output or duplicate-output validation.
- Do not add a public abstraction or termination enum.
- Do not modify dependencies, workflows, agent memory, quality tooling, or `.llxprt`.
- Stop implementation if satisfying the behavior requires an unplanned subsystem or public API change.

## Test-first sequence and behavioral mapping

| Evidence | Failing behavioral test | Implementation response |
| --- | --- | --- |
| A | Drive a real non-interactive runtime with four declared outputs and inspect the provider-bound request for exactly one correctly shaped `self_emitvalue`. Repeat only the setup variants needed to cover no whitelist, hooks disabled, and a hook without `allowedFunctionNames`. | Preserve one required scope-local declaration in the effective provider tool set while outputs are missing. |
| B | Drive `BeforeToolSelection` with populated and empty ordinary allowlists, including an allowlist that omits `self_emitvalue`; assert ordinary tools are filtered while one emitter remains. | Separate required scope-local declaration retention from ordinary-tool allowlist filtering. |
| C | Return four native emitter calls from provider infrastructure; assert four values, `GOAL`, and no follow-up nudge or request. | Route all native calls through the existing scope-local emitter and recognize completion in the same turn. |
| D | Return four supported Hermes textual emitter calls; assert the same outputs and completion behavior. | Resolve textual emitter calls against the scope-local declaration before ordinary registry lookup. |
| E | Drive a deliberate internal effective-emitter absence after partial emission; assert one specific `ERROR`, named missing keys, preserved partial values, no nudge, and no extra provider turn. | Add a fail-fast runtime invariant before missing-output nudging. |
| F | Emit two of four outputs, assert the nudge names only the remaining two, then emit those outputs and assert completion. | Derive nudge content from the remaining output keys and retain the emitter for the next request. |
| G | Return a successful mixed-case `todo_pause` while outputs remain; assert immediate `ERROR` termination with no later request or nudge and no `GOAL`. In a paired case, emit the final values before the pause in the same batch and assert immediate `GOAL`. | Treat successful non-interactive pause as terminal and derive `GOAL` versus `ERROR` from whether declared outputs are complete. |
| H | Return failed and malformed `todo_pause` results; assert the failure is included in the next model turn and execution continues. | Keep unsuccessful pause calls on the existing nonterminal tool-result path. |

Focused tests run after each red and green step. Final focused verification is logged under `tmp/verify3526/` and covers every touched agents file, focused ESLint, the agents package typecheck, and formatting. The foreground orchestrator owns the later full repository verification cycle.

## Review-finding triage

| Review finding | Classification | Reason and resolution |
| --- | --- | --- |
| 1. Successful `todo_pause` forced `ERROR` after the same batch emitted every required output. | **Blocker-Fix** | This violated accepted same-batch completion behavior. `processFunctionCalls` now determines missing required keys after earlier calls in the batch have executed and reports `GOAL` when none remain. The four-output same-batch behavior test passes. |
| 2. Effective-emitter validation required exactly one declaration instead of callable presence. | **In-scope-Fix** | The runtime invariant needs at least one callable declaration. Provisioning still produces exactly one declaration per provider request, while the validation now uses presence and does not misreport duplicate effective declarations as absence. |
| 3 and 7. Emitter name and normalization were duplicated, with the follow-up repeating the normalization concern. | **In-scope-Fix** | These are the same maintainability finding. The touched paths now share `SCOPE_LOCAL_EMIT_TOOL_NAME` from `toolGovernance.ts` and use `canonicalizeToolName` for effective-declaration and Hermes-resolution comparisons. Pre-existing user-facing instruction strings remain unchanged. |
| 4. `todo_pause` termination in `ERROR` lacked a useful `final_message`. | **In-scope-Fix** | Callers need the terminal reason and missing keys. The successful pause error path now sets a message naming `todo_pause` and only the missing required outputs before finalization. |
| 5. Prototype-chain properties in `emitted_vars` could satisfy required output keys. | **In-scope-Fix** | This produced false completion and made the touched pause and missing-emitter paths disagree with required-output checks. A bounded consistency correction uses own-property membership in `processFunctionCalls`, `dispatchNonInteractiveTurnResult`, and `checkGoalCompletion`. It does not alter unknown-output or duplicate-output validation. Tests cover pause termination, fail-fast missing-emitter termination, and the normal missing-output nudge for a prototype-name key. |
| 6 and 8. Successful `todo_pause` reported `ERROR` for no output configuration or an empty output map, with finding 8 restating the same vacuous-completion defect. | **Blocker-Fix** | These are the same termination bug and violate preserved output-less behavior. Completion now uses the missing-key set directly, so zero required keys produce `GOAL`. Separate behavior cases cover absent and empty output configurations. |
| 9. A tool-call batch that emitted every required value still sent its tool responses to the provider, so `GOAL` depended on a later no-tool response and could be replaced by `MAX_TURNS`. | **Blocker-Fix** | After processing a batch, dispatch now checks only a nonempty declared output set. If every declared key has been emitted, it sets `GOAL` and returns no continuation message. Native and Hermes four-value tests now require exactly one provider request, and the partial-emission test requires termination on request three, which contains the final values. The no-output and still-missing-output continuation tests pass. |
| 10. Cancelled `todo_pause` calls had no response `error` or `errorType`, so non-interactive execution treated scheduler status `cancelled` as success and terminated. | **Blocker-Fix** | The local execution result now carries `CompletedToolCall.status`, and pause termination requires `status === 'success'` in addition to absent response errors. A cancelled-result behavior test uses the scheduler cancellation response shape, verifies the failure reaches the next provider request, and completes only after that request emits the required values. Successful, failed-error, malformed, and cancellation-neighbor tests pass. |

No finding was rejected or deferred. Every accepted change is limited to issue 3526 completion, emitter availability, and required-key membership behavior.

## Prior verification-log disposition

`tmp/verify3526/npm-test-post-review.log` ends with the vscode companion summary and an explicit `Exit Code: 0` record. It therefore contains completion evidence for that prior full `npm run test` invocation. The final focused commands for this continuation are recorded separately and do not replace the foreground orchestrator's requested repository-wide verification.
