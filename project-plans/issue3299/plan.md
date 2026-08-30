# Issue #3299: Restore policy updates and complete mixed approval batches

## Scope

This issue fixes two approval-flow failures and no adjacent behavior:

1. The foreground CLI must subscribe its session policy engine to `UPDATE_POLICY` messages on the Agent-owned session bus.
2. Cancelling an awaiting call must re-evaluate a mixed batch so approved siblings are not left in `scheduled` forever.

The existing policy rule format, persistence format, confirmation UI, shell-tool allowlist, and batch execution policy remain unchanged.

## Accepted behavior

### AC1: Foreground CLI policy updates use the live session objects

**Given** the foreground CLI has created an Agent from a Config with a policy engine,
**when** the Agent is returned from `createForegroundAgent`,
**then** `createPolicyUpdater` is attached to that Config policy engine and the exact MessageBus exposed by `agent.getMessageBus()`.

Behavioral proof:

- Before startup wiring, an `UPDATE_POLICY` message for a tool does not change the engine's decision.
- After foreground Agent creation, publishing that message changes the matching tool decision to `ALLOW`.
- An unrelated tool remains governed by its prior decision.

Boundary: do not construct a second MessageBus or policy engine. Missing required runtime objects are startup contract violations and must not be swallowed.

### AC2: “Allow for this session” affects a later matching call

**Given** a policy-bus tool initially requires confirmation,
**when** its first call is approved with `ProceedAlways` and publishes a non-persistent policy update,
**then** a later matching call in the same session executes without another confirmation request.

Boundaries:

- `ProceedOnce` remains limited to the current call.
- The dynamic rule remains scoped by the existing `toolName`, `argsPattern`, and `commandPrefix` semantics.
- The change does not replace or modify the shell tool's instance allowlist.

### AC3: “Allow for all future sessions” reaches existing persistence

**Given** a policy-bus tool publishes `UPDATE_POLICY` with `persist: true`,
**when** the foreground subscriber receives it,
**then** the dynamic rule applies immediately and the existing `persistPolicyToToml` path writes the rule for later sessions.

Proof is compositional: the new startup integration test proves the live subscriber is installed; existing core persistence tests prove a persistent update received by that subscriber writes the TOML rule. No persistence format or file-handling change is in scope.

### AC4: Cancelling the last awaiting call releases approved siblings

**Given** one or more calls in a batch are `scheduled` after approval and one call remains `awaiting_approval`,
**when** the remaining awaiting call is cancelled,
**then** the cancelled call reaches `cancelled`, every scheduled sibling executes, and `onAllToolCallsComplete` receives a batch in which every call has exactly one terminal status (`success`, `error`, or `cancelled`).

### AC5: Cancelling before the last decision does not start the batch early

**Given** a batch contains a scheduled call and at least two awaiting calls,
**when** one awaiting call is cancelled but another still awaits a decision,
**then** the scheduled call remains gated. Once the final awaiting call is cancelled, the scheduled call executes and the batch completes.

This preserves the existing all-decisions-before-execution behavior.

### AC6: Compatible ProceedAlways cascades still complete after an incompatible sibling is cancelled

**Given** `ProceedAlways` schedules compatible pending siblings while an incompatible call remains awaiting approval,
**when** the incompatible call is cancelled,
**then** all scheduled compatible calls execute, the incompatible call remains cancelled, and the batch completion callback fires with terminal states for all calls.

## Test-first implementation

1. Add a failing foreground-bootstrap test using a real policy engine and MessageBus. Publish `UPDATE_POLICY` through the Agent-exposed bus and observe policy decisions.
2. Add a failing sequential scheduler test for a policy-bus tool: first call uses `ProceedAlways`; the later matching call does not prompt.
3. Add failing scheduler tests for AC4 through AC6 using the real `CoreToolScheduler` state machine.
4. Wire `createPolicyUpdater` in `createForegroundAgent` after successful Agent construction, using `config.getPolicyEngine()` and `agent.getMessageBus()`.
5. After cancellation changes the call to `cancelled`, invoke the scheduler's existing execution attempt with that call's signal. The existing scheduler gate decides whether awaiting calls remain.

## Out of scope

- Confirmation-dialog UI changes.
- New policy rule types, priorities, persistence files, or settings.
- Changes to shell command allowlisting.
- Refactoring Agent, MessageBus, policy-engine, or scheduler ownership.
- New public abstractions, dependencies, workflows, quality-tool configuration, or agent memory.
- Cancellation semantics outside an awaiting approval response.

## Finding triage

Every review finding will be classified as:

- **Blocker-Fix**: breaks an accepted behavior, safety requirement, build, or required gate.
- **In-scope-Fix**: defect in code or tests changed for AC1 through AC6.
- **Reject**: factually incorrect, already covered, or would weaken a requirement.
- **Defer**: valid work outside AC1 through AC6. Record it without implementing it in this PR.

Review suggestions do not expand scope. Adding a subsystem, public abstraction, dependency, workflow, agent-memory change, quality-tool change, or unrelated refactor requires user approval.

## Completion gates

- Focused tests for AC1, AC2, AC4, AC5, and AC6 pass. AC3 is covered by the startup integration plus existing core persistence behavior tests.
- Changed tests introduce no new test-audit findings.
- Run the complete `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, and `npm run build` cycle on the candidate head.
- Run the `stepfun-37` smoke test and record any external provider failure without treating it as a code pass.
- Complete implementation review and no more than two local OCR rounds; classify every finding and resolve all Blocker-Fix and In-scope-Fix findings.
- Require passing PR CI, classified CodeRabbit findings, a conflict-free PR, and ancestry based on the intended `main` head before declaring completion.

## Review triage record

The two implementation-review rounds and two local OCR rounds produced the following findings. No further local review round is permitted for this issue.

| Finding | Classification | Resolution |
| --- | --- | --- |
| The initial tests did not exercise a later matching scheduler call after `ProceedAlways`. | **In-scope-Fix** | Added a real `CoreToolScheduler`, policy engine, MessageBus, and adapter test that confirms the first call and observes the later call execute without another confirmation. |
| `ProceedOnce` and unrelated-tool boundaries were not explicit. | **In-scope-Fix** | Added behavioral assertions that a later matching `ProceedOnce` call prompts again and an unrelated tool remains awaiting approval. |
| The bootstrap call lacked mutation-sensitive behavioral coverage. | **Blocker-Fix** | Added a real engine/bus test. Removing the updater call changes the expected decision from `ALLOW` to `ASK_USER` and fails the test. |
| A proposed single test would need to traverse the CLI package and the agents scheduler package. | **Reject** | The production boundary is covered compositionally: the bootstrap test proves subscription on the exact live objects, and the agents test proves subsequent scheduler behavior. A cross-layer test harness or public abstraction would duplicate package internals without adding a new accepted behavior. |
| Status polling could accept missing or historical snapshots. | **Blocker-Fix** | Polling now throws until the latest emitted snapshot for the call has the requested status, and its generic return type narrows to that state. |
| AC5 and AC6 survived an unconditional scheduler-gate mutation. | **Blocker-Fix** | Replaced historical-state checks with latest-state and execution-side-effect assertions. The gate mutation now fails AC4 through AC6. |
| Completion and execution callback cardinality were under-specified. | **In-scope-Fix** | Tests assert one batch completion, terminal states for every call, and exactly one execution per eligible tool. |
| Scheduler instances were not disposed. | **In-scope-Fix** | Added shared `afterEach` disposal for every test harness scheduler. |
| Tests built duplicate registries or tool instances. | **In-scope-Fix** | Each harness now creates one registry and one tool set shared by Config and scheduler. |
| Bootstrap fixtures could pair a replacement Config with a stale fake-Agent bus. | **In-scope-Fix** | Added a fixture installer that replaces Config, engine, bus, and fake Agent together. |
| New tests used avoidable type assertions and an execute-function reassignment. | **In-scope-Fix** | Removed the reassignment and private-field assertions. Remaining `Config` and `ToolRegistry` assertions are fixture boundaries for large repository interfaces and follow adjacent test patterns. |
| Cancellation through a bus response whose details no longer contain `onConfirm` lacked behavioral coverage. | **In-scope-Fix** | Added a real scheduler test that removes the callback after routing, sends the real bus response, and observes cancellation, sibling execution, and batch completion. |
| A mock-only malformed-details coordinator test asserted calls rather than behavior. | **In-scope-Fix** | Removed it after the test-audit scanner flagged `MOCK_ONLY_ORACLE`; the real scheduler scenario replaces it. |
| A rejection test duplicated existing startup-failure behavior and did not prove updater behavior. | **In-scope-Fix** | Kept the existing startup rejection test and removed the redundant test. |
| Changed tests had lint/typecheck failures and a production comment misspelled `UPDATE_POLICY`. | **Blocker-Fix** | Corrected the code and tests; focused lint and repository typecheck pass. |
| The issue test contained excessive narration. | **In-scope-Fix** | Retained comments that explain the real integration setup, serialization boundary, latest-state checks, or fixture boundaries. |
| A post-review read-only inspection found that a scheduled-state helper accepted a caller-provided zero and asserted it unchanged. | **In-scope-Fix** | Removed the parameter and tautological assertion. The tests continue to assert emitted scheduler state and the real per-tool execution counters before and after cancellation. |
| Bun can leak a mocked `node:fs/promises` module between core policy test files in one process. | **Defer** | The failure reproduces on the base commit and the policy suite passes with process isolation. Changing Bun test isolation is outside AC1 through AC6. |

### PR finding triage

| Finding | Classification | Resolution |
| --- | --- | --- |
| CodeRabbit requested an `UPDATE_POLICY` publication before foreground bootstrap as a negative control. | **In-scope-Fix** | The bootstrap test now publishes before startup and observes `ASK_USER`, then publishes after startup and observes `ALLOW` for the matching tool. |
| CodeRabbit's aggregate docstring-coverage check requested comments on touched test helpers and the short cancellation handler. | **Reject** | The repository favors sparse comments that explain non-obvious intent. Adding docstrings to direct test fixtures and a private three-line handler would not strengthen AC1 through AC6. |
| LLxprt PR Review reported that `project-plans/issue3299/plan.md` was missing from the change. | **Reject** | The file is present in commit `6466ca638` and in the PR's five-file diff. |
| The CI OCR comment reported 0/4 changed-file coverage while also reporting no findings. | **Reject** | The review artifact and detached exact-range OCR manifest both show all four eligible code files completed. No code change follows from the inconsistent coverage summary. |

The CI PR OCR and one detached exact-range PR OCR completed with no code findings. These are the two permitted PR OCR rounds; no further PR OCR round is permitted.

## Local verification record

- Final focused behavior command: `bun test packages/agents/src/core/coreToolScheduler.issue3299.test.ts packages/cli/src/cliAgentBootstrap.test.ts` passed 15 tests with 69 assertions.
- Full `npm run lint`, `npm run typecheck`, `npm run format`, and `npm run build` passed on the candidate. Formatting changed only the issue-specific scheduler test, after which the focused 15-test command, `npm run lint:changed`, and `git diff --check` passed again.
- The final changed-test audit reports no finding for `coreToolScheduler.issue3299.test.ts`. Its only match in `cliAgentBootstrap.test.ts` is the pre-existing cleanup-registration test's `MOCK_ONLY_ORACLE`; the new policy-update test introduces no audit finding.
- A complete default-concurrency `npm run test` passed every non-agents workspace and 376 of 377 agents files. The only failure was the first test in `agent.approvalMode.behavior.test.ts`, which reached its existing 180-second timeout; the file passed rapidly when run alone with the agents test preload and working directory.
- A serialized agents retry reproduced unrelated 180-second first-test timeouts in `agent.approvalMode.behavior.test.ts` and `hookAdmin.behavior.test.ts`. The retry was stopped after it could no longer produce a passing root command and began repeating the same loaded-machine failure pattern. No changed scheduler or CLI bootstrap test failed in any full or focused run.
- The required `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"` smoke reached the StepFun provider but returned HTTP 400, `you have no active step plan subscription`. This is an external account blocker, not a passing smoke result.
- Two implementation-review rounds and two local OCR rounds are complete. The table above records every finding and disposition; no further local review round is permitted.
