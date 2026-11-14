# Issue #4084: Opt-in code mode

## Status

- Phase A: done (runtime foundation and effective-argument authorization; see "Phase A record")
- Phases B-E: pending

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

### Phase B: run owner and `execute_tool_script` (pending)

- Build per-invocation run ownership and FIFO nested-call broker with fresh child scheduler ownership, lifecycle cancellation, bounded results and no active-parent-scheduler reentry.
- Register/use `execute_tool_script` only behind opt-in capability and route each nested call through the ordinary scheduler, policy, hooks and approval path.
- Add exact request allowlist/preflight, nested call accounting, unawaited-call cleanup and programmatic result delivery.

### Phase C: discovery, declarations, settings and subagents (pending)

- Implement `discover_tool_api`, schema-derived declarations and API revision checks.
- Add `code-mode` (`off|on`), tool-surface and bounded limit settings as application settings, not model parameters.
- Derive subagent script capabilities from that subagent's own profile and admitted tool selection.

### Phase D: UI, recording and telemetry (pending)

- Add parent script card and nested execution presentation/approval details.
- Record typed operational script events without injecting nested results into model history; restore display on resume without re-execution.
- Add script lifecycle telemetry and apply existing prompt/data privacy controls.

### Phase E: tmux scenarios and evidence (pending)

- Run the issue's real-model scenarios A-I with `lunahigh`, including before/after comparisons and ground truth.
- Commit captures, artifacts and the evidence table under `project-plans/issue4084/evidence/`.
- Verify code mode off/on startup and complete the full verification cycle.

## Acceptance criteria map

Test file names below are planned owners; criteria move to done only when the named behavioral coverage exists and passes. Phase A rows name the files that now hold that coverage; `quickjs-process-runtime*.test.ts` means `quickjs-process-runtime.test.ts` (calls, results, isolation, startup), `quickjs-process-runtime.limits.test.ts` (each named limit, termination, cancellation) and `quickjs-process-runtime.protocol.test.ts` (IPC frame validation, orphan check).

| Issue acceptance criterion | Phase | Behavioral test file |
| --- | --- | --- |
| Code mode off by default registers/advertises neither tool and leaves behavior unchanged | C | `packages/agents/src/code-mode/code-mode-registration.test.ts` |
| Code mode on exposes discover/execute; compact hides normal declarations without removing script authorization | C | `packages/agents/src/code-mode/code-mode-registration.test.ts` |
| Settings validate at admission, invalid values get clear errors, settings do not reach providers | C | `packages/settings/src/code-mode-settings.test.ts` |
| Guest cannot access environment, process, Bun, host globals, imports, fetch or filesystem; seeded credentials/socket stay hidden | A (done) | `quickjs-process-runtime.test.ts`: "gives the guest no host globals...", "fails a guest that touches host capabilities", "rejects dynamic module imports", "never exposes seeded credential values anywhere in the global object" |
| Child process has only enumerated environment and omits credential/capability values | A (done) | `quickjs-process-runtime.test.ts`: "starts the wrapper with an empty environment, ignoring workspace .env and bunfig preloads" |
| Infinite loop, deep recursion, memory blowup, microtask storm, unresolved promise, oversized/cyclic result and IPC flood terminate with named limits and no orphan | A (done) | `quickjs-process-runtime.limits.test.ts` (CPU_LIMIT, STACK_LIMIT, MEMORY_LIMIT, UNRESOLVED_PROMISE, RESULT_TOO_LARGE, RESULT_NOT_JSON, CALL_LIMIT, PENDING_LIMIT, ARGUMENTS_TOO_LARGE, INVALID_ARGUMENTS, INPUT_BYTES_LIMIT, CONSOLE_LIMIT, TIMEOUT, CANCELLED, SOURCE_TOO_LARGE); `quickjs-process-runtime.protocol.test.ts` (log-frame flood, oversized unterminated frame, malformed/duplicate/foreign frames). Every runtime test file asserts in `afterEach` that no wrapper process is still parented by the test process (`ps`), and one test proves that check detects a live wrapper |
| Runtime startup failure is a capability error with no outside-QuickJS evaluation fallback | A (done) | `quickjs-process-runtime.test.ts`: "fails with RUNTIME_UNAVAILABLE and evaluates nothing when the wrapper cannot start", "... when the wrapper exits without a result" |
| Direct and nested calls share policy decisions, including shell destructive checks | B | Planned: `packages/agents/src/scheduler/tool-executor-policy.test.ts`; `packages/agents/src/code-mode/code-mode-run-owner.test.ts` |
| BeforeTool argument edits cannot execute values policy did not evaluate, on direct/nested paths | A (direct, done) / B (nested) | A: `packages/agents/src/core/coreToolScheduler.effective-args.test.ts` (rewrite DENY, ALLOW-for-original does not cover rewrite, exact rewritten args executed, invalid rewrite fails, approval shows rewritten args, approval edits authorized, BeforeTool once); B nested parity: planned `packages/agents/src/code-mode/code-mode-run-owner.test.ts` |
| Script cannot call outside v1 set, request list, or caller selection | B | `packages/agents/src/code-mode/code-mode-run-owner.test.ts` |
| Recursive execute/discover, task calls are rejected | B | `packages/agents/src/code-mode/code-mode-run-owner.test.ts` |
| Interactive approval pauses/resumes; denial ends with completed-call summary | B | `packages/agents/src/code-mode/code-mode-run-owner.test.ts` |
| Call responses cannot cross run/session; late replies after cancellation are discarded | B | `packages/agents/src/code-mode/code-mode-run-owner.test.ts` |
| Headless approval requirement fails without hanging | B | `packages/agents/src/code-mode/code-mode-run-owner.test.ts` |
| Abort during nested execution/approval leaves no subprocess or unjoined tool execution | B | `packages/agents/src/code-mode/code-mode-run-owner.test.ts` |
| Return with pending calls fails `UNAWAITED_TOOL_CALLS` after cancellation/join | A (runtime, done) / B (owner) | `quickjs-process-runtime.limits.test.ts`: "fails with UNAWAITED_TOOL_CALLS after aborting and joining the pending call"; owner cleanup in `code-mode-run-owner.test.ts` |
| Twenty nested calls create exactly one provider-visible tool response | B | `packages/agents/src/code-mode/execute-tool-script-history.test.ts` |
| Truncated producer output reaches guest as partial and final output preserves incompleteness | B | `packages/agents/src/code-mode/code-mode-run-owner.test.ts` |
| Oversized final value returns `RESULT_TOO_LARGE`, without truncated JSON | A (done for the runtime cap; the setting is wired in C) | `quickjs-process-runtime.limits.test.ts`: "returns RESULT_TOO_LARGE for an oversized or overly deep value instead of clipping it", "keeps the size check effective after the guest tampers with intrinsics" |
| Resume restores card/events without executing script or unmatched model responses | D | `packages/agents/src/code-mode/script-event-resume.test.ts` |
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

- Bundled CLI: `packages/cli/bundle/llxprt.js` inlines the runtime module, so `resolveQuickJsWrapperPath` would look for `quickjs-wrapper.js` next to the bundle, where nothing emits it. Before Phase B registers `execute_tool_script`, add the wrapper as a separate bundle artifact (as the memprofile entries are) and test that the bundled CLI can run a script, including loading the QuickJS wasm from the bundle location.
- Phase B owner must map policy denial, headless approval-required and user cancellation to `ScriptRunTermination`, ordinary tool failures to `{ ok: false }`, and make each nested execution honour the call's `signal`, since `run()` joins every call.
- Phase C wires `code-mode-max-calls`, `code-mode-wall-timeout-ms` (bounded by the parent's deadline) and `code-mode-max-result-bytes` into `CodeModeLimits`, and subagent lowering.
- The ModifyWithEditor branch that finishes the batch after a denied editor edit has no automated test, because it needs an external editor; the shared rebuild-and-authorize path it relies on is covered by the suggest-edit and inline-modify denial tests.
- The orphan check in the runtime tests uses `ps`, which exists on the Linux and macOS runners that execute these tests; it would need a Windows equivalent if these tests ever run there.
- QuickJS string building is slow; revisit the 5 s CPU default against the Phase E scenarios.
