# Issue #3373 — At-completion cannot recover from a transient search error

## Problem

`usePatternChangeHandler` in `packages/cli/src/ui/hooks/useAtCompletion.ts`
starts work only from `IDLE`, `READY`, and `SEARCHING`. `ERROR` has no
transition on a pattern change, so once a crawl or a search fails, every
subsequent keystroke dispatches nothing. The suggestion list stays empty for
the rest of the session in that directory unless the hook is disabled, the
pattern goes null, or `cwd`/`config` changes (all of which reach `RESET`).

Two paths reach `ERROR`:

1. `useInitializationHandler` catch — `createFileSearcher` rejected. In this
   case `state.pattern` is still `null`, because only `SEARCH` writes it.
2. `performSearch` catch — a search rejected for a non-abort reason. Here
   `state.pattern` holds the pattern that failed.

Both must recover.

## Accepted behavior

**AC1 — Recovery from an initialization failure.** With the hook enabled and
`cwd`/`config` unchanged, if the hook is in `ERROR` after a failed
initialization and the user changes the pattern, the hook re-enters
initialization, performs the search for the new pattern, and populates
suggestions. `isLoadingSuggestions` settles to `false`.

**AC2 — Recovery from a search failure.** Same as AC1 when `ERROR` was
reached from a failed `FileSearch.search` rather than a failed
`initialize`.

**AC3 — Retry is bounded to one attempt per distinct normalized pattern.**
While in `ERROR`, re-rendering with a pattern that normalizes (lowercases) to
the pattern already attempted does not start another initialization. Only a
genuinely new normalized pattern triggers a retry. This keeps a permanently
broken directory from crawling on every render, and it prevents a retry loop
when the retry itself fails: a second failure returns to `ERROR` with the same
attempted pattern recorded, so no further work is dispatched until the user
types something different.

**AC4 — The retry is debounced like a search.** For a non-empty pattern the
retry initialization is scheduled through the existing
`SEARCH_DEBOUNCE_MS` (150 ms) timer, so fast typing in a broken directory
produces one crawl after the user pauses rather than one per character. An
empty pattern retries immediately, matching how `SEARCH` is dispatched today.

**AC5 — No regression in the other transitions.** `IDLE` still initializes,
`READY`/`SEARCHING` still debounce-search on pattern change, and disable /
null-pattern / `cwd`-change still `RESET`.

### Boundary cases

- `ERROR` with `state.pattern === null` (initialization failure) — the retry
  gate cannot use `state.pattern`, so a separate record of the attempted
  pattern is required.
- Pattern that differs only by case (`"ALP"` after `"alp"`) — normalizes to the
  same value, so it is not a retry trigger. If it arrives while a retry is
  still waiting on the debounce it cancels that retry through the effect
  cleanup, so the attempted pattern must be recorded when the retry dispatches
  rather than when it is scheduled; otherwise the cancelled retry would count
  as made and recovery would never happen.
- Empty pattern in `ERROR` — retries without debounce.
- Retry that fails again — lands back in `ERROR`, dispatches nothing further.
- Stale in-flight work — the lifecycle generation is bumped and any current
  search aborted before the retry, so a late result from the failed lifecycle
  cannot dispatch into the new one.

### Out of scope

- Surfacing the error to the user (no error UI exists today).
- Automatic time-based retry, retry counters, or backoff.
- Any change to `FileSearch`, the reducer's other actions, or the other hooks
  in this file.

## Implementation

In `usePatternChangeHandler` only:

1. Add a ref recording the normalized pattern for which work was last started
   (`INITIALIZE` or `SEARCH`). Clear it on the disable and null-pattern
   branches, which both `RESET`.
2. Add an `ERROR` branch to the status dispatch chain: when
   `state.status === ERROR` and the normalized pattern differs from the
   recorded attempted pattern, record the new pattern, bump the lifecycle
   generation, abort any current search, and dispatch `RESET` — immediately for
   an empty pattern, otherwise through the existing debounce timer.

`RESET` rather than `INITIALIZE` because `INITIALIZE` leaves `state.pattern`
alone. On the search-failure path that pattern is the one that just failed, and
`useInitializationHandler` would then dispatch a `SEARCH` for it as soon as the
retry crawl succeeded: a wasted search of the pattern the user has already
typed past. `RESET` clears it and hands control to the `IDLE` branch, which is
the state machine's existing entry point, so the retry runs the normal
initialize-then-search path for the pattern the user actually typed.

The reducer, `useInitializationHandler`, `useSearchHandler`, and
`useResetOnCwdChange` are untouched.

Getting under the repository's `max-lines-per-function` (80) and
`sonarjs/cognitive-complexity` (30) limits required extracting the
debounce-and-dispatch body, which the search path and the retry path now share,
into `startPatternWork`, and the three copies of the timer teardown into
`clearDebounceTimer`. Both are behavior-preserving extractions of code that
already existed.

## Tests (behavioral, `packages/cli/src/ui/hooks/useAtCompletion.test.ts`)

All tests use a real temp directory and the real `FileSearch` for the success
path, with `FileSearchFactory.create` stubbed only to inject the failure.

1. **AC1** — first `create` returns a searcher whose `initialize` rejects;
   later calls return a real searcher. Render with pattern `"alp"`, wait for the
   error settle (`isLoadingSuggestions === false`, no suggestions), then
   rerender with `"alph"` and the same `cwd`. Assert suggestions become
   `["alpha.txt"]` and `isLoadingSuggestions` is `false`. Fails on `main`.
2. **AC2** — `initialize` resolves; `search` rejects for the first pattern and
   delegates to a real searcher otherwise. Drive to `ERROR`, change the
   pattern, assert suggestions populate.
3. **AC3** — `initialize` always rejects. Drive to `ERROR`, then rerender with
   the same pattern and with a case variant of it. Assert
   `FileSearchFactory.create` was called exactly once.
4. **AC4/AC3** — `initialize` always rejects. Drive to `ERROR`, change the
   pattern once, wait for the second failure to settle, and assert
   `FileSearchFactory.create` was called exactly twice — the retry happened and
   did not loop.
5. **AC1 boundary** — drive to `ERROR`, then rerender twice back to back with
   `"alph"` and `"ALPH"`. The second edit cancels the pending retry and
   normalizes to the same pattern; suggestions must still populate.
6. **AC2/AC3** — every search fails until the third pattern. Drive to `ERROR`,
   change the pattern into a retry whose own search also fails, then change it
   once more and assert suggestions populate. A failing retry must not strand
   the hook.

Test 2 also asserts `FileSearch.search` was called exactly twice, which is the
evidence for the `RESET`-over-`INITIALIZE` decision: dispatching `INITIALIZE`
there replays the failed pattern and makes that count three.

The existing suite must continue to pass unchanged, in particular
`should reset the state when disabled after being in an ERROR state` and
`should reset and re-initialize when the cwd changes`.
