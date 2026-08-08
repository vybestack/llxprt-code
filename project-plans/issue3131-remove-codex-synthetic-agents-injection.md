# Issue #3131 — Remove the reverted Codex synthetic AGENTS.md injection and its random call_id

## Problem

`buildRequestInput()` in `packages/providers/src/openai-responses/openAIResponsesExecutor.ts`
prepends a fabricated `read_file("AGENTS.md")` `function_call` plus its
`function_call_output` to the head of the `input` array on **every** Codex request.
The pair is keyed by a `call_synthetic_<random>` id produced by
`Math.random()`, and when user memory is present the synthetic output embeds the
entire resolved memory blob a second time (it is already inside `instructions`).

This code was deliberately deleted in `5373ffd0ca` (#1189) once OpenAI stopped
requiring the fixed `CODEX_SYSTEM_PROMPT` header, and was silently reintroduced by
`ddec3b5fa` (#1156); the GPT-5.6 support PR (`63b88554b0` / #2497) only relocated it
into `openAIResponsesExecutor.ts`. (The issue text attributes the reintroduction to
#2497; git shows it was #1156 — see "Resolved: the two remaining Codex-only
transforms" below.) The justifying comments still cite `CODEX_SYSTEM_PROMPT`, a
constant that no longer exists anywhere in the repo.

Harms:

1. The random `call_id` mutates the leading bytes of the prompt every turn, which
   defeats prompt-prefix caching.
2. Resolved user memory is transmitted twice per request.
3. It blocks #3134: the Codex WebSocket transport only reuses an incremental input
   delta when the new input strictly extends the previous input, and a fresh random
   head item breaks that check every turn.

## Acceptance criteria

- **AC1** No synthetic `read_file` / `AGENTS.md` `function_call` or
  `function_call_output` is present in any Codex request `input`.
- **AC2** `generateSyntheticCallId` and `injectSyntheticConfigFileRead` are deleted
  from `OpenAIResponsesProviderBase.ts` and `openAIResponsesExecutor.ts`, the
  `generateSyntheticCallId` member is removed from `ResponsesExecutorDeps` and every
  implementation/mock of it, and the two `CODEX_SYSTEM_PROMPT` comments are gone.
- **AC3** Resolved user memory appears exactly once in a serialized Codex request
  (inside `instructions`), never inside an `input` item.
- **AC4** The leading `input` item is byte-identical across two consecutive turns of
  a Codex session, and the turn-N+1 `input` strictly extends the turn-N `input`
  (append-only) — the precondition #3134 depends on.
- **AC5** Non-Codex `openai-responses` request assembly is unchanged: `input` is
  passed through untouched, with no filtering and no reordering on either path.
- **AC6** Behavioral tests per `dev-docs/RULES.md` cover request shape and
  memory-occurrence count; no test asserts the synthetic injection shape.

## Resolved: the two remaining Codex-only transforms

The issue's step 2 directed: "reduce `buildRequestInput` to its non-Codex behavior
(system-message filtering and reasoning ordering only, if those are still required —
verify each independently rather than preserving them by default)." Independent
verification shows **neither is required**, so both are removed and
`buildRequestInput` is deleted entirely.

Verified history:

- `5373ffd0ca` (#1189, Jan 2026) deliberately removed the Codex request-input
  special-casing, leaving the Codex path as literally `const requestInput = input;`
  — no system filter, no reasoning reorder, no injection.
- `ddec3b5fa` (#1156, Jan 29 2026, "fix(openai-responses): emit reasoning blocks
  from responses stream") re-added **all three** in a single commit:
  `injectSyntheticConfigFileRead`, the `role !== 'system'` filter, and the reasoning
  hoist.
- `63b88554b0` (#2497) only **relocated** that block into `openAIResponsesExecutor.ts`.

So the system filter and the reasoning hoist are not independent prior art — they
are part of the same resurrected block that #1189 deleted. Both are removed because
neither is required:

- **System-role filter** — unreachable. The executor's input builder
  (`OpenAIResponsesInputBuilder.ts`) emits only `role: 'user'` and
  `role: 'assistant'` items; the system prompt travels in `instructions`, never as
  an `input` item. There is nothing for the filter to remove.
- **Reasoning hoist** — made AC4 false and blocked #3134. The hoist moved every
  `type: 'reasoning'` item to the front of `input`, but Codex resends full history
  every turn (`store = false`, no `previous_response_id`), so the head of `input`
  grew a new reasoning item on every assistant turn — the leading item was NOT
  stable across turns. Removing it restores the natural interleaved order that
  `OpenAIResponsesInputBuilder` already produces (each reasoning item immediately
  before the `role: 'assistant'` output it produced), which is exactly the shape the
  Responses API requires, and makes Codex `input` strictly append-only across turns
  — the precondition that #3134 (Codex WebSocket incremental input delta) depends on.

## Boundary cases

| Case | Expected |
| --- | --- |
| Codex + `userMemory` non-empty | memory only in `instructions`; no `input` item contains it |
| Codex + `userMemory` empty/undefined | no `File not found: AGENTS.md` item; no synthetic pair |
| Codex + history containing reasoning items | reasoning items remain in natural interleaved order (adjacent to the assistant turn that produced them); never hoisted to the front |
| Codex + history containing a system-role message | n/a — no system-role `input` item is ever produced; the system prompt travels in `instructions` |
| Non-Codex openai-responses | `input` returned identity-equal, no filtering, no reordering |
| Two consecutive turns of one session | identical leading `input` item; turn N+1 `input` strictly extends turn N |

## Test plan (test-first; must fail before the change)

`packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.codex.stateless.test.ts`
(or a focused new file in the same directory, `bun:test` only):

1. **AC1** — capture a Codex request body; assert no element of `input` is a
   `function_call` named `read_file` with `AGENTS.md` arguments, and no element is a
   `function_call_output` whose `call_id` matches `/^call_synthetic_/`.
2. **AC3** — with a distinctive `userMemory` sentinel, assert the sentinel occurs
   exactly once in the serialized request body and that occurrence is in
   `instructions`, not in `input`.
3. **AC3 (empty branch)** — with no `userMemory`, assert no `input` item contains
   `File not found: AGENTS.md`.
4. **AC4** — capture request bodies for two consecutive turns of one session: turn 1
   history is a single human turn `[u1]`; turn 2 history is `[u1, assistantTurn, u2]`
   where `assistantTurn` carries both a `thinking` block (with `encryptedContent` and a
   fixed `providerMetadata['openai.responses.reasoningId']`) and a `text` block. Assert
   `input[0]` deep-equals across both turns (leading item stable), and that the turn-2
   `input` strictly extends the turn-1 `input` (`inputItems(turn2).slice(0,
   inputItems(turn1).length)` deep-equals `inputItems(turn1)`) — the append-only
   property #3134 depends on.
5. **AC5** — assert a non-Codex `openai-responses` request's `input` preserves the
   original conversation ordering and does not hoist reasoning items to the front,
   proving no input shaping remains on either path. (No system-role `input` item is
   produced on either path: `OpenAIResponsesInputBuilder` emits only `role:'user'`
   and `role:'assistant'`, and the system prompt travels in `instructions`.)

`OpenAIResponsesProvider.codex.malformedCallId.test.ts` — confirm the existing
orphan-`function_call_output` invariant still holds with no synthetic ids present.

## Implementation steps

1. `packages/providers/src/openai-responses/OpenAIResponsesProviderBase.ts`
   - delete `generateSyntheticCallId()` and `injectSyntheticConfigFileRead()` plus
     their `CODEX_SYSTEM_PROMPT` / `@issue #966` doc comments;
   - drop any imports left unused by the deletion.
2. `packages/providers/src/openai-responses/openAIResponsesExecutor.ts`
   - delete the module-level `injectSyntheticConfigFileRead()`;
   - remove `generateSyntheticCallId` from `ResponsesExecutorDeps`;
   - delete `buildRequestInput` entirely — both the system filter and the reasoning
     hoist were verified unnecessary (see "Resolved: the two remaining Codex-only
     transforms") — and pass `input` directly to `createRequest` at the
     `buildRequestContext` call site. The `isCodex` local is retained (still used by
     `computeStatefulConversation`, `applyCodexRequestSettings`, `applyPromptCaching`,
     and `applyStatefulConversation`).
3. Remove the `generateSyntheticCallId` wiring from
   `OpenAIResponsesProviderCore.ts` and `packages/providers/src/openai/OpenAIProvider.ts`.
4. Remove `generateSyntheticCallId` from the mock `ResponsesExecutorDeps` in the five
   provider test files that declare it.
5. Add the behavioral tests above.

## Cache-hit measurement (AC of the issue, step 6)

The before-baseline is the dataset recorded in the issue (90,569 local token-usage
records): `codex/gpt-5.6-sol` 26,174 requests, 3,508,642,712 prompt tokens,
2,561,123,840 cached, **73.0% hit rate**, versus `claudecode/claude-opus-5` at 98.8%.
No equivalent analytics store exists in this checkout, so the after-figure cannot be
produced from a unit test; it requires accumulated live Codex traffic on the merged
change. The deterministic in-repo proof of the mechanism is AC4 (stable leading
`input` item plus the append-only strict-extension assertion across turns). This
limitation is stated in the PR.

## Verification

    npm run test
    npm run lint
    npm run typecheck
    npm run format
    npm run build
    bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
