# Issue 2025 — Increase Ink layout and rendering regression coverage

Test-only change. No production behavior is added or modified. Every test below
must fail if the corresponding production branch is inverted or removed.

## Scope

In scope:

- `packages/cli/src/ui/inkRenderOptions.ts` — the alternate-buffer /
  incremental-rendering gate.
- `packages/cli/src/ui/layouts/DefaultAppLayout.tsx` — buffer branch selection,
  static-region gating, live-controls mounting.
- `packages/cli/src/ui/layouts/DefaultAppLayoutHelpers.tsx` — `useStaticItems`
  header suppression, `useLayoutSettings.useAlternateBuffer`.
- A tmux startup-smoke scenario plus its wiring into
  `scripts/tests/interactive-ui.test.ts`, `.github/workflows/interactive-ui.yml`
  path filters, and `scripts/tests/interactive-ui-paths.bun.test.ts`.

Out of scope (do not touch): production source changes, tmux harness step
types, new abstractions, refactors of existing tests beyond what a new
scenario's path contract requires.

## Findings that constrain the test design

Empirically verified in this repo with real Ink + `ink-testing-library`:

1. `<Static items={[]}>` and `null` produce **byte-identical** output and the
   same frame count. Therefore a test that asserts "`<Static>` is not rendered
   when `staticItems` is empty" by inspecting rendered output is **not
   falsifiable** against the `staticItems.length > 0` guard in
   `StandardBufferLayout`. Do NOT write such a test — it can never fail for the
   right reason.

   The falsifiable behavior behind that acceptance item is: **static content is
   produced exactly when there is static content to show**, which is governed by
   `useStaticItems` (header suppression + history), and whether that content
   reaches the frame in standard-buffer mode.

2. A fixed-height root `Box` (`height={terminalHeight}`, `overflow="hidden"`) —
   the alternate-buffer viewport — renders a frame padded to exactly
   `terminalHeight` lines. The standard-buffer root (`width="90%"`, no height)
   renders only as many lines as its content. Frame line count is therefore a
   real, mock-free discriminator between the two branches.

3. `packages/cli/test-utils/ink-testing-library.ts` renders through real Ink
   with `debug: true` and a stdout whose `columns` is fixed at **100**. Keep
   test terminal widths at or below 100.

4. `ink` is redirected to `test-utils/ink-stub.ts` by a Bun plugin in
   `packages/cli/bun-test-setup.ts`. Tests that need real Ink must
   `vi.mock('ink', () => realInkModule)` with
   `../../../test-utils/real-ink.js`, exactly as
   `packages/cli/src/ui/layouts/InlineContent.test.tsx` does.

5. `UIStateContext` and `UIActionsContext` both export the raw context objects.
   New tests must supply state through the real providers/contexts rather than
   `vi.mock`-ing the context modules, so the component under test runs against
   real context plumbing.

## Acceptance criteria

### AC1 — Incremental rendering is gated on alternate buffer

`inkRenderOptions` (`packages/cli/src/ui/inkRenderOptions.test.ts`):

- AC1.1 `useAlternateBuffer: false` + `incrementalRendering: true` →
  returned options have `alternateBuffer: false` **and**
  `incrementalRendering: false`. (Currently uncovered: the existing
  standard-buffer case omits `incrementalRendering` entirely, so the gate is
  never exercised with the setting explicitly on.)
- AC1.2 `useAlternateBuffer` omitted (undefined) + `incrementalRendering: true`
  → `alternateBuffer: false`, `incrementalRendering: false`.

Existing cases already cover screen-reader override, alt-buffer default-on, and
explicit `incrementalRendering: false`. Do not duplicate them.

### AC2 — `useStaticItems` produces static content only when it exists

New or extended component-level test for
`packages/cli/src/ui/layouts/DefaultAppLayoutHelpers.tsx`:

- AC2.1 `LLXPRT_CODE_SUPPRESS_STATIC_HEADER='true'` + empty history → returns an
  empty array (no header, no history).
- AC2.2 `LLXPRT_CODE_SUPPRESS_STATIC_HEADER='true'` + two history items →
  returns exactly two elements, in history order, keyed by history id, none of
  which is the `AppHeader`.
- AC2.3 env var unset + empty history → returns exactly one element, the
  `AppHeader`, keyed `'header'`. With history, the header stays first, ahead of
  the history elements.
- AC2.4 env var set to a value other than `'true'` (e.g. `'1'`) + empty history
  → header is still present (the check is a strict `'true'` comparison).

Env mutation must go through `setEnv`/`restoreEnv` from
`@vybestack/llxprt-code-test-utils` (see `InlineContent.test.tsx`), restored in
`afterEach`.

### AC3 — Standard-buffer rendering surfaces static content and live controls

New rendering test for `DefaultAppLayout` under real Ink, standard-buffer
settings (`ui.useAlternateBuffer: false`), no dialog open:

- AC3.1 With the static header suppressed and empty history, the live-controls
  region is mounted: the `mainControlsRef` passed in by the test is populated
  after render (non-null `DOMElement`), and the root `rootUiRef` is populated.
  This is the "live controls render when the static header is suppressed"
  criterion, asserted through real refs rather than a spy.
- AC3.2 With the static header suppressed and one history item whose text is a
  test-supplied literal, the rendered frame contains that literal — static
  content reaches the frame in standard-buffer mode.
- AC3.3 With the static header suppressed and empty history, the rendered frame
  does not contain the AC3.2 literal (no leakage / no phantom static content).

### AC4 — Buffer selection is honored by the layout

Same rendering test file, using frame geometry as the discriminator
(finding 2 above). Use `terminalHeight` well above the natural content height
(e.g. 24) and `terminalWidth <= 100`:

- AC4.1 `ui.useAlternateBuffer: true`, screen reader off → the rendered frame
  has exactly `terminalHeight` lines (fixed-height alternate-buffer viewport).
- AC4.2 `ui.useAlternateBuffer: false` → the rendered frame has fewer than
  `terminalHeight` lines (content-height standard-buffer root).
- AC4.3 `ui.useAlternateBuffer: true` **and** the runtime reports screen reader
  enabled → the frame has fewer than `terminalHeight` lines, i.e. the layout
  falls back to the standard buffer. This is `useLayoutSettings`' screen-reader
  gate, honored at the layout level (mirroring AC1's gate at the options level).
- AC4.4 In both AC4.1 and AC4.2 the live-controls ref is populated, so neither
  branch drops the live controls.

### AC5 — tmux startup smoke

- AC5.1 New scenario `scripts/tmux-script.startup-smoke.json` that starts the
  CLI under the same tmux child env override used by the other interactive
  scenarios (`CI=0 CONTINUOUS_INTEGRATION=0 NODE_OPTIONS= …
  LLXPRT_CODE_SUPPRESS_STATIC_HEADER=true`) and, on a clean startup with no user
  input:
  - waits, with a single regex matcher so all landmarks must be present in the
    SAME screen, for the composer placeholder followed by the live-controls
    footer landmarks (`Context:`, `Tokens:`). This is the "first meaningful
    frame contains the composer" plus "no blank frame" assertion: a blank frame,
    or a frame carrying only part of the live controls, fails the wait,
  - captures the startup frame as an artifact,
  - asserts the composer appears exactly once (no duplicated/ghost frame),
  - asserts the static header is genuinely suppressed (`Tips for getting
    started` count is 0), so the scenario covers the empty-static-region
    startup rather than a header-populated one,
  - exits via `/quit` and `waitForExit`.

  `LLXPRT_SYSTEM_SETTINGS_PATH` must be an ABSOLUTE path
  (`$PWD/scripts/system-settings.interactive-ui.json`). `Storage` ignores a
  relative override, and with the override ignored the schema default
  (`useAlternateBuffer: true`) wins, which would silently run this scenario on
  the alternate-buffer path instead of the standard-buffer path it is meant to
  cover. Verify via the `renderOptions alternateBuffer=… incrementalRendering=…`
  line in the run's `cli-debug.log` artifact that both are `false`.

  Steps must use only existing harness step types (`waitFor`, `capture`,
  `expect`, `expectCount`, `line`, `waitForExit`) and existing matcher fields
  (`contains`, `regex`, `regexFlags`). Do not add harness features.

- AC5.2 The scenario is wired into `scripts/tests/interactive-ui.test.ts` via
  the existing `runHarness` / `assertHarnessSuccess` helpers and is gated behind
  `LLXPRT_E2E_TMUX=1` like its neighbors.
- AC5.3 `.github/workflows/interactive-ui.yml` includes the new scenario JSON in
  both the `pull_request` and `push` path filters (they must stay symmetric).
- AC5.4 `scripts/tests/interactive-ui-paths.bun.test.ts` is updated so its
  "executed scenario JSON files" contract covers the new scenario. Its
  three-scenario wording/assertion becomes a four-scenario contract. No other
  assertion in that file changes.

## Non-goals / explicit rejections

- No test that asserts `<Static>` is absent for empty items via rendered output
  (finding 1 — unfalsifiable).
- No `toHaveBeenCalledTimes` assertions on component render spies in the new
  tests; assert on real rendered output, real refs, or real return values.
- No marker strings invented inside a mock and asserted back (mirror echo).
  Literals asserted in frames must originate from test *input* (e.g. history
  item text).
- No changes to production files.

## Verification

Full cycle before any push:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Plus, for the new tmux scenario, a local run of the harness against it:

```bash
npm run test:interactive-ui
```

Plus the test-audit scanner on touched files: `bun scripts/test-audit/scan.ts`
must report no new MOCK_MIRROR / ALWAYS_TRUE / SELF_CONFIRMING / NO_ASSERT
findings.

### Falsification evidence required

For every new test, record (in the PR body) the mutation that was applied to
production code to prove the test fails, e.g.:

- AC1: remove the `useAlternateBuffer &&` conjunct in `inkRenderOptions`.
- AC2: invert the `=== 'true'` check in `useStaticItems`.
- AC3/AC4: swap the `layoutSettings.useAlternateBuffer` branch in
  `renderLayout`; drop the `MainControls` box.
- AC5: verified by the scenario passing against a real CLI startup.
