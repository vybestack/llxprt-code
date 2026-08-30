# Issue #2024 — Increase terminal keyboard, mouse, and capability coverage

## Nature of the issue

This is a **coverage** issue. The deliverable is behavioral tests over
already-shipped terminal input and capability code. No production behavior
changes are planned. If a test written against *correct* behavior fails, that is
a bug discovery: stop, report it, and do not paper over it with a test that
asserts the wrong thing.

## Scope

In scope — the seven areas named in the issue, tested against these units:

| Area                                | Unit under test                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| Raw mode setup and cleanup          | `KeypressProvider` / `useKeypressSetup` (`ui/contexts/KeypressContext.tsx`)                    |
| Stdin subscription / unsubscription | `KeypressProvider`, `useKeypress`, `MouseProvider`, `useMouse`                                 |
| Escape vs Alt-key ambiguity         | `createKeypressPipeline` / `emitKeys` (`ui/contexts/KeypressContext.tsx`)                      |
| Bracketed paste sequences           | `bufferPaste` via `createKeypressPipeline`; `useBracketedPaste` (`ui/hooks/useBracketedPaste.ts`) |
| Kitty protocol enable and cleanup   | `TerminalCapabilityManager`, `useKittyKeyboardProtocol`                                        |
| Mouse drag selection and parsing    | `useMouseSelection`, `MouseProvider` stream buffering, `ui/utils/mouse.ts`                     |
| Capability detection timeout / skip | `TerminalCapabilityManager.detectCapabilities`, `setupTerminalAndTheme`                        |

Out of scope — everything else. Specifically: no refactors of the units under
test, no new production abstractions, no changes to unrelated tests, no
"while I'm here" hardening.

### tmux decision

The issue permits "targeted tmux tests only where a real terminal is needed."
Every behavior listed is reachable through fake streams: the parser is a pure
byte pipeline (`createKeypressPipeline` is exported precisely for this), raw
mode is an injected `setRawMode` callback from ink's `useStdin`, and capability
detection reads from `process.stdin` and writes with `fs.writeSync`, both of
which are already substitutable in the existing suite. `scripts/tmux-harness.ts`
is a manual reproduction harness, not a CI-executed test runner, so adding tmux
scenarios would add no CI signal. **Decision: no tmux tests in this change.**

## Acceptance criteria

### AC1 — Raw mode setup and cleanup

`KeypressProvider` owns raw mode only when it turned it on.

1. Mounting with `stdin.isRaw === false` calls `setRawMode(true)` exactly once.
2. Unmounting that provider calls `setRawMode(false)` exactly once, so the
   terminal is left as it was found.
3. Mounting with `stdin.isRaw === true` (something else already put the terminal
   in raw mode) never calls `setRawMode`, on mount or on unmount.
4. Mounting with `stdin.isRaw === undefined` (non-TTY stream) never calls
   `setRawMode`.

Boundary note: the guard is `wasRaw === false`, so `undefined` and `true` are
both "not ours to change". Cases 3 and 4 exist to pin that distinction.

### AC2 — Stdin subscription and unsubscription

1. `KeypressProvider` attaches exactly one `data` listener to the injected stdin
   on mount, and stdin has zero `data` listeners after unmount.
2. After unmount, writing bytes to stdin delivers nothing to a previously
   subscribed handler.
3. `unsubscribe(handler)` stops delivery to that handler while a second
   still-subscribed handler continues to receive keys.
4. `useKeypress(handler, { isActive: false })` receives nothing; flipping
   `isActive` to `true` starts delivery and flipping back to `false` stops it,
   without unmounting the provider.
5. `MouseProvider` attaches one `data` listener when `mouseEventsEnabled` is
   `true`, removes it on unmount, and attaches none when `mouseEventsEnabled` is
   `false` or omitted. Toggling the prop attaches/detaches accordingly.

### AC3 — Escape vs Alt-key ambiguity

The parser distinguishes a bare Escape from Alt+key by arrival timing:
`createDataListener` flushes the pending sequence `ESC_TIMEOUT` (100 ms) after
the last byte.

1. A lone `\x1b` emits nothing until `ESC_TIMEOUT` elapses; after it elapses,
   exactly one key with `name: 'escape'` and `sequence: '\x1b'` is emitted, and
   that key satisfies the `Command.ESCAPE` matcher from `ui/keyMatchers.ts`.
2. `\x1b` and `b` in the *same* chunk emit one key: `{ name: 'b', meta: true }`
   with `sequence: '\x1bb'` (Alt+b).
3. `\x1b` in one chunk, then `b` after `ESC_TIMEOUT` has elapsed, emits two
   keys: an `escape` key followed by `{ name: 'b', meta: false, sequence: 'b' }`.
   This is the disambiguation contract.
4. `\x1b\x1b` emits a single `escape` key (sequence `'\x1b'`), i.e. Alt+Escape
   and Escape are deliberately indistinguishable downstream; the key still
   satisfies the `Command.ESCAPE` matcher.
5. `\x1b[` is treated as a CSI introducer, not Alt+`[`: `\x1b[A` emits one
   `{ name: 'up' }` key and no `'['` key.
6. `\x1bO` is treated as an SS3 introducer, not Alt+`O`: `\x1bOA` emits one
   `{ name: 'up' }` key.

Do **not** assert the `meta` flag on the bare-Escape cases (1 and 4). The
parser sets `meta: true` there because the byte arrived through the escaped
branch; consumer code keys off `name` and the `Command.ESCAPE` matcher ignores
unspecified modifiers, so `meta` is not part of the contract. Asserting it would
freeze an incidental detail. Assert the matcher result instead — that is the
user-visible behavior.

### AC4 — Bracketed paste sequences

1. `\x1b[200~` + payload + `\x1b[201~` emits exactly one key
   `{ name: 'paste', sequence: payload, insertable: true }`, and no per-character
   keys for the payload.
2. An empty paste (`\x1b[200~\x1b[201~` with no payload) emits no key at all.
3. A payload containing bytes that would otherwise decode to a control key (for
   example `\x1b[A`) is reassembled verbatim into the paste payload rather than
   being delivered as an `up` key.
4. A payload containing newlines and tabs is preserved byte-for-byte.
5. Paste content is not run through the fast-return or backslash-enter buffers:
   a payload ending in `\r` still arrives inside the paste payload, not as a
   separate `return` key.
6. If `\x1b[201~` never arrives, the buffered payload is flushed as a single
   `paste` key after `PASTE_TIMEOUT` (30 s), rather than being lost.
7. `useBracketedPaste` writes the enable sequence on mount and the disable
   sequence on cleanup, and registers `exit` / `SIGINT` / `SIGTERM` handlers on
   mount that it removes on unmount, so repeated mounts do not accumulate
   process listeners.

### AC5 — Kitty keyboard protocol enable and cleanup

1. `useKittyKeyboardProtocol` reports the manager's enabled state at first
   render with `checking: false`, and keeps returning that snapshot across
   re-renders (detection is startup-only; the hook must not re-query).
2. After a detection run in which the terminal answered the kitty query,
   `isKittyProtocolEnabled()` is `true` and an `exit` listener is registered to
   tear the protocol down.
3. Running detection does not accumulate process listeners: the `exit`,
   `SIGTERM`, and `SIGINT` listener counts return to their pre-detection values
   after `resetInstanceForTesting()`.
4. `disableKittyProtocol()` on a manager whose protocol was never enabled is a
   no-op and leaves `isKittyProtocolEnabled()` false.

Existing coverage in `terminalCapabilityManager.test.ts` already pins the
enable/disable/on-exit write sequences; do not duplicate it. Add only 2–4 above,
in that same file, reusing its existing mock setup.

### AC6 — Mouse drag selection and mouse event parsing

Stream layer (`MouseProvider`):

1. An SGR press sequence split across two `data` chunks is broadcast exactly
   once, after the final chunk completes it.
2. Two complete sequences in a single chunk are broadcast in arrival order.
3. Non-mouse garbage preceding a valid sequence is discarded and the valid
   sequence that follows is still broadcast.
4. A sequence longer than the 4096-byte cap of junk does not wedge the parser: a
   valid sequence arriving afterwards is still broadcast.

Parsing layer (`ui/utils/mouse.ts`) — add the cases the existing file lacks:

5. `getMouseEventName` maps button code 66 to `scroll-left` and 67 to
   `scroll-right`.
6. X11 release (button bits `3`) parses as `left-release` with `button: 'none'`.
7. X11 motion (bit 32) parses as `move`, and X11 wheel (bit 64) parses as
   `scroll-up` / `scroll-down`.
8. X11 modifier bits (shift 4, meta 8, ctrl 16) are decoded onto the event.

Selection layer (`useMouseSelection`) — behavioral, against a real ink tree:

9. `left-press` then `move` then `left-release` over rendered text produces a
   selection whose text is handed to `onCopiedText`, and the text matches the
   characters actually spanned by the drag.
10. A `move` event with no preceding `left-press` changes nothing and does not
    call `onCopiedText`.
11. A drag that resolves to no selectable content does not call `onCopiedText`
    (empty selections are not copied).
12. With `enabled: false`, mouse events produce no selection and no copy, and
    flipping `enabled` from `true` to `false` clears an existing selection.

Mock policy for AC6: the clipboard write (`utils/clipboard.js`) is
infrastructure and may be stubbed. The ink tree, `Selection`, `Range`,
`hitTest`, the mouse parser, and `useMouseSelection` itself are all real. Drive
the test with real SGR byte sequences through the provider's stdin so the parse
path is exercised end to end. Assert on the copied text — a derived value —
never on "was the handler called".

### AC7 — Capability detection timeout and explicit skip env

1. When no Device Attributes reply arrives, detection resolves after the 1000 ms
   timeout, and the supported modes are still applied (bracketed paste is
   enabled) — timeout is a completion path, not a failure path.
2. Detection restores raw mode: starting with `isRaw === false` it sets raw mode
   true and sets it back to false when detection completes; starting with
   `isRaw === true` it leaves raw mode alone.
3. Detection removes its `data` listener from stdin when it completes, by both
   the DA1-sentinel path and the timeout path.
4. If the query write throws, detection still resolves, marks detection
   complete, and restores raw mode instead of hanging.
5. Detection is skipped when `process.stdout.isTTY` is false (the existing suite
   covers `stdin.isTTY` false only).
6. `setupTerminalAndTheme` skips detection only for the exact value `'true'` of
   `LLXPRT_CODE_SKIP_TERMINAL_CAPABILITY_DETECTION`. Values `'1'`, `'false'`,
   `'TRUE'`, and empty string all still run detection. The existing file covers
   the `'true'` case; add the negative cases beside it.

## Test file plan

New files (all TypeScript, `bun:test`, co-located, 2026 copyright header;
`.tsx` only where the file actually contains JSX):

- `packages/cli/src/ui/contexts/KeypressContext.lifecycle.test.tsx` — AC1, AC2 (1–4)
- `packages/cli/src/ui/contexts/KeypressContext.escape.test.ts` — AC3
- `packages/cli/src/ui/contexts/KeypressContext.bracketedPaste.test.ts` — AC4 (1–6)
- `packages/cli/src/ui/hooks/useBracketedPaste.test.tsx` — AC4 (7)
- `packages/cli/src/ui/hooks/useKittyKeyboardProtocol.test.ts` — AC5 (1)
- `packages/cli/src/ui/hooks/useMouseSelection.test.tsx` — AC6 (9–12)

Extended files:

- `packages/cli/src/ui/utils/terminalCapabilityManager.test.ts` — AC5 (2–4), AC7 (1–5)
- `packages/cli/src/ui/contexts/MouseContext.test.tsx` — AC2 (5), AC6 (1–4)
- `packages/cli/src/ui/utils/mouse.test.ts` — AC6 (5–8)
- `packages/cli/src/utils/terminalTheme.test.ts` — AC7 (6)

## Constraints

- Bun + `bun:test` only. No new `.js` files, no vitest, no node:test.
- TypeScript strict: no `any`, no type assertions to force shapes.
- No mock theater. Do not mock the unit under test. Do not assert
  `toHaveBeenCalled` on a stub that stands in for the behavior being tested;
  assert derived values. Stubs are acceptable only for infrastructure (fs
  writes, clipboard, terminal escape emission).
- `max-lines` is 800 per file; keep new files well under it.
- Shared harness code (mock stdin, provider wrapper) must be extracted into a
  helper within each new file rather than copy-pasted across describe blocks.
- Every new test must fail if the corresponding production code is broken.
  Verify this by reasoning through the litmus questions in the
  typescript-test-writing skill before submitting.

## Defects found while writing the tests

Filed as **issue #3300**. Not fixed here: production changes are outside the
scope of a coverage issue, and the fix wants its own test-first cycle.

- **The SS3 reader corrupts pasted text.** `readOCodeSequence` reports
  `sequence` as `\x1bA` for the input bytes `\x1bOA`, dropping the `O`, while
  the CSI reader round-trips its bytes faithfully. This is not confined to key
  bindings. `bufferPaste` reassembles a bracketed-paste payload by
  concatenating `key.sequence`, so a paste containing SS3 bytes comes out
  altered: `before\x1bOAafter` is delivered as `before\x1bAafter`, while the CSI
  equivalent survives intact. That contradicts the verbatim and byte-for-byte
  contract AC4.3 and AC4.4 pin in this same change. The AC3.6 test pins the
  decoded key identity and deliberately does not assert `sequence`; once #3300
  lands, that assertion should be added.
- **A bare Escape decodes with `meta: true`,** because the byte falls through
  the escaped branch of `parseNonEscapeKey`. Semantically wrong — no Alt key was
  pressed — but no live consumer depends on it: bindings match on `name` and
  leave modifiers unspecified. Recorded on #3300 alongside the SS3 fix. The AC3
  tests assert the `Command.ESCAPE` matcher rather than `meta`, which both
  avoids freezing the incidental flag and guards against the binding later
  being constrained on modifiers in a way that would break Escape.

## Review findings not actioned

Raised in review, deliberately left alone, with reasons:

- **Extract a shared `MockStdin` test double.** Six files in `packages/cli/src/ui`
  now define their own. Consolidating them means editing five test files that
  belong to other efforts, which is outside this issue. Follow-up material.
- **Cover the clipboard failure path in `useMouseSelection`.** `useClipboardCopy`
  awaits `copyTextToClipboard` with no `try`/`catch` behind a fire-and-forget
  `void`, so a rejecting clipboard would surface as an unhandled rejection.
  That is error-handling behavior, not the drag selection the issue asks for,
  and pinning it down would likely force a production change. Out of scope.
- **Drop the control harness from the negative mouse-selection tests.** The
  duplication is deliberate: a bare `not.toHaveBeenCalled()` with no positive
  control is exactly the worthless test the project's rules prohibit. The
  cross-wiring risk the same review raised was the real problem, and that is
  fixed by unmounting each harness before the next one renders.

## Verification

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
bun scripts/test-audit/scan.ts tmp/scan-branch
```

The test-audit scanner must report no new MOCK_MIRROR, ALWAYS_TRUE,
SELF_CONFIRMING, or NO_ASSERT findings on the files touched here.
