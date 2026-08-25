# Issue #3288 — Escape taskStreaming tag attributes and restore scope message handlers

## Scope

Owned files:

- `packages/agents/src/tools/taskStreaming.ts` (production)
- `packages/agents/src/tools/taskStreaming.test.ts` (new, unit-level behavior)
- `packages/agents/src/tools/task.test.ts` (TaskTool-level lifecycle evidence)

Explicitly out of scope (do not touch):

- `packages/agents/src/tools/taskAsyncExecution.ts` `setupAsyncStreaming` — a
  separate function with the same shape; the issue names only `taskStreaming.ts`.
- `packages/core/src/tools-adapters/CoreSubagentServiceAdapter.ts` — separate
  duplicate emitter, also not named by the issue.
- Heartbeat ordering (`task.ts` already stops the heartbeat before the closing
  tag), per the issue's Scope section.
- The closing-tag shape `</subagent name="..." id="...">` is not well-formed XML
  (closing tags cannot carry attributes). Changing the wire format is NOT in
  scope; multiple existing tests assert the current shape. We only escape the
  interpolated values.

## Accepted behavior (acceptance criteria)

AC1. Attribute escaping. `subagentName` and `agentId` are escaped before being
interpolated into the opening and closing subagent tags. Escaped characters:
`&` -> `&amp;`, `<` -> `&lt;`, `>` -> `&gt;`, `"` -> `&quot;`, `'` -> `&apos;`.
`&` must be replaced first so already-escaped output is not double-mangled in a
different order.

AC2. Format preserved for ordinary names. A name with no special characters
produces byte-identical output to today (`<subagent name="helper" id="agent-42">\n`
and `</subagent name="helper" id="agent-42">\n`). Existing tests in
`task.test.ts`, `task.max-turns.test.ts`, `task.issues.test.ts`, and
`task.heartbeat.test.ts` must pass unchanged.

AC3. Handler restoration. When streaming closes (`emitClosingSubagentTag`),
`scope.onMessage` is set back to whatever it was before `setupTaskStreaming`
installed the relay, including `undefined`. Because `task.ts` calls
`emitClosingSubagentTag()` from a `finally` block, this covers success, thrown
error, and abort/cancellation paths. Restoration also happens when the closing
emit itself throws (restore before emit), and repeat calls are no-ops.

AC4. No output after the closing tag. If a stale reference to the installed
relay is invoked after close, it emits nothing (no delta, no heartbeat reset).

AC5. Chaining preserved. While the task is active, the relay calls the
pre-existing `scope.onMessage` after emitting the delta. After close, a stale
relay reference still forwards to the pre-existing handler (the same thing the
restored `scope.onMessage` would do), it just does not emit.

## Boundary inputs

- name `he said "hi"` -> `he said &quot;hi&quot;`
- name `a&b` -> `a&amp;b`
- name `<script>` -> `&lt;script&gt;`
- name `it's` -> `it&apos;s`
- name with all of the above combined
- empty name (`''`) -> unchanged, still emits `name=""`
- ordinary name -> unchanged (AC2 regression guard)
- `agentId` is a UUID in production, so escaping is a no-op there; it is escaped
  anyway because the issue requires every dynamic attribute value escaped.

## Implementation sketch

In `taskStreaming.ts`:

1. Add a module-local `escapeXmlAttributeValue(value: string): string` helper
   (five `.replace` calls, `&` first). Not exported unless a test needs it —
   tests assert through the emitted tags, so it stays private.
2. Compute `escapedName` / `escapedAgentId` once at setup and use them in both
   tag templates.
3. Capture `existingHandler = scope.onMessage` and store a
   `restoreScopeHandler: (() => void) | undefined` closure that reassigns it.
4. Gate the relay body on `xmlOutputOpen`: when closed, skip
   `heartbeat.reset()`, skip `normalizer.push`/`emitAppend`, still call
   `existingHandler?.(message)`.
5. In `emitClosingSubagentTag`: snapshot `xmlOutputOpen`, set it to `false`,
   run `restoreScopeHandler?.()` and clear it (idempotent by nulling), then
   return early if it was not open, otherwise flush and emit the closing tag.
   Restoring before emitting means a throwing `updateOutput` cannot leak the
   relay onto the scope.

No new exports, no new abstractions, no dependency changes.

## Test plan (Bun, behavioral)

New file `packages/agents/src/tools/taskStreaming.test.ts` calls the real
`setupTaskStreaming` with the real `startTaskHeartbeat` (injected dependency in
the signature), a plain scope-shaped object, and an `updateOutput` collector
that records the real `LiveOutputUpdate` values. Every test stops the heartbeat
so no timer leaks. No mocking of the unit under test.

1. escapes quotes in the name in both opening and closing tags
2. escapes ampersands and angle brackets in the name in both tags
3. escapes apostrophes in the name
4. emits an unchanged tag for a plain name (format regression guard)
5. escapes a dynamic agent id containing special characters
6. restores a pre-existing `scope.onMessage` after close
7. restores `undefined` when there was no pre-existing handler
8. forwards messages to the pre-existing handler while active, in addition to
   emitting the delta
9. emits nothing when a stale relay reference is invoked after close, while
   still forwarding to the pre-existing handler
10. restores the handler even when `updateOutput` throws during the closing emit
11. repeated `emitClosingSubagentTag()` calls do not re-clobber a handler
    installed after close

TaskTool-level lifecycle evidence added to `packages/agents/src/tools/task.test.ts`:

12. after a successful run, `scope.onMessage` is the handler the scope had
    before `execute()`
13. after the subagent throws, `scope.onMessage` is restored (error path)
14. after an abort during the run, `scope.onMessage` is restored (cancellation
    path)

## Review triage

Local review round 1 (deepthinker, plus an independent OCR run that reported
zero findings):

- MEDIUM "restoration is not ownership-aware": **In-scope-Fix, applied**. The
  restore closure now compares `scope.onMessage` to the relay it installed and
  only restores when it still owns the slot, so a handler installed by other
  code while the task ran survives the close. Covered by the new test "leaves a
  handler installed while streaming was active in place at close", which fails
  without the identity check.
- LOW (PR-level OCR round) "if `emitAppend(flushed)` throws, the closing tag is
  never emitted and the stream is already marked closed": **Reject**. Not a
  regression: before this change a throwing consumer also prevented the closing
  tag, and it additionally left `xmlOutputOpen` true and the relay installed.
  The throw propagates out of the `finally` in `task.ts` either way. Emitting
  the terminator into a consumer that just threw, via a nested `finally`, is
  speculative hardening outside this issue's acceptance criteria.
- LOW "new tests use `as unknown as` assertions": **Reject**. Every neighbouring
  TaskTool suite (`task.test.ts`, `task.heartbeat.test.ts`,
  `taskAsyncStreaming.test.ts`) builds its orchestrator/launch fakes the same
  way. Constructing a full `SubagentLaunchResult` would add unrelated surface to
  this issue and diverge from the file's established convention.

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, plus the `stepfun-37` smoke run. Then `bun scripts/test-audit/scan.ts`
to confirm no new test-audit findings on the touched files.
