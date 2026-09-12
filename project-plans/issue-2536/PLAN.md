# Issue #2536 — Re-architect React/Ink UI state, dialogs, and subscriptions

Branch: `issue2536` · Plan owner: driver session · Implementation: typescriptexpert subagents

## 1. Shaped acceptance criteria

Scope rule: functionality-based. The LOC/file numbers below are measurements of
surfaces (for before/after reporting), not the definition of done.

### AC1 — UI architecture doc

A doc (dev-docs/ per durable-reference rules, candidate:
`dev-docs/architecture/ui-stores.md`) defines:

- ownership of each store (Dialog, Terminal, Turn, SettingsProfile) and the
  runtime services boundary (RuntimeContext / cliUiRuntime / agent),
- subscription rules (narrow selectors; no whole-store object reads),
- dialog lifecycle (typed union, stack semantics, priority, modal focus), and
- headless/noninteractive separation (noninteractive/ never touches the
  interactive stores).

Test: `scripts/check-doc-placement.ts` passes; doc reviewed in PR.

### AC2 — AppContainerRuntime stops projecting through bags

`packages/cli/src/ui/AppContainerRuntime.tsx` becomes a composition root: it
creates/owns store instances (stable identity), mounts the domain hooks, and
provides stores through stable contexts. The bag builders
(`buildInputParams`, `buildLayoutParams`, `buildUIStateParamsCore`,
`buildUIStateParamsExtra`, `dialogActionsParams`, `buildUIActionsParams`,
`extraDialogActions`) are deleted. Hooks receive params as typed objects that
carry only what they own (services + stores), not cross-projections of other
hooks' results.

Boundary cases: StrictMode double-mount (store instances must not leak across
mounts or double-subscribe), resumed sessions (`resumedHistory`), suppressed
welcome, unconfigured provider guidance.

### AC3 — Projection builders removed

`buildUIState.ts`, `buildUIActions.ts`, `useUIStateBuilder.ts`,
`useUIActionsBuilder.ts` (+ their tests) deleted. Retained code must perform
real domain logic — none of these do (they are field-copy projections), so all
four go. `UIStateContext.tsx` and `UIActionsContext.tsx` are deleted after
consumer migration (AC4).

### AC4 — Stable stores + narrow selectors replace giant contexts

Four stores in `packages/cli/src/ui/stores/`:

| Store | Owns | Examples |
|---|---|---|
| `DialogStore` | dialog stack, priority, confirmations | `{kind, payload}[]`, confirmationRequest, extension-update confirms |
| `TerminalStore` | dimensions, widths, focus, capabilities | terminalWidth/Height, inputWidth, isNarrow, footerHeight, availableTerminalHeight, isFocused, isInputActive, screenReader/alternate-buffer capability |
| `TurnStore` | streamed/committed turn data, cancellation | history, pendingHistoryItems, streamingState, thought, queuedSubmissions, elapsedTime, currentLoadingPhrase, quittingMessages, ctrlC/ctrlD once state, isProcessing, staticKey |
| `SettingsProfileStore` | settings/model/profile projection | settings, settingsNonce, currentModel(+label), contextLimit, providerOptions/selectedProvider, profile list/detail data, ideContext, error counts |

Mechanism: a ~60-LOC store primitive (`createStore` with
`getState/subscribe/setState`) plus `useStoreSelector` on
`useSyncExternalStore`. No new npm dependency. Contexts expose the store
objects (stable identity — provider value never changes).

Field placement follows "who owns the write": e.g. `renderMarkdown`,
`showToolDescriptions`, `showErrorDetails`, panel-collapse flags, and
`copyMode` are display preferences → TerminalStore (view/capability plane).
`commandContext`/`slashCommands` are runtime service projections → provided by
composition root (not re-created per render).

Boundary cases: tearing (single store instance per app), selector stability
(primitive selectors return cached values; object selectors memoized or
compared), resize storms (TerminalStore updates must not rerender dialog
subscribers).

### AC5 — Dialog state is a typed discriminated stack

`DialogRequest` discriminated union with one variant per dialog kind:
workspaceMigration, idePrompt, folderTrust, welcome, confirmation,
extensionUpdateConfirm, theme, settings, auth, oauthCode, editor, provider,
loadProfile, createProfile, profileList, profileDetail, profileEditor, tools,
privacy, permissions, logging, subagent, models, sessionBrowser, modelConfig,
policies. Payloads carry the open-time data (logging entries, models filters,
subagent initial view/name, provider lists, welcome data ref).

Semantics (must match observed behavior):

- `open(request)`: push; if same kind already open, replace payload in place
  (idempotent reopen, mirrors boolean semantics).
- `close(kind)`: remove that entry.
- Rendering: single active dialog = highest-priority open request. Priority
  ranking reproduces today's DialogManager if-chain order: early dialogs
  (workspaceMigration > idePrompt > folderTrust > welcome > confirmation >
  extensionUpdateConfirm) then body order (theme, settings, auth, oauthCode,
  editor, provider, loadProfile, createProfile, profileList, profileDetail,
  profileEditor, tools, privacy, permissions, logging, subagent, models,
  sessionBrowser, modelConfig, policies).
- confirmationRequest stays a 1-slot queue (open replaces pending), extension
  confirms stay a FIFO list rendered head-first.

Deleted: `appReducer` `openDialogs` map + `OPEN_DIALOG`/`CLOSE_DIALOG` actions
(keep warnings/needsRelogin/ADD_ITEM machinery intact),
`useDialogOrchestration` boolean/payload families, per-hook
`isXDialogOpen`/`openXDialog`/`exitXDialog` plumbing where it is pure
open/close state (hooks keep domain handlers like `handleThemeSelect`),
`DialogStore`-overlapping fields in `useDialogsState`.

Boundary cases: opening a dialog while another is open (priority decides),
opening the same dialog twice, closing a dialog that is not open (no-op),
Escape/exit paths per dialog component unchanged, OAuth dialog dismissal race
(AppContainer.oauth-dismiss.test.ts), cancel-race (cancel must not deadlock on
dialog state).

### AC6 — Obsolete helpers/aggregates/pass-throughs deleted

- `UIState`, `UIActions` interfaces and providers.
- `useDialogOrchestration.ts`, boolean families in feature hooks.
- Bag builders in AppContainerRuntime.
- One-caller pass-through layers reviewed (issue slice 5): inline only when the
  layer owns nothing, has no boundary/responsive/focus behavior, and is not a
  useful seam. Commands stay out of views.

### AC7 — Behavior retention

Unchanged behavior, proven by the existing suites running green plus targeted
new tests: cancellation/stale turns (AppContainer.cancel-race.test.tsx,
hooks-system suite), tools, history, provider/model switching
(useModelRuntimeSync, useProviderDialog flows), responsive layout
(DefaultAppLayout.rendering.test.tsx), virtualization, input/Vim (keyMatchers,
text-buffer tests), focus/keyboard (useShellFocusAutoReset,
useInputHandling.inputActive), folder trust/confirmation (trustDialogHelpers,
ConsentPrompt flows), accessibility (screen-reader paths, emoji filter),
noninteractive mode (noninteractive/ + integration smoke).

### AC8 — Render isolation tests

New bun tests render probe components subscribing to different stores and
assert rerender counts: a DialogStore update rerenders only dialog
subscribers; a TerminalStore resize rerenders only terminal subscribers; a
TurnStore history append does not rerender terminal/dialog subscribers. Also a
test that opening a dialog does not rerender the history/transcript region.

### AC9 — Fixture reduction, reported

Before/after fixture-field counts for representative render tests
(DefaultAppLayout.rendering.test.tsx today builds ~80 fields incl. 24 dialog
booleans for a layout-only test). After: tests seed only the stores they
exercise. Report numbers in the PR body and this plan's Metrics section.

### AC10 — No new state dependency; plumbing deleted not wrapped

No new npm deps. Old files deleted (git rm), not left as wrappers. `grep`
checks in review: no remaining references to UIStateContext/UIActionsContext,
builders, `openDialogs`.

## 2. Design decisions

- **Store primitive, not a framework:** `createStore<S>()` returning
  `{getState, setState(next|updater), subscribe(listener)}` with listener-set
  semantics; `useStoreSelector(store, selector)` via `useSyncExternalStore`
  with `useRef`-cached selector result comparison (Object.is default,
  optional equality). Handles React 18 concurrent tearing by construction
  (single synchronous store).
- **Writers are the existing domain hooks.** `useAppBootstrap`, `useAppInput`,
  `useAppLayout`, `useAppDialogs` keep their effects/commands but write to
  stores and lose their giant return bags. Their params shrink to services +
  stores + the few cross-hook values that are true command arguments.
- **DialogManager** becomes a pure function of `useActiveDialog()`; per-dialog
  handlers come from feature hooks exposed once by the composition root.
- **History/Static risk:** TurnStore replaces useHistoryManager's internal
  state; `<Static>` item identity semantics preserved by keeping the same
  item objects and the same addItem/clearItems/loadHistory command
  signatures. SessionController's ADD_ITEM side-effect channel moves to a
  TurnStore subscription (same ordering guarantees: dispatch → effect).
- **Noninteractive:** untouched; stores live under ui/ and are imported only
  by interactive code (doc + import boundary check).

## 3. Delivery slices (implementation order)

1. **Characterize + baseline (Slice A):** record before-metrics (fixture field
   counts per test file, consumer/field usage table, DialogManager if-chain
   order) into this plan's Metrics section; list every behavior suite that
   must stay green.
2. **DialogStore (Slice B):** primitive + DialogStore + DialogManager
   rewrite + migrate all dialog open/close call sites + delete
   useDialogOrchestration, appReducer dialog actions, hook boolean families.
   Verify: targeted tests + full cycle.
   - **B1 (done, 8ca86b6f9):** createStore + useStoreSelector + typed
     DialogStore (26 kinds, priority stack, confirmation slots) +
     DialogProvider + behavior tests.
   - **B2 (done, 72fb06fb4):** DialogStore made fully typed (payload map,
     mapped-union requests), dialogStore.test.ts 19 behavior tests.
   - **B2a (done):** first migration tranche — permissions, logging
     (entries payload), subagent (initialView/initialName payload) moved
     end-to-end to the store: dialogOpeners.ts stable handles;
     useDialogOrchestration loses its 3 payload families; UIState/UIActions
     lose 6 members; DialogManager renders them from selectActiveDialog
     (store reads hoisted into useDialogManagerState — rules-of-hooks);
     useHasActiveDialog (hook) ORs store state with remaining flags;
     AppContainerRuntime becomes the store composition root
     (useRef-created store + memoized openers + DialogProvider tree wrap).
     useSlashCommandActions routes via `dialogs` handles. Suites:
     canonical runner 745/745 files, 9603/9603 cases (see §6 note).
   - **Remaining B slices:** theme/settings/auth/editor/provider/profile
     family/tools/oauth-code tranche (appReducer `openDialogs` deletion);
     workspaceMigration/folderTrust/welcome/idePrompt/privacy/confirmation
     tranche; then delete useDialogOrchestration + builders' dialog params.
3. **TerminalStore + TurnStore (Slice C):** dimensions/focus/display prefs;
   history/streaming/cancellation. Verify.
4. **SettingsProfileStore + delete builders/contexts (Slice D):** migrate
   remaining consumers, delete UIState/UIActions + builders. Verify.
5. **Render isolation tests + one-caller review (Slice E):** AC8 tests,
   fixture reduction, inline pass-throughs, architecture doc final pass.
   Full verification + reviews.

Each slice lands as commits on `issue2536` and must keep `npm run typecheck`
and the targeted bun test files green before the next slice starts.

## 4. Metrics

### Before (measured on `issue2536` @ main, 2026-09-08)

- `UIState` context: **136 fields**; `UIActions` context: **111 members**.
- `AppContainerRuntime.tsx` bag projections: buildInputParams **59** +
  buildLayoutParams **60** + buildUIStateParamsCore **51** +
  buildUIStateParamsExtra **66** + dialogActionsParams **57** +
  buildUIActionsParams **19** = **312 projected fields**.
- Dialog open/close state mechanisms: 3 (appReducer `openDialogs` 12 booleans;
  useDialogOrchestration 7 boolean/payload families; per-feature-hook
  booleans for theme/settings/folder-trust/welcome/provider/editor/load/create
  profile/tools/workspace-migration + privacy/idePrompt in useDialogsState).
- DialogManager renders from 24 `if (uiState.isXOpen)` checks across early +
  first-half + profile + second-half chains.
- Fixture burden (dialog booleans forced into tests):
  - `DefaultAppLayout.rendering.test.tsx`: 75-field `createUIState`, 23 dialog
    booleans — for a layout-only test.
  - `DefaultAppLayout.test.tsx`: 46 dialog-boolean lines.
  - `ThemeDialog.test.tsx`: 21.
  - `integrationWiring.spec.tsx`: 60.
- Plumbing LOC scheduled for deletion/replacement (AppContainerRuntime +
  4 builders + 2 contexts + useDialogOrchestration): **2,042**.
- Context consumers: `useUIState()` in 11 non-test components,
  `useUIActions()` in 3; field usage per consumer is 1–3 fields (verified:
  ThemeDialog 1, Notifications 2, AiMessage/ToolResultDisplay/AiMessageContent
  1 each, ExtensionsList 1, DebugProfiler 1, SubagentManagerDialog 2).

### After

Measured on `issue2536` @ d803d4992 (slice E, 2026-09-11). Fixture fields
counted as everything a test author seeds for one render: store seed
overrides + component props + settings/config stub fields that feed those
props. Dialog fixture fields counted separately, since dialog booleans were
the dominant before-cost.

| Test file | Before | After | Dialog fields before → after |
|---|---|---|---|
| `DefaultAppLayout.rendering.test.tsx` | 75-field `createUIState` | 35–36 (9 TerminalStore seeds + 0–1 TurnStore `history` + 11 `DefaultAppLayout` props + 7 settings stub + 8 config stub) | 23 → 0 |
| `DefaultAppLayout.test.tsx` | 46 dialog-boolean lines | 35 (9 TerminalStore seeds + 11 props + 7 settings stub + 8 config stub); dialogs opened via `store.commands.openDialog` | 46 → 0 |
| `ThemeDialog.test.tsx` | 21 | 5 (1 TerminalStore seed + 4 props) | 0 dialog booleans remained in the UIState slice → 0 |
| `integrationWiring.spec.tsx` | 60 | 1 (the `store` prop on `TestDialogRenderer`; 0 store seed fields; 9 `openDialog`/`closeDialog` command calls drive the flows) | 60 → 0 |

Notes:

- The `DefaultAppLayout.test.tsx` dialog gating suite now iterates
  `DIALOG_PRIORITY` against a real `DialogStore`; the 26-kind table and the
  per-kind payload map are command arguments, not fixture fields.
- Dialog fixture fields are zero everywhere: no test seeds dialog open/close
  booleans. Tests that need an open dialog open one on a real store.
- Isolation guarantees are pinned by
  `stores/__tests__/renderIsolation.test.tsx` (AC8): cross-store updates do
  not rerender other stores' subscribers, and same-store writes to
  unselected fields do not rerender narrow subscribers.

## 5. Risks

- History/Static regression (highest): mitigated by keeping command
  signatures and running cancel-race + rendering suites after every history
  change.
- Focus/keyboard ordering: mitigated by keeping useInputHandling logic
  byte-identical where possible; only its state destination changes.
- Test volume: full `npm run test` is heavy; slices run scoped bun test files
  plus the mandated full cycle before review/PR.

## 6. Verification semantics discovered during Slice B2a

- **The canonical CLI test gate is `bun run-bun-tests.ts`** (what
  `npm run test` invokes): it spawns one `bun test` process per file with
  bounded concurrency, explicitly because "Bun's mock.module registry is
  process-wide, so sharing a process would leak mocks between files."
- **Single-process multi-file `bun test fileA fileB` is not a supported
  mode.** During B2a, `bun test DefaultAppLayout.test.tsx
  DefaultAppLayout.rendering.test.tsx` in one process showed 25 spurious
  failures (whichever file evaluated second lost its vi.mock registrations),
  while every file passes alone. The same artifact explains the three
  InlineContent placeholder failures earlier believed to be pre-existing on
  main: they appear only when InlineContent.test.tsx shares a process with
  DefaultAppLayout*.test.tsx, a combination the canonical runner never
  produces. All per-file runs are green.
- Consequence for later slices: verify with per-file runs or the canonical
  runner; never use multi-file single-process `bun test` as a signal.

## 7. Review outcomes (post-implementation)

Two review rounds ran against the finished branch. Round 1 found eight
items; round 2 verified the remediations. Final state:

- All six behavior regressions fixed and verified with red/green tests
  (queue clearing, built-in themes with custom maps, folder-trust
  transaction ownership,   unlimited history limits, NO_COLOR `/theme`,
  provider info messages).
- Composition root complete: `buildInputParams`/`buildLayoutParams`
  deleted, ownership moved into the owning hooks (keybindings, history
  init, initial prompt to input; loader callbacks/startup readiness to
  SettingsProfileStore). `AppRuntimeView` takes typed props, not hook
  result bags.
- `AppCommands` context is referentially stable; changing input
  snapshots (buffer, commandContext, inputHistory) live in a separate
  `AppCommandData` context.
- Layout split into independently subscribed regions; production-fiber
  isolation test shows transcript renders: dialog open 0, elapsedTime
  tick 0, resize 0 (viewport child updates on resize), history append 1.
- Footer trust became reactive (settings-store field written on
  CoreEvent.FolderTrustChanged) after round 2 found the region split
  could leave the untrusted warning stale in an idle session.
- The #2373 config boundary guard caught one regression during
  remediation (root passed `props.uiRuntime` where main threads
  `bootstrap.streamRuntime`); fixed.

### Known follow-ups (documented, not blocking)

- **`buildAppCommands` remains** as the root's command-surface
  assembler. Round 2 read AC2 as "no aggregate assembly anywhere in the
  root" and flagged it; the implemented interpretation is that the
  composition root legitimately composes the stable command surface
  (handlers only; changing data is separated), and deleting the helper
  would just inline the same assembly into the component body. AC2's
  named builders are gone either way.
- The production isolation test mounts `DefaultAppLayout`, not the full
  `AppContainerRuntime`, and stubs service-heavy leaves (including
  Footer). A full-tree variant would strengthen AC8 further.
- Suite environmental flakes observed under sibling-session load
  (ToolResultDisplay.retention.behavior, sandbox-podman-diagnostics):
  both pass standalone repeatedly; not load-bearing here.

## 8. External review (OCR, glm-5.3) outcomes

Two rounds ran against the branch (round 1: 65/108 files reviewed, 33
findings; round 2 after remediation: 93/118 files, 37 findings; the
remainder failed on provider rate limits — the 2-round cap was reached,
per the review policy). All HIGH findings were fixed with red/green
tests; false positives were verified and skipped with evidence.

Round-1 remediation: three real behavior losses fixed (hook-execution
indicator wiring, pendingAddRequest replay via consume-by-sequence,
theme/editor error banners via SettingsProfileStore), dead migration
leftovers deleted (useSettingsCommand, profile dialog subscriptions,
unused params), type hardening (exhaustive DIALOG_PRIORITY,
ListDialogKind narrowing, shared LogEntry/INITIAL_WELCOME_STATE/width
helpers), nine weak tests strengthened. The reported tools-dialog
regression was verified pre-existing on main (no production trigger
before or after).

Round-2 remediation (all verified real, fixed): /logs dialog crashed on
real log files (schema mismatched the ConversationFileWriter format;
schema corrected, malformed lines now degrade individually); subagent
deep-link commands broken by a processor-actions cast (signatures
fixed, cast removed); welcome gating, first-paint model seeding,
custom-theme apply failures, editor-error staleness, history/ledger
construction identity, trim notification churn, shared history-limits
ownership, and AppCommandData memo identity all restored. Plus ten
cleanup items (vestigial subscriptions, dead reducer error slice, dead
closeDialog returns, FIFO dedup, openers exhaustiveness, typed
BLOCKING_DIALOG_KINDS) and twelve test-quality items (shared typed
AppCommandBindings factory, real typed auth openers, meaningful
identity assertions, coverage for moved side effects).

### Remaining documented follow-ups (not fixed, with reasons)

- Profile dialogs mirror their data one commit after opening (new,
  minor flash of empty list on first open; synchronous seeding in the
  open path is the clean fix if it matters in practice).
- createStore's function-shaped-state ambiguity is theoretical for the
  current object stores; documented rather than constrained.
- DialogOpeners' mapped exhaustiveness now guards list kinds; the two
  consent slots are deliberately outside the mapped openers (they have
  request-based commands, not payload openers).
- 25 of 118 round-2 items and 43 of 108 round-1 items were never
  externally reviewed (provider rate limits). The internal review
  cycles and the full suite cover the same code.
