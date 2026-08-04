# Issue #2951 — Ctrl+Enter steering ("nudges") does not work on Windows

## Problem

On Windows, pressing `Ctrl+Enter` while the agent is streaming inserts a newline
instead of steering the active turn. With the queued-messages drawer open and an
empty input, `Ctrl+Enter` also just inserts a newline instead of steering all
queued messages into the active turn.

`docs/multiline-input.md` already documents the intended contract:

- Windows newline key is `Ctrl+Enter`.
- While the agent is streaming, `Ctrl+Enter` steers the active turn.
- Empty input + queued messages + streaming → `Ctrl+Enter` steers all queued
  messages.

None of those steering behaviours are reachable on Windows today.

## Root cause

Windows consoles (conhost, Windows Terminal, PowerShell host) deliver
`Ctrl+Enter` as a bare line feed byte `\n` (0x0A). They do not implement the
Kitty keyboard protocol or xterm `modifyOtherKeys`, so there is no
disambiguating escape sequence.

`packages/cli/src/ui/contexts/KeypressContext.tsx` → `parseNonEscapeKey()` maps
an **unescaped** `\n` through the generic control-character branch
(`ch.charCodeAt(0) <= 0x1a`), producing `{ name: 'j', ctrl: true }` — byte-for-byte
identical to `Ctrl+J`. Only `\r`, or an escaped `\n`, yields `{ name: 'return' }`.

`packages/cli/src/config/keyBindings.ts` binds:

```ts
[Command.STEER]:   [{ key: 'return', ctrl: true }],
[Command.NEWLINE]: [
  { key: 'return', ctrl: true },
  { key: 'return', command: true },
  { key: 'return', shift: true },
  { key: 'j', ctrl: true },        // <- the only binding Windows Ctrl+Enter can hit
],
```

So on Windows `Command.STEER` can never match. In
`packages/cli/src/ui/components/inputPromptKeyHandlers.ts` →
`handleSubmitAndEditKeys()`, the STEER branch (checked first, before SUBMIT and
before `handleEditingCommands`) is skipped, and the key falls through to
`Command.NEWLINE` → `buffer.newline()`. That is exactly the reported symptom.

The codebase already knows about this platform quirk — `Help.tsx` renders
`process.platform === 'win32' ? 'Ctrl+Enter' : 'Ctrl+J'` for the "New line"
shortcut — but the STEER binding was never given the Windows alias.

## Fix

Give `Command.STEER` a Windows-only additional binding of `{ key: 'j', ctrl: true }`,
resolved at key-matcher construction time.

Because `Ctrl+Enter` and `Ctrl+J` are literally the same byte on Windows, this
necessarily means: while streaming, Windows `Ctrl+J`/`Ctrl+Enter` steers rather
than inserting a newline. That is the documented and desired contract, and the
existing fall-through logic preserves newline behaviour everywhere else:

- `useSteer` returns `false` unless `streamingState === StreamingState.Responding`,
  and also returns `false` for empty/blocked/sanitized-to-empty text.
- When `handleSteer` returns `false`, `handleSubmitAndEditKeys` does **not**
  consume the key, so it continues on to `Command.NEWLINE` and inserts a newline.

Net effect on Windows:

| State                                        | Ctrl+Enter behaviour              |
| -------------------------------------------- | --------------------------------- |
| Idle                                          | newline (unchanged)               |
| Streaming, buffer has text                    | steer the active turn (**fixed**) |
| Streaming, buffer empty, queued messages > 0  | steer all queued (**fixed**)      |
| Streaming, buffer empty, no queued messages   | newline (unchanged)               |

macOS/Linux are byte-for-byte unaffected: `Ctrl+J` there is a distinct key from
`Ctrl+Enter` and must keep inserting a newline in every state.

### Why the binding table stays platform-neutral

`scripts/generate-keybindings-doc.ts` renders `docs/keyboard-shortcuts.md`
directly from `defaultKeyBindings`, and CI runs it with `--check`. If
`defaultKeyBindings` itself became platform-dependent, the generated doc would
differ between a Windows developer machine and Linux CI, breaking the check.

Therefore `defaultKeyBindings` must remain exactly as it is today, and the
Windows alias is applied by a separate resolver used only by the runtime key
matchers.

## Implementation

### 1. `packages/cli/src/config/keyBindings.ts`

Keep `defaultKeyBindings` unchanged. Add, immediately after it:

```ts
/**
 * Windows consoles deliver Ctrl+Enter as a bare line feed (0x0A), which the
 * keypress parser reports as `{ name: 'j', ctrl: true }` — indistinguishable
 * from Ctrl+J. Without this alias `Command.STEER` can never match on Windows
 * and Ctrl+Enter always falls through to `Command.NEWLINE` (issue #2951).
 *
 * `defaultKeyBindings` deliberately stays platform-neutral so the generated
 * `docs/keyboard-shortcuts.md` is identical on every platform.
 */
export const windowsKeyBindingOverrides: Partial<KeyBindingConfig> = {
  [Command.STEER]: [
    { key: 'return', ctrl: true },
    { key: 'j', ctrl: true },
  ],
};

export function resolveKeyBindings(
  platform: NodeJS.Platform = process.platform,
): KeyBindingConfig {
  if (platform !== 'win32') return defaultKeyBindings;
  return { ...defaultKeyBindings, ...windowsKeyBindingOverrides };
}
```

Also extend the existing comment above `[Command.STEER]` to point at
`resolveKeyBindings` / the Windows alias.

### 2. `packages/cli/src/ui/keyMatchers.ts`

```ts
export const keyMatchers: KeyMatchers = createKeyMatchers(resolveKeyBindings());
```

(`createKeyMatchers`'s default parameter stays `defaultKeyBindings`.)

### 3. Documentation

- `docs/multiline-input.md`
  - In "The same key, two behaviors", add a Windows note: on Windows
    `Ctrl+Enter` and `Ctrl+J` are the same byte, so **both** steer while the
    agent is streaming and **both** insert a newline when it is idle.
  - Annotate the two key-reference tables so the `Ctrl+J` row is not misread on
    Windows.
- `docs/keyboard-shortcuts.md`
  - Do **not** hand-edit inside the `KEYBINDINGS-AUTOGEN` markers. Add the
    Windows note outside the markers, then run `npm run docs:keybindings` and
    confirm the autogen block is unchanged.
- `packages/cli/src/ui/components/Help.tsx`
  - Add a steering entry (currently absent from `/help`), e.g.
    `Ctrl+Enter — Steer the agent while it is responding`, keeping the existing
    win32/non-win32 newline line intact. Update any affected snapshot/test.

## Tests (write first — behavioural, per `dev-docs/RULES.md`)

No mock theatre. Assert observable behaviour, not that a matcher function was
called.

### A. Binding resolution — extend the existing
`packages/cli/src/config/keyBindings.test.ts` (existing Vitest file; do not
create a new Vitest file)

1. `resolveKeyBindings('win32')[Command.STEER]` contains **both**
   `{ key: 'return', ctrl: true }` and `{ key: 'j', ctrl: true }`.
2. `resolveKeyBindings('darwin')[Command.STEER]` and
   `resolveKeyBindings('linux')[Command.STEER]` do **not** contain
   `{ key: 'j', ctrl: true }`, and are reference-equal to `defaultKeyBindings`.
3. Every command other than `STEER` resolves identically on `win32` and
   `linux` (guards against accidental collateral overrides).
4. `defaultKeyBindings[Command.STEER]` still has exactly one binding, so the
   generated documentation is unaffected.

### B. End-to-end key handling — new **Bun** test file

Per project policy new test files are Bun tests, added to
`scripts/bun-test-manifest.ts` under the `cli` workspace. `scripts/run_bun_tests.ts`
runs every manifest file in its own process, so the file may set
`process.platform` at the very top (via `Object.defineProperty`, before any
import of `keyMatchers`/`inputPromptKeyHandlers`) to get a clean win32 module
graph without needing `vi.resetModules` (unsupported under Bun).

Drive the real exported `handleInputKey(key, deps)` from
`packages/cli/src/ui/components/inputPromptKeyHandlers.ts` with a real
`TextBuffer`-shaped buffer and real callbacks (plain recording functions, not
behaviour-faking mocks). Simulate the Windows `Ctrl+Enter` keypress as the key
object the parser actually produces for `\n`:
`{ name: 'j', ctrl: true, meta: false, shift: false, paste: false, sequence: '\n' }`.

Required cases (win32 module graph):

1. Streaming + non-empty buffer → `handleSteer` receives the buffer text, the
   key is consumed, the buffer is cleared, and **no newline is inserted**.
2. Streaming + empty buffer + `queuedSubmissionCount > 0` →
   `steerAllQueuedSubmissions` is invoked and no newline is inserted.
3. Streaming + empty buffer + no queued submissions → falls through to
   `Command.NEWLINE`; a newline **is** inserted.
4. Idle (`handleSteer` returns `false`) + non-empty buffer → falls through to
   `Command.NEWLINE`; a newline **is** inserted and the buffer is not cleared.
5. `Enter` (`{ name: 'return' }`, no modifiers) still submits/queues — proves the
   alias did not disturb `Command.SUBMIT`.

Add a second Bun test file (or a parallel `describe` in a second manifest entry —
a separate process is required) pinning `process.platform` to `'darwin'` and
asserting the **non-regression**: the same `{ name: 'j', ctrl: true }` key while
streaming inserts a newline and never calls `handleSteer`'s steer path.

### C. Parser regression pin — extend
`packages/cli/src/ui/contexts/KeypressContext.parsing.test.tsx`

Assert that writing a bare `\n` to stdin emits `{ name: 'j', ctrl: true }`. This
documents the byte-level premise the fix rests on, so a future parser change
that "fixes" `\n` to `return` fails loudly here rather than silently
re-breaking or double-binding steering.

## Out of scope (note in the PR, do not fix here)

`/terminal-setup` (`packages/cli/src/ui/utils/terminalSetup.ts`) rewrites the
VS Code / Cursor / Windsurf / Antigravity `keybindings.json` so that **both**
`Shift+Enter` and `Ctrl+Enter` send `\\\r\n`. `bufferBackslashEnter` collapses
that to `{ name: 'return', shift: true }`, which only matches `Command.NEWLINE`.
Users who ran `/terminal-setup` therefore cannot steer with `Ctrl+Enter` on any
platform. That is a separate pre-existing defect and needs its own issue.

## Verification

- `npm run test`
- `npm run lint`
- `npm run typecheck`
- `npm run format`
- `npm run build`
- `npm run docs:keybindings -- --check` (autogen block must be unchanged)
- `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`
