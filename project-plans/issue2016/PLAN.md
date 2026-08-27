# Plan: Increase Ink UI Functional Test Coverage

Plan ID: PLAN-20260827-INKUICOV
Generated: 2026-08-27
Parent issue: [#2016 Increase Ink UI functional test coverage](https://github.com/vybestack/llxprt-code/issues/2016)
Total Phases: 2 (P0.5 preflight verification, P01 planning coverage)
Total child work items: 9
Requirements: ISSUE-2017 through ISSUE-2025

## Purpose and delivery boundary

Issue #2016 is planning-only. This plan and `execution-tracker.md` are its only deliverables. Child issues #2017 through #2025 implement tests in separate changes. This parent does not add seed tests, production code, harness code, scenarios, fixtures, workflows, dependencies, abstractions, or cleanup.

Each child owns an exclusive functional scope below. A child may add a minimal production seam only when a failing behavioral test proves the seam is required and the change remains inside that child's functional scope. Feature changes and discovered production bugs require separate issue review.

## Critical reminders for every child

1. Re-run preflight against the branch that will receive the child change. Paths and existing coverage can change.
2. Write the failing test first, run it, and confirm that it fails for the intended behavioral reason.
3. Use TypeScript and `bun:test`. Do not add Vitest tests or JavaScript test files.
4. Test observable behavior. A test must show user-visible output, returned state, persisted state, emitted terminal bytes, or a scheduler terminal result. Mock call counts alone are not evidence.
5. Prefer unit and component tests. Use tmux only for behavior that requires a real terminal.
6. Keep deterministic tmux coverage in #2017. Use the fake provider and checked-in response fixtures. Do not call a live model from an interactive test.
7. Run interactive tests on Ubuntu only by default. Add another platform only when the scenario has a stated platform-specific requirement.
8. Put CLI tests under one of the structurally discovered roots in `packages/cli/run-bun-tests.ts`: `src`, `test`, `test-bun`, or `test-utils`. Use `.test.ts`, `.test.tsx`, `.spec.ts`, `.spec.tsx`, `.bun.ts`, or `.bun.tsx` as appropriate. Run `npm run lint:cli-test-discovery` so each tracked CLI test is discovered exactly once.
9. Do not create test-only exports or shared abstractions merely to reach private implementation. Drive public behavior through the existing hook, component, context, command, scheduler, or runtime boundary when possible.
10. Keep fixtures isolated. Restore environment variables, terminal listeners, fake streams, temporary files, and persisted settings after every test.

## Preflight findings from the current repository

The following statements were verified on the current branch before this plan was written:

- Root `package.json` uses Bun-backed test, build, lint, and TypeScript scripts. It defines `test:interactive-ui` as a Bun test of `scripts/tests/interactive-ui.test.ts` with `LLXPRT_E2E_TMUX=1`.
- `packages/cli/package.json` runs `bun run-bun-tests.ts`. The runner structurally discovers `.(test|spec|bun).(ts|tsx)` files and runs each file in a separate Bun process. `scripts/check-cli-test-discovery.ts` compares tracked CLI tests with that discovered set. The main CI workflow runs the discovery guard and partitions the CLI Bun suite across three CLI lanes.
- `.github/workflows/interactive-ui.yml` has one `ubuntu-latest` tmux job. It builds the project, sets `CI=true`, enables `LLXPRT_E2E_TMUX`, runs `npm run test:interactive-ui`, and uploads artifacts.
- `scripts/tests/interactive-ui.test.ts` currently registers three scenarios: slash autocomplete, approval acceptance, and assistant Markdown hard line breaks. Scenario execution is explicit. Merely adding a JSON file does not register it.
- `scripts/tmux-harness.ts` delegates to TypeScript helper, I/O, scenario, and step modules. The harness isolates its tmux server, captures screen and scrollback, records pane output, and supports deterministic JSON scripts and macros.
- `scripts/tmux-harness-steps.ts` currently supports wait, line, key, keys, tool-option selection, copy mode, capture, polling expectations, count expectations, approval helpers, history samples, history deltas, and exit waits. It does not currently expose a resize step.
- `scripts/tmux-harness-step.ts` and `scripts/tmux-harness-steps.ts` own the typed step dispatch and the step registry that mutable terminal steps must be added to. Any new real-terminal primitive, including a resize step that an approval scenario needs, stays in #2017.
- `scripts/tmux-harness-scenarios.ts` registers and expands scenario definitions. Changing scenario registration is #2017 work. No other child edits this file.
- `dev-docs/tmux-harness.md` documents the same script model and warns that live-model scripts can be flaky. The existing interactive CI scenarios already use fake-provider fixtures where model output is needed.
- `scripts/tmux-script.session-browser.json` and `scripts/tests/session-browser-e2e.test.ts` exist, but the standalone test is not one of the three cases invoked by `scripts/tests/interactive-ui.test.ts`. Registration and any correction of that scenario belong to #2017.
- `scripts/tmux-script.issue2203-tui-smoke.json` exists under `scripts/`, starts the CLI with `--profile-load glm`, and is not registered in `scripts/tests/interactive-ui.test.ts`, in `scripts/tmux-harness-scenarios.ts`, or in `.github/workflows/interactive-ui.yml`. It is not covered by the interactive workflow path filters. It uses a live glm profile. #2017 owns determinizing and registering it, replacing it with the planned fake-provider startup scenario, or retiring it. This plan does not prescribe live model use.
- All three currently registered terminal scripts set scenario-level `CI=0 CONTINUOUS_INTEGRATION=0` on the child CLI, overriding the workflow's `CI=true` for the child process. #2017 owns correcting or accounting for that override and proving the child CLI sees `CI=true` for its CI-aware rendering oracles.
- The `scripts` test shard is `npm run test:scripts`, defined as `bun scripts/test.ts --shard scripts`. The root `npm run test` runs only `npm run test --workspaces --if-present` and does not include `scripts/tests`. Interactive scripts tests run in `.github/workflows/interactive-ui.yml` on an `ubuntu-latest` job.
- Current shell path completion seams are `packages/cli/src/ui/hooks/useShellPathCompletion.ts` and `packages/cli/src/ui/hooks/useShellPathCompletion.test.ts`. Current command completion coverage lives in `packages/cli/src/ui/hooks/useCommandCompletion.test.tsx`, `useCommandCompletion.more.test.tsx`, and `useCommandCompletion.autoexecute.test.tsx`. There is no `fileUtils*.test.ts` file in `packages/cli/src/ui`.
- `packages/cli/src/ui/components/ModelDialog.tsx` exports the `ModelsDialog` component and the `ModelsDialogProps` type. There is no `ModelsDialog.tsx` file under `packages/cli/src/ui/components`.
- Ink UI tests already exist across composer input, completion hooks, dialog components, tool messages, session browser hooks and components, terminal contexts, render options, and layouts. New work must fill verified behavioral gaps rather than repeat existing assertions.
- `packages/cli/src/ui/components/SuggestionsDisplay.test.tsx` exists. Its current scope is the subagent badge. Advice that says this file is missing is stale.
- Queue behavior now lives under `packages/cli/src/ui/hooks/agentStream/`, including `useQueuedSubmissions.ts` and its substantial `__tests__/useQueuedSubmissions.test.ts` suite. Advice that points only to the older top-level stream or message-queue structure must be rechecked against `agentStream/useQueuedSubmissions`.
- Production terminal repair logic exists in `packages/cli/src/ui/utils/terminalContract.ts`, and `useTerminalSize.ts` subscribes to the stdout `resize` event. A repository-wide TypeScript search found `SIGCONT` and `SIGWINCH` behavior only in `KeypressContext.sigcont.test.ts` and explanatory text in `terminalContract.ts`. No production `process.on`, `process.once`, or `process.addListener` registration for those signals was found. This is an apparent missing-wiring bug candidate, not an established requirement. It is outside this coverage plan. Do not add a passing test that reproduces the test-local handler as if production were wired. File or evaluate a separate bug before changing production signal behavior.

## Rejected stale guidance

Some issue comments describe a Vitest exclusion model, `vi.unmock('ink')`, JavaScript harness files, JavaScript test files, or a missing `SuggestionsDisplay.test.tsx`. That guidance does not match the current branch and is rejected.

The current implementation rule is:

- TypeScript only for new tests and harness work.
- `bun:test` only.
- Structural CLI test discovery with no exclusion list.
- Existing `.test.tsx`, `.spec.tsx`, and `.bun.tsx` files are eligible when placed under discovered roots.
- Current TypeScript harness paths are `scripts/tmux-harness.ts`, `scripts/tmux-harness-helpers.ts`, `scripts/tmux-harness-io.ts`, `scripts/tmux-harness-scenarios.ts`, and `scripts/tmux-harness-steps.ts`.

## Shared test-layer and evidence policy

### Layer selection

Choose the lowest layer that proves the behavior:

1. Pure unit test for parsing, filtering, state transition, persistence, layout selection, terminal sequence generation, or scheduler result.
2. Hook test when React lifecycle or state composition is part of the behavior.
3. Ink component test when rendered text, focus, keyboard routing, or responsive composition is the behavior.
4. Tmux test only when real TTY input, terminal reflow, screen or scrollback output, protocol negotiation, or process-level startup is the behavior. For real-terminal approval scenarios the oracle must be accountable: the captured screen and scrollback bytes, the tmux server's reported window dimensions, and the recorded input event sequence are all recorded per step.

A component test must render the real component under test. It may fake external boundaries such as filesystem, provider, scheduler transport, or terminal streams. It must not replace the behavior under test with a mock that returns the expected answer.

### Behavioral evidence

Every new test must identify its oracle in the test name or arrangement. Acceptable oracles include:

- `lastFrame()` or captured tmux screen text that changes when the real component breaks.
- Hook return state after real state transitions.
- A persisted temp-file value read back through the public API.
- Bytes written to a fake terminal stream and listener state before and after cleanup.
- Tool-call status, result, request identity, and error classification returned by the real scheduler path.
- Screen, scrollback, pane output, and debug artifacts from a deterministic tmux scenario, with the tmux server's reported window size and the recorded input event sequence kept in every relevant step.
- Terminal-state proof for an approval decision that names the decision, shows the expected request identity in the pending state, and shows the resulting state in the captured terminal text.

Tests that only assert that a mock function was called do not satisfy this plan unless the call itself is the public boundary and the test also verifies the resulting externally visible state.

### Common local completion cycle

Each child runs focused tests during red-green-refactor, then runs:

```bash
npm run lint:cli-test-discovery
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load zai "write me a haiku and nothing else"
```

A child that changes only `packages/agents` tests may omit `lint:cli-test-discovery` only if it adds no CLI test. Child #2021 is expected to touch both scheduler and CLI coverage, so it keeps the guard.

## Child issue map

| Issue | Current title | Exclusive owner scope |
| --- | --- | --- |
| [#2017](https://github.com/vybestack/llxprt-code/issues/2017) | Add tmux and PTY coverage for core Ink UI journeys | All tmux or PTY scenarios, harness changes, fake-provider terminal fixtures, interactive runner registration, harness documentation, and interactive workflow path registration. Real-terminal approval proofs include allow once, isolated always allow, deny, Escape, Ctrl-C cancellation, multiple pending or sequential request identities, and long output before a prompt. Must pass `npm run test:scripts` and the Ubuntu interactive lane. |
| [#2018](https://github.com/vybestack/llxprt-code/issues/2018) | Increase Ink composer and input-state coverage | Composer visibility, input-active gating, startup readiness state, cancel routing at the composer boundary, multiline paste, and queued submissions |
| [#2019](https://github.com/vybestack/llxprt-code/issues/2019) | Increase slash, at-command, and path completion coverage | Completion filtering, loading, cancellation, rendering, and acceptance at unit, hook, and component layers |
| [#2020](https://github.com/vybestack/llxprt-code/issues/2020) | Increase dialog and modal orchestration coverage | DialogManager priority, composer gating for dialogs, top-dialog Escape behavior, and non-domain-specific modal state isolation |
| [#2021](https://github.com/vybestack/llxprt-code/issues/2021) | Increase tool approval and tool-call UI coverage | Approval lifecycle, scheduler terminal outcomes, pending-call identity, and tool-call rendering transitions. No approval-deadline timeout feature. |
| [#2022](https://github.com/vybestack/llxprt-code/issues/2022) | Increase session browser UI coverage | Session browser helpers, hook state, component interaction, corrupt and empty session handling, and responsive session-browser layout |
| [#2023](https://github.com/vybestack/llxprt-code/issues/2023) | Increase onboarding, profile, provider, and model UI coverage | Welcome persistence and gating, profile wizard flows, and provider or model selection states |
| [#2024](https://github.com/vybestack/llxprt-code/issues/2024) | Increase terminal keyboard, mouse, and capability coverage | Terminal input parsing, stream lifecycle, terminal protocols, mouse behavior, and capability detection |
| [#2025](https://github.com/vybestack/llxprt-code/issues/2025) | Increase Ink layout and rendering regression coverage | Standard and alternate buffer selection, static and live layout branches, render options, and incremental rendering configuration |

## Child specifications

### #2017: Add tmux and PTY coverage for core Ink UI journeys

**Exclusive scope**

Own every real-terminal scenario generated by this umbrella, including startup and composer presence, completion keystrokes, dialog journeys, approval allow once and deny, isolated always allow, Ctrl-C cancellation, multiple pending or sequential approval requests, long output before approval, Escape, session browser navigation, onboarding, provider or model switching, resize, Unicode or wide-character input, and blank-frame checks. Own the terminal proof for every approval decision outcome and approval request identity. Own correcting or accounting for scenario-level `CI=0` and `CONTINUOUS_INTEGRATION=0` overrides in all currently registered terminal scripts, because each scenario overrides CI to false at the child CLI level even though the workflow sets `CI=true` for the parent process. The startup and blank-frame oracle must prove that the child CLI sees `CI=true` for any oracle that depends on CI-aware rendering. Own any required changes to:

- `scripts/tmux-harness*.ts`
- `scripts/tmux-script*.json` and terminal response fixtures
- `scripts/tests/interactive-ui.test.ts`
- `dev-docs/tmux-harness.md`
- `.github/workflows/interactive-ui.yml`

**Behavior**

- GIVEN the built CLI runs in an isolated tmux session with a deterministic fake provider,
- WHEN a user makes an approval decision, cancels with Ctrl-C, juggles multiple pending or sequential approval requests, or produces long output before an approval prompt,
- THEN each approval request keeps its identity, captured screen and scrollback show the expected terminal state at the intended step, the process exits cleanly, and failure artifacts identify the scenario and step.

**Inputs and boundaries**

Cover clean and completed welcome config, empty and populated session state, approval allow once, isolated always allow, user deny, Ctrl-C cancellation, Escape, multiple pending or sequential approval requests with distinct identities, long output before an approval prompt, narrow and wide terminal sizes, CJK and emoji input, command completion, provider or model selection, and startup under the workflow's `CI=true` environment. Use polling matchers instead of fixed waits where the UI exposes a stable state. A resize scenario may add a typed resize primitive because the current dispatch has none. Validate positive dimensions and preserve unknown-step failure. Each approval scenario names the decision it drives so its identity and outcome are explicit, and no two pending approvals share an identity.

**Test layer**

Tmux or PTY only. Unit tests for any new pure harness parsing or validation remain in #2017 because the harness itself belongs here.

**Behavioral oracle**

Use real captured screen, scrollback, pane output, exit status, and per-step artifacts. Fake-provider responses must be checked in and deterministic. Use the harness's own accountability so that the application terminal output, the tmux server's reported window size, and the scenario's command sequence are all recorded at every assertion step. Each scenario must fail if its user-visible transition is removed, if it sees no approval prompt when one is expected, or if one approval decision is attached to a different request than the one it targets.

**Local verification**

```bash
LLXPRT_E2E_TMUX=1 LLXPRT_TMUX_ARTIFACT_DIR=tmp/issue2017 npm run test:interactive-ui
npm run test:scripts
npm run lint:cli-test-discovery
```

Then run the common completion cycle. Keep artifacts under a unique repository-local `tmp/issue2017/` directory when redirecting or retaining them.

**CI lane**

#2017 must pass both the standard `scripts` CI shard (`npm run test:scripts`) and the Ubuntu interactive workflow lane. Register every scenario in `scripts/tests/interactive-ui.test.ts`. Update the explicit path filters and fixture list in `.github/workflows/interactive-ui.yml` for every new harness, script, fixture, setup, or configuration input. The default interactive lane remains `ubuntu-latest` with artifact upload. Do not add a platform matrix without a specific platform requirement. The root workspace test (`npm run test`) runs workspaces only and does not include `scripts/tests`, so the interactive lane is the only CI proof for those scripts.

**Exclusions**

Do not implement hook or component coverage owned by #2018 through #2025. Do not use live providers. Do not refactor the harness beyond the smallest behavior required by a scenario.

**Overlap notes**

This issue owns the terminal proof for behaviors whose logic belongs to another child. For example, #2022 owns session browser component behavior, while #2017 owns registering and correcting `tmux-script.session-browser.json`. #2017 also owns determinizing and registering `scripts/tmux-script.issue2203-tui-smoke.json`, replacing it with the planned fake-provider startup scenario, or retiring it; that script currently exists and uses a live glm profile and is not registered or included in any workflow path. Do not prescribe live model use. No other child adds a tmux file, fake-provider terminal fixture, interactive test case, harness primitive, harness documentation entry, or workflow registration. #2021 owns the scheduler and component logic for approval outcomes; #2017 owns every real-terminal approval choice and its screen and scrollback proof, including allow once, isolated always allow, deny, Escape, Ctrl-C, multiple pending or sequential request identities, and long output before a prompt. Scenario files, response fixtures, harness work, registration, harness documentation, and workflow path-filter edits for those approval choices stay in #2017 only.

### #2018: Increase Ink composer and input-state coverage

**Exclusive scope**

Own Composer visibility, input-active gating, startup readiness or actionable startup error state, Escape and Ctrl-C routing at the composer boundary, multiline paste, queued message display, and queued submission state, but only when no domain-owned dialog, completion, or approval state machine is active. At those domain boundaries #2018 verifies delegation or inactivity and does not re-test #2019 completion, #2020 dialog, or #2021 approval semantics. The issue-required Escape and Ctrl-C coverage is limited to routing at the composer boundary. Current seams include `Composer.tsx`, `InputPrompt*.test.tsx`, `containers/AppContainer/hooks/useAppInput.ts`, `QueuedMessagesPanel.spec.tsx`, and `hooks/agentStream/useQueuedSubmissions.ts` with its existing test suite.

**Behavior**

- GIVEN command initialization and stream state change with no active dialog, completion, or approval state machine,
- WHEN paste, cancellation, or queue transitions occur,
- THEN the composer is shown or hidden for the intended state, input is preserved or cleared according to the user action, queued submissions retain order and identity, and delegation or inactivity is verified at each domain-owned boundary without re-testing the domain semantics.

**Inputs and boundaries**

Cover initialized and uninitialized command state, startup error, idle and active streaming, processing true or false, no active dialog, empty and multiline paste, repeated equal submissions, cancellation followed by resume, queue drain, and unmount cleanup. Verify that an active dialog, completion, or approval state machine is delegated to #2020, #2019, or #2021 or is inactive, without duplicating their semantics. Treat completion filtering as #2019 and approval lifecycle as #2021.

**Test layer**

Pure helper, hook, and real Ink component tests. Do not add a tmux startup smoke here. #2017 owns that proof.

**Behavioral oracle**

Assert rendered composer or queued-panel text and real hook state after transitions. Queue tests must assert ordering, stable occurrence identity, reservation or drain results, and no lost input, not only callback invocation.

**Local verification**

Run each changed test with `bun test <changed-test-path>`, then:

```bash
npm --prefix packages/cli test
npm run lint:cli-test-discovery
```

Then run the common completion cycle.

**CI lane**

The partitioned CLI Bun test lanes in `.github/workflows/ci.yml`. Every new tracked CLI test must be discovered exactly once by `packages/cli/run-bun-tests.ts`.

**Exclusions**

No completion algorithm cases, dialog-specific state machines, scheduler approval outcomes, tmux scenarios, harness changes, or workflow changes.

**Overlap notes**

#2020 owns the `DefaultAppLayoutHelpers` dialog branch that suppresses composer rendering and its dialog Escape semantics. #2018 only verifies the composer-side gate produced by an active dialog, without re-testing #2020 dialog behavior, #2019 completion, or #2021 approval semantics. #2025 owns standard versus alternate buffer layout. #2018 owns whether the composer is active within the selected layout.

### #2019: Increase slash, at-command, and path completion coverage

**Exclusive scope**

Own slash, at-command, shell path, and command completion filtering, async loading, debounce, cancellation, recovery, acceptance, dismissal, and suggestion rendering. Current coverage includes `useSlashCompletion` (in `packages/cli/src/ui/hooks/useSlashCompletion.tsx`), `useAtCompletion` (`useAtCompletion.ts`), `useShellPathCompletion.ts` with its `useShellPathCompletion.test.ts`, command completion in `useCommandCompletion.tsx` with `useCommandCompletion.test.tsx`, `useCommandCompletion.more.test.tsx`, and `useCommandCompletion.autoexecute.test.tsx`, `InputPrompt.completion.test.tsx`, and `SuggestionsDisplay.test.tsx`. The current SuggestionsDisplay suite covers only the subagent badge, so rendering-state gaps must extend that file rather than create a duplicate.

**Behavior**

- GIVEN commands or filesystem entries and a partially typed completion token,
- WHEN filtering, async search, Tab or Enter acceptance, or Escape dismissal occurs,
- THEN suggestions, loading state, selected item, buffer contents, and submit behavior match the typed input without accepting a dismissed item.

**Inputs and boundaries**

Cover empty and no-match lists, partial prefixes, perfect matches, active index `-1` and list boundaries, loading and error recovery, stale async result cancellation, spaces, dotfiles, ignored files, Unicode, quotes, brackets, dollar signs, and path separators where supported by current production behavior. Use real temporary directories for filesystem behavior.

**Test layer**

Pure utility, hook, and real Ink component tests. Real keyboard tmux coverage, including an at-path acceptance scenario, belongs to #2017.

**Behavioral oracle**

Assert returned suggestions and state transitions, final input buffer, submission result, and `lastFrame()` content for loading, empty, active-row, scroll indicators, descriptions, and counters. A broken filter, cancellation, or acceptance path must change the observed output.

**Local verification**

```bash
bun test packages/cli/src/ui/components/SuggestionsDisplay.test.tsx
npm --prefix packages/cli test
npm run lint:cli-test-discovery
```

Run other changed files directly during TDD, then run the common completion cycle.

**CI lane**

The partitioned CLI Bun test lanes. Structural discovery is required. No interactive workflow registration is part of this child.

**Exclusions**

No tmux scripts, harness docs, workflow edits, composer readiness rules, general dialog routing, or production completion feature changes.

**Overlap notes**

#2018 owns general InputPrompt editing, paste, and queue behavior. #2019 owns InputPrompt behavior only while completion is active. #2017 owns the existing slash scenario and any new real-keyboard completion scenario.

### #2020: Increase dialog and modal orchestration coverage

**Exclusive scope**

Own `DialogManager` selection priority, mutual exclusion, composer gating caused by dialogs, Escape closing only the active modal, search-first Escape behavior where shared, and state isolation for non-domain-specific confirmation subviews. Also own exclusively the `DefaultAppLayoutHelpers.tsx` dialog branch that suppresses composer rendering while a dialog is active and the dialog Escape semantics in that branch. Settings, auth, theme, permissions, policies, and generic routing are in scope. Domain flows reserved to #2021, #2022, and #2023 are not. #2020 does not assign profile-load domain behavior to itself; it owns only generic manager routing for the flag, while #2023 owns all profile-load behavior.

**Behavior**

- GIVEN zero, one, or conflicting dialog-open states,
- WHEN the dialog manager renders and the user navigates, cancels, or confirms,
- THEN exactly the priority-selected dialog is active, composer input is unavailable, Escape affects only the active state, and cancel preserves prior application state.

**Inputs and boundaries**

Cover no active dialog, each generic dialog flag, multiple flags true, empty and non-empty search, first and second Escape, internal confirmation enter or back, success and displayed error states, and unmount cleanup. Test the current single-active-dialog design rather than inventing a stack abstraction.

**Test layer**

Pure routing helper, hook, and real Ink component tests. A representative multi-step real-terminal dialog journey belongs to #2017.

**Behavioral oracle**

Assert the rendered dialog identity and frame before and after real key input. Verify preserved user-facing state after cancel or back. Callback observations may support the proof but cannot replace rendered state or resulting application state.

**Local verification**

```bash
bun test packages/cli/src/ui/components/DialogManager.test.tsx
bun test packages/cli/src/ui/components/SettingsDialog.interactions.test.tsx
npm --prefix packages/cli test
npm run lint:cli-test-discovery
```

Then run the common completion cycle.

**CI lane**

The partitioned CLI Bun test lanes with structural discovery.

**Exclusions**

No provider, model, onboarding, profile, session browser, tool approval, or tmux implementation. No new dialog-stack abstraction.

**Overlap notes**

#2023 owns provider, model, onboarding, and profile dialog behavior, including their cancel and error states. #2021 owns tool confirmations. #2022 owns the session browser. #2020 may test that those dialog flags participate in manager priority without testing their domain behavior.

### #2021: Increase tool approval and tool-call UI coverage

**Exclusive scope**

Own security-sensitive approval outcomes from scheduler request through terminal tool-call state, including allow once, always allow where isolated, user deny, Escape or abort, policy deny, tool error, multiple pending calls, long output, and completion rendering. Current seams include `packages/agents` scheduler tests, CLI `useToolScheduler*.test.ts`, `ToolConfirmationMessage.test.tsx`, `ToolGroupMessage.test.tsx`, and `ToolResultDisplay.test.tsx`.

**Behavior**

- GIVEN one or more emitted tool calls that require approval,
- WHEN policy or a user resolves each call,
- THEN approval requests remain awaiting approval until a user or policy decision, every request identity reaches exactly one terminal result, and the UI presents the corresponding pending, denied, cancelled, error, executing, or completed state without attaching a decision to another call.

This issue covers the current approval behavior, which has no approval-deadline timer. Current approval requests remain awaiting approval until a user or policy decision. It does not authorize a new timeout feature.

**Inputs and boundaries**

Cover compatible and incompatible pending calls, distinct request IDs, allow-once scope, isolated always-allow persistence, user denial, policy denial without a user prompt, abort while awaiting approval, long output before a prompt, completion after approval, tool error, and stale or out-of-order results. Use fresh scheduler, policy, registry, and fixture state per test. Distinct request identities must be tracked across every outcome. Stale editor correlation expiry is a separate mechanism from any approval timing and stays distinct from the scheduler timeout scenario.

**Test layer**

Real scheduler and coordinator behavior tests in `packages/agents`, hook tests, and real Ink tool-message component tests. Real keyboard approval scenarios belong to #2017.

**Behavioral oracle**

Assert scheduler terminal status, error classification, request identity, emitted result or rejection event, and rendered tool-call text across transitions. Each approval-required request must be accounted for once. Do not substitute a mocked scheduler response for the lifecycle under test.

**Local verification**

```bash
npm --prefix packages/agents test
npm --prefix packages/cli test
npm run lint:cli-test-discovery
```

Run focused changed tests first, then run the common completion cycle.

**CI lane**

The agents and partitioned CLI Bun test lanes. Any CLI tests must satisfy structural discovery. No interactive workflow changes are included.

**Exclusions**

No tmux approval scripts, harness helper changes, general dialog orchestration, new approval UX, or policy feature changes. No approval-deadline timeout implementation and no timeout-state approval coverage. A future approval timeout is a feature change that requires its own scope approval; this issue covers existing behavior only.

**Overlap notes**

#2020 may verify that a confirmation dialog suppresses the composer and wins the correct manager priority. #2021 owns the approval decision and tool-call lifecycle, including allow once, isolated always allow, user deny, Escape or abort, policy deny, tool error, multiple pending or sequential request identities, and long output before a prompt. #2017 owns all real-terminal approval choices and artifacts, including the screen and scrollback proof and the accountable terminal-state oracle for those choices. Approval timeout implementation and timeout-state coverage are deferred to a separate feature issue and are not part of this child.

### #2022: Increase session browser UI coverage

**Exclusive scope**

Own session browser filtering, sorting, pagination, preview loading, empty and corrupt sessions, locked and current session presentation, open or close state, selection, resume or cancel cleanup, and responsive component layout. Current seams include `useSessionBrowser.ts`, `useSessionBrowserHelpers.ts`, `useSessionBrowserKeypress.ts`, the six `useSessionBrowser*.spec.ts` files, `SessionBrowserDialog.spec.tsx`, and `SessionBrowserDialog.layout.spec.tsx`.

**Behavior**

- GIVEN an empty or mixed session inventory,
- WHEN the browser opens and the user searches, sorts, navigates, previews, resumes, cancels, or changes component width,
- THEN the visible rows, selected session, preview, skipped count, responsive layout, and cleanup state reflect the inventory without crashing on corrupt data.

**Inputs and boundaries**

Cover empty input, page boundaries, out-of-range page after filtering, case-insensitive fields, stable sorting, loading previews, malformed JSONL, locked sessions, current session, deletion or resume cancellation, narrow and wide component widths, and rerender without selection loss. Use real temporary session files for filesystem parsing behavior.

**Test layer**

Pure helper, hook, and real Ink component tests. Do not export a private helper solely for direct testing when public hook behavior can prove it. Tmux navigation and real terminal resize belong to #2017.

**Behavioral oracle**

Assert visible session data, page and selection state, skipped or preview state, rendered narrow or wide frame, and cleanup after cancel or resume. Corrupt inputs must be treated as external data and must not crash the browser.

**Local verification**

```bash
bun test packages/cli/src/ui/components/__tests__/SessionBrowserDialog.spec.tsx
bun test packages/cli/src/ui/components/__tests__/SessionBrowserDialog.layout.spec.tsx
npm --prefix packages/cli test
npm run lint:cli-test-discovery
```

Run changed hook files directly during TDD, then run the common completion cycle.

**CI lane**

The partitioned CLI Bun test lanes with structural discovery.

**Exclusions**

No registration or modification of `scripts/tmux-script.session-browser.json`, no harness or workflow edits, no general layout behavior outside the session browser, and no new session-browser feature.

**Overlap notes**

#2017 owns the existing orphaned terminal scenario and its registration. #2025 owns application-wide layout selection. #2022 owns width-dependent behavior inside SessionBrowserDialog.

### #2023: Increase onboarding, profile, provider, and model UI coverage

**Exclusive scope**

Own welcome-completed persistence and onboarding gating, skip and save outcomes, profile-create validation and confirmation, profile-load through `LoadProfileDialog.tsx` and `useLoadProfileDialog.ts`, provider or model loading and empty states, switch success or failure, and cancellation. Profile-load ownership covers loading, an empty profile list, classified load errors, cancellation, and preservation of the prior active state across each of those outcomes. Current seams include `useWelcomeOnboarding.ts` and `useWelcomeOnboarding.bun.tsx`, `WelcomeOnboarding/`, `ProfileCreateWizard/`, `LoadProfileDialog.tsx`, `useLoadProfileDialog.ts`, `ProviderDialog.tsx`, `ProviderDialog.responsive.test.tsx`, `ModelDialog.tsx` (which exports the `ModelsDialog` component and the `ModelsDialogProps` type; there is no `ModelsDialog.tsx` file), `modelDialogHandler.ts`, and `useProviderDialog.spec.ts`.

**Behavior**

- GIVEN clean or completed welcome configuration, an empty or populated profile list, and available or failing profile, provider, and model data,
- WHEN the user loads a profile, skips, saves, validates, selects, confirms, or cancels,
- THEN the persisted welcome state, wizard step, selected profile or model, profile load error classification, empty or loading state, cancellation, preserved prior active profile, and prior selection match the completed action.

**Inputs and boundaries**

Cover missing and completed welcome files, folder trust incomplete, skip true and false persistence, profile name and URL boundaries already enforced by production, readable and missing key files, conflict or discard confirmation, profile loading and empty profile list, profile load errors classified by cause, profile load cancellation with the prior active profile preserved, loading, empty provider or model list, failed list or switch, same-provider and cross-provider selection, search clear, and cancel without commit. Use temporary config and key files rather than real user settings.

**Test layer**

Persistence unit tests, `LoadProfileDialog` and `useLoadProfileDialog` hook and real Ink component tests, other hook tests, and real Ink component tests. There is no colocated `ModelDialog.test.tsx` yet; a focused test for `ModelDialog.tsx` is created in that location or colocated under the component directory only if one does not already exist. Clean-runner onboarding and provider or model terminal journeys belong to #2017.

**Behavioral oracle**

Read persisted temp configuration through the real config API, assert `useLoadProfileDialog` hook state for loading, empty list, success, classified error, and cancellation, and assert rendered wizard or dialog output before and after key input. Load and cancel tests must verify the resulting active state or displayed result, not only the selection callback. Classified load errors must return the prior active profile state unchanged.

**Local verification**

```bash
bun test packages/cli/src/ui/hooks/useWelcomeOnboarding.bun.tsx
bun test packages/cli/src/ui/components/ProviderDialog.responsive.test.tsx
npm --prefix packages/cli test
npm run lint:cli-test-discovery
```

Run all other changed files directly during TDD, then run the common completion cycle.

**CI lane**

The partitioned CLI Bun test lanes with structural discovery.

**Exclusions**

No tmux onboarding or switch scenario, workflow edit, generic DialogManager priority suite, session browser profile display, or new confirmation UX.

**Overlap notes**

#2020 owns generic dialog routing and may use provider or model flags only to verify priority. #2023 owns provider and model domain behavior. #2025 owns broad responsive layout rules, while #2023 owns provider-dialog content at its current breakpoints. The `ModelDialog.tsx` component and its exported `ModelsDialog` component and `ModelsDialogProps` type are owned by #2023; the path `packages/cli/src/ui/components/ModelDialog.tsx` is the current seam.

### #2024: Increase terminal keyboard, mouse, and capability coverage

**Exclusive scope**

Own raw-mode setup and cleanup, stdin listener lifecycle, Escape versus Alt parsing, bracketed paste sequences, Kitty keyboard protocol enable and cleanup, mouse event parsing and selection, terminal capability timeout and skip environment behavior, and terminal repair contracts. Current seams include `KeypressContext.tsx`, `useKeypress.ts`, `MouseContext.tsx`, `useMouse*.ts`, `utils/mouse.ts`, `terminalCapabilityManager.ts`, `terminalContract.ts`, `terminalProtocolCleanup.ts`, and their existing Bun tests.

**Behavior**

- GIVEN fake readable and writable terminal streams with selected capabilities,
- WHEN the input provider mounts, receives bytes, changes mode, times out, or unmounts,
- THEN parsed key or mouse events, raw mode, protocol bytes, listeners, timers, and cleanup state match the terminal contract exactly once.

**Inputs and boundaries**

Cover TTY and non-TTY streams, raw-mode unavailable, split and combined escape sequences, lone Escape timeout, Alt key, bracketed paste start and end split across chunks, Kitty enabled and disabled, mouse press, drag, release, wheel, malformed sequence, capability reply, timeout, explicit skip environment variable, remount, and unmount. Fake streams are the preferred boundary.

The current branch has an apparent gap between `KeypressContext.sigcont.test.ts` and production signal registration. Treat SIGCONT or SIGWINCH production wiring as a separate bug candidate. This child may characterize existing public repair APIs, but it must not add test-local handlers and claim they prove production signal behavior. Production wiring needs separate scope approval.

**Test layer**

Pure parser, fake-stream unit, context, and hook tests. A real terminal scenario is allowed only through #2017.

**Behavioral oracle**

Assert parsed public key or mouse events, exact terminal bytes, raw-mode state, listener counts before and after unmount, capability result, timeout result, and cleanup idempotence. Tests must exercise production handlers rather than duplicate their intended logic inside the test.

**Local verification**

```bash
bun test packages/cli/src/ui/contexts/KeypressContext.test.tsx
bun test packages/cli/src/ui/contexts/MouseContext.test.tsx
bun test packages/cli/src/ui/utils/terminalCapabilityManager.test.ts
bun test packages/cli/src/ui/utils/terminalContract.test.ts
npm --prefix packages/cli test
npm run lint:cli-test-discovery
```

Then run the common completion cycle.

**CI lane**

The partitioned CLI Bun test lanes. Keep fake-stream tests platform-neutral. Any real-terminal exception is implemented and run by #2017 on Ubuntu.

**Exclusions**

No tmux scripts, signal wiring fix, terminal feature change, layout resize assertions, or harness resize primitive.

**Overlap notes**

#2017 owns real terminal input and resize scenarios. #2025 owns layout response to dimensions. #2024 owns byte parsing, protocol, stream, and capability behavior that can be proven without tmux. #2024 owns unit, hook, and fake-stream lifecycle coverage for `useTerminalSize.ts`, `useBracketedPaste.ts`, `useMouseSelection.ts`, and `useMouse.ts`, including their mounted, resized, pasted, selected, and unmounted states, while #2017 owns real terminal resize and real terminal input proof.

### #2025: Increase Ink layout and rendering regression coverage

**Exclusive scope**

Own static item inclusion, static header suppression, live controls, standard-buffer and alternate-buffer layout selection, render option propagation, and incremental rendering gates. Current seams include `DefaultAppLayout.test.tsx`, `DefaultAppLayoutHelpers.tsx`, standard and alternate buffer layout components, and `inkRenderOptions.test.ts`.

**Behavior**

- GIVEN history, static-header settings, buffer mode, and incremental rendering settings,
- WHEN the application layout and Ink render options are built,
- THEN static and live content appear in the intended branch and only supported render-option combinations are passed to Ink.

**Inputs and boundaries**

Cover empty and non-empty static items, suppressed and visible static header, live controls with no dialog, standard and alternate buffer modes, incremental rendering true and false, incremental requested while alternate buffer is false, narrow and wide layout inputs where the application-level branch changes, and rerender without duplicate static content.

**Test layer**

Pure render-option tests and real Ink layout component tests. Startup first-frame, blank-frame, and real terminal resize proof belong to #2017.

**Behavioral oracle**

Assert real rendered frame content and returned Ink render options. Tests must distinguish static from live content and standard from alternate layout without replacing the branch under test with a mock that simply reports which component was called.

**Local verification**

```bash
bun test packages/cli/src/ui/inkRenderOptions.test.ts
bun test packages/cli/src/ui/layouts/DefaultAppLayout.test.tsx
npm --prefix packages/cli test
npm run lint:cli-test-discovery
```

Then run the common completion cycle.

**CI lane**

The partitioned CLI Bun test lanes with structural discovery.

**Exclusions**

No tmux startup script, interactive runner or workflow edit, composer active-state logic, dialog domain behavior including the `DefaultAppLayoutHelpers` dialog branch, session browser internal layout, or terminal protocol logic.

**Overlap notes**

#2020 owns the `DefaultAppLayoutHelpers` dialog branch that suppresses composer rendering and its dialog Escape semantics, so #2025 does not own that branch. #2018 owns whether the composer should be active. #2020 owns whether a dialog replaces it. #2025 owns state and cleanup coverage for `useLayoutMeasurement.ts`, which lives in `containers/AppContainer/hooks/`, while #2017 owns the real terminal resize and layout proof. #2025 owns how the selected static or live content is arranged. #2017 owns proof that the real terminal startup frame is not blank and contains the composer.

## Review classification rules

Apply every review finding to the current child and record one classification:

- **Blocker-Fix**: The finding shows that the proposed test cannot run, is not discovered, tests a mock instead of production behavior, uses nondeterministic live input, violates exclusive ownership, changes unsafe production behavior, or would let the child claim completion without its behavioral oracle. Fix before proceeding.
- **In-scope-Fix**: The finding concerns correctness, determinism, cleanup, coverage boundaries, typing, or documentation inside the active child's exclusive scope. Fix in the child.
- **Reject**: The finding is factually wrong on the current branch, repeats already-covered behavior without identifying a gap, asks for Vitest or JavaScript, assigns tmux work outside #2017, or proposes mock-interaction evidence in place of behavior. Record the repository evidence for rejection.
- **Defer**: The finding is valid but belongs to another child, requires a feature or production bug fix, adds a platform without a requirement, or proposes an abstraction beyond the smallest tested seam. Link or create the appropriate follow-up rather than expanding the child.

A review label is not a severity substitute. A factual safety or discovery problem is a blocker even when described as a minor comment.

## Completion gates

### Parent #2016 planning gate

The parent is complete only when:

- `PLAN.md` uses Plan ID `PLAN-20260827-INKUICOV` and links #2016 through #2025 with current titles.
- Each child has exclusive scope, behavior, inputs and boundaries, test layer, behavioral oracle, local verification, CI lane, exclusions, and overlap notes.
- All tmux, PTY, harness, scenario, terminal fixture, harness documentation, interactive test registration, and interactive workflow registration work is assigned to #2017.
- `execution-tracker.md` records planning and one unimplemented row per child, plus a review-triage table that records every finding classification and its disposition.
- Plan checks and verification record exact exits and only observed evidence. A resource-adjusted rerun may satisfy a gate only when its target and policy stay unchanged, the resource difference is explicit, and the exact wrapper outcome remains documented. Other nonzero gates stay open.
- #2017 explicitly owns correcting or accounting for scenario-level `CI=0` and `CONTINUOUS_INTEGRATION=0` overrides and proving the child CLI sees `CI=true` in its startup and blank-frame oracle.
- #2017 owns the real-terminal approval proofs for isolated always allow, Ctrl-C cancellation, multiple pending or sequential approval request identities, and long output before approval, with a screen and scrollback and accountable terminal-state oracle, and must pass both the `scripts` CI shard and the Ubuntu interactive workflow lane.
- #2021 covers existing approval behavior and removes approval timeout from its accepted scope. A separate destination records approval timeout implementation and timeout-state coverage (and the SIGCONT or SIGWINCH wiring bug candidate) as deferred outside this plan.
- #2019 and #2023 record the current completion seams `useShellPathCompletion.ts`, `useShellPathCompletion.test.ts`, the `useCommandCompletion*.test.tsx` files, and `ModelDialog.tsx` exporting `ModelsDialog` and `ModelsDialogProps`; no `fileUtils*.test.ts` or `ModelsDialog.tsx` path is cited.
- `scripts/tmux-script.issue2203-tui-smoke.json` is assigned to #2017 to determinize and register, replace with the planned fake-provider startup scenario, or retire, with no live model use prescribed.
- #2020 exclusively owns the `DefaultAppLayoutHelpers` dialog branch composer suppression and dialog Escape semantics, and #2018 verifies only delegation or inactivity at dialog, completion, and approval boundaries without re-testing their domain semantics.
- #2023 explicitly owns `LoadProfileDialog` and `useLoadProfileDialog` loading, empty profile list, classified load errors, cancellation, and prior active state preservation, with #2020 limited to generic manager routing for the flag.
- #2024 owns unit, hook, and fake-stream lifecycle coverage for the terminal hooks, and #2025 owns `useLayoutMeasurement.ts` state and cleanup coverage, with #2017 owning the real terminal resize and input proof.
- The plan records the current Bun and TypeScript test system, structural discovery, current source paths, rejected stale guidance, and the apparent signal-wiring bug candidate.
- Only the two approved issue #2016 planning files change.
- Plan checks and the full verification cycle complete, with exact outcomes reported. The parent does not claim any child tests were implemented.

### Child completion gate

A child is complete only when:

- Preflight confirms the gap still exists and the changed files stay inside the child's exclusive scope.
- A failing TypeScript `bun:test` test was observed before implementation or test-support changes.
- Every new test has behavioral evidence and would fail when the real behavior is broken.
- Existing coverage was extended rather than duplicated, including current `SuggestionsDisplay.test.tsx` and `agentStream/useQueuedSubmissions` coverage where relevant.
- CLI tests are structurally discovered exactly once. #2017 scenarios are explicitly registered and have complete workflow path coverage.
- Focused tests, affected package tests, the common completion cycle, and any child-specific lane pass.
- Tests restore streams, listeners, timers, environment variables, temporary files, terminal modes, and persisted state.
- Review findings are classified and resolved under the rules above.
- No unrelated production feature, dependency, workflow, abstraction, or cleanup is included.
