# PLAN-20260827-ISSUE2017: Core Ink UI terminal journeys

Issue: #2017, Add tmux and PTY coverage for core Ink UI journeys

## Accepted behavior

The issue expands the existing Ubuntu-only `interactive-ui` lane. It does not
change end-user UI behavior. Real-terminal tests are accepted only where tmux is
needed to prove terminal rendering, key routing, or resize propagation. Existing
Bun component and buffer tests remain responsible for non-terminal logic.

Two journey families from the original plan were removed from this branch because the work
is already being delivered by two open PRs:
- Tool approval deny/Escape journeys are owned by PR #3308.
- Session-browser open/navigation/search/exit coverage is owned by PR #3310.

### REQ-2017-001: Provider and model selection smoke flow

- **GIVEN** the fake provider and its `fake-model`, without external credentials
- **WHEN** the user invokes the provider and model commands and opens their
  selection dialogs
- **THEN** the CLI renders deterministic provider/model feedback; provider Tab
  changes modes; typed search input filters each one-item fake list to zero;
  Backspace restores each list; Escape dismisses each dialog; and the composer
  remains usable
- **AND** each keyboard action is followed by an observable wait/expect that
  fails if the key is ignored
- **AND** no provider-switch failure or `[API Error:` output appears.

Boundary: FakeProvider exposes one provider/model pair, so search/filter state
provides falsifiable keyboard interaction without claiming directional movement
or a credentialed cross-provider switch. Existing real-provider reproduction
scripts remain manual and are not added to CI.

### REQ-2017-002: Clean-runner welcome journey

- **GIVEN** an isolated, nonexistent welcome-config path for each test run
- **WHEN** the CLI starts and the user selects the skip-onboarding option
- **THEN** the welcome heading, both choices, and keyboard help render; the skip
  action reaches the composer; and the CLI exits normally
- **AND** any welcome-state write is confined to the scenario artifact
  directory.

Boundary: repeated runs must not inherit a prior run's completed welcome state.
No user or repository configuration may be modified.

### REQ-2017-003: Real terminal resize and reflow

- **GIVEN** clean config/data/cache/log roots beneath the scenario artifact
  directory and an unlocked fake-provider session persisted there through the
  existing session-recording service before `/continue`
- **WHEN** the session browser opens at standard width and the harness resizes
  the terminal below the UI's narrow breakpoint, then restores the original size
- **THEN** Ink receives the real terminal resize, the browser hides its
  standard-width sort bar when narrow, restores it when widened, remains live,
  and exits normally
- **AND** the scenario neither reads nor writes user, repository, or sibling
  scenario session storage.

The browser here is only an observable responsive surface; its open/navigation/search
behavior is owned by PR #3310 and is not re-tested in this lane. The resize
step's Ink reflow assertion is the accepted subject.

The harness accepts a data-driven `resize` step with positive integer `cols` and
`rows` and an optional nonnegative `settleMs`. Invalid dimensions fail before a
tmux command runs. The step uses the harness's isolated tmux server and targets
the active test window. Its default settle interval covers the current resize
debounce and deferred refresh. Unknown step types continue to fail.

Boundary dimensions for behavioral evidence: 110 columns at standard width,
58 columns at narrow width, and restoration to 110 columns.

### REQ-2017-004: Unicode and wide-character composer rendering

- **GIVEN** a real tmux terminal and an unsubmitted composer value containing
  CJK, emoji, accented text, and a combining character
- **WHEN** the value is entered and captured at standard and narrow widths
- **THEN** the standard-width screen contains the intact value, narrow-width
  capture demonstrates wrapping without replacement characters or duplicated
  input, and the composer can be cleared and exited.

The tmux assertion proves terminal round-trip and visible rendering. Existing
text-buffer and width unit tests remain responsible for exact cell-width and
grapheme algorithms.

### REQ-2017-005: Single-platform, artifact-rich lane and path contract

- Every accepted journey runs from `scripts/tests/interactive-ui.test.ts` under
  `npm run test:interactive-ui` on the existing `ubuntu-latest` job.
- Each scenario has a distinct artifact directory and captures screen and
  scrollback at the relevant decision points. Existing pane output, final
  failure captures, and CLI debug logs remain available in the uploaded
  `interactive-ui-artifacts` tree.
- New scenario paths are listed explicitly and symmetrically under the
  workflow's pull-request and push filters. Broad scripts globs remain
  prohibited by the issue #2693 path contract.
- The path-contract test describes the complete executed scenario set: the
  three pre-existing scenarios plus the four accepted above.

### REQ-2017-006: Harness resize behavior tests

- A Bun test written before the resize implementation proves valid resize
  command construction, isolated active-window targeting, invalid dimensions,
  invalid settle intervals, and continued unknown-step rejection.
- The test exercises the real exported step dispatcher and replaces only tmux
  process I/O at the operating-system boundary.

### REQ-2017-007: Focused documentation

- `dev-docs/tmux-harness.md` documents resize fields, validation, targeting,
  default settling, and real-terminal reflow assertions.
- Only the Interactive UI path-contract section of
  `dev-docs/ci-relevance-guide.md` changes. It lists seven executed scenarios
  and their explicit direct paths.

### REQ-2017-008: Candidate verification

- The resize and workflow path-contract Bun tests pass.
- Each of the four accepted scenarios passes individually with artifacts under
  distinct repository-local `tmp/verify2017/interactive-ui/` directories.
- The enabled seven-scenario lane passes with its configured artifact root.
- Test-audit findings for touched tests are compared against `main` and
  inspected.
- The complete repository verification cycle passes on the candidate tree:
  tests, lint, typecheck, format, build, and the user-approved `zai` smoke
  command. The original `stepfun-37` profile was replaced after it returned an
  account-level HTTP 400 for an inactive Step plan subscription.

## Behavioral evidence required

1. The provider/model scenario proves deterministic command feedback; observable
   provider mode switching; provider/model filter-to-zero and restoration;
   Escape dismissal; no switch/API failure; and clean exit.
2. The welcome scenario proves clean-state rendering, skip selection, isolated
   state persistence, composer arrival, and clean exit.
3. The resize scenario proves clean artifact-local storage, one readable and
   unlocked fake-provider session before `/continue`, and
   standard-to-narrow-to-standard reflow through real tmux dimensions, not a
   mocked React width.
4. The Unicode scenario proves intact terminal round-trip at standard width and
   records narrow wrapping without replacement characters.
5. The harness test proves the resize dispatch and validation contract.
6. The path-contract test proves seven direct scenario paths, the resize seed
   input, prohibited broad globs, and symmetric pull-request and push filters.
7. Local individual and enabled-lane runs preserve artifacts beneath
   `tmp/verify2017/interactive-ui/`.
8. All added tests use TypeScript and `bun:test`. No new JavaScript, Vitest suite,
   dependency, public API, or multi-platform matrix is accepted.

## Test-first implementation phases

### Phase 0: Preflight

- Verify current harness dispatch and isolated tmux I/O contracts.
- Run the current path-contract test and record the current enabled scenario
  list.
- Confirm tmux availability/version and run one existing deterministic scenario
  before changing the harness.

### Phase 1: RED, resize behavior

- Add `scripts/tests/tmux-harness-steps.test.ts` with Bun behavioral tests for
  REQ-2017-006.
- Run it and record the natural failure because `resize` is unknown. The retained
  chronological RED is `tmp/verify2017/resize-red.log`; it begins with
  `Unknown step.type: resize` before the resize implementation existed.

### Phase 2: GREEN, resize primitive

- Add only the `resize` step and its validation to
  `scripts/tmux-harness-steps.ts`.
- Use existing isolated `runTmux` and `sleep` dependencies. Do not add a harness
  abstraction or change unrelated helpers.
- Document the primitive in `dev-docs/tmux-harness.md`.

### Phase 3: Deterministic journey scenarios

- Add focused JSON scenarios for provider/model smoke, welcome, resize, and
  Unicode composer rendering.
- Persist the resize scenario's fake-provider session through the existing
  session-recording service under artifact-local storage. Flush and unlock it
  before starting the CLI, then require exactly one readable browser target.
- Keep each scenario independent, polling for UI states instead of synchronizing
  through long fixed sleeps.

### Phase 4: Lane and path-contract wiring

- Register the four accepted journeys in
  `scripts/tests/interactive-ui.test.ts`, with per-run welcome state under its
  artifact directory.
- Add each direct scenario path symmetrically to
  `.github/workflows/interactive-ui.yml`.
- Update `scripts/tests/interactive-ui-paths.bun.test.ts` and the Interactive UI
  section of `dev-docs/ci-relevance-guide.md` without changing other workflow
  relevance policies.

### Phase 5: Verification

Run the four scenarios individually, the enabled lane, test audit against
`main`, and then the repository verification cycle:

```bash
bun test scripts/tests/tmux-harness-steps.test.ts
bun test scripts/tests/seed-session-browser-resize.test.ts
bun test scripts/tests/interactive-ui-paths.bun.test.ts
bun scripts/tmux-harness.ts --script scripts/tmux-script.provider-model.json --out-dir tmp/verify2017/remediation/provider-model
bun scripts/tmux-harness.ts --script scripts/tmux-script.session-browser-resize.json --out-dir tmp/verify2017/remediation/resize
LLXPRT_TMUX_ARTIFACT_DIR=tmp/verify2017/remediation/interactive-ui npm run test:interactive-ui
bun scripts/test-audit/scan.ts tmp/verify2017/remediation/test-audit-branch
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load zai "write me a haiku and nothing else"
```

All commands run on the candidate working tree. Remediation artifacts use
distinct directories below `tmp/verify2017/remediation/`. The enabled lane
covers the unchanged welcome and Unicode scenarios after the focused provider
and resize runs. Findings are classified before the working tree is presented
for compliance review.

## Finding classification

- **Blocker-Fix:** breaks an accepted journey, safety, test validity, CI,
  architecture, TDD, lint, typecheck, source/complexity limits, or artifact
  availability.
- **In-scope-Fix:** an issue in the changed harness step, journey scripts, lane
  wiring, path contract, or issue documentation that does not expand behavior.
- **Reject:** factually incorrect, already satisfied, or asks for weaker tests or
  quality gates.
- **Defer:** useful but outside accepted behavior, recorded without implementation.

## Out of scope (owned by other PRs)

- Tool approval deny-by-label and Escape-dismiss journeys are owned by PR #3308.
- Session-browser open, navigation, search, and exit coverage is owned by PR
  #3310. The retained resize scenario uses the browser only as a responsive
  surface for Ink reflow assertions. It makes no claim of browser navigation
  coverage and leaves the existing `tmux-script.session-browser.json` unchanged.

## Explicitly rejected or deferred

- Cross-provider testing that requires credentials or hosted models.
- Multi-platform tmux/PTY matrices, lane splitting, new workflows, or changes to
  unrelated workflow relevance rules.
- New dependencies, agent memory, quality tools, public harness abstractions, or
  broad harness refactors.
- Exact Unicode cell-coordinate assertions beyond what tmux capture can observe.
- Adjacent session-browser, provider, onboarding, approval, responsive-layout,
  or composer production behavior changes discovered while adding coverage.
- Deleting or reorganizing the older standalone session-browser wrapper as
  cleanup. The dedicated lane may call the scenario directly.

## Review finding disposition

Two compliance-review rounds and two local OCR attempts exhausted the issue's
review limits. All compliance Blocker-Fix and In-scope-Fix findings were
resolved before final verification. The final local OCR completed all 11
selected items and reported two additional findings:

1. **Reject:** The reported risk that an unset
   `LLXPRT_TMUX_ARTIFACT_DIR` could turn scenario cleanup into `rm -rf /storage`
   does not match the harness execution path. `runMain` always resolves a
   nonempty artifact directory, using a generated directory under the operating
   system temporary directory when `--out-dir` is absent, before passing it to
   `buildTmuxStartCommand`. The builder therefore always sets the environment
   variable for a normal harness run.
2. **Defer:** Rejecting an `extraEnv.LLXPRT_CODE_WELCOME_CONFIG_PATH` collision
   could make future harness misuse fail earlier, but no current caller supplies
   that key. The accepted issue behavior makes the dedicated `welcomeState`
   parameter the sole welcome-state control and intentionally applies the
   artifact-local path after `extraEnv` so a caller cannot defeat test isolation.
   A new collision API and its tests are optional harness hardening outside this
   issue's accepted behavior.

## PR review disposition

- **In-scope-Fix, CodeRabbit active-window target:** The resize command now uses
  the session-only target so tmux selects the isolated session's active window.
- **In-scope-Fix, OCR welcome JSON parsing:** The welcome scenario parses the
  persisted JSON as `unknown` and checks the required semantic fields.
- **Reject, OCR `import.meta.main` claim:** Bun
  [documents `import.meta.main`](https://bun.com/docs/runtime/module-resolution#import-meta),
  and the passing seven-scenario CI lane proves that the seeder entry point ran.
- **Reject, OCR invalid-dimension expected-message claim:** Parameterized field
  interpolation produces the exact implementation strings, and the tests passed
  locally and in CI.
- **Reject, OCR `settleMs` expected-message claim:** The test and implementation
  strings are identical and passed.
- **Reject, OCR unknown-step expected-message claim:** The test and implementation
  strings are identical and passed.
- **Reject, OCR top-level try/catch suggestion:** Bun reports a rejected top-level
  await and exits nonzero. Adding catch, log, and exit wrapping would duplicate
  the existing fail-fast runtime behavior.
- **Defer, CodeRabbit docstring coverage finishing-touch warning:** CI does not
  require it, repository style does not require docstrings for each small test
  helper, and adding comment volume is outside accepted behavior.
- **Reject, CodeRabbit linked-issues inconclusive check:** CodeRabbit's own JSON
  review exclusion prevented it from reading the four scenario definitions.
  The scenarios run in the local and CI tmux lanes, and changing review-tool
  configuration to make that optional check conclusive would be an unplanned
  quality-tool change outside this issue.

## Candidate-head OCR review disposition

- **Reject, broad-glob header claim:** The same test file explicitly rejects
  `scripts/tests/**`, `scripts/fixtures/**`, and `scripts/tmux-script*.json`.
  The finding considered only the separate duplicate-scenario assertions.
- **Reject, session-browser response fixture claim:** The resize journey makes no
  provider request. The existing response file supplies valid fake-provider
  configuration shared by the new no-request scenarios, and the suggested
  session-browser fixture does not exist.
- **Reject, assertion-tracking guard claim:** The guard performs required TypeScript
  narrowing after the length assertion. This fail-fast test pattern is established
  throughout the repository and produces a precise failure message.
- **Reject, duplicated seeder constants claim:** The fixed UUID, provider, model,
  message, and unlocked state are the deterministic seeder contract. The scenario
  depends on that stable data, so exact assertions are intentional.
- **In-scope-Fix, model capture label:** The capture follows filter restoration,
  not a second keyboard-focus transition. Its label now describes the observed
  state as `model-dialog-filter-restored`.
