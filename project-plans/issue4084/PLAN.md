# Issue #4084: Opt-in code mode

## Status

- Phase A: done (runtime foundation and effective-argument authorization; see "Phase A record")
- Phase B: done (run owner, nested execution seam, `execute_tool_script` behind a construction flag, bundle packaging; see "Phase B record")
- Phase D: done (nested approvals in the CLI, fail-fast hosts, script card, `tool_script_event` recording and resume, script telemetry, default policy; see "Phase D record"). Done before Phase C on purpose: without it a nested approval in the CLI would wait forever once the setting exists.
- Phases C and E: pending

## Fixed decisions

- Keep the adapter private to `packages/agents`; no new workspace package or import from `packages/tools`/`packages/core` into agents. Use QuickJS-WASM in a dedicated Bun wrapper subprocess. There is no fallback runtime.
- Use JavaScript async function-body source, with a fresh QuickJS runtime/context for each execution. Tool calls use a typed JSON-only request/result contract over versioned framed IPC.
- Launch the trusted wrapper by absolute path with an explicit minimal environment, private stdio only, and kill/join it on timeout, abort, protocol error, or limit failure.
- The allowed child environment will be explicitly enumerated in the runtime implementation. No `HOME`, provider/API key, `LLXPRT_*`, proxy, credential socket/token, or SSH agent values cross the boundary.
- Apply memory and stack caps, cumulative CPU interrupt, host wall deadline, call and pending-call caps, per-response and cumulative guest-input bytes, console bytes, and final-result bytes. Named failures are part of the runtime contract; JSON output is rejected on serialization/depth/size failure, never clipped.
- Effective hook-adjusted arguments must be prepared once before the existing policy/approval path. Keep one immutable prepared invocation through confirmation and execution. Approval-edited arguments are rebuilt, validated, and authorized without a second BeforeTool run. Invalid rebuilds fail closed.
- Code mode does not register or advertise any model-facing tool in Phase A. The execute tool/run owner, declarations/settings/subagent wiring, UI/recording/telemetry and real-model tmux scenarios remain later phases.
- v1 callable tool surface, settings names/defaults, result completeness semantics, interactive/headless approval behavior, and acceptance criteria follow `tmp/codemode-dossier/issue-body.md`; the issue body takes precedence over dossier differences.

## Phases

### Phase A: foundation (done)

- Add this phased plan and map all issue acceptance criteria to owning phase and behavioral test file.
- Correct shared ToolExecutor ordering for effective-argument policy authorization; add direct-path regression tests, including approval-edited args and invalid hook rebuild behavior.
- Add `quickjs-emscripten` to `packages/agents`, privately implement the subprocess runtime/wrapper, framed IPC and bounded QuickJS guest environment.
- Add real subprocess + QuickJS behavioral tests, isolation and limits coverage, and source/build artifact resolution tests.
- Run the complete verification cycle, record results, and commit.

### Phase B: run owner and `execute_tool_script` (done)

Progress log (updated per milestone; read with `git status`/`git diff` after context loss):

- [x] B1 bundle packaging: `code-mode/quickjs-wasm.ts` (explicit wasm load), `scripts/bun-build.config.ts` (`quickjs-wrapper` target), `scripts/copy_bundle_assets.ts` (`stageQuickJsWasm`), test `scripts/tests/issue-4084-code-mode-bundle.bun.test.ts` (3 pass)
- [x] B2 tools contract: `tools/src/tools/tool-execution-scope.ts`, `tools.ts` (execute scope arg, `completeness`, `structuredOutput`), `shell-structured-output.ts` + shell/core streams, read-file/read-many-files/grep completeness, admission forwards arg 6
- [x] B3 scheduler: `scheduler/nested-execution.ts`, ToolExecutor builds scope, ResultAggregator `deliverResult`, options `onToolResult`/`nestedExecution`, `bindSchedulerOwner(..., { approval })`, hook text drops structuredOutput
- [x] B4 `code-mode/code-mode-run-owner.ts`, `nested-call-outcome.ts`
- [x] B5 `code-mode/execute-tool-script.ts`, `script-tool-surface.ts`
- [x] B6 registration: `AgentConfig.codeMode` -> policyComposition -> session-client-binding -> SessionClientOwner -> `SessionToolCatalogOwner(..., { codeMode })`; first end-to-end probe passes (tmp/verify4084/probe.test.ts)
- [x] B7 behavioral tests: `code-mode-run-owner.test.ts` (11), `code-mode-run-owner.policy.test.ts` (7), `code-mode-run-owner.lifecycle.test.ts` (7), `execute-tool-script-history.test.ts` (3), `execute-tool-script.test.ts` (3), `tools/src/tools/shell-structured-output.test.ts` (4), bundle test (3); all pass targeted
- [x] B8 verification (see "Phase B record"), commits

- Build per-invocation run ownership and FIFO nested-call broker with fresh child scheduler ownership, lifecycle cancellation, bounded results and no active-parent-scheduler reentry.
- Register/use `execute_tool_script` only behind opt-in capability and route each nested call through the ordinary scheduler, policy, hooks and approval path.
- Add exact request allowlist/preflight, nested call accounting, unawaited-call cleanup and programmatic result delivery.

See "Phase B record" below for what changed, decisions and follow-ups.

### Phase C: discovery, declarations, settings and subagents (pending)

- Implement `discover_tool_api`, schema-derived declarations and API revision checks.
- Add `code-mode` (`off|on`), tool-surface and bounded limit settings as application settings, not model parameters.
- Derive subagent script capabilities from that subagent's own profile and admitted tool selection.

### Phase D: UI, recording and telemetry (done)

- Add parent script card and nested execution presentation/approval details.
- Record typed operational script events without injecting nested results into model history; restore display on resume without re-execution.
- Add script lifecycle telemetry and apply existing prompt/data privacy controls.

Design (decided at the start of the phase):

- Approval reachability. A nested call may wait for a prompt only when someone can answer it: the session has an `onApproval` handler, or a child-tool display subscriber declared `answersApprovals` (the CLI's `useChildToolDisplay`). Otherwise the nested scheduler is built with prompts unavailable and an ASK ends the run with `APPROVAL_REQUIRED` at once. That covers non-interactive CLI, zed-acp and a2a (neither subscribes child tools nor passes `onApproval`) and programmatic hosts that only watch the stream.
- CLI path. The run owner forwards its nested scheduler callbacks (tool-call updates, live output, completion) to an execution opened on the session `ChildToolDisplay`, the same path subagent tools use. The CLI renders a waiting nested call with the ordinary confirmation UI, whose `onConfirm` belongs to the nested scheduler, so keys and "always allow" behave as for direct calls. Nested requests carry serializable `script: { parentCallId, runId, purpose }`; the CLI labels nested rows from it.
- Bounded display. Completed nested calls do not become separate history items; the parent `execute_tool_script` card (live output while running, `returnDisplay` when done) shows purpose, status, call counts, the last few calls, a bounded source preview and the result or error. One formatter (`formatToolScriptCard`) serves the live card, the final card and resume.
- Recording. Typed `tool_script_event` records (`started`, `call`, `finished`) published through the `ChildToolDisplay` hub and recorded by the facade. Replay collects them outside history; `session.getToolScriptRuns()` folds them for resume display.
- Telemetry. `ToolCallEvent` carries `parent_call_id`, `script_run_id`, `origin`; new `logToolScriptRun` event with lifecycle metrics, `purpose` only under `logPrompts`.
- Policy default. `execute_tool_script` and `discover_tool_api` get an ALLOW rule in the default `read-only.toml` (as `task` has) and `Kind.Think`; every nested call is still authorized on its own.

Progress log:

- [x] D1 core: `ToolCallScriptOrigin` (`turn.ts`), `recording/toolScriptEventPayload.ts`, `tool_script_event` in `types.ts`/`ReplayEngine.ts` (`toolScriptEvents`)/`SessionRecordingService.ts`/`RecordingIntegration.ts`, `services/tool-dispatch-admission.ts` (`withScriptDisplay` stays admission-bound), telemetry `ToolCallEvent` script fields, `ToolScriptRunEvent`, `logToolScriptRun` (+ core re-exports)
- [x] D2 agents: `session/childToolDisplay.ts` (subscription options, `answersApprovals`, `publishToolScriptEvent`), `scheduler/confirmation-coordinator.ts` + `core-tool-scheduler-options.ts` + `coreToolScheduler.ts` (`confirmationPromptsAvailable`), `scheduler/nested-execution.ts` + `session/assembleSchedulerOwner.ts` (per-run prompt availability, `logScriptRun`), `code-mode/script-run-journal.ts`, `code-mode/tool-script-card.ts`, run owner forwarding/journal, tool (`Kind.Think`, no own confirmation, live card, `withScriptDisplay`), `session/childToolAssembly.ts`, facade recorder subscription, `SessionControl.recordToolScriptEvent`/`getToolScriptRuns` (`api/control/sessionToolScriptRuns.ts`), API exports, `read-only.toml` (both copies)
- [x] D3 agents tests: `code-mode-approvals.test.ts` (6), `tool-script-events.test.ts` (4), `tool-script-card.test.ts` (4); existing code-mode files 31/31 still pass
- [x] D4 CLI: `runtime/interactiveToolScheduler.ts` (`answersApprovals: true`), `ui/types.ts` + `ui/hooks/toolMapping.ts` (`scriptOrigin`), `ToolGroupMessage.tsx` (script label row), `useAgentStreamLifecycle.ts` (nested completions stay in the card), `iContentToHistoryItems.ts` (resume card), `resumeOwnerSession.ts` and its callers, startup `--continue` path (`cli.tsx` -> `interactiveUI.tsx` -> `interactiveApplication*.ts` -> `AppContainerRuntime.tsx` -> `useAppBootstrap.ts`/`useBootstrapRuntime.ts`/`useSessionInitialization.ts`); tests `codeModeNestedApproval.test.tsx` (2), `ToolGroupMessage.codeMode.test.tsx` (2), `resumeOwnerSession.codeMode.test.ts` (1)
- [x] Lint budget fixes without touching limits: `api/control/sessionOpChain.ts` (op-chain mutex extracted from `sessionControl.ts`), script-run reads moved to `SessionRecordingLifetime`, `SubscribeChildTools` type alias, replay handler `collectToolScriptEvent` in `toolScriptEventPayload.ts`, `RecordingIntegration` enqueues directly (no new `SessionRecordingService` method), `buildRenderElement` takes a `ResumedDisplay` pick
- [x] `scripts/tmux-script.issue4084-nested-approval.llxprt.json`
- [x] D5 full verification, PLAN record, commit

### Phase E: tmux scenarios and evidence (pending)

- Run the issue's real-model scenarios A-I with `lunahigh`, including before/after comparisons and ground truth.
- Commit captures, artifacts and the evidence table under `project-plans/issue4084/evidence/`.
- Verify code mode off/on startup and complete the full verification cycle.

## Acceptance criteria map

Test file names below are planned owners; criteria move to done only when the named behavioral coverage exists and passes. Phase A rows name the files that now hold that coverage; `quickjs-process-runtime*.test.ts` means `quickjs-process-runtime.test.ts` (calls, results, isolation, startup), `quickjs-process-runtime.limits.test.ts` (each named limit, termination, cancellation) and `quickjs-process-runtime.protocol.test.ts` (IPC frame validation, orphan check).

| Issue acceptance criterion | Phase | Behavioral test file |
| --- | --- | --- |
| Code mode off by default registers/advertises neither tool and leaves behavior unchanged | C (B covers the construction flag) | B: `execute-tool-script-history.test.ts`: "lists the tool only when the agent enables code mode", "cannot run a script when code mode is off"; C: `packages/agents/src/code-mode/code-mode-registration.test.ts` for the setting |
| Code mode on exposes discover/execute; compact hides normal declarations without removing script authorization | C | `packages/agents/src/code-mode/code-mode-registration.test.ts` |
| Settings validate at admission, invalid values get clear errors, settings do not reach providers | C | `packages/settings/src/code-mode-settings.test.ts` |
| Guest cannot access environment, process, Bun, host globals, imports, fetch or filesystem; seeded credentials/socket stay hidden | A (done) | `quickjs-process-runtime.test.ts`: "gives the guest no host globals...", "fails a guest that touches host capabilities", "rejects dynamic module imports", "never exposes seeded credential values anywhere in the global object" |
| Child process has only enumerated environment and omits credential/capability values | A (done) | `quickjs-process-runtime.test.ts`: "starts the wrapper with an empty environment, ignoring workspace .env and bunfig preloads" |
| Infinite loop, deep recursion, memory blowup, microtask storm, unresolved promise, oversized/cyclic result and IPC flood terminate with named limits and no orphan | A (done) | `quickjs-process-runtime.limits.test.ts` (CPU_LIMIT, STACK_LIMIT, MEMORY_LIMIT, UNRESOLVED_PROMISE, RESULT_TOO_LARGE, RESULT_NOT_JSON, CALL_LIMIT, PENDING_LIMIT, ARGUMENTS_TOO_LARGE, INVALID_ARGUMENTS, INPUT_BYTES_LIMIT, CONSOLE_LIMIT, TIMEOUT, CANCELLED, SOURCE_TOO_LARGE); `quickjs-process-runtime.protocol.test.ts` (log-frame flood, oversized unterminated frame, malformed/duplicate/foreign frames). Every runtime test file asserts in `afterEach` that no wrapper process is still parented by the test process (`ps`), and one test proves that check detects a live wrapper |
| Runtime startup failure is a capability error with no outside-QuickJS evaluation fallback | A (done) | `quickjs-process-runtime.test.ts`: "fails with RUNTIME_UNAVAILABLE and evaluates nothing when the wrapper cannot start", "... when the wrapper exits without a result" |
| Direct and nested calls share policy decisions, including shell destructive checks | B (done) | `code-mode-run-owner.policy.test.ts`: "denies a destructive shell command directly and from a script, even under an allow rule", "asks for the same shell command directly and from a script, and allows reads without asking in both" |
| BeforeTool argument edits cannot execute values policy did not evaluate, on direct/nested paths | A (direct, done) / B (nested, done) | A: `packages/agents/src/core/coreToolScheduler.effective-args.test.ts`; B: `code-mode-run-owner.policy.test.ts`: "denies a nested call whose BeforeTool rewrite policy denies, and never runs it", "executes exactly the rewritten arguments policy allowed" |
| Script cannot call outside v1 set, request list, or caller selection | B (done) | `code-mode-run-owner.policy.test.ts`: "rejects names outside the v1 set, recursive and mutating tools, and tools the caller excluded", "rejects a script tool outside the caller allowlist"; `code-mode-run-owner.test.ts`: "fails a call to a tool the script did not list" |
| Recursive execute/discover, task calls are rejected | B (done) | `code-mode-run-owner.policy.test.ts`: preflight test (execute_tool_script, discover_tool_api, task, todo_write, save_memory, write_file, exa_web_search) |
| Interactive approval pauses/resumes; denial ends with completed-call summary | B (done) | `code-mode-run-owner.lifecycle.test.ts`: "pauses the script at a nested approval and resumes it when approved", "ends the run when an approval is refused, listing the calls that completed" |
| Call responses cannot cross run/session; late replies after cancellation are discarded | B (done for runs) | `code-mode-run-owner.lifecycle.test.ts`: "routes each approval only to its own run", "discards a late approval after an abort during the approval wait" (sessions have separate buses; no cross-session test) |
| Headless approval requirement fails without hanging | B (done) | `code-mode-run-owner.lifecycle.test.ts`: "fails a nested approval requirement fast in headless mode" |
| Abort during nested execution/approval leaves no subprocess or unjoined tool execution | B (done) | `code-mode-run-owner.lifecycle.test.ts`: "leaves no subprocess or running tool after an abort during nested execution", "discards a late approval after an abort during the approval wait" |
| Return with pending calls fails `UNAWAITED_TOOL_CALLS` after cancellation/join | A (runtime, done) / B (owner, done) | `quickjs-process-runtime.limits.test.ts`; `code-mode-run-owner.lifecycle.test.ts`: "fails with UNAWAITED_TOOL_CALLS after cancelling and joining the pending call" |
| Twenty nested calls create exactly one provider-visible tool response | B (done) | `execute-tool-script-history.test.ts`: "records twenty nested calls as exactly one provider-visible tool response" |
| Truncated producer output reaches guest as partial and final output preserves incompleteness | B (done) | `code-mode-run-owner.test.ts`: "marks a truncated read partial, and the run partial even if the script claims otherwise", "marks a search the tool cut at its match limit partial", "marks a multi-file read with a truncated file partial", "reports a window the script asked for as complete"; `packages/tools/src/tools/shell-structured-output.test.ts` (shell truncation) |
| Oversized final value returns `RESULT_TOO_LARGE`, without truncated JSON | A, B (done for the default cap; the setting is wired in C) | `quickjs-process-runtime.limits.test.ts`; `code-mode-run-owner.test.ts`: "returns RESULT_TOO_LARGE for an oversized final value without clipping it" |
| Resume restores card/events without executing script or unmatched model responses | D (done) | `tool-script-events.test.ts`: "records the run next to model history, which keeps one call and one response", "redraws a resumed run from its records without running the script again"; CLI `resumeOwnerSession.codeMode.test.ts`: "shows the recorded script card and does not run the script again" |
| Nested approvals reach the CLI confirmation flow, labelled with their script; approve/deny drive the run | D (done) | `code-mode-approvals.test.ts`: "shows the nested call as a waiting confirmation labelled with its script, and runs it once approved", "ends the run with APPROVAL_DENIED when the display refuses the nested call"; CLI `codeModeNestedApproval.test.tsx` (both cases, through `useToolSchedulerSetup` and the confirmation's own `onConfirm`); `ToolGroupMessage.codeMode.test.tsx`: "labels a waiting nested call with its script above the ordinary confirmation prompt" |
| Hosts that cannot answer nested approvals fail fast (headless, zed-acp, a2a, stream-only API hosts) | D (done) | `code-mode-approvals.test.ts`: "fails an interactive session with no approval handler and no answering display at once"; headless: `code-mode-run-owner.lifecycle.test.ts` "fails a nested approval requirement fast in headless mode" |
| One bounded parent card; nested live output forwarded | D (done) | `tool-script-card.test.ts` (64-call card has a fixed line count), `ToolGroupMessage.codeMode.test.tsx`: "keeps the card of a 64-call script to its listed calls"; `code-mode-approvals.test.ts`: "forwards nested live shell output to the child display" |
| Nested `logToolCall` with parent links; script lifecycle metrics; `logPrompts` gate | D (done) | `tool-script-events.test.ts`: "logs the nested call with its parent links and the run lifecycle, keeping text out without logPrompts", "exports the purpose, source and nested arguments only when logPrompts is on" |
| Default policy: script tool needs no confirmation; nested ASK still asks | D (done) | `code-mode-approvals.test.ts`: "runs a script of allowed reads in a headless session without any approval", "asks only for the nested shell command, never for the script tool itself" |
| Generated declarations compile for all v1 schemas and cover enums/unions/optional/arrays/string-key names | C | `packages/agents/src/code-mode/tool-declarations.test.ts` |
| API revision mismatch fails with `API_CHANGED` | C | `packages/agents/src/code-mode/tool-declarations.test.ts` |
| Enabled subagent runs code mode within own whitelist and agent attribution | C | `packages/agents/src/code-mode/code-mode-subagent.test.ts` |
| tmux scenarios with lunahigh, evidence and before/after table committed | E | `scripts/tmux-script.issue4084-*.llxprt.json` plus `project-plans/issue4084/evidence/README.md` |
| Required test/lint/typecheck/format/build and off/on lunahigh smoke checks pass | E | Verification commands recorded in this plan and CI evidence |

## Phase A record

### What changed

Runtime, private to `packages/agents/src/code-mode/` (not exported from the package index, not registered as a tool):

- `runtime-contract.ts`: host-facing types, the named error codes, `CodeModeLimits` with defaults, `ScriptRunTermination`, and validators for JSON values and nested-call results.
- `ipc-frames.ts`: versioned newline-delimited JSON frames (`start`, `result`, `call`, `log`, `complete`, `failure`). Each frame type has an exact key set and typed fields; anything else is a protocol violation. `LineFramer` bounds every line, including one that has not been terminated yet.
- `quickjs-process-runtime.ts`: `QuickJsProcessRuntime` and wrapper resolution. It spawns `process.execPath` with the wrapper path, an empty environment, the wrapper's own directory as working directory, and `--no-env-file` under Bun.
- `quickjs-host-session.ts`: host side of one run. Validates every wrapper frame, enforces the host-side limits, hands each accepted call to the invoke callback with a run-scoped `AbortSignal`, and settles only after the subprocess has closed and every invoke callback has settled.
- `quickjs-wrapper.ts`, `quickjs-guest.ts`, `guest-prelude.ts`: the trusted subprocess. One fresh QuickJS runtime and context per run, a prelude that captures intrinsics before guest code runs, and the guest event loop.

Shared scheduler (direct calls; the nested path reuses it in Phase B):

- `scheduler/tool-executor.ts`: `prepareDirect` / `prepareWithHook` build the prepared invocation; `execute(context, prepared)` runs exactly that invocation and no longer runs BeforeTool.
- `scheduler/prepare-tool-calls.ts`: prepares every validating call before policy evaluation; synchronous when there is no hook owner.
- `scheduler/rebuild-tool-call-arguments.ts`: approval edits are rebuilt, validated, authorized against policy and then replace the prepared invocation; it fails fast if the call was never prepared.
- `scheduler/confirmation-coordinator.ts`: `isEditedInvocationDenied`; after a ModifyWithEditor edit that policy denies, the coordinator finishes the batch instead of republishing a prompt for a call that can no longer run.
- `core/coreToolScheduler.ts`: keeps the prepared execution per call and passes it to `ToolExecutor.execute`.

Dependencies: `quickjs-emscripten` pinned to `0.32.0` in `packages/agents/package.json`. Both lockfiles are updated: `package-lock.json` (npm, used by `npm ci` in CI) and `bun.lock` (plain `bun install`; its diff only adds the quickjs entries).

### Decisions and reasons

- Defects found in the earlier uncommitted draft and fixed:
  - The wrapper ran with the session's working directory. Bun loads `.env` files and `bunfig.toml` preloads from the working directory (confirmed with a probe: a workspace `.env` value appeared in an `env -i` child, and a `bunfig.toml` preload ran). A workspace could therefore put values into the child environment or run code in the trusted wrapper. The wrapper now runs from its own directory with `--no-env-file`; a test plants both files in the current directory and checks that neither reaches the child.
  - The wrapper raced `iterator.next()` against a 10 ms timer and dropped any host result frame that arrived after the timer won. It now reads host frames through one persistent queue.
  - Budget violations (call count, pending calls, argument size, console) were delivered to the guest as catchable promise rejections. The issue says a budget violation ends the run. The wrapper now records the violation, the interrupt handler stops further guest execution, and tests show that `try/catch` cannot continue past it.
  - Console output was silently truncated, and more than 256 `console.log` calls made the host report `PROTOCOL_ERROR`. The wrapper now ends the run with `CONSOLE_LIMIT`; the host applies the same limits and treats only a wrapper that ignores them as a protocol violation.
  - A promise that nothing can settle waited for the wall deadline. With no queued jobs and no pending calls nothing can settle it, so the run now fails at once with `UNRESOLVED_PROMISE`.
  - When the host closed stdin, the wrapper spun until its own deadline. It now stops.
  - Frame size was checked only after a complete line had been buffered. `LineFramer` fails as soon as a line passes the limit, terminated or not.
  - Host bindings were briefly globals and the result serializer stayed reachable on `globalThis` (a non-writable property, so the attempt to clear it had no effect). The prelude is now a function that receives the bindings as arguments and returns its helpers; nothing extra is left on the global object.
  - Guest source was spliced into wrapper source text. It is now compiled with the `AsyncFunction` constructor captured before guest code runs.
  - Invoke callbacks were neither cancelled nor joined. Each call now gets the run's `AbortSignal`, and `run()` resolves only after every invoke promise has settled and the child has closed. This is what lets `UNAWAITED_TOOL_CALLS` mean "after cancelling and joining them".
  - Disposing the QuickJS runtime after a microtask storm aborted the wasm module (`JS_FreeRuntime` asserts on objects still held by queued jobs), which turned `CPU_LIMIT` into `RUNTIME_UNAVAILABLE`. The wrapper writes its terminal frame and exits without disposing; process exit releases the heap.
  - Limits were hard-coded in two places. They are now one `CodeModeLimits` value: runtime options, sent in the start frame, validated by the wrapper. Phase C wires the settings into it.
- Named failure codes: guest/wrapper side `CPU_LIMIT`, `MEMORY_LIMIT`, `STACK_LIMIT`, `CALL_LIMIT`, `PENDING_LIMIT`, `ARGUMENTS_TOO_LARGE`, `INVALID_ARGUMENTS`, `CONSOLE_LIMIT`, `RESULT_TOO_LARGE`, `RESULT_NOT_JSON`, `UNAWAITED_TOOL_CALLS`, `UNRESOLVED_PROMISE`, `SYNTAX_ERROR`, `SCRIPT_ERROR`, `PROTOCOL_ERROR`; host side `TIMEOUT`, `CANCELLED`, `SOURCE_TOO_LARGE`, `INPUT_BYTES_LIMIT`, `PROTOCOL_ERROR`, `RUNTIME_UNAVAILABLE`, `HOST_ERROR`, plus any code carried by a `ScriptRunTermination`. Cyclic, function, symbol, bigint and non-finite values get `RESULT_NOT_JSON` rather than the generic `SCRIPT_ERROR`, so the model can tell a bad return value from a crash.
- Invoke contract for Phase B: return `{ ok: true, value, completeness }` or `{ ok: false, error }` for ordinary tool outcomes (the script can handle them); reject with `ScriptRunTermination(code, message)` to end the run (policy denial, headless approval required, cancellation); any other rejection or a malformed result ends the run with `HOST_ERROR`. Calls must settle once their `signal` aborts, because the runtime joins them.
- Default limits: source 256 KiB, heap 64 MiB, stack 512 KiB, CPU 5 s, wall 300 s (the issue's default), 64 calls, 16 pending, 64 KiB per call's arguments, 1 MiB per response, 8 MiB cumulative input, 16 KiB / 256 lines of console, 16 KiB final result (the issue's default), result depth 64. CPU is generous because QuickJS string building is slow (a single `"x".repeat(1 MiB)` costs about 250 ms on this machine).
- Undefined in the final value follows `JSON.stringify` (dropped from objects, `null` in arrays), and a script with no `return` returns `null`.
- Effective arguments: BeforeTool now runs before policy for every validating call. Consequences, all intended by the issue: policy and the approval prompt see the rewritten arguments; a hook block now ends the call before an approval prompt rather than after; BeforeTool also runs for calls that policy then denies. Approval edits are not passed through BeforeTool again. An edit that policy denies becomes a `POLICY_VIOLATION` error; ASK on an edit needs no second prompt because the user who approved the prompt wrote the edit.

### Existing tests whose assertions changed

- `packages/agents/src/api/__tests__/recording-tool-hook-owner.behavior.test.ts`: the expected hook event order. BeforeTool now runs during preparation, before the approval prompt, while agent A's recording is still on. The old expectation (A's BeforeTool with an empty transcript path, after A's approval) encoded BeforeTool running after approval, the ordering the issue removes. The new expectation has A's BeforeTool with A's recording path, ahead of B's BeforeTool, and keeps A's AfterTool with the empty path because recording was turned off before A executed. Every other assertion in the test, including exactly one BeforeTool and one AfterTool per completed call, is unchanged.
- No other existing assertion changed. The earlier draft had rewritten the suggest-edit test ("execute with edited command") into a denial test; that test has no deny rule, so its success assertion did not encode unsafe ordering. It is restored unchanged, and the denial cases live in the new `coreToolScheduler.effective-args.test.ts`. The draft's new cases in `coreToolScheduler.hooks.characterization.test.ts` (which pushed that file over the 800-line limit) moved to the same new file. The draft's edits to six `readFile` test helpers were workarounds for a drifted `node_modules` (`@types/node` 24.19.2 installed while both lockfiles pin 24.13.2); `bun install` restored the locked version and those edits were reverted.
- The new effective-argument tests were also run against the HEAD versions of `coreToolScheduler.ts`, `tool-executor.ts` and `confirmation-coordinator.ts`: 7 of 8 fail there, and the one that passes is the regression guard for an allowed approval edit (`tmp/verify4084/phaseA-effective-args-on-HEAD.log`).

### New tests

- `packages/agents/src/code-mode/quickjs-process-runtime.test.ts` (16): nested calls and results (single call, sequential loop, out-of-order `Promise.all` answers, structured tool errors, console logs, `undefined` handling, frozen `tools` with only requested names, thrown errors, `SYNTAX_ERROR`) and isolation (typeof probes for `process`, `Bun`, `Deno`, `require`, `module`, `fetch`, `XMLHttpRequest`, `WebSocket`, timers, `queueMicrotask`, `std`, `os`, the seeded variable names and host binding names; access probes fail with `ReferenceError`; dynamic `import()`; a walk of the whole global object finds neither seeded value nor any `LLXPRT_` name; empty child environment with a workspace `.env` and `bunfig.toml` preload present; `RUNTIME_UNAVAILABLE` for a missing wrapper and for a wrapper that exits without a result, with no evaluation).
- `packages/agents/src/code-mode/quickjs-process-runtime.limits.test.ts` (22): every named limit, including that `CPU_LIMIT`, `CALL_LIMIT` and `CONSOLE_LIMIT` cannot be caught, that `PENDING_LIMIT`, `UNAWAITED_TOOL_CALLS`, `TIMEOUT` and `CANCELLED` abort and join the calls in flight, `ScriptRunTermination` codes, and `HOST_ERROR`.
- `packages/agents/src/code-mode/quickjs-process-runtime.protocol.test.ts` (10): a scripted stand-in wrapper (`__tests__/fixtures/scripted-wrapper.ts`) writes missing call IDs, unrequested tools, foreign run IDs, invalid JSON, unknown failure codes, duplicate call IDs, completion with an unanswered call, a log-frame flood and a 4 MiB unterminated frame; each ends in `PROTOCOL_ERROR` with the wrapper killed. One test proves the orphan check detects a live wrapper.
- `packages/agents/src/code-mode/quickjs-build-resolution.test.ts` (3): replaces the draft's `it.skipIf(!existsSync(dist))` test. It emits the code-mode sources with the TypeScript compiler into a scratch `dist/src/code-mode` package and runs a script end to end through the emitted runtime, so it never skips and does not depend on a prior build. The verification cycle also ran the real `npm run build` output (`tmp/verify4084/phaseA-built-runtime-probe.log`: `{"ok":true,"value":42,"callCount":1,"logs":[]}`).
- `packages/agents/src/core/coreToolScheduler.effective-args.test.ts` (8) with `core/__tests__/effective-args-fixture.ts` (real command hooks, real policy engine; BeforeTool appends to a log so runs are counted).

### Verification (2026-11-13, logs in `tmp/verify4084/`)

- `npm run test` (`phaseA-test.log`): every workspace passed except providers, 666/667 files. The failing file was `manifest-finite-contract.test.ts` > "loads actual local installed provider and MCP plugin contributions": `plugins/google-mcp-auth` had never been installed in this checkout (no `node_modules`), so plugin discovery skipped it. CI installs both plugins first (`cd plugins/<name> && bun install --frozen-lockfile --omit=peer`); after the same install here, `npm run test` in providers passed 667/667 (`phaseA-test-providers-rerun.log`). Unrelated to this change. Per-workspace results from the full run: tools 143/143, storage 39/39, auth 43/43, settings 33/33, telemetry 49/49, ide-integration 10/10, agent-core 3/3, policy 12/12, mcp 57/57, core 528/528, lsp 15/15, agents 865/865 plus 8/8, zed-acp 49/49, cli 1002/1002, a2a-server 26/26, test-utils 17/17, vscode-ide-companion 7/7.
- Targeted after the last test edit (`phaseA-targeted.log`): code mode, effective-argument, recording-hook, hooks characterization and suggest-edit files, 71 pass, 0 fail, 0 skipped.
- No orphan wrappers: `ps` after the full run listed no `quickjs-wrapper` or `scripted-wrapper` process (`phaseA-ps-after-tests.log` is empty).
- `npm run lint` (`phaseA-lint.log`): exit 0.
- `npm run typecheck` (`phaseA-typecheck.log`): exit 0.
- `npm run format` (`phaseA-format.log`): exit 0, no further changes.
- `npm run build` (`phaseA-build.log`): exit 0.
- `bun scripts/start.ts --profile-load lunahigh "write me a haiku and nothing else"` (`phaseA-smoke-lunahigh.log`): exit 0, printed a haiku from `lunahigh:gpt-6-luna`. Code mode has no setting yet, so the off/on smoke belongs to Phase C/E.

### Known follow-ups

- Bundled CLI: `packages/cli/bundle/llxprt.js` inlines the runtime module, so `resolveQuickJsWrapperPath` would look for `quickjs-wrapper.js` next to the bundle, where nothing emits it. Before Phase B registers `execute_tool_script`, add the wrapper as a separate bundle artifact (as the memprofile entries are) and test that the bundled CLI can run a script, including loading the QuickJS wasm from the bundle location. Resolved in Phase B.
- Phase B owner must map policy denial, headless approval-required and user cancellation to `ScriptRunTermination`, ordinary tool failures to `{ ok: false }`, and make each nested execution honour the call's `signal`, since `run()` joins every call. Done in Phase B.
- Phase C wires `code-mode-max-calls`, `code-mode-wall-timeout-ms` (bounded by the parent's deadline) and `code-mode-max-result-bytes` into `CodeModeLimits`, and subagent lowering.
- The ModifyWithEditor branch that finishes the batch after a denied editor edit has no automated test, because it needs an external editor; the shared rebuild-and-authorize path it relies on is covered by the suggest-edit and inline-modify denial tests.
- The orphan check in the runtime tests uses `ps`, which exists on the Linux and macOS runners that execute these tests; it would need a Windows equivalent if these tests ever run there.
- QuickJS string building is slow; revisit the 5 s CPU default against the Phase E scenarios.

## Phase B record

### What changed

Bundle packaging (Phase A follow-up 1):

- `code-mode/quickjs-wasm.ts`: the wrapper always loads the QuickJS wasm from an explicit file (`newVariant(RELEASE_SYNC, { wasmBinary })`). An unbundled wrapper (source or `dist`) resolves the wasm through `quickjs-emscripten`, which owns the variant dependency. The bundled wrapper is built with the `LLXPRT_BUNDLED_QUICKJS_WASM` define and reads the file staged next to it.
- `scripts/bun-build.config.ts`: new `quickjs-wrapper` CLI bundle target emitting `bundle/quickjs-wrapper.js` (same shared config, source-first plugin and externals as the other targets). The runtime inlined into `llxprt.js` already resolves `./quickjs-wrapper.js` next to the bundle.
- `scripts/copy_bundle_assets.ts`: `stageQuickJsWasm` stages `bundle/quickjs-release-sync.wasm` as a required asset.

Tools contract (`packages/tools`):

- `tools/tool-execution-scope.ts`: `ToolExecutionScope` (call ID, prompt ID, agent ID, `origin: 'model' | 'script'`, hook restrictions, host-only `nestedExecution` port) passed as the optional sixth argument of `ToolInvocation.execute`; `ToolOutputCompleteness`; `ToolStructuredOutput`.
- `ToolResult.completeness` and `ToolResult.structuredOutput`.
- `tools/approval-required-error.ts`: `ToolApprovalRequiredError`. The shell tool throws it when a non-interactive session would need a prompt; the scheduler's `ConfirmationRequiredError` now extends it.
- Shell: `tools/shell-structured-output.ts` adds `{ stdout, stderr, exitCode, streamsMerged }` and completeness from the execution result (core `ShellExecutionResult.streams`, set on the child_process path, carried by `CoreShellToolHostAdapter`). Scripts may not start background jobs (`origin: 'script'`).
- Completeness producers: `read_file` (`read-file.ts`), `read_many_files` (`read-many-files.ts`), `search_file_content` (`grep.ts`, `grep/search-completeness.ts`).
- Core `ToolDispatchAdmission` forwards the sixth `execute` argument.

Scheduler (`packages/agents/src/scheduler`, `core`):

- `scheduler/nested-execution.ts`: `ToolResultDelivery`/`ToolResultSink`, `NestedExecutionComposition`, `NestedExecutionPort`, `buildExecutionScope`.
- `ToolExecutor` builds the scope for every execution; `CoreToolSchedulerOptions` gain `onToolResult` and `nestedExecution`; `ResultAggregator.publishResult` hands the post-hook `ToolResult` to the sink before `convertToFunctionResponse`. The model path is unchanged.
- `bindSchedulerOwner(..., { approval })` builds the nested composition from the same options; its schedulers carry no composition. `SessionExecutionOwner` passes its approval handler. The default scheduler factory forwards the new options.
- When a hook appends text to a result, `structuredOutput` is dropped so the script sees the text actually produced.
- Core `ToolCallRequestInfo.script` (`parentCallId`, `runId`) marks nested requests.

Code mode (`packages/agents/src/code-mode`):

- `code-mode-run-owner.ts`: `CodeModeRunOwner`, one per invocation. Own `TurnToolExecutionOwner` (approval subscription limited to its call IDs) and `SessionSchedulerOwner` lease from the composition; FIFO broker; waits for terminal completion; `close()` closes admission, cancels queued calls, releases the lease (abort, `cancelAll`, join, dispose) and retires the approval subscription.
- `nested-call-outcome.ts`: maps a terminal nested call to the guest result or a `ScriptRunTermination`.
- `script-tool-surface.ts`: v1 callable set and preflight.
- `execute-tool-script.ts`: `ExecuteToolScriptTool`.

Root manifest: `quickjs-emscripten` 0.32.0 is now also a root dependency (`package.json`, `package-lock.json`, `bun.lock` root entries only). Phase A added it to `packages/agents` alone, which `scripts/tests/publish-integrity.test.ts` ("declares runtime dependencies needed by shipped workspace source") rejects; Phase A's verification ran `npm run test` but not the `test:scripts` shard where that test lives.

Registration: `AgentConfig.codeMode` (schema-validated boolean, default off) flows through `bindCreatedSessionClient` and `acquireSessionClient` to `SessionToolCatalogOwner(..., { codeMode })`, which registers the tool after the builtin registry is built. Off means not registered and not advertised.

### Decisions and reasons

- The scope travels as an `execute` argument, not a separate invocation method, because `ToolDispatchAdmission` routes `execute` through its accept/join tracking; a separate method would have bypassed the join.
- The port is an agents class checked with `instanceof`; a forged `{ kind: 'nested-tool-execution' }` object fails. Missing scope or port fails before any guest code runs.
- Nested calls never reenter the parent scheduler. Each nested call is its own scheduler batch. Completions reach the broker on the next macrotask because `CoreToolScheduler` accepts a new batch only after its completion callback returns, and requests it queues while busy are only removed by `cancelAll` (pre-existing behavior, not relied on).
- Guest results: `structuredOutput` when present, else `{ text }` from text-only `llmContent`; media gives `{ ok: false, error: { code: 'UNSUPPORTED_CONTENT' } }`. `completeness` defaults to `unknown`. Ordinary failures carry the tool error type upper-cased (for example `FILE_NOT_FOUND`).
- Run-ending outcomes: policy DENY gives `POLICY_DENIED`; a headless approval requirement (`ToolApprovalRequiredError`, including the shell tool's non-interactive refusal) gives `APPROVAL_REQUIRED`; a refused prompt gives `APPROVAL_DENIED`; an abort gives the runtime's `CANCELLED`. The guest cannot catch them.
- Completeness evidence: `read_file` is partial only when its own default line limit or line clipping cut the output; a window the caller asked for with `limit` is complete. `read_many_files` is partial when discovery, the file count, the byte budget or a per-file line limit cut it, otherwise `unknown` (skips such as ignored files make "complete" unprovable). `search_file_content` is partial when its `outputTruncation` metadata is set and complete otherwise; its single-file token-limited path now sets that metadata like the directory path. Shell is partial on acquisition truncation.
- Shell structured value adds `streamsMerged`: a PTY merges the streams, so the combined text is reported as stdout with `streamsMerged: true` instead of an empty stderr. Output filters apply to each stream.
- `execute_tool_script` is `Kind.Execute` and asks for confirmation ('info': purpose, tools, source preview) under the default policy. Approving it only starts the program; each nested call is still authorized. Headless use needs a policy allow for the script tool. (Superseded in Phase D: the script tool is `Kind.Think`, asks for no confirmation, and the default policy allows it.)
- `api_revision` is accepted and unchecked until Phase C adds discovery.
- Result JSON: `{ ok, value | error, callCount, partial, completedCalls, logs }`. `callCount` is the runtime's count of calls the guest made; `completedCalls` lists settled calls as `{ tool, status }` with status `ok | failed | denied | approval_required | cancelled`, bounded by the call limit; `logs` is bounded by the console limits.
- Nested call IDs are `<parentCallId>#script-<run>-<n>`.

### Known follow-ups

- (Resolved in Phase D.) Nested confirmations go to the session approval handler (`onApproval`) and are published on the message bus, but they are not projected into the agent stream's `tool-confirmation` events or the CLI tool display, because the parent scheduler's call list does not contain them. A host without an approval handler (the CLI) would wait. Phase D must show nested calls through a scoped child display (as `ChildToolDisplay` does for subagents) before Phase C exposes the `code-mode` setting. Nested live output is not forwarded yet either.
- Only the session loop's schedulers get the nested composition. Subagent schedulers, the client tool channel and `foreground-agent-assembly` do not, so the tool fails fast there; Phase C wires subagents.
- Hook-restricted turns share the preflight check, but no behavioral test drives a real tool-selection hook restriction yet.
- `CoreToolScheduler` never drains requests it queues while busy (only `cancelAll` empties the queue). Code mode does not depend on it; worth a separate issue.

### New tests

- `packages/agents/src/code-mode/code-mode-run-owner.test.ts` (11): one nested read, loop, `Promise.all` serialized in call order (shell commands append start/end markers), shell `{ stdout, stderr, exitCode }`, truncated `read_file`/`search_file_content`/`read_many_files` reach the guest as partial and set the host `partial` flag even when the script returns `partial: false`, a requested window is complete, `RESULT_TOO_LARGE`, a call to an unlisted tool fails, an ordinary tool failure is `{ ok: false }`.
- `code-mode-run-owner.policy.test.ts` (7): destructive shell DENY directly and from a script under an allow rule, ASK directly and from a script with reads allowed without asking in both, BeforeTool rewrite denied on effective arguments and never executed, rewritten arguments executed exactly, AfterTool text replaces the typed value, preflight rejections, allowlist rejection.
- `code-mode-run-owner.lifecycle.test.ts` (7): approval pauses and resumes, refusal ends the run with completed calls, per-run approval routing with two concurrent runs, headless approval requirement, abort during execution (no wrapper, no `sleep` child), late approval after abort discarded, `UNAWAITED_TOOL_CALLS` with the pending shell command killed.
- `execute-tool-script-history.test.ts` (3): twenty nested calls give exactly one `tool_call` and one `tool_response` in model history; the tool is listed only with `codeMode`; a call with code mode off fails as unregistered.
- `execute-tool-script.test.ts` (3): no scope, or a forged port, fails before the runtime runs; `api_revision` optional.
- `packages/tools/src/tools/shell-structured-output.test.ts` (4) and `scripts/tests/issue-4084-code-mode-bundle.bun.test.ts` (3: separate artifacts, end-to-end run from a bundled layout without `node_modules`, the staged wasm is the one loaded).
- Helper `code-mode/__tests__/script-agent.ts`: a real public `Agent` (`createAgent` through the `LLXPRT_FAKE_RESPONSES` FakeProvider seam) with `codeMode: true` over a temp workspace. Every afterEach checks that no wrapper process is left.

No existing test assertion changed.

### Verification (2026-11-13, logs in `tmp/verify4084/`)

- `npm run test` (`phaseB-test.log`): every workspace passed. tools 144/144, storage 39/39, auth 43/43, settings 33/33, telemetry 49/49, ide-integration 10/10, agent-core 3/3, policy 12/12, mcp 57/57, core 528/528, lsp 15/15, providers 667/667, agents 870/870 plus 8/8, zed-acp 49/49, cli 1002/1002, a2a-server 26/26, test-utils 17/17, vscode-ide-companion 7/7. (The `(fail)` lines in core are the runner's own fixture files that are meant to fail.)
- No wrapper process left after the run (`phaseB-ps-after-tests.log` is empty).
- `npm run lint` (`phaseB-lint.log`): exit 0. `npm run typecheck` (`phaseB-typecheck.log`): exit 0. `npm run format` (`phaseB-format.log`): exit 0, no further changes. `npm run build` (`phaseB-build.log`): `BUILD_EXIT=0`.
- Built output: the emitted `dist` runtime ran a script (`phaseB-built-runtime-probe.log`: `{"ok":true,"value":42,"callCount":1,"logs":[]}`).
- Real CLI bundle: `bun scripts/bun-build.config.ts --cli-only` (`phaseB-bundle.log`, `BUNDLE_EXIT=0`) emitted `llxprt.js`, `quickjs-wrapper.js` and `quickjs-release-sync.wasm`; the real bundled wrapper ran a script (`phaseB-real-bundle-wrapper-probe.log`: `{"ok":true,"value":42,"callCount":1,"logs":[]}`).
- Bundle tests (`phaseB-bundle-tests.log`): issue-4084 bundle, release-source-emitted-sibling-resolution, issue-3068, issue-3055 purity and externals ownership: 22 pass, 0 fail.
- `npm run test:scripts`, first run (`phaseB-test-scripts.log`): 364/366 files passed, 4 failing tests in 2 files. `publish-integrity.test.ts` (root manifest, fixed above; 19/19 after the fix). Three `bun-test-tree-join.bun.test.ts` "post-close query" cases failed with `EPERM` from a process-group kill under load; the file passes 19/19 alone in this tree (`phaseB-tree-join-rerun.log`) and on HEAD (`phaseB-tree-join-on-HEAD.log`) and does not touch code mode. Rerun after the manifest fix (`phaseB-test-scripts-rerun.log`): 365/366 files passed; `publish-integrity` and `bun-test-tree-join` passed; the one failure was `scripts-quality-coverage.test.ts` "applies maintainability/complexity rules to a converted .ts script" hitting its 30 s timeout while ESLint ran under load, and that file passes 9/9 alone (`phaseB-scripts-quality-rerun.log`). Neither flaky file is touched by this phase.
- `bun scripts/start.ts --profile-load lunahigh "write me a haiku and nothing else"` (`phaseB-smoke-lunahigh.log`): exit 0, haiku printed. Code mode has no setting yet, so the off/on smoke stays in Phase C/E.


### Commits

- `41a303f692` feat(tools): give scheduled executions a scope and programmatic results (#4084)
- `ad37770a81` build(cli): ship the code mode wrapper and QuickJS wasm as bundle artifacts (#4084)
- feat(agents): run code mode scripts through a nested scheduler owner (#4084) (the commit that adds this record)

## Phase D record

### What changed

Approvals (Phase B follow-up 1, the blocker):

- `ChildToolDisplay` (`session/childToolDisplay.ts`) takes a subscription option `answersApprovals`. The interactive CLI's `useChildToolDisplay` subscribes with it, because it renders a waiting child call's confirmation and answers it through that call's own `onConfirm`. `ChildToolDisplay.answersApprovals()` reports whether any such subscriber exists. `Agent.tools.subscribeChildTools(callbacks, options?)` is typed by `SubscribeChildTools`.
- `CodeModeRunOwner` opens an execution on the session's child display for each run and forwards its nested scheduler's call updates, live output and completions there, the same path subagent tool calls use. The CLI therefore shows a waiting nested call with the ordinary confirmation UI and keys; "allow always" goes through the same `onConfirm`/policy update path as a direct call. Nested requests carry the serializable `ToolCallScriptOrigin { parentCallId, runId, purpose }` (core `turn.ts`); the CLI maps it to `IndividualToolCallDisplay.scriptOrigin` and draws a "↳ from script: <purpose>" label above the row.
- A nested call may wait for approval only when someone can answer: the session has an `onApproval` handler, or a child display subscriber answers approvals. Otherwise the run's scheduler is built with `confirmationPromptsAvailable: false` (`CoreToolSchedulerOptions` -> `ConfirmationCoordinator`), and an ASK raises `ConfirmationRequiredError`, which the run maps to `APPROVAL_REQUIRED` at once. Hosts checked: non-interactive CLI (already `isInteractive() === false`), zed-acp and a2a-server (neither passes `onApproval` nor subscribes child tools; verified by search), API hosts that only consume the stream. YOLO approval mode still approves before any prompt.
- The display's completion callback is not awaited by the broker (the nested scheduler accepts the next call only after its completion callback returns); a failure there is logged, like the agentic loop's own display callback.

Display:

- `code-mode/tool-script-card.ts`: `ToolScriptRunView` (folded run state), `applyToolScriptEvent`, `foldToolScriptEvents`, `formatToolScriptCard`. One formatter for the live card (`execute_tool_script` streams it as `replace` live output), the final `returnDisplay`, and the resumed card. It shows purpose, status (running, completed with duration and partial flag, or failed with the named code), call count by status, the last 8 calls with bounded argument summaries, the first 8 source lines, and a bounded result excerpt. However many calls a run makes, the card is at most 23 lines.
- Finished nested calls do not become separate CLI history items (`processSecondaryCompletion` skips calls with `request.script`); the parent card summarizes them.

Recording and resume:

- `tool_script_event` (`SessionEventType`), payload schema in `core/src/recording/toolScriptEventPayload.ts`: `started` (run ID, parent call ID, agent ID, purpose, tools), one `call` per nested call (sequence, call ID, tool, argument summary up to 240 chars, approval outcome `not_required | approved | denied | unavailable`, status, completeness, result bytes), `finished` (ok, error code and bounded message, call count, partial, input bytes, final bytes, duration). The source is not repeated; it is the recorded `execute_tool_script` argument.
- `ScriptRunJournal` (`code-mode/script-run-journal.ts`) emits the records through `ChildToolDisplay.publishToolScriptEvent`; the facade subscribes the session recording (`SessionControl.recordToolScriptEvent` -> `RecordingIntegration.recordToolScriptEvent` -> enqueue). The records do not materialize the file and are written with the turn's flush.
- Replay collects valid records in `ReplayResult.toolScriptEvents` (malformed ones count as malformed lines with a warning); history is untouched. `session.getToolScriptRuns()` folds the active session file's records. The CLI passes them to `iContentToHistoryItems`, which shows an `execute_tool_script` call with a recorded run as its script card. Covered paths: `/chat resume`/session browser (`resumeOwnerSession`) and startup `--continue` (`cli.tsx` -> `resumedToolScriptRuns`). The raw (non-agent) recording owner path is unchanged.

Telemetry:

- `ToolCallEvent` gains `origin: 'script'`, `parent_call_id` and `script_run_id` for nested calls (absent for direct calls); `agent_id` is the caller's, already carried by the nested request. Nested executions log through the existing `logToolCall` in their own scheduler.
- `ToolScriptRunEvent` / `logToolScriptRun` (`llxprt_code.tool_script_run`): duration, nested call count, input bytes (results handed to the guest), final bytes, partial, success, termination reason (`completed` or the named code), parent and run IDs, agent ID. `purpose` is exported only with `logPrompts`; the source and nested arguments are `function_args`, which `logToolCall` already gates.

Policy default (orchestrator decision): `execute_tool_script` is `Kind.Think` and no longer asks for its own confirmation, and both `execute_tool_script` and `discover_tool_api` have an ALLOW rule in the default `read-only.toml` (both copies, as `task` has). They perform no effect themselves and every nested call is authorized, and where policy asks, approved on its own. A policy rule can still deny them.

### Decisions and reasons

- Prompt availability is decided per run, from the composition's approval handler and the display's answering subscribers, rather than per host type. A host that adds an answering display later gets nested prompts without code-mode changes; one that does not can never hang.
- Nested calls render as rows in the live tool group (with the script label) and the parent card stays the only history item after the run. A nested-children tree inside the parent card was not built: the existing tool group already renders confirmation details, and duplicating that renderer inside the card would split approval handling into two places.
- Recording goes through the child display hub instead of passing the recording into the tool: the tool stays free of session plumbing, and the same records feed any other observer.
- Records are enqueued without a per-event durable flush, like history content; a turn's flush writes them.
- The approval outcome of a call that waited for a prompt is `approved` when it then ran (success or tool error) and `denied` otherwise.

### Lint budget changes (no limit changed)

- `api/control/sessionOpChain.ts`: the session op-chain mutex moved out of `sessionControl.ts`; `runExclusive` and `dispose` use it. Behavior is unchanged (same chain, same admission check).
- Script-run reads live on `SessionRecordingLifetime`; `SessionControl` takes `mediaStore` as a parameter property and imports core types in one statement.
- `SubscribeChildTools` type alias keeps `agent.ts` within its line limit; `collectToolScriptEvent` keeps `ReplayEngine.ts` within its limit; `RecordingIntegration` enqueues directly so `SessionRecordingService.ts` is untouched; `buildRenderElement` takes a `ResumedDisplay` pick.

### Existing tests changed

- Callers of `resumeOwnerSession` gained the new `readToolScriptRuns` argument (`resumeOwnerSession.test.ts`, `ownerSessionUi.test.ts`, `ownerSessionBrowser.test.ts`, `ownerSessionUnreadable.test.ts`, `command-resume-owner.behavior.test.ts`, `recording-transcript-owner.test.tsx`, `browser-resume-owner.behavior.test.tsx`, `history-operation-owner.behavior.test.ts`, `__tests__/command-history-result-fixture.ts`, `ui/__tests__/app-bootstrap-owner-props.ts`). No assertion changed.
- `code-mode/__tests__/script-agent.ts` gained `defaultScriptPolicy` to build an agent without the explicit script allow rule.

### New tests

- `packages/agents/src/code-mode/code-mode-approvals.test.ts` (6), `tool-script-events.test.ts` (4), `tool-script-card.test.ts` (4).
- `packages/cli/src/ui/hooks/agentStream/codeModeNestedApproval.test.tsx` (2), `packages/cli/src/ui/components/messages/ToolGroupMessage.codeMode.test.tsx` (2), `packages/cli/src/ui/utils/resumeOwnerSession.codeMode.test.ts` (1).
- `scripts/tmux-script.issue4084-nested-approval.llxprt.json`: real-model (`lunahigh`) scenario that waits for the labelled nested prompt, approves once, and checks the completed card. It starts the CLI with `--set code-mode=on`, which only works once Phase C registers the setting; it was not run in this phase. The fake-provider path for the same UI flow is `codeModeNestedApproval.test.tsx` (the CLI's own scheduler hook over a real agent).

### Root API surface

`formatToolScriptCard` and `ToolScriptRunView` are new root exports of `@vybestack/llxprt-code-agents` (the CLI draws resumed cards with them), recorded in `api/__tests__/expected-root-surface.json`. No other export was added.

### Verification (2026-11-14, logs in `tmp/verify4084/`)

- `npm run test` (`phaseD-test.log`): tools 144/144, storage 39/39, auth 43/43, settings 33/33, telemetry 49/49, ide-integration 10/10, agent-core 3/3, policy 12/12, mcp 57/57, core 528/528, lsp 15/15, providers 667/667, zed-acp 49/49, cli 1005/1005, a2a-server 26/26, test-utils 17/17, vscode-ide-companion 7/7. Agents did not run: its `pretest` API-surface guard reported the new root exports (then five: two type re-exports of `ChildToolDisplay` types and `ToolScriptCardContent` were not needed and were removed; the two the CLI uses were added to the snapshot). Agents rerun (`phaseD-test-agents.log`): surface guard PASS, 873/873 plus 8/8, exit 0.
- No wrapper process left after the runs (`phaseD-ps-after-tests.log` is empty).
- `npm run test:scripts` (`phaseD-test-scripts.log`): 366/366 plus 2/2, exit 0.
- `npm run lint` (`phaseD-lint.log`): exit 0 (the later `api/index.ts` export change was linted and format-checked on its own).
- `npm run typecheck` (`phaseD-typecheck.log`): exit 0.
- `npm run format` (`phaseD-format.log`): exit 0, no file changed (`phaseD-status-before-format.txt` equals `phaseD-status-after-format.txt`).
- `npm run build` (`phaseD-build.log`): exit 0.
- `bun scripts/start.ts --profile-load lunahigh "write me a haiku and nothing else"` (`phaseD-smoke-lunahigh.log`): exit 0, haiku printed by `lunahigh:gpt-6-luna`.
- Targeted runs while iterating: `phaseD-approvals.log`, `phaseD-events.log`, `phaseD-agents-targeted.log` (115/115), `phaseD-core-targeted.log` (978/978), `phaseD-telemetry-targeted.log` (801/801), `phaseD-cli-targeted.log` (15 files, one process each, all pass).

### Known follow-ups

- Run the tmux script after Phase C adds the `code-mode` setting (Phase E evidence).
- zed-acp and a2a cannot show nested approvals; they fail fast with `APPROVAL_REQUIRED`. Surfacing nested confirmations in those hosts (as separate permission requests labelled with the script) is a possible later improvement, not required by the issue.
- The raw (non-agent) recording owner resume path does not redraw script cards; it shows the recorded JSON response as before.
- Subagent schedulers still lack the nested composition (Phase C).

### Commits

- `133a5c2733` feat(core): record code mode script events and script lifecycle telemetry (#4084)
- `fd169e3f72` feat(agents): show nested script approvals, script cards and resumed runs (#4084)
