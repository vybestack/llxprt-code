# Plan: claude and official estimator families read projection imageEntries (issue #3663)

Plan ID: PLAN-20260918-ISSUE3663
Generated: 2026-09-18
Issue: #3663
Branch: issue3663
Reference implementation: #3481 (`Gpt56O200kPromptEstimator.ts` `countProjectionTokens`,
`gpt-5.6-o200k-v2`).

## Context

The projection layer already records `imageEntries` (with parsed dimensions, revision 4)
on `ProviderFinalizedPromptProjection` while canonicalizing base64/data-URI image payloads
to the `[binary media bytes omitted]` placeholder (~6 tokens). The GPT-5.6 estimator adds
`estimateImageTokens(...)` per entry; the claude calibrated family (`estimateClaude5Prompt`,
counts calibrated `promptText` only) and the official exact family (`estimateOfficialPrompt`,
counts `promptSegments` only) ignore the field. Image turns on anthropic-protocol and
openai-chat/official sessions therefore under-estimate by roughly the full image cost
(hundreds to ~1.6k+ tokens), so compression fires late.

Note: the issue body's paths are stale. The real files are
`packages/providers/src/tokenizers/claude/claudePromptEstimator.ts` and
`packages/providers/src/tokenizers/official/officialPromptEstimators.ts`.

## Accepted behavior

AC1 (claude family): `estimateClaude5Prompt` adds, per `projection.imageEntries` entry,
`estimateImageTokens({ provider: request.activeProvider, model: request.canonicalModel,
dimensions: entry.dimensions })` on top of the calibrated text count. The addition happens
AFTER `applyClaudeCalibration` so the text-fitted coefficients (base ~0.657x) cannot shrink
the provider-billed image tokens. `appliesToProvider` already restricts the family to
`{anthropic, claudecode}` (both resolve to the anthropic family in
`resolveImageTokenProviderFamily`). Missing/placeholder dimensions fall back to the
anthropic unknown-dimensions cost (1,590). Calibration `estimatorVersion` strings bump
`claude-{opus,fable}-5-o200k-calibrated-2026-08-04-v1` -> `-v2`; coefficients and held-out
metrics are unchanged (the runtime tuple the calibration records is untouched; revision-4
canonical text is unchanged, and corpora are text-only). No other field of the calibration
assets changes.

AC2 (official family): `estimateOfficialPrompt` adds, per entry,
`estimateImageTokens({ provider: 'openai', model: request.canonicalModel, dimensions:
entry.dimensions })` to the segment total. The literal `'openai'` is deliberate: these
models are served over OpenAI-compatible chat framing, none of the three model names
classify as openai legacy (`classifyOpenaiModel` -> `'unknown'`), so `isGpt52OrNewer`
selects the patch formula (conservative-high, the #3477 policy for unknown openai-family
models; unknown dimensions -> 1,844). Passing the real `activeProvider` (e.g. `moonshot`,
`zai`, `minimax`) would resolve to the flat `'default'` family (1,000) instead.
`estimatorVersion` strings bump `kimi-k3-tiktoken-v1` / `glm-5.2-tiktoken-v1` /
`minimax-m3-tiktoken-v1` -> `-v2`.

AC3 (no double count): `createClaudeRuntimeTokenizer` and `createOfficialRuntimeTokenizer`
are deliberately unchanged. They count caller-supplied content text and build synthetic
projections without `imageEntries`; image cost in history accounting is already added
separately by `historyTokenEstimation.ts` `estimateMediaBlockImageTokens`.

AC4 (identity): with no `imageEntries` (absent or empty array), both families produce
byte-identical counts to the pre-change behavior for the same text (the loop is a no-op).
The one-tokenization/one-feature-scan contract of the claude estimator is preserved
(image cost adds no extra passes).

AC5 (test coverage, test-first): per-family estimator-level and pipeline-level coverage:
- `claudePromptEstimator.issue3663.test.ts` (NEW colocated file, mirroring the #3481
  precedent `Gpt56O200kPromptEstimator.issue3481.test.ts`) — the planner's "extend
  claudePromptEstimator.test.ts" is infeasible: that file already sits at 798 of the
  800 effective-line lint cap, and raising size thresholds is forbidden for this effort.
  The new file carries the full `Claude image entries (issue #3663)` describe with
  self-contained helpers: calibrated-count additivity (800x600 -> +640), capped case
  (1586x991 -> +1590), unknown dims (`{}` -> +1590), multiple entries additive,
  no-entries identity, `-v2` provenance (opus and fable), one-encode/one-scan contract
  preserved, plus an issue-3481-style pipeline case (handcrafted 800x600-header PNG
  base64 -> IContent media block -> `convertToAnthropicMessages` ->
  `projectAnthropicPromptEnvelope` -> `estimateClaude5Prompt`, image-entry parse asserted
  and delta window [640, 640+400] vs a text-only baseline).
- `providerFramingSeparation.test.ts` — new `describe('Official estimator image entries
  (issue #3663)')`: per spec (kimi-k3 openai-chat; glm-5.2 openai-chat AND
  anthropic-messages; minimax-m3 openai-chat) via the registry, 800x600 -> +570,
  unknown dims -> +1844, additive, no-entries identity, `-v2` versions (update the
  existing `glm-5.2-tiktoken-v1` literal), and a double-count guard that
  `createOfficialRuntimeTokenizer` adds no image cost over base64-image JSON content
  (synthetic projection has no entries).

## Boundary cases

- Entry with dimensions 800x600: anthropic `ceil(480000/750)` = 640; openai patch
  `ceil(1.2 x 475)` = 570.
- Entry with dimensions 1586x991 (anthropic): both the 1568 long-edge and 1092^2 pixel
  caps bind -> 1,590.
- Entry without parseable dimensions `{}`: anthropic 1,590; openai patch 1,844.
- Multiple entries: additive per entry.
- No entries / empty array: count unchanged (identity regression guard).
- GLM 5.2 over anthropic-messages carries image entries (revision-4 projection) and gets
  the same +570: the formula is protocol-independent.

## Out of scope (explicit, carried from #3481/#3663 notes)

- URL-referenced images (produce no entries today; documented follow-up).
- Uncapped-billing parity for resize-disabled large images (~11,850 uncapped vs 1,844
  cap; #3477 territory).
- Mid-conversation instructions/tools change under-count on stateful turns (documented
  limitation in `project-plans/issue3481-runtime-image-turn-estimation.md`).
- PDFs/non-image binaries (no entries — correct).
- Refitting claude calibrations (image cost is additive post-calibration).
- `imageTokenEstimation.ts`, `promptEnvelopeProjections.ts` (revision stays 4), the
  registry/composition, runtime tokenizer factories, calibration fitting script.

## Implementation steps

1. `packages/providers/src/tokenizers/claude/claudePromptEstimator.ts` — import
   `estimateImageTokens` from `@vybestack/llxprt-code-tools/utils/imageTokenEstimation.js`;
   in `estimateClaude5Prompt`, after `applyClaudeCalibration(...)`, add the per-entry sum
   over `projection.imageEntries ?? []` with a `why` comment (post-calibration because the
   anthropic formula already returns provider-billed tokens; coefficients are text-fitted).
2. `packages/providers/src/tokenizers/claude/claudeCalibrationAssets.ts` — bump both
   `estimatorVersion` strings to `...-2026-08-04-v2` with a short why-comment. Nothing
   else changes.
3. `packages/providers/src/tokenizers/official/officialPromptEstimators.ts` — import
   `estimateImageTokens`; add the per-entry sum (literal `'openai'`, commented why) to the
   count path; bump the three `estimatorVersion` strings to `-v2`. Do not touch
   `createOfficialRuntimeTokenizer`'s synthetic projection.
4. Tests per AC5: new `claudePromptEstimator.issue3663.test.ts` (implementation and
   helpers already drafted in the working tree; relocate verbatim from the oversized
   in-file describe, keeping the existing claudePromptEstimator.test.ts untouched at
   HEAD) and the image-entries describe in `providerFramingSeparation.test.ts` (update
   its one version literal).

Deviation note (2026-09-18): the first implementation pass extended
`claudePromptEstimator.test.ts` in place and raised the file's `max-lines` lint cap in
`eslint.config.js` to 1100. Size-threshold increases are forbidden for this effort, and
the repo precedent for issue-shaped coverage that does not fit the existing file is a
dedicated colocated `*.issueNNNN.test.ts` (see `Gpt56O200kPromptEstimator.issue3481.test.ts`
from #3481 itself). The restructure: revert `eslint.config.js` and
`claudePromptEstimator.test.ts` to HEAD and move the whole issue-#3663 describe into
`claudePromptEstimator.issue3663.test.ts`. No coverage is dropped.

## Verification

- Targeted: `bun test packages/providers/src/tokenizers/claude/claudePromptEstimator.test.ts
  packages/providers/src/tokenizers/official/providerFramingSeparation.test.ts`
- Full providers workspace: `bun scripts/run_bun_tests.ts --workspace providers`
- `npm run lint:ci`, `npm run lint:eslint-guard`, `npm run typecheck`, `npm run test`,
  `npm run format`-equivalent (prettier on changed files), `npm run build`
- Smoke: `bun scripts/start.ts --profile-load zai-glm-flash "write me a haiku and nothing else"`
- Test-audit scanner delta vs main on the touched test files.
- Live verification (issue-requested, mirrors #3481's method): a headless anthropic
  image-turn session (e.g. `opus5`/`fable5` profile) comparing estimated vs
  provider-reported `actual_prompt_tokens` delta across a no-image -> image turn pair;
  expected delta ~= the anthropic formula value for the sent image (+ small scaffold).
  For official models, best-effort (no guaranteed profile); if unavailable, record that
  the patch family is the documented conservative-high approximation.

## Verification evidence

Local gates (candidate head, logs under `tmp/verify3663/`): providers workspace bun
suite, `npm run test`, `lint:ci`, `eslint-guard`, `typecheck`, prettier on changed
files, `build`, and the `zai-glm-flash` smoke prompt — final combined run recorded in
`tmp/verify3663/final-cycle.log`.

Live verification results (2026-09-18):

- Claude family (anthropic image-turn session): **credential-blocked in this
  environment.** The `claudecode` provider path returns upstream
  `403 oauth_not_allowed_for_organization` ("OAuth authentication is currently not
  allowed for this organization", api.anthropic.com), and no Anthropic API key exists
  on this machine (`ANTHROPIC_API_KEY` unset; no anthropic entry in the global key
  store). The anthropic formula itself (750 px/token, 1568 long-edge and 1092^2 pixel
  caps, 1590 unknown fallback) is the one already shipped and exercised for history
  accounting; estimator-level and pipeline-level tests carry correctness here.
- Official family: **live-verified via glm-5.2 over the z.ai Anthropic-compatible
  endpoint** (temp profile, anthropic-messages protocol, estimator
  `glm-5.2-tiktoken-v2`, projection revision 4; token-usage logs under the project's
  global log dir, session ids `acc195e2` then `028d6202`/`e50df111`):
  - Text-only turn: estimated 11,370 vs actual 11,932 (standing family bias −562).
  - Image turn carrying a real 800x600 PNG as a read_file tool result (the #3481
    scenario): estimated 12,125 vs actual 12,018 — bias −107. Adding the ~570-token
    image entry collapsed the usual −560s under-estimate to −107, consistent with the
    provider billing roughly ~500 tokens for the 800x600 image. Magnitude in range;
    z.ai's exact image billing formula is undocumented, so the openai patch family
    remains the documented conservative-high approximation (#3477 policy).
  - Control: an @-mention attempt did not exercise the main wire (the model routed the
    image to an image-reader subagent per global config); its main-prompt delta was
    +15 estimated and +15 actual — clean text-only parity, no image involved.

Environmental note (filed as #3732): one malformed `session_start` recording from
2026-09-17 made `--continue` (bare and explicit-id) crash in
`SessionDiscovery.listContinueTargets`; the corrupt temp-log file was quarantined
(moved out of the chats dir) to unblock resume.

## Policy invariance

No new suppression directives (`eslint-disable*`, `@ts-ignore`, `@ts-expect-error`,
`@ts-nocheck`), no ESLint severity downgrades, no complexity/size threshold increases, no
new `ignores:` blocks. No new .js files or vitest/node tests. No calendar/time-based
estimates.

## Review triage (compliance review, 2026-09-18)

Verdict: satisfies the issue's accepted behavior in full. 0 BLOCKER / 0 HIGH / 0 MEDIUM /
3 LOW; independent targeted run 82 pass / 0 fail.

- LOW (In-scope-Fix, done): the claude test's unknown-dimensions case reused the
  `CAPPED_IMAGE_TOKENS` name; a dedicated `UNKNOWN_DIMENSIONS_TOKENS = 1590` constant now
  documents the fallback case.
- LOW (Defer): no openai-chat wire-input pipeline case for the official family (coverage
  is registry-level; the canonicalizer is shared with the #3481-verified projection
  path, which is out of scope here). Deferred follow-up for a future official-family
  pipeline suite.
- LOW (operational): exclude `packages/core/test/runner-attempt-root-*` debris from the
  commit (handled by explicit path staging).
