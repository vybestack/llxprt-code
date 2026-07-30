# Issue #2723 — Content-signature verification before trusting media mime classification

## Policy basis

The bounded issue-delivery policy is supplied inline with the issue request.
Scope targets: ≤ 25 files, ≤ 1 500 net changed lines; mandatory scope review
above either; stop without approval above 40 files or 2 500 net lines.

## Goal

Stop blindly trusting the extension-derived media mime in `detectFileType()`.
Before classifying a file as `image` / `audio` / `video`, validate the file's
actual bytes against a known magic-number signature. If no signature matches,
defer to the existing `isBinaryFile()` content sniff: clear text → `text`;
binary-but-unrecognized → retain the media type (avoids breaking legitimate
formats whose signature is not in the table).

## Decisions

- **Signature table mirroring** (CodeRabbit Design Choice 1, Option 2): mirror
  the signature table and verification helper in both `fileUtils.ts` copies
  (`packages/core` and `packages/tools`). This matches the existing duplication
  precedent — `detectFileType`, `isBinaryFile`, `detectBOM` are already
  duplicated. A shared module is a later, separate refactor.
- **Unverified-binary falls back to binary** (OCR finding, overriding
  CodeRabbit Design Choice 2 Option 2): when the signature does not verify,
  reclassify to `text` only when `isBinaryFile()` says text. Binary-but-
  unrecognized content is classified as `binary`, NOT the media type. An
  unverified binary blob sent as base64 media would trigger the same provider
  400 errors this feature prevents. The media type is only trusted when the
  signature actually verifies.
- **No caching** (issue comment from acoliver): the signature check reads ≤ 512
  bytes and compares against ~20 patterns — single-digit ms, sub-KB I/O.
  Per the cost/complexity guidance in the issue comment, no session-level
  caching is warranted. The cost is identical in order to the existing
  `isBinaryFile()` read (4 KB) which already runs un-cached.
- **`.tsx` alignment**: core's copy omits `.tsx` from the TypeScript
  short-circuit (tools includes it). Both are aligned to include `.tsx`.
- **Freehand allowlist stays**: the narrow `.fh*` exclusion from #2719
  remains. With the binary-fallback fix it is functionally redundant (the
  signature gate catches it), but it saves a `verifyMediaSignature` I/O call
  for `.fh` files and preserves the existing tested behavior.

## Acceptance matrix

| AC | Accepted behavior | Behavioral evidence |
| --- | --- | --- |
| A1 | A file with a media-colliding extension (e.g. `.png`) whose bytes are clear text and whose mime is mocked to `image/*` is classified `text`, not `image`. | `detectFileType` regression test: write text bytes, mock `image/png`, assert `text`. |
| A2 | A file with a genuine PNG signature and `image/png` mime is still classified `image`. | `detectFileType` test: write real PNG header, mock `image/png`, assert `image`. |
| A3 | A file with a genuine JPEG signature and `image/jpeg` mime is still classified `image`. | `detectFileType` test with JPEG header. |
| A4 | A file with binary content but no known media signature is classified `binary`, not the media type. Sending unverified binary as base64 media would trigger the same 400 errors this feature prevents. | `detectFileType` test: write random binary, mock `image/x-foo`, assert `binary`. |
| A5 | Audio collisions: text content with `audio/mpeg` mime → `text`; real MP3/ID3 header → `audio`. | `detectFileType` tests for audio category. |
| A6 | Video collisions: text content with `video/mp4` mime → `text`; real MP4 ftyp header → `video`. | `detectFileType` tests for video category. |
| A7 | PDF: real `%PDF` header with `application/pdf` → `pdf`; text content with `application/pdf` → `text`. | `detectFileType` tests for pdf category. |
| A8 | Existing `.ts`/`.mts`/`.cts`/`.tsx` and `.svg` short-circuits are unchanged. | Existing extension tests remain green; `.tsx` added to core. |
| A9 | Existing `.fh*` freehand exclusion remains effective. | Existing #2719 tests remain green. |
| A10 | Both `packages/core` and `packages/tools` copies behave identically. | Parity test cases in both test files. |
| A11 | I/O error during signature read conservatively returns "no match" so the caller falls through to the content sniff. | `detectFileType` test: non-existent path with media mime falls through to text/binary. |

## Explicit non-goals

- No new shared cross-package module (mirroring only).
- No session-level signature cache (cost is sub-ms, sub-KB).
- No removal of the existing `.fh*` freehand allowlist (#2719).
- No changes to `BINARY_EXTENSIONS` lists.
- No changes to downstream consumers (`processSingleFileContent`,
  `processMediaFile`, `read-many-files.ts`) — they already dispatch on the
  `detectFileType()` return value and need no modification.
- No new public abstraction, dependency, workflow, agent-memory, quality rule,
  lint/complexity threshold, suppression, or source exclusion.
- No unrelated refactor, test relocation, optional hardening, or cleanup.

## Bounded vertical slices

1. **Signature table + verification helper** — add `BytePattern` / signature
   constants and a `verifyMediaSignature()` helper (mirrored in both copies)
   that reads ≤ 512 bytes and matches against category signatures.
2. **Gate media branch** — rewire the `image/`/`audio/`/`video/`/`pdf` mime
   short-circuit in both `detectFileType()` copies to gate on signature
   verification, deferring to `isBinaryFile()` when unverified.
3. **`.tsx` alignment** — add `.tsx` to core's TypeScript short-circuit list.
4. **Regression tests** — add parity test cases in both test files covering
   text-with-media-mime, genuine-signature, binary-unrecognized, audio, video,
   pdf, and I/O-error fallthrough.

## Scope ledger

| Item | Status |
| --- | --- |
| `packages/core/src/utils/fileUtils.ts` — signature table + helper + gate | planned |
| `packages/tools/src/utils/fileUtils.ts` — mirror of above | planned |
| `packages/core/src/utils/fileUtils.test.ts` — regression tests | planned |
| `packages/tools/src/utils/fileUtils.test.ts` — parity regression tests | planned |
| `project-plans/issue-2723-content-signature-verification.md` — this plan | planned |

Expected files: 5. Expected net lines: well under 500.
