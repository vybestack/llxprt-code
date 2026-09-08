# Issue 2320 Delivery Plan: TaskTool MessageBus Seams

Plan ID: PLAN-20260822-ISSUE2320
Issue: https://github.com/vybestack/llxprt-code/issues/2320

## Problem and bounded design

The registry already receives a concrete core `MessageBus`, but the type guarantee is weakened as that bus enters the agents-owned TaskTool and subagent orchestration path. The implementation will make the existing production dependency mandatory and reject malformed runtime construction at TaskTool assembly instead of allowing failure to reach scheduler creation.

The bounded design is:

- Keep `TaskToolArgs.messageBus` named as required by the core-to-agents registration contract, but change its type from `MessageBus | undefined` to `MessageBus`.
- Keep the existing `TaskToolDependencies` shape rather than add a public construction abstraction. Make `messageBus` required and remove the constructor default that permits `new TaskTool(config)`.
- Make `SubagentOrchestratorOptions.messageBus` required because its normal launch path creates scheduler-capable subagent scopes.
- Add a TaskTool constructor boundary check so malformed JavaScript or deliberately erased TypeScript types fail with an explicit TaskTool error before invocation or scheduler creation.
- Keep `BaseDeclarativeTool.createInvocation` and its stored bus typed as optional `IToolMessageBus`. TaskTool will treat that shared tools-layer slot as invocation plumbing while retaining the required concrete core `MessageBus` from `TaskToolDependencies` for subagent scheduler setup. Local names and comments will state the distinction.
- Do not create a fallback bus, read a bus from Config, or change `Config.getOrCreateScheduler` strictness.

No new subsystem or public abstraction is required. Adding an adapter, manager, service, public API, dependency, or alternate global/session lookup is outside this plan and requires approval.

## Accepted behavior and evidence

| ID | Given | When | Then | Evidence |
| --- | --- | --- | --- | --- |
| A1 | Core assembles registry TaskTool arguments | TypeScript checks the registration boundary | `TaskToolArgs.messageBus` cannot be omitted or set to `undefined` | typecheck plus focused compile-time assertion if an established local pattern exists |
| A2 | A caller constructs the normal `TaskTool` | TypeScript checks constructor dependencies | `TaskToolDependencies.messageBus` is mandatory and the empty/default dependency path is unavailable | typecheck and updated direct-construction tests |
| A3 | Untyped JavaScript or erased types construct TaskTool without a concrete bus | TaskTool is assembled | construction fails immediately with a TaskTool-specific missing runtime MessageBus error | behavioral boundary test |
| A4 | A `SubagentOrchestrator` is assembled | TypeScript checks its options | a concrete core scheduler MessageBus is mandatory | typecheck and rewritten orchestrator tests |
| A5 | The registry receives one concrete session bus | it builds the agents-owned TaskTool | the same object is present in TaskTool runtime dependencies; no replacement bus is created | existing registry inversion behavior test, strengthened only if needed |
| A6 | A non-interactive TaskTool-launched subagent executes a normal tool call | subagent execution requests its scheduler | `Config.getOrCreateScheduler` receives the exact session/runtime bus supplied at TaskTool construction, and a decoy bus receives nothing | new or strengthened near-end-to-end behavioral regression through real TaskTool and subagent execution components |
| A7 | `Config.getOrCreateScheduler` is called without `dependencies.messageBus` | scheduler creation begins | it still throws the existing explicit dependency error | existing core strictness regression remains passing and unchanged unless an assertion needs clarification |
| A8 | Shared normal tools use the tools package MessageBus seam | their invocations are built | they continue to receive optional `IToolMessageBus`; no tools-layer API or adapter behavior changes | existing tools tests and full suite |

## Inputs and boundary cases

1. A valid concrete core `MessageBus` supplied by `Config.initialize` and `createToolRegistry` must preserve object identity through TaskTool, SubagentOrchestrator, SubAgentScope overrides, non-interactive execution, and scheduler creation.
2. An omitted dependency, an omitted `messageBus` field, or an explicitly undefined field after type erasure must fail at TaskTool construction.
3. Injected `orchestratorFactory` tests still require the concrete TaskTool runtime bus. The factory receives that required bus, including interactive-only test scenarios, because TaskTool construction is scheduler-capable regardless of which execution mode a test selects.
4. SubagentOrchestrator cannot normalize an absent bus. The existing test that expects `overrides.messageBus` to be undefined will be removed or rewritten as required-bus identity behavior.
5. A distinct decoy bus in the behavioral regression must prove identity, not merely non-null presence.
6. Missing profile/subagent manager behavior, timeout behavior, async behavior, tool governance, output handling, and scheduler lifecycle remain unchanged.

## Test-first slices

### Slice 1: required construction boundaries

RED:

- Add a TaskTool boundary test for malformed construction without `messageBus`.
- Add or use the repository's established compile-time assertion pattern to prove registry args and TaskTool dependencies reject omission.
- Rewrite the two tests that currently bless undefined TaskTool/orchestrator buses.

GREEN:

- Require the concrete bus in `TaskToolArgs`, `TaskToolDependencies`, the TaskTool constructor path, the orchestrator factory input, and `SubagentOrchestratorOptions`.
- Add the constructor boundary failure and update affected tests with an explicit concrete bus.

### Slice 2: exact-bus non-interactive regression

RED:

- Add one behavioral regression that launches through TaskTool and reaches normal non-interactive tool scheduling, supplying a session bus and a decoy bus and asserting observable work occurs only through the session bus.

GREEN:

- Use the required TaskTool dependency as the concrete scheduler bus when assembling SubagentOrchestrator and SubAgentScope. Do not add fallback logic.

## Likely paths

Planned source changes:

- `packages/core/src/config/toolRegistryFactory.ts`
- `packages/agents/src/tools/task.ts`
- `packages/agents/src/core/subagentOrchestrator.ts`

Planned test changes:

- `packages/agents/src/tools/task.test.ts`
- `packages/agents/src/core/subagentOrchestrator.test.ts`
- direct TaskTool and SubagentOrchestrator construction tests that need an explicit concrete bus
- one focused agents integration test for the exact non-interactive scheduler bus, placed beside the closest existing execution-path tests

No change is planned for `packages/tools/src/tools/tools.ts` or `IToolMessageBus`.

## Explicit non-goals

- Creating or adapting a MessageBus automatically.
- Reading a runtime bus from Config, an Agent global, process state, or another implicit owner.
- Weakening or moving the `Config.getOrCreateScheduler` dependency check.
- Tightening unrelated optional MessageBus seams in hooks, CLI bootstrap, generic non-interactive APIs, agentic loop APIs, or other tools.
- Renaming public MessageBus fields or adding a general MessageBus ownership framework.
- Refactoring scheduler lifecycle, subagent runtime isolation, managers, tool governance, timeout, async, or output code.
- Moving unrelated tests or adding optional hardening.
- Changing workflows, agent memory, quality tools, dependencies, lint, complexity, coverage, cross-platform policy, or CI configuration.

## Review triage contract

Every review finding will be classified as exactly one of:

- **Blocker-Fix**: accepted behavior, correctness, architecture, or a required gate cannot pass without it.
- **In-scope-Fix**: a valid defect within this acceptance matrix.
- **Reject**: factually incorrect, already covered, or harmful to accepted behavior.
- **Defer**: valid but outside this matrix and not implemented in this PR.

Reviewer suggestions do not expand scope. At most two local OCR and two PR OCR reviews are permitted.

## Completion gates

The candidate head is complete only when:

1. A1 through A8 have evidence on the exact candidate head.
2. The test-audit comparison introduces no prohibited findings in touched tests.
3. `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, and `npm run build` pass.
4. `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"` passes.
5. DeepThinker and bounded local OCR reviews are complete, every finding is classified, and all Blocker-Fix and In-scope-Fix findings are resolved.
6. The exact committed head is pushed, CI passes, bounded PR review is complete, and all actionable review threads are resolved.
7. `origin/main` is an ancestor of the candidate head and the PR is conflict-free.

Stop successfully when these gates pass. Do not continue optional cleanup.