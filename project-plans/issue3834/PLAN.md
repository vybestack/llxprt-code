# Issue #3834 — Claude 5.5 generation support

## Problem

Selecting `claude-opus-5-5` on the `claudecode` alias fails before the request
reaches a model:

```
API Error: 400 {"type":"error","error":{"type":"invalid_request_error",
"message":"Claude Code 2.1.257 does not support this model; version 2.1.280 or
newer is required. Run 'claude update', or update the Claude desktop app, then
try again.","details":{"error_code":"claude_code_version_too_old"}},
"request_id":"req_011Cfq5zTY33B5kG4X6JCk83"} (Status: 400)
```

Three layers of defect:

1. The OAuth `User-Agent` llxprt sends is pinned at `claude-cli/2.1.257`, below
   the `2.1.280` floor the Claude subscription endpoint requires for the 5.5
   generation.
2. The 5.5 generation is absent from every model catalog, capability predicate,
   limit table, and alias rule in the repo.
3. Every capability predicate in `AnthropicModelData.ts` is an anchored regex
   enumerating known versions, so the 5.5 IDs would be treated as legacy
   budgeted-thinking models. Budgeted thinking returns 400 on all three, and so
   does `thinking: {"type": "disabled"}` on two of them. The wire shape llxprt
   would build is wrong in several distinct ways, not just unlisted.

## Guiding principle for this work

Do what is required for the 5.5 models to work and perform well on llxprt. Do
not port Anthropic's client-side restrictions into llxprt merely because the
Claude Code client enforces them. Where the API is the authority, let the API be
the authority and return its own error; where llxprt would otherwise build a
body the API rejects, build the right body instead.

Concretely: this plan does not add new client-side refusals. It changes what
llxprt emits so the emitted request is accepted.

## Authoritative model facts

Fetched 2026-10-08 from `platform.claude.com/docs/en/models/overview`,
`/build-with-claude/thinking`, and `/build-with-claude/preserved-thinking`. Do
not substitute training-data recollection for any of this; the 5.5 generation
postdates the implementing model's training cutoff.

### Catalog

| Model             | API ID              | Released   | Context | Max output | Batches ceiling | Default effort |
| ----------------- | ------------------- | ---------- | ------- | ---------- | --------------- | -------------- |
| Claude Opus 5.5   | `claude-opus-5-5`   | 2026-09-22 | 1M      | 128K       | 300K            | `medium`       |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | 2026-09-28 | 1M      | 128K       | 300K            | `high`         |
| Claude Haiku 5.5  | `claude-haiku-5-5`  | 2026-10-07 | 1M      | 128K       | 300K            | `medium`       |

Model IDs from the 4.6 generation on are dateless pinned snapshots. There is no
`-latest` pointer and no `-YYYYMMDD` snapshot for any 5.5 ID. Do not invent one
in any catalog list.

### Thinking configuration matrix

What each model does with each `thinking` value a request can send:

| Model             | no `thinking` field | `"adaptive"` | `"enabled"` + `budget_tokens` | `"between_tools"`                    | `"disabled"`                 |
| ----------------- | ------------------- | ------------ | ----------------------------- | ------------------------------------ | ---------------------------- |
| Claude Opus 5.5   | adaptive            | adaptive     | **400**                       | **400**                              | **400**                      |
| Claude Sonnet 5.5 | adaptive            | adaptive     | **400**                       | up-front thinking off, effort ≤ high | **400**                      |
| Claude Haiku 5.5  | adaptive            | adaptive     | **400**                       | **400**                              | thinking off, effort ≤ high  |
| Claude Opus 5     | adaptive            | adaptive     | **400**                       | **400**                              | thinking off, effort ≤ high  |
| Claude Sonnet 5   | adaptive            | adaptive     | **400**                       | **400**                              | thinking off (no effort cap) |
| Claude Fable 5.1  | adaptive            | adaptive     | **400**                       | **400**                              | **400**                      |

"effort ≤ high" means the request works at `low`, `medium`, and `high` and
returns 400 at `xhigh` or `max`.

Additional wire rules:

- `between_tools` takes **no other field**. Sending `display`, `budget_tokens`,
  or `block_binding` alongside it returns 400. It needs no beta header.
- `display` is invalid with `thinking.type: "disabled"`.
- `display` defaults to `"omitted"` on every 5.5 model; `"summarized"` opts in.
  llxprt already sets `display: "summarized"` on the adaptive path when
  `reasoning.includeInContext` is not false, which is correct.
- Non-default `temperature`, `top_p`, or `top_k` return 400 on all three 5.5
  models on every request, whether or not thinking is used.
- Assistant-response prefill is rejected while thinking is on. Thinking is on by
  default on all three 5.5 models.
- Forced tool use (`tool_choice` `any`/`tool`) is rejected on Opus 5.5 and
  Sonnet 5.5. llxprt's Anthropic request builder never sends `tool_choice`
  (verified by grep: no `tool_choice` or `toolChoice` in
  `packages/providers/src/anthropic/`), so there is nothing to do here. Record
  this as checked, add no code.

### Preserved thinking (prefix check)

Starting with Claude Fable 5.1, the API validates each returned `thinking` /
`redacted_thinking` block's `signature` against its prefix: the top-level
`system` prompt, the `tools` set, and every message before the block. If the
prefix changed since the block was produced, that block and every later thinking
block are invalid.

- The API enforces this by default on `claude-fable-5-1`, `claude-opus-5-5`,
  `claude-sonnet-5-5`, and `claude-haiku-5-5` for accounts created on or after
  2026-08-31 00:00 UTC. On older accounts it enforces only when the request sets
  `thinking.block_binding.prefix_mismatch_behavior`.
- Default behavior when enforced is `"error"`: a 400 naming the first failing
  block. `"drop_block"` instead drops the failing block and every later thinking
  block and succeeds.
- `block_binding` requires the `thinking-binding-controls-2026-08-01` beta
  header. Sending the field without the header returns 400 with
  `block_binding: Extra inputs are not permitted`.
- `block_binding` is accepted alongside `thinking.type: "adaptive"` and
  `"enabled"`. On Sonnet 5.5 and Haiku 5.5 it works **only** with `"adaptive"`;
  sending it with `between_tools` (Sonnet 5.5) or `disabled` (Haiku 5.5) returns
  400.
- Responses carry a top-level `input_transformations` array. When streaming it
  arrives on the `message` object in the `message_start` event. Entries are
  `{type, path, reason}` with `type` in
  `thinking_dropped` / `thinking_mismatch_allowed` and `reason` in
  `prefix_binding_mismatch` / `model_binding_mismatch` /
  `organization_binding_mismatch`.

Why this matters for llxprt specifically: llxprt renders the current date and
environment into the system prompt, and compacts conversation history
client-side. Both change the checked prefix mid-session. On an enforced account
that is a hard 400 on the first request after a compaction or a date rollover.
`drop_block` turns that into graceful degradation.

## Work packages

Implementation runs in four sequential passes. **Every pass must end with the
full verification cycle green before the next pass starts.** Do not leave a pass
half-done.

---

## PASS 1 — Headers, catalog, predicates, limits, alias rules

### WP1 — OAuth User-Agent floor

File: `packages/providers/src/anthropic/AnthropicApiExecution.ts`

- `buildAnthropicCustomHeaders` sets `'User-Agent': 'claude-cli/2.1.257 (external, cli)'`
  for OAuth requests. Raise to `claude-cli/2.1.293 (external, cli)`.
  `2.1.293` is the published `@anthropic-ai/claude-code` release as of
  2026-10-08 (`npm view @anthropic-ai/claude-code version`); the observed server
  floor is `2.1.280`.
- Extract the string into one exported constant in that module (for example
  `CLAUDE_CLI_USER_AGENT`) so the test asserts the same source of truth and
  future bumps are a single edit.
- Replace the stale `Fable 5.1 ... 2.1.255` comment with the observed floor and
  the issue reference.
- `packages/providers/src/anthropic/AnthropicProvider.oauth.test.ts` line ~470
  hardcodes the old string; update it.

Test: an OAuth request's `User-Agent` parses as
`claude-cli/<major>.<minor>.<patch>` and compares `>= 2.1.280` by numeric
component comparison, not string equality, so the floor stays enforced across
future bumps. Add a second assertion pinning the exact current value so a
silent downgrade is still caught.

### WP2 — Capability predicates and geometry

File: `packages/providers/src/anthropic/AnthropicModelData.ts`

Keep the anchored-regex discipline. No substring matching. Near-misses (`claude-opus-5-50`, `claude-sonnet-5-50`,
`claude-haiku-5-50`, `anthropic/claude-opus-5-5`, and leading/trailing
whitespace) must not match any new predicate.

1. `isOpus46Plus` must accept `claude-opus-5-5`. Extend the version alternation
   in `OPUS_46_PLUS_PATTERN`; do not loosen the anchor.
2. Add `isSonnet55` for `claude-sonnet-5-5` and `isHaiku55` for
   `claude-haiku-5-5`. Do not fold either into `isSonnet5`: Sonnet 5 and
   Sonnet 5.5 differ in disabled-thinking acceptance, and `isSonnet5` is
   consumed for Sonnet-5 geometry.
3. `supportsAdaptiveThinking` must return `true` for all three 5.5 IDs. This is
   the primary functional fix: `AnthropicRequestBuilder` (line ~368) attaches
   legacy budgeted `thinking.type: "enabled"` when this returns `false`, and
   budgeted thinking returns 400 on all three.
4. `getMaxTokensForModel`: `128000` for all three. The existing Opus branch
   returns `32000` for anything matching `isOpus46Plus`, so `claude-opus-5-5`
   needs an explicit earlier branch. Verify `claude-haiku-5-5` does not fall
   through to the `['haiku','4']` substring rule (`200000`) or the `4096`
   default.
5. `getContextWindowForModel`: `200000` for all three, matching the existing
   Opus 5 / Sonnet 5 / Fable 5 treatment. 200K is the Claude Code subscription
   default; the 1M window is raised by the alias `context-limit` rule. Mirror
   the existing comments that explain that split.
6. `getLatestClaudeModel`: `opus` → `claude-opus-5-5`, `sonnet` →
   `claude-sonnet-5-5`, `haiku` → `claude-haiku-5-5`, default →
   `claude-sonnet-5-5`. Delete the invented `claude-haiku-4-latest` value and
   its "Haiku 4 not yet available" comment. Existing assertions in
   `AnthropicModelData.test.ts` expect the old `-latest` strings; update them.
7. `DEFAULT_MODELS`: add, newest-first within each family,
   `claude-opus-5-5` / "Claude Opus 5.5", `claude-sonnet-5-5` /
   "Claude Sonnet 5.5", `claude-haiku-5-5` / "Claude Haiku 5.5". Keep the
   `contextWindow` / `maxOutputTokens` values consistent with
   `getContextWindowForModel` / `getMaxTokensForModel` (200000 / 128000) so
   `AnthropicModelData.test.ts` stays coherent. `DEFAULT_MODELS` carries
   subscription-default geometry; the alias `staticModels` lists carry the
   published 1M/128K figures, exactly as `claude-opus-5` already differs
   between the two.
8. Do **not** change `supportsDisabledThinking` or `modelSupportsPrefill` in
   this pass. Passes 2 and 4 own them.

### WP3 — Alias configs

Files: `packages/providers/src/composition/aliases/claudecode.config` and
`packages/providers/src/composition/aliases/anthropic.config`

1. `defaultModel`: `claude-opus-5` → `claude-opus-5-5` in both.
2. `staticModels` (claudecode only): add in catalog order, newest of each family
   directly above its predecessor, all `1000000` / `128000`:
   - `claude-opus-5-5` / "Claude Opus 5.5" — first entry
   - `claude-sonnet-5-5` / "Claude Sonnet 5.5" — directly above
     `claude-sonnet-5`
   - `claude-haiku-5-5` / "Claude Haiku 5.5" — directly above
     `claude-haiku-4-5-20251001`
3. The rule `"claude-(opus-5|opus-4-8|fable-5-1|fable-5|sonnet-4-6|sonnet-5)"`
   (effort high / `context-limit` 1000000 / `maxOutputTokens` 128000) is an
   unanchored regex, so `claude-opus-5-5` and `claude-sonnet-5-5` already match
   via their `claude-opus-5` / `claude-sonnet-5` prefixes. `claude-haiku-5-5`
   does not — add `haiku-5-5` to the alternation. Prove all three match with a
   test rather than by inspection.
4. The rule `"^claude-(opus-5|opus-4-8|sonnet-5)$"` (`max-image-dimension: 2000`)
   must extend to `opus-5-5`, `sonnet-5-5`, `haiku-5-5`. These are
   current-generation models and take the hard cap, not legacy advisory resize.
5. The rule `"^claude-(?:opus(?!-(?:5|4-8)$)|sonnet(?!-5$))(?:-|$)"` applies the
   legacy `image-resize.*` 1568/1568/1229312 defaults. As written,
   `claude-opus-5-5` and `claude-sonnet-5-5` **do** match it, because the
   negative lookaheads only exclude the exact `-5` / `-4-8` endings. The 5.5
   models would therefore get both the hard cap and legacy resize. Rework the
   exclusion so the 5.5 IDs are excluded too, leaving every currently-included
   and currently-excluded model unchanged.
   `providerAliases.claudecode.imageBudget.test.ts` enumerates both sides of
   this boundary — extend it, do not weaken it.
6. Add a new claudecode rule `"^claude-(opus-5-5|sonnet-5-5|haiku-5-5)$"` with
   `unallowedParameters: ["temperature", "top_p", "top_k"]`. The API returns 400
   for non-default values of those on all three, on every request, regardless of
   thinking. Scope this to the three 5.5 IDs; do not retrofit other models in
   this PR. `anthropic.config` already applies `unallowedParameters` on its
   broad Claude rule, so it needs no change here.
7. Do **not** add a `^claude-opus-5-5$` reasoning-wire-format rule. The
   `^claude-opus-5$` rule exists because Opus 5 accepts `disabled`; Opus 5.5
   does not, and an `enabledMap.false → disabled` mapping for a model that
   rejects `disabled` would be a new bug. With `supportsAdaptiveThinking` fixed,
   the default path already emits `thinking: {type: "adaptive"}`.

### WP4 — Token limit catalog

File: `packages/core/src/core/model-limits.json`

- Add `exactLimits` entries for `claude-opus-5-5`, `claude-sonnet-5-5`,
  `claude-haiku-5-5` → `200000`, alongside the existing `claude-opus-5` /
  `claude-sonnet-5` / `claude-fable-5-1` entries. The existing
  `substringCaseInsensitive` rules would already resolve the opus/sonnet 5.5 IDs
  and `claude-haiku-5-5` would land on `defaultLimit`, but the established
  pattern in this file (see the `claude-fable-5-1` additions from issue #3531) is
  an explicit entry per sanctioned model.
- Mirror the #3531 test pattern in `packages/core/src/core/tokenLimits.test.ts`:
  assert `tokenLimit(id)` and assert the `exactLimits` entry independently of
  `defaultLimit`. Keep `modelLimitsParity.test.ts` and
  `model-limits.schema.test.ts` green.

### WP5 — Profile wizard list

File: `packages/cli/src/ui/components/ProfileCreateWizard/constants.ts`

- Put `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` at the front of
  the Anthropic `knownModels` list.
- The `claudecode` entry's `knownModels` should lead with `claude-opus-5-5`.

### Pass 1 tests

1. OAuth `User-Agent` version floor.
2. `supportsAdaptiveThinking` true for all three; near-miss IDs false.
3. Each of the three 5.5 IDs produces `thinking: {type: "adaptive"}` — not
   `type: "enabled"` with `budget_tokens` — in the request body built by
   `AnthropicRequestBuilder` under the alias default settings. This is the test
   that catches the real defect.
4. `getMaxTokensForModel` / `getContextWindowForModel` / `getLatestClaudeModel`
   for all three.
5. `tokenLimit` + `exactLimits` for all three.
6. `providerAliases.claudecode.factory.test.ts`: update
   `EXPECTED_CLAUDECODE_CATALOG` (it pins the whole ordered catalog literally)
   and the `defaultModel` assertion.
7. `providerAliases.modelDefaults.test.ts`: all three resolve
   `reasoning.effort: "high"`, `context-limit: 1000000`,
   `maxOutputTokens: 128000`, plus the broad adaptive-thinking settings.
8. `providerAliases.claudecode.imageBudget.test.ts`: all three get
   `max-image-dimension: 2000` and **no** `image-resize.*` keys; every model
   currently on each side of that boundary keeps its current treatment.
9. `providerAliases.unallowedParameters.test.ts`: all three report
   `temperature`, `top_p`, `top_k` as unallowed; `claude-opus-5` and
   `claude-sonnet-4-5-20250929` on claudecode are unchanged by the new rule.

---

## PASS 2 — Thinking-off modes (`between_tools`, `disabled`) and effort capping

Files: `packages/providers/src/anthropic/AnthropicModelData.ts`,
`packages/providers/src/anthropic/anthropic-reasoning-config.ts`, and the
Anthropic thinking-parameter type where `AnthropicThinkingParameter` is declared.

The repo today models exactly two thinking-off outcomes: emit
`{type: "disabled"}` when `supportsDisabledThinking(model)`, otherwise warn and
omit the field. The 5.5 generation needs a third: Sonnet 5.5 rejects `disabled`
and expresses "no up-front thinking" as `{type: "between_tools"}`.

1. Add `'between_tools'` to the `AnthropicThinkingParameter` type union.
2. Replace the single `supportsDisabledThinking` boolean decision with a mode
   resolver, for example
   `resolveThinkingOffMode(modelId): 'disabled' | 'between_tools' | undefined`:
   - `'between_tools'` for `claude-sonnet-5-5`
   - `'disabled'` for every model that currently satisfies
     `supportsDisabledThinking` (`claude-opus-5` and its variants) plus
     `claude-haiku-5-5`
   - `undefined` for always-on models (`claude-opus-5-5`, Fable 5.x), which keeps
     the existing warn-and-omit behavior
   Keep `supportsDisabledThinking` exported and defined in terms of the resolver
   (`resolveThinkingOffMode(id) === 'disabled'`) so existing callers and tests
   keep working.
3. `buildDisabledThinking` and `buildLegacyAutoConfig` must emit the resolved
   mode. When the mode is `'between_tools'` or `'disabled'`, emit the thinking
   object with **no** `display`, **no** `budget_tokens`, and **no**
   `block_binding` field. `display` is invalid with `disabled`, and
   `between_tools` rejects every additional field.
4. The existing `reasoning.enabledMap.false` validation accepts only the literal
   `'disabled'` and throws otherwise
   (`reasoning.enabledMap.false value '...' is not supported`). Accept
   `'between_tools'` as a valid mapped value too, and when the mapped value and
   the model's resolved mode disagree, prefer the model's resolved mode rather
   than emitting a value the model rejects. Do not add a new throw.
5. Effort cap: `between_tools` on Sonnet 5.5, and `disabled` on Opus 5 and
   Haiku 5.5, are accepted only at effort `low` / `medium` / `high` and return
   400 at `xhigh` / `max`. `normalizeEffort` currently maps `xhigh` and `max` to
   `'max'` for adaptive-capable models. When a thinking-off mode is emitted for
   a model that caps it at `high`, clamp the resolved effort to `'high'`. Sonnet
   5 has no such cap on `disabled`; do not clamp it.

### Pass 2 tests

1. `claude-sonnet-5-5` with `reasoning.enabled: false` emits
   `thinking: {type: "between_tools"}` with no other key.
2. `claude-haiku-5-5` with `reasoning.enabled: false` emits
   `thinking: {type: "disabled"}` with no `display`.
3. `claude-opus-5-5` with `reasoning.enabled: false` emits no `thinking` field
   and warns, matching the existing always-on behavior.
4. `claude-opus-5` keeps emitting `{type: "disabled"}` (no regression).
5. `claude-sonnet-5-5` with `reasoning.enabled: false` and
   `reasoning.effort: "max"` resolves effort to `high`, not `max`.
6. `claude-haiku-5-5` and `claude-opus-5` likewise clamp to `high` with
   thinking off; `claude-sonnet-5` does not clamp.
7. `reasoning.enabledMap.false: "between_tools"` on Sonnet 5.5 is accepted and
   does not throw.

---

## PASS 3 — Preserved thinking: block binding and drop reporting

Files: `packages/providers/src/anthropic/AnthropicApiExecution.ts` (beta
header), `packages/providers/src/anthropic/anthropic-reasoning-config.ts` or
`AnthropicRequestBuilder.ts` (the `block_binding` field), and the Anthropic
stream/response handling where `message_start` is processed.

1. Add a predicate (for example `enforcesPreservedThinkingPrefixCheck(modelId)`)
   returning `true` for `claude-fable-5-1`, `claude-opus-5-5`,
   `claude-sonnet-5-5`, `claude-haiku-5-5`, and `false` otherwise. Anchored, same
   discipline as the rest of `AnthropicModelData.ts`. Fable 5 (without the point
   release) does **not** run the check.
2. When that predicate is true **and** the emitted thinking type is `"adaptive"`
   or `"enabled"`:
   - merge `thinking-binding-controls-2026-08-01` into the `anthropic-beta`
     header using the existing `mergeBetaHeaders` helper, and
   - set `thinking.block_binding = { prefix_mismatch_behavior: "drop_block" }`.
   Never set it with `between_tools` or `disabled`, and never set it without the
   beta header. Gate on the predicate rather than sending it unconditionally:
   the subscription endpoint's accepted beta-header set is not documented, so do
   not widen the blast radius to models that gain nothing from it.
   Rationale for `drop_block` as the only behavior: llxprt renders the date and
   environment into the system prompt and compacts history client-side, both of
   which change the checked prefix. `"error"` would hard-fail those sessions on
   enforced accounts. Do not add an ephemeral setting to choose between the two;
   `"error"` has no value to a CLI user.
3. Read the response's top-level `input_transformations` array when present and
   debug-log each entry's `type`, `path`, and `reason` through the existing
   Anthropic debug logger. When streaming, the array arrives on the `message`
   object of the `message_start` event. Ignore unrecognized `type` and `reason`
   values rather than throwing — this is genuinely external input whose value
   set the API says will grow. Debug level only; do not surface it in the UI and
   do not change control flow on it.

### Pass 3 tests

1. A request for each of `claude-fable-5-1`, `claude-opus-5-5`,
   `claude-sonnet-5-5`, `claude-haiku-5-5` on the adaptive path carries
   `thinking.block_binding.prefix_mismatch_behavior === "drop_block"` and an
   `anthropic-beta` header containing `thinking-binding-controls-2026-08-01`
   alongside the pre-existing beta values (prove `mergeBetaHeaders` did not drop
   `oauth-2025-04-20` or `interleaved-thinking-2025-05-14`).
2. `claude-opus-5`, `claude-fable-5`, `claude-sonnet-5`, and `claude-opus-4-8`
   carry neither the field nor the beta value.
3. `claude-sonnet-5-5` with thinking off (`between_tools`) carries neither the
   field nor the beta value.
4. `claude-haiku-5-5` with thinking off (`disabled`) carries neither.
5. A response (streaming and non-streaming) carrying `input_transformations`
   entries produces debug log output naming each `path` and `reason`, and an
   entry with an unrecognized `type` or `reason` is logged without throwing.
6. A response with no `input_transformations` field logs nothing and does not
   throw.

---

## PASS 4 — Prefill, tokenizer identity, docs

### WP10 — Prefill

File: `packages/providers/src/anthropic/AnthropicModelData.ts`

`modelSupportsPrefill` currently excludes only Fable 5. Assistant-response
prefill is rejected while thinking is on, and thinking is on by default on all
three 5.5 models, so add `claude-opus-5-5`, `claude-sonnet-5-5`, and
`claude-haiku-5-5` to the exclusion.

Scope note to record in the code comment: `claude-opus-5` and `claude-sonnet-5`
also have thinking on by default and are also prefill-incompatible in practice,
but they are left as-is here because changing them is an unrelated
behavior change with existing tests asserting the current value. That
inconsistency is deliberate and bounded to this PR.

### WP13 — Tokenizer identity placeholder (superseded by PASS 5)

PASS 5 owns all estimator work for the 5.5 generation, including Opus 5.5.
Nothing in PASS 4 touches `claudeModelIdentity.ts` or
`claudeCalibrationAssets.ts`.

### WP7 — Docs

- `docs/providers/models-and-limits.md`: the `anthropic` and `claudecode`
  default-model rows (~27-28), the current-generation `context-limit` list
  (~129-131), the `reasoning.effort: high` list (~136-139), the common-models
  list (~144-145), the claudecode static-model list (~184-186).
- `docs/reference/ephemerals.md` ~126: the `max-image-dimension: 2000` sentence
  enumerates exactly three models; update it to the new set, including which
  models skip implicit `image-resize.*` defaults.
- `docs/cli/providers.md` ~11: the Anthropic default-model column.
- `docs/providers/reasoning-wire-formats.md`: document the `between_tools`
  thinking-off mode (which model uses it, that it takes no other field, and the
  effort ≤ high cap) and the `block_binding` / `drop_block` behavior with the
  `thinking-binding-controls-2026-08-01` beta header, including why llxprt sends
  `drop_block`.
- Do not sweep every `/model claude-opus-5` example in tutorials and recipes;
  those are illustrative, not catalogs.

### Pass 4 tests

1. `modelSupportsPrefill` false for all three 5.5 IDs; still true for
   `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`,
   `claude-opus-4-8`; still false for Fable 5.x.
2. A built request for each 5.5 ID whose history would otherwise end with an
   assistant message does not end with one.

---

## PASS 5 — Prompt-token estimators for the whole 5.5 generation

### Why this is in scope

Today `claude-opus-5-5` would be claimed by `CLAUDE_OPUS_5_CLAIM`
(`/^claude-opus-5(?:$|-)/i`) and matched by `isClaudeOpus5PointReleaseModel`, so
it would inherit the `anthropic-claude-opus-5` coefficients behind the
point-release warning that exists "until a dedicated calibration exists".
`claude-sonnet-5-5` and `claude-haiku-5-5` would be claimed by nothing at all
and fall back to the generic character heuristic, whose measured held-out MAPE
on this corpus is ~33.5% against ~0.39% for a fitted calibration. A ~33% error
on pre-send prompt estimation drives compression and context-limit decisions, so
all three 5.5 models get a real estimator. None of them borrows another model's
numbers.

`claudeCalibrationAssets.ts` states the rule plainly: each model is fitted and
gated entirely within its own live corpus, and a spec that declares a
calibration which does not hold up throws at module load. Honour that. Do not
alias Opus 5.5 onto the Opus 5 coefficients, and do not hand-write coefficients.

### What already exists

- `scripts/claude-estimator-corpus.ts` — the 42-item corpus generator, keyed by
  category / envelope / scale, with the largest scale reserved as the held-out
  split. `CLAUDE_CORPUS_VERSION` is `'2026-08-04-v1'`.
- `scripts/claude-estimator-collect.ts` — drives the real CLI once per corpus
  item, pairs the dumped request with recorded provider usage, and writes one
  sanitized counts-only row per observation. Driven by `CLAUDE_TARGETS`, which
  today holds two entries (`opus5`, `fable5`), both on profile
  `opusthinking-claudecode`.
- `scripts/claude-estimator-calibration.ts` — deterministic offline fit;
  leave-one-category-out CV over training rows only, then the held-out gate.
  Reads `research/issue2835/claude5-live-results.jsonl` and writes the fixtures
  under `packages/providers/src/tokenizers/claude/fixtures/`.
- `packages/providers/src/tokenizers/claude/claudeCalibrationGate.test.ts` and
  `claudeCalibration.test.ts` — the activation gate and per-family assertions.

### Work

1. **Targets.** Add three entries to `CLAUDE_TARGETS`: `opus5_5` /
   `claude-opus-5-5`, `sonnet5_5` / `claude-sonnet-5-5`, `haiku5_5` /
   `claude-haiku-5-5`, all `activeProvider: 'claudecode'`,
   `endpointHost: 'api.anthropic.com'`. Use the profiles created for the smoke
   tests (`opus`, `sonnet`, `haiku`) unless `opusthinking-claudecode` exists and
   is a better fit; whichever is used must resolve on this machine, so verify
   the profile loads before starting a long collection run. Update the comment
   above `CLAUDE_TARGETS`, which currently says there are two targets that
   differ only by model identity.
2. **Projection revision.** `claude-estimator-calibration.ts` pins
   `EXPECTED_PROJECTION_REVISION = 3` while the committed fixtures carry
   `projectionRevision: 4` and `PROJECTION_REVISION` is 4. Reconcile this before
   fitting; a silent mismatch either rejects every new row or mislabels the
   fixture provenance. Do not change `PROJECTION_REVISION` itself.
3. **Collect.** Run the collection script for the three new targets and write
   the results into the repo under `research/issue3834/`, not `/tmp`. This is a
   long, live, quota-consuming run: 42 observations per model, 126 real CLI
   invocations, each a single turn at roughly 16-20k prompt tokens. Expect it to
   take on the order of an hour of wall time and run it detached with polling,
   never in the foreground. Rows are counts only; confirm by inspection that no
   prompt text, request body, header, or credential reaches the results file.
4. **Fit and gate.** Run the calibration script to produce one calibration per
   new model, each fitted and cross-validated within its own rows. Record the
   real `intercept`, `baseTokenCoefficient`, `featureCoefficients`, `heldOut`
   metrics, and `provenance` (including the true `corpusObservations`,
   `fittedAt`, and `validatedBaseTokenRange`) in
   `claudeCalibrationAssets.ts`. Set `fittedAt` to the actual collection date.
   Write the three corpus fixtures alongside the existing two.
5. **Identity.** Add anchored claim patterns and sanctioned-identity predicates
   for the three new families in `claudeModelIdentity.ts`, following the existing
   Opus 5 / Fable 5 structure. Requirements:
   - `claude-opus-5-5` must resolve to its **own** family
     (`anthropic-claude-opus-5-5`), not to `anthropic-claude-opus-5`. Since
     `CLAUDE_OPUS_5_CLAIM` currently claims it, the more specific family must win;
     make that precedence explicit and test it directly, because a silent
     fall-through to Opus 5 is exactly the aliasing this pass exists to prevent.
   - Near-misses must still be rejected: `claude-opus-5-50`,
     `claude-opus-5-5-mini`, `claude-sonnet-5-50`, `claude-sonnet-5-5-mini`,
     `claude-haiku-5-50`, `claude-haiku-5-5-mini`, `anthropic/claude-opus-5-5`,
     and leading or trailing whitespace. Do not loosen
     `matchesAnchoredIdentity`.
   - Dateless IDs are the norm from the 4.6 generation on, so the sanctioned
     identity for each new family is the bare ID; keep the existing tolerance for
     `-latest` and a real `-YYYYMMDD` snapshot without inventing either in a
     catalog list.
6. **Specs.** Add three `CLAUDE_5_FAMILY_SPECS` entries. If a model's fit does
   not clear the held-out activation gate, declare that spec with
   `calibration: undefined` and a specific `withheldReason` naming the metric it
   missed. That is the mechanism's documented behavior for deliberate
   withholding and is far better than activating numbers that do not hold up —
   but it is a reportable outcome, not a quiet default: say so explicitly in the
   final report and in the PR body.
7. **Provider gating.** The new calibrations are measured against
   `api.anthropic.com` only, so they stay behind
   `isClaude5CalibratedProvider` (`anthropic`, `claudecode`). An
   Anthropic-compatible third-party endpoint must not receive them.

### Pass 5 tests

1. `createClaudeRuntimeTokenizer('claudecode', 'claude-opus-5-5')` claims the
   model and reports estimator family `anthropic-claude-opus-5-5` — explicitly
   **not** `anthropic-claude-opus-5` — with no point-release or
   unsanctioned-identity warning.
2. The same for `claude-sonnet-5-5` and `claude-haiku-5-5` against their own
   families.
3. `claude-opus-5`, `claude-fable-5`, and `claude-fable-5-1` keep their current
   family resolution and their current warning behavior. No regression.
4. Every near-miss ID from work item 5 resolves to no 5.5 family.
5. The calibration gate test covers the three new corpora the way it covers the
   existing two, including that each family's held-out metrics come from its own
   corpus and that no coefficient is shared between families.
6. A non-Anthropic provider (`zai`) does not receive any 5.5 calibration.
7. If a family is withheld, a test pins the `withheldReason` and the fallback
   path, so the withholding is visible rather than silent.

---

## Working rules learned during this issue

Two mistakes cost real time. Do not repeat them.

**Run the tests the way the repo runs them.** `bun test <directory>` is not this
repo's test runner. Pointing it at `packages/providers/src/anthropic/` runs 62
files in one Bun process and reports about 70 failures from cross-file
interference — and it does that on a clean `main` checkout too (measured: 612
pass / 70 fail on a stashed tree, 637 pass / 74 fail on this branch, the same
rate). Those numbers mean nothing. `npm run test` is authoritative; it runs files
individually, and on this branch the only failure it reports is a pre-existing
`SessionDiscovery` property-test timeout that fails identically on a clean tree.
Focused runs on individual named test files are fine and useful. Never conclude
anything from a whole-directory `bun test`.

**Do not invent model IDs.** Anchoring tests should prove a regex is anchored
using real sibling models (`claude-opus-5` against `claude-opus-5-5`,
`claude-haiku-4-5-20251001` against `claude-haiku-5-5`) and the minimal lexical
neighbours needed to show the boundary is exact, such as a trailing-digit
variant, a vendor prefix, or surrounding whitespace. Fabricated suffixes are not useful evidence. Keep regexes strict and test real
sibling IDs, trailing-digit variants, vendor prefixes, and surrounding whitespace.

## Test discipline

Behavioral tests only, per `dev-docs/RULES.md` and the
`typescript-test-writing` skill: assert observable behavior of real code paths
(built request bodies, emitted headers, loaded alias entries, resolved limits,
predicate return values). No mock theater. No test that would pass against a
stub. Tag new tests `@issue:3834`. New files are Bun tests following the
conventions of their sibling files, with a 2026 copyright header.

Never weaken, skip, or delete an existing test, lint rule, line-count guard, or
assertion threshold to make a change pass. When an existing assertion now pins
stale behavior, update it to the new correct value and keep its strictness.

## Verification cycle

Run in full before every commit, before pushing, before the PR, and again after
every remediation round:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
```

Then the live smoke tests. All three must return a haiku, not a 400:

```bash
bun scripts/start.ts --profile-load opus   "write me a haiku and nothing else"
bun scripts/start.ts --profile-load sonnet "write me a haiku and nothing else"
bun scripts/start.ts --profile-load haiku  "write me a haiku and nothing else"
```


## Nothing is deferred

Every item once marked a follow-up is in scope and assigned:

- Sonnet 5.5 `between_tools` thinking-off mode — PASS 2.
- Preserved thinking (`thinking-binding-controls-2026-08-01` beta header plus
  `thinking.block_binding.prefix_mismatch_behavior: "drop_block"`) and
  `input_transformations` reporting — PASS 3.
- Prompt-token estimators for Opus 5.5, Sonnet 5.5, and Haiku 5.5, each fitted
  on its own freshly collected live corpus — PASS 5. Sonnet and Haiku are
  included specifically because neither line has ever had a Claude estimator
  family, so both sit on the generic character heuristic at roughly 33% held-out
  MAPE today. Opus 5.5 gets its own family rather than inheriting Opus 5's
  coefficients.
