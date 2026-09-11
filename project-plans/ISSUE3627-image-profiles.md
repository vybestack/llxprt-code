# Issue 3627: Image model profiles

Plan ID: PLAN-20260910-ISSUE3627
Generated: 2026-09-10

## Goal

Add typed model and image profiles. Model profiles may refer to one image profile by name. Loading a model profile resolves that reference before changing runtime state and fails with the missing profile name when the reference is dangling. With no image profile, image operations retain the existing `gpt-image-2` and Codex OAuth behavior.

## Preflight findings

- Model profile persistence and command parsing already live in the CLI profile command, load, schema, bootstrap, resolution, and runtime application modules named in the issue.
- Image operations converge through the resolver installed in `postConfigRuntime.ts`.
- `codexImageBackend.ts` owns request-body defaults and response parsing; its generate and edit tests pin request bodies.
- `ImageGenerationService.ts` owns the public quality type.
- Image profile resolution must remain separate from `profileLoadBalancer.ts`.

## Phase 1: Profile types and persistence

Requirements:

- Accept `/profile load|save model <name>` and `/profile load|save image <name>`.
- Keep `/profile load|save <name>` as model aliases.
- Treat files without a discriminator as model profiles.
- Persist image model, base URL, auth reference, and quality, size, and background defaults.

TDD:

1. Add schema and profile-manager tests for legacy model parsing and image profile round trips.
2. Add command tests for typed forms and alias equivalence.
3. Implement the discriminated profile types and typed persistence paths.

## Phase 2: Reference lifecycle

Requirements:

- Saving a model profile records the active image profile name.
- Loading a model profile resolves its image profile reference.
- A missing referenced image profile aborts the load with an error naming it.
- Loading another image profile replaces the active image profile.

TDD:

1. Add behavioral tests for capture, resolution, replacement, and dangling-reference failure.
2. Thread the resolved image profile through bootstrap/runtime state only after successful validation.

## Phase 3: Configurable backend

Requirements:

- Active image profile values select model slug, base URL, auth, and operation defaults for all image surfaces.
- Without an active image profile, preserve the current backend and resolver behavior.
- Edit requests forward effective quality, size, and background instead of forcing `auto`.
- Add `xhigh` and `max` to the quality union.

TDD:

1. Extend, never relax, generation and edit body-pinning tests for profile values and fallback values.
2. Add resolver tests for profile auth/base URL selection and default Codex OAuth selection.
3. Implement backend options and composition-root wiring.

## Phase 4: Response metadata and documentation

Requirements:

- Parse response `usage`, resolved `quality`, and resolved `size`, without expecting a model field.
- Surface those fields through the result and debug logging at minimum.
- Document typed profile syntax, image payload fields, references, and fallback behavior.

TDD:

1. Add response parsing tests using the documented response shape.
2. Implement typed response metadata and logging.
3. Update profile documentation.

## Verification

Run focused Bun tests after each red-green slice. Before handoff run:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Keep each working slice committed on `issue3627`. Do not push, create a pull request, or merge.

## Appendix: Verified deployed mlx-openai-server wire contract (2026-09-10)

Empirically pinned on this M4 Max against mlx-openai-server git main `4b7d4b61`
(same as pypi 1.8.1 for these paths), mflux 0.17.5, mlx 0.31.2, model
`black-forest-labs/FLUX.2-klein-4B` (4-bit), venv `/Volumes/XS1000/tools/mlximg-venv`,
`HF_HOME=/Volumes/XS1000/hf-cache`. Raw probe scripts and artifacts:
`tmp/mlximg-verify/`. This discharges deepthinker required change 3.

### Server-side blockers found (both worked around locally; upstream bugs)

1. The server's snapshot download drops `tokenizer/chat_template.jinja` even
   though the repo ships it, so every generation 500s with
   "tokenizer.chat_template is not set". Fix: fetch the file directly into the
   HF cache with `hf_hub_download` (upstream file-filter bug).
2. mlx >= 0.31.2 makes device streams thread-affine; the server loads image
   models on the main thread but infers on a worker thread, so every request
   500s with "There is no Stream(gpu, 0) in current thread" (upstream issue
   cubist38/mlx-openai-server#314, fix PR #316 unmerged). Local patch: in
   `app/models/mflux.py` `_load_backed`, `mx.eval(list(params.values()))` on
   the loader thread right after load.

### Generations (`POST /v1/images/generations`, txt2img config `flux2-klein-4b`)

- `size`: strict enum `256x256|512x512|1024x1024`. `auto` and arbitrary values
  (e.g. `1280x720`) are rejected 422 (pydantic). Omitted = 1024x1024.
- `response_format`: only `b64_json`; `url` is rejected 422.
- `n`: accepted but ignored; always exactly one image.
- `quality` / `background`: accepted but silently ignored (no such mflux knobs).
- 200 body: `{"created": <int unix>, "data": [{"b64_json": "<png b64>", "url": null}]}`
  No usage, no revised_prompt, no size/quality echo. `url` key present, always null.
- Timing at 1024: ~18.7s first (warm-up), ~14.5s steady; 256 ~2.5s.
- Deterministic: default seed 42; same prompt+size reproduces byte-identical PNG.
- Unknown model: 404 `{"detail":{"error":{"message":"Model 'x' not found. Available models: <id>","type":"model_not_found","code":404}}}`.
- `/v1/models`: `id` is the full model path string (`black-forest-labs/FLUX.2-klein-4B`), `owned_by: "local"`.

### Edits (`POST /v1/images/edits`, multipart)

- Multipart field is `image` (single or repeated files). `image[]` is rejected
  422 ("image: Field required"). Repeated `image` fields parse as a list.
- Accepted content types: PNG, JPEG, JPG (400 otherwise, enforced in source).
  The 10 MiB check exists in source but is NOT enforced on the deployed path:
  a 12.98 MB upload proceeds to inference and dies at the 300s worker timeout.
- `prompt` required (missing = 422). Extra fields (`mask`, `quality`,
  `background`, `n`) pass validation and are dropped at the model boundary.
  Sending the full codex-style extras set together (`size`+`mask`+`quality`+
  `background`+`n`) triggered a 28-step slow path that always exceeds the 300s
  worker timeout; individually `size` and `mask` are benign. Root cause not
  isolated; the dialect must simply not send codex extras.
- On a txt2img config, edits return 200 but silently IGNORE the input image
  (img2img never engages; output is deterministic txt2img for the prompt).
  `size` on edits is also silently ignored (output stays 1024x1024).
- On the edit config (`flux2-klein-edit-4b`): true conditioning verified
  (inverted input, same prompt+seed, different output). Single-image edit at
  1024 takes ~215-220s (28 steps). Multi-image edit takes ~330s, which crosses
  the 300s worker timeout: client gets a 500 with an EMPTY message while the
  server finishes the job afterward and discards it (compute lost).
- On the edit config, `POST /v1/images/generations` is broken (500:
  `concatenate(): incompatible function arguments` from an empty reference list).
  One server instance serves exactly one config; no single instance correctly
  serves both generations and edits.

### Error envelopes (three distinct shapes observed)

1. Validation 422: `{"detail": [{"type","loc","msg","input","ctx"}]}` (FastAPI).
2. Handler failure: `{"detail": {"error": {"message","type":"server_error","param":null,"code":"500"}}}`
   (same wrapper for 404 model_not_found).
3. Endpoint catch-all 500 (timeouts): `{"error": {"message": "", "type": "internal_error", "param": null, "code": "500"}}`
   with an empty message and no `detail` wrapper.

### Consequences for the image-profile design

- MLX dialect request vocab: `model`, `prompt`, `size` (three literals only),
  `n: 1`; edits add only `image` (PNG/JPEG) + `prompt` + `model`. Never send
  `auto`, `url`, `quality`, `background`, `mask`, or codex extras.
- The adapter must parse all three error shapes and treat empty-message 500s
  as server timeouts.
- Klein edit profiles should cap input images at 1 (multi-image always loses
  the artifact past the 300s server timeout) and prefer no explicit size.
- Client-visible timeouts must be set with the 300s server worker timeout in
  mind; anything longer on the server side is paid compute with no artifact.
- Response metadata is sparse: no usage block at all (deepthinker item 9:
  absent usage must surface as unknown, never fabricated).

### Relaunch commands (verification environment)

```bash
HF_HOME=/Volumes/XS1000/hf-cache /Volumes/XS1000/tools/mlximg-venv/bin/mlx-openai-server launch \
  --model-type image-generation --model-path black-forest-labs/FLUX.2-klein-4B \
  --config-name flux2-klein-4b        # or flux2-klein-edit-4b for edits
  --quantize 4 --host 127.0.0.1 --port 8321
```

Apply the two local fixes above after any reinstall of the package.

## Decisions (2026-09-10, Andrew) — binding on all implementation slices

1. **Auth modes for image profiles (all required):** named keys (references
   resolved via the provider key storage), literal keys, keyfiles, and OAuth.
   `none` remains a valid mode for local unauthenticated endpoints (e.g.
   mlx-openai-server). This supersedes the earlier narrower recommendation.
2. **Architecture directives (binding):** IoC/dependency injection over module
   globals; strict separation of concerns; DRY (reuse the existing
   profile/auth machinery rather than forking it); respect and increasingly
   use contract, package, and API boundaries — persistence in
   `packages/settings`, backends and auth storage in `packages/providers`,
   runtime state in `packages/core`, user surfaces in `packages/cli`;
   cross-package imports only through each package's public exports.
3. **Proceeding on recommendation unless vetoed:** (a) size/quality/background
   knobs are profile-level only in this slice, not per-call tool arguments;
   (b) custom codex OAuth origins are dropped from the initial release
   (standard codex OAuth stays).

### Slice map (deepthinker items → implementation slices)

- Slice A: runtime-scoped active image state + coherent transitions + typed
  dangling-ref errors (6); persistence safety (7); defaults-as-optional-
  overrides, omitted never `auto`, no 400 auto-retry (2); `ImageBackendAuth`
  union types + per-backend mode validation (5, types only).
- Slice B: single unified ImageBackend contract (1); MLX dialect vocab per
  the verified appendix; URL results materialized to validated base64 PNG
  in the adapter (4).
- Slice C: auth resolution wiring (5) — named-key via
  `createProviderKeyStorage()`, keyfile read, literal key, codex OAuth;
  `-P`/`-O` no longer require conversational auth (8, gating half).
- Slice D: surfaces (8) — `--image-profile` selector, `/image` command,
  `generate_image` tool; response metadata accuracy, absent usage = unknown (9).
- Slice E: behavioral contract tests + pinned MLX fixtures + opt-in local
  smoke (10).

## End-to-end verification checklist (for the E2E phase, pre-staged)

Environment preflight (see Appendix for relaunch commands and the two local
server fixes that must be in place): venv param-materialization patch present;
`tokenizer/chat_template.jinja` present in the HF cache snapshot; server
readiness polled via `/v1/models` containing `klein` (case-insensitive).

Server matrix: txt2img config (`flux2-klein-4b`) for generation cases; edit
config (`flux2-klein-edit-4b`) for true-edit cases. One instance serves one
config; run sequentially on port 8321 or parallel on 8321/8322.

Surfaces (all three must pass with an image profile active):
1. `generate_image` tool through a conversational session.
2. `/image` slash command.
3. `-P "<prompt>" -O out.png` direct mode, including the path where no
   conversational auth exists (local image profile only must suffice).

Behavioral cases:
- No `imageProfile` reference: byte-for-byte current behavior (codex
  gpt-image-2 + codex OAuth); no new code path may alter it.
- MLX generation: size flows as a literal from the profile (or omitted);
  no `quality`/`background`/`auto`/`url` ever on the wire.
- MLX edit: single input image only (profile-capped); response decodes to a
  valid PNG; conditioning demonstrable (different input, different output).
- Dangling image profile reference: typed error naming the missing profile;
  no silent fallback.
- Error envelopes: 422 `{"detail":[...]}`, handler `{"detail":{"error":...}}`,
  and bare empty-message `{"error":...}` 500 all surface as readable errors.
- Auth `none` works against the local server with no credentials configured.

Artifacts: keep all generated PNGs for Andrew under a gitignored `tmp/` run
directory; record timings (1024 steady ~14.5s, single edit ~215s expected).
