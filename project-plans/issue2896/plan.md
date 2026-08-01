# Issue #2896 — Malformed request params: string-typed numerics and reasoning-dialect fan-out

Branch: `issue2896`

## 1. Confirmed root causes (evidence-based)

### Bug 1 — dialog writes numeric params as strings (`"top_p": ".95"`)

`ModelConfigDialog.commitParam` (packages/cli/src/ui/components/ModelConfigDialog.tsx)
calls `parseValue(raw)` from `packages/cli/src/ui/commands/setCommand.ts`.

`looksNumeric()` in `setCommand.ts` rejects leading-dot decimals:

```
looksNumeric('.95')
  -> hasIntegerDigits = false  (no digits before '.')
  -> returns hasIntegerDigits && hasFractionDigits && atEnd  === false
```

`parseValue` then falls through boolean parsing, then `JSON.parse('.95')` throws,
and the raw string `'.95'` is stored as the model param. The same defect affects
`/set modelparam top_p .95`, so it is not dialog-specific — the dialog is just the
surface where the user hit it.

Additionally, the dialog performs no type validation at all for `param` fields:
typing `abc` into `top_p` stores the string `"abc"`.

Registry evidence: `top_p`, `temperature`, `top_k`, `max_tokens`,
`frequency_penalty`, `presence_penalty` all declare `type: 'number'`,
`category: 'model-param'` in `packages/settings/src/settings/registry/registry-entries-3.ts`.

### Bug 2 — reasoning-dialect fan-out

Reproduced deterministically with a probe against the real settings pipeline:

```
SettingsService.set('reasoning.enabled', true)
SettingsService.set('reasoning.effort', 'high')

getAllGlobalSettings()  -> { reasoning: { enabled: true, effort: 'high' } }
separateSettings(all, 'openai') ->
  modelBehavior: { 'reasoning.enabled': true, 'reasoning.effort': 'high' }
  modelParams:   { reasoning: { effort: 'high' } }      <-- LEAK
```

Two independent injection sites then both fire for a single user intent:

1. **`reasoning: { effort }` (OpenRouter dialect).**
   `SettingsService.setNestedValue` stores dotted keys as a nested tree, so
   `reasoning.effort` becomes `global.reasoning.effort`.
   `flattenRegistryPrefixedObjects` (packages/settings/src/settings/settingsRegistry.ts)
   flattens the container back into dotted keys but **retains the container**
   because a bare registry spec `key: 'reasoning'` exists
   (registry-entries-3.ts, `category: 'model-param'`).
   Its `normalize` only strips five internal keys
   (`enabled`, `includeInContext`, `includeInResponse`, `format`, `stripFromContext`)
   — `effort` survives and lands in `modelParams`.
   `OpenAIRequestPreparation.applyRequestBodyOverrides` then does
   `Object.assign(requestBody, overrides)`, putting `reasoning` on the wire.

2. **`thinking: { type: 'enabled' }` (z.ai/GLM dialect).**
   `OpenAIRequestPreparation.resolveReasoningConfig` unconditionally injects
   `thinking` for **every** OpenAI-compatible endpoint whenever
   `modelBehavior['reasoning.enabled']` is a boolean. Introduced by commit
   `1f3c27036` ("add thinking param for OpenAI-compatible models ... for GLM-4.7,
   Kimi K2 etc.") with no endpoint gating.

`parse_reasoning: true` — the third field in the issue report — is **not**
injected by llxprt. It is present in the reporter's own `friendliglm.json`
`modelParams` (verified by reading the profile). Arbitrary `modelParams`
passthrough is working as designed and is out of scope.

Net: one user intent (`reasoning.enabled` + `reasoning.effort`) produces two
llxprt-injected vendor dialects. Friendli rejects both with 422; Crusoe rejects
`reasoning` with 403.

## 2. Acceptance matrix (decision-complete)

| # | Given | When | Then | Evidence location |
|---|---|---|---|---|
| A1 | `parseValue('.95')` | called | returns number `0.95` (not string) | `packages/cli/src/ui/commands/setCommand.*.test.ts` |
| A2 | `parseValue('-.5')`, `parseValue('1e-5')`, `parseValue('1.5e3')` | called | return numbers `-0.5`, `1e-5`, `1500` | same |
| A3 | `parseValue('.')`, `parseValue('1.2.3')`, `parseValue('abc')`, `parseValue('')` | called | remain non-numeric (unchanged behavior) | same |
| A4 | Model config dialog `top_p` commit path, raw input `.95` | commit | the runtime receives the **number** `0.95` | `modelConfigParamCommit.spec.ts` |
| A5 | Model config dialog `top_p` commit path, raw input `abc` (and `.`, `-`, `-.`, `1.2.3`, `Infinity`, `NaN`, `0x10`, `1_000`, `{"a":1}`, `true`) | commit | commit is rejected with a `must be a number` message that the dialog renders inline, and nothing is written to the runtime | `modelConfigParamCommit.spec.ts` |
| A6 | Model config dialog commit path for the remaining number-typed fields (`max_tokens`, `top_k`, `frequency_penalty`, `presence_penalty`, `temperature`) | commit | each is written as a **number**; a param key with no number spec keeps the previous pass-through behavior; a runtime write failure surfaces as a validation message | `modelConfigParamCommit.spec.ts` |
| A7 | Legacy profile on disk with `"top_p": ".95"` | applied to a request | egress model params contain `top_p` as number `0.95` | settings-registry behavioral test |
| A8 | Profile with `"top_p": "abc"` | applied | value left untouched (no silent drop; provider surfaces the error) | settings-registry behavioral test |
| B1 | ephemerals `reasoning.enabled=true`, `reasoning.effort='high'` | `separateSettings(..., 'openai')` | `modelParams` contains **no** `reasoning` key; `modelBehavior` still has both dotted keys | `settingsRegistry` test |
| B2 | modelParam `reasoning = { exclude: true }` (unregistered sub-key) | `separateSettings` | `modelParams.reasoning === { exclude: true }` (unregistered passthrough preserved) | `settingsRegistry` test |
| B3 | `base-url` = `https://api.friendli.ai/serverless/v1`, `reasoning.enabled=true`, `reasoning.effort='high'` | `prepareRequest` | body has **none** of `reasoning`, `thinking`, `reasoning_effort` | `OpenAIRequestPreparation` test |
| B4 | `base-url` = `https://api.inference.crusoecloud.com/v1/`, same reasoning settings | `prepareRequest` | body has none of the three keys | same |
| B5 | `base-url` = `https://openrouter.ai/api/v1`, `reasoning.enabled=true`, `reasoning.effort='high'` | `prepareRequest` | body has exactly `reasoning: { effort: 'high' }`; no `thinking`, no `reasoning_effort` | same |
| B6 | `base-url` = `https://api.z.ai/api/paas/v4`, `reasoning.enabled=true` | `prepareRequest` | body has exactly `thinking: { type: 'enabled' }`; no `reasoning` | same |
| B7 | `base-url` = `https://api.z.ai/...`, `reasoning.enabled=false` | `prepareRequest` | body has exactly `thinking: { type: 'disabled' }` | same |
| B8 | `base-url` = `https://open.bigmodel.cn/api/paas/v4`, `reasoning.enabled=true` | `prepareRequest` | `thinking: { type: 'enabled' }` only | same |
| B9 | user sets `modelParams.thinking` explicitly on any endpoint | `prepareRequest` | user value wins verbatim; no dialect auto-injection overrides or duplicates it | same |
| B10 | user sets `modelParams.reasoning_effort` explicitly | `prepareRequest` | user value wins; no other dialect injected | same |
| B11 | no `base-url` set (canonical OpenAI) with `reasoning.enabled=true` on the chat-completions path | `prepareRequest` | no `thinking` (canonical OpenAI does not accept it); at most one dialect | same |
| B12 | any endpoint / any settings | `prepareRequest` | invariant test: body contains at most one of `reasoning` / `thinking` / `reasoning_effort` | table-driven invariant test |

Dialect table (the only auto-selection source of truth):

| host (exact or dot-suffix) | dialect | wire shape |
|---|---|---|
| `openrouter.ai` | `openrouter` | `reasoning: { effort }` when effort set, else `reasoning: { enabled }` |
| `z.ai`, `bigmodel.cn` | `thinking` | `thinking: { type: 'enabled' \| 'disabled' }` |
| everything else (incl. `api.openai.com` chat completions) | `none` | nothing emitted |

Rationale for `none` as the default: llxprt cannot know an arbitrary
OpenAI-compatible endpoint's reasoning dialect, and guessing is what broke
Friendli and Crusoe. Users on unlisted endpoints retain full control through
`modelParams` passthrough (`thinking`, `reasoning_effort`, or vendor-native
fields such as `parse_reasoning`), which the issue confirms works end-to-end.

## 3. Explicit non-goals

- **NG1** Silent `exit 0` on an unresolvable `auth-key-name` (issue comment 3).
  Different subsystem (auth precedence + non-interactive error surfacing).
  Follow-up issue to be filed.
- **NG2** 403 responses presenting as an indefinite hang (issue comment 4).
  Different subsystem (retry/stream error classification). Follow-up issue to be
  filed. Note: this PR removes the *trigger* for the Crusoe 403 by no longer
  emitting `reasoning`, but does not fix 403 handling.
- **NG3** Rewriting profile files on disk (migration pass). Normalization is
  applied at settings egress, so existing profiles are fixed at load without
  mutating user data.
- **NG4** A new user-facing dialect-override setting (e.g. `reasoning.dialect`).
  `modelParams` passthrough already provides the escape hatch.
- **NG5** Reasoning handling for the Anthropic, Gemini, openai-responses, and
  openai-vercel transports. They already select a single native dialect.
- **NG6** Broadening the dialect table beyond the hosts listed above.
- **NG7** Any change to `parse_reasoning` / arbitrary `modelParams` passthrough.

## 4. Bounded vertical slices

**Slice 1 — numeric typing (Bug 1).**
- `packages/cli/src/ui/commands/setCommand.ts`: `looksNumeric` accepts leading-dot
  decimals and exponent notation; still rejects `.`, `1.2.3`, `abc`, `''`.
- `packages/cli/src/ui/components/ModelConfigDialog.tsx`: `commitParam` consults
  `getSettingSpec(key)`; when `spec.type === 'number'`, require a finite number
  and return a validation error otherwise.
- `packages/settings/src/settings/settingsRegistry.ts`: `normalizeSetting` coerces
  a numeric string to a number for `type: 'number'` model-param specs; leaves
  non-numeric strings untouched.

**Slice 2 — single reasoning dialect (Bug 2).**
- `packages/settings/src/settings/settingsRegistry.ts`:
  `flattenRegistryPrefixedObjects` removes registered dotted sub-keys from a
  retained bare container, so `reasoning.*` settings can never re-enter
  `modelParams` as a `reasoning` object. Unregistered sub-keys still pass through.
- New `packages/providers/src/openai/openaiReasoningDialect.ts`: pure
  host -> dialect resolution plus the applier.
- `packages/providers/src/openai/OpenAIRequestPreparation.ts`:
  `resolveReasoningConfig` delegates to the dialect module, keeps the existing
  "explicit user modelParams wins" short-circuit, and emits at most one dialect.

## 5. Expected paths

```
packages/cli/src/ui/commands/setCommand.ts
packages/cli/src/ui/commands/setCommand.parseValue.test.ts            (extended)
packages/cli/src/ui/components/ModelConfigDialog.tsx
packages/cli/src/ui/components/modelConfigParamCommit.ts              (new)
packages/cli/src/ui/components/modelConfigParamCommit.spec.ts         (new)
packages/cli/vitest.test-groups.ts                                    (selected-file-count oracle)
packages/settings/src/settings/numericString.ts                       (new)
packages/settings/src/settings/settingsRegistry.ts
packages/settings/src/settings/settingsRegistry.issue2896.test.ts     (new)
packages/providers/src/openai/openaiReasoningDialect.ts               (new)
packages/providers/src/openai/openaiReasoningDialect.test.ts          (new)
packages/providers/src/openai/OpenAIRequestPreparation.ts
packages/providers/src/openai/OpenAIRequestPreparation.issue2896.test.ts (new)
packages/providers/src/openai/OpenAIRequestPreparation.issue1943.test.ts (updated: thinking tests become endpoint-scoped)
docs/ (one short note on reasoning dialect selection)
project-plans/issue2896/plan.md
```

## 6. Scope ledger

| Budget | Limit | Actual |
|---|---|---|
| Files touched | <= 25 (review above), stop above 40 | 19 |
| Net changed lines | <= 1500 (review above), stop above 2500 | 1833 (+1910 / -77) |
| Reviews | <= 2 local OCR, <= 2 PR OCR | 2 local (round 1 + round 2 post-remediation) |

**Mandatory scope review (net lines above 1500, below the 2500 stop).**
Production source is 388 net lines across 8 files (+446 / -58); the remaining
~1445 lines are behavioral tests (~1215) and this plan document (231). The test
volume grew because review round 1 required an end-to-end
settings-to-request suite and a widened dialect invariant, and the delivery
policy explicitly exempts test coverage from the "major scope expansion" bar.
No new subsystem, public abstraction, dependency, workflow, or quality-tool
change was introduced. Continuing.

Ledger entries:

- (initial) planned: ~11 files, well under budget.
- **In-scope unblock:** `packages/cli/vitest.test-groups.ts` `SELECTED_FILE_COUNT`
  was stale on `main` (518 while the real selected set was 519 — commit
  `5d4d0c741` added `dumpcontextCommand.chronology.test.ts` without bumping the
  oracle). This PR adds one selected file, so the constant moves 518 -> 520.
  Required for CI on this branch; not a scope expansion.
- **Deviation (recorded):** `packages/cli/src/ui/components/ModelConfigDialog.test.tsx`
  is structurally excluded from this package's vitest routing
  (`**/ui/components/*.test.tsx` in `vitest.test-groups.ts`), so it never runs
  in CI — full-render Ink component tests break under the package's `ink` stub
  alias. Rather than change that test-infrastructure decision (out of scope),
  the dialog's numeric-typing contract was extracted into
  `modelConfigParamCommit.ts` and is covered by `modelConfigParamCommit.spec.ts`,
  which IS in the selected set and drives the real `parseValue` + real settings
  registry. The pre-existing quarantine of the component suite is left as-is and
  is a candidate for a separate issue.

## 7. Review-finding triage classes

Blocker-Fix / In-scope-Fix / Reject / Defer. Reviewer suggestions do not
authorize scope expansion; anything outside the acceptance matrix is Defer or
Reject with a recorded reason.

## 8. Local review round 1 — triage

Reviews run: one independent design/implementation review, one local Open Code
Review (`ocr review --audience agent --timeout 20`, 16 files, 6 comments).

| # | Finding | Class | Action |
|---|---|---|---|
| R1 | Explicit `parse_reasoning` did not stand down automatic dialect injection, so a z.ai/OpenRouter user who set Friendli's native field still got a second dialect. The at-most-one invariant was false. | Blocker-Fix | `REASONING_WIRE_KEYS` + `hasExplicitReasoningField` now cover all four vendor fields; the request-builder short-circuit and the B12 invariant both use that one list. New B9 cases for both hosts. |
| R2 | An explicit `/set modelparam reasoning {…}` / profile `modelParams.reasoning` lost its registered members (e.g. `effort`) because the container strip was applied to provider-scoped settings too. That silently dropped user intent, and the B9 test hand-built `modelParams` so it never saw the seam. | Blocker-Fix | Strip only *synthesized* (global) containers; provider-scoped containers are explicit model params and are preserved verbatim. New `openaiReasoningPipeline.test.ts` drives real `SettingsService` → `buildEphemeralsSnapshot` → `prepareRequest`. |
| R3 | `reasoning.enabled: false` lost to a leftover `reasoning.effort` on OpenRouter, so turning reasoning off still requested it. | In-scope-Fix | Explicit `enabled: false` now outranks effort; covered in the dialect unit test and the B12 table. |
| R4 | `normalizeSetting` coerced `'1e400'` to `Infinity`, which JSON-serializes to `null` — replacing one invalid value with a different invalid value. | In-scope-Fix | Coerce only when the result is finite; otherwise the string is left for the provider to reject. Covered in tests. |
| R5 | B12/B9 too weak: finite key list, and explicit values equal to the auto-selected ones, so a broken short-circuit would still pass. | In-scope-Fix | B9 now uses opposing sentinel values; B12 covers `parse_reasoning`, `enabled:false` + effort, and a settings-free z.ai case; the pipeline test asserts exact key sets. |
| R6 | Unregistered members of a registry-prefix container were also emitted as literal dotted keys, so `reasoning: {exclude:true}` produced a bogus top-level `reasoning.exclude` request field. | In-scope-Fix | Pre-existing, same defect class as this issue ("malformed request params"), fixed in `emitFlattenedEntries`: only registered dotted keys are emitted. Asserted in the pipeline test. |
| R7 | Missing edge coverage: `1e400` commit rejection, empty-string effort, `hasExplicitReasoningField` key set. | In-scope-Fix | Added. |
| R8 | `hasIntegerDigits` re-derived the post-sign offset from `value[0]`. | In-scope-Fix | Captures `integerStart` instead. |
| R9 | Leading `+` is rejected while `Number()` accepts it. | In-scope-Fix (doc) | Intentional — preserves the strictness of the scanner this replaced; now stated explicitly in the rejected list. |
| R10 | Add `afterEach(vi.restoreAllMocks())` to the request-preparation test. | Reject | No test asserts mock call counts, and the file's mocks are module factories that `restoreAllMocks` does not manage. Adds ceremony without changing any outcome. |
| R11 | Move `parseValue(raw)` inside the `try` in `commitModelParam` in case it ever throws. | Reject | Speculative guard against a hypothetical future throw; the project prefers fail-fast over defense-in-depth. `parseValue` already contains its only throwing call. |
| R12 | Drop the now-partly-redundant hardcoded `INTERNAL_KEYS` list in the bare `reasoning` spec's `normalize`. | Defer | After R2 it is no longer redundant: it is the only sanitizer for an explicitly supplied provider-scoped container. Reworking it is a separate settings-registry change. |
| R13 | Silent `exit 0` on unresolvable `auth-key-name`; 403 presenting as an indefinite hang. | Defer | NG1/NG2. Separate subsystems; follow-up issues.

## 9. Local review round 2 (post-remediation OCR) — triage

| # | Finding | Class | Action |
|---|---|---|---|
| R14 | The `thinking` dialect dropped an effort-only configuration: with `reasoning.effort` set but `reasoning.enabled` unset, z.ai/bigmodel received nothing, while OpenRouter handled the same input. | In-scope-Fix | `applyThinkingDialect` now mirrors the OpenRouter precedence: explicit `enabled:false` wins, otherwise `enabled === true` **or** a non-empty effort emits `{ type: 'enabled' }`. Shared `hasEffort` helper; three new dialect tests. |
| R15 | No regression test for `1e400` at the dialog commit boundary. | In-scope-Fix | `'1e400'` and `'-1e400'` added to the A5 rejection table. |
| R16 | No regression test for `1e400` at the settings-egress boundary. | In-scope-Fix | Added to the A8 group. |
| R17 | The intentional leading-`+` rejection had no test. | In-scope-Fix | `+1.5`, `+3`, `+.5` added to the rejection table. |

Local OCR budget is now exhausted (2 of 2). Remaining review passes happen on
the PR.

## 10. PR review round 1 (CI OpenCodeReview + PR review bot) — triage

| # | Finding | Class | Action |
|---|---|---|---|
| R18 | `parseSetting` coerced a number-typed setting with `Number(raw)` and no finite guard, so `/set modelparam top_p 1e400` stored `Infinity` in memory, bypassing the egress guard and reaching the API as JSON `null`. | In-scope-Fix | Ingress now matches egress: finite-only, and a non-finite literal returns the raw text instead of falling through to `JSON.parse`, which would hand back the same `Infinity`. Covered by a new `parseSetting` test. |
| R19 | `CommitResult` was not a discriminated union — `message` was optional even though the failure path always supplies one. | In-scope-Fix | Converted to `{ success: true } \| { success: false; message: string }`; the two call sites drop their `?? 'Invalid value'` fallbacks and `commitEphemeral` now supplies the default. |
| R20 | Four tests shared a `B9` prefix, making a failure hard to identify. | In-scope-Fix | Renamed to `B9a`–`B9d` (and `B11a`/`B11b`). |
| R21 | A pipeline test named "Friendli-native parse_reasoning" runs against the z.ai base URL. | In-scope-Fix | Renamed to describe what it actually proves: an explicit `parse_reasoning` is the only representation on z.ai. |
| R22 | The double cast `as unknown as NormalizedGenerateChatOptions` in the provider tests. | Reject | The literal does not structurally satisfy the interface, so a single cast does not compile, and building a full context per case would obscure the assertions. This matches the established harness in the neighbouring `issue1943` test file. The pipeline test exists precisely so the real, uncast object graph is also covered. |
| R23 | PR body did not follow the repository pull-request template. | In-scope-Fix | Rewritten into the template sections. |
| R24 | OCR warning: changed-file coverage 5/17 below its 90% threshold. | Reject | A property of the review tool's own file sampling, not of the change. |
