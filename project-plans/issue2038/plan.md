# Issue 2038 Delivery Plan: Model-aware image downscaling

Plan ID: PLAN-20260730-ISSUE2038
Base: `origin/main`
Issue: https://github.com/vybestack/llxprt-code/issues/2038

## Policy provenance

`dev-docs/workflow/ISSUE-DELIVERY.md` is not present on this branch, in the
repository tree, or in repository history. This plan applies the bounded
issue-delivery policy supplied with the request directly. `dev-docs/RULES.md`
governs test-first delivery and behavioral evidence.

## Problem and chosen architecture

`read_file` and `read_many_files` both call
`processSingleFileContent()` in `packages/tools/src/utils/fileUtils.ts`.
Images currently follow the same media path as PDF/audio/video: the complete
file is read, base64-encoded, and returned without inspecting its dimensions.
Large image tool results can therefore exceed a model's useful native vision
resolution or a provider's admission limits.

The bounded design is:

- Keep the existing read tools. Add `skip_image_resize` to `read_file`; do not
  add a duplicative `read_image` tool.
- Add profile-persisted ephemeral settings under the existing setting registry:
  - `image-resize.enabled`: boolean; explicit `false` disables automatic image
    resizing for the profile.
  - `image-resize.maxLongEdge`: positive integer pixels.
  - `image-resize.maxShortEdge`: positive integer pixels.
  - `image-resize.maxPixels`: positive integer total decoded pixels.
- Resolve those settings through the existing `IToolHost` setting snapshot.
  Missing limits preserve the current behavior. Enabled resizing requires at
  least one valid limit; malformed direct profile values fail clearly rather
  than silently selecting a different image policy.
- Add class-based limits to the existing provider alias `modelDefaults` rules.
  `computeModelDefaults()` already merges every matching rule in order and
  `recomputeAndApplyModelDefaultsDiff()` preserves explicit profile values, so
  no new model-class subsystem is required.
- Put decoding/resizing in the leaf `packages/tools` package. Use `sharp`
  0.35.3 to inspect orientation-aware dimensions and perform one
  aspect-preserving, no-upscale fit. This is a new Apache-2.0 native dependency
  compatible with the package's Node >=24 requirement, and is the approval gate
  recorded below.
- Preserve the input container and MIME type for supported resize outputs. Keep
  animated GIF/WebP animated when resizing. If an oversized configured image is
  corrupt, unsupported by the decoder/encoder, or cannot be resized without
  flattening animation, return a clear tool error; never catch-and-send the
  original oversized bytes.
- Apply automatic resizing to both `read_file` and `read_many_files` through the
  shared media path. The per-call escape hatch is intentionally limited to
  `read_file`; a model can use individual reads when it explicitly needs an
  original image.

### Vendor-derived class defaults

The defaults are conservative useful-resolution targets, not claims that every
provider rejects larger files:

| Class | Match and built-in aliases | maxLongEdge | maxShortEdge | maxPixels | Basis |
| --- | --- | ---: | ---: | ---: | --- |
| Claude Opus | provider alias `anthropic` or `claudecode`; model contains the normalized Opus family | 1568 | 1568 | 1,229,312 | Anthropic standard tier: 1568 px long edge and 1568 28x28 visual patches. The 8000x8000 value is a hard admission ceiling, not a useful automatic target. |
| Claude Sonnet | provider alias `anthropic` or `claudecode`; model contains the normalized Sonnet family | 1568 | 1568 | 1,229,312 | Same conservative class-safe standard tier. Version-specific Claude 4.7+ expansion is deliberately not inferred from class. |
| OpenAI GPT | built-in `openai`, `openai-responses`, `openai-vercel`, or `codex`; model begins with `gpt-` | 2048 | 2048 | 1,572,864 | Conservative common high-detail envelope: 2048 px max dimension and 1536 32x32 patches. It is advisory; OpenAI publishes no generic class-wide hard dimension cap, and exact versions/detail modes differ. |
| Moonshot/Kimi | built-in `kimi`; model begins with `kimi` or is `k3-256k` | 4096 | 2160 | 8,847,360 | Moonshot recommendation not to exceed 4K (4096x2160), interpreted orientation-independently as long/short edges. It is advisory, not a documented rejection limit. |

The resize scale is the minimum of 1 and every configured edge/pixel scale.
Dimensions are rounded down, then re-read and checked against all limits.
Images already within every applicable limit are returned byte-for-byte without
re-encoding.

Primary references retrieved 2026-07-30:

- Anthropic vision: https://platform.claude.com/docs/en/build-with-claude/vision
- Anthropic request limits: https://platform.claude.com/docs/en/api/errors
- OpenAI image inputs: https://developers.openai.com/api/docs/guides/images-vision
- Moonshot/Kimi vision: https://platform.kimi.ai/docs/guide/use-kimi-vision-model

## Decision-complete acceptance matrix

| ID | Given | When | Then | Behavioral evidence |
| --- | --- | --- | --- | --- |
| A1 | `read_file` reads an image and effective resize limits are present | the decoded image exceeds any effective edge or pixel limit | it returns a proportionally downscaled inline image satisfying every configured limit, with source display name and matching output MIME preserved | real read-file/tool utility test using a generated image and decoding the returned bytes |
| A2 | `read_many_files` explicitly reads an image and effective limits are present | the image exceeds a limit | its inline image content satisfies every effective limit through the same shared path | real read-many-files behavioral test |
| A3 | an image is within every effective limit | either read tool processes it | the exact original bytes are returned and it is not upscaled or re-encoded | image utility and tool-boundary tests |
| A4 | no resize limit is configured | either read tool processes an image | existing byte-for-byte image behavior is unchanged | read-file and read-many-files behavioral tests |
| A5 | `image-resize.enabled` is explicitly false in the profile snapshot | either read tool processes an oversized image | original dimensions and bytes are preserved despite class defaults | tool behavioral test plus model-default precedence test |
| A6 | `read_file` receives `skip_image_resize: true` | it processes an oversized image under enabled defaults | original dimensions and bytes are preserved for that call only | read-file schema/invocation behavioral test |
| A7 | `read_file` receives `skip_image_resize` for text/PDF/audio/video/SVG | it processes the file | existing non-image behavior is unchanged | existing suites plus focused non-image regression only if needed |
| A8 | automatic resize is required for a corrupt or unsupported image | decoding/resizing runs | the invocation fails with a clear image-resize error naming the source; it does not silently pass the original bytes | real corrupt-file behavioral test |
| A9 | automatic resize handles orientation-bearing image metadata | it computes the fit | limits apply to displayed dimensions and the output remains correctly oriented | image utility test with generated orientation metadata |
| A10 | automatic resize handles animated GIF/WebP | resize is required | the output remains animated with the same frame count; if the selected encoder cannot preserve it, the tool fails clearly instead of flattening | real animated-image utility test, limited to formats supported by the approved dependency |
| B1 | profile settings are validated through the registry | each image-resize setting is set | booleans and positive integers are accepted; zero, negative, fractional, or wrong-type values are rejected | settings registry tests |
| B2 | no limits exist, or a profile explicitly sets `image-resize.enabled=false` | model defaults are applied | missing limits preserve legacy behavior; explicit profile values win over model defaults | provider mutation/model-default test |
| C1 | any versioned Claude Opus or Sonnet model matches the built-in Anthropic or Claude Code alias | model defaults are computed | it receives the Claude class limits, while Haiku/Fable and unrelated model names do not | alias/default computation tests |
| C2 | any `gpt-` model uses a built-in OpenAI visual alias | model defaults are computed | it receives the GPT class limits without enumerating model versions | alias/default computation tests across OpenAI aliases |
| C3 | a `kimi*` or `k3-256k` model uses the built-in Kimi alias | model defaults are computed | it receives the Kimi class limits by family rather than version | Kimi alias/default computation test |
| C4 | a non-matching/custom model has no profile resize policy | model defaults are computed and an image is read | no image resize setting is injected and existing image behavior remains unchanged | provider-default and read behavior tests |
| D1 | profile settings or the per-call opt-out are documented | a user configures image resizing | the docs state defaults, precedence, advisory vs hard limits, original-preservation behavior, and supported escape hatches | documentation review |

## Explicit non-goals

- A new `read_image` tool, model capability registry, provider-specific image
  pipeline, or public service/manager/adapter abstraction.
- Version-specific image limits, including a Claude 4.7+ high-resolution
  override or GPT detail-mode/version capability table.
- Provider request-body byte budgeting, aggregate multi-image limits, remote URL
  fetching, upload APIs, retries, or provider-side error translation.
- Changing provider format support, accepting new source formats, SVG rasterizing,
  PDF rendering, OCR, cropping, rotation UI, image-detail parameters, or quality
  controls.
- Enforcing vendor hard admission limits after `skip_image_resize` or profile
  disable; those escape hatches intentionally preserve the original tool result.
- A per-call opt-out on `read_many_files`; original reads remain available through
  `read_file`.
- Converting unsupported BMP/HEIC/HEIF sources to another format. Existing
  pass-through behavior remains when resizing is disabled/not configured;
  resize-required unsupported sources fail clearly.
- Load-balancer per-subprofile model-default recomputation. The effective tool
  setting snapshot remains the existing runtime contract.
- Any workflow, agent-memory, quality-tool, lint, complexity, coverage, safety,
  CI, or package-boundary change.
- Unrelated refactors, test moves, optional hardening, or cleanup after accepted
  behavior and required gates pass.

## Bounded test-first vertical slices

### Slice 1: image fit behavior

RED: add real-buffer behavioral tests for A3, A8-A10 and the proportional
edge/pixel fit in A1. Generate images through the real image library; decode the
actual output. No mocked decoder or expected-value mock.

GREEN: add the smallest `imageResize.ts` utility using `sharp`. Perform one
no-upscale resize, preserve format/animation, and re-check output dimensions.

### Slice 2: shared read path and escape hatches

RED: extend the real file/tool behavioral tests for A1-A7, including both read
entry points and the public `skip_image_resize` schema.

GREEN: thread one immutable resize policy into `processSingleFileContent()` and
apply it only in the image media branch. Resolve the setting snapshot in the
read tools; do not add model knowledge to `packages/tools`.

### Slice 3: validated configuration and class defaults

RED: add B1-B2 and C1-C4 settings/default tests before changing registry or
aliases.

GREEN: register the four ephemeral settings and add family-wide rules to the
existing alias config files. Explicit profile values must continue to win via
existing model-default diff semantics.

### Slice 4: user documentation

GREEN after preceding behavioral evidence: document D1 in the existing
ephemeral settings reference. No additional guide or architecture document.

Every production change follows a failing behavioral test. Existing assertions
must not be weakened or rewritten to legitimize a regression.

## Expected paths

Plan and dependency/locks:

1. `project-plans/issue2038/plan.md`
2. `packages/tools/package.json`
3. `package-lock.json`
4. `bun.lock`

Tools production/tests:

5. `packages/tools/src/utils/imageResize.ts` (new)
6. `packages/tools/src/utils/imageResize.test.ts` (new)
7. `packages/tools/src/utils/fileUtils.ts`
8. `packages/tools/src/utils/fileUtils.test.ts`
9. `packages/tools/src/tools/read-file.ts`
10. `packages/tools/src/tools/read-many-files.ts`
11. `packages/tools/src/__tests__/filesystem-tools.test.ts`
12. `packages/tools/src/__tests__/read-many-files-filtering-behavior.test.ts`

Settings/provider defaults/tests:

13. `packages/settings/src/profiles/types.ts`
14. `packages/settings/src/settings/registry/registry-entries-1.ts`
15. `packages/settings/src/__tests__/settingsRegistry.test.ts`
16. `packages/providers/src/composition/aliases/anthropic.config`
17. `packages/providers/src/composition/aliases/claudecode.config`
18. `packages/providers/src/composition/aliases/openai.config`
19. `packages/providers/src/composition/aliases/openai-responses.config`
20. `packages/providers/src/composition/aliases/openai-vercel.config`
21. `packages/providers/src/composition/aliases/codex.config`
22. `packages/providers/src/composition/aliases/kimi.config`
23. `packages/providers/src/composition/providerAliases.modelDefaults.test.ts`
24. `packages/providers/src/composition/providerAliases.kimi.test.ts`

Documentation:

25. `docs/reference/ephemerals.md`

Published root manifest:

26. `package.json`

No path beyond this list is authorized without first updating the matrix and
ledger and obtaining approval where the policy requires it.

## Scope ledger

| Category | Planned files | Planned net lines | Actual files | Actual net lines |
| --- | ---: | ---: | ---: | ---: |
| Plan | 1 | 340 | 1 | 339 |
| Dependency and locks | 4 | 680 | 4 | 719 |
| Production/config source | 13 | 400 | 13 | 466 |
| Behavioral/settings tests | 7 | 800 | 7 | 829 |
| Documentation | 1 | 45 | 1 | 13 |
| **Total** | **26** | **2,265** | **26** | **2,366** |

Targets and stops:

- Target ceiling: 25 files or 1,500 net changed lines.
- The mandatory scope review accepted the target overrun: the measured
  1,971-line implementation included 674 generated dependency/lock lines and
  remained below the 40-path/2,500-line hard stop. Publish-integrity testing
  proved the approved runtime dependency must also be declared by the published
  root package, authorizing `package.json` as bounded path 26 before edit.
- Mandatory scope review if either target is exceeded.
- Hard stop without approval above 40 files or 2,500 net changed lines.
- Generated lockfile changes and all incidental tracked/untracked files count.
- Do not consume the hard budget for optional cleanup or hardening.

Final scope reconciliation: 26 paths and 2,366 net text-equivalent lines
remain below the 40-path/2,500-line hard stop. This includes every line in the
three untracked planned files and measures the binary-attributed npm lock after
normalizing both JSON versions, producing 562 additions and 3 deletions. No path
outside the reconciled list was changed.

## Approval gate: new dependency

The repository has no image decoder/resizer. Implementing the accepted behavior
requires one. The planned dependency is `sharp@^0.35.3` in
`@vybestack/llxprt-code-tools`; it is Apache-2.0, supports Node >=20.9, and ships
platform-specific native libvips packages. This changes the package graph and
lockfiles and can affect bundle/install size and cross-platform packaging.

The supplied policy requires stopping for approval before a dependency change.
No production code, tests that import the proposed package, package manifest, or
lockfile will be changed until explicit approval is received.

## Review triage contract

Every DeepThinker, Open Code Review, CodeRabbit, CI, and human finding will be
recorded as exactly one of:

- **Blocker-Fix**: accepted behavior, safety, correctness, architecture, or a
  required gate cannot complete without it.
- **In-scope-Fix**: a valid issue within this matrix and ledger.
- **Reject**: factually incorrect, already covered, harmful, or incompatible
  with accepted behavior.
- **Defer**: valid but outside this issue's matrix; no implementation in this PR.

Reviewer suggestions do not authorize scope expansion. At most two local OCR
and two PR OCR reviews are allowed. Across code/design review work, no more than
two review/remediation cycles will be performed; at least one includes
DeepThinker.

### First-cycle accepted findings

| ID | Classification | Resolution contract |
| --- | --- | --- |
| F1 | Blocker-Fix — resolved | Declared approved `sharp@^0.35.3` in root runtime dependencies, regenerated both locks, and publish integrity passes. |
| F2 | Blocker-Fix — resolved | `maxPixels` now counts every decoded frame while per-frame `pageHeight` remains the edge geometry; real two-frame GIF evidence passes. |
| F3 | Blocker-Fix — resolved | `ImageResizeError` survives as the `image-resize` result discriminant and `read_many_files` returns an explicit error for real corrupt/unsupported buffers without message parsing. |
| F4 | In-scope-Fix — resolved | Explicit policy-resized images retain the 20 MiB source guard and are checked against returned-byte limits after resize; noisy >512 KiB source evidence passes, while other paths retain pre-read limits. |
| F5 | In-scope-Fix — resolved | Decoded format is checked against declared PNG/JPEG/GIF/WebP MIME before resize; TIFF/AVIF output branches are removed and real TIFF/mismatched PNG evidence passes. |
| F6 | In-scope-Fix — resolved | Direct absent-policy `ReadFileTool` exact-byte evidence uses the shared PNG fixture builder. |
| F7 | Defer — unchanged | No decoder-budget policy was added. |


### Local Open Code Review triage

Local OCR session `0e384f2f-695c-4790-9448-14204bcb8778` reviewed 15
source/test/manifest files and produced eleven comments. All were evaluated:

- **In-scope-Fix — resolved:** numeric setting tests now cover `NaN` and
  `Infinity` and use named parameterized cases; Kimi effective merged defaults
  are asserted for `kimi-k3` and `k3-256k`; duplicate read-many host setup was
  removed; decoded image dimensions now fail clearly when metadata omits width
  or height; image resize policy is resolved once per `read_many_files`
  invocation and malformed policy values return explicit tool errors in both
  read tools; the shared 20 MiB constant now governs both source-size checks.
- **In-scope-Fix — resolved:** negative provider-default evidence now asserts
  the complete long-edge, short-edge, and pixel-limit group is absent.
- **Reject:** OCR suggestions to silently fall back to no resize or skip files
  when profile settings are malformed conflict with the accepted fail-fast A8/B1
  behavior. The underlying duplicate-resolution bug was fixed while preserving
  a clear configuration error.

No additional production/config path was added. All accepted local OCR findings
are resolved, and the two-cycle review limit is closed; no further local design
or code review will be launched.

## Stop conditions requiring approval

Stop before:

- changing or adding behavior outside A1-D1;
- adding a dependency other than the explicitly approved `sharp` change;
- adding a new tool, subsystem, public abstraction, service, manager, adapter,
  provider capability registry, or public API beyond `skip_image_resize` and
  the four planned ephemeral settings;
- changing a workflow, agent memory, quality tool, lint/complexity/coverage/CI
  rule, source exclusion, package boundary, or safety requirement;
- moving an unrelated refactor/test or changing unrelated assertions;
- exceeding the expected path list without a scope review, exceeding the target
  after consolidation, or exceeding the hard budget under any circumstance.

## Required gates and exact-head completion

The candidate head is complete only when:

1. Every A1-D1 row has behavioral evidence on that exact head.
2. Focused package tests pass, followed by `npm run test`, `npm run lint`,
   `npm run typecheck`, `npm run format`, and `npm run build`.
3. The available project smoke command,
   `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`,
   passes. (`scripts/start.js` is absent on this base.)
4. Local DeepThinker and OCR reviews are complete; every finding is classified;
   all Blocker-Fix and In-scope-Fix items are resolved.
5. The committed exact head is pushed; CI and bounded PR reviews pass on it;
   every CodeRabbit comment is evaluated, answered, and resolved when addressed
   or invalid.
6. `git merge-base --is-ancestor origin/main HEAD` succeeds, the PR reports no
   conflicts, and the final file/line counts reconcile to a clean scope ledger.
7. No suppressions, weakened gates, optional cleanup, or out-of-matrix changes

## Exact-tree verification evidence

The final uncommitted candidate tree passed:

- focused image/settings/provider behavioral suites: 251 tests;
- publish-integrity suite: 17 tests;
- `npm run test`;
- `npm run lint`;
- `npm run typecheck` after refreshing workspace links with `npm install`;
- `npm run format` and `git diff --check`;
- `npm run build`;
- `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.

The requested `scripts/start.js` entry point is not present on this base. The
project-local Bun launcher and configured smoke profile completed successfully.
`origin/main` is an ancestor of the candidate branch, and the working tree
contains only the 26 reconciled issue paths.
   remain.

Stop successfully at that point. Do not continue optional hardening or cleanup.
