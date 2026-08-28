# Issue #2023 — Increase onboarding, profile, provider, and model UI coverage

## 1. What the issue asks for

This is a **coverage** issue. No product behavior changes. Add tests that pin
down existing, correct behavior in four areas:

1. Welcome-completed config skips onboarding.
2. Clean config shows onboarding.
3. Skip and save paths persist expected state.
4. Profile create wizard validation.
5. Provider/model loading errors and empty states.
6. Provider/model switch cancellation and confirmation.
7. One tmux smoke for clean-runner onboarding.

## 2. Ground truth found in the repo (2026-08-27, branch `issue2023` off `main`)

The CodeRabbit auto-plan on the issue is **stale**: it assumes Vitest, a
`vitest.config.ts` exclusion of `**/ui/components/*.test.tsx`, and a
`.spec.tsx`-under-`__tests__/` workaround. None of that exists any more.

Current reality:

- The CLI workspace runs on **bun test only** (`packages/cli/run-bun-tests.ts`,
  `packages/cli/bunfig.toml`). No Vitest, no exclude list.
- `scripts/check-cli-test-discovery.ts` discovers `\.(test|spec|bun)\.(ts|tsx)$`
  under `src`, `test`, `test-bun`, `test-utils`. Colocated `*.test.tsx` next to
  the component is the dominant convention and is discovered.
- `bun-test-setup.ts` redirects `ink` to `packages/cli/test-utils/ink-stub.ts`
  at resolution time. There is nothing to `vi.unmock`.
- Existing helpers: `src/test-utils/render.tsx` (`render`,
  `renderWithProviders`, `createMockSettings`, `renderHook`),
  `src/test-utils/regex.ts` (`testRegex`), `src/test-utils/async.ts`.

### Existing coverage (do NOT duplicate)

- `packages/cli/src/ui/hooks/useWelcomeOnboarding.bun.tsx` already covers the
  `showWelcome` gate: clean config + trust complete → true; completed config →
  false; trust incomplete → false; `suppressStartup` → false and no persist;
  `resetAndReopen` → true.
- `packages/cli/src/ui/hooks/useProviderDialog.spec.ts` already covers
  `openDialog` success/empty-provider/list-failure and `handleSelect`
  success/failure.
- `packages/cli/src/ui/components/ProviderDialog.responsive.test.tsx` covers
  responsive **rendering** only. No keypress coverage.

### Confirmed gaps (this issue's work)

| Gap | Module |
| --- | --- |
| No unit test at all | `packages/cli/src/config/welcomeConfig.ts` |
| Skip/save persistence never asserted end to end | `useWelcomeOnboarding.dismiss` / `saveProfile` |
| No unit test at all | `packages/cli/src/ui/components/ProfileCreateWizard/validation.ts` |
| No component test at all | `packages/cli/src/ui/components/ModelDialog.tsx` (`ModelsDialog`) |
| No keypress/selection test | `packages/cli/src/ui/components/ProviderDialog.tsx` |
| No clean-runner onboarding smoke | tmux harness |

## 3. Acceptance criteria

Every AC is proved by a behavioral assertion against real production code.
Filesystem is the only thing stubbed for persistence (temp dirs via the
`LLXPRT_CODE_WELCOME_CONFIG_PATH` env override — a real file, not a mock).

### AC1 — Welcome config persistence and detection (`welcomeConfig.ts`)

New file: `packages/cli/src/config/welcomeConfig.test.ts`

- `getWelcomeConfigPath()` returns the `LLXPRT_CODE_WELCOME_CONFIG_PATH`
  override when set, and the `USER_SETTINGS_DIR`-joined default when unset.
- Missing config file → `loadWelcomeConfig()` returns
  `{ welcomeCompleted: false }` and `isWelcomeCompleted()` is `false`.
- Existing file with `welcomeCompleted: true` → `isWelcomeCompleted()` is
  `true`.
- Malformed JSON on disk → falls back to `{ welcomeCompleted: false }` rather
  than throwing (boundary case: corrupt user file).
- `saveWelcomeConfig()` creates the parent directory when absent and writes the
  file with mode `0o600`; the round-tripped JSON on disk equals what was saved.
- `markWelcomeCompleted(true)` persists `welcomeCompleted: true`,
  `skipped: true`, and a parseable ISO `completedAt`.
- `markWelcomeCompleted(false)` persists `skipped: false` with the same
  invariants.
- Caching: after `loadWelcomeConfig()`, an out-of-band file rewrite is NOT
  observed until `resetWelcomeConfigForTesting()` is called (documents the
  process-lifetime cache the CLI relies on).
- `saveWelcomeConfig()` swallows write failures (unwritable path) instead of
  throwing — the CLI must not crash on a read-only settings dir.

### AC2 — Skip and save paths persist expected state (`useWelcomeOnboarding`)

Extend `packages/cli/src/ui/hooks/useWelcomeOnboarding.bun.tsx` (the file that
already owns the gating cases, so temp-config lifecycle is shared, per the DRY
setup rule).

- `skipSetup()` then `dismiss()` → the real temp config file on disk contains
  `{ welcomeCompleted: true, skipped: true }`, and `showWelcome` flips to
  `false`.
- `dismiss()` from a non-skipped step (completion path) → the file contains
  `skipped: false`, `welcomeCompleted: true`.
- After either dismissal, a fresh `isWelcomeCompleted()` read (post
  `resetWelcomeConfigForTesting()`) is `true` — proving the persisted state is
  what a subsequent clean runner would observe.
- `actions.saveProfile(name)`:
  - happy path calls, in order, `saveProfileSnapshot(name)`,
    `setDefaultProfileName(name)`, `loadProfileByName(name)` on the runtime;
    asserted through a recording stub that captures the **call order** (a
    derived property, not a mirrored literal).
  - rejects with a message naming the profile when `listSavedProfiles()`
    already contains the name, and does NOT call `saveProfileSnapshot`.
- `actions.selectModel(id)` when `setActiveModel` rejects → state keeps
  `step` unchanged and exposes an `error`; when it resolves → `step` becomes
  `'completion'` and `selectedModel` is the chosen id.

### AC3 — Profile create wizard validation

New file:
`packages/cli/src/ui/components/ProfileCreateWizard/validation.test.ts`

- `validateBaseUrl`: empty/whitespace → `Base URL is required`; `ftp://host` →
  protocol error; `not a url` → `Invalid URL format`; `http://` and `https://`
  URLs → valid.
- `validateProfileName`: empty/whitespace → invalid; contains `/` or `\` →
  path-separator error; name present in `existingProfiles` → already-exists
  error; otherwise valid. Existing-profiles array is not mutated.
- `validateKeyFile` against a real temp dir: readable file → valid; absent path
  → `File not found:` with the **original** (unexpanded) path echoed; `~/`
  expansion resolves against `os.homedir()`; a chmod-`0o000` file →
  `Permission denied:`. The permission case is skipped when running as root
  (`process.getuid?.() === 0`) or on win32, where the mode is not enforced.
- `PARAM_VALIDATORS.temperature`: `-0.1` and `2.1` invalid; `0`, `1`, `2` valid.
- `PARAM_VALIDATORS.maxTokens`: `0`, `-1`, `1.5` invalid; `1_000_001` invalid
  with the maximum message; `1` and `1_000_000` valid.
- `PARAM_VALIDATORS.contextLimit`: `0`, `-1`, `2.5` invalid; `1` valid.

### AC4 — Provider/model loading errors and empty states

New file: `packages/cli/src/ui/components/ModelDialog.test.tsx` rendering the
real `ModelsDialog` with a stubbed `RuntimeContext` (infrastructure boundary).

- While `listAvailableModels` is pending, the frame shows `Loading models...`
  and no model table.
- Once resolved, the loading frame is replaced by the table containing the
  returned model ids.
- `listProviders()` throwing → dialog leaves the loading state and renders a
  zero-result frame (no model rows, `Found 0`; the ` of N` suffix only appears
  when a search term or capability filter is active).
- `listAvailableModels()` rejecting for the only provider → same zero-result
  frame, and the dialog does not crash (`Promise.allSettled` path).
- Mixed results: one provider resolves, one rejects → only the resolving
  provider's models are listed.
- A search term matching nothing → `Found 0 of N` where N is the loaded
  baseline count (derived, not mirrored).

Provider empty state, added to a new
`packages/cli/src/ui/components/ProviderDialog.selection.test.tsx`:

- A search term matching no provider renders `No providers match "<term>"` and
  no provider rows.

### AC5 — Provider/model switch cancellation and confirmation

In `ProviderDialog.selection.test.tsx` (wide layout, real component, real
`KeypressProvider`):

- Enter on the focused row invokes `onSelect` exactly once with the focused
  provider name and does not invoke `onClose` (confirmation-by-selection).
- Escape with an empty search invokes `onClose` and never invokes `onSelect`
  (cancellation has no side effect).
- Escape while searching with a non-empty search term clears the search
  (`Found`-count returns to the full list) and does NOT invoke `onClose` or
  `onSelect`; a second Escape then closes.
- Enter when the filter matches zero providers invokes neither callback.

In `ModelDialog.test.tsx`:

- Enter on the focused model invokes `onSelect` with that model and not
  `onClose`.
- Escape with a non-empty search clears the search instead of closing; Escape
  with an empty search invokes `onClose` without `onSelect`.

No new confirmation UI is introduced — the dialogs apply the switch on Enter
today, and that is the behavior being pinned.

### AC6 — Clean-runner onboarding tmux smoke

New scenario: `scripts/tmux-script.onboarding.json`

- Starts the CLI with `LLXPRT_CODE_WELCOME_CONFIG_PATH` pointed at a per-run
  path `${TMPDIR:-/tmp}/llxprt-onboarding-welcome-$$.json`. The start command is
  wrapped in `sh -c` so the file is removed before launch and again after the
  CLI exits, which makes the scenario clean on entry and leaves nothing behind
  even if a previous run crashed or a PID is later reused.
- Waits for `Welcome to llxprt!` and the two choices.
- Selects `Skip setup` (Down, Enter), waits for `Setup skipped`, presses Enter
  to dismiss, and waits for the normal `Type your message` prompt — proving the
  dialog dismisses and the app is usable.
- Ends with `/quit` + `waitForExit`.

Wiring:

- `scripts/tests/interactive-ui.test.ts` gains one `runTmuxE2E` case invoking
  the scenario and asserting a zero exit status through the existing
  `assertHarnessSuccess` helper.
- `.github/workflows/interactive-ui.yml` gains the new scenario path in BOTH
  the `pull_request` and `push` `paths` lists (the existing
  `interactive-ui-paths.bun.test.ts` asserts the two lists are symmetric). It
  also gains `packages/cli/src/config/welcomeConfig.ts`, the one production
  module the scenario depends on that lives outside `packages/cli/src/ui/**`.
- `scripts/tests/interactive-ui-paths.bun.test.ts` is updated so the
  "executed scenario JSON files" assertion covers the new scenario, and gains an
  assertion for the welcome-config path — that guard exists precisely to keep
  executed scenarios and their inputs in sync with the path filter.

Evidence the smoke is not vacuous: repointing the same scenario at
`scripts/fixtures/welcome-completed.json` (a completed config) makes it fail on
the first `waitFor` with
`Timed out waiting for step 0 (contains "Welcome to llxprt!")`. That negative
control also demonstrates AC1 end to end.

## 4. Out of scope (explicitly not doing)

- Any change to production behavior in `welcomeConfig.ts`,
  `useWelcomeOnboarding.ts`, `ProfileCreateWizard/*`, `ModelDialog.tsx`, or
  `ProviderDialog.tsx`.
- New confirmation UI for provider/model switching.
- `ProfileCreateWizard` `CancelConfirmDialog` / `ConflictDialog` component
  tests: the issue bullet is "profile create wizard **validation**", and
  cancellation is scoped by its own bullet to provider/model switching.
- Refactoring the dialogs to be more testable.
- Touching unrelated project-plan files.

## 5. Test rules that apply

From `dev-docs/RULES.md` / the `typescript-test-writing` skill:

- `bun:test` only, TypeScript, strict mode, no `any`, no new `.js`.
- Behavior only. No mock-verification-only assertions, no mirror echoes
  (never assert back a literal that a stub was configured with — assert derived
  properties such as ordering, counts, and rendered frames).
- Real components and real production functions; only the runtime API,
  terminal size, and the filesystem location are stubbed/redirected.
- Shared temp-dir lifecycle helpers rather than copy-pasted `beforeEach`
  blocks.
- New files carry a 2026 copyright header.

## 6. Verification

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
bun scripts/test-audit/scan.ts tmp/verify2023/scan-branch   # no new findings
```

The tmux smoke is CI-gated behind `LLXPRT_E2E_TMUX=1`; run locally with
`npm run test:interactive-ui` where tmux is available.
