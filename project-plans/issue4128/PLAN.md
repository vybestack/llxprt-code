# Issue #4128: compression prompt text in files, no scratchpad

Test-first. Each step starts with a failing bun test, then the smallest change.

## 1. Prompt files (core + agents)

New defaults under `packages/core/src/prompt-config/defaults/compression/`:

- `security-preamble.md` (first turn of every compression and verification request)
- `trigger.md` (last turn, no prior snapshot)
- `trigger-with-prior-snapshot.md` (last turn, prior `<state_snapshot>` in the compressed span)
- `verification-request.md` (first instruction of the verification pass)
- `verification-follow-up.md` (closing instruction of the verification pass)

Registered in `CORE_DEFAULTS` (installer copies them into `<config>/prompts/compression/`).
`packages/core/src/core/compression/compressionPromptFiles.ts` resolves a file through
`context.promptResolver.resolveFile(promptBaseDir, ...)` (same as `compression.md`), falls back to
the bundled default from `CORE_DEFAULTS`, trims, and throws `PromptResolutionError` when empty.
`utils.ts` loses `COMPRESSION_SECURITY_PREAMBLE` and the inline strings; OneShot, MiddleOut and
`runVerificationPass` build their turns from the files. `compression.md` and the
`getCompressionPrompt()` fallback ask only for the `<state_snapshot>`.

Tests (agents `compressionPromptFiles.test.ts`): capture `generateChatCompletion` contents
for OneShot, MiddleOut and the verification pass with (a) defaults installed into a temp prompts
dir by the real `PromptInstaller`, and (b) an empty resolver (fallback path): no request contains
"scratchpad". With an override for each new file in a temp prompts dir, the request contains the
override text.

## 2. Strip scratchpads from new summaries

`packages/core/src/services/history/compressionSummaryScratchpad.ts`:
`stripScratchpadSections(text)` removes every `<scratchpad>…</scratchpad>` block and an
unterminated leading `<scratchpad>` section up to `<state_snapshot>` (to the end when no snapshot
follows). Strategies finalize the raw summary through it before the empty check and before the
verification pass; `runVerificationPass` finalizes the verifier's output the same way before its
`<state_snapshot>` validation. `sanitizeHistoryForCompression` strips older summaries in the
compressed span so a compression request never carries one.

Tests: summarizer replies `<scratchpad>x</scratchpad><state_snapshot>…` and an unterminated
leading scratchpad are stored as the snapshot only (OneShot, MiddleOut, verification output).

## 3. Recover existing sessions

Compression summaries are the entries tagged `metadata.isSummary === true` or
`metadata.reason === 'compression-state-snapshot'` (both set by OneShot and MiddleOut and
preserved in the session journal). `buildProviderContent` (shared by every provider through
`HistoryService.getCuratedForProvider`) strips scratchpad sections from those entries only.
Entries without a scratchpad keep their identity (prefix cache stability).

Tests (core): a history with a scratchpad summary yields provider content with the snapshot only;
a user message mentioning `<scratchpad>` is unchanged.

## 4. Installer upgrade

`installer/retired-defaults.ts` lists SHA-256 hashes of previously shipped defaults
(all historical `compression.md` versions). An installed file whose hash is listed is
overwritten with the new default. A kept user-edited file that still contains a `<scratchpad>`
tag gets an extra notice in `InstallResult.notices`.

Tests (core, temp dirs): an old default copy without a manifest entry is upgraded; an edited copy
with a scratchpad is kept and reported.

## Verification

typecheck, lint, runtime-state boundary, format, build, full test suite (nohup, tmp/verify4128),
smoke with `lunahigh`.
