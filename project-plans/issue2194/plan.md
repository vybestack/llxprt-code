# Issue #2194 — Remove CLI/IDE internal unknown widening (Follow-up to #2159)

## 1. Defect analysis

Audit issue #2159 flagged four sites where internal, already-specific types were
widened to `unknown` and then re-narrowed or cast back at consumers. The
widening does not sit at a trust boundary; it exists only to make defensive
checks look necessary to lint rules. Follow-up issue #2194 scopes the removal.

### Site 1 — `selectedProfileData: unknown | null`

- Source of truth: `useProfileManagement` holds
  `useState<Profile | null>(null)` (`packages/cli/src/ui/hooks/useProfileManagement.ts:88`)
  and returns `selectedProfile: Profile | null`.
- `useAppDialogs` maps it verbatim (`selectedProfileData: profileMgmt.selectedProfile`),
  so the value is `Profile | null` end to end.
- Widenings:
  - `packages/cli/src/ui/contexts/UIStateContext.tsx:129` —
    `selectedProfileData: unknown | null;`
  - `packages/cli/src/ui/containers/AppContainer/builders/buildUIState.ts:124` —
    same widened field in `UIStateParams`.
- Consumer casts (the theater this issue removes):
  - `packages/cli/src/ui/components/DialogManager.tsx:369` —
    `profile={uiState.selectedProfileData as Profile | null}` for
    `ProfileDetailDialog` (whose prop is already `Profile | null`).
  - `packages/cli/src/ui/components/DialogManager.tsx:392` —
    `profile={uiState.selectedProfileData as Profile}` for
    `ProfileInlineEditor` (whose prop is `Profile`); the call site at line 424
    already guards `selectedProfileData != null`, so the narrowed value can be
    threaded through and the cast dropped.

`AppContainerRuntime` (`buildUIStateParamsExtra`, line 281) only forwards
`d.selectedProfileData`, so typing `UIStateParams` correctly fixes the runtime
plumbing without edits there.

### Site 2 — `IdeContextDeps.ideContextState: unknown`

- `packages/cli/src/ui/containers/AppContainer/hooks/useKeybindings.ts:74` —
  `ideContextState: unknown;` even though the upstream state is
  `IdeContext | undefined` (`useAppDialogs` `useState<IdeContext | undefined>`,
  fed by `useIdeContextBridge` from the ide-integration store).
- The hook only performs nullish checks (lines 227-228 and 305-306):
  `!== undefined && !== null`. Because `null` is not in the honest type, the
  `!== null` comparisons are dead once the type is honest; they existed to
  justify the `unknown` widening.

### Site 3 — `IdeClient.resetInstance` double cast

- `packages/ide-integration/src/ide/ide-client.ts:276-278` —
  `IdeClient.instance = undefined as unknown as IdeClient;` while the static
  field is already `IdeClient | undefined`. The double cast is a no-op
  assertion; direct assignment to `undefined` is the honest form.

## 2. Acceptance criteria

- **AC-1 — `selectedProfileData` is `Profile | null` through the plumbing.**
  `UIState.selectedProfileData` (UIStateContext) and
  `UIStateParams.selectedProfileData` (buildUIState) are typed `Profile | null`;
  AppContainerRuntime forwards it unchanged; DialogManager consumes it with no
  `as Profile | null` / `as Profile` casts (the editor view receives the
  narrowed value from its guarded call site).
- **AC-2 — `IdeContextDeps.ideContextState` is `IdeContext | undefined`.** The
  dead `!== null` comparisons are removed; the remaining `!== undefined`
  nullish check preserves behavior exactly (upstream never produces `null`).
- **AC-3 — `resetInstance` assigns `undefined` directly.** No
  `as unknown as IdeClient` cast; singleton semantics unchanged.
- **AC-4 — Focused behavioral tests cover the wiring.**
  - `buildUIState` passes a `Profile` through by reference (and `null`
    through) — proves the builder keeps the typed field.
  - `useKeybindings` runs `/ide status` when IDE mode and a present
    `IdeContext` coincide, and does not run it when `ideContextState` is
    `undefined` — proves the nullish guard with the honest type.
  - `IdeClient.resetInstance()` clears the singleton: two `getInstance()`
    calls share one instance; after `resetInstance()` the next `getInstance()`
    returns a different instance.
- **AC-5 — No suppressions.** No lint suppressions added; no lint/type rules
  loosened.
- **AC-6 — Verification cycle green.** `npm run test`, `lint`, `typecheck`,
  `format`, `build`, plus the `stepfun-37` smoke test.

## 3. Boundary cases

- `selectedProfileData`: `null` (nothing loaded) and a populated `Profile`
  (standard shape; the loadbalancer shape is the same `Profile` type).
- `ideContextState`: `undefined` (no IDE / disconnected) vs a present
  `IdeContext` object.
- `resetInstance`: before any `getInstance()` (already-undefined field) and
  after (clearing a live instance).

## 4. Test plan (behavioral, bun:test)

- `packages/cli/src/ui/containers/AppContainer/builders/buildUIState.test.ts`:
  new case — a `Profile` passed as `selectedProfileData` lands on the built
  `UIState` as the same reference; `null` passes through as `null`.
- `packages/cli/src/ui/containers/AppContainer/hooks/useKeybindings.test.ts`:
  existing positive case uses an `IdeContext`-shaped value (must satisfy the
  real type, not `{ id: 'ctx' }`); add the negative case
  (`getIdeMode: true`, `ideContextState: undefined` → no `/ide status`).
- `packages/ide-integration/src/ide/ide-client.test.ts`: new case — singleton
  identity is stable across `getInstance()` calls and changes after
  `resetInstance()`.

## 5. Files touched

1. `packages/cli/src/ui/contexts/UIStateContext.tsx` — type the field; import
   `Profile`.
2. `packages/cli/src/ui/containers/AppContainer/builders/buildUIState.ts` —
   type the param field; import `Profile`.
3. `packages/cli/src/ui/components/DialogManager.tsx` — drop both casts; thread
   the narrowed value into the editor view.
4. `packages/cli/src/ui/containers/AppContainer/hooks/useKeybindings.ts` —
   type `ideContextState`; drop dead `!== null` checks.
5. `packages/ide-integration/src/ide/ide-client.ts` — direct `undefined`
   assignment in `resetInstance`.
6. The three test files above.

## 6. Out of scope

- Any other `unknown` occurrences flagged by #2159 (separate follow-ups).
- Changes to `Profile`, `IdeContext`, dialog components, or the ideContext
  store.
- Lint rule adjustments of any kind.
