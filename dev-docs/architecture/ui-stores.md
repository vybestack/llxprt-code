# UI store architecture

Status: durable reference for contributors. Introduced by the issue #2536
re-architecture, which replaced the former `UIState`/`UIActions` React
contexts with four external stores.

## Overview

The interactive UI keeps its shared state in four stores under
`packages/cli/src/ui/stores/`. Each store owns one plane of UI state, is
created once per app mount, and is provided to the tree through a stable
React context. Components subscribe with narrow selectors, so an update to
one store or one field rerenders only the components that read it.

The stores are plain external stores, not a state library. There is no new
dependency; the whole mechanism is `createStore` plus `useStoreSelector`.

## The store primitive

`packages/cli/src/ui/stores/createStore.ts` exports `createStore<S>()`,
returning:

- `getState(): S`
- `setState(next: S | ((prev: S) => S)): void`
- `subscribe(listener: () => void): () => void`

`setState` replaces the state reference and notifies every listener. It does
not clone, diff, or skip equal values (two store commands add their own
equal-value skips where quiet no-ops matter). Callers own immutability:
updates spread the previous state and replace only the changed fields.

`packages/cli/src/ui/stores/useStoreSelector.ts` subscribes through
`useSyncExternalStore`. Its contract:

- The selector runs on every store notification, but a rerender happens only
  when the selected value fails `Object.is` against the cached value.
- A selector that derives a primitive (`s.terminalWidth`,
  `s.requests.length`) is stable across unrelated writes to the same store.
- A selector that returns an object gets a new result every time the state
  reference changes; pass an `isEqual`-stable value or select primitives when
  rerender frequency matters.

## The four stores

| Store                  | File                               | Owns                                                                                                                                       |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `DialogStore`          | `stores/dialog/dialogStore.ts`     | Dialog stack: typed `DialogRequest` union, priority order, confirmation slot, extension-update FIFO                                        |
| `TerminalStore`        | `stores/terminal/terminalStore.ts` | Dimensions, focus, capabilities, display preferences, composer-plane mode flags                                                            |
| `TurnStore`            | `stores/turn/turnStore.ts`         | Committed history (behind a ledger), pending items, streaming state, thought, queued submissions, cancellation flags, `staticKey`          |
| `SettingsProfileStore` | `stores/settings/settingsStore.ts` | Model/provider projection, profile dialog data, slash command registry, welcome data, IDE/memory context, status readouts, `settingsNonce` |

Field placement follows who owns the write. Display preferences such as
`renderMarkdown` or `showErrorDetails` live in `TerminalStore` because the
user toggles them from the terminal plane. Composer mode flags share the
terminal store because they change with it and are read by the same
components.

Dialog semantics:

- `open(request)` pushes a request, or replaces the payload in place when the
  same kind is already open.
- `close(kind)` removes that entry; closing an absent kind is a no-op.
- The rendered dialog is the highest-priority open request
  (`selectActiveDialog`). `DIALOG_PRIORITY` reproduces the former
  DialogManager if-chain order.
- Confirmations use a one-slot queue (`confirmationRequest`); extension
  update confirms use a FIFO rendered head-first.

Each store factory returns `{ store, commands }`. Commands are the write
surface; components never call `setState` directly.

## Writer pattern

Domain hooks write; components read. The hooks under
`containers/AppContainer/hooks/` (`useAppBootstrap`, `useAppInput`,
`useAppDialogs`, `useAppLayout`) keep their effects and event handlers and
route every write through store commands. Writes that used to be reducer
dispatches stay effects, which preserves the old dispatch-then-effect
ordering. One example: `useDisplayPreferences` subscribes to
`CoreEvent.SettingsChanged` and bumps `settingsNonce`, and view code re-reads
settings when the nonce changes.

Out-of-tree add requests travel through `TurnStore.requestAddItem`, which
records a `pendingAddRequest` with a monotonic `seq`. A subscriber performs
the add when the request reference changes, replacing the former appReducer
`ADD_ITEM` side-effect channel with the same ordering guarantees.

## Provider composition

`AppContainerRuntime.tsx` is the composition root. It creates each store
once (in `useRef` guards, so StrictMode double-mounts reuse the instance),
derives a memoized `DialogOpeners` object from the dialog commands, mounts
the domain hooks, and wraps the tree:

```text
TerminalProvider > TurnProvider > SettingsProfileProvider > DialogProvider
  > AppCommandsProvider > DefaultAppLayout
```

Provider values are the store objects themselves and never change identity
while the app is mounted, so context switches never cause re-renders.

`DialogOpeners` (`stores/dialog/dialogOpeners.ts`) gives one stable
`open`/`close` handle per dialog kind, typed against `DialogPayloadMap`. The
slash-command pipeline and feature hooks receive openers, not the raw store,
so a dialog cannot be opened with the wrong payload shape.

## Test patterns

Store tests construct real stores and drive real commands; there are no
store mocks. Three patterns recur:

- Real store fixtures: seed only the fields a test exercises
  (`createTurnStore({ history: [...] })`) and let everything else keep the
  documented defaults. A dialog test seeds state by opening dialogs through
  commands (`store.commands.openDialog(...)`), never by hand-building state.
- `hasRequest`: a small helper reading `store.store.getState()` to assert
  which dialog kinds are open after a flow runs (see
  `components/DialogManager.test.tsx`).
- Render isolation: probe components subscribe through `useStoreSelector`
  and count their own renders while tests drive store commands inside
  `act()` (see `stores/__tests__/renderIsolation.test.tsx`). These tests
  pin the isolation guarantees: a dialog update rerenders only dialog
  subscribers, a resize rerenders only terminal subscribers, a history
  append rerenders only the transcript region, and opening a dialog does
  not rerender the transcript.

For component tests, `src/test-utils/render.tsx` provides
`renderWithProviders`, which mounts the full provider stack and accepts
per-store seed objects (`{ terminal, turn, settingsProfile }`).

## Rules

1. Commands stay out of views. Components render from store state; they
   receive command callbacks through `AppCommandsContext` or hook results,
   never by pulling a store and calling commands in JSX paths. Dialog
   open/close goes through `DialogOpeners`.
2. Select narrow. Select primitives or identity-stable values. Whole-state
   reads (`useStoreSelector(store, (s) => s)`) rerender on every store write
   and defeat the isolation guarantees.
3. Identity guarantees for `<Static>`. `TurnStore` keeps the same item
   objects across updates and changes the `history` array reference only
   when the committed set changes. Do not clone items or rebuild arrays in
   selectors; Ink's `<Static>` region depends on stable item identity.
4. One store instance per app. Create stores in the composition root's ref
   guards, not in component bodies or module scope.
5. Noninteractive stays out. Code under `src/noninteractive/` never imports
   the stores; they exist for the interactive UI only.

## Source and test locations

- Primitive and selector: `packages/cli/src/ui/stores/createStore.ts`,
  `useStoreSelector.ts`
- Stores: `stores/dialog/`, `stores/terminal/`, `stores/turn/`,
  `stores/settings/` (each with a colocated behavior test)
- Composition root: `packages/cli/src/ui/AppContainerRuntime.tsx`
- Render isolation tests: `stores/__tests__/renderIsolation.test.tsx`
- Provider test harness: `packages/cli/src/test-utils/render.tsx`
