# Plan: Runtime estimated_tokens for image tool turns (issue #3481)

Plan ID: PLAN-20260913-ISSUE3481
Generated: 2026-09-13
Issue: #3481
Branch: issue3481

## Diagnosis (corrected from live provider evidence; supersedes the first pass)

The persisted `estimated_tokens` for a turn is produced by the prompt-envelope
path, NOT the `historyTokenEstimation` path the issue suspected:

TurnProcessor -> promptEnvelopeSendSeam -> provider.projectPromptEnvelope ->
`projectOpenAIResponsesPromptEnvelope` (canonicalized text projection) ->
`estimateGpt56Prompt` (exact o200k count over segments) -> TokenUsageLogger.

Live session evidence (codex/gpt-5.6-sol, stateful WebSocket turns with
previous_response_id):

- turn-2 actual_prompt_tokens 11,678 = parent's observed prompt 9,612 + image
  ~1,844 + ~222 text. The provider did NOT re-bill the instructions
  (~6,217 est) or tools schema (~3,921 est) that the incremental request
  re-carries, because the stateful parent retains them server-side.
- The pre-fix estimate = retainedBaselineTokens (9,689 = parent
  prompt+completion, which ALREADY includes instructions+tools) +
  count(incremental request WITH instructions+tools again) = a double count
  of ~10,138. That is the real phantom behind the issue's ~7.9k constant
  (at that repo state's schema size) and also explains the pre-fix
  under-estimate direction once the image cost was a ~6-token placeholder.

Root cause is therefore two independent defects:

- DEFECT B (confirmed, under-count of image): image parts travel as
  `input_image.image_url = "data:image/png;base64,..."`, canonicalized to
  `[binary media bytes omitted]` (~6 tokens) regardless of dimensions. The
  estimator never applies the settled `estimateImageTokens` formula (1,844
  for 1586x991 codex/gpt-5.6; the provider billed exactly that).
- DEFECT C (over-count, the ~7.9k constant): on stateful turns with an
  observed parent baseline, the incremental estimation projection counted
  the re-sent instructions and tools on top of the observed parent baseline
  that already includes them. With previous_response_id those fields are
  retained server-side and are not re-billed, so the estimate double-counts
  them. Limitation: mid-conversation instructions/tools changes would be
  under-counted by this exclusion (accepted; the wire body still carries
  them).

RETRACTED: the first-pass hypothesis treated the reasoning item's opaque
`encrypted_content` blob as the ~7.9k constant (a ~40-80KB blob counted as
raw text) and canonicalized it to a placeholder. Live evidence refutes it:
when a server-side parent is active, reasoning items are NOT re-sent, so the
blob never contributes on codex stateful turns. On stateless
openai-responses sends, re-sent encrypted reasoning IS billed input, so
canonicalizing it to a placeholder would under-estimate. The
encrypted_content canonicalization is reverted; `encrypted_content` strings
are counted as ordinary text again.

## Accepted behavior

AC1: Image data URIs and Anthropic image base64 sources produce image entries
(dimensions parsed from the base64 header when parseable, else
dimensions-omitted) on `ProviderFinalizedPromptProjection.imageEntries`. The
GPT-56 exact estimator adds `estimateImageTokens({provider: activeProvider,
model: canonicalModel, dimensions})` per entry on top of the text count.
PDFs, non-image binaries, and images without base64 (URL-referenced) produce
NO entries (URL images are a documented follow-up, no evidence in issue).

AC2: Stateful-exclusion contract: when the projection context carries
`retainedBaselineTokens` (an observed server-side parent baseline), the
incremental estimation projection counts ONLY the `input` prompt key.
Instructions and tools are retained inside the parent baseline and are not
re-billed, so counting them again double-counts (issue #3481). The
full-history fallback branch (no observed baseline) keeps counting the full
prompt-key set for both the incremental and full-history projections.

AC3: Issue-shape regression: a tool turn with a resized image and a
reasoning item estimates image-turn minus baseline delta in [1,844 +
scaffold, 1,844 + 400] for codex/gpt-5.6-sol with a 1586x991-header PNG.
A stateful-context case through
projectOpenAIResponsesPromptEnvelope + the estimator with an incremental
request carrying instructions+tools+image input and a retained baseline
estimates retained + input-only count (instructions/tools excluded).

AC4: Contract identities: PROJECTION_REVISION 3 -> 4 (canonical text and
projection shape changed), GPT_56_ESTIMATOR_VERSION 'gpt-5.6-o200k-v1' ->
'gpt-5.6-o200k-v2'. The encrypted_content placeholder change from the first
pass is reverted (the revision-4 canonicalization that remains is the
imageEntries collection plus the single-pass canonicalPromptEntries
refactor). Anthropic/openai-chat canonical text is unchanged, so claude
calibration assets remain textually valid.

## Out of scope (explicit)

- imageTokenEstimation formulas incl. the 1536-patch cap (#3477 territory).
- Resize defaults/plumbing, packages/tools behavior.
- historyTokenEstimation path (not implicated by evidence).
- URL-referenced image entries; official/claude estimator families reading
  imageEntries.
- Under-counting of mid-conversation instructions/tools changes on stateful
  turns (accepted limitation of the exclusion; wire body still carries them).
- Uncapped billing parity for resize-disabled large images (formula cap is
  settled; resize defaults prevent the case).

## Implementation

1. packages/providers/src/runtime/promptEnvelopeProjections.ts:
   - Add `imageEntries` collection during canonicalization (data-URI mime
     image/* -> parse dims via parseImageDimensionsFromBase64 from
     @vybestack/llxprt-code-tools; anthropic `{type:'base64', media_type:
     image/*, data}` -> same). Entry shape `{ dimensions?: ImageDimensions }`.
   - Attach frozen `imageEntries` (only when non-empty) to
     ProviderFinalizedPromptProjection; bump PROJECTION_REVISION to 4.
   - When `retainedBaselineTokens` is set, build the incremental estimation
     projection with only the `input` prompt key (module-level
     STATEFUL_INCREMENTAL_PROMPT_KEYS). The full-history fallback keeps the
     full prompt-key set for incremental and fullHistory.
   - REVERTED (first pass): encrypted_content opaque-placeholder
     canonicalization (OPAQUE_REASONING_PLACEHOLDER / isOpaqueReasoningPayload)
     removed; string canonicalization is plain data-URI handling only.
2. packages/providers/src/tokenizers/Gpt56O200kPromptEstimator.ts:
   - countProjectionTokens adds per-entry estimateImageTokens using
     request.activeProvider/canonicalModel; bump estimator version.
3. Tests (bun:test, colocated):
   - promptEnvelopeProjections.test.ts: imageEntries for image data URI
     (handcrafted 1586x991-header PNG), no entries for PDF/unknown mime;
     anthropic image base64 entry vs PDF document no-entry; revision 4
     updates; new stateful retained-baseline describe proving the
     incremental estimation projection excludes instructions/tools while
     still recording the image entry, plus the full-history fallback
     regression guard.
   - Gpt56O200kPromptEstimator.test.ts: entries add formula tokens (1,844),
     absent entries unchanged, unknown-dims entry -> 1,844 (codex/gpt-5.6),
     version assertion.
   - Gpt56O200kPromptEstimator.issue3481.test.ts: issue-shape pipeline
     (buildOpenAIResponsesInput from tool history with thinking
     encryptedContent + image tool result -> projection -> estimate)
     asserting the image-cost delta, plus a stateful-context case asserting
     retained + input-only count.

## Verification

Targeted bun tests (five files: projections, estimator, estimator issue-
3481, core PromptEstimation, openai-responses projection), then typecheck,
lint, format; live headless repro on gpt56solhigh expecting image-turn est
delta ~2.0k matching actual (~1.9-2.1k) and the stateful double-count
removed.

## Verification evidence (2026-09-13)

- Targeted: 161 pass / 0 fail across the five files (bun test).
- Canonical providers suite: `bun scripts/run_bun_tests.ts --workspace
  providers` -> 644/644 files passed (post-remediation run,
  tmp/verify3481/providers-canonical4.log).
- Workspace typecheck (providers, both tsconfigs), eslint and prettier on
  changed files: clean.
- Live headless repro (gpt56solhigh, codex/gpt-5.6-sol, same 4000x2500
  PNG as the issue-class repro; session 9c00d8e8):

  | turn | est | actual | est delta | actual delta |
  | --- | --- | --- | --- | --- |
  | 1 (no image) | 10,213 | 9,612 | - | - |
  | 2 (image) | 12,210 | 11,702 | +1,997 | +2,090 |
  | 3 | 12,066 | 12,017 | -144 | +315 |

  Pre-fix comparison runs on the same prompt: image-turn est delta was
  +12,127 (first-fix build, image cost added but stateful double-count
  remaining) and +9,833/+7,936-class over-counts in the issue's sessions.
  Post-fix image-turn delta error is -93 tokens (-4.5%); absolute turn-2
  error 4.3%, turn-3 0.4%. Both directions from the issue are resolved:
  image cost estimated via the patch formula instead of a placeholder
  (fixes the under-estimate when unresized) and the stateful
  instructions/tools double-count removed (fixes the ~4x over-estimate
  after resize).
- Startup smoke: the live repro itself boots the CLI headless through
  scripts/start.ts (StepFun profile retired; gpt56solhigh used).
