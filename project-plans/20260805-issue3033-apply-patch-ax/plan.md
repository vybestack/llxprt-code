# Issue #3033 — apply_patch agent-experience fixes

## Problem

`apply_patch` mechanics are sound but its feedback is not. A delete patch reports
success while truncating the file to zero bytes, the success message carries no
evidence that the change landed where it was asked for, and several errors name a
symptom instead of the cause (one actively steers the caller to the wrong remedy).

Source of truth: `packages/tools/src/tools/apply-patch.ts`.
Behavioral surface: `packages/tools/src/__tests__/apply-patch.test.ts`.

## Grounded findings (verified against `diff@8` before planning)

| Probe | Observed |
| --- | --- |
| `--- a/x.ts` / `+++ /dev/null` | parses to `newFileName: '/dev/null'` with one all-`-` hunk; `applyPatch` returns `''` |
| headerless patch (`@@` only) | parses with `oldFileName`/`newFileName` `undefined` |
| Codex `*** Begin Patch` envelope | parses to a single section with `hunks: []` |
| declared old-count too small | `parsePatch` throws `Removed line count did not match for hunk at line N` |
| declared new-count too small | `parsePatch` throws `Unknown line 6 "+c"` |
| wrong `@@` line hint, duplicate context | applies silently to the *second* occurrence |
| `structuredPatch(before, after, {context: 0})` | yields the true landing hunks of an applied patch |

The last row is the mechanism used for evidence reporting: landing positions are
derived from the actual before/after content, not from the patch's claims.

## Acceptance criteria

### AC1 — Delete patches delete (issue B1)

- A patch whose `+++` header is `/dev/null` and whose `---` header names the
  target removes the file from disk.
- The result reports deletion explicitly and carries no error.
- If the patch body does not match the file, the apply fails and the file is
  left untouched — deletion happens only after a successful apply.
- A delete patch whose `---` basename does not match the target is still
  rejected (existing `validatePatchTarget` guarantee is preserved).
- `returnDisplay` shows the removal, and LSP diagnostics are not collected for a
  file that no longer exists.

### AC2 — Success is evidence (issue A4, A5)

- A successful modify reports how many hunks were applied and the line range(s)
  in the resulting file where the change landed.
- When a hunk's declared start line differs from where it actually matched, the
  message states both the declared and the actual line.
- When a hunk's context block occurs more than once in the file, the message
  says so and names the line it chose.
- Creation and deletion successes carry their own proportionate evidence
  (lines written / file removed); no landing report is fabricated for them.

### AC3 — Path mismatch names both accepted forms (issue A1)

- The rejection message states the header value that was supplied *and* both
  forms that would be accepted: the workspace-relative path of `absolute_path`
  and its bare basename.

### AC4 — Missing or unrecognized header is named (issue A2)

- A patch with hunks but no `---`/`+++` header is rejected with a message that
  says the header is required and shows the accepted header forms.
- A `*** Begin Patch` / `*** Update File:` envelope is rejected with a message
  that names it as unsupported and points at unified diff.
- These are distinguishable from the pre-existing "no parseable file sections"
  case, which stays for genuinely unparseable input.

### AC5 — Hunk count mismatch is translated (issue A3)

- When a `@@` header declares counts that disagree with its body, the error
  names the offending header, the declared old/new counts, and the counts
  actually present in the body.
- Both under- and over-declared counts are covered.
- A parse failure that is not a count mismatch still surfaces its original
  message.

### AC6 — Missing file is not reported as context mismatch (issue B3)

- Patching a non-existent file with a non-creation patch fails with a message
  that says the file does not exist, typed `FILE_NOT_FOUND`.
- Creation patches (`--- /dev/null`) are unaffected.

### AC7 — Single error prefix (issue B2)

- `Failed to apply patch:` appears exactly once in a context-mismatch failure.

### AC8 — Schema states the path requirement (issue B4)

- The model-visible parameter schema expresses that one of `absolute_path` or
  `file_path` must be supplied.
- A call omitting both is rejected with a message naming both parameters.

### AC9 — Tool description states the rules (issue documentation gap)

The description documents: one target file per call; `---`/`+++` header
required; header path must be the basename or the workspace-relative path;
`/dev/null` on either side for create/delete; `@@` line numbers are tolerant but
line counts are strict; the Codex `*** Begin Patch` envelope is not accepted.

## Explicitly out of scope

- Accepting headerless patches (issue floats it as "consider"; the header check
  is a wrong-file safety guard and removing it is a behavior change, not a
  messaging fix).
- Changing ambiguity resolution to reject like `replace` does. The issue asks
  for the ambiguity to be *announced*, not for the strategy to change.
- Adding a delete method to the cross-package `FileSystemService` abstraction.
- Any change outside `packages/tools`.

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, plus the CLI smoke run.
