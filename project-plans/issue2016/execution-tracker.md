# Execution Tracker: Ink UI Functional Test Coverage

Plan ID: PLAN-20260827-INKUICOV
Parent issue: [#2016 Increase Ink UI functional test coverage](https://github.com/vybestack/llxprt-code/issues/2016)

## Scope statement

This tracker records parent planning and future child evidence. Issue #2016 does not implement child tests. A child row remains `Not started` until that child lands its own TypeScript `bun:test` work and records evidence in its own change.

## Status definitions

- `Complete (planning)`: Repository facts and plan boundaries were documented. This does not mean child implementation exists.
- `Not started`: No implementation or test evidence is claimed by this parent.
- `In progress`: The child has a failing behavioral test and active implementation in its own change.
- `Complete`: The child has behavioral evidence, focused and full verification, CI evidence, and resolved review classifications in its own change.
- `Blocked`: A verified inconsistency prevents safe implementation and is recorded with evidence.

## Planning and child execution status

| Work item | Plan phase | Status | Scope owner | Behavioral test evidence | Local verification evidence | CI evidence | Review classification evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Preflight | P0.5 | Complete (planning) | #2016 | N/A. Repository inspection only. | Inspected plan rules, Bun discovery, tmux harness modules, interactive runner and workflow, issue titles, and relevant Ink UI source and tests. | N/A. No child code. | No child findings classified. | Current branch facts and the apparent missing SIGCONT or SIGWINCH production wiring are recorded in `PLAN.md`. |
| Coverage plan | P01 | Complete (planning) | #2016 | N/A. Planning artifact only. | `PLAN.md` assigns exclusive child scope, layer, oracle, verification, CI, exclusions, and overlap. Command outcomes are reported separately after execution. | N/A. No child code. | Review classification rules are defined in `PLAN.md`. | Parent deliverable is limited to this tracker and `PLAN.md`. |
| [#2017 Add tmux and PTY coverage for core Ink UI journeys](https://github.com/vybestack/llxprt-code/issues/2017) | C2017 | Not started | #2017 | None. Child implementation is not included. | Pending child evidence: deterministic fake-provider interactive suite, `npm run test:scripts`, and full cycle. | Pending Ubuntu interactive UI lane and artifacts, plus the standard `scripts` CI shard (the root workspace `npm run test` does not include `scripts/tests`). | Pending child record. | Owns every tmux or PTY scenario, harness change, terminal fixture, interactive registration, harness documentation update, and workflow registration. Explicitly owns `scripts/tmux-script.issue2203-tui-smoke.json` (determinize and register, replace with the planned fake-provider startup scenario, or retire) and correcting or accounting for scenario-level `CI=0` and `CONTINUOUS_INTEGRATION=0` overrides so the startup and blank-frame oracle proves the child CLI sees `CI=true`. Real-terminal approval proofs cover allow once, deny, isolated always allow, Ctrl-C cancellation, Escape, multiple pending or sequential approval request identities, and long output before approval, with screen and scrollback and an accountable terminal-state oracle. No live model use is prescribed. |
| [#2018 Increase Ink composer and input-state coverage](https://github.com/vybestack/llxprt-code/issues/2018) | C2018 | Not started | #2018 | None. Child implementation is not included. | Pending focused composer, InputPrompt, queue tests, CLI suite, discovery guard, and full cycle. | Pending partitioned CLI Bun lane. | Pending child record. | Includes current `agentStream/useQueuedSubmissions` boundaries. No tmux work. Owns general composer visibility, readiness, input active gating, and input routing only when no domain-owned dialog, completion, or approval state machine is active, verifying delegation or inactivity there without re-testing #2019 completion, #2020 dialog, or #2021 approval semantics. Keep issue-required Escape and Ctrl-C coverage precise and limited to routing at the composer boundary. |
| [#2019 Increase slash, at-command, and path completion coverage](https://github.com/vybestack/llxprt-code/issues/2019) | C2019 | Not started | #2019 | None. Child implementation is not included. | Pending focused completion and SuggestionsDisplay tests, CLI suite, discovery guard, and full cycle. | Pending partitioned CLI Bun lane. | Pending child record. | Extend current `SuggestionsDisplay.test.tsx`; do not create a duplicate. Current completion seams are `useShellPathCompletion.ts`, `useShellPathCompletion.test.ts`, and the `useCommandCompletion*.test.tsx` files; there is no `fileUtils*.test.ts` completion seam. No tmux work. |
| [#2020 Increase dialog and modal orchestration coverage](https://github.com/vybestack/llxprt-code/issues/2020) | C2020 | Not started | #2020 | None. Child implementation is not included. | Pending focused dialog tests, CLI suite, discovery guard, and full cycle. | Pending partitioned CLI Bun lane. | Pending child record. | Exclusively owns the `DefaultAppLayoutHelpers` dialog branch that suppresses composer rendering and its dialog Escape semantics. Owns generic manager routing only; #2023 owns the profile-load domain behavior behind the flag. Owns generic routing and modal state, not provider, model, profile, session browser, or tool domain behavior. |
| [#2021 Increase tool approval and tool-call UI coverage](https://github.com/vybestack/llxprt-code/issues/2021) | C2021 | Not started | #2021 | None. Child implementation is not included. | Pending agents and CLI focused tests, both package suites, discovery guard, and full cycle. | Pending agents and partitioned CLI Bun lanes. | Pending child record. | Real scheduler and component behavior only for existing approval behavior. Approval requests remain awaiting approval until a user or policy decision; there is no approval-deadline timer. Approval timeout implementation and timeout-state coverage are deferred to a separate feature issue. #2017 owns all real-terminal approval choices and artifacts. |
| [#2022 Increase session browser UI coverage](https://github.com/vybestack/llxprt-code/issues/2022) | C2022 | Not started | #2022 | None. Child implementation is not included. | Pending session browser hook and component tests, CLI suite, discovery guard, and full cycle. | Pending partitioned CLI Bun lane. | Pending child record. | #2017 owns the existing terminal scenario and its registration. |
| [#2023 Increase onboarding, profile, provider, and model UI coverage](https://github.com/vybestack/llxprt-code/issues/2023) | C2023 | Not started | #2023 | None. Child implementation is not included. | Pending persistence, hook, wizard, provider and model tests, CLI suite, discovery guard, and full cycle. | Pending partitioned CLI Bun lane. | Pending child record. | Explicitly owns `LoadProfileDialog` and `useLoadProfileDialog` loading, empty profile list, classified load errors, cancellation, and preservation of the prior active state, with #2020 limited to generic manager routing for the flag. The model seam is `packages/cli/src/ui/components/ModelDialog.tsx`, which exports the `ModelsDialog` component and `ModelsDialogProps`; there is no `ModelsDialog.tsx` file and no colocated `ModelDialog.test.tsx` yet. Uses isolated temporary config and key files. No tmux work. |
| [#2024 Increase terminal keyboard, mouse, and capability coverage](https://github.com/vybestack/llxprt-code/issues/2024) | C2024 | Not started | #2024 | None. Child implementation is not included. | Pending parser, fake-stream, context and terminal utility tests, CLI suite, discovery guard, and full cycle. | Pending partitioned CLI Bun lane. | Pending child record. | Owns unit, hook, and fake-stream lifecycle coverage for `useTerminalSize.ts`, `useBracketedPaste.ts`, `useMouseSelection.ts`, and `useMouse.ts`; #2017 owns real terminal resize and real terminal input. Production SIGCONT or SIGWINCH wiring is a separate bug candidate, not included here. |
| [#2025 Increase Ink layout and rendering regression coverage](https://github.com/vybestack/llxprt-code/issues/2025) | C2025 | Not started | #2025 | None. Child implementation is not included. | Pending render-option and layout tests, CLI suite, discovery guard, and full cycle. | Pending partitioned CLI Bun lane. | Pending child record. | #2017 owns startup frame, blank-frame, and real terminal resize scenarios. Owns `useLayoutMeasurement.ts` state and cleanup coverage; real terminal resize and layout proof stays with #2017. This child does not own the `DefaultAppLayoutHelpers` dialog branch, which belongs to #2020. |

## Plan phases

This issue is documentation only and uses the preflight and planning phases from `dev-docs/PLAN-TEMPLATE.md`. No implementation phase is declared because the parent does not implement child tests.

### Phase 0.5: Preflight verification

**Phase ID**

`PLAN-20260827-INKUICOV.P0.5`

**Prerequisites**

- Required: none, this is the first phase.
- Focus: verify repository facts before any planning is written.

**Requirements implemented (expanded)**

- GIVEN the current branch and issue titles are sourced and the listed paths and script modules exist,
- WHEN the plan inspects the test system, discovery, harness, interactive runner and workflow, and current seams,
- THEN the plan records verified facts and rejects guidance that does not match those facts.

This matters because every child reads the plan as its source of truth, so a stale preflight fact becomes a stale child boundary.

- Verify the current Bun and TypeScript test system, structural CLI discovery, tmux harness modules, interactive runner and workflow, current source and test paths, and issue titles for #2016 through #2025.
- Record verified preflight evidence, including that `scripts/tmux-script.issue2203-tui-smoke.json` exists, starts the CLI with `--profile-load glm`, and is not registered in the interactive runner or workflow paths, and that all three registered terminal scripts override `CI=0` and `CONTINUOUS_INTEGRATION=0` at the scenario level while the workflow sets `CI=true` for the parent process.

**Structural verification**

- [x] Current branch facts recorded: three scenarios registered, explicit scenario execution, the smoke script and its live glm profile, the scenario-level CI override lines, and the apparent signal-wiring bug candidate.
- [x] No assertions made that require child tests to exist.

**Semantic verification**

- [x] Confirmed every preflight statement against the current branch before writing.
- [x] Confirmed the three registered scenario scripts and their `CI=0 CONTINUOUS_INTEGRATION=0` lines and the smoke script `--profile-load glm` line directly.

**Failure recovery**

- If a preflight fact is wrong, edit `PLAN.md` before the plan is used. No code rollback applies to this documentation phase.

### Phase P01: Planning coverage

**Phase ID**

`PLAN-20260827-INKUICOV.P01`

**Prerequisites**

- Required: Phase P0.5 completed and current-branch facts confirmed.
- Expected artifacts: `PLAN.md` and this tracker.

**This phase uses the planning phase template for a documentation-only parent.** The template's implementation markers apply when a phase creates code; this phase does not. The phase structure is defined by the two-plan phases from `dev-docs/PLAN-TEMPLATE.md` and the section list below. The section list was incomplete until this remediation, and is now complete with structural verification, semantic verification, success criteria, failure recovery, and completion-marker treatment.

**Requirements implemented (expanded)**

This phase records planning behavior and its purpose:

- GIVEN the parent issue #2016 authorizes only this tracker and `PLAN.md` as deliverables,
- WHEN this phase assigns each child an exclusive scope with behavior, inputs, layer, oracle, verification, CI lane, exclusions, and overlap boundaries,
- THEN a child can implement its tests in its own change without duplicating another child's coverage, and the parent does not claim child implementation.

This matters because a planning-only parent has no code to verify; its only proof is that the boundary assignments are precise and current.

- Assign each child exclusive scope, test layer, behavioral oracle, local verification, CI lane, exclusions, and overlap boundaries.
- Assign `LoadProfileDialog` and `useLoadProfileDialog` loading, empty profile list, classified load errors, cancellation, and prior active state preservation to #2023, with #2020 limited to generic manager routing for the flag.
- Assign the `DefaultAppLayoutHelpers.tsx` dialog branch composer suppression and dialog Escape semantics exclusively to #2020, with #2018 owning general composer visibility and input routing only when no domain-owned dialog, completion, or approval state machine is active.
- Assign the scenario-level `CI=0` and `CONTINUOUS_INTEGRATION=0` override correction to #2017, requiring its startup and blank-frame oracle to prove the child CLI sees `CI=true`.
- Assign the real-terminal approval proofs for allow once, deny, isolated always allow, Ctrl-C cancellation, Escape, multiple pending or sequential approval request identities, and long output before approval to #2017, together with the screen and scrollback oracle and the accountable terminal-state oracle. Keep scenario files, response fixtures, harness work, registration, docs, and workflow path-filter edits exclusively in #2017.
- Keep scheduler, hook, and component approval logic in #2021 and exclude every real-terminal implementation from #2021. #2021 covers existing approval behavior only and adds no approval timeout; assign approval timeout implementation and timeout-state coverage outside this plan.
- Define #2021 behavior with GIVEN or WHEN or THEN statements that describe the current approval behavior, state that approval requests remain awaiting approval until a user or policy decision, and state that an approval-deadline timer does not exist.
- Assign `scripts/tmux-script.issue2203-tui-smoke.json` to #2017 to determinize and register, replace with the planned fake-provider startup scenario, or retire, without prescribing live model use.
- Assign unit, hook, and fake-stream lifecycle coverage for `useTerminalSize.ts`, `useBracketedPaste.ts`, `useMouseSelection.ts`, and `useMouse.ts` to #2024 and `useLayoutMeasurement.ts` state and cleanup coverage to #2025, with real terminal proof staying in #2017.

- Record the current completion seams `useShellPathCompletion.ts`, `useShellPathCompletion.test.ts`, the `useCommandCompletion*.test.tsx` files, and `ModelDialog.tsx` exporting `ModelsDialog` and `ModelsDialogProps`. No `fileUtils*.test.ts` or `ModelsDialog.tsx` path is cited.

- Record the earlier complete `npm run test` evidence by path `tmp/issue2016/npm-test-managed.log` and leave incomplete or failed later runs open with only their observed evidence.

**Structural verification**

- [x] Every child has the required scope, layer, oracle, verification, exclusions, and overlap sections.
- [x] `dev-docs/PLAN-TEMPLATE.md` phase structure followed for P0.5 and P01.
- [x] No implementation phase declared.
- [x] The earlier complete `npm run test` is recorded by path `tmp/issue2016/npm-test-managed.log`. Later runs are recorded with their own observed evidence.
- [x] No `fileUtils*.test.ts` or `ModelsDialog.tsx` path is cited in the plan or tracker. `useShellPathCompletion.ts`, `useShellPathCompletion.test.ts`, and `useCommandCompletion*.test.tsx` are the current completion seams, and `ModelDialog.tsx` exports `ModelsDialog` and `ModelsDialogProps`.

**Semantic verification**

- [x] No ownership overlap: each scenario, fixture, hook, component, route, and terminal proof is assigned to exactly one child, and the overlap notes distinguish terminal proof (owned by #2017) from the logic it proves (owned by the domain child).
- [x] #2021 covers existing approval behavior, approval requests remain awaiting approval until a user or policy decision, and approval timeout implementation and timeout-state coverage are assigned outside this plan. Stale editor correlation expiry stays distinct from scheduler timing.
- [x] #2017's real-terminal approval proofs own allow once, deny, isolated always allow, Ctrl-C cancellation, Escape, multiple pending or sequential approval request identities, and long output before approval, with a screen and scrollback oracle and an accountable terminal-state oracle. #2021 keeps scheduler, hook, and component logic and excludes real-terminal implementation.
- [x] Every child carries its required behavioral oracle, test layer, local verification, CI lane, exclusions, and review classification detail in addition to its scope statement.
- [x] Every planned terminal journey routes its implementation and registration through #2017, including the `issue2203-tui-smoke` script, the session-browser scenario, and the scenario-level CI override correction.
- [x] #2017's local verification includes `npm run test:scripts` and must pass both the standard `scripts` CI shard and the Ubuntu interactive workflow lane. The root workspace test does not include `scripts/tests`.
- [x] Failed and transient attempts remain recorded with their exact outcomes. Final passing reruns are cited separately and do not relabel earlier outcomes.

**Failure recovery**

- If a boundary is ambiguous, edit `PLAN.md` to state the exact owner. No code rollback applies to this documentation phase.

**Success criteria**

- `PLAN.md` and this tracker keep every child's scope, behavior, layer, oracle, verification, CI lane, exclusions, and overlap sections.
- The review-triage table below records every finding classification and its disposition inside this tracker.
- Scoped Prettier, `npm run format:check`, `npm run lint:doc-placement`, `npm run lint:doc-links`, and `npm run lint:cli-test-discovery` run after these edits, and their exits are recorded.
- The full cycle `npm run test`, full-tree ESLint, `npm run typecheck`, `npm run format`, `npm run build`, and the user-selected `zai` smoke run after these edits, and each gate records its actual exit.

**Completion-marker treatment**

- A phase completion marker at `project-plans/issue2016/.completed/P01.md` is intentionally not created. Issue #2016 authorizes only `PLAN.md` and `execution-tracker.md` as deliverables, so the phase marker convention does not apply. The `P01` phase completion state is recorded in this tracker only.

## Review triage

Each finding from the issue #2016 candidate review is recorded below with one classification and its disposition. Repository evidence for the rejections is listed with each row.

| Finding | Classification | Disposition |
| --- | --- | --- |
| #2017 expansion: add isolated always-allow, Ctrl-C cancellation, multiple pending or sequential approval request identities, and long output before approval to the approval scenarios, with a screen and scrollback oracle and an accountable terminal-state oracle. Keep scenario files, response fixtures, harness work, registration, docs, and workflow path-filter edits in #2017. Keep scheduler, hook, and component logic in #2021 and exclude real-terminal implementation from #2021. | Blocker-Fix | Fixed. `PLAN.md` #2017 scope, behavior, inputs, oracle, CI lane, and overlap notes; #2021 behavior and exclusions; and this tracker all state the expanded approval scenarios and ownership. |
| Add `npm run test:scripts` to #2017 local verification and state the `scripts` CI shard plus the Ubuntu interactive workflow lane requirement. | Blocker-Fix | Fixed. `PLAN.md` #2017 local verification and CI lane, the preflight findings, and this tracker record `npm run test:scripts`, the standard `scripts` shard, the Ubuntu lane, and that root `npm run test` does not include `scripts/tests`. |
| Remove approval timeout from #2021 accepted behavior and inputs. Current approval requests remain awaiting approval without an approval-deadline timer. Classify approval timeout implementation and timeout-state coverage as Defer. Keep stale editor correlation expiry distinct. | Blocker-Fix | Fixed. `PLAN.md` #2021 scope, behavior, inputs, exclusions, overlap notes, and the child map no longer list approval timeout. The plan states that current approval requests remain awaiting approval until a user or policy decision and that no approval-deadline timer exists. Approval timeout implementation and timeout-state coverage are Defer (see the Defer rows). Stale editor correlation expiry is recorded as a distinct mechanism. |
| Replace the nonexistent `fileUtils*.test.ts` completion seam with `packages/cli/src/ui/hooks/useShellPathCompletion.ts`, `useShellPathCompletion.test.ts`, and the current `useCommandCompletion*.test.tsx` coverage. | In-scope-Fix | Fixed. `PLAN.md` #2019 scope, the preflight findings, and this tracker cite `useShellPathCompletion.ts`, `useShellPathCompletion.test.ts`, `useCommandCompletion.test.tsx`, `useCommandCompletion.more.test.tsx`, and `useCommandCompletion.autoexecute.test.tsx`. No `fileUtils*.test.ts` path is cited. Verified: those files exist under `packages/cli/src/ui/hooks/`. |
| Correct `ModelsDialog.tsx` to the actual `packages/cli/src/ui/components/ModelDialog.tsx` and keep the exported component and type naming distinction. Focused verification targets the current path or a colocated test only if one does not exist. | In-scope-Fix | Fixed. `PLAN.md` #2023 scope, test layer, overlap notes, the preflight findings, and this tracker use `ModelDialog.tsx` and state it exports the `ModelsDialog` component and the `ModelsDialogProps` type. No `ModelsDialog.tsx` path is cited. Verified: `packages/cli/src/ui/components/ModelDialog.tsx` exports `ModelsDialog` and `ModelsDialogProps`, and no `ModelDialog.test.tsx` exists yet. |
| Do not claim a full `npm run test` pass from `tmp/issue2016/npm-test.log`; cite `tmp/issue2016/npm-test-managed.log` as the earlier complete pass and keep later failed runs open with only observed evidence. | In-scope-Fix | Fixed. This tracker cites `tmp/issue2016/npm-test-managed.log` for the early complete pass, no longer cites `tmp/issue2016/npm-test.log` as a pass, and leaves the later failed run open with its observed `SessionDiscovery.test.ts` timeout evidence. |
| Do not claim the lint OOM is shared across sibling branches or proven unrelated. Record that local `npm run lint` exhausted its fixed 12,288 MB heap and exited 134 or SIGABRT; the gate stays open. | In-scope-Fix | Fixed. This tracker preserves the exact wrapper's local 12,288 MB heap exhaustion and exit 134 or SIGABRT. The final verification separately records the passing full-tree ESLint command with a 24,576 MB heap. |
| Complete the P01 phase structure: prerequisites, expanded requirements, GIVEN or WHEN or THEN behavior with why, success criteria, structural verification, semantic verification, failure recovery, and completion-marker treatment. State that `.completed/P01.md` is intentionally not created because #2016 authorizes only the two files. Do not claim the phase follows the template until the sections are present. | In-scope-Fix | Fixed. `PLAN.md` states this is a documentation-only parent using the two-plan phases, and this tracker now has prerequisites, expanded requirements, GIVEN or WHEN or THEN behavior with why, success criteria, structural verification, semantic verification, failure recovery, and completion-marker treatment. The markers reflect `dev-docs/PLAN-TEMPLATE.md` usage for a documentation parent. |
| No further ownership overlap exists beyond the approval scenario enumeration. The current child boundary model is retained. No prohibited prose patterns are present. | Reject | Recorded. `PLAN.md` and this tracker keep the existing child boundary model, including the six approval scenario names and the loopback warning. The particular prohibited prose terms and the honesty markers were verified absent from both files by search. |
| SIGCONT or SIGWINCH production signal wiring. | Defer | Retained. `PLAN.md` preflight findings record the apparent missing-wiring bug candidate and state it is outside this coverage plan; the tracker keeps it open in the preflight row. No issue was created and no production signal behavior changed. |
| Approval timeout feature and timeout-state coverage. | Defer | Recorded. The plan and this tracker state that current approval requests remain awaiting approval without an approval-deadline timer, that approval timeout is outside #2021 and requires separate scope approval, and that no issue was created for it here. |
| Parent completion-gate ownership named #2021 and #2020 for completion and model seams that belong to #2019 and #2023. | In-scope-Fix | Fixed. `PLAN.md` now assigns the completion seams to #2019 and the model-dialog seam to #2023. |

## Open Code Review

Local OCR round 1 ran against the staged candidate with issue context and a plan-specific rule. OCR v1.10.2 returned `skipped` with `unsupported_ext` for both Markdown files, reviewed zero files, and produced zero comments. Evidence is in `tmp/issue2016/ocr-local-1.json`. A second local OCR run was not started because the tool does not select Markdown input, so repeating the same review would still provide zero coverage. The two completed compliance reviews and their triage remain the local review evidence for this documentation-only change.

## Parent plan checks

| Check | Command | Result | Evidence |
| --- | --- | --- | --- |
| Format | `npx prettier --experimental-cli --write project-plans/issue2016/PLAN.md project-plans/issue2016/execution-tracker.md` | Passed, exit 0 | `tmp/issue2016/final-doc-prettier.log` |
| Format check | `npm run format:check` | Passed, exit 0 | `tmp/issue2016/final-doc-format-check.log` |
| Doc links | `npm run lint:doc-links` | Passed, exit 0 | `tmp/issue2016/final-doc-links.log` shows `doc-links guard PASSED` |
| Doc placement | `npm run lint:doc-placement` | Passed, exit 0 | `tmp/issue2016/final-doc-placement.log` shows `doc-placement guard PASSED` |
| CLI test discovery | `npm run lint:cli-test-discovery` | Passed, exit 0 | `tmp/issue2016/final-doc-cli-discovery.log` shows all 716 tracked CLI test files discovered exactly once |

## Final verification cycle

The post-review candidate ran the repository cycle in sequence. `npm run test`, `npm run typecheck`, `npm run format`, and `npm run build` passed. Full-tree ESLint passed with the heap required by this checkout. The user selected the available `zai` profile for the startup smoke, and that smoke passed.

### Tests

The first post-review `npm run test` run encountered one `spawnSync bun ETIMEDOUT` in `packages/core/src/core/modelLimitsParity.test.ts`. The same test passed immediately with the package preload in `tmp/issue2016/post-ocr-model-limits-parity.log`. The complete rerun then passed with exit 0 in `tmp/issue2016/post-ocr-npm-test-rerun.log`: core passed 581/581 files, providers passed 379/379 files, CLI passed 716/716 files, and the CLI summary reported `9216 passed, 0 failed, 5 skipped, 13 todo (9234 total)`.

### Lint

The exact `npm run lint` wrapper fixes ESLint's V8 heap at 12,288 MB. It exhausted that heap and terminated with SIGABRT under Node 25 and temporary Node 24.20.0. The Node 24 evidence is in `tmp/issue2016/final-gates-lint-node24.log`.

The full-tree command used the same ESLint target and warning policy with a 24,576 MB heap: `NODE_OPTIONS=--max-old-space-size=24576 ./node_modules/.bin/eslint . --max-warnings 0`. It passed with exit 0 in `tmp/issue2016/final-gates-eslint-24gb.log`. The only command difference was the process heap. This establishes clean full-tree lint results while preserving the exact wrapper's resource-limit outcome.

### Typecheck, format, and build

The final sequential `npm run typecheck`, `npm run format`, and `npm run build` commands each passed with exit 0. Evidence is in `tmp/issue2016/post-ocr-typecheck.log`, `tmp/issue2016/post-ocr-format.log`, and `tmp/issue2016/post-ocr-build.log`.

### Startup smoke

Earlier `stepfun-37` attempts reached the provider and returned HTTP 400 with `you have no active step plan subscription`. Those outcomes remain recorded under `tmp/issue2016/remediation/`, `tmp/issue2016/final-remediation/`, and `tmp/issue2016/post-ocr-smoke-stepfun-37.log`.

The user directed this verification to use the available `zai` profile. `bun scripts/start.ts --profile-load zai "write me a haiku and nothing else"` passed with exit 0 and returned a three-line haiku from `zai:glm-5.3`. Evidence is in `tmp/issue2016/post-ocr-smoke-zai.log`.

## Parent completion evidence checklist

- [x] Current issue titles and bodies inspected for #2016 through #2025.
- [x] `dev-docs/PLAN-TEMPLATE.md`, `dev-docs/RULES.md`, and `dev-docs/tmux-harness.md` inspected.
- [x] Root and CLI package scripts and structural Bun test discovery inspected.
- [x] All `scripts/tmux-harness*.ts` modules, `scripts/tests/interactive-ui.test.ts`, and `.github/workflows/interactive-ui.yml` inspected.
- [x] Profile-load ownership assigned to #2023 and dialog composer gating assigned exclusively to #2020.
- [x] Scenario-level CI overrides and the `issue2203-tui-smoke` script explicitly assigned to #2017.
- [x] Direct terminal hook coverage assigned to #2024 and `useLayoutMeasurement.ts` coverage to #2025.
- [x] Exclusive ownership and overlap boundaries recorded for #2017 through #2025.
- [x] Child implementation explicitly excluded from this parent.
- [x] `npm run test`, full-tree ESLint, `npm run typecheck`, `npm run format`, `npm run build`, scoped Prettier, `npm run format:check`, `npm run lint:doc-placement`, `npm run lint:doc-links`, and `npm run lint:cli-test-discovery` have passing evidence.
- [x] The user-selected `zai` startup smoke passed with exit 0.
- [x] Final Git status and diff show only `project-plans/issue2016/PLAN.md` and `project-plans/issue2016/execution-tracker.md`.
- [x] Failed and transient attempts remain identified by their own logs and are not cited as passes.

The accepted parent behavior has local evidence. Review findings are triaged, the post-review test rerun passes, full-tree lint is clean, typecheck and build pass, formatting and document guards pass, and the user-selected startup smoke passes.
