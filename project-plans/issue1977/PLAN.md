# Issue #1977: prefill guard for models without prefill support (fable model error)

Date: 2026-09-16. Issue: [#1977](https://github.com/vybestack/llxprt-code/issues/1977).
Branch: `issue1977` off main @ `42f7d7948`.
Milestone: 0.12.0. Labels: claude, Model Support, Context Management.

## Problem

`anthropic:claude-fable-5` rejects assistant message prefill:

```
API Error: 400 {"type":"error","error":{"type":"invalid_request_error",
"message":"This model does not support assistant message prefill. The conversation
must end with a user message."}}
```

The turn's history can end with an assistant message (e.g. conversations resumed
or migrated across models: reporter's session went opus → gpt-5.5 → fable). The
Anthropic API then treats the trailing assistant message as a prefill attempt.
Fable 5 never accepts prefill, so the request 400s.

PR #1555 (issue #1545) already guards this case when thinking is enabled:
`ensureNoTrailingAssistant` in `packages/providers/src/anthropic/AnthropicMessageValidator.ts`
appends a placeholder user message. But with the default `reasoning.enabled`
unset/false, `shouldIncludeThinking` is false, so the guard never fires for
fable: the request goes out ending with an assistant message and the API
rejects it. The reporter saw exactly this (non-fatal error text appended at a
turn boundary).

## Acceptance criteria

### AC1: No-prefill guard for Fable 5 (the bug)

- GIVEN the resolved model is a Claude Fable 5 variant and reasoning is NOT
  enabled (the default) and the converted request messages end with an
  assistant message,
- WHEN the provider builds the Anthropic request,
- THEN a placeholder user message (`Continue the conversation`) is appended so
  the messages array ends with a user message, and the prefill 400 from #1977
  cannot occur.

### AC2: Existing thinking guard preserved

- GIVEN reasoning IS enabled and messages end with an assistant message (any
  model),
- THEN the placeholder is appended exactly as today (#1545 behavior unchanged).

### AC3: Single placeholder when both conditions hold

- GIVEN a Fable model AND thinking enabled AND a trailing assistant message,
- THEN exactly ONE placeholder user message is appended (no duplicates).

### AC4: Prefill-capable models unchanged

- GIVEN a prefill-capable model (e.g. claude-sonnet-4-5-20250929,
  claude-opus-4-8) with reasoning disabled and a trailing assistant message,
- THEN no placeholder is appended; the last message remains assistant (prefill
  stays available, current behavior).

### AC5: Unknown / missing model unchanged

- GIVEN `currentModel` is undefined or an unrecognized id,
- THEN behavior is unchanged (placeholder only when thinking is enabled).
  Unknown models default to prefill-supported.

### AC6: No placeholder when already ending with a user message

- GIVEN any model and the conversation already ends with a user message,
- THEN no placeholder is appended.

## Inputs and boundary cases

- Fable id matching reuses the existing anchored `isFable5` pattern
  (`FABLE_5_PATTERN`): `claude-fable-5`, `claude-fable-5-latest`,
  `claude-fable-5-YYYYMMDD`, `claude-fable-5-1` + `-latest`/dated variants,
  case-insensitive. Near-misses (`claude-fable-50`, `claude-fable-51`,
  `claude-fable-5-1-mini`, vendor-prefixed ids) are NOT fable and keep
  prefill support.
- The guard runs in the single conversion funnel
  (`convertToAnthropicMessages` → `ensureValidMessageSequence`), so it covers
  streaming/non-streaming, OAuth, and the dump-conversion path
  (`providerRequestConversion.ts` already passes `currentModel`).
- `currentModel` is already threaded into the normalizer options by
  `AnthropicRequestPreparation.convertMessagesAndTools`; no plumbing changes
  are needed upstream of the normalizer.

## Implementation sketch

1. `packages/providers/src/anthropic/AnthropicModelData.ts`
   - Export `modelSupportsPrefill(modelId: string | undefined): boolean`:
     false only for Fable 5 ids (route through `isFable5`); true for
     undefined/empty/unknown ids. Doc comment cites #1977 and the exact API
     error text. Follows the existing `isOpus46Plus`/`isFable5` helper style.
2. `packages/providers/src/anthropic/AnthropicMessageValidator.ts`
   - `ensureValidMessageSequence` and `ensureNoTrailingAssistant` accept the
     model id; guard fires when `shouldIncludeThinking` OR
     `!modelSupportsPrefill(modelId)`; debug log distinguishes the two
     reasons (thinking enabled vs. model without prefill support).
3. `packages/providers/src/anthropic/AnthropicMessageNormalizer.ts`
   - Pass `options.currentModel` into `ensureValidMessageSequence`.

## Tests that prove it (TDD: red first, then green)

1. New behavioral suite
   `packages/providers/src/anthropic/AnthropicProvider.issue1977.test.ts`
   using the shared `setupThinkingProvider` harness (mocked
   `messages.create`), pinning the model via
   `settingsOverrides: { global: { model: ... } }`, asserting on the captured
   request body's last message:
   - fable + reasoning default (off) + trailing assistant → last message is
     the user placeholder (AC1).
   - fable + reasoning on + trailing assistant → placeholder present, exactly
     one, thinking field still `adaptive` (AC2, AC3; no #2328 regression).
   - sonnet + reasoning off + trailing assistant → last message remains
     assistant (AC4).
   - fable + conversation already ending with user → no placeholder, original
     text preserved (AC6).
   - fable id variants (`-latest`, dated snapshot, `-1`) → guard fires (AC1
     boundary).
2. Unit additions in `packages/providers/src/anthropic/AnthropicModelData.test.ts`
   for `modelSupportsPrefill`: fable variants false; opus/sonnet/haiku,
   unknown, empty, undefined true (AC5).

## Out of scope

- No changes to other providers, no retry/`--continue` machinery, no
  changelog edits, no new settings or public abstractions beyond the exported
  helper in the model-data module.
- OCR is not run (standing directive: disabled until re-enabled).

## Verification

Full cycle per `.llxprt/skills/llxprt-issue-workflow`: `npm run test`,
`npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`, and
the `bun scripts/start.ts --profile-load zai-glm-flash "write me a haiku and
nothing else"` smoke. Long commands run with nohup + poll (watchdog) and logs
land in repo-local `tmp/verify1977/`.

Review: deepthinker compliance review, max 2 rounds. Status recorded below.

## Status

- [x] Research complete (pipeline traced, root cause confirmed)
- [x] Implementation (tscoder-flash subagent; typescriptexpert qwen38 endpoint
  down, fallbacktypescriptcoder astra quota exhausted)
- [x] Verification cycle green: full `npm run test` exit 0 (~13 min),
  lint/typecheck/format/build all exit 0, zai-glm-flash smoke exit 0 with real
  haiku output. Logs: `tmp/verify1977/cycle-*.log` + `.exit` files; scoped
  red/green evidence in `tmp/verify1977/red.log` / `green.log` (red: 6 fail
  reproducing the bug + missing-export error; green: 116 pass / 0 fail).
- [x] deepthinker review round 1: deepthinker/reviewer subagents were
  quota-exhausted (astra + gpt56solhigh pools); clean-context review performed
  by a fresh tscoder-flash instance (zai-glm-flash). Verdict: PASS, all six
  ACs verified, call-path completeness confirmed (single production funnel;
  streaming/OAuth/dump all covered), no #1545/#2328 regressions, scope clean.
  Independent scoped re-run: 116 pass / 0 fail (tmp/verify1977/review/).
  Findings triage: (1) theoretical double-placeholder for a degenerate
  single-assistant history ([user, assistant, user], API-valid, predates this
  change) → Reject; (2) local messageTextContent helper mirrors per-test-file
  convention, plan excludes new shared abstractions → Reject. No
  Blocker-Fix/In-scope-Fix findings → no remediation round needed.
- [ ] Remediation + re-verify (not needed; round 2 unused)
- [ ] PR created (fixes #1977), CI + CodeRabbit watched
- [ ] Merge decision reported to owner (no self-merge)

Note: OCR not run: standing directive disables OCR until re-enabled.
