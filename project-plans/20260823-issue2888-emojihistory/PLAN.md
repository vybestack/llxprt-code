# Plan: Filter emojis on history replay (issue #2888)

## Problem

`emojifilter` (auto/warn/error) is wired only into the live streaming output
path (`useStreamState.ts`). Conversation text replayed from session recordings
— `/chat resume`, `/continue` (`perform_resume`), `/chat restore`
(`load_history`), and startup seeding of resumed history — enters the UI with
raw text, so emojis render verbatim on replay even when the filter is enabled.
A resumed conversation therefore differs from how it originally rendered.

## Root cause

`iContentToHistoryItems` (the recording → UI items converter) and the
`load_history` result handler never consult the `emojifilter` ephemeral
setting; only the streaming path does.

## Approach

One shared source of truth for resolution + filtering, applied at every
replay→UI boundary:

1. `packages/cli/src/ui/utils/iContentToHistoryItems.ts`
   - Export `resolveEmojiFilterMode(settings)` — resolves the `emojifilter`
     ephemeral setting exactly like the live path's `useEmojiFilterMode`
     (non-empty string → that mode, else `'auto'`; null-safe).
   - Export `createEmojiFilter(mode)` — `'allowed'` → `undefined` (no
     filtering), else `new EmojiFilter({ mode: mode ?? 'auto' })`.
   - Export `filterHistoryItems(items, filter)` — item-level transform that
     mirrors the live commit path (`commitAiPendingItem`): filters ONLY
     model-authored text (`gemini` / `gemini_content` items); user input and
     no-text items (tool groups) replay verbatim (the live path never filters
     user input); a blocked (error-mode) turn is REPLACED by the same
     `{type:'error', text:'[Error: Response blocked due to emoji detection]'}`
     item the live path renders (shared `EMOJI_BLOCKED_ERROR_TEXT` constant),
     plus the filter's `systemFeedback` info item when present; warn-mode
     feedback is appended as an info item after the filtered turn; thinking
     blocks are filtered too, with a blocked thought blanked (mirrors
     `applyThoughtToState`).
   - `iContentToHistoryItems(contents, emojiFilterModeOverride?)` — optional
     resolved mode; default `'auto'`. Existing emoji-free callers behave
     identically (auto mode is a no-op on emoji-free text). Items are built
     id-less, filtered (an item may expand into several), then assigned
     unique negative ids.
2. `slashCommandHandlers.ts`
   - `handleLoadHistoryResult` (covers `/chat restore` and every
     `load_history` producer): display items pass through
     `filterHistoryItems(result.history, createEmojiFilter(resolveEmojiFilterMode(...)))`;
     `clientHistory` → `setHistory(...)` stays VERBATIM (display-only
     filtering — recorded data must not be mutated).
   - `performSessionResume` (`/chat resume`, `/continue`): passes
     `resolveEmojiFilterMode(deps.config)` into `iContentToHistoryItems`.
     2b. `DialogManager.tsx` (`useSessionBrowserHandler`) — the session-browser
     resume path passes `resolveEmojiFilterMode(config)` into
     `iContentToHistoryItems` (same pattern as performSessionResume).
3. `useStreamState.ts` — `useEmojiFilterMode` now delegates to
   `resolveEmojiFilterMode(runtime.ephemeral)` (behavior-identical; one
   definition of "the same way the live path resolves it"), and the blocked
   error text uses the shared `EMOJI_BLOCKED_ERROR_TEXT` constant.
4. `useSessionInitialization.ts` — startup seeding passes
   `resolveEmojiFilterMode(uiRuntime.ephemeral)`.

Out of scope: checkpoint `/restore` (`restoreCommand.ts`) replays
UI-history captures that were already filtered live at checkpoint time —
different data source, no raw text, left untouched.

## Tests

- `iContentToHistoryItems.test.ts`: default/auto converts emoji → `[OK]`;
  `allowed` verbatim; `error` mode replaces the turn with the error item;
  `warn` appends the feedback info item; user text verbatim in all modes;
  tool_group passthrough; thinking-block filtering (incl. blocked → `''`);
  `resolveEmojiFilterMode` (non-empty string honored, missing/empty/non-string
  → `'auto'`, null source safe); `createEmojiFilter` (`allowed` → `undefined`,
  others construct); `filterHistoryItems` unit cases incl. expansion.
- `slashCommandHandlers.test.ts`: `load_history` display filtered under
  `auto`/`error`/`allowed`, config-null → `'auto'` fallback, error mode
  renders the error item (not a blank model item), `clientHistory` verbatim
  while display filtered, `perform_resume` path filtered.
- `useSessionInitialization.test.ts`: seeding resolves mode from
  `uiRuntime.ephemeral` (`'auto'` default and configured `'error'`) —
  wiring-level.
- `useSessionInitialization.emojifilter.test.ts` (behavioral, converter NOT
  mocked): seeded UI text is actually filtered per mode (auto/allowed/error,
  plus warn parity with direct conversion).
- Existing `chatCommand.test.ts` restore expectations unchanged (action
  returns raw history; filtering happens at display boundary).
- DialogManager's `useSessionBrowserHandler` is private and mounting the full
  DialogManager is disproportionate; its resume path is the same
  resolve+convert pattern covered by the perform_resume and converter tests.

## Verification

- `bun run typecheck` (packages/cli): clean.
- eslint + prettier on all touched files: clean.
- Targeted (single invocation, all files together): 80/80 pass
  (35 converter + 8 handler + 10 chatCommand + 9 sessionInit wiring
  - 4 sessionInit behavioral + 9 performResume repro — the last file also
    proves the performResume module mock leak is gone; mocks are injected via
    `performResumeFn` instead).
- Full CLI suite (`packages/cli`): 9187 passed / 5 skipped / 1 failed — the
  single failure (`setupTerminalAndTheme` TTY capability) passes standalone
  and is a contention flake; 32 agentStream failures confirmed identical on
  stashed clean tree (pre-existing, unrelated).
- Root-level `npm run test`, `npm run lint`, `npm run typecheck`,
  `npm run format`, `npm run build`, and the `stepfun-37` smoke test run per
  the issue workflow before push/PR.

## Follow-ups

None open. Potential future work (out of scope): filtering checkpoint
`/restore` replays if checkpoint capture ever switches to raw text;
replaying history through the streaming pipeline (contentEventProcessor) if
intra-turn interleaving parity (push-time feedback order, partial commits
before a late block) is ever required — current replay defines parity on the
final committed transcript; unifying `/chat restore`'s manual IContent →
HistoryItemWithoutId mapping with `iContentToHistoryItems` so code fences and
tool groups render identically to resume (deliberately not done here — it
changes what `/chat restore` displays beyond the emoji scope and needs its
own validation; the emoji/thinking filtering itself is shared via
`filterHistoryItems` at the load_history handler).
