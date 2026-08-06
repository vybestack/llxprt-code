# Issue #3052 — Publish provider-originated todo edits to observers

## Problem

`TodoWrite` (the tool) and `TodoProvider.updateTodos` (the CLI) are two
independent write paths to the task list. Only the tool path published
`todoEvents.emitTodoUpdated`:

- `packages/tools/src/tools/todo-write.ts` writes the store, then emits
  unconditionally — including for an empty array.
- `TodoProvider.updateTodos` did `setTodos(newTodos)` + `store.writeTodos(...)`
  and never emitted.

Everything that reaches an external observer is downstream of the event:

- `packages/cli/src/observation/jspWiring.ts` `createTodoObservationSubscription`
  subscribes to `todoEvents` and forwards to `observeTodosReplaced`, which calls
  `JspProducer.observeTodosReplaced` and publishes a `todos.replaced` transition.
- `packages/cli/src/zed-integration/zedIntegration.ts` subscribes to the same
  event.

Because `updateTodos` never emitted, every CLI-side mutation was invisible to
those consumers, and the last tool-written list was retained indefinitely.

## Invariant (bounded scope)

Every provider-originated mutation that changes the externally observed current
state publishes exactly once on the canonical `todoEvents` channel. This mirrors
the TodoWrite tool's canonical event **shape and channel**, not its call
ordering. The originating provider's own `todoEvents` listener must not re-enter
on its own echo.

## Affected call sites (all funnel through `updateTodos`)

- `packages/cli/src/ui/commands/todoCommand.ts` — `clear`, `remove all`, `load`
- `packages/cli/src/ui/commands/todoOperations.ts` — `applyStatusChange`,
  `addSubtaskAtPosition`, `addTaskAtPosition`, `removeSubtaskAtPosition`,
  `removeTaskAtPosition`, `removeRangeOfTasks`, `undoAllTodos`,
  `undoRangeOfTodos`, `undoSingleTodo`
- `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` — the
  auto-clear of a fully-completed list on the next user submit

Patching individual commands is wrong. The fix belongs at the choke point:
`updateTodos` publishes after applying state. `refreshTodos` does **not**
publish (see "Out of scope").

## Chosen fix

A shared module-level `publishTodos` helper constructs the canonical event and
the single write path (`updateTodos`) calls it exactly once.

```
updateTodos(newTodos)
  -> setTodos(newTodos)                 (optimistic UI)
  -> persistOrdered(newTodos)           (disk; fire-and-forget, but ordered — see below;
                                          failure -> error)
  -> publishTodos(...)                  (records exact event in origin ref,
                                          then synchronously emits to observer + peer)
```

### Synchronous, optimistic publication semantics (deliberate)

`updateTodos` keeps its existing synchronous API and its established optimistic
UI + fire-and-forget persistence semantics. Publication happens **synchronously
after** local state is applied and persistence is initiated: the observation
contract is "current accepted UI state", and emitting immediately preserves the
fail-fast behavior of the synchronous event emitter (a throwing observer
propagates to the caller). This issue does **not** broaden into converting every
`updateTodos` caller to async, nor does it change persistence ordering relative
to the tool path. We claim identical canonical event shape/channel only — not
identical ordering to TodoWrite.

### Per-provider ordered persistence (required by synchronous nesting)

`persistOrdered` keeps persistence fire-and-forget (no caller becomes async),
but it orders writes **per provider** so they reach disk in update call order.
The hook holds an `inFlightWriteRef` (`Promise<void> | null`). The first write
(ref null) starts immediately — before publication — preserving optimistic
semantics; each subsequent write chains behind the in-flight one via
`previous.then(write, write)` (the rejection branch runs the write anyway, so a
failed write reports the save error but does not poison later writes). When the
tail settles and is still current, the ref clears to null so the next write is a
fresh immediate start.

This is required, not optional: the synchronous, fail-fast publication means a
prepended `todoEvents` listener can invoke a nested `updateTodos` while the
outer publish is still on the stack. Without ordering, the outer and nested
fire-and-forget writes race on the same store file and can complete out of
order, leaving the stale outer data on disk (a real failure CI caught that
local focused runs masked). Ordering does not await persistence before
publishing and does not convert any caller to async; it only serializes the
per-provider write chain.

### Per-provider echo suppression (issue #3052)

A provider-originated publication would otherwise re-enter the provider's own
`todoEvents` listener (the listener that mirrors external TodoWrite events into
local state). Each `TodoProvider` instance holds an `originPublicationRef`. `publishTodos`
constructs the canonical event object, records that exact object in the ref,
emits synchronously, and clears the ref in `finally`. The origin's listener skips
only an event whose object identity matches the ref. The ref is per-instance,
so:

- the origin's own listener does not re-enter on its echo;
- external observers (JSP/jefe, Zed) receive the event exactly once;
- any matching peer provider (same session/agent) receives the event exactly
  once — its ref does not contain the event;
- external or synchronously nested events use different event objects and remain
  authoritative.

Because the echo carries the same array reference `updateTodos` just applied,
suppression is not independently observable through a render count. Behavioral
coverage therefore verifies peer delivery, later external-event authority, and
a synchronously nested external event that must not be mistaken for the origin's
publication.

## Out of scope (with rationale)

### Mount/session refresh publication — OUT OF SCOPE

The mount read and session-change read do **not** publish. `TodoStore.readTodos`
maps a parse or I/O failure to an empty list (`[]`), so a refresh cannot
distinguish an authoritative empty list from a load failure. Publishing the
refresh would risk advertising a stale or failed state as current, which is
outside the mutation bug this issue fixes. External TodoWrite events remain the
authoritative source for external observers.

### generationRef / concurrency / stale-read coordination — OUT OF SCOPE

The `generationRef` counter, the in-flight-refresh invalidation, and the
deferred-read race guard existed solely to make refresh publication safe (a
`/todo clear` while a mount read is resolving could otherwise clobber newer
accepted state). With refresh no longer publishing, that coordination has no
purpose and was removed; refresh behavior is restored close to HEAD (a plain
try/catch read with no generation gating). Reactive runtime session handoff is
also out of scope.

### Async API conversion (await persistence before publishing) — OUT OF SCOPE

A recommendation to make the provider await persistence before publishing
(equalizing ordering with the tool path) is intentionally **rejected**. It would
be a major API and call-graph expansion (every `updateTodos` caller would become
async) far beyond the mutation-visibility bug, and it would change established
optimistic semantics. The fix keeps the existing synchronous, optimistic,
fire-and-forget persistence and makes documentation honest about the difference.

### Per-provider ordered persistence — IN SCOPE (required)

What **is** in scope — and required — is ordered fire-and-forget persistence
*within one provider*. The synchronous, fail-fast publication means a prepended
`todoEvents` listener can invoke a nested `updateTodos` while the outer publish
is still on the stack. Two concurrent fire-and-forget `TodoStore` writes to the
same file would then race and could complete out of order, leaving the stale
outer data on disk — a real race CI caught that local focused runs masked. The
fix (see "Per-provider ordered persistence" above) chains writes per provider so
they reach disk in update call order, while keeping `updateTodos` synchronous and
fire-and-forget. Async API conversion (awaiting persistence before publishing)
remains out of scope; only the per-provider write chain is serialized.

## `/todo delete` is deliberately untouched

`/todo delete` (`deleteAllSessions` / `deleteSessionRange` /
`deleteSingleSession` in `todoOperations.ts`) operates on saved session files
via `fs.unlinkSync`, never calls `updateTodos`, and is therefore untouched.

## Tests (behavioral, Bun, no mock theater)

File: `packages/cli/src/ui/contexts/__tests__/todoProvider.observation.bun.tsx`.

These are provider-to-canonical-observation-seam integration tests. The wiring
under test is real:

- Render the real `TodoProvider` and capture its real context value.
- Subscribe with the real `createTodoObservationSubscription` — the exact seam
  `JspProducer` subscribes through — so a passing assertion proves the
  observation channel is reached.
- Drive the real `todoCommand` subcommands with a `CommandContext` whose
  `todoContext` is the LIVE provider context.

The provider, React, the event emitter, and the observation seam stay real.
Storage is isolated to a per-process temp dir by the manifest preloads; each
test uses a unique sessionId. A peer provider is mounted in its own React root
to assert peer delivery. The only place storage is intercepted is the
nested-provider persistence test, which spies on `TodoStore`'s write boundary
(`TodoStore.prototype.writeTodos`) solely to hold the outer write and prove the
nested write is queued behind it, then invokes the real captured write — the
provider, React, the event emitter, and the observation seam are not mocked.
This makes that regression deterministic rather than dependent on the filesystem
scheduler (CI caught a race local focused runs masked).

Coverage:

1. `/todo clear` publishes an empty replacement, clears provider state and disk.
2. Every mutation subcommand publishes: `set`, `unset`, `add`, `add 1.2`,
   `remove <n>`, `remove 1.2`, `remove all`, `remove 2-4`, `undo`, `undo 2-4`,
   `undo all`, `load`.
3. Published payload carries the provider `agentId` (explicit and default) on the
   JSP seam.
4. A single mutation applies to provider state exactly once (render count) and
   publishes once.
5. External `todoEvents` emits still reach the provider (same session/agent),
   and are ignored for a different session or agent.
6. The `shouldClearTodos` + `updateTodos([])` auto-clear choke point publishes.
7. The raw canonical event carries `sessionId`/`agentId` identity.
8. Origin echo suppression: a provider-originated publication still reaches a
   matching peer provider (per-instance flag), and a later authoritative
   external event is still applied (the flag is one-shot and does not leak).
9. A synchronously nested provider update is the final list on disk. The test
   holds the outer write via the `TodoStore` write-boundary spy, proves the
   nested write is queued (only the outer write invoked, disk still seeded),
   then releases the real captured outer write and asserts the nested write wins
   on disk — deterministic, not filesystem-scheduler dependent.

## Manifest registration

The file lives in its own manifest entry in `scripts/bun-test-manifest.ts`
(`workspace: 'cli'`) with both preloads:

- `test-setup-storage-isolation.ts` — redirects `Storage` roots to a per-process
  temp dir, so the real `TodoStore` disk I/O is sandboxed.
- `bun-test-setup.ts` — the React/Ink/JSDOM setup.

The `*.bun.tsx` suffix keeps it out of Vitest's `**/*.{test,spec}.*` include,
so no Vitest exclusion entry is needed.

The focused invocation (the @ast-grep `napi-darwin-arm64` native optional
binding must be installed; `bun install` restores it without changing
`bun.lock`):

```
bun scripts/run_bun_tests.ts todoProvider.observation.bun.tsx
```

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, and
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
