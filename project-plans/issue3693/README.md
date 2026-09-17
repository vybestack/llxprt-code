# Issue #3693 — zai image input 400 `[1210][图片输入格式/解析错误]`

Plan ID: PLAN-20260916-ZAI-IMAGE-1210
Generated: 2026-09-16
Requirements: REQ-1 (ingest format normalization), REQ-2 (zai url-image guard)
Research: `research/issue-3693-zai-image-format-research.md` (live-probed
acceptance matrix; probe scripts in `tmp/verify3693/`)

## Summary

zai's Anthropic-compatible endpoint accepts exactly {png, jpeg, webp, gif} as
base64 image sources and rejects everything else — bmp, avif, tiff, svg — plus
ALL `source:{type:'url'}` images, with
`400 {"error":{"code":"1210","message":"[1210][图片输入格式/解析错误]..."}}`.
Both rejection classes are reachable from llxprt-code:

1. `read_file` classifies BMP/TIFF/AVIF/ICO files as images
   (`IMAGE_SIGNATURES` in `packages/tools/src/utils/fileUtils.ts`) and the
   resize pass only re-encodes {jpeg,png,gif,webp}, so unsupported bytes are
   forwarded as base64 with their original mime and 400 the request.
   Windows BMP screenshots hit this directly (reporter is on Windows).
2. Url-encoded image media blocks (fileData parts) become
   `source:{type:'url'}` in `AnthropicHumanMessageConverter`, which native
   Anthropic accepts but zai rejects with the same 1210.

## Fix design

### REQ-1: normalize image formats at ingest (tools layer)

**Full text**: `read_file` must never emit inline image media with a format
outside the {png, jpeg, gif, webp} set that vision endpoints accept.

**Behavior**:

- GIVEN a readable image file whose mime is outside {image/png, image/jpeg,
  image/gif, image/webp} (bmp, tiff, avif, heic, ico, …)
- WHEN the model reads it via the file tools
- THEN the returned media block is `image/png` base64 transcoded via sharp
  (sharp is already a runtime dep of `packages/tools`), not the original bytes
- GIVEN a sharp-undecodable file that nevertheless matched an image signature
- WHEN read
- THEN it degrades to the existing binary placeholder path (never raw bytes)
- GIVEN png/jpeg/gif/webp inputs
- WHEN read
- THEN passthrough is byte-identical to today (no re-encode, resize policy
  still applies as before)

**Where**: `packages/tools/src/utils/fileUtils.ts` (`processMediaFile` /
the media processing path), reusing the sharp pipeline shape from
`packages/tools/src/utils/imageResize.ts`. Keep it policy-free and
unconditional: no vision-capable endpoint family we ship (zai, native
Anthropic, OpenAI) accepts these formats, so there is no configuration to
thread. Do not add source-provenance metadata (unlike resize, the original
bytes have no consumer; storing them would double the payload).

**Why This Matters**: Fixes the reported Windows BMP failure and the same
class of failure on every other provider, without provider-specific
branching or new dependencies.

### REQ-2: guard url-sourced images on the zai endpoint (providers layer)

**Full text**: when the configured Anthropic base-url is a zai/bigmodel host,
url-encoded image blocks must not be serialized as `source:{type:'url'}`;
they take the existing unsupported-media text placeholder path instead.

**Behavior**:

- GIVEN an Anthropic provider whose base-url host is `z.ai`/`bigmodel.cn`
  (or a subdomain — reuse the host-suffix matching style of
  `reasoning-config-resolver.ts:283`)
- WHEN a message contains a url-encoded image media block
- THEN the outbound request carries the
  `buildUnsupportedMediaPlaceholder` text block (same mechanism audio/video
  already use in `convertHumanMessageWithMedia`) and NOT a url source, and
  `collectUnsupportedMedia` projection metadata reports it as unsupported
- GIVEN a native Anthropic (or any non-zai) base-url
- WHEN the same message is sent
- THEN url sources are serialized exactly as today (no behavior change)

**Where**: add the host test to
`packages/providers/src/anthropic/AnthropicEndpointUtils.ts` (home of
`isAnthropicOAuthBaseURL`); thread a flag (default off) from request
preparation — where base-url is known — down to
`convertHumanMessageWithMedia`/`mediaBlockToAnthropicImage`, and extend the
`isSupported` predicate passed to `collectUnsupportedMedia` at
`AnthropicProvider.ts:897`. Fail fast: no fetch-and-inline, no retry-on-1210.
`packages/providers` must not gain a sharp dependency.

**Why This Matters**: Url images can never reach zai; today they kill the
whole turn with an opaque 400. A visible placeholder keeps the turn alive
and tells the model/user what happened, consistent with how audio/video
already degrade.

## Out of scope

- zai audio/video inputs (already placeholder-handled).
- Fetching urls to inline them client-side.
- Reactive recovery/retry keyed on 1210 responses.
- SVG: `read_file` already routes `.svg` to the svg path (text), not image;
  `image/svg+xml` bytes are rejected by zai but are not reachable from the
  file tools; leave as-is.

## Test plan (bun test, TS only)

- `packages/tools`: unit tests reading fixture BMP/TIFF (generated with sharp;
  BMP hand-crafted — sharp cannot encode it, see
  `tmp/verify3693/probe-zai-images2.ts` `makeBmp`) and AVIF → expect
  `image/png` blocks; passthrough tests assert byte-identity for the four
  supported formats (incl. animated gif/webp); undecodable-image test asserts
  the binary placeholder.
- `packages/providers`: `isZaiAnthropicEndpoint` truth table (z.ai, api.z.ai,
  bigmodel.cn subdomains, anthropic.com, empty/undefined, garbage URLs);
  converter test — zai flag on → url image becomes placeholder part,
  flag off/default → url source unchanged; request-prep integration test
  with a zai base-url asserting the outbound body has no
  `source:{type:'url'}` and projection metadata lists the entry.

## Acceptance criteria

1. `bun tmp/verify3693/probe-zai-images.ts`-style live check: a BMP read via
   the tools path and sent to zai returns 200 (model sees the image).
2. All new unit/integration tests green; existing tools/providers suites
   unchanged.
3. Full verification cycle green: bun test (affected packages), lint,
   typecheck, format, build, smoke test.
4. No new runtime dependencies; sharp remains tools-only.

## Verification commands (implementer)

```
bun test packages/tools packages/providers   # targeted first
make lint && make typecheck && make format-check   # or repo equivalents
bun scripts/start.ts --profile-load zai-glm-flash "…"   # smoke (issue workflow)
```
