# Issue 3003 — JSP producer publishes the todo's real task state

## Problem

The JSP/1 producer publishes each todo as `{ text, completed: boolean }`.
`mapTodoCompleted` in `packages/cli/src/observation/jspRedaction.ts` collapses
the native three-state task model (`pending`, `in_progress`, `completed`) into a
boolean, so "the item the agent is working on right now" does not survive the
wire and the consumer can only guess at the active item.

## Accepted behaviour

The amended JSP/1 todo item is `{ "text": "<string>", "state": "<string>" }`.
`schema` stays `1`; this is a clean break, not a dual carry.

- **AC1 — the wire carries `state`, never `completed`.** Every published todo
  item on both the snapshot `todos` field and the `todos.replaced` event carries
  exactly `text` and `state`. The consumer schema is closed
  (`additionalProperties: false`), so a residual `completed` member would be
  rejected with JSP-E001.
- **AC2 — recognized statuses are published verbatim.** `pending`,
  `in_progress` and `completed` appear on the wire as themselves.
- **AC3 — the vocabulary is open and unrecognized statuses are not coerced.** A
  native status outside the recognized set is published verbatim. It is never
  mapped onto one of the three, because the consumer already degrades an
  unrecognized label to "not completed and not active", and coercing here would
  reintroduce exactly the loss this issue removes.
- **AC4 — `state` is bounded at 64 UTF-8 bytes, inclusive.** A status of exactly
  64 bytes is published unchanged. An over-bound status is refused: the
  projection throws and no todo replacement reaches the wire. Truncation is
  explicitly rejected as the producer behaviour. Text is truncated because it is
  free-form content whose tail carries no contract, but a status is an opaque
  label the consumer compares for equality, so a truncated one is a label the
  source never reported — a producer invention in the one field that exists to
  stop the producer guessing, which is AC3's violation by another route.
  Publishing the over-bound value instead is worse still: the consumer rejects
  the whole document with JSP-E002, which the producer classifies as terminal
  and stops. The native status set is a closed three-value enum well inside the
  bound, so this branch is an impossible state rather than input to accommodate,
  and failing surfaces the bug. The observation boundary (`isolate` in
  `jspWiring.ts`) already contains producer failures, so the cost is a dropped
  telemetry update and never a disrupted foreground session. The refused
  replacement must not consume a todo revision, because a hole in the revision
  sequence is how an observer detects loss.
- **AC5 — `mapTodoCompleted` is retired,** not adapted.
- **AC6 — no other bound behaviour changes.** Todo text truncation, the entry
  cap, and the `RangeError` on a negative byte bound or negative entry cap keep
  their current behaviour.

## Inputs and boundary cases

| Input status                          | Published `state`                       |
| ------------------------------------- | --------------------------------------- |
| `pending`                             | `pending`                               |
| `in_progress`                         | `in_progress`                           |
| `completed`                           | `completed`                             |
| `cancelled` (unrecognized)            | `cancelled`                             |
| empty string                          | empty string, verbatim                  |
| 64-byte label                         | unchanged                               |
| 16 astral characters (64 bytes)       | unchanged — the bound is bytes, not     |
|                                       | UTF-16 code units                       |
| 65-byte label                         | `RangeError`; nothing published         |
| 65-byte multibyte label               | `RangeError`; nothing published         |
| negative `todoStateBytes` (misuse)    | `RangeError`                            |

## Tests that prove it

All behavioural, against real producer code, no mock theater.

`packages/cli/src/observation/jspRedaction.test.ts`

1. `buildTodoItems` maps native todos to bounded `{text, state}` and preserves
   `in_progress` distinctly from `pending` and `completed` (AC1, AC2).
2. No published item carries a `completed` key (AC1) — asserted on the item's
   own keys, so a leftover member cannot slip through a `toMatchObject`.
3. An unrecognized status is published verbatim rather than coerced (AC3).
4. An empty status is published verbatim rather than substituted (AC3).
5. A 64-byte status is published unchanged (AC4 boundary, inclusive).
6. A 65-byte status throws, so no invented label can reach the wire (AC4). The
   assertion is on the thrown error, not on a truncated value, so an
   implementation that silently returned a shortened label would fail.
7. The bound is measured in UTF-8 bytes, not UTF-16 code units: 16 astral
   characters are 64 bytes and publish unchanged, and one more byte throws
   (AC4).
8. A negative `todoStateBytes` throws as a misuse of the bound rather than
   rejecting every status as over-bound (AC6 symmetry with `todoEntries`).
9. Existing text-bound, entry-cap and `RangeError` tests keep passing (AC6).

`packages/cli/src/observation/jspProducer.test.ts`

10. A `todos.replaced` event published for a mixed list carries
    `state: 'in_progress'` on the active item, proving the active item survives
    the wire. The event items and the snapshot items are both asserted with
    `toStrictEqual`, which is what proves AC1's negative half: a partial matcher
    would let a surviving `completed` member through, and the consumer schema is
    closed so such a member fails the whole document at ingress.
11. The terminal snapshot published at shutdown carries exactly
    `[{ text: 'Completed task', state: 'completed' }]` (AC1 end to end).
12. A replacement carrying an over-bound status publishes nothing at all, leaves
    the snapshot's todos unknown, and does not consume a revision — the next
    good replacement is still revision 1 (AC4).

`packages/cli/src/observation/jspProducerState.test.ts`

13. `todos.replaced` state transitions and `buildSnapshot` carry `state` through
    unchanged, including `in_progress` alongside `pending` (AC1 on the snapshot
    path).

## Scope

In scope: `jspRedaction.ts`, `jspDocuments.ts`, the `todoStateBytes` bound in
`jspBounds.ts`, the `buildTodoItems` call site in `jspProducer.ts`, and the
producer tests that assert the boolean.

Out of scope: any change to the todo payload beyond task state, the consumer
half (tracked as vybestack/llxprt-jefe#625), and unrelated observation cleanup.

## Coordination

The two halves must land together. A producer still sending `completed` is
rejected at ingress by the amended consumer, and a producer sending `state` is
rejected by the unamended one.
