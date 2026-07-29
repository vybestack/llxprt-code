# Issue #2608 — Codex PDF input capability and filename preservation

## Policy basis

`dev-docs/workflow/ISSUE-DELIVERY.md` does not exist on this checkout,
`origin/main`, or the repository contents API. This plan applies the bounded
issue-delivery policy supplied with the issue request verbatim: stop before any
unplanned subsystem/public abstraction, workflow, agent-memory, quality-tool,
dependency, unrelated-refactor/test-move, or out-of-matrix behavior change;
target at most 25 files and 1,500 net lines; review scope above either target;
and stop without approval above 40 files or 2,500 net lines.

## Goal

Keep PDF-bearing tool continuations valid for the selected OpenAI Responses
backend. Codex must receive a truthful model-visible notice instead of an
unsupported `input_file`; PDF-capable endpoints must receive valid file data
with a source or deterministic fallback filename.

## Decisions

- `media.pdf.enabled` is a `model-behavior` setting. `RuntimeInvocationContext`
  separates registry entries by category and `getModelBehavior()` reads only
  that category.
- Absence of the setting preserves current public OpenAI Responses behavior:
  native PDF input remains enabled. The Codex alias explicitly sets it to
  `false`.
- The 50 MB aggregate native-file boundary fails locally with a clear preflight
  error. The limit is decimal `50_000_000` bytes (the documented external
  provider limit), not binary `50 * 1024 * 1024`. This is the accepted fail-fast
  option for a documented external provider limit; unsupported Codex PDFs still
  degrade to text and continue.
- Preserve the source basename, not an absolute path. Legacy/history blocks
  without a filename use `document.pdf` only when native PDF input is enabled.
- The parallel Gemini `ContentConverters.ts` path is outside the failing
  read_file → Codex continuation and is not authorized in this issue.

## Acceptance matrix

| AC | Accepted behavior | Behavioral evidence |
| --- | --- | --- |
| A1 | With native PDF disabled, the active Responses builder emits no `input_file` for PDF tool output. | Active-builder test using realistic tool-call/tool-response/media continuation. |
| A2 | The replacement is model-visible `input_text` stating the PDF was not read, naming it when known, and suggesting text extraction or page rendering; pairing remains valid so the loop can continue. | Active-builder continuation test asserts notice contents and function-call/output pairing. |
| A3 | Codex declares PDF input unsupported through `media.pdf.enabled=false`, not a model-name conditional. | Codex alias config test plus provider/executor request-construction test with invocation ephemeral precedence. |
| A4 | PDF-enabled Responses requests emit `input_file` with a PDF data URI and a non-empty source filename. | Active-builder test with a realistic media block produced by the read/history shape. |
| A5 | `read_file` media output preserves the source basename through neutral history into serialization. | Real file utility boundary test, legacy-part conversion test, and active-builder assertion. |
| A6 | A legacy PDF block without a filename uses `document.pdf` when native PDF input is enabled. | Active-builder fallback test. |
| A7 | Parallel PDF tool results are serialized exactly once each without cross-tool duplication. | Active-builder multi-tool continuation test checks counts, filenames, and call IDs. |
| A8 | Aggregate native PDF input above 50 MB is rejected before network submission with a clear actual/allowed-size error; disabled PDFs are not counted. | Builder boundary tests immediately below/above the combined limit and disabled-PDF exclusion test. |
| A9 | Existing image/media behavior and tool-call/output pairing do not change. | Existing stateful/tool-pairing suites plus focused image regression if needed. |
| A10 | The setting is registry-validated and obeys invocation → model behavior → settings precedence with enabled-by-default semantics. | Ephemeral registry tests and provider/executor request-body tests. |

## Explicit non-goals

- No PDF-to-image rendering or thumbnail fallback.
- No PDF text extraction.
- No hydrated `capabilities.pdf` plumbing from the model registry.
- No changes to the inactive `buildResponsesInputFromContent` helper.
- No changes to Gemini `ContentConverters.ts` or other provider subsystems.
- No new public abstraction, dependency, profile schema, workflow, agent memory,
  quality rule, lint/complexity threshold, suppression, or source exclusion.
- No unrelated refactor, test relocation, optional hardening, or cleanup after
  accepted behavior and gates pass.

## Bounded vertical slices

1. **Filename preservation** — RED tests at `processMediaFile` and
   `legacyPartsToBlocks`; GREEN by carrying `inlineData.displayName` and mapping
   it to `MediaBlock.filename`.
2. **Capability declaration and validation** — RED registry/alias tests; GREEN
   with the boolean model-behavior registry entry and Codex alias default.
3. **Active serialization behavior** — RED active-builder tests for enabled,
   disabled, missing-filename, parallel, and paired continuation cases; GREEN by
   resolving/threading the capability and emitting valid file or explicit text.
4. **Aggregate limit** — RED exact-boundary tests; GREEN with one builder
   preflight over native PDF payload bytes and a clear local error.
5. **Provider request construction** — RED provider-level request-body tests for
   precedence/default behavior; GREEN through the same executor path, with no
   provider/model-name branch.

## Expected paths

### Plan

- `project-plans/issue-2608-codex-pdf-input.md`

### Production/configuration

- `packages/tools/src/utils/fileUtils.ts`
- `packages/core/src/utils/generateContentResponseUtilities.ts`
- `packages/providers/src/openai-responses/OpenAIResponsesInputBuilder.ts`
- `packages/providers/src/openai-responses/openAIResponsesExecutor.ts`
- `packages/providers/src/utils/mediaUtils.ts`
- `packages/settings/src/settings/registry/registry-entries-1.ts`
- `packages/providers/src/composition/aliases/codex.config`

### Behavioral tests

- `packages/tools/src/utils/fileUtils.test.ts`
- `packages/core/src/utils/generateContentResponseUtilities.test.ts`
- `packages/providers/src/utils/mediaUtils.test.ts`
- `packages/providers/src/composition/providerAliases.codex.test.ts`
- `packages/providers/src/runtime/ephemeralSettings.mediaPdf.test.ts` (new)
- `packages/providers/src/openai-responses/__tests__/OpenAIResponsesInputBuilder.pdf.test.ts` (new)
- `packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.pdf.test.ts` (new, only if needed to prove executor/request construction without duplicating existing provider harness coverage)
- `packages/providers/src/openai-responses/__tests__/OpenAIResponsesInputBuilder.stateful.test.ts`
- `packages/providers/src/openai-responses/__tests__/OpenAIResponsesInputBuilder.toolPairing.test.ts`

Expected maximum: 17 paths including this plan, approximately 700–1,100 net
changed lines. The provider-level PDF test is conditional within this ledger;
using an existing provider test instead does not authorize another path.

## Scope ledger

| Slice/item | Status | Authorized paths | Notes |
| --- | --- | --- | --- |
| Acceptance and scope record | Complete | plan | Canonical file absent; supplied policy recorded. |
| Filename preservation | Complete | tools/core utility + tests | `inlineData.displayName` → `MediaBlock.filename`. |
| Capability registry and Codex alias | Complete | registry, alias, registry/alias tests | `media.pdf.enabled` model-behavior setting; Codex `false`. |
| Builder gating and notice | Complete | Responses builder, media helper, tests | F1 hoist, F2 decimal limit, F4 inline-only counting. |
| Executor resolution/default/precedence | Complete | executor, provider test | Invocation → model behavior → settings; default enabled. |
| Aggregate 50 MB preflight | Complete | builder + builder tests | `PDF_AGGREGATE_MAX_BYTES = 50_000_000`; unambiguous error. |
| Existing context test updates | Complete | stateful/toolPairing tests | `mediaPdfEnabled: true` added. |
| Dead code removal (F3) | Complete | mediaUtils + test | `base64DecodedByteLength` deleted. |
| PDF-to-image/text extraction | Non-goal | none | Requires separate acceptance and approval. |
| Gemini converter symmetry | Non-goal | none | Unrelated provider path. |
| Hydrated capability plumbing | Non-goal | none | Unplanned subsystem expansion. |
| Workflow/memory/quality/dependency changes | Prohibited | none | Stop for approval if proposed. |

Any additional path or behavior must be entered here and classified before edit.
Reviewer findings will be classified as `Blocker-Fix`, `In-scope-Fix`, `Reject`,
or `Defer`; review comments do not expand this ledger.

### Review finding dispositions

| Finding | Classification | Resolution |
| --- | --- | --- |
| F1 N×M media duplication | Blocker-Fix | Hoisted media emission out of per-response loop; emits once per tool turn if ≥1 output emitted. |
| F2 Binary limit / ambiguous errors | Blocker-Fix | `50_000_000` decimal; error includes exact bytes + `50 MB`; four-4MB multi-response test added. |
| F3 Dead `base64DecodedByteLength` | In-scope-Fix | Export and all direct tests deleted. |
| F4 URL miscounted as base64 | In-scope-Fix | Renamed to `inlineBase64ByteLength`; counts only `data:*;base64,` payloads; returns 0 for bare URLs. |
| F5 Filename preservation test | In-scope-Fix | Added behavioral test through `convertToFunctionResponse` with `processMediaFile`-shaped inlineData. |
| F6/F7 ProviderMediaSupport / inactive builder | Reject | No unification or modification. |
| F8 Other `vi.unmock` cleanup | Defer | Out of scope. |

### Mandatory scope review

DeepThinker review was attempted twice but blocked by the profile's usage limit;
Architect completed the independent mandatory scope review instead. Final exact
counts (all untracked lines counted as additions):

| Category | Additions | Deletions |
| --- | --- | --- |
| Tracked (13 files) | 351 | 26 |
| Untracked (4 files) | 989 | 0 |
| **Total** | **1340** | **26** |

**Net: 1314** (within ≤1500 target; below 2500 hard stop).

## Completion evidence

Exact-head completion requires all matrix behaviors to have behavioral evidence;
focused and full local verification to pass; independent architecture and OCR
review findings to be classified and all accepted fixes resolved; candidate-head
CI and PR review checks to pass; correct ancestry and conflict-free mergeability;
and the final file/line counts to remain within this clean ledger.
